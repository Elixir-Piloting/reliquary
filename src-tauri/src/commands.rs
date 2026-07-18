use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use chrono::Utc;
use rusqlite::Connection as SqliteConnection;
use tokio_postgres::Client as PgClient;

use crate::types::*;
use crate::pg;
use crate::sqlite;

#[tauri::command]
pub async fn list_connections(state: tauri::State<'_, AppState>) -> Result<Vec<StoredConnection>, String> {
    Ok(state.load_config())
}

#[tauri::command]
pub async fn add_connection(name: String, url: String, state: tauri::State<'_, AppState>) -> Result<StoredConnection, String> {
    let mut config = state.load_config();
    let id = uuid::Uuid::new_v4().to_string();
    let provider = detect_provider(&url).to_string();
    let conn = StoredConnection {
        id: id.clone(),
        name,
        url,
        provider: Some(provider),
        color: None,
        created_at: Some(Utc::now().to_rfc3339()),
    };
    config.push(conn.clone());
    state.save_config(&config);
    Ok(conn)
}

#[tauri::command]
pub async fn update_connection(id: String, name: Option<String>, url: Option<String>, state: tauri::State<'_, AppState>) -> Result<(), String> {
    let mut config = state.load_config();
    if let Some(entry) = config.iter_mut().find(|c| c.id == id) {
        if let Some(n) = name { entry.name = n; }
        if let Some(u) = url { let provider = detect_provider(&u).to_string(); entry.url = u; entry.provider = Some(provider); }
        state.save_config(&config);
        Ok(())
    } else {
        Err("Connection not found".into())
    }
}

#[tauri::command]
pub async fn delete_connection(id: String, state: tauri::State<'_, AppState>) -> Result<(), String> {
    let mut config = state.load_config();
    config.retain(|c| c.id != id);
    state.save_config(&config);
    state.connections.lock().await.remove(&id);
    Ok(())
}

#[tauri::command]
pub async fn test_connection(url: String, _state: tauri::State<'_, AppState>) -> Result<TestConnectionResult, String> {
    if url.to_lowercase().starts_with("postgresql://") || url.to_lowercase().starts_with("postgres://") {
        let conn_str = pg::parse_pg_connstr(&url)?;
        match tokio::time::timeout(std::time::Duration::from_secs(5), tokio_postgres::connect(&conn_str, tokio_postgres::NoTls)).await {
            Ok(Ok((client, connection))) => {
                tokio::spawn(async move { drop(connection); });
                let ver = client.query_one("SELECT version()", &[]).await
                    .ok().and_then(|r| r.get::<_, Option<String>>(0));
                drop(client);
                Ok(TestConnectionResult { success: true, error: None, server_version: ver })
            }
            Ok(Err(e)) => Ok(TestConnectionResult { success: false, error: Some(e.to_string()), server_version: None }),
            Err(_) => Ok(TestConnectionResult { success: false, error: Some("Timed out (5s)".into()), server_version: None }),
        }
    } else {
        Err("Only PostgreSQL URLs supported for testing".into())
    }
}

#[tauri::command]
pub async fn connect(connection_id: String, url: String, state: tauri::State<'_, AppState>) -> Result<String, String> {
    let provider = detect_provider(&url);

    {
        let guard = state.connections.lock().await;
        if guard.contains_key(&connection_id) {
            return Ok("Already connected".into());
        }
    }

    match provider {
        "sqlite" => {
            let path = if url.starts_with("file:") {
                url.strip_prefix("file:").unwrap_or(&url)
            } else {
                &url
            };
            let conn = SqliteConnection::open(path).map_err(|e| format!("SQLite open: {}", e))?;
            let _ = conn.execute_batch("PRAGMA journal_mode=WAL");
            state.connections.lock().await.insert(connection_id.clone(), DbConnection::Sqlite(Arc::new(Mutex::new(conn))));
            Ok(format!("Connected to SQLite: {}", path))
        }
        _ => {
            let conn_str = pg::parse_pg_connstr(&url)?;
            match tokio::time::timeout(std::time::Duration::from_secs(5), tokio_postgres::connect(&conn_str, tokio_postgres::NoTls)).await {
                Ok(Ok((client, connection))) => {
                    tokio::spawn(async move {
                        if let Err(e) = connection.await {
                            eprintln!("connection error: {}", e);
                        }
                    });
                    let ver: String = client.query_one("SELECT version()", &[])
                        .await
                        .map(|r| r.get::<_, String>(0))
                        .unwrap_or_else(|_| "unknown".into());
                    state.connections.lock().await.insert(connection_id.clone(), DbConnection::Postgresql(Arc::new(client)));
                    Ok(format!("Connected to {}: {}", provider, ver))
                }
                Ok(Err(e)) => Err(format!("Connection failed: {}", e)),
                Err(_) => Err("Connection timed out (5s)".into()),
            }
        }
    }
}

