use crate::types::*;
use std::collections::HashMap;
use tokio_postgres::Client as PgClient;

// ---------------------------------------------------------------------------
// Parse connection URL -> conn string parts
// ---------------------------------------------------------------------------

pub fn parse_pg_url(url: &str) -> Result<(String, String, String, String, String, String), String> {
    let lower = url.to_lowercase();
    let rest = if lower.starts_with("postgresql://") || lower.starts_with("postgres://") {
        &url[lower.find("://").unwrap() + 3..]
    } else {
        return Err("Not a PostgreSQL URL".into());
    };
    let (creds, hostpart) = if let Some(at) = rest.rfind('@') {
        (&rest[..at], &rest[at + 1..])
    } else {
        ("", rest)
    };
    let (user, pass) = if let Some(colon) = creds.find(':') {
        (urlencoding_or_raw(&creds[..colon]), urlencoding_or_raw(&creds[colon + 1..]))
    } else {
        (urlencoding_or_raw(creds), String::new())
    };
    let no_qs = hostpart.split('?').next().unwrap_or(hostpart);
    let (h, p, d) = if let Some(slash) = no_qs.find('/') {
        let hostport = &no_qs[..slash];
        let db = &no_qs[slash + 1..];
        if let Some(colon) = hostport.find(':') {
            (&hostport[..colon], hostport[colon + 1..].to_string(), db)
        } else {
            (hostport, "5432".to_string(), db)
        }
    } else if let Some(colon) = no_qs.find(':') {
        (&no_qs[..colon], no_qs[colon + 1..].to_string(), "")
    } else {
        (no_qs, "5432".to_string(), "")
    };
    let ssl = if url.contains("sslmode=require") || url.contains("ssl=true") { "require" } else { "" };
    Ok((urlencoding_or_raw(h), p, urlencoding_or_raw(d), user, pass, ssl.to_string()))
}

pub fn urlencoding_or_raw(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars();
    while let Some(c) = chars.next() {
        if c == '%' {
            let hex: String = chars.by_ref().take(2).collect();
            if hex.len() == 2 {
                if let Ok(byte) = u8::from_str_radix(&hex, 16) {
                    out.push(byte as char);
                    continue;
                }
            }
            out.push('%');
            out.push_str(&hex);
        } else {
            out.push(c);
        }
    }
    out
}

pub fn parse_pg_connstr(url: &str) -> Result<String, String> {
    let (host, port, db, user, pass, ssl) = parse_pg_url(url)?;
    let mut s = format!("host={} port={} dbname={}", host, port, db);
    if !user.is_empty() {
        s.push_str(&format!(" user={}", user));
    }
    if !pass.is_empty() {
        s.push_str(&format!(" password={}", pass));
    }
    if ssl == "require" {
        s.push_str(" sslmode=require");
    }
    s.push_str(" connect_timeout=5");
    Ok(s)
}

// ---------------------------------------------------------------------------
// PostgreSQL introspection helpers
// ---------------------------------------------------------------------------

pub async fn pg_get_schemas(client: &PgClient) -> Result<Vec<SchemaInfo>, String> {
    let rows = client.query(
        "SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT LIKE 'pg_%' AND schema_name != 'information_schema' ORDER BY schema_name",
        &[],
    ).await.map_err(|e| format!("get_schemas: {}", e))?;
    Ok(rows.iter().map(|r| SchemaInfo {
        schema_name: r.get(0),
        tables_count: None,
    }).collect())
}

pub async fn pg_get_tables(client: &PgClient, schema: &str) -> Result<Vec<TableInfo>, String> {
    let rows = client.query(
        "SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = $1 ORDER BY tablename",
        &[&schema],
    ).await.map_err(|e| format!("get_tables: {}", e))?;
    let mut out = Vec::new();
    for r in &rows {
        let name: String = r.get(0);
        let count: Option<i64> = client.query_one(
            "SELECT reltuples::bigint AS cnt FROM pg_class WHERE relname = $1 AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = $2)",
            &[&name, &schema],
        ).await.ok().and_then(|cr| cr.get::<_, Option<i64>>(0));
        out.push(TableInfo { table_name: name, schema_name: schema.to_string(), table_type: "TABLE".into(), row_count: count });
    }
    Ok(out)
}

