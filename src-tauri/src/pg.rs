use crate::types::*;
use std::collections::HashMap;
use std::future::Future;
use std::io;
use std::pin::Pin;
use std::task::{Context, Poll};
use postgres_native_tls::MakeTlsConnector;
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};
use tokio_postgres::tls::{
    ChannelBinding, MakeTlsConnect, NoTls, NoTlsError, NoTlsFuture, NoTlsStream, TlsConnect,
};
use tokio_postgres::Socket;
use tokio_postgres::Client as PgClient;
use tokio_postgres::types::ToSql;

// ---------------------------------------------------------------------------
// Parse connection URL -> conn string parts
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UrlParts {
    pub host: String,
    pub port: String,
    pub db: String,
    pub user: String,
    pub password: String,
    pub sslmode: String,
    pub ssl_root_cert: String,
}

pub fn parse_pg_url(url: &str) -> Result<UrlParts, String> {
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
    let (no_qs, query) = match hostpart.split_once('?') {
        Some((h, q)) => (h, q),
        None => (hostpart, ""),
    };

    let mut sslmode = "prefer".to_string();
    let mut ssl_root_cert = String::new();
    for param in query.split('&').filter(|p| !p.is_empty()) {
        let (key, value) = param.split_once('=').unwrap_or((param, ""));
        match key {
            "sslmode" => sslmode = urlencoding_or_raw(value),
            "sslrootcert" => ssl_root_cert = urlencoding_or_raw(value),
            _ => {}
        }
    }

    let (h, p, d) = if no_qs.starts_with('[') {
        let (host, after_bracket) = match no_qs.find(']') {
            Some(close) => (&no_qs[..=close], &no_qs[close + 1..]),
            None => (no_qs, ""),
        };
        let (port, db) = match after_bracket.split_once('/') {
            Some((p, d)) => (port_of(p), d),
            None => (port_of(after_bracket), ""),
        };
        (host, port, db)
    } else if let Some(slash) = no_qs.find('/') {
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
    Ok(UrlParts {
        host: urlencoding_or_raw(h),
        port: p,
        db: urlencoding_or_raw(d),
        user,
        password: pass,
        sslmode,
        ssl_root_cert,
    })
}

fn port_of(s: &str) -> String {
    s.strip_prefix(':').filter(|p| !p.is_empty()).unwrap_or("5432").to_string()
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
    let parts = parse_pg_url(url)?;
    let mut s = format!("host={} port={} dbname={}", parts.host, parts.port, parts.db);
    if !parts.user.is_empty() {
        s.push_str(&format!(" user={}", parts.user));
    }
    if !parts.password.is_empty() {
        s.push_str(&format!(" password={}", parts.password));
    }
    s.push_str(&format!(" sslmode={}", normalize_conn_sslmode(&parts.sslmode)));
    s.push_str(" connect_timeout=5");
    Ok(s)
}

/// Map a parsed sslmode to a value tokio-postgres's `Config` parser accepts.
///
/// tokio-postgres 0.7 only understands `disable`/`prefer`/`require`. The
/// `verify-ca`/`verify-full` policies are enforced by the `native_tls`
/// connector built in `build_tls` (which keeps certificate verification on for
/// those modes), so the conn string can safely carry `require`.
fn normalize_conn_sslmode(sslmode: &str) -> &str {
    match sslmode {
        "verify-ca" | "verify-full" => "require",
        other => other,
    }
}

// ---------------------------------------------------------------------------
// TLS connector selection
// ---------------------------------------------------------------------------

/// A concrete, `Clone`able TLS connector selected from a URL's `sslmode`.
///
/// `tokio_postgres::connect` needs a `MakeTlsConnect<Socket>`. `NoTls` and
/// `postgres_native_tls::MakeTlsConnector` both implement it and are `Clone`,
/// so we wrap them in an enum (a `Box<dyn MakeTlsConnect>` would not be
/// `Clone`, which deadpool-postgres's `Manager` requires).
#[derive(Clone)]
pub enum PgTls {
    None(NoTls),
    Native(MakeTlsConnector),
}

/// Build the TLS connector implied by a URL's `sslmode`.
///
/// - `disable` -> no TLS (plain TCP).
/// - `require`/`prefer` -> native TLS accepting any server certificate
///   (including self-signed), mirroring tokio-postgres's "require does no
///   certificate verification" semantics.
/// - `verify-ca`/`verify-full` -> native TLS with certificate verification on
///   (the OS trust store, SChannel on Windows).
pub fn build_tls(sslmode: &str) -> Result<PgTls, String> {
    match sslmode {
        "disable" => Ok(PgTls::None(NoTls)),
        "require" | "prefer" => {
            let connector = native_tls::TlsConnector::builder()
                .danger_accept_invalid_certs(true)
                .build()
                .map_err(|e| format!("Failed to build TLS connector: {}", e))?;
            Ok(PgTls::Native(MakeTlsConnector::new(connector)))
        }
        "verify-ca" | "verify-full" => {
            let connector = native_tls::TlsConnector::builder()
                .build()
                .map_err(|e| format!("Failed to build TLS connector: {}", e))?;
            Ok(PgTls::Native(MakeTlsConnector::new(connector)))
        }
        other => Err(format!("Unsupported sslmode: {}", other)),
    }
}

/// Error unifying `NoTls`'s and `native_tls`'s error types.
#[derive(Debug)]
pub enum PgTlsError {
    None(NoTlsError),
    Native(native_tls::Error),
}

impl std::fmt::Display for PgTlsError {
    fn fmt(&self, fmt: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PgTlsError::None(e) => e.fmt(fmt),
            PgTlsError::Native(e) => e.fmt(fmt),
        }
    }
}