#[tauri::command]
pub async fn disconnect(connection_id: String, state: tauri::State<'_, AppState>) -> Result<(), String> {
    state.connections.lock().await.remove(&connection_id);
    Ok(())
}

#[tauri::command]
pub async fn is_connected(connection_id: String, state: tauri::State<'_, AppState>) -> Result<bool, String> {
    Ok(state.connections.lock().await.contains_key(&connection_id))
}

fn extract_connection(guard: &HashMap<String, DbConnection>, id: &str) -> (Option<Arc<PgClient>>, Option<Arc<Mutex<SqliteConnection>>>) {
    match guard.get(id) {
        Some(DbConnection::Postgresql(c)) => (Some(c.clone()), None),
        Some(DbConnection::Sqlite(a)) => (None, Some(a.clone())),
        None => (None, None),
    }
}

macro_rules! dispatch_command {
    ($guard:ident, $id:expr, $pg_fn:expr, $sql_fn:expr) => {{
        let (pg_client, sql_arc) = extract_connection(&$guard, $id);
        drop($guard);
        if let Some(client) = pg_client {
            ($pg_fn)(&client).await
        } else if let Some(arc) = sql_arc {
            let conn = arc.lock().map_err(|e| e.to_string())?;
            ($sql_fn)(&conn)
        } else {
            Err("Not connected".into())
        }
    }};
}

#[tauri::command]
pub async fn get_schemas(connection_id: String, state: tauri::State<'_, AppState>) -> Result<Vec<SchemaInfo>, String> {
    let guard = state.connections.lock().await;
    dispatch_command!(guard, &connection_id, pg::pg_get_schemas, sqlite::sqlite_get_schemas)
}

#[tauri::command]
pub async fn get_tables(connection_id: String, schema: String, state: tauri::State<'_, AppState>) -> Result<Vec<TableInfo>, String> {
    let guard = state.connections.lock().await;
    let (pg_client, sql_arc) = extract_connection(&guard, &connection_id);
    drop(guard);
    if let Some(client) = pg_client {
        pg::pg_get_tables(&client, &schema).await
    } else if let Some(arc) = sql_arc {
        let conn = arc.lock().map_err(|e| e.to_string())?;
        sqlite::sqlite_get_tables(&conn, &schema)
    } else {
        Err("Not connected".into())
    }
}

#[tauri::command]
pub async fn get_columns(connection_id: String, schema: String, table: String, state: tauri::State<'_, AppState>) -> Result<Vec<ColumnInfo>, String> {
    let guard = state.connections.lock().await;
    let (pg_client, sql_arc) = extract_connection(&guard, &connection_id);
    drop(guard);
    if let Some(client) = pg_client {
        pg::pg_get_columns(&client, &schema, &table).await
    } else if let Some(arc) = sql_arc {
        let conn = arc.lock().map_err(|e| e.to_string())?;
        sqlite::sqlite_get_columns(&conn, &schema, &table)
    } else {
        Err("Not connected".into())
    }
}

