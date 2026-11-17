//! Secret storage backed by the OS credential store (via the `keyring` crate).
//!
//! Password-style secrets (connection passwords, Neon API keys, local-server
//! passwords) are kept out of the plaintext `connections.json` file and stored
//! in Windows Credential Manager / macOS Keychain / Linux Secret Service instead.

const SERVICE: &str = "reliquary";

fn entry(account: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, account).map_err(|e| format!("Failed to create credential entry: {}", e))
}

pub fn set_secret(account: &str, value: &str) -> Result<(), String> {
    entry(account)?
        .set_password(value)
        .map_err(|e| format!("Failed to store secret: {}", e))
}

pub fn get_secret(account: &str) -> Result<Option<String>, String> {
    match entry(account)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("Failed to read secret: {}", e)),
    }
}

pub fn delete_secret(account: &str) {
    let Ok(entry) = entry(account) else { return; };
    let _ = entry.delete_credential();
}

fn conn_password_account(connection_id: &str) -> String {
    format!("conn:{}:password", connection_id)
}

fn neon_key_account(connection_id: &str) -> String {
    format!("conn:{}:neon_api_key", connection_id)
}

fn local_password_account(host: &str, port: u16) -> String {
    format!("local:{}:{}", host, port)
}

// ---------------------------------------------------------------------------
// Connection password / Neon API key
// ---------------------------------------------------------------------------

pub fn set_connection_password(connection_id: &str, password: &str) -> Result<(), String> {
    if password.is_empty() {
        delete_secret(&conn_password_account(connection_id));
        return Ok(());
    }
    set_secret(&conn_password_account(connection_id), password)
}

pub fn get_connection_password(connection_id: &str) -> Option<String> {
    get_secret(&conn_password_account(connection_id)).ok().flatten()
}

pub fn delete_connection_password(connection_id: &str) {
    delete_secret(&conn_password_account(connection_id));
}

pub fn set_neon_api_key(connection_id: &str, key: &str) -> Result<(), String> {
    set_secret(&neon_key_account(connection_id), key)
}

pub fn get_neon_api_key(connection_id: &str) -> Option<String> {
    get_secret(&neon_key_account(connection_id)).ok().flatten()
}

pub fn delete_neon_api_key(connection_id: &str) {
    delete_secret(&neon_key_account(connection_id));
}

// ---------------------------------------------------------------------------
// Local server passwords (keyed by host:port, value = "user\0password")
// ---------------------------------------------------------------------------

const SEP: char = '\u{0}';

pub fn set_local_password(host: &str, port: u16, user: &str, password: &str) -> Result<(), String> {
    if password.is_empty() {
        delete_secret(&local_password_account(host, port));
        return Ok(());
    }
    set_secret(&local_password_account(host, port), &format!("{}{}{}", user, SEP, password))
}

pub fn get_local_password(host: &str, port: u16) -> Option<(String, String)> {
    let raw = get_secret(&local_password_account(host, port)).ok().flatten()?;
    let (user, pass) = raw.split_once(SEP)?;
    Some((user.to_string(), pass.to_string()))
}

pub fn remove_local_password(host: &str, port: u16) {
    delete_secret(&local_password_account(host, port));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strip_yields_single_at_url_and_recovers_password() {
        let (stripped, pw) = split_url_password("postgresql://user:p%40ss@host:5432/db?sslmode=require");
        assert_eq!(pw, "p@ss");
        assert_eq!(stripped, "postgresql://user@host:5432/db?sslmode=require");
        assert!(!stripped.contains("@@"), "stripped URL must not contain a double @: {}", stripped);
    }

    #[test]
    fn stripped_url_reparses_to_same_user_without_password() {
        let (stripped, _) = split_url_password("postgres://user:pass@host:5432/db");
        let parts = crate::pg::parse_pg_url(&stripped).unwrap();
        assert_eq!(parts.user, "user");
        assert_eq!(parts.password, "");
        assert_eq!(parts.host, "host");
        assert_eq!(parts.db, "db");
    }

    #[test]
    fn url_without_credentials_passes_through_unchanged() {
        assert_eq!(split_url_password("postgres://host/db").0, "postgres://host/db");
        assert_eq!(split_url_password("postgres://user@host/db").0, "postgres://user@host/db");
    }

    #[test]
    fn legacy_double_at_url_is_left_stable() {
        // URLs already stored by the old buggy strip must round-trip unchanged
        // (parse_pg_url's trailing-@ branch recovers the user).
        let mangled = "postgres://user@@host:5432/db";
        let (out, pw) = split_url_password(mangled);
        assert_eq!(out, mangled);
        assert_eq!(pw, "");
    }

    #[test]
    fn non_url_input_passes_through_unchanged() {
        assert_eq!(split_url_password("not a url").1, "");
        assert_eq!(split_url_password("not a url").0, "not a url");
    }
}

// ---------------------------------------------------------------------------
// Connection URL password handling
// ---------------------------------------------------------------------------

/// Split a postgres URL into `(url_without_password, decoded_password)`.
///
/// `postgresql://user:pass@host:port/db` -> (`postgresql://user@host:port/db`, "pass").
/// A URL with no credentials (or no password) yields an unchanged URL and an
/// empty password.
pub fn split_url_password(url: &str) -> (String, String) {
    let Some(scheme_end) = url.find("://") else {
        return (url.to_string(), String::new());
    };
    let head = &url[..scheme_end + 3];
    let rest = &url[scheme_end + 3..];
    let Some(at) = rest.rfind('@') else {
        return (url.to_string(), String::new());
    };
    let creds = &rest[..at];
    if let Some(colon) = creds.find(':') {
        let user = &creds[..colon];
        let pass = &creds[colon + 1..];
        // `rest[at..]` still carries the '@', so this yields a single-@ form
        // ("postgresql://user@host…"). Appending another '@' here used to
        // produce "user@@host" URLs.
        let stripped = format!("{}{}{}", head, user, &rest[at..]);
        (stripped, crate::pg::urlencoding_or_raw(pass))
    } else {
        (url.to_string(), String::new())
    }
}
