use relic_lib::build_tls;
use relic_lib::detect_provider;
use relic_lib::parse_pg_connstr;
use relic_lib::parse_pg_url;
use relic_lib::StoredConnection;

fn url(rest: &str) -> String {
    format!("postgres://{}", rest)
}

// ---------------------------------------------------------------------------
// parse_pg_url -> UrlParts
// ---------------------------------------------------------------------------

#[test]
fn sslmode_require_is_extracted_from_query_string() {
    let parts = parse_pg_url(&url("user:pass@host:5432/db?sslmode=require")).unwrap();
    assert_eq!(parts.sslmode, "require");
}

#[test]
fn sslmode_defaults_to_prefer_when_absent() {
    let parts = parse_pg_url(&url("user:pass@host:5432/db")).unwrap();
    assert_eq!(parts.sslmode, "prefer");
}

#[test]
fn sslmode_disable_is_extracted() {
    let parts = parse_pg_url(&url("user:pass@host:5432/db?sslmode=disable")).unwrap();
    assert_eq!(parts.sslmode, "disable");
}

#[test]
fn sslmode_empty_value_defaults_to_prefer() {
    let parts = parse_pg_url(&url("user:pass@host:5432/db?sslmode=")).unwrap();
    assert_eq!(parts.sslmode, "prefer");
    let parts = parse_pg_url(&url("user:pass@host:5432/db?sslmode=&channel_binding=require")).unwrap();
    assert_eq!(parts.sslmode, "prefer");
    let connstr = parse_pg_connstr(&url("user:pass@host:5432/db?sslmode=&channel_binding=require")).unwrap();
    assert!(connstr.contains("sslmode=prefer"), "connstr: {connstr}");
    assert!(build_tls(&parts.sslmode).is_ok(), "empty sslmode must not hard-fail build_tls");
}

#[test]
fn ssl_root_cert_is_extracted_when_present() {
    let parts = parse_pg_url(&url("user:pass@host:5432/db?sslmode=verify-full&sslrootcert=/tmp/ca.pem")).unwrap();
    assert_eq!(parts.sslmode, "verify-full");
    assert_eq!(parts.ssl_root_cert, "/tmp/ca.pem");
}

#[test]
fn ssl_root_cert_is_empty_when_absent() {
    let parts = parse_pg_url(&url("user:pass@host:5432/db")).unwrap();
    assert_eq!(parts.ssl_root_cert, "");
}

#[test]
fn port_defaults_to_5432_when_missing() {
    let parts = parse_pg_url(&url("user:pass@host/db")).unwrap();
    assert_eq!(parts.host, "host");
    assert_eq!(parts.port, "5432");
    assert_eq!(parts.db, "db");
}

#[test]
fn host_port_db_are_split() {
    let parts = parse_pg_url(&url("user:pass@example.com:5433/mydb")).unwrap();
    assert_eq!(parts.host, "example.com");
    assert_eq!(parts.port, "5433");
    assert_eq!(parts.db, "mydb");
}

#[test]
fn urlencoded_credentials_are_decoded() {
    let parts = parse_pg_url(&url("user%40foo:p%40ss%24@host:5432/db")).unwrap();
    assert_eq!(parts.user, "user@foo");
    assert_eq!(parts.password, "p@ss$");
}

#[test]
fn url_without_database_has_empty_db() {
    let parts = parse_pg_url(&url("user:pass@host:5432")).unwrap();
    assert_eq!(parts.db, "");
}

#[test]
fn password_containing_multiple_at_signs_is_preserved() {
    let parts = parse_pg_url(&url("user:p@ss@word@host:5432/db")).unwrap();
    assert_eq!(parts.user, "user");
    assert_eq!(parts.password, "p@ss@word");
    assert_eq!(parts.host, "host");
}

#[test]
fn bracket_ipv6_host_is_handled() {
    let parts = parse_pg_url(&url("user:pass@[::1]:5432/db")).unwrap();
    assert_eq!(parts.host, "[::1]");
    assert_eq!(parts.port, "5432");
    assert_eq!(parts.db, "db");
}

#[test]
fn non_postgres_url_is_rejected() {
    assert!(parse_pg_url("mysql://user:pass@host/db").is_err());
}

// ---------------------------------------------------------------------------
// parse_pg_connstr
// ---------------------------------------------------------------------------

#[test]
fn connstr_contains_sslmode_from_query_string() {
    let connstr = parse_pg_connstr(&url("user:pass@host:5432/db?sslmode=require")).unwrap();
    assert!(connstr.contains("sslmode=require"), "got: {}", connstr);
}

#[test]
fn connstr_never_drops_sslmode() {
    let connstr = parse_pg_connstr(&url("user:pass@host:5432/db")).unwrap();
    assert!(connstr.contains("sslmode=prefer"), "got: {}", connstr);
}

#[test]
fn connstr_preserves_urlencoded_password() {
    let connstr = parse_pg_connstr(&url("user:p%40ss%24@host:5432/db")).unwrap();
    assert!(connstr.contains("password=p@ss$"), "got: {}", connstr);
}