#[tauri::command]
pub async fn get_indexes(connection_id: String, schema: String, table: String, state: tauri::State<'_, AppState>) -> Result<Vec<IndexInfo>, String> {
    let guard = state.connections.lock().await;
    let (pg_client, sql_arc) = extract_connection(&guard, &connection_id);
    drop(guard);
    if let Some(client) = pg_client {
        pg::pg_get_indexes(&client, &schema, &table).await
    } else if let Some(arc) = sql_arc {
        let conn = arc.lock().map_err(|e| e.to_string())?;
        sqlite::sqlite_get_indexes(&conn, &schema, &table)
    } else {
        Err("Not connected".into())
    }
}

#[tauri::command]
pub async fn get_constraints(connection_id: String, schema: String, table: String, state: tauri::State<'_, AppState>) -> Result<Vec<ConstraintInfo>, String> {
    let guard = state.connections.lock().await;
    let (pg_client, sql_arc) = extract_connection(&guard, &connection_id);
    drop(guard);
    if let Some(client) = pg_client {
        pg::pg_get_constraints(&client, &schema, &table).await
    } else if let Some(arc) = sql_arc {
        let conn = arc.lock().map_err(|e| e.to_string())?;
        sqlite::sqlite_get_constraints(&conn, &schema, &table)
    } else {
        Err("Not connected".into())
    }
}

#[tauri::command]
pub async fn get_schema_relationships(connection_id: String, schema: String, state: tauri::State<'_, AppState>) -> Result<Vec<RelationshipInfo>, String> {
    let guard = state.connections.lock().await;
    let (pg_client, sql_arc) = extract_connection(&guard, &connection_id);
    drop(guard);
    if let Some(client) = pg_client {
        pg::pg_get_schema_relationships(&client, &schema).await
    } else if let Some(arc) = sql_arc {
        let conn = arc.lock().map_err(|e| e.to_string())?;
        sqlite::sqlite_get_schema_relationships(&conn, &schema)
    } else {
        Err("Not connected".into())
    }
}

#[tauri::command]
pub async fn get_relationships(connection_id: String, schema: String, table: String, state: tauri::State<'_, AppState>) -> Result<Vec<RelationshipInfo>, String> {
    let guard = state.connections.lock().await;
    let (pg_client, sql_arc) = extract_connection(&guard, &connection_id);
    drop(guard);
    if let Some(client) = pg_client {
        pg::pg_get_relationships(&client, &schema, &table).await
    } else if let Some(arc) = sql_arc {
        let conn = arc.lock().map_err(|e| e.to_string())?;
        sqlite::sqlite_get_relationships(&conn, &schema, &table)
    } else {
        Err("Not connected".into())
    }
}