pub async fn pg_get_columns(client: &PgClient, schema: &str, table: &str) -> Result<Vec<ColumnInfo>, String> {
    let rows = client.query(
        r#"SELECT
            c.column_name, c.data_type, c.is_nullable, c.character_maximum_length,
            COALESCE(c.column_default, '') AS default_value,
            (SELECT COUNT(*) > 0 FROM information_schema.key_column_usage k
             WHERE k.table_schema = c.table_schema AND k.table_name = c.table_name
             AND k.column_name = c.column_name AND k.constraint_name LIKE '%_pkey') AS is_pk
         FROM information_schema.columns c
         WHERE c.table_schema = $1 AND c.table_name = $2
         ORDER BY c.ordinal_position"#,
        &[&schema, &table],
    ).await.map_err(|e| format!("get_columns: {}", e))?;
    Ok(rows.iter().map(|r| ColumnInfo {
        column_name: r.get(0),
        data_type: r.get(1),
        is_nullable: r.get::<_, String>(2) == "YES",
        default_value: {
            let v: String = r.get(4);
            if v.is_empty() { None } else { Some(v) }
        },
        max_length: r.get(3),
        is_primary_key: r.get::<_, bool>(5),
    }).collect())
}

pub async fn pg_get_indexes(client: &PgClient, schema: &str, table: &str) -> Result<Vec<IndexInfo>, String> {
    let rows = client.query(
        r#"SELECT
            i.relname, a.attname, ix.indisunique, ix.indisprimary,
            CASE ix.indisprimary WHEN true THEN 'primary' WHEN ix.indisunique THEN 'unique' ELSE 'index' END
         FROM pg_class t, pg_class i, pg_index ix, pg_attribute a, pg_namespace n
         WHERE t.oid = ix.indrelid AND i.oid = ix.indexrelid AND a.attrelid = t.oid
           AND a.attnum = ANY(ix.indkey) AND t.relnamespace = n.oid
           AND n.nspname = $1 AND t.relname = $2
         ORDER BY i.relname, a.attnum"#,
        &[&schema, &table],
    ).await.map_err(|e| format!("get_indexes: {}", e))?;
    Ok(rows.iter().map(|r| IndexInfo {
        index_name: r.get(0),
        column_name: r.get(1),
        is_unique: r.get(2),
        is_primary: r.get(3),
        index_type: r.get(4),
    }).collect())
}

pub async fn pg_get_constraints(client: &PgClient, schema: &str, table: &str) -> Result<Vec<ConstraintInfo>, String> {
    let rows = client.query(
        r#"SELECT
            tc.constraint_name, tc.constraint_type, kcu.column_name,
            ccu.table_schema AS f_schema, ccu.table_name AS f_table, ccu.column_name AS f_column
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
         LEFT JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
         WHERE tc.table_schema = $1 AND tc.table_name = $2
         ORDER BY tc.constraint_name"#,
        &[&schema, &table],
    ).await.map_err(|e| format!("get_constraints: {}", e))?;
    Ok(rows.iter().map(|r| ConstraintInfo {
        constraint_name: r.get(0),
        constraint_type: r.get(1),
        column_name: r.get(2),
        foreign_table_schema: r.get(3),
        foreign_table_name: r.get(4),
        foreign_column_name: r.get(5),
    }).collect())
}