impl std::error::Error for PgTlsError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            PgTlsError::None(e) => Some(e),
            PgTlsError::Native(e) => Some(e),
        }
    }
}

impl From<NoTlsError> for PgTlsError {
    fn from(e: NoTlsError) -> PgTlsError {
        PgTlsError::None(e)
    }
}

impl From<native_tls::Error> for PgTlsError {
    fn from(e: native_tls::Error) -> PgTlsError {
        PgTlsError::Native(e)
    }
}

/// The TLS stream produced by `PgTls`, mirroring the inner connector's stream.
pub enum PgTlsStream {
    None(NoTlsStream),
    Native(postgres_native_tls::TlsStream<Socket>),
}

impl AsyncRead for PgTlsStream {
    fn poll_read(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        match self.get_mut() {
            PgTlsStream::None(s) => Pin::new(s).poll_read(cx, buf),
            PgTlsStream::Native(s) => Pin::new(s).poll_read(cx, buf),
        }
    }
}

impl AsyncWrite for PgTlsStream {
    fn poll_write(self: Pin<&mut Self>, cx: &mut Context<'_>, buf: &[u8]) -> Poll<io::Result<usize>> {
        match self.get_mut() {
            PgTlsStream::None(s) => Pin::new(s).poll_write(cx, buf),
            PgTlsStream::Native(s) => Pin::new(s).poll_write(cx, buf),
        }
    }

    fn poll_flush(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        match self.get_mut() {
            PgTlsStream::None(s) => Pin::new(s).poll_flush(cx),
            PgTlsStream::Native(s) => Pin::new(s).poll_flush(cx),
        }
    }

    fn poll_shutdown(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        match self.get_mut() {
            PgTlsStream::None(s) => Pin::new(s).poll_shutdown(cx),
            PgTlsStream::Native(s) => Pin::new(s).poll_shutdown(cx),
        }
    }
}

impl tokio_postgres::tls::TlsStream for PgTlsStream {
    fn channel_binding(&self) -> ChannelBinding {
        match self {
            PgTlsStream::None(s) => s.channel_binding(),
            PgTlsStream::Native(s) => s.channel_binding(),
        }
    }
}

/// A `TlsConnect` for the concrete variant produced by `PgTls`.
pub enum PgTlsConnect {
    None(NoTls),
    Native(postgres_native_tls::TlsConnector),
}