#[tauri::command]
pub async fn get_table_data(
    connection_id: String,
    schema: String,
    table: String,
    page: i64,
    page_size: i64,
    sort_column: Option<String>,
    sort_direction: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<TableDataResult, String> {
    let guard = state.connections.lock().await;
    let (pg_client, sql_arc) = extract_connection(&guard, &connection_id);
    drop(guard);
    if let Some(client) = pg_client {
        pg::pg_get_table_data(&client, &schema, &table, page, page_size, sort_column.as_deref(), sort_direction.as_deref()).await
    } else if let Some(arc) = sql_arc {
        let conn = arc.lock().map_err(|e| e.to_string())?;
        sqlite::sqlite_get_table_data(&conn, &schema, &table, page, page_size, sort_column.as_deref(), sort_direction.as_deref())
    } else {
        Err("Not connected".into())
    }
}

#[tauri::command]
pub async fn execute_query(connection_id: String, query: String, state: tauri::State<'_, AppState>) -> Result<QueryResult, String> {
    let guard = state.connections.lock().await;
    let (pg_client, sql_arc) = extract_connection(&guard, &connection_id);
    drop(guard);
    if let Some(client) = pg_client {
        pg::pg_execute_query(&client, &query).await
    } else if let Some(arc) = sql_arc {
        let conn = arc.lock().map_err(|e| e.to_string())?;
        sqlite::sqlite_execute_query(&conn, &query)
    } else {
        Err("Not connected".into())
    }
}

#[tauri::command]
pub async fn detect_local_servers(_state: tauri::State<'_, AppState>) -> Result<Vec<LocalPgServer>, String> {
    use tokio::net::TcpStream;
    let ports: Vec<u16> = (5432..=5435).collect();
    let mut servers = Vec::new();
    for port in ports {
        let key = format!("localhost:{}", port);
        match tokio::time::timeout(std::time::Duration::from_secs(2), TcpStream::connect(("localhost", port))).await {
            Ok(Ok(_stream)) => {
                servers.push(LocalPgServer {
                    key,
                    host: "localhost".into(),
                    port,
                    running: true,
                    version: None,
                });
            }
            _ => {
                servers.push(LocalPgServer { key, host: "localhost".into(), port, running: false, version: None });
            }
        }
    }
    Ok(servers)
}

fn local_pg_conn_str(host: &str, port: u16, user: Option<String>, password: Option<String>) -> String {
    let user = user.unwrap_or_else(|| "postgres".to_string());
    match password {
        Some(p) if !p.is_empty() => format!("host={host} port={port} dbname=postgres user={user} password={p} connect_timeout=5"),
        _ => format!("host={host} port={port} dbname=postgres user={user} connect_timeout=5"),
    }
}

#[tauri::command]
pub async fn list_local_databases(host: String, port: u16, user: Option<String>, password: Option<String>, _state: tauri::State<'_, AppState>) -> Result<Vec<LocalPgDatabase>, String> {
    let conn_str = local_pg_conn_str(&host, port, user, password);
    let (client, connection) = tokio::time::timeout(std::time::Duration::from_secs(5), tokio_postgres::connect(&conn_str, tokio_postgres::NoTls)).await
        .map_err(|_| "Timed out (5s)".to_string())?
        .map_err(|e| format!("connect: {}", e))?;
    tokio::spawn(async move { drop(connection); });
    let rows = client.query(
        "SELECT datname, pg_catalog.pg_get_userbyid(datdba) AS owner, pg_encoding_to_char(encoding) AS encoding, pg_size_pretty(pg_database_size(datname)) AS size FROM pg_database WHERE datistemplate = false ORDER BY datname",
        &[],
    ).await.map_err(|e| format!("query: {}", e))?;
    let dbs: Vec<LocalPgDatabase> = rows.iter().map(|r| LocalPgDatabase {
        name: r.get(0),
        owner: r.get(1),
        encoding: r.get(2),
        size: r.get(3),
    }).collect();
    drop(client);
    Ok(dbs)
}

#[tauri::command]
pub async fn create_local_database(host: String, port: u16, db_name: String, user: Option<String>, password: Option<String>, _state: tauri::State<'_, AppState>) -> Result<(), String> {
    let conn_str = local_pg_conn_str(&host, port, user, password);
    let (client, connection) = tokio::time::timeout(std::time::Duration::from_secs(5), tokio_postgres::connect(&conn_str, tokio_postgres::NoTls)).await
        .map_err(|_| "Timed out (5s)".to_string())?
        .map_err(|e| format!("connect: {}", e))?;
    tokio::spawn(async move { drop(connection); });
    client.execute(
        &format!("CREATE DATABASE \"{}\"", db_name),
        &[],
    ).await.map_err(|e| format!("create: {}", e))?;
    drop(client);
    Ok(())
}

#[tauri::command]
pub async fn drop_local_database(host: String, port: u16, db_name: String, user: Option<String>, password: Option<String>, _state: tauri::State<'_, AppState>) -> Result<(), String> {
    let conn_str = local_pg_conn_str(&host, port, user, password);
    let (client, connection) = tokio::time::timeout(std::time::Duration::from_secs(5), tokio_postgres::connect(&conn_str, tokio_postgres::NoTls)).await
        .map_err(|_| "Timed out (5s)".to_string())?
        .map_err(|e| format!("connect: {}", e))?;
    tokio::spawn(async move { drop(connection); });
    client.execute(
        &format!("DROP DATABASE IF EXISTS \"{}\"", db_name),
        &[],
    ).await.map_err(|e| format!("drop: {}", e))?;
    drop(client);
    Ok(())
}
