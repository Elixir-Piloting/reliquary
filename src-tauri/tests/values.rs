use relic_lib::{format_array_literal, json_to_tosql, numeric_bytes_to_string};
use serde_json::json;
use tokio_postgres::types::{IsNull, Type};
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

fn encode_text(v: &serde_json::Value, ty: &Type) -> String {
    let (buf, is_null) = encode(v, ty);
    assert!(matches!(is_null, IsNull::No), "expected non-null for {v}");
    String::from_utf8(buf.to_vec()).expect("utf-8")
}

#[test]
fn json_null_maps_to_sql_null() {
    let (_, is_null) = encode(&serde_json::Value::Null, &Type::TEXT);
    assert!(matches!(is_null, IsNull::Yes));
}

#[test]
fn json_bool_maps_to_text_true_false() {
    assert_eq!(encode_text(&json!(true), &Type::BOOL), "true");
    assert_eq!(encode_text(&json!(false), &Type::BOOL), "false");
    // Text format lets the server cast to ANY target type (bool, int, ...).
    assert_eq!(encode_text(&json!(true), &Type::INT4), "true");
}

#[test]
fn json_int_maps_to_text() {
    assert_eq!(encode_text(&json!(42), &Type::INT8), "42");
    assert_eq!(encode_text(&json!(-7), &Type::INT8), "-7");
    // Casting to numeric via text is exactly the grid's money/amount case.
    assert_eq!(encode_text(&json!(42), &Type::NUMERIC), "42");
}

#[test]
fn json_float_maps_to_text() {
    assert_eq!(encode_text(&json!(1.5), &Type::FLOAT8), "1.5");
    // numeric columns (decimal amounts) bind via text.
    assert_eq!(encode_text(&json!(12.34), &Type::NUMERIC), "12.34");
}

#[test]
fn json_string_maps_to_text() {
    assert_eq!(encode_text(&json!("hello"), &Type::TEXT), "hello");
    // uuid/jsonb/date/enum columns all accept text and cast server-side.
    assert_eq!(encode_text(&json!("card"), &Type::JSONB), "card");
}

#[test]
fn json_array_maps_to_json_text_string() {
    let v = json!([1, 2, 3]);
    assert_eq!(encode_text(&v, &Type::TEXT), v.to_string());
    assert_eq!(encode_text(&v, &Type::JSONB), v.to_string());
}

#[test]
fn json_object_maps_to_json_text_string() {
    let v = json!({"a": 1, "b": [true, null]});
    assert_eq!(encode_text(&v, &Type::TEXT), v.to_string());
    assert_eq!(encode_text(&v, &Type::JSONB), v.to_string());
}

#[test]
fn json_u64_only_number_maps_to_text() {
    // serde_json numbers that exceed i64 still serialize to their exact text.
    let v = json!(u64::MAX);
    assert_eq!(encode_text(&v, &Type::NUMERIC), v.to_string());
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

#[test]
fn array_literal_quoted_utf8_preserved() {
    assert_eq!(format_array_literal(r#"{"café"}"#), json!(["café"]));
}

// ---------------------------------------------------------------------------
// numeric_bytes_to_string: Postgres NUMERIC binary wire format -> decimal string
//
// Wire layout (network byte order, as written by PostgreSQL's numeric_send):
//   int16 ndigits; int16 weight; int16 sign; int16 dscale; int16 digits[ndigits]
// Sign: 0x0000 positive, 0x4000 negative, 0xC000 NaN, 0xD000 +Inf, 0xF000 -Inf.
// Each base-10000 digit group holds four decimal digits.
// ---------------------------------------------------------------------------

#[test]
fn numeric_zero_renders_as_0() {
    // ndigits=0, weight=0, sign=pos, dscale=0
    assert_eq!(numeric_bytes_to_string(&[0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]).unwrap(), "0");
}

#[test]
fn numeric_one_renders_as_1() {
    // ndigits=1, weight=0, sign=pos, dscale=0, digit=[1]
    assert_eq!(
        numeric_bytes_to_string(&[0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01]).unwrap(),
        "1"
    );
}

#[test]
fn numeric_1234_renders_as_1234() {
    // ndigits=1, weight=0, sign=pos, dscale=0, digit=[1234]
    assert_eq!(
        numeric_bytes_to_string(&[0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x04, 0xD2]).unwrap(),
        "1234"
    );
}

#[test]
fn numeric_10000_renders_as_10000() {
    // ndigits=1, weight=1, sign=pos, dscale=0, digit=[1]  ->  1 * 10000^1
    assert_eq!(
        numeric_bytes_to_string(&[0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01]).unwrap(),
        "10000"
    );
}

#[test]
fn numeric_1_5_renders_as_1_5() {
    // ndigits=2, weight=0, sign=pos, dscale=1, digits=[1, 5000]
    assert_eq!(
        numeric_bytes_to_string(&[0x00, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x13, 0x88]).unwrap(),
        "1.5"
    );
}

#[test]
fn numeric_negative_42_renders_as_minus_42() {
    // ndigits=1, weight=0, sign=neg(0x4000), dscale=0, digit=[42]
    assert_eq!(
        numeric_bytes_to_string(&[0x00, 0x01, 0x00, 0x00, 0x40, 0x00, 0x00, 0x00, 0x00, 0x2A]).unwrap(),
        "-42"
    );
}

#[test]
fn numeric_123456_789_renders_as_123456_789() {
    // ndigits=3, weight=1, sign=pos, dscale=3, digits=[12, 3456, 7890]
    assert_eq!(
        numeric_bytes_to_string(&[
            0x00, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, 0x03, 0x00, 0x0C, 0x0D, 0x80, 0x1E, 0xD2,
        ])
        .unwrap(),
        "123456.789"
    );
}

#[test]
fn numeric_0_05_renders_as_0_05() {
    // ndigits=1, weight=-1, sign=pos, dscale=2, digits=[500] -> 500 * 10000^-1
    assert_eq!(
        numeric_bytes_to_string(&[0x00, 0x01, 0xFF, 0xFF, 0x00, 0x00, 0x00, 0x02, 0x01, 0xF4]).unwrap(),
        "0.05"
    );
}

#[test]
fn numeric_nan_renders_as_nan() {
    // ndigits=0, weight=0, sign=NaN(0xC000), dscale=0
    assert_eq!(
        numeric_bytes_to_string(&[0x00, 0x00, 0x00, 0x00, 0xC0, 0x00, 0x00, 0x00]).unwrap(),
        "NaN"
    );
}

#[test]
fn numeric_positive_infinity_renders() {
    // sign=+Inf(0xD000)
    assert_eq!(
        numeric_bytes_to_string(&[0x00, 0x00, 0x00, 0x00, 0xD0, 0x00, 0x00, 0x00]).unwrap(),
        "Infinity"
    );
}

#[test]
fn numeric_negative_infinity_renders() {
    // sign=-Inf(0xF000)
    assert_eq!(
        numeric_bytes_to_string(&[0x00, 0x00, 0x00, 0x00, 0xF0, 0x00, 0x00, 0x00]).unwrap(),
        "-Infinity"
    );
}

#[test]
fn numeric_truncated_input_is_err() {
    assert!(numeric_bytes_to_string(&[0x00, 0x01]).is_err());
    assert!(numeric_bytes_to_string(&[0x00, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01]).is_err());
}