/// The handshake future returned by `PgTlsConnect::connect`.
pub enum PgTlsFuture {
    None(NoTlsFuture),
    Native(
        Pin<Box<dyn Future<Output = Result<postgres_native_tls::TlsStream<Socket>, native_tls::Error>> + Send>>,
    ),
}

impl Future for PgTlsFuture {
    type Output = Result<PgTlsStream, PgTlsError>;

    fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Self::Output> {
        match self.get_mut() {
            PgTlsFuture::None(f) => Pin::new(f)
                .poll(cx)
                .map(|r| r.map(PgTlsStream::None).map_err(PgTlsError::None)),
            PgTlsFuture::Native(f) => f
                .as_mut()
                .poll(cx)
                .map(|r| r.map(PgTlsStream::Native).map_err(PgTlsError::Native)),
        }
    }
}

impl TlsConnect<Socket> for PgTlsConnect {
    type Stream = PgTlsStream;
    type Error = PgTlsError;
    type Future = PgTlsFuture;

    fn connect(self, stream: Socket) -> Self::Future {
        match self {
            PgTlsConnect::None(tls) => PgTlsFuture::None(tls.connect(stream)),
            PgTlsConnect::Native(tls) => PgTlsFuture::Native(tls.connect(stream)),
        }
    }
}

impl MakeTlsConnect<Socket> for PgTls {
    type Stream = PgTlsStream;
    type TlsConnect = PgTlsConnect;
    type Error = PgTlsError;

    fn make_tls_connect(&mut self, domain: &str) -> Result<Self::TlsConnect, Self::Error> {
        match self {
            PgTls::None(tls) => {
                let inner = MakeTlsConnect::<Socket>::make_tls_connect(tls, domain)?;
                Ok(PgTlsConnect::None(inner))
            }
            PgTls::Native(tls) => {
                let inner = MakeTlsConnect::<Socket>::make_tls_connect(tls, domain)?;
                Ok(PgTlsConnect::Native(inner))
            }
        }
    }
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
            let val = pg_value(r, i);
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
    match type_name {
        "int2" => row.try_get::<_, Option<i16>>(i).ok().flatten().map(serde_json::Value::from).unwrap_or(serde_json::Value::Null),
        "int4" => row.try_get::<_, Option<i32>>(i).ok().flatten().map(serde_json::Value::from).unwrap_or(serde_json::Value::Null),
        "int8" => row.try_get::<_, Option<i64>>(i).ok().flatten().map(serde_json::Value::from).unwrap_or(serde_json::Value::Null),
        "float4" => row.try_get::<_, Option<f32>>(i).ok().flatten().map(serde_json::Value::from).unwrap_or(serde_json::Value::Null),
        "float8" => row.try_get::<_, Option<f64>>(i).ok().flatten().map(serde_json::Value::from).unwrap_or(serde_json::Value::Null),
        "bool" => row.try_get::<_, Option<bool>>(i).ok().flatten().map(serde_json::Value::from).unwrap_or(serde_json::Value::Null),
        "numeric" => row.try_get::<_, Option<Vec<u8>>>(i).ok().flatten()
            .and_then(|b| numeric_bytes_to_string(&b).ok())
            .map(serde_json::Value::String)
            .unwrap_or(serde_json::Value::Null),
        "json" | "jsonb" => row.try_get::<_, Option<serde_json::Value>>(i).ok().flatten().unwrap_or(serde_json::Value::Null),
        "bytea" => match row.try_get::<_, Option<Vec<u8>>>(i) {
            Ok(Some(bytes)) => serde_json::Value::String(format!("\\x{}", bytes_to_hex(&bytes))),
            _ => serde_json::Value::Null,
        },
        "date" => row.try_get::<_, Option<chrono::NaiveDate>>(i).ok().flatten().map(|d| serde_json::Value::String(d.to_string())).unwrap_or(serde_json::Value::Null),
        "time" => row.try_get::<_, Option<chrono::NaiveTime>>(i).ok().flatten().map(|t| serde_json::Value::String(t.to_string())).unwrap_or(serde_json::Value::Null),
        "timestamp" => row.try_get::<_, Option<chrono::NaiveDateTime>>(i).ok().flatten().map(|d| serde_json::Value::String(d.to_string())).unwrap_or(serde_json::Value::Null),
        "timestamptz" => row.try_get::<_, Option<chrono::DateTime<chrono::Utc>>>(i).ok().flatten().map(|d| serde_json::Value::String(d.to_rfc3339())).unwrap_or(serde_json::Value::Null),
        name if name.starts_with('_') => pg_array_value(row, i, name),
        _ => row.try_get::<_, Option<String>>(i).ok().flatten().map(serde_json::Value::String).unwrap_or(serde_json::Value::Null),
    }
}

