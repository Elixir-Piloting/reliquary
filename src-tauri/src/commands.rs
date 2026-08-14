use std::str::FromStr;
use std::sync::Arc;
use chrono::Utc;

use crate::types::*;
use crate::pg;

#[tauri::command]
pub async fn list_connections(state: tauri::State<'_, AppState>) -> Result<Vec<StoredConnection>, String> {
    Ok(state.load_config())
}

#[tauri::command]
pub async fn add_connection(name: String, url: String, read_only: bool, state: tauri::State<'_, AppState>) -> Result<StoredConnection, String> {
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
        sslmode: None,
        read_only: Some(read_only),
        neon_api_key: None,
    };
    config.push(conn.clone());
    state.save_config(&config);
    Ok(conn)
}

#[tauri::command]
pub async fn update_connection(id: String, name: Option<String>, url: Option<String>, read_only: Option<bool>, state: tauri::State<'_, AppState>) -> Result<(), String> {
    let mut config = state.load_config();
    if let Some(entry) = config.iter_mut().find(|c| c.id == id) {
        if let Some(n) = name { entry.name = n; }
        if let Some(u) = url { let provider = detect_provider(&u).to_string(); entry.url = u; entry.provider = Some(provider); }
        if let Some(ro) = read_only { entry.read_only = Some(ro); }
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
        let parts = pg::parse_pg_url(&url)?;
        let conn_str = pg::parse_pg_connstr(&url)?;
        let tls = pg::build_tls(&parts.sslmode)?;
        match tokio::time::timeout(std::time::Duration::from_secs(5), tokio_postgres::connect(&conn_str, tls)).await {
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
pub async fn connect(connection_id: String, url: String, read_only: bool, state: tauri::State<'_, AppState>) -> Result<String, String> {
    {
        let guard = state.connections.lock().await;
        if guard.contains_key(&connection_id) {
            return Ok("Already connected".into());
        }
    }

    let parts = pg::parse_pg_url(&url)?;
    let conn_str = pg::parse_pg_connstr(&url)?;
    let tls = pg::build_tls(&parts.sslmode)?;
    let pg_config = tokio_postgres::Config::from_str(&conn_str)
        .map_err(|e| format!("Invalid connection string: {}", e))?;
    let manager = deadpool_postgres::Manager::new(pg_config, tls);
    let pool = deadpool_postgres::Pool::builder(manager)
        .max_size(8)
        .build()
        .map_err(|e| format!("Failed to build connection pool: {}", e))?;
    match tokio::time::timeout(std::time::Duration::from_secs(5), async {
        let client = pool.get().await?;
        let ver: String = client.query_one("SELECT version()", &[])
            .await
            .map(|r| r.get::<_, String>(0))
            .unwrap_or_else(|_| "unknown".into());
        Ok::<String, deadpool_postgres::PoolError>(ver)
    }).await {
        Ok(Ok(ver)) => {
            let hint = pooled_endpoint_hint(&url, &parts.port);
            let ro_suffix = if read_only { " (read-only)" } else { "" };
            state.connections.lock().await.insert(
                connection_id.clone(),
                ActiveConnection { pool: Arc::new(pool), read_only, url: url.clone() },
            );
            Ok(format!("Connected to PostgreSQL: {}{}{}", ver, ro_suffix, hint))
        }
        Ok(Err(e)) => Err(format!("Connection failed: {}", e)),
        Err(_) => Err("Connection timed out (5s)".into()),
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

#[tauri::command]
pub async fn get_connection_info(connection_id: String, state: tauri::State<'_, AppState>) -> Result<ConnectionInfo, String> {
    let handle = get_handle(&state, &connection_id).await?;
    let client = get_client(&handle).await?;
    pg::pg_connection_info(&client, &handle.url, handle.read_only).await
}

/// A snapshot of an active connection's pool + flags, taken *without* holding
/// the connections mutex across any await. Holding the guard while a query
/// runs serializes every connection: a slow query on one connection would
/// block all others despite the per-pool `max_size(8)`.
struct ConnectionHandle {
    pool: Arc<deadpool_postgres::Pool>,
    read_only: bool,
    url: String,
}

async fn get_handle(state: &AppState, id: &str) -> Result<ConnectionHandle, String> {
    let guard = state.connections.lock().await;
    let ac = guard.get(id).ok_or_else(|| "Not connected".to_string())?;
    Ok(ConnectionHandle {
        pool: ac.pool.clone(),
        read_only: ac.read_only,
        url: ac.url.clone(),
    })
}

async fn get_client(handle: &ConnectionHandle) -> Result<deadpool_postgres::Object, String> {
    handle.pool.get().await.map_err(|e| format!("No connection available: {}", e))
}

fn pooled_endpoint_hint(url: &str, port: &str) -> &'static str {
    let provider = detect_provider(url);
    let lower = url.to_lowercase();
    let supabase_pooled = provider == "supabase" && (lower.contains("pooler.supabase") || port == "6543");
    let neon_pooled = provider == "neon" && lower.contains("pooler");
    if supabase_pooled || neon_pooled {
        "\nNote: pooled endpoint detected — session-level features (EXPLAIN, SET) may be limited."
    } else {
        ""
    }
}

#[tauri::command]
pub async fn get_schemas(connection_id: String, state: tauri::State<'_, AppState>) -> Result<Vec<SchemaInfo>, String> {
    let handle = get_handle(&state, &connection_id).await?;
    let client = get_client(&handle).await?;
    pg::pg_get_schemas(&client).await
}

#[tauri::command]
pub async fn create_schema(connection_id: String, name: String, state: tauri::State<'_, AppState>) -> Result<(), String> {
    let handle = get_handle(&state, &connection_id).await?;
    if handle.read_only {
        return Err("Connection is read-only".into());
    }
    let client = get_client(&handle).await?;
    pg::pg_create_schema(&client, &name).await
}

#[tauri::command]
pub async fn get_tables(connection_id: String, schema: String, state: tauri::State<'_, AppState>) -> Result<Vec<TableInfo>, String> {
    let handle = get_handle(&state, &connection_id).await?;
    let client = get_client(&handle).await?;
    pg::pg_get_tables(&client, &schema).await
}

#[tauri::command]
pub async fn get_columns(connection_id: String, schema: String, table: String, state: tauri::State<'_, AppState>) -> Result<Vec<ColumnInfo>, String> {
    let handle = get_handle(&state, &connection_id).await?;
    let client = get_client(&handle).await?;
    pg::pg_get_columns(&client, &schema, &table).await
}

#[tauri::command]
pub async fn get_indexes(connection_id: String, schema: String, table: String, state: tauri::State<'_, AppState>) -> Result<Vec<IndexInfo>, String> {
    let handle = get_handle(&state, &connection_id).await?;
    let client = get_client(&handle).await?;
    pg::pg_get_indexes(&client, &schema, &table).await
}

#[tauri::command]
pub async fn get_constraints(connection_id: String, schema: String, table: String, state: tauri::State<'_, AppState>) -> Result<Vec<ConstraintInfo>, String> {
    let handle = get_handle(&state, &connection_id).await?;
    let client = get_client(&handle).await?;
    pg::pg_get_constraints(&client, &schema, &table).await
}

#[tauri::command]
pub async fn get_schema_relationships(connection_id: String, schema: String, state: tauri::State<'_, AppState>) -> Result<Vec<RelationshipInfo>, String> {
    let handle = get_handle(&state, &connection_id).await?;
    let client = get_client(&handle).await?;
    pg::pg_get_schema_relationships(&client, &schema).await
}

#[tauri::command]
pub async fn get_relationships(connection_id: String, schema: String, table: String, state: tauri::State<'_, AppState>) -> Result<Vec<RelationshipInfo>, String> {
    let handle = get_handle(&state, &connection_id).await?;
    let client = get_client(&handle).await?;
    pg::pg_get_relationships(&client, &schema, &table).await
}

#[tauri::command]
pub async fn get_views(connection_id: String, schema: String, state: tauri::State<'_, AppState>) -> Result<Vec<ViewInfo>, String> {
    let handle = get_handle(&state, &connection_id).await?;
    let client = get_client(&handle).await?;
    pg::pg_get_views(&client, &schema).await
}

#[tauri::command]
pub async fn get_triggers(connection_id: String, schema: String, table: String, state: tauri::State<'_, AppState>) -> Result<Vec<TriggerInfo>, String> {
    let handle = get_handle(&state, &connection_id).await?;
    let client = get_client(&handle).await?;
    pg::pg_get_triggers(&client, &schema, &table).await
}

#[tauri::command]
pub async fn get_functions(connection_id: String, schema: String, state: tauri::State<'_, AppState>) -> Result<Vec<FunctionInfo>, String> {
    let handle = get_handle(&state, &connection_id).await?;
    let client = get_client(&handle).await?;
    pg::pg_get_functions(&client, &schema).await
}

#[tauri::command]
pub async fn get_rls_policies(connection_id: String, schema: String, table: String, state: tauri::State<'_, AppState>) -> Result<Vec<RlsPolicyInfo>, String> {
    let handle = get_handle(&state, &connection_id).await?;
    let client = get_client(&handle).await?;
    pg::pg_get_rls_policies(&client, &schema, &table).await
}

#[tauri::command]
pub async fn get_roles(connection_id: String, state: tauri::State<'_, AppState>) -> Result<Vec<RoleInfo>, String> {
    let handle = get_handle(&state, &connection_id).await?;
    let client = get_client(&handle).await?;
    pg::pg_get_roles(&client).await
}

#[tauri::command]
pub async fn table_rls_status(connection_id: String, schema: String, table: String, state: tauri::State<'_, AppState>) -> Result<bool, String> {
    let handle = get_handle(&state, &connection_id).await?;
    let client = get_client(&handle).await?;
    pg::pg_table_rls_status(&client, &schema, &table).await
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
    filters: Option<Vec<TableFilter>>,
    state: tauri::State<'_, AppState>,
) -> Result<TableDataResult, String> {
    let handle = get_handle(&state, &connection_id).await?;
    let client = get_client(&handle).await?;
    pg::pg_get_table_data(&client, &schema, &table, page, page_size, sort_column.as_deref(), sort_direction.as_deref(), filters.as_deref().unwrap_or(&[])).await
}

#[tauri::command]
pub async fn execute_query(connection_id: String, query: String, options: QueryOptions, state: tauri::State<'_, AppState>) -> Result<QueryResult, String> {
    let handle = get_handle(&state, &connection_id).await?;
    if handle.read_only && (pg::is_destructive(&query) || !pg::is_select_query(&query)) {
        return Err("Connection is read-only".into());
    }
    if pg::is_destructive(&query) && !options.confirm_destructive {
        return Err("DESTRUCTIVE_QUERY_REQUIRES_CONFIRMATION".into());
    }
    let client = get_client(&handle).await?;
    pg::pg_execute_query(&client, &query).await
}

#[tauri::command]
pub async fn execute_query_params(connection_id: String, query: String, params: Vec<serde_json::Value>, options: QueryOptions, state: tauri::State<'_, AppState>) -> Result<QueryResult, String> {
    let handle = get_handle(&state, &connection_id).await?;
    if handle.read_only && (pg::is_destructive(&query) || !pg::is_select_query(&query)) {
        return Err("Connection is read-only".into());
    }
    if pg::is_destructive(&query) && !options.confirm_destructive {
        return Err("DESTRUCTIVE_QUERY_REQUIRES_CONFIRMATION".into());
    }
    let client = get_client(&handle).await?;
    pg::pg_execute_query_params(&client, &query, &params).await
}

#[tauri::command]
pub async fn mutate_rows(connection_id: String, statements: Vec<RowMutationStatement>, state: tauri::State<'_, AppState>) -> Result<Vec<QueryResult>, String> {
    let handle = get_handle(&state, &connection_id).await?;
    if handle.read_only {
        return Err("Connection is read-only".into());
    }
    // Grid edits are structured UPDATE/DELETE/INSERT statements (none DDL), so
    // any DDL statement here is a hostile/accidental schema change — reject it.
    for stmt in &statements {
        if pg::is_ddl(&stmt.query) {
            return Err("DESTRUCTIVE_QUERY_REQUIRES_CONFIRMATION".into());
        }
    }
    let mut client = get_client(&handle).await?;
    pg::pg_mutate(&mut client, &statements).await
}

#[tauri::command]
pub async fn explain_query(connection_id: String, query: String, analyze: bool, state: tauri::State<'_, AppState>) -> Result<ExplainResult, String> {
    let handle = get_handle(&state, &connection_id).await?;
    if handle.read_only && !pg::explain_safe_to_run(&query) {
        return Err("Connection is read-only".into());
    }
    let client = get_client(&handle).await?;
    pg::pg_explain(&client, &query, analyze).await
}

#[tauri::command]
pub async fn get_enum_values(connection_id: String, type_name: String, state: tauri::State<'_, AppState>) -> Result<Vec<String>, String> {
    let handle = get_handle(&state, &connection_id).await?;
    let client = get_client(&handle).await?;
    pg::pg_get_enum_values(&client, &type_name).await
}

#[tauri::command]
pub async fn list_neon_branches(connection_id: String, api_key: String, state: tauri::State<'_, AppState>) -> Result<Vec<NeonBranch>, String> {
    let handle = get_handle(&state, &connection_id).await?;
    crate::neon::list_neon_branches(&api_key, &handle.url).await
}

#[tauri::command]
pub async fn save_neon_api_key(connection_id: String, api_key: String, state: tauri::State<'_, AppState>) -> Result<(), String> {
    let mut config = state.load_config();
    if let Some(entry) = config.iter_mut().find(|c| c.id == connection_id) {
        entry.neon_api_key = Some(api_key);
        state.save_config(&config);
        Ok(())
    } else {
        Err("Connection not found".into())
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
        // Quote values like the main parse_pg_connstr so passwords containing
        // spaces/quotes/backslashes/= don't break the conninfo tokenizer.
        Some(p) if !p.is_empty() => format!(
            "host={} port={} dbname=postgres user={} password={} connect_timeout=5",
            pg::connstr_value(host),
            pg::connstr_value(&port.to_string()),
            pg::connstr_value(&user),
            pg::connstr_value(&p),
        ),
        _ => format!(
            "host={} port={} dbname=postgres user={} connect_timeout=5",
            pg::connstr_value(host),
            pg::connstr_value(&port.to_string()),
            pg::connstr_value(&user),
        ),
    }
}

#[tauri::command]
pub async fn list_local_databases(host: String, port: u16, user: Option<String>, password: Option<String>, _state: tauri::State<'_, AppState>) -> Result<Vec<LocalPgDatabase>, String> {
    let conn_str = local_pg_conn_str(&host, port, user, password);
    eprintln!("[local-pg] conn_str = {}", conn_str);
    let res = tokio::time::timeout(std::time::Duration::from_secs(5), tokio_postgres::connect(&conn_str, tokio_postgres::NoTls)).await;
    match res {
        Ok(Ok((client, connection))) => {
            // Drive the connection in the background — dropping it closes the
            // socket immediately, so subsequent client queries fail with
            // "connection closed".
            tokio::spawn(async move { let _ = connection.await; });
            eprintln!("[local-pg] connected OK");
            let rows = client.query(
                "SELECT datname, pg_catalog.pg_get_userbyid(datdba) AS owner, pg_encoding_to_char(encoding) AS encoding, NULL::text AS size FROM pg_database WHERE datistemplate = false ORDER BY datname",
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
        Ok(Err(e)) => {
            eprintln!("[local-pg] connect ERROR: {}", e);
            Err(format!("connect: {}", e))
        }
        Err(_) => {
            eprintln!("[local-pg] connect TIMEOUT");
            Err("Timed out (5s)".to_string())
        }
    }
}

#[tauri::command]
pub async fn create_local_database(host: String, port: u16, db_name: String, user: Option<String>, password: Option<String>, _state: tauri::State<'_, AppState>) -> Result<(), String> {
    let conn_str = local_pg_conn_str(&host, port, user, password);
    let (client, connection) = tokio::time::timeout(std::time::Duration::from_secs(5), tokio_postgres::connect(&conn_str, tokio_postgres::NoTls)).await
        .map_err(|_| "Timed out (5s)".to_string())?
        .map_err(|e| format!("connect: {}", e))?;
    tokio::spawn(async move { let _ = connection.await; });
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
    tokio::spawn(async move { let _ = connection.await; });
    client.execute(
        &format!("DROP DATABASE IF EXISTS \"{}\"", db_name),
        &[],
    ).await.map_err(|e| format!("drop: {}", e))?;
    drop(client);
    Ok(())
}
