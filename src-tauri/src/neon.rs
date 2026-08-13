use crate::types::NeonBranch;
use serde_json::Value;
use std::collections::HashMap;

// ---------------------------------------------------------------------------
// Neon management API client (https://console.neon.tech/api/v2)
//
// Verified against https://api-docs.neon.tech (2026-08):
//   GET /projects                      -> { "projects": [{ "id": ... }] }
//   GET /projects/{id}/branches        -> { "branches": [{ "id", "name",
//                                          "created_at", "updated_at",
//                                          "default": bool }] }
//   GET /projects/{id}/endpoints       -> { "endpoints": [{ "branch_id",
//                                          "host": "ep-...-pooler..." }] }
//
// The branches list endpoint does NOT return connection URIs, and there is no
// `GET /projects/{id}/connections` endpoint in the current API. The verified
// per-branch host source is the endpoints list, so we build each branch's
// connection_uri by substituting the endpoint host into the connection URL.
// If the endpoints call fails or a branch has no endpoint, connection_uri is
// None and the frontend falls back to URL-pattern construction.
// ---------------------------------------------------------------------------

const NEON_API_BASE: &str = "https://console.neon.tech/api/v2";

/// Derive the Neon project id from a connection host, or None when it cannot
/// be determined:
///   - session host   `{project_id}.{region}.neon.tech`   -> project_id
///   - pooled host    `{project_id}-pooler...`            -> project_id
///   - pooled host    `ep-{endpoint}-pooler...`           -> None (endpoint id
///     is not the project id; caller must fall back to the projects list)
pub fn derive_project_id(host: &str) -> Option<String> {
    let lower = host.to_lowercase();
    let first = lower.split('.').next().unwrap_or_default();
    if first.is_empty() || first.starts_with("ep-") {
        return None;
    }
    if let Some(stripped) = first.strip_suffix("-pooler") {
        if stripped.is_empty() {
            return None;
        }
        return Some(stripped.to_string());
    }
    Some(first.to_string())
}

/// Replace the host in a PostgreSQL URL with the branch's endpoint host.
fn build_branch_uri(conn_url: &str, endpoint_host: &str) -> Result<String, String> {
    let parts = crate::pg::parse_pg_url(conn_url)?;
    if !parts.host.contains("neon.tech") || !conn_url.contains(&parts.host) {
        return Err("Not a Neon host".into());
    }
    Ok(conn_url.replacen(&parts.host, endpoint_host, 1))
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))
}

async fn neon_get(client: &reqwest::Client, api_key: &str, path: &str) -> Result<Value, String> {
    let url = format!("{}{}", NEON_API_BASE, path);
    let resp = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .send()
        .await
        .map_err(|e| format!("Neon API request failed: {}", e))?;
    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!("Neon API error: HTTP {} - {}", status.as_u16(), body));
    }
    serde_json::from_str(&body).map_err(|e| format!("Neon API: invalid JSON response: {}", e))
}

