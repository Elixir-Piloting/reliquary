use relic_lib::build_tls;
use relic_lib::PgTls;

// ---------------------------------------------------------------------------
// build_tls -> PgTls variant selection
// ---------------------------------------------------------------------------

#[test]
fn disable_selects_no_tls() {
    let tls = build_tls("disable").unwrap();
    assert!(matches!(tls, PgTls::None(_)));
}

#[test]
fn require_selects_native_tls() {
    let tls = build_tls("require").unwrap();
    assert!(matches!(tls, PgTls::Native(_)));
}

#[test]
fn prefer_selects_native_tls() {
    let tls = build_tls("prefer").unwrap();
    assert!(matches!(tls, PgTls::Native(_)));
}

#[test]
fn verify_ca_selects_native_tls() {
    let tls = build_tls("verify-ca").unwrap();
    assert!(matches!(tls, PgTls::Native(_)));
}

#[test]
fn verify_full_selects_native_tls() {
    let tls = build_tls("verify-full").unwrap();
    assert!(matches!(tls, PgTls::Native(_)));
}

#[test]
fn unknown_mode_is_an_error() {
    assert!(build_tls("bogus").is_err());
}

// ---------------------------------------------------------------------------
// PgTls must be Clone (deadpool-postgres Manager requires it)
// ---------------------------------------------------------------------------

#[test]
fn pg_tls_is_cloneable() {
    let tls = build_tls("require").unwrap();
    let cloned = tls.clone();
    assert!(matches!(cloned, PgTls::Native(_)));
}