#[test]
fn connstr_has_expected_shape() {
    let connstr = parse_pg_connstr(&url("user:pass@host:5433/mydb")).unwrap();
    assert_eq!(
        connstr,
        "host=host port=5433 dbname=mydb user=user password=pass sslmode=prefer connect_timeout=5"
    );
}

#[test]
fn connstr_quotes_password_with_space() {
    // URL-encoded space in the password: the decoded value contains
    // whitespace, which would otherwise break Config's key=value tokenizer.
    let connstr = parse_pg_connstr(&url("user:p%20ss@host:5432/db")).unwrap();
    assert!(connstr.contains("password='p ss'"), "got: {}", connstr);
    connstr
        .parse::<tokio_postgres::Config>()
        .unwrap_or_else(|e| panic!("space password rejected by tokio-postgres Config: {} (connstr: {})", e, connstr));
}

#[test]
fn connstr_quotes_password_with_embedded_quote() {
    // Embedded quotes are backslash-escaped inside the quoted conn string value
    // (the escaping scheme tokio-postgres's Config parser understands).
    let connstr = parse_pg_connstr(&url("user:p%27x@host:5432/db")).unwrap();
    assert!(connstr.contains("password='p\\'x'"), "got: {}", connstr);
    connstr
        .parse::<tokio_postgres::Config>()
        .unwrap_or_else(|e| panic!("quoted password rejected by tokio-postgres Config: {} (connstr: {})", e, connstr));
}

#[test]
fn connstr_quotes_password_with_equals() {
    let connstr = parse_pg_connstr(&url("user:p%3Dss@host:5432/db")).unwrap();
    assert!(connstr.contains("password='p=ss'"), "got: {}", connstr);
    connstr
        .parse::<tokio_postgres::Config>()
        .unwrap_or_else(|e| panic!("'=' password rejected by tokio-postgres Config: {} (connstr: {})", e, connstr));
}

// ---------------------------------------------------------------------------
// connstr sslmode normalization (tokio-postgres Config only accepts
// disable/prefer/require; verify-* must be normalized to require)
// ---------------------------------------------------------------------------

#[test]
fn connstr_round_trips_all_tls_sslmode_values() {
    for mode in ["require", "prefer", "verify-ca", "verify-full"] {
        let connstr = parse_pg_connstr(&url(&format!("user:pass@host:5432/db?sslmode={}", mode))).unwrap();
        connstr
            .parse::<tokio_postgres::Config>()
            .unwrap_or_else(|e| {
                panic!("sslmode={} rejected by tokio-postgres Config: {} (connstr: {})", mode, e, connstr)
            });
    }
}

#[test]
fn connstr_normalizes_verify_ca_to_require() {
    let connstr = parse_pg_connstr(&url("user:pass@host:5432/db?sslmode=verify-ca")).unwrap();
    assert!(connstr.contains("sslmode=require"), "got: {}", connstr);
}

#[test]
fn connstr_normalizes_verify_full_to_require() {
    let connstr = parse_pg_connstr(&url("user:pass@host:5432/db?sslmode=verify-full")).unwrap();
    assert!(connstr.contains("sslmode=require"), "got: {}", connstr);
}

#[test]
fn connstr_keeps_require_sslmode() {
    let connstr = parse_pg_connstr(&url("user:pass@host:5432/db?sslmode=require")).unwrap();
    assert!(connstr.contains("sslmode=require"), "got: {}", connstr);
}

// ---------------------------------------------------------------------------
// detect_provider
// ---------------------------------------------------------------------------

#[test]
fn provider_neon_neon_tech() {
    assert_eq!(detect_provider("postgres://u:p@ep-abc.region.aws.neon.tech/db"), "neon");
}

#[test]
fn provider_neon_neondb_host() {
    assert_eq!(detect_provider("postgres://u:p@db.neondb.io/db"), "neon");
}

#[test]
fn provider_supabase_co() {
    assert_eq!(detect_provider("postgres://u:p@db.xyz.supabase.co/db"), "supabase");
}

#[test]
fn provider_supabase_pooler() {
    assert_eq!(detect_provider("postgres://u:p@aws-0-us-east-1.pooler.supabase.com/db"), "supabase");
}

#[test]
fn provider_defaults_to_postgresql() {
    assert_eq!(detect_provider("postgres://u:p@localhost:5432/db"), "postgresql");
}

// ---------------------------------------------------------------------------
// StoredConnection backward compatibility
// ---------------------------------------------------------------------------

#[test]
fn stored_connection_deserializes_old_config_without_new_fields() {
    let json = r#"{"id":"1","name":"dev","url":"postgres://u:p@host/db","provider":"neon"}"#;
    let conn: StoredConnection = serde_json::from_str(json).unwrap();
    assert_eq!(conn.id, "1");
    assert_eq!(conn.provider.as_deref(), Some("neon"));
    assert_eq!(conn.sslmode, None);
    assert_eq!(conn.read_only, None);
    assert_eq!(conn.neon_api_key, None);
}