/// Render a 1-D Postgres array column as a JSON array of its element values.
///
/// The element type drives which `FromSql` impl is used; there is no universal
/// array decoder. Element types without a matching `FromSql` decode as `Null`.
fn pg_array_value(row: &tokio_postgres::Row, i: usize, type_name: &str) -> serde_json::Value {
    let elem = &type_name[1..];
    let collect = |vals: Vec<Option<serde_json::Value>>| {
        serde_json::Value::Array(vals.into_iter().map(|v| v.unwrap_or(serde_json::Value::Null)).collect())
    };
    match elem {
        "int2" => row.try_get::<_, Option<Vec<Option<i16>>>>(i).ok().flatten()
            .map(|v| collect(v.into_iter().map(|x| x.map(serde_json::Value::from)).collect()))
            .unwrap_or(serde_json::Value::Null),
        "int4" => row.try_get::<_, Option<Vec<Option<i32>>>>(i).ok().flatten()
            .map(|v| collect(v.into_iter().map(|x| x.map(serde_json::Value::from)).collect()))
            .unwrap_or(serde_json::Value::Null),
        "int8" => row.try_get::<_, Option<Vec<Option<i64>>>>(i).ok().flatten()
            .map(|v| collect(v.into_iter().map(|x| x.map(serde_json::Value::from)).collect()))
            .unwrap_or(serde_json::Value::Null),
        "float4" => row.try_get::<_, Option<Vec<Option<f32>>>>(i).ok().flatten()
            .map(|v| collect(v.into_iter().map(|x| x.map(serde_json::Value::from)).collect()))
            .unwrap_or(serde_json::Value::Null),
        "float8" => row.try_get::<_, Option<Vec<Option<f64>>>>(i).ok().flatten()
            .map(|v| collect(v.into_iter().map(|x| x.map(serde_json::Value::from)).collect()))
            .unwrap_or(serde_json::Value::Null),
        "bool" => row.try_get::<_, Option<Vec<Option<bool>>>>(i).ok().flatten()
            .map(|v| collect(v.into_iter().map(|x| x.map(serde_json::Value::from)).collect()))
            .unwrap_or(serde_json::Value::Null),
        "json" | "jsonb" => row.try_get::<_, Option<Vec<Option<serde_json::Value>>>>(i).ok().flatten()
            .map(collect)
            .unwrap_or(serde_json::Value::Null),
        "bytea" => row.try_get::<_, Option<Vec<Option<Vec<u8>>>>>(i).ok().flatten()
            .map(|v| collect(v.into_iter().map(|x| x.map(|b| serde_json::Value::String(format!("\\x{}", bytes_to_hex(&b))))).collect()))
            .unwrap_or(serde_json::Value::Null),
        "numeric" => row.try_get::<_, Option<Vec<Option<Vec<u8>>>>>(i).ok().flatten()
            .map(|v| collect(v.into_iter().map(|x| x.and_then(|b| numeric_bytes_to_string(&b).ok()).map(serde_json::Value::String)).collect()))
            .unwrap_or(serde_json::Value::Null),
        _ => row.try_get::<_, Option<Vec<Option<String>>>>(i).ok().flatten()
            .map(|v| collect(v.into_iter().map(|x| x.map(serde_json::Value::String)).collect()))
            .unwrap_or(serde_json::Value::Null),
    }
}

