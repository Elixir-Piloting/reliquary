use relic_lib::{format_array_literal, json_to_tosql};
use serde_json::json;
use tokio_postgres::types::{FromSql, IsNull, Type};
use tokio_postgres::types::private::BytesMut;

// ---------------------------------------------------------------------------
// json_to_tosql -> Box<dyn ToSql + Sync>
//
// Round-trips through the real ToSql machinery (object-safe to_sql_checked)
// and FromSql decoding, with the Type matching the concrete Rust type each
// JSON shape should map to.
// ---------------------------------------------------------------------------

fn encode(v: &serde_json::Value, ty: &Type) -> (BytesMut, IsNull) {
    let b = json_to_tosql(v);
    let mut buf = BytesMut::new();
    let is_null = b.to_sql_checked(ty, &mut buf).expect("to_sql_checked should succeed");
    (buf, is_null)
}

#[test]
fn json_null_maps_to_sql_null() {
    let (_, is_null) = encode(&serde_json::Value::Null, &Type::TEXT);
    assert!(matches!(is_null, IsNull::Yes));
}

#[test]
fn json_bool_round_trips_as_sql_bool() {
    for value in [true, false] {
        let (buf, is_null) = encode(&json!(value), &Type::BOOL);
        assert!(matches!(is_null, IsNull::No));
        let decoded = bool::from_sql(&Type::BOOL, &buf).unwrap();
        assert_eq!(decoded, value);
    }
}

#[test]
fn json_int_round_trips_as_sql_int8() {
    let (buf, is_null) = encode(&json!(42), &Type::INT8);
    assert!(matches!(is_null, IsNull::No));
    let decoded = i64::from_sql(&Type::INT8, &buf).unwrap();
    assert_eq!(decoded, 42);
}

#[test]
fn json_negative_int_round_trips_as_sql_int8() {
    let (buf, _) = encode(&json!(-7), &Type::INT8);
    let decoded = i64::from_sql(&Type::INT8, &buf).unwrap();
    assert_eq!(decoded, -7);
}

#[test]
fn json_float_round_trips_as_sql_float8() {
    let (buf, is_null) = encode(&json!(1.5), &Type::FLOAT8);
    assert!(matches!(is_null, IsNull::No));
    let decoded = f64::from_sql(&Type::FLOAT8, &buf).unwrap();
    assert_eq!(decoded, 1.5);
}

#[test]
fn json_string_round_trips_as_sql_text() {
    let (buf, is_null) = encode(&json!("hello"), &Type::TEXT);
    assert!(matches!(is_null, IsNull::No));
    let decoded = String::from_sql(&Type::TEXT, &buf).unwrap();
    assert_eq!(decoded, "hello");
}

#[test]
fn json_array_maps_to_json_text_string() {
    let v = json!([1, 2, 3]);
    let (buf, is_null) = encode(&v, &Type::TEXT);
    assert!(matches!(is_null, IsNull::No));
    let decoded = String::from_sql(&Type::TEXT, &buf).unwrap();
    assert_eq!(decoded, v.to_string());
}

#[test]
fn json_object_maps_to_json_text_string() {
    let v = json!({"a": 1, "b": [true, null]});
    let (buf, is_null) = encode(&v, &Type::TEXT);
    assert!(matches!(is_null, IsNull::No));
    let decoded = String::from_sql(&Type::TEXT, &buf).unwrap();
    assert_eq!(decoded, v.to_string());
}

#[test]
fn json_u64_only_number_maps_to_float8() {
    // u64::MAX is not i64 but serde_json always provides as_f64, so it binds
    // as f64 (i64 -> f64 -> string priority per the mapping).
    let v = json!(u64::MAX);
    let (buf, is_null) = encode(&v, &Type::FLOAT8);
    assert!(matches!(is_null, IsNull::No));
    let decoded = f64::from_sql(&Type::FLOAT8, &buf).unwrap();
    assert_eq!(decoded, u64::MAX as f64);
}

// ---------------------------------------------------------------------------
// format_array_literal: Postgres array literal text -> serde_json::Value
// ---------------------------------------------------------------------------

#[test]
fn array_literal_single_dimension_ints() {
    assert_eq!(format_array_literal("{1,2,3}"), json!([1, 2, 3]));
}

#[test]
fn array_literal_nested_arrays() {
    assert_eq!(format_array_literal("{{1,2},{3,4}}"), json!([[1, 2], [3, 4]]));
}

#[test]
fn array_literal_quoted_string_elements() {
    assert_eq!(format_array_literal("{\"a:1\",\"b\"}"), json!(["a:1", "b"]));
}

#[test]
fn array_literal_empty() {
    assert_eq!(format_array_literal("{}"), json!([]));
}

#[test]
fn array_literal_null_element() {
    assert_eq!(format_array_literal("{NULL}"), json!([null]));
}

#[test]
fn array_literal_mixed_float_and_int() {
    assert_eq!(format_array_literal("{1.5,-2}"), json!([1.5, -2]));
}

#[test]
fn array_literal_mixed_string_and_number() {
    assert_eq!(format_array_literal("{\"x\",1}"), json!(["x", 1]));
}

#[test]
fn array_literal_escaped_double_quote() {
    assert_eq!(format_array_literal("{\"a\"\"b\"}"), json!(["a\"b"]));
}

#[test]
fn array_literal_unbalanced_returns_null() {
    assert_eq!(format_array_literal("{1,2"), serde_json::Value::Null);
    assert_eq!(format_array_literal("{"), serde_json::Value::Null);
    assert_eq!(format_array_literal("{\"a\""), serde_json::Value::Null);
}