pub async fn list_neon_branches(api_key: &str, url: &str) -> Result<Vec<NeonBranch>, String> {
    let client = client()?;
    let parts = crate::pg::parse_pg_url(url)?;
    let host = parts.host.clone();

    let projects = neon_get(&client, api_key, "/projects").await?;
    let projects = projects
        .get("projects")
        .and_then(|p| p.as_array())
        .ok_or("Neon API: response missing 'projects' list")?;
    let project_id = match derive_project_id(&host) {
        Some(candidate) if projects.iter().any(|p| p.get("id").and_then(|i| i.as_str()) == Some(candidate.as_str())) => candidate,
        _ => projects
            .first()
            .and_then(|p| p.get("id").and_then(|i| i.as_str()))
            .ok_or("No Neon projects found for this API key")?
            .to_string(),
    };

    let branches = neon_get(&client, api_key, &format!("/projects/{}/branches", project_id)).await?;
    let branches = branches
        .get("branches")
        .and_then(|b| b.as_array())
        .ok_or("Neon API: response missing 'branches' list")?;

    let mut endpoint_hosts: HashMap<String, String> = HashMap::new();
    if let Ok(endpoints) = neon_get(&client, api_key, &format!("/projects/{}/endpoints", project_id)).await {
        if let Some(list) = endpoints.get("endpoints").and_then(|e| e.as_array()) {
            for ep in list {
                if let (Some(branch_id), Some(host)) =
                    (ep.get("branch_id").and_then(|b| b.as_str()), ep.get("host").and_then(|h| h.as_str()))
                {
                    endpoint_hosts.entry(branch_id.to_string()).or_insert_with(|| host.to_string());
                }
            }
        }
    }

    let mut out = Vec::with_capacity(branches.len());
    for b in branches {
        let id = b.get("id").and_then(|i| i.as_str()).unwrap_or_default().to_string();
        let name = b.get("name").and_then(|n| n.as_str()).unwrap_or_default().to_string();
        let created_at = b.get("created_at").and_then(|c| c.as_str()).unwrap_or_default().to_string();
        let updated_at = b.get("updated_at").and_then(|u| u.as_str()).unwrap_or_default().to_string();
        let primary = b
            .get("default")
            .and_then(|d| d.as_bool())
            .or_else(|| b.get("primary").and_then(|p| p.as_bool()))
            .unwrap_or(false);
        let connection_uri = endpoint_hosts.get(&id).and_then(|h| build_branch_uri(url, h).ok());
        out.push(NeonBranch { id, name, created_at, updated_at, primary, connection_uri });
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn derives_project_id_from_session_host() {
        assert_eq!(
            derive_project_id("shiny-wind-028834.us-east-2.aws.neon.tech"),
            Some("shiny-wind-028834".to_string())
        );
    }

    #[test]
    fn pooled_ep_host_not_derivable() {
        assert_eq!(
            derive_project_id("ep-little-smoke-851426-pooler.us-east-2.aws.neon.tech"),
            None
        );
    }

    #[test]
    fn pooled_suffix_stripped_for_plain_project_host() {
        assert_eq!(
            derive_project_id("shiny-wind-028834-pooler.us-east-2.aws.neon.tech"),
            Some("shiny-wind-028834".to_string())
        );
    }

    #[test]
    fn plain_host_passes_through() {
        assert_eq!(derive_project_id("localhost"), Some("localhost".to_string()));
    }

    #[test]
    fn branch_uri_replaces_host_only() {
        let uri = build_branch_uri(
            "postgresql://user:pass@ep-abc-123-pooler.us-east-2.aws.neon.tech/db?sslmode=require",
            "ep-abc-123.us-east-2.aws.neon.tech",
        )
        .unwrap();
        assert_eq!(
            uri,
            "postgresql://user:pass@ep-abc-123.us-east-2.aws.neon.tech/db?sslmode=require"
        );
    }

    #[test]
    fn branch_uri_rejects_non_neon_host() {
        assert!(build_branch_uri("postgresql://user@localhost/db", "ep-abc.us-east-2.aws.neon.tech").is_err());
    }

    #[test]
    fn neon_branch_serializes_camel_case() {
        let b = NeonBranch {
            id: "br-aged-salad-637688".into(),
            name: "main".into(),
            created_at: "2022-11-23T17:42:25Z".into(),
            updated_at: "2022-11-23T17:42:26Z".into(),
            primary: true,
            connection_uri: Some("postgresql://user:pass@ep-abc.us-east-2.aws.neon.tech/main".into()),
        };
        let j = serde_json::to_value(&b).unwrap();
        assert_eq!(j["id"], "br-aged-salad-637688");
        assert_eq!(j["name"], "main");
        assert_eq!(j["createdAt"], "2022-11-23T17:42:25Z");
        assert_eq!(j["updatedAt"], "2022-11-23T17:42:26Z");
        assert_eq!(j["primary"], true);
        assert_eq!(j["connectionUri"], "postgresql://user:pass@ep-abc.us-east-2.aws.neon.tech/main");
        assert!(j.get("connection_uri").is_none(), "must not serialize snake_case key");
    }

    #[test]
    fn neon_branch_omits_missing_connection_uri() {
        let b = NeonBranch {
            id: "br-x".into(),
            name: "dev".into(),
            created_at: "t".into(),
            updated_at: "t".into(),
            primary: false,
            connection_uri: None,
        };
        let j = serde_json::to_value(&b).unwrap();
        assert!(j.get("connectionUri").is_none());
        assert!(j.get("connection_uri").is_none());
    }
}