/// Decode a Postgres `NUMERIC` value from its binary wire format into a decimal
/// string. Wire layout (network byte order, as written by PostgreSQL's
/// `numeric_send`): `int16 ndigits; int16 weight; int16 sign; int16 dscale;
/// int16 digits[ndigits]`. Sign: `0x0000` positive, `0x4000` negative,
/// `0xC000` NaN, `0xD000` +Infinity, `0xF000` -Infinity. Each base-10000 digit
/// group holds four decimal digits.
pub fn numeric_bytes_to_string(b: &[u8]) -> Result<String, ()> {
    if b.len() < 8 {
        return Err(());
    }
    let rd_u16 = |off: usize| u16::from_be_bytes([b[off], b[off + 1]]);
    let rd_i16 = |off: usize| i16::from_be_bytes([b[off], b[off + 1]]);
    let ndigits = rd_u16(0) as usize;
    let weight = rd_i16(2);
    let sign = rd_u16(4);
    let dscale = rd_u16(6) as usize;
    if b.len() < 8 + ndigits * 2 {
        return Err(());
    }
    let digits: Vec<u16> = (0..ndigits).map(|i| rd_u16(8 + i * 2)).collect();
    let negative = match sign {
        0x0000 => false,
        0x4000 => true,
        0xC000 => return Ok("NaN".to_string()),
        0xD000 => return Ok("Infinity".to_string()),
        0xF000 => return Ok("-Infinity".to_string()),
        _ => return Err(()),
    };
    if ndigits == 0 {
        return Ok("0".to_string());
    }
    // Number of base-10000 digit groups left of the decimal point = weight + 1.
    let ipos = weight as i32 + 1;
    let mut int_str = String::new();
    let mut frac_digits = String::new();
    if ipos > 0 {
        let mut idx = 0usize;
        let mut remaining = ipos as usize;
        while idx < ndigits && remaining > 0 {
            if idx == 0 {
                int_str.push_str(&digits[idx].to_string());
            } else {
                int_str.push_str(&format!("{:04}", digits[idx]));
            }
            idx += 1;
            remaining -= 1;
        }
        while remaining > 0 {
            int_str.push_str("0000");
            remaining -= 1;
        }
        while idx < ndigits {
            frac_digits.push_str(&format!("{:04}", digits[idx]));
            idx += 1;
        }
    } else {
        int_str.push('0');
        for _ in 0..(-ipos) as usize {
            frac_digits.push_str("0000");
        }
        for d in &digits {
            frac_digits.push_str(&format!("{:04}", d));
        }
    }
    if dscale > 0 {
        if frac_digits.len() > dscale {
            frac_digits.truncate(dscale);
        }
        while frac_digits.len() < dscale {
            frac_digits.push('0');
        }
    }
    let mut out = int_str;
    if dscale > 0 {
        out.push('.');
        out.push_str(&frac_digits);
    }
    if negative && out != "0" {
        out.insert(0, '-');
    }
    Ok(out)
}

/// Format raw bytes as Postgres's `\x…` hex representation.
fn bytes_to_hex(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        out.push_str(&format!("{:02x}", b));
    }
    out
}

pub fn json_to_tosql(v: &serde_json::Value) -> Box<dyn ToSql + Send + Sync> {
    match v {
        serde_json::Value::Null => Box::new(Option::<String>::None),
        serde_json::Value::Bool(b) => Box::new(*b),
        serde_json::Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                Box::new(i)
            } else if let Some(f) = n.as_f64() {
                Box::new(f)
            } else {
                Box::new(n.to_string())
            }
        }
        serde_json::Value::String(s) => Box::new(s.clone()),
        serde_json::Value::Array(_) | serde_json::Value::Object(_) => Box::new(v.to_string()),
    }
}

/// Parse one Postgres array literal (e.g. `{1,2,3}` or `{{"a"},{"b"}}`) into a
/// JSON array. Quoted elements unescape `""`; `NULL` becomes JSON null; bare
/// integers/floats become JSON numbers; anything else is kept as a string.
pub fn format_array_literal(s: &str) -> serde_json::Value {
    let mut pos = 0usize;
    parse_array_literal(s, &mut pos)
}

