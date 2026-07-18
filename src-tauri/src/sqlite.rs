use rusqlite::Connection as SqliteConnection;
use std::collections::HashMap;

use crate::types::*;

pub fn sqlite_get_schemas(_conn: &SqliteConnection) -> Result<Vec<SchemaInfo>, String> {
    Ok(vec![SchemaInfo { schema_name: "main".to_string(), tables_count: None }])
}

pub fn sqlite_get_tables(conn: &SqliteConnection, _schema: &str) -> Result<Vec<TableInfo>, String> {
    let mut stmt = conn.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
        .map_err(|e| format!("sqlite tables: {}", e))?;
    let names: Vec<String> = stmt.query_map([], |r| r.get(0))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    Ok(names.into_iter().map(|n| TableInfo {
        table_name: n.clone(),
        schema_name: "main".to_string(),
        table_type: "TABLE".to_string(),
        row_count: conn.query_row(&format!("SELECT COUNT(*) FROM \"{}\"", n), [], |r| r.get(0)).ok(),
    }).collect())
}

pub fn sqlite_get_columns(conn: &SqliteConnection, _schema: &str, table: &str) -> Result<Vec<ColumnInfo>, String> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info(\"{}\")", table))
        .map_err(|e| format!("sqlite columns: {}", e))?;
    let cols: Vec<ColumnInfo> = stmt.query_map([], |r| {
        let name: String = r.get(1)?;
        let dtype: String = r.get(2)?;
        let nullable: bool = r.get::<_, i32>(3)? == 0;
        let def: Option<String> = r.get(4)?;
        let pk: bool = r.get::<_, i32>(5)? > 0;
        Ok(ColumnInfo {
            column_name: name,
            data_type: dtype,
            is_nullable: nullable,
            is_primary_key: pk,
            default_value: def.filter(|s| !s.is_empty()),
            max_length: None,
        })
    }).map_err(|e| e.to_string())?
      .filter_map(|r| r.ok())
      .collect();
    Ok(cols)
}

pub fn sqlite_get_indexes(conn: &SqliteConnection, _schema: &str, table: &str) -> Result<Vec<IndexInfo>, String> {
    let mut stmt = conn.prepare(&format!("PRAGMA index_list(\"{}\")", table))
        .map_err(|e| format!("sqlite indexes: {}", e))?;
    let idxs: Vec<(String, bool, bool)> = stmt.query_map([], |r| {
        let name: String = r.get(1)?;
        let unique: bool = r.get::<_, i32>(2)? != 0;
        let primary: bool = r.get::<_, i32>(3)? != 0;
        Ok((name, unique, primary))
    }).map_err(|e| e.to_string())?
      .filter_map(|r| r.ok())
      .collect();
    let mut out = Vec::new();
    for (name, unique, primary) in &idxs {
        let mut is = conn.prepare(&format!("PRAGMA index_info(\"{}\")", name))
            .map_err(|e| e.to_string())?;
        let cols: Vec<String> = is.query_map([], |r| r.get(2))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        for col in &cols {
            out.push(IndexInfo {
                index_name: name.clone(),
                column_name: col.clone(),
                is_unique: *unique,
                is_primary: *primary,
                index_type: if *primary { "primary".into() } else if *unique { "unique".into() } else { "index".into() },
            });
        }
    }
    Ok(out)
}

pub fn sqlite_get_constraints(conn: &SqliteConnection, _schema: &str, table: &str) -> Result<Vec<ConstraintInfo>, String> {
    let mut stmt = conn.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?1")
        .map_err(|e| e.to_string())?;
    let sql: Option<String> = stmt.query_row([&table], |r| r.get(0)).ok();
    let mut out = Vec::new();
    if let Some(sql) = sql {
        let up = sql.to_uppercase();
        if let Some(pos) = up.find("FOREIGN KEY") {
            let fk_part = &sql[pos..];
            if let Some(paren) = fk_part.find('(') {
                let after_open = &fk_part[paren + 1..];
                let col = after_open.split(')').next().unwrap_or("").trim().trim_matches('"');
                if let Some(refs) = fk_part.find("REFERENCES") {
                    let ref_part = &fk_part[refs + 10..].trim();
                    let (ftable, rest) = ref_part.split_once('(').unwrap_or((ref_part, ""));
                    let fcol = rest.split(')').next().unwrap_or("").trim().trim_matches('"');
                    out.push(ConstraintInfo {
                        constraint_name: format!("fk_{}", col),
                        constraint_type: "FOREIGN KEY".to_string(),
                        column_name: col.to_string(),
                        foreign_table_schema: Some("main".to_string()),
                        foreign_table_name: Some(ftable.trim().trim_matches('"').to_string()),
                        foreign_column_name: Some(fcol.to_string()),
                    });
                }
            }
        }
    }
    Ok(out)
}

pub fn sqlite_get_schema_relationships(_conn: &SqliteConnection, _schema: &str) -> Result<Vec<RelationshipInfo>, String> {
    Ok(Vec::new())
}

