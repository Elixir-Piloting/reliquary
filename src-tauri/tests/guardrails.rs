use relic_lib::{is_destructive, is_select_query, RowMutationStatement};

// ---------------------------------------------------------------------------
// is_destructive — destructive-query detection (pure, DB-free)
// ---------------------------------------------------------------------------

#[test]
fn destructive_queries_are_detected() {
    let destructive = [
        "drop table x",
        "DELETE FROM t",
        "TRUNCATE t",
        "UPDATE t SET a=1",
        "ALTER TABLE t ADD c int",
        "CREATE TABLE x()",
        "GRANT SELECT ON t TO r",
        "REVOKE SELECT ON t FROM r",
        "VACUUM",
        "REINDEX",
    ];
    for sql in destructive {
        assert!(is_destructive(sql), "expected destructive: {sql:?}");
    }
}

#[test]
fn non_destructive_queries_are_allowed() {
    let safe = [
        "select * from t",
        "SELECT 1",
        "show search_path",
        "with x as (select 1) select * from x",
        "  select 1",
        "EXPLAIN SELECT 1",
    ];
    for sql in safe {
        assert!(!is_destructive(sql), "expected safe: {sql:?}");
    }
}

#[test]
fn comment_and_whitespace_bypass_attempts_are_blocked() {
    let bypasses = [
        "/*c*/DELETE FROM t",
        "\n  drop table x",
        "--comment\nDROP TABLE z",
        "/* block */ /* nested-ish */ UPDATE t SET a=1",
    ];
    for sql in bypasses {
        assert!(is_destructive(sql), "expected destructive: {sql:?}");
    }
}

#[test]
fn cte_wrapped_writes_are_detected() {
    let bypasses = [
        "WITH x AS (SELECT 1) DELETE FROM t",
        "WITH x AS () DELETE FROM t",
        "WITH RECURSIVE x(a) AS (SELECT 1) UPDATE t SET a = 1",
        "with x as (/* c ; */ select 1) delete from t",
        "WITH t(a, b) AS (VALUES (1, 2)) TRUNCATE x",
    ];
    for sql in bypasses {
        assert!(is_destructive(sql), "expected destructive: {sql:?}");
    }
}

#[test]
fn multi_statement_inputs_scan_every_statement() {
    assert!(is_destructive("select 1; drop table y"));
    assert!(is_destructive("SELECT 1;\nDELETE FROM t"));
    assert!(is_destructive("select ';' as s; update t set a = 1"));
    assert!(is_destructive("SELECT 1; -- comment\nTRUNCATE t"));
    assert!(is_destructive("/* drop x; */ select 1; revoke ALL ON t FROM r"));
    assert!(!is_destructive("select 1; select 2"));
    assert!(!is_destructive("select 1;"));
}

#[test]
fn quoted_semicolons_do_not_split_statements() {
    // A semicolon inside a string literal or quoted identifier must not split.
    assert!(!is_destructive("select ';' as s"));
    assert!(!is_destructive("select 1"));
    assert!(!is_destructive("WITH x AS (SELECT 'a;b'::text) SELECT * FROM x"));
}

#[test]
fn explain_that_executes_a_destructive_query_is_detected() {
    // EXPLAIN ANALYZE actually runs the statement — a write must not slip through.
    assert!(is_destructive("explain analyze delete from t"));
    assert!(is_destructive("EXPLAIN (ANALYZE true, BUFFERS true) UPDATE t SET a = 1"));
    assert!(is_destructive("EXPLAIN ANALYZE WITH x AS (SELECT 1) DELETE FROM t"));
}

#[test]
fn plain_explain_is_not_destructive() {
    let safe = [
        "EXPLAIN SELECT 1",
        "EXPLAIN (FORMAT JSON) SELECT 1",
        "EXPLAIN (ANALYZE false) DELETE FROM t",
        "EXPLAIN (FORMAT JSON, BUFFERS true) UPDATE t SET a = 1",
        "EXPLAIN VERBOSE SELECT 1",
        "explain (buffers true, format text) select 1",
    ];
    for sql in safe {
        assert!(!is_destructive(sql), "expected safe: {sql:?}");
    }
}

#[test]
fn empty_and_comment_only_inputs_are_not_destructive() {
    assert!(!is_destructive(""));
    assert!(!is_destructive("   \n\t  "));
    assert!(!is_destructive("-- only a line comment"));
    assert!(!is_destructive("/* only a block comment */"));
}

#[test]
fn insert_is_not_in_the_destructive_set() {
    // Per the brief, the destructive-confirmation set is exactly
    // {drop, delete, truncate, update, alter, create, grant, revoke, vacuum,
    // reindex}. INSERT is a mutation handled via the read-only / mutate_rows paths.
    assert!(!is_destructive("INSERT INTO t VALUES (1)"));
    assert!(!is_destructive("with x as (select 1) insert into t select * from x"));
}

// ---------------------------------------------------------------------------
// is_select_query — read-only gate helper (pure, DB-free)
// ---------------------------------------------------------------------------

#[test]
fn select_detection() {
    assert!(is_select_query("select * from t"));
    assert!(is_select_query("  WITH x AS (SELECT 1) SELECT * FROM x"));
    assert!(is_select_query("explain select 1"));
    assert!(is_select_query("show search_path"));
    assert!(is_select_query("values (1), (2)"));
    assert!(!is_select_query("update t set a = 1"));
    assert!(!is_select_query("delete from t"));
    assert!(!is_select_query(""));
    assert!(!is_select_query("-- comment only"));
}

// ---------------------------------------------------------------------------
// RowMutationStatement — serde round-trip (pure, DB-free)
// ---------------------------------------------------------------------------

#[test]
fn row_mutation_statement_round_trips_through_json() {
    let stmt = RowMutationStatement {
        query: "UPDATE grid SET val = $1 WHERE id = $2".to_string(),
        params: vec![serde_json::json!({"v": 1}), serde_json::json!("x")],
    };
    let json = serde_json::to_string(&stmt).expect("serialize");
    let back: RowMutationStatement = serde_json::from_str(&json).expect("deserialize");
    assert_eq!(back.query, stmt.query);
    assert_eq!(back.params, stmt.params);
}