fn parse_array_literal(s: &str, pos: &mut usize) -> serde_json::Value {
    let bytes = s.as_bytes();
    if bytes.get(*pos) != Some(&b'{') {
        return serde_json::Value::Null;
    }
    *pos += 1;
    let mut items = Vec::new();
    loop {
        skip_literal_ws(s, pos);
        if bytes.get(*pos) != Some(&b'}') {
            items.push(parse_literal_element(s, pos));
            skip_literal_ws(s, pos);
        }
        match bytes.get(*pos) {
            Some(&b',') => *pos += 1,
            Some(&b'}') => {
                *pos += 1;
                break;
            }
            _ => return serde_json::Value::Null,
        }
    }
    serde_json::Value::Array(items)
}

fn parse_literal_element(s: &str, pos: &mut usize) -> serde_json::Value {
    let bytes = s.as_bytes();
    skip_literal_ws(s, pos);
    match bytes.get(*pos) {
        Some(&b'{') => parse_array_literal(s, pos),
        Some(&b'"') => {
            *pos += 1;
            let mut out = Vec::new();
            loop {
                match bytes.get(*pos) {
                    Some(&b'"') if bytes.get(*pos + 1) == Some(&b'"') => {
                        out.push(b'"');
                        *pos += 2;
                    }
                    Some(&b'"') => {
                        *pos += 1;
                        break;
                    }
                    Some(&c) => {
                        out.push(c);
                        *pos += 1;
                    }
                    None => break,
                }
            }
            serde_json::Value::String(String::from_utf8(out).expect("quoted array literal is valid UTF-8"))
        }
        _ => {
            let start = *pos;
            while let Some(&c) = bytes.get(*pos) {
                if c == b',' || c == b'}' {
                    break;
                }
                *pos += 1;
            }
            let token = s[start..*pos].trim();
            if token.is_empty() || token.eq_ignore_ascii_case("null") {
                return serde_json::Value::Null;
            }
            if let Ok(i) = token.parse::<i64>() {
                return serde_json::json!(i);
            }
            if let Ok(f) = token.parse::<f64>() {
                return serde_json::json!(f);
            }
            serde_json::Value::String(token.to_string())
        }
    }
}

fn skip_literal_ws(s: &str, pos: &mut usize) {
    while let Some(c) = s[*pos..].chars().next() {
        if c.is_whitespace() {
            *pos += c.len_utf8();
        } else {
            break;
        }
    }
}

pub async fn pg_execute_query_params(client: &PgClient, query: &str, params: &[serde_json::Value]) -> Result<QueryResult, String> {
    let start = std::time::Instant::now();
    let trimmed = query.trim().to_uppercase();
    let is_select = trimmed.starts_with("SELECT") || trimmed.starts_with("WITH") || trimmed.starts_with("EXPLAIN") || trimmed.starts_with("SHOW");

    let bindings: Vec<Box<dyn ToSql + Send + Sync>> = params.iter().map(json_to_tosql).collect();
    let bind_refs: Vec<&(dyn ToSql + Sync)> = bindings.iter().map(|b| b.as_ref() as &(dyn ToSql + Sync)).collect();

    if is_select {
        let rows = tokio::time::timeout(std::time::Duration::from_secs(30), client.query(query, &bind_refs))
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

    let affected = tokio::time::timeout(std::time::Duration::from_secs(30), client.execute(query, &bind_refs))
        .await
        .map_err(|_| "Query timed out (30s)".to_string())?
        .map_err(|e| format!("execute: {}", e))?;
    let elapsed = start.elapsed().as_millis() as u64;
    Ok(QueryResult { columns: vec![], rows: vec![], row_count: 0, affected_rows: Some(affected), is_select: false, execution_time_ms: elapsed })
}

pub async fn pg_get_enum_values(client: &PgClient, type_name: &str) -> Result<Vec<String>, String> {
    let rows = client
        .query(
            "SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid WHERE t.typname = $1 ORDER BY e.enumsortorder",
            &[&type_name],
        )
        .await
        .map_err(|e| format!("enum query: {}", e))?;
    Ok(rows.iter().map(|r| r.get::<_, String>(0)).collect())
}
