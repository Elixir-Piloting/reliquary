use std::str::FromStr;

use relic_lib::build_tls;

// ---------------------------------------------------------------------------
// deadpool-postgres integration (compile-level; no live DB)
// ---------------------------------------------------------------------------

// PgTls must satisfy deadpool-postgres's `Manager::new` bounds
// (MakeTlsConnect<Socket> + Clone + Send + Sync). Building the Manager and a
// Pool here is a compile-time guarantee; nothing connects to a server.
#[test]
fn pg_tls_builds_a_deadpool_pool() {
    let tls = build_tls("require").unwrap();
    let cfg = tokio_postgres::Config::from_str("host=localhost port=5432 dbname=postgres").unwrap();
    let manager = deadpool_postgres::Manager::new(cfg, tls);
    let pool = deadpool_postgres::Pool::builder(manager)
        .max_size(8)
        .build()
        .unwrap();
    let _ = pool;
}