pub async fn pg_get_schema_relationships(client: &PgClient, schema: &str) -> Result<Vec<RelationshipInfo>, String> {
    let rows = client.query(
        r#"SELECT
            tc.constraint_name,
            kcu.table_schema, kcu.table_name, kcu.column_name,
            ccu.table_schema AS f_schema, ccu.table_name AS f_table, ccu.column_name AS f_column
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
         JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
         WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = $1"#,
        &[&schema],
    ).await.map_err(|e| format!("get_relationships: {}", e))?;
    Ok(rows.iter().map(|r| RelationshipInfo {
        constraint_name: r.get(0),
        source_schema: r.get(1),
        source_table: r.get(2),
        source_column: r.get(3),
        target_schema: r.get(4),
        target_table: r.get(5),
        target_column: r.get(6),
    }).collect())
}

pub async fn pg_get_relationships(client: &PgClient, schema: &str, table: &str) -> Result<Vec<RelationshipInfo>, String> {
    let rows = client.query(
        r#"SELECT
            tc.constraint_name,
            kcu.table_schema, kcu.table_name, kcu.column_name,
            ccu.table_schema AS f_schema, ccu.table_name AS f_table, ccu.column_name AS f_column
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
         JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
         WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = $1 AND tc.table_name = $2"#,
        &[&schema, &table],
    ).await.map_err(|e| format!("get_relationships: {}", e))?;
    Ok(rows.iter().map(|r| RelationshipInfo {
        constraint_name: r.get(0),
        source_schema: r.get(1),
        source_table: r.get(2),
        source_column: r.get(3),
        target_schema: r.get(4),
        target_table: r.get(5),
        target_column: r.get(6),
    }).collect())
}

pub async fn pg_get_table_data(client: &PgClient, schema: &str, table: &str, page: i64, page_size: i64, sort_col: Option<&str>, sort_dir: Option<&str>) -> Result<TableDataResult, String> {
    let order = match (sort_col, sort_dir) {
        (Some(c), Some(d)) if !c.is_empty() => format!(" ORDER BY \"{}\" {}", c, if d == "desc" { "DESC" } else { "ASC" }),
        _ => " ORDER BY 1".to_string(),
    };
    let offset = (page - 1).max(0) * page_size;
    let count_q = format!("SELECT COUNT(*) FROM \"{}\".\"{}\"", schema, table);
    let total: i64 = tokio::time::timeout(std::time::Duration::from_secs(30), client.query_one(&count_q, &[]))
        .await
        .map_err(|_| "Count timed out (30s)".to_string())?
        .map_err(|e| format!("count: {}", e))?
        .get(0);
    let data_q = format!("SELECT * FROM \"{}\".\"{}\"{}{} LIMIT {} OFFSET {}", schema, table, order, if sort_col.is_some() && !sort_col.unwrap_or_default().is_empty() { "" } else { " NULLS LAST" }, page_size, offset);
    let data_rows = tokio::time::timeout(std::time::Duration::from_secs(30), client.query(&data_q, &[]))
        .await
        .map_err(|_| "Query timed out (30s)".to_string())?
        .map_err(|e| format!("data: {}", e))?;
    let cols: Vec<ColumnMeta> = data_rows.first().map(|r| {
        (0..r.len()).map(|i| ColumnMeta {
            name: r.columns()[i].name().to_string(),
            data_type: r.columns()[i].type_().name().to_string(),
        }).collect()
    }).unwrap_or_default();
    let rows: Vec<HashMap<String, serde_json::Value>> = data_rows.iter().map(|r| {
        let mut map = HashMap::new();
        for (i, col) in cols.iter().enumerate() {
            let val: serde_json::Value = if r.columns()[i].type_().name() == "int4" || r.columns()[i].type_().name() == "int8" {
                r.try_get::<_, Option<i64>>(i).ok().flatten().map(|v| serde_json::json!(v)).unwrap_or(serde_json::Value::Null)
            } else if r.columns()[i].type_().name() == "float8" || r.columns()[i].type_().name() == "float4" {
                r.try_get::<_, Option<f64>>(i).ok().flatten().map(|v| serde_json::json!(v)).unwrap_or(serde_json::Value::Null)
            } else if r.columns()[i].type_().name() == "bool" {
                r.try_get::<_, Option<bool>>(i).ok().flatten().map(|v| serde_json::json!(v)).unwrap_or(serde_json::Value::Null)
            } else if r.columns()[i].type_().name() == "numeric" || r.columns()[i].type_().name().starts_with('_') {
                r.try_get::<_, Option<String>>(i).ok().flatten().map(serde_json::Value::String).unwrap_or(serde_json::Value::Null)
            } else {
                r.try_get::<_, Option<String>>(i).ok().flatten().map(serde_json::Value::String).unwrap_or(serde_json::Value::Null)
            };
            map.insert(col.name.clone(), val);
        }
        map
    }).collect();
    Ok(TableDataResult { columns: cols, rows, total_count: total })
}

pub async fn pg_execute_query(client: &PgClient, query: &str) -> Result<QueryResult, String> {
    let start = std::time::Instant::now();
    let trimmed = query.trim().to_uppercase();
    let is_select = trimmed.starts_with("SELECT") || trimmed.starts_with("WITH") || trimmed.starts_with("EXPLAIN") || trimmed.starts_with("SHOW");

    if is_select {
        let rows = tokio::time::timeout(std::time::Duration::from_secs(30), client.query(query, &[]))
            .await
            .map_err(|_| "Query timed out (30s)".to_string())?
            .map_err(|e| format!("query: {}", e))?;
        let cols: Vec<ColumnMeta> = rows.first().map(|r| {
            (0..r.len()).map(|i| ColumnMeta {
                name: r.columns()[i].name().to_string(),
                data_type: r.columns()[i].type_().name().to_string(),
            }).collect()
        }).unwrap_or_default();
        let data: Vec<HashMap<String, serde_json::Value>> = rows.iter().map(|r| {
            let mut map = HashMap::new();
            for (i, col) in cols.iter().enumerate() {
                let val = pg_value(r, i);
                map.insert(col.name.clone(), val);
            }
            map
        }).collect();
        let elapsed = start.elapsed().as_millis() as u64;
        let row_count = data.len();
        return Ok(QueryResult { columns: cols, rows: data, row_count, affected_rows: None, is_select: true, execution_time_ms: elapsed });
    }

    let affected = tokio::time::timeout(std::time::Duration::from_secs(30), client.execute(query, &[]))
        .await
        .map_err(|_| "Query timed out (30s)".to_string())?
        .map_err(|e| format!("execute: {}", e))?;
    let elapsed = start.elapsed().as_millis() as u64;
    Ok(QueryResult { columns: vec![], rows: vec![], row_count: 0, affected_rows: Some(affected), is_select: false, execution_time_ms: elapsed })
}

pub fn pg_value(row: &tokio_postgres::Row, i: usize) -> serde_json::Value {
    let type_name = row.columns()[i].type_().name();
    if type_name == "int2" || type_name == "int4" || type_name == "int8" {
        row.try_get::<_, Option<i64>>(i).ok().flatten().map(|v| serde_json::json!(v)).unwrap_or(serde_json::Value::Null)
    } else if type_name == "float4" || type_name == "float8" {
        row.try_get::<_, Option<f64>>(i).ok().flatten().map(|v| serde_json::json!(v)).unwrap_or(serde_json::Value::Null)
    } else if type_name == "numeric" {
        row.try_get::<_, Option<String>>(i).ok().flatten().map(serde_json::Value::String).unwrap_or(serde_json::Value::Null)
    } else if type_name == "bool" {
        row.try_get::<_, Option<bool>>(i).ok().flatten().map(|v| serde_json::json!(v)).unwrap_or(serde_json::Value::Null)
    } else if type_name == "json" || type_name == "jsonb" {
        let s: Option<String> = row.try_get(i).ok().flatten();
        s.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or(serde_json::Value::Null)
    } else if type_name.starts_with('_') || type_name == "bytea" {
        serde_json::Value::Null
    } else {
        row.try_get::<_, Option<String>>(i).ok().flatten().map(serde_json::Value::String).unwrap_or(serde_json::Value::Null)
    }
}
