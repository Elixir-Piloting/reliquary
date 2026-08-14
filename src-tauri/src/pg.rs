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
use tokio_postgres::types::{FromSql, IsNull, ToSql, Type};

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
            "sslmode" => {
                let v = urlencoding_or_raw(value);
                sslmode = if v.is_empty() { "prefer".to_string() } else { v };
            }
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
    let mut s = format!(
        "host={} port={} dbname={}",
        connstr_value(&parts.host),
        connstr_value(&parts.port),
        connstr_value(&parts.db)
    );
    if !parts.user.is_empty() {
        s.push_str(&format!(" user={}", connstr_value(&parts.user)));
    }
    if !parts.password.is_empty() {
        s.push_str(&format!(" password={}", connstr_value(&parts.password)));
    }
    s.push_str(&format!(" sslmode={}", normalize_conn_sslmode(&parts.sslmode)));
    s.push_str(" connect_timeout=5");
    Ok(s)
}

/// Quote a conn string value the way `tokio_postgres::Config`'s parser
/// expects: a value containing a quote, whitespace or `=` must be
/// single-quoted, with embedded quotes and backslashes backslash-escaped.
/// Unquoted values would otherwise break the `key=value` tokenizer (e.g. a
/// URL-decoded password with a space).
fn connstr_value(v: &str) -> String {
    if v.contains('\'') || v.contains('=') || v.chars().any(|c| c.is_whitespace()) {
        let escaped = v.replace('\\', "\\\\").replace('\'', "\\'");
        format!("'{}'", escaped)
    } else {
        v.to_string()
    }
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
/// - empty/omitted -> treated as `prefer` (libpq's default), so a URL with a
///   bare `?sslmode=` doesn't hard-fail the connection.
pub fn build_tls(sslmode: &str) -> Result<PgTls, String> {
    let mode = if sslmode.is_empty() { "prefer" } else { sslmode };
    match mode {
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

/// Single query for the table/view/materialized-view/partitioned-table list in a
/// schema. `reltuples` is a planner estimate (fine for a count badge; the real
/// `COUNT(*)` lives in `pg_get_table_data`). `relrowsecurity` marks RLS-enabled
/// relations. One round trip — no per-row N+1.
const TABLE_LIST_SQL: &str =
    "SELECT c.relname AS table_name, \
     n.nspname AS schema_name, \
     c.relkind::text AS table_type, \
     GREATEST(c.reltuples::bigint, 0) AS row_count, \
     c.relrowsecurity AS has_rls \
     FROM pg_class c \
     JOIN pg_namespace n ON n.oid = c.relnamespace \
     WHERE n.nspname = $1 \
       AND c.relkind IN ('r','v','m','p') \
     ORDER BY c.relname";

fn relkind_label(relkind: &str) -> &'static str {
    match relkind {
        "r" => "TABLE",
        "v" => "VIEW",
        "m" => "MATERIALIZED VIEW",
        "p" => "PARTITIONED TABLE",
        _ => "TABLE",
    }
}

pub async fn pg_get_tables(client: &PgClient, schema: &str) -> Result<Vec<TableInfo>, String> {
    let rows = client.query(TABLE_LIST_SQL, &[&schema])
        .await.map_err(|e| format!("get_tables: {}", e))?;
    Ok(rows.iter().map(|r| TableInfo {
        table_name: r.get(0),
        schema_name: r.get(1),
        table_type: relkind_label(&r.get::<_, String>(2)).to_string(),
        row_count: r.get(3),
        has_rls: Some(r.get(4)),
    }).collect())
}

/// Column list for one table. `data_type` strips the type-modifier suffix
/// (`character varying(255)` -> `character varying`) so the frontend's exact
/// membership match against bare built-in type names keeps working. PK via
/// `pg_index.indisprimary`; `max_length` is only meaningful for char/varchar
/// (OIDs 18 bpchar, 1042 bpchar, 1043 varchar).
const COLUMN_LIST_SQL: &str =
    "SELECT a.attname AS column_name, \
            CASE WHEN position('(' in format_type(a.atttypid, a.atttypmod)) > 0 \
                 THEN left(format_type(a.atttypid, a.atttypmod), position('(' in format_type(a.atttypid, a.atttypmod)) - 1) \
                 ELSE format_type(a.atttypid, a.atttypmod) END AS data_type, \
            NOT a.attnotnull AS is_nullable, \
            COALESCE((SELECT true FROM pg_index i \
                      WHERE i.indrelid = a.attrelid AND i.indisprimary AND a.attnum = ANY(i.indkey)), false) AS is_primary_key, \
            pg_get_expr(d.adbin, d.adrelid) AS default_value, \
            CASE WHEN a.atttypid IN (18, 1042, 1043) AND a.atttypmod > 4 THEN a.atttypmod - 4 ELSE NULL END AS max_length \
     FROM pg_attribute a \
     LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum \
     WHERE a.attrelid = (SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace \
                         WHERE c.relname = $2 AND n.nspname = $1) \
       AND a.attnum > 0 AND NOT a.attisdropped \
     ORDER BY a.attnum";

pub async fn pg_get_columns(client: &PgClient, schema: &str, table: &str) -> Result<Vec<ColumnInfo>, String> {
    let rows = client.query(COLUMN_LIST_SQL, &[&schema, &table])
        .await.map_err(|e| format!("get_columns: {}", e))?;
    Ok(rows.iter().map(|r| ColumnInfo {
        column_name: r.get(0),
        data_type: r.get(1),
        is_nullable: r.get(2),
        is_primary_key: r.get(3),
        default_value: r.get::<_, Option<String>>(4),
        max_length: r.get(5),
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

pub async fn pg_get_views(client: &PgClient, schema: &str) -> Result<Vec<ViewInfo>, String> {
    let rows = client.query(
        r#"SELECT v.viewname AS view_name, pg_get_viewdef(c.oid, true) AS definition
           FROM pg_views v
           JOIN pg_class c
             ON c.relname = v.viewname
            AND c.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = v.schemaname)
           WHERE v.schemaname = $1
           ORDER BY v.viewname"#,
        &[&schema],
    ).await.map_err(|e| format!("get_views: {}", e))?;
    Ok(rows.iter().map(|r| ViewInfo {
        view_name: r.get(0),
        definition: r.get(1),
    }).collect())
}

/// Trigger list for one table, joining `information_schema.triggers` (metadata)
/// to `pg_trigger.tgenabled` (actual enable state — the info-schema view has no
/// enable column). `tgenabled`: 'O'/'R'/'A' = enabled, 'D' = disabled.
const TRIGGER_LIST_SQL: &str =
    "SELECT t.trigger_name, \
            t.event_manipulation, \
            t.action_timing, \
            t.action_statement, \
            pt.tgenabled <> 'D' AS enabled \
     FROM information_schema.triggers t \
     JOIN pg_trigger pt ON pt.tgname = t.trigger_name \
     JOIN pg_class c ON c.oid = pt.tgrelid \
     JOIN pg_namespace n ON n.oid = c.relnamespace \
     WHERE n.nspname = $1 AND c.relname = $2 \
       AND t.event_object_schema = n.nspname \
       AND t.event_object_table = c.relname \
     ORDER BY t.trigger_name";

pub async fn pg_get_triggers(client: &PgClient, schema: &str, table: &str) -> Result<Vec<TriggerInfo>, String> {
    let rows = client.query(TRIGGER_LIST_SQL, &[&schema, &table])
        .await.map_err(|e| format!("get_triggers: {}", e))?;
    Ok(rows.iter().map(|r| TriggerInfo {
        trigger_name: r.get(0),
        event_manipulation: r.get(1),
        action_timing: r.get(2),
        action_statement: r.get(3),
        enabled: r.get(4),
    }).collect())
}

fn volatility_label(volatility: &str) -> &'static str {
    match volatility {
        "i" => "IMMUTABLE",
        "s" => "STABLE",
        _ => "VOLATILE",
    }
}

/// Function list for one schema. `prokind = 'f'` keeps only real functions —
/// procedures ('p') and aggregates ('a') have a NULL `pg_get_function_result`,
/// which would otherwise panic a bare String read. `provolatile` is a char code
/// ('i'/'s'/'v') mapped to a friendly label in `volatility_label`.
const FUNCTION_LIST_SQL: &str =
    "SELECT p.proname, \
            pg_get_function_identity_arguments(p.oid), \
            pg_get_function_result(p.oid), \
            l.lanname, \
            p.provolatile::text, \
            p.prosecdef \
     FROM pg_proc p \
     JOIN pg_language l ON l.oid = p.prolang \
     JOIN pg_namespace n ON n.oid = p.pronamespace \
     WHERE n.nspname = $1 AND p.prokind = 'f' \
     ORDER BY p.proname";

pub async fn pg_get_functions(client: &PgClient, schema: &str) -> Result<Vec<FunctionInfo>, String> {
    let rows = client.query(FUNCTION_LIST_SQL, &[&schema])
        .await.map_err(|e| format!("get_functions: {}", e))?;
    Ok(rows.iter().map(|r| FunctionInfo {
        function_name: r.get(0),
        arguments: r.get(1),
        return_type: r.try_get::<_, Option<String>>(2).ok().flatten().unwrap_or_else(|| "unknown".into()),
        language: r.get(3),
        volatility: volatility_label(&r.get::<_, String>(4)).to_string(),
        security_definer: r.get(5),
    }).collect())
}

pub async fn pg_get_rls_policies(client: &PgClient, schema: &str, table: &str) -> Result<Vec<RlsPolicyInfo>, String> {
    let rows = client.query(
        r#"SELECT policyname, cmd, roles, qual, with_check
           FROM pg_policies
           WHERE schemaname = $1 AND tablename = $2
           ORDER BY policyname"#,
        &[&schema, &table],
    ).await.map_err(|e| format!("get_rls_policies: {}", e))?;
    Ok(rows.iter().map(|r| RlsPolicyInfo {
        policy_name: r.get(0),
        command: r.get(1),
        roles: r.get(2),
        using_expression: r.get(3),
        check_expression: r.get(4),
    }).collect())
}

pub async fn pg_table_rls_status(client: &PgClient, schema: &str, table: &str) -> Result<bool, String> {
    let row = client.query_one(
        r#"SELECT c.relrowsecurity
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE c.relname = $2 AND n.nspname = $1"#,
        &[&schema, &table],
    ).await.map_err(|e| format!("table_rls_status: {}", e))?;
    Ok(row.get(0))
}

pub async fn pg_get_roles(client: &PgClient) -> Result<Vec<RoleInfo>, String> {
    let rows = client.query(
        "SELECT rolname, rolsuper, rolcreatedb, rolcreaterole, rolcanlogin, rolconnlimit FROM pg_roles ORDER BY rolname",
        &[],
    ).await.map_err(|e| format!("get_roles: {}", e))?;
    let mut out: Vec<RoleInfo> = rows.iter().map(|r| RoleInfo {
        role_name: r.get(0),
        superuser: r.get(1),
        createdb: r.get(2),
        createrole: r.get(3),
        login: r.get(4),
        connection_limit: r.get(5),
        member_of: Vec::new(),
    }).collect();
    let index: HashMap<String, usize> = out.iter().enumerate().map(|(i, r)| (r.role_name.clone(), i)).collect();
    let mrows = client.query(
        "SELECT roleid::regrole::text, member::regrole::text FROM pg_auth_members",
        &[],
    ).await.map_err(|e| format!("get_roles memberships: {}", e))?;
    for r in &mrows {
        if let (Ok(role), Ok(member)) = (r.try_get::<_, String>(0), r.try_get::<_, String>(1)) {
            if let Some(&i) = index.get(&member) {
                out[i].member_of.push(role);
            }
        }
    }
    for r in out.iter_mut() {
        r.member_of.sort();
    }
    Ok(out)
}

fn build_filter_where(filters: &[TableFilter]) -> (String, Vec<Box<dyn ToSql + Send + Sync>>) {
    if filters.is_empty() {
        return (String::new(), Vec::new());
    }
    let mut clauses = Vec::new();
    let mut params: Vec<Box<dyn ToSql + Send + Sync>> = Vec::new();
    for f in filters {
        let col = format!("\"{}\"", f.column.replace('"', "\"\""));
        let value = f.value.clone().unwrap_or_default();
        match f.operator.as_str() {
            "eq" => {
                params.push(Box::new(SqlText(value)));
                clauses.push(format!("{} = ${}", col, params.len()));
            }
            "neq" => {
                params.push(Box::new(SqlText(value)));
                clauses.push(format!("{} <> ${}", col, params.len()));
            }
            "contains" => {
                params.push(Box::new(SqlText(format!("%{}%", value))));
                clauses.push(format!("{} ILIKE ${}", col, params.len()));
            }
            "not_contains" => {
                params.push(Box::new(SqlText(format!("%{}%", value))));
                clauses.push(format!("{} NOT ILIKE ${}", col, params.len()));
            }
            "like" => {
                params.push(Box::new(SqlText(value)));
                clauses.push(format!("{} LIKE ${}", col, params.len()));
            }
            "not_like" => {
                params.push(Box::new(SqlText(value)));
                clauses.push(format!("{} NOT LIKE ${}", col, params.len()));
            }
            "starts_with" => {
                params.push(Box::new(SqlText(format!("{}%", value))));
                clauses.push(format!("{} LIKE ${}", col, params.len()));
            }
            "ends_with" => {
                params.push(Box::new(SqlText(format!("%{}", value))));
                clauses.push(format!("{} LIKE ${}", col, params.len()));
            }
            "is_null" => {
                clauses.push(format!("{} IS NULL", col));
            }
            "is_not_null" => {
                clauses.push(format!("{} IS NOT NULL", col));
            }
            _ => {} // unknown operator: skip filter
        }
    }
    if clauses.is_empty() {
        (String::new(), Vec::new())
    } else {
        (format!(" WHERE {}", clauses.join(" AND ")), params)
    }
}

pub async fn pg_get_table_data(client: &PgClient, schema: &str, table: &str, page: i64, page_size: i64, sort_col: Option<&str>, sort_dir: Option<&str>, filters: &[TableFilter]) -> Result<TableDataResult, String> {
    let order = match (sort_col, sort_dir) {
        (Some(c), Some(d)) if !c.is_empty() => format!(" ORDER BY \"{}\" {}", c.replace('"', "\"\""), if d == "desc" { "DESC" } else { "ASC" }),
        _ => " ORDER BY 1".to_string(),
    };
    let (where_clause, params) = build_filter_where(filters);
    let offset = (page - 1).max(0) * page_size;
    let count_q = format!("SELECT COUNT(*) FROM \"{}\".\"{}\"{}", schema, table, where_clause);
    let total: i64 = tokio::time::timeout(std::time::Duration::from_secs(30), query_one_with_params(client, &count_q, &params))
        .await
        .map_err(|_| "Count timed out (30s)".to_string())?
        .map_err(|e| format!("count: {}", e))?
        .get(0);
    let data_q = format!("SELECT * FROM \"{}\".\"{}\"{}{} LIMIT {} OFFSET {}", schema, table, where_clause, order, page_size, offset);
    let data_rows = tokio::time::timeout(std::time::Duration::from_secs(30), query_with_params(client, &data_q, &params))
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

/// Run a query with an optional set of bound parameters.
async fn query_with_params(client: &PgClient, sql: &str, params: &[Box<dyn ToSql + Send + Sync>]) -> Result<Vec<tokio_postgres::Row>, tokio_postgres::Error> {
    if params.is_empty() {
        client.query(sql, &[]).await
    } else {
        let refs: Vec<&(dyn ToSql + Sync)> = params.iter().map(|b| b.as_ref() as &(dyn ToSql + Sync)).collect();
        client.query(sql, &refs).await
    }
}

/// Like `query_with_params` but requires exactly one row (for COUNT etc.).
async fn query_one_with_params(client: &PgClient, sql: &str, params: &[Box<dyn ToSql + Send + Sync>]) -> Result<tokio_postgres::Row, tokio_postgres::Error> {
    if params.is_empty() {
        client.query_one(sql, &[]).await
    } else {
        let refs: Vec<&(dyn ToSql + Sync)> = params.iter().map(|b| b.as_ref() as &(dyn ToSql + Sync)).collect();
        client.query_one(sql, &refs).await
    }
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
        "numeric" => match row.try_get::<_, Option<RawBytes>>(i) {
            Ok(Some(raw)) => numeric_bytes_to_string(&raw.0).map(serde_json::Value::String).unwrap_or(serde_json::Value::Null),
            _ => serde_json::Value::Null,
        },
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
        _ if is_enum_type(row, i) => enum_value(row, i),
        _ => row.try_get::<_, Option<String>>(i).ok().flatten().map(serde_json::Value::String).unwrap_or(serde_json::Value::Null),
    }
}

/// True when the column at `i` is a user-defined enum type (`Kind::Enum`).
///
/// tokio-postgres's `String`/`&str` `FromSql` only accepts text-like OIDs, so
/// custom enum types must be read via their raw binary label bytes instead.
fn is_enum_type(row: &tokio_postgres::Row, i: usize) -> bool {
    matches!(row.columns()[i].type_().kind(), tokio_postgres::types::Kind::Enum(_))
}

/// Read an enum column's label as a JSON string. Enum values travel in binary
/// as their label's UTF-8 bytes, so a raw read + `from_utf8` is exact.
fn enum_value(row: &tokio_postgres::Row, i: usize) -> serde_json::Value {
    row.try_get::<_, Option<RawBytes>>(i)
        .ok()
        .flatten()
        .and_then(|raw| String::from_utf8(raw.0).ok())
        .map(serde_json::Value::String)
        .unwrap_or(serde_json::Value::Null)
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
        "numeric" => row.try_get::<_, Option<Vec<Option<RawBytes>>>>(i).ok().flatten()
            .map(|v| collect(v.into_iter().map(|x| x.and_then(|raw| numeric_bytes_to_string(&raw.0).ok()).map(serde_json::Value::String)).collect()))
            .unwrap_or(serde_json::Value::Null),
        _ if is_enum_array(row, i) => row.try_get::<_, Option<Vec<Option<RawBytes>>>>(i).ok().flatten()
            .map(|v| collect(v.into_iter().map(|x| x.and_then(|raw| String::from_utf8(raw.0).ok()).map(serde_json::Value::String)).collect()))
            .unwrap_or(serde_json::Value::Null),
        _ => row.try_get::<_, Option<Vec<Option<String>>>>(i).ok().flatten()
            .map(|v| collect(v.into_iter().map(|x| x.map(serde_json::Value::String)).collect()))
            .unwrap_or(serde_json::Value::Null),
    }
}

/// True when the column at `i` is an array whose element type is a user-defined
/// enum. Array elements share the element's binary format, so enum-array
/// elements are read via their raw label bytes.
fn is_enum_array(row: &tokio_postgres::Row, i: usize) -> bool {
    match row.columns()[i].type_().kind() {
        tokio_postgres::types::Kind::Array(inner) => matches!(inner.kind(), tokio_postgres::types::Kind::Enum(_)),
        _ => false,
    }
}

/// Raw bytes of any column value, decoded via `FromSql` regardless of type OID.
///
/// tokio-postgres gates `FromSql` by `T::accepts(ty)` *before* calling
/// `from_sql` (`Row::get_inner`), so `Vec<u8>` — which only accepts `BYTEA` —
/// cannot be used to read a `NUMERIC` column. This wrapper accepts every type
/// and returns the raw binary wire bytes, which `numeric_bytes_to_string`
/// then decodes.
struct RawBytes(Vec<u8>);

impl<'a> FromSql<'a> for RawBytes {
    fn from_sql(_ty: &Type, raw: &'a [u8]) -> Result<RawBytes, Box<dyn std::error::Error + Sync + Send>> {
        Ok(RawBytes(raw.to_vec()))
    }
    fn accepts(_ty: &Type) -> bool {
        true
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
        serde_json::Value::Bool(b) => Box::new(SqlText(if *b { "true".to_string() } else { "false".to_string() })),
        serde_json::Value::Number(n) => Box::new(SqlText(n.to_string())),
        // A `SqlText` (not a plain `String`) so enum columns can be bound too:
        // tokio-postgres's `String` rejects `Kind::Enum`, but an enum's binary
        // wire format is its label as UTF-8, which is exactly what this writes.
        serde_json::Value::String(s) => Box::new(SqlText(s.clone())),
        serde_json::Value::Array(_) | serde_json::Value::Object(_) => Box::new(SqlText(v.to_string())),
    }
}

/// A text value sent to the server in **text format**, letting PostgreSQL
/// perform the cast to the target column's type itself.
///
/// This is the universal binder: a value of any type can be written as its
/// text representation and Postgres will coerce it — `"123.45"` to `numeric`,
/// `"550e8400-…"` to `uuid`, `'{"a":1}'` to `jsonb`, `"card"` to an enum,
/// `"2024-01-01"` to `date`, etc. Binding a plain `String`/`i64`/`f64` fails
/// for such columns because those Rust types' `accepts()` reject the
/// server-inferred parameter type; text format sidesteps that entirely.
///
/// `encode_format` returning `Format::Text` is what makes this work —
/// tokio-postgres reads it per-parameter and skips binary encoding.
#[derive(Debug, Clone)]
struct SqlText(String);

impl ToSql for SqlText {
    fn to_sql(
        &self,
        _ty: &Type,
        out: &mut tokio_postgres::types::private::BytesMut,
    ) -> Result<IsNull, Box<dyn std::error::Error + Sync + Send>> {
        out.extend_from_slice(self.0.as_bytes());
        Ok(IsNull::No)
    }
    fn accepts(_ty: &Type) -> bool {
        true
    }
    fn encode_format(&self, _ty: &Type) -> tokio_postgres::types::Format {
        tokio_postgres::types::Format::Text
    }
    tokio_postgres::types::to_sql_checked!();
}

pub fn is_select_query(sql: &str) -> bool {
    let trimmed = sql.trim().to_ascii_uppercase();
    trimmed.starts_with("SELECT")
        || trimmed.starts_with("WITH")
        || trimmed.starts_with("EXPLAIN")
        || trimmed.starts_with("SHOW")
        || trimmed.starts_with("VALUES")
}

fn is_destructive_keyword(kw: &str) -> bool {
    matches!(
        kw,
        "drop" | "delete"
            | "truncate"
            | "update"
            | "alter"
            | "create"
            | "grant"
            | "revoke"
            | "vacuum"
            | "reindex"
            | "do"
            | "call"
    )
}

/// DDL-only subset of the destructive set — `CREATE`/`DROP`/`ALTER`/`GRANT`/
/// `REVOKE`/`TRUNCATE`/`VACUUM`/`REINDEX`. Notably *not* `UPDATE`/`DELETE`/
/// `INSERT`, which `mutate_rows` legitimately runs as structured row edits.
fn is_ddl_keyword(kw: &str) -> bool {
    matches!(
        kw,
        "drop" | "create" | "alter" | "grant" | "revoke" | "truncate" | "vacuum" | "reindex"
    )
}

/// True when `sql` contains any top-level statement whose (WITH-traversed)
/// first keyword is DDL (see `is_ddl_keyword`). Used to keep schema-structural
/// statements out of the grid-editing `mutate_rows` path.
pub fn is_ddl(sql: &str) -> bool {
    for stmt in top_level_statements(sql) {
        let mut sc = SqlScanner::new(stmt);
        match sc.read_statement_keyword() {
            Some(kw) if is_ddl_keyword(&kw) => return true,
            _ => {}
        }
    }
    false
}

/// Detect whether `sql` contains any statement whose (WITH-traversed) first
/// keyword is destructive. Every top-level statement is scanned (splitting on
/// `;` outside string literals, quoted identifiers and comments), and an
/// `EXPLAIN ANALYZE` of a destructive statement is itself treated as
/// destructive because ANALYZE actually executes the query.
///
/// `DO`/`CALL` blocks and `SELECT ... INTO` (a DDL write) are treated as
/// destructive too. Residual risk remains for side-effecting **volatile**
/// functions called from a plain SELECT (e.g. `SELECT nextval('s')` or
/// `SELECT my_mutating_fn()`); catching those needs a real parser, so these
/// heuristics deliberately err toward destructive.
pub fn is_destructive(sql: &str) -> bool {
    for stmt in top_level_statements(sql) {
        let mut sc = SqlScanner::new(stmt);
        match sc.read_statement_keyword() {
            Some(kw) if is_destructive_keyword(&kw) => return true,
            Some(kw) if kw == "explain" && explain_would_execute_destructive(&mut sc) => {
                return true;
            }
            Some(kw) if (kw == "select" || kw == "with") && select_into_detected(stmt) => {
                return true;
            }
            _ => {}
        }
    }
    false
}

/// `SELECT ... INTO` (e.g. `SELECT * INTO t2 FROM t1`) is a DDL write, so it
/// is treated as destructive. Light heuristic: the (WITH-traversed) first
/// keyword is SELECT, then a top-level `INTO` appears before `FROM` or the
/// statement end. Anything ambiguous is resolved toward destructive.
fn select_into_detected(stmt: &str) -> bool {
    let mut sc = SqlScanner::new(stmt);
    match sc.read_statement_keyword() {
        Some(kw) if kw == "select" => {}
        _ => return false,
    }
    let mut paren_depth: i32 = 0;
    loop {
        sc.skip_comments_ws();
        match sc.peek() {
            None | Some(b';') => return false,
            Some(b'(') => {
                paren_depth += 1;
                sc.advance();
            }
            Some(b')') => {
                paren_depth = (paren_depth - 1).max(0);
                sc.advance();
            }
            Some(b'\'') | Some(b'"') | Some(b'$') => sc.skip_string_literal(),
            Some(b'-') if sc.peek2() == Some(b'-') => sc.skip_line_comment(),
            Some(b'/') if sc.peek2() == Some(b'*') => sc.skip_block_comment(),
            Some(_) if sc.at_word_start() => {
                let kw = sc.read_keyword().unwrap_or_default();
                if kw == "from" {
                    return false;
                }
                if kw == "into" && paren_depth == 0 {
                    return true;
                }
            }
            Some(_) => sc.advance(),
        }
    }
}

/// Whether `sql` is safe to hand to `EXPLAIN`: exactly one top-level statement
/// that is a read-only SELECT/VALUES shape. Multi-statement strings are
/// rejected because EXPLAIN only wraps the first statement while the
/// simple-query protocol executes the rest raw.
pub fn explain_safe_to_run(sql: &str) -> bool {
    let stmts: Vec<&str> = top_level_statements(sql)
        .into_iter()
        .filter(|s| !s.trim().is_empty())
        .collect();
    stmts.len() == 1 && !is_destructive(sql) && is_select_query(sql)
}

/// Split SQL into top-level statements on `;` that is not inside a string
/// literal, quoted identifier, comment, or dollar-quoted string.
fn top_level_statements(sql: &str) -> Vec<&str> {
    let bytes = sql.as_bytes();
    let mut stmts = Vec::new();
    let mut start = 0usize;
    let mut i = 0usize;
    let mut in_sq = false;
    let mut in_dq = false;
    while i < bytes.len() {
        match bytes[i] {
            b'\'' if !in_dq => {
                if in_sq {
                    if i + 1 < bytes.len() && bytes[i + 1] == b'\'' {
                        i += 2;
                        continue;
                    }
                    in_sq = false;
                } else {
                    in_sq = true;
                }
                i += 1;
            }
            b'"' if !in_sq => {
                if in_dq {
                    if i + 1 < bytes.len() && bytes[i + 1] == b'"' {
                        i += 2;
                        continue;
                    }
                    in_dq = false;
                } else {
                    in_dq = true;
                }
                i += 1;
            }
            b'-' if !in_sq && !in_dq && i + 1 < bytes.len() && bytes[i + 1] == b'-' => {
                while i < bytes.len() && bytes[i] != b'\n' {
                    i += 1;
                }
            }
            b'/' if !in_sq && !in_dq && i + 1 < bytes.len() && bytes[i + 1] == b'*' => {
                i += 2;
                while i + 1 < bytes.len() && !(bytes[i] == b'*' && bytes[i + 1] == b'/') {
                    i += 1;
                }
                i = (i + 2).min(bytes.len());
            }
            b'$' if !in_sq && !in_dq => {
                if let Some(tag_len) = dollar_tag_len(bytes, i) {
                    i = find_dollar_close(bytes, i + tag_len, tag_len);
                } else {
                    i += 1;
                }
            }
            b';' if !in_sq && !in_dq => {
                stmts.push(&sql[start..i]);
                i += 1;
                start = i;
            }
            _ => i += 1,
        }
    }
    stmts.push(&sql[start..]);
    stmts
}

/// Length of the opening `$tag$` delimiter if `start` begins a dollar-quoted
/// string. `$1`-style parameter references (digit after `$`) are not quotes.
fn dollar_tag_len(bytes: &[u8], start: usize) -> Option<usize> {
    let mut j = start + 1;
    while j < bytes.len() && bytes[j] != b'$' {
        if bytes[j].is_ascii_alphanumeric() || bytes[j] == b'_' {
            j += 1;
        } else {
            return None;
        }
    }
    if j >= bytes.len() {
        return None;
    }
    let tag_is_valid = j == start + 1
        || bytes[start + 1].is_ascii_alphabetic()
        || bytes[start + 1] == b'_';
    if !tag_is_valid {
        return None;
    }
    Some(j - start + 1)
}

fn find_dollar_close(bytes: &[u8], mut pos: usize, tag_len: usize) -> usize {
    let delim = &bytes[pos - tag_len..pos];
    while pos + tag_len <= bytes.len() {
        if &bytes[pos..pos + tag_len] == delim {
            return pos + tag_len;
        }
        pos += 1;
    }
    bytes.len()
}

/// Minimal SQL scanner used by the destructive-query detector.
struct SqlScanner<'a> {
    bytes: &'a [u8],
    pos: usize,
}

impl<'a> SqlScanner<'a> {
    fn new(s: &'a str) -> Self {
        SqlScanner { bytes: s.as_bytes(), pos: 0 }
    }

    fn peek(&self) -> Option<u8> {
        self.bytes.get(self.pos).copied()
    }

    fn peek2(&self) -> Option<u8> {
        self.bytes.get(self.pos + 1).copied()
    }

    fn advance(&mut self) {
        self.pos += 1;
    }

    fn at_word_start(&self) -> bool {
        matches!(self.peek(), Some(c) if c.is_ascii_alphabetic() || c == b'_')
    }

    fn skip_comments_ws(&mut self) {
        loop {
            match self.peek() {
                Some(c) if c.is_ascii_whitespace() => self.advance(),
                Some(b'-') if self.peek2() == Some(b'-') => self.skip_line_comment(),
                Some(b'/') if self.peek2() == Some(b'*') => self.skip_block_comment(),
                _ => break,
            }
        }
    }

    fn skip_line_comment(&mut self) {
        while let Some(c) = self.peek() {
            if c == b'\n' {
                return;
            }
            self.advance();
        }
    }

    fn skip_block_comment(&mut self) {
        self.advance();
        self.advance();
        while self.pos + 1 < self.bytes.len() {
            if self.peek() == Some(b'*') && self.peek2() == Some(b'/') {
                self.advance();
                self.advance();
                return;
            }
            self.advance();
        }
        self.pos = self.bytes.len();
    }

    fn skip_string_literal(&mut self) {
        match self.peek() {
            Some(b'\'') => {
                self.advance();
                loop {
                    match self.peek() {
                        Some(b'\'') if self.peek2() == Some(b'\'') => {
                            self.advance();
                            self.advance();
                        }
                        Some(b'\'') => {
                            self.advance();
                            break;
                        }
                        Some(_) => self.advance(),
                        None => break,
                    }
                }
            }
            Some(b'"') => {
                self.advance();
                loop {
                    match self.peek() {
                        Some(b'"') if self.peek2() == Some(b'"') => {
                            self.advance();
                            self.advance();
                        }
                        Some(b'"') => {
                            self.advance();
                            break;
                        }
                        Some(_) => self.advance(),
                        None => break,
                    }
                }
            }
            Some(b'$') => {
                if let Some(tag_len) = dollar_tag_len(self.bytes, self.pos) {
                    self.pos = find_dollar_close(self.bytes, self.pos + tag_len, tag_len);
                } else {
                    self.advance();
                }
            }
            _ => self.advance(),
        }
    }

    fn read_keyword(&mut self) -> Option<String> {
        self.skip_comments_ws();
        if !self.at_word_start() {
            return None;
        }
        let start = self.pos;
        while let Some(c) = self.peek() {
            if c.is_ascii_alphanumeric() || c == b'_' {
                self.advance();
            } else {
                break;
            }
        }
        Some(String::from_utf8_lossy(&self.bytes[start..self.pos]).to_ascii_lowercase())
    }

    fn peek_keyword(&mut self) -> Option<String> {
        let save = self.pos;
        let kw = self.read_keyword();
        self.pos = save;
        kw
    }

    fn skip_balanced_paren_group(&mut self) -> bool {
        if self.peek() != Some(b'(') {
            return false;
        }
        self.advance();
        let mut depth: i32 = 1;
        while depth > 0 {
            match self.peek() {
                Some(b'(') => {
                    depth += 1;
                    self.advance();
                }
                Some(b')') => {
                    depth -= 1;
                    self.advance();
                }
                Some(b'\'') | Some(b'"') | Some(b'$') => self.skip_string_literal(),
                Some(b'-') if self.peek2() == Some(b'-') => self.skip_line_comment(),
                Some(b'/') if self.peek2() == Some(b'*') => self.skip_block_comment(),
                Some(_) => self.advance(),
                None => return false,
            }
        }
        true
    }

    /// Positioned right after the `WITH` keyword, skip the `name [cols] AS (body) [, ...]`
    /// CTE definitions so the scanner sits at the first keyword of the main statement.
    fn skip_with_clause(&mut self) -> bool {
        self.skip_comments_ws();
        if let Some(k) = self.peek_keyword() {
            if k == "recursive" {
                self.read_keyword();
            }
        }
        loop {
            self.skip_comments_ws();
            match self.read_keyword() {
                Some(_) => {}
                None => return false,
            }
            self.skip_comments_ws();
            if self.peek() == Some(b'(') && !self.skip_balanced_paren_group() {
                return false;
            }
            self.skip_comments_ws();
            match self.read_keyword() {
                Some(k) if k == "as" => {}
                _ => return false,
            }
            self.skip_comments_ws();
            if self.peek() != Some(b'(') || !self.skip_balanced_paren_group() {
                return false;
            }
            self.skip_comments_ws();
            match self.peek() {
                Some(b',') => self.advance(),
                Some(_) => return true,
                None => return false,
            }
        }
    }

    /// First keyword of the statement, transparently skipping a leading `WITH` clause.
    fn read_statement_keyword(&mut self) -> Option<String> {
        self.skip_comments_ws();
        let first = self.read_keyword()?;
        if first == "with" {
            if self.skip_with_clause() {
                self.skip_comments_ws();
                self.read_keyword()
            } else {
                Some(first)
            }
        } else {
            Some(first)
        }
    }
}

/// Called when a statement's first keyword is `explain`. Returns true if the
/// EXPLAIN will ANALYZE (i.e. actually execute) a destructive statement.
/// Deliberately fail-safe: anything we cannot parse cleanly is treated as
/// destructive.
fn explain_would_execute_destructive(sc: &mut SqlScanner) -> bool {
    let mut analyze: Option<bool> = None;
    sc.skip_comments_ws();
    if sc.peek() == Some(b'(') {
        sc.advance();
        let mut depth = 1;
        while depth > 0 {
            match sc.peek() {
                Some(b'(') => {
                    depth += 1;
                    sc.advance();
                }
                Some(b')') => {
                    depth -= 1;
                    sc.advance();
                }
                Some(b'\'') | Some(b'"') | Some(b'$') => sc.skip_string_literal(),
                Some(_) if sc.at_word_start() => {
                    let kw = sc.read_keyword().unwrap_or_default();
                    if kw == "analyze" {
                        sc.skip_comments_ws();
                        if sc.peek() == Some(b'=') {
                            sc.advance();
                            sc.skip_comments_ws();
                        }
                        match sc.peek_keyword() {
                            Some(v) if v == "true" || v == "on" => {
                                analyze = Some(true);
                                sc.read_keyword();
                            }
                            Some(v) if v == "false" || v == "off" => {
                                analyze = Some(false);
                                sc.read_keyword();
                            }
                            _ => analyze = Some(true),
                        }
                    }
                }
                Some(_) => sc.advance(),
                None => return true,
            }
        }
    } else {
        loop {
            sc.skip_comments_ws();
            match sc.peek_keyword() {
                Some(k) if k == "analyze" => {
                    analyze = Some(true);
                    sc.read_keyword();
                }
                Some(k) if k == "verbose" => {
                    sc.read_keyword();
                }
                Some(_) => break,
                None => break,
            }
        }
    }
    if analyze != Some(true) {
        return false;
    }
    sc.skip_comments_ws();
    match sc.read_statement_keyword() {
        Some(kw) => is_destructive_keyword(&kw),
        None => true,
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

pub async fn pg_mutate(client: &mut PgClient, statements: &[RowMutationStatement]) -> Result<Vec<QueryResult>, String> {
    if statements.is_empty() {
        return Ok(Vec::new());
    }
    let tx = client.transaction().await.map_err(|e| format!("begin transaction: {}", e))?;
    let mut results = Vec::with_capacity(statements.len());
    for stmt in statements {
        let start = std::time::Instant::now();
        let bindings: Vec<Box<dyn ToSql + Send + Sync>> = stmt.params.iter().map(json_to_tosql).collect();
        let bind_refs: Vec<&(dyn ToSql + Sync)> = bindings.iter().map(|b| b.as_ref() as &(dyn ToSql + Sync)).collect();
        let affected = tokio::time::timeout(std::time::Duration::from_secs(30), tx.execute(&stmt.query, &bind_refs))
            .await
            .map_err(|_| "Mutation timed out (30s)".to_string())?
            .map_err(|e| format!("mutation: {}", e))?;
        let elapsed = start.elapsed().as_millis() as u64;
        results.push(QueryResult {
            columns: vec![],
            rows: vec![],
            row_count: 0,
            affected_rows: Some(affected),
            is_select: false,
            execution_time_ms: elapsed,
        });
    }
    tx.commit().await.map_err(|e| format!("commit: {}", e))?;
    Ok(results)
}

pub async fn pg_explain(client: &PgClient, query: &str, analyze: bool) -> Result<ExplainResult, String> {
    if !explain_safe_to_run(query) {
        return Err("EXPLAIN is only allowed on read-only (SELECT/VALUES) queries".into());
    }
    let start = std::time::Instant::now();
    let explain_sql = format!(
        "EXPLAIN (FORMAT JSON, BUFFERS true, ANALYZE {}) {}",
        if analyze { "true" } else { "false" },
        query
    );
    let row = tokio::time::timeout(std::time::Duration::from_secs(30), client.query_one(&explain_sql, &[]))
        .await
        .map_err(|_| "EXPLAIN timed out (30s)".to_string())?
        .map_err(|e| format!("explain: {}", e))?;
    let plan = match row.try_get::<_, serde_json::Value>(0) {
        Ok(v) => v,
        Err(_) => {
            let s: String = row.try_get(0).map_err(|e| format!("explain: {}", e))?;
            serde_json::from_str(&s).map_err(|e| format!("explain parse: {}", e))?
        }
    };
    let elapsed = start.elapsed().as_millis() as u64;
    Ok(ExplainResult { plan, execution_time_ms: elapsed })
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

/// Gather connection metadata for a live client.
///
/// Provider is detected from the URL hostname via `detect_provider`, but
/// schema-presence detection can *force* `is_supabase`: if any of Supabase's
/// characteristic schemas (`auth`, `storage`, `realtime`,
/// `supabase_functions`, `graphql`) exists, `is_supabase` is set to true
/// regardless of what the hostname said. This closes the gap where a Supabase
/// project is reached through a hostname that does not match, or where a
/// rehosted/self-hosted Supabase-style install would otherwise go undetected.
/// `provider` itself stays as the hostname-based guess (informational only).
///
/// `pooled_endpoint`: true when the parsed port is `6543` (Supabase pooler
/// port) or the URL host contains the `-pooler` substring (Neon/Supabase
/// pooler hostnames). Note this is intentionally broader than the
/// per-provider hint in `commands::pooled_endpoint_hint` (Task 3), which
/// gates the `pooler` substring per provider — see the task report.
///
/// `server_version` is extracted from `version()` as `PostgreSQL <major.minor>`
/// (the first two whitespace tokens), falling back to the full string when the
/// string does not begin with `PostgreSQL`.
pub async fn pg_connection_info(client: &PgClient, url: &str, read_only: bool) -> Result<ConnectionInfo, String> {
    let parts = parse_pg_url(url)?;
    let provider = detect_provider(url).to_string();
    let mut is_supabase = provider == "supabase";
    let is_neon = provider == "neon";

    let row = client
        .query_one("SELECT current_database(), current_user, version()", &[])
        .await
        .map_err(|e| format!("connection_info: {}", e))?;
    let database: String = row.get(0);
    let user: String = row.get(1);
    let version_full: String = row.get(2);
    let server_version = {
        let mut words = version_full.split_whitespace();
        match (words.next(), words.next()) {
            (Some(kind), Some(ver)) if kind.eq_ignore_ascii_case("postgresql") => {
                format!("{} {}", kind, ver)
            }
            _ => version_full,
        }
    };

    let schema_rows = client
        .query(
            "SELECT schema_name FROM information_schema.schemata \
             WHERE schema_name IN ('auth','storage','realtime','supabase_functions','graphql') \
             ORDER BY schema_name",
            &[],
        )
        .await
        .map_err(|e| format!("connection_info schemas: {}", e))?;
    let supabase_schemas: Vec<String> = schema_rows.iter().map(|r| r.get::<_, String>(0)).collect();
    if !supabase_schemas.is_empty() {
        is_supabase = true;
    }

    let pooled_endpoint = parts.port == "6543" || parts.host.to_lowercase().contains("-pooler");

    Ok(ConnectionInfo {
        provider,
        host: parts.host.clone(),
        port: parts.port.clone(),
        database,
        user,
        server_version,
        sslmode: parts.sslmode.clone(),
        is_supabase,
        is_neon,
        supabase_schemas,
        read_only,
        pooled_endpoint,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio_postgres::types::Kind;

    #[test]
    fn raw_bytes_accepts_numeric_oid() {
        assert!(RawBytes::accepts(&Type::NUMERIC));
    }

    #[test]
    fn raw_bytes_round_trips_raw_binary() {
        let wire = [0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01];
        let raw = RawBytes::from_sql(&Type::NUMERIC, &wire).unwrap();
        assert_eq!(raw.0, wire);
        assert_eq!(numeric_bytes_to_string(&raw.0).unwrap(), "1");
    }

    #[test]
    fn select_detection_covers_read_only_shapes() {
        assert!(is_select_query("select 1"));
        assert!(is_select_query("  SHOW search_path"));
        assert!(is_select_query("explain select 1"));
        assert!(is_select_query("values (1)"));
        assert!(!is_select_query("insert into t values (1)"));
        assert!(!is_select_query(""));
    }

    #[test]
    fn destructive_detection_core_cases() {
        assert!(is_destructive("drop table x"));
        assert!(is_destructive("UPDATE t SET a = 1"));
        assert!(is_destructive("/*c*/DELETE FROM t"));
        assert!(is_destructive("WITH x AS () DELETE FROM t"));
        assert!(is_destructive("select 1; truncate t"));
        assert!(!is_destructive("select * from t"));
        assert!(!is_destructive("with x as (select 1) select * from x"));
        assert!(!is_destructive("EXPLAIN (ANALYZE false) DELETE FROM t"));
        assert!(!is_destructive(""));
    }

    // ------------------------------------------------------------------
    // pg_get_tables — batched single-query shape (DB-free structural test)
    // ------------------------------------------------------------------

    #[test]
    fn table_list_sql_is_single_batched_query_with_rls() {
        assert!(TABLE_LIST_SQL.contains("relrowsecurity"), "must expose RLS flag");
        assert!(TABLE_LIST_SQL.contains("relkind IN ('r','v','m','p')"), "must list tables/views/materialized/partitioned");
        assert!(TABLE_LIST_SQL.contains("GREATEST(c.reltuples::bigint, 0)"), "must clamp reltuples estimate to 0");
        assert!(!TABLE_LIST_SQL.contains("query_one"), "no per-row count query (no N+1)");
        assert_eq!(TABLE_LIST_SQL.matches("FROM pg_class c").count(), 1, "single FROM");
    }

    #[test]
    fn trigger_list_sql_uses_tgenabled_not_is_enabled() {
        assert!(TRIGGER_LIST_SQL.contains("tgenabled"), "enable state comes from pg_trigger.tgenabled");
        assert!(TRIGGER_LIST_SQL.contains("information_schema.triggers"), "metadata from the info-schema view");
        assert!(!TRIGGER_LIST_SQL.contains("is_enabled"), "information_schema.triggers has no is_enabled column");
        assert!(TRIGGER_LIST_SQL.contains("pg_trigger pt"), "joined to pg_trigger for tgenabled");
        assert!(TRIGGER_LIST_SQL.contains("n.nspname = $1 AND c.relname = $2"), "schema/table filter via pg_class+pg_namespace");
        assert!(TRIGGER_LIST_SQL.contains("t.event_object_schema = n.nspname"), "info-schema side must be constrained to the same table to avoid name collisions");
        assert!(TRIGGER_LIST_SQL.contains("t.event_object_table = c.relname"), "info-schema side must be constrained to the same table to avoid name collisions");
    }

    #[test]
    fn function_list_sql_only_lists_real_functions() {
        assert!(FUNCTION_LIST_SQL.contains("prokind = 'f'"), "must exclude procedures/aggregates (NULL return_type)");
        assert!(FUNCTION_LIST_SQL.contains("pg_get_function_result(p.oid)"), "return type from pg_get_function_result");
        assert!(FUNCTION_LIST_SQL.contains("p.provolatile"), "volatility code exposed for labeling");
        assert!(!FUNCTION_LIST_SQL.contains("is_enabled"), "no info-schema trigger column");
    }

    #[test]
    fn column_list_sql_strips_modifiers_and_guards_max_length() {
        assert!(COLUMN_LIST_SQL.contains("position('(' in format_type(a.atttypid, a.atttypmod))"),
            "type modifier suffix is stripped so data_type is the bare built-in name");
        assert!(COLUMN_LIST_SQL.contains("atttypid IN (18, 1042, 1043)"),
            "max_length only computed for char/varchar/bpchar");
        assert!(COLUMN_LIST_SQL.contains("i.indisprimary"), "PK via pg_index.indisprimary");
        assert!(!COLUMN_LIST_SQL.contains("_pkey"), "no fragile LIKE '%_pkey' detection");
    }

    #[test]
    fn relkind_labels_are_friendly() {
        assert_eq!(relkind_label("r"), "TABLE");
        assert_eq!(relkind_label("v"), "VIEW");
        assert_eq!(relkind_label("m"), "MATERIALIZED VIEW");
        assert_eq!(relkind_label("p"), "PARTITIONED TABLE");
        assert_eq!(relkind_label("?"), "TABLE");
        assert_eq!(volatility_label("i"), "IMMUTABLE");
        assert_eq!(volatility_label("s"), "STABLE");
        assert_eq!(volatility_label("v"), "VOLATILE");
    }

    // ------------------------------------------------------------------
    // New introspection structs — serde round-trips + exact camelCase keys
    // ------------------------------------------------------------------

    #[test]
    fn view_info_serializes_camel_case() {
        let v = ViewInfo { view_name: "v".into(), definition: "SELECT 1".into() };
        let j = serde_json::to_value(&v).unwrap();
        assert_eq!(j["viewName"], "v");
        assert_eq!(j["definition"], "SELECT 1");
    }

    #[test]
    fn trigger_info_serializes_camel_case() {
        let t = TriggerInfo {
            trigger_name: "trg".into(),
            event_manipulation: "INSERT".into(),
            action_timing: "BEFORE".into(),
            action_statement: "EXECUTE FUNCTION f()".into(),
            enabled: true,
        };
        let j = serde_json::to_value(&t).unwrap();
        assert_eq!(j["triggerName"], "trg");
        assert_eq!(j["eventManipulation"], "INSERT");
        assert_eq!(j["actionTiming"], "BEFORE");
        assert_eq!(j["actionStatement"], "EXECUTE FUNCTION f()");
        assert_eq!(j["enabled"], true);
    }

    #[test]
    fn function_info_serializes_camel_case() {
        let f = FunctionInfo {
            function_name: "fn".into(),
            arguments: "a int".into(),
            return_type: "integer".into(),
            language: "plpgsql".into(),
            volatility: "STABLE".into(),
            security_definer: true,
        };
        let j = serde_json::to_value(&f).unwrap();
        assert_eq!(j["functionName"], "fn");
        assert_eq!(j["arguments"], "a int");
        assert_eq!(j["returnType"], "integer");
        assert_eq!(j["language"], "plpgsql");
        assert_eq!(j["volatility"], "STABLE");
        assert_eq!(j["securityDefiner"], true);
    }

    #[test]
    fn rls_policy_info_serializes_camel_case_and_omits_nulls() {
        let p = RlsPolicyInfo {
            policy_name: "p1".into(),
            command: "SELECT".into(),
            roles: vec!["app".into()],
            using_expression: None,
            check_expression: Some("id > 0".into()),
        };
        let j = serde_json::to_value(&p).unwrap();
        assert_eq!(j["policyName"], "p1");
        assert_eq!(j["command"], "SELECT");
        assert_eq!(j["roles"], serde_json::json!(["app"]));
        assert!(j.get("usingExpression").is_none(), "null Option fields are omitted");
        assert_eq!(j["checkExpression"], "id > 0");
    }

    #[test]
    fn role_info_serializes_camel_case() {
        let r = RoleInfo {
            role_name: "app".into(),
            superuser: false,
            createdb: true,
            createrole: false,
            login: true,
            connection_limit: -1,
            member_of: vec!["owners".into()],
        };
        let j = serde_json::to_value(&r).unwrap();
        assert_eq!(j["roleName"], "app");
        assert_eq!(j["superuser"], false);
        assert_eq!(j["createdb"], true);
        assert_eq!(j["createrole"], false);
        assert_eq!(j["login"], true);
        assert_eq!(j["connectionLimit"], -1);
        assert_eq!(j["memberOf"], serde_json::json!(["owners"]));
    }

    #[test]
    fn table_info_serializes_with_has_rls_field() {
        let t = TableInfo {
            table_name: "t".into(),
            schema_name: "public".into(),
            table_type: "TABLE".into(),
            row_count: Some(10),
            has_rls: Some(true),
        };
        let j = serde_json::to_value(&t).unwrap();
        assert_eq!(j["tableName"], "t");
        assert_eq!(j["hasRls"], true);
    }

    #[test]
    fn connection_info_serializes_camel_case() {
        let ci = ConnectionInfo {
            provider: "supabase".into(),
            host: "db.example.supabase.co".into(),
            port: "6543".into(),
            database: "postgres".into(),
            user: "postgres".into(),
            server_version: "PostgreSQL 16.1".into(),
            sslmode: "require".into(),
            is_supabase: true,
            is_neon: false,
            supabase_schemas: vec!["auth".into(), "storage".into()],
            read_only: false,
            pooled_endpoint: true,
        };
        let j = serde_json::to_value(&ci).unwrap();
        assert_eq!(j["provider"], "supabase");
        assert_eq!(j["host"], "db.example.supabase.co");
        assert_eq!(j["port"], "6543");
        assert_eq!(j["database"], "postgres");
        assert_eq!(j["user"], "postgres");
        assert_eq!(j["serverVersion"], "PostgreSQL 16.1");
        assert_eq!(j["sslmode"], "require");
        assert_eq!(j["isSupabase"], true);
        assert_eq!(j["isNeon"], false);
        assert_eq!(j["supabaseSchemas"], serde_json::json!(["auth", "storage"]));
        assert_eq!(j["readOnly"], false);
        assert_eq!(j["pooledEndpoint"], true);
    }

    #[test]
    fn sql_text_accepts_any_type_and_uses_text_format() {
        use tokio_postgres::types::ToSql;
        let enum_ty = Type::new("payment_method".into(), 12345, Kind::Enum(vec!["card".into(), "bank".into()]), "public".into());
        for ty in [Type::TEXT, Type::INT4, Type::NUMERIC, Type::JSONB, Type::UUID, Type::BOOL, enum_ty.clone()] {
            assert!(<SqlText as ToSql>::accepts(&ty), "SqlText must accept {ty}");
        }
        // Text format is what lets the server cast the value to any column type.
        assert!(matches!(SqlText("x".into()).encode_format(&Type::NUMERIC), tokio_postgres::types::Format::Text));
    }

    #[test]
    fn sql_text_writes_label_bytes_for_enum() {
        use tokio_postgres::types::private::BytesMut;
        use tokio_postgres::types::ToSql;
        let enum_ty = Type::new("payment_method".into(), 12345, Kind::Enum(vec!["card".into(), "bank".into()]), "public".into());
        let mut buf = BytesMut::new();
        let v = SqlText("bank".into());
        assert!(matches!(ToSql::to_sql(&v, &enum_ty, &mut buf), Ok(IsNull::No)));
        assert_eq!(&buf[..], b"bank", "text bytes are the label");
    }

    #[test]
    fn raw_bytes_can_read_enum_label() {
        use tokio_postgres::types::FromSql;
        let enum_ty = Type::new("billing_type".into(), 999, Kind::Enum(vec!["monthly".into(), "once".into()]), "public".into());
        let raw = RawBytes::from_sql(&enum_ty, b"monthly").unwrap();
        assert_eq!(String::from_utf8(raw.0).unwrap(), "monthly");
    }

    #[test]
    fn filter_where_empty_for_no_filters() {
        let (clause, params) = build_filter_where(&[]);
        assert_eq!(clause, "");
        assert!(params.is_empty());
    }

    #[test]
    fn filter_where_builds_parameterized_clauses() {
        let filters = vec![
            TableFilter { column: "id".into(), operator: "eq".into(), value: Some("5".into()) },
            TableFilter { column: "name".into(), operator: "contains".into(), value: Some("jo".into()) },
            TableFilter { column: "deleted_at".into(), operator: "is_null".into(), value: None },
        ];
        let (clause, params) = build_filter_where(&filters);
        assert_eq!(clause, " WHERE \"id\" = $1 AND \"name\" ILIKE $2 AND \"deleted_at\" IS NULL");
        assert_eq!(params.len(), 2);
    }

    #[test]
    fn filter_where_escapes_quotes_in_column() {
        let filters = vec![
            TableFilter { column: "na\"me".into(), operator: "eq".into(), value: Some("x".into()) },
        ];
        let (clause, _) = build_filter_where(&filters);
        assert!(clause.contains("\"na\"\"me\" = $1"), "quote must be doubled");
    }

    #[test]
    fn filter_where_unknown_operator_is_skipped() {
        let filters = vec![
            TableFilter { column: "id".into(), operator: "bogus".into(), value: Some("1".into()) },
        ];
        let (clause, params) = build_filter_where(&filters);
        assert_eq!(clause, "");
        assert!(params.is_empty());
    }
}