pub fn sqlite_get_relationships(conn: &SqliteConnection, _schema: &str, table: &str) -> Result<Vec<RelationshipInfo>, String> {
    let constraints = sqlite_get_constraints(conn, _schema, table)?;
    Ok(constraints.into_iter().filter(|c| c.constraint_type == "FOREIGN KEY").map(|c| RelationshipInfo {
        constraint_name: c.constraint_name,
        source_schema: _schema.to_string(),
        source_table: table.to_string(),
        source_column: c.column_name,
        target_schema: c.foreign_table_schema.clone().unwrap_or_default(),
        target_table: c.foreign_table_name.clone().unwrap_or_default(),
        target_column: c.foreign_column_name.clone().unwrap_or_default(),
    }).collect())
}

pub fn sqlite_get_table_data(conn: &SqliteConnection, _schema: &str, table: &str, page: i64, page_size: i64, sort_col: Option<&str>, sort_dir: Option<&str>) -> Result<TableDataResult, String> {
    let order = match (sort_col, sort_dir) {
        (Some(c), Some(d)) if !c.is_empty() => format!(" ORDER BY \"{}\" {}", c, if d == "desc" { "DESC" } else { "ASC" }),
        _ => " ORDER BY 1".to_string(),
    };
    let offset = (page - 1).max(0) * page_size;
    let total: i64 = conn.query_row(&format!("SELECT COUNT(*) FROM \"{}\"", table), [], |r| r.get(0))
        .map_err(|e| format!("count: {}", e))?;
    let data_q = format!("SELECT * FROM \"{}\"{}{} LIMIT {} OFFSET {}", table, order, if sort_col.is_some() && !sort_col.unwrap_or_default().is_empty() { "" } else { "" }, page_size, offset);
    let mut stmt = conn.prepare(&data_q).map_err(|e| format!("prepare: {}", e))?;
    let col_count = stmt.column_count();
    let col_names: Vec<String> = (0..col_count).map(|i| stmt.column_name(i).unwrap_or("?").to_string()).collect();
    let cols: Vec<ColumnMeta> = col_names.iter().map(|n| ColumnMeta { name: n.clone(), data_type: "TEXT".into() }).collect();
    let data: Vec<HashMap<String, serde_json::Value>> = stmt.query_map([], |row| {
        let mut map = HashMap::new();
        for (i, name) in col_names.iter().enumerate() {
            let val: serde_json::Value = match row.get::<_, rusqlite::types::Value>(i) {
                Ok(rusqlite::types::Value::Null) => serde_json::Value::Null,
                Ok(rusqlite::types::Value::Integer(i)) => serde_json::json!(i),
                Ok(rusqlite::types::Value::Real(f)) => serde_json::json!(f),
                Ok(rusqlite::types::Value::Text(s)) => serde_json::Value::String(s),
                Ok(rusqlite::types::Value::Blob(b)) => serde_json::Value::String(format!("<blob {} bytes>", b.len())),
                Err(_) => serde_json::Value::Null,
            };
            map.insert(name.clone(), val);
        }
        Ok(map)
    }).map_err(|e| format!("query: {}", e))?
      .filter_map(|r| r.ok())
      .collect();
    Ok(TableDataResult { columns: cols, rows: data, total_count: total })
}

pub fn sqlite_execute_query(conn: &SqliteConnection, query: &str) -> Result<QueryResult, String> {
    let start = std::time::Instant::now();
    let trimmed = query.trim().to_uppercase();
    let is_select = trimmed.starts_with("SELECT") || trimmed.starts_with("WITH") || trimmed.starts_with("EXPLAIN") || trimmed.starts_with("SHOW") || trimmed.starts_with("PRAGMA");

    if is_select {
        let mut stmt = conn.prepare(query).map_err(|e| format!("prepare: {}", e))?;
        let col_count = stmt.column_count();
        let col_names: Vec<String> = (0..col_count).map(|i| stmt.column_name(i).unwrap_or("?").to_string()).collect();
        let cols: Vec<ColumnMeta> = col_names.iter().map(|n| ColumnMeta { name: n.clone(), data_type: "TEXT".into() }).collect();
        let data: Vec<HashMap<String, serde_json::Value>> = stmt.query_map([], |row| {
            let mut map = HashMap::new();
            for (i, name) in col_names.iter().enumerate() {
                let val: serde_json::Value = match row.get::<_, rusqlite::types::Value>(i) {
                    Ok(rusqlite::types::Value::Null) => serde_json::Value::Null,
                    Ok(rusqlite::types::Value::Integer(i)) => serde_json::json!(i),
                    Ok(rusqlite::types::Value::Real(f)) => serde_json::json!(f),
                    Ok(rusqlite::types::Value::Text(s)) => serde_json::Value::String(s),
                    Ok(rusqlite::types::Value::Blob(b)) => serde_json::Value::String(format!("<blob {} bytes>", b.len())),
                    Err(_) => serde_json::Value::Null,
                };
                map.insert(name.clone(), val);
            }
            Ok(map)
        }).map_err(|e| format!("query: {}", e))?
          .filter_map(|r| r.ok())
          .collect();
        let elapsed = start.elapsed().as_millis() as u64;
        let row_count = data.len();
        return Ok(QueryResult { columns: cols, rows: data, row_count, affected_rows: None, is_select: true, execution_time_ms: elapsed });
    }
    let affected = conn.execute(query, []).map_err(|e| format!("execute: {}", e))?;
    let elapsed = start.elapsed().as_millis() as u64;
    Ok(QueryResult { columns: vec![], rows: vec![], row_count: 0, affected_rows: Some(affected as u64), is_select: false, execution_time_ms: elapsed })
}
