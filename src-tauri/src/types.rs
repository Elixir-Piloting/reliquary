use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

// ---------------------------------------------------------------------------
// Storage types
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StoredConnection {
    pub id: String,
    pub name: String,
    pub url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sslmode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub read_only: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub neon_api_key: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaInfo {
    pub schema_name: String,
    pub tables_count: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableInfo {
    pub table_name: String,
    pub schema_name: String,
    pub table_type: String,
    pub row_count: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub has_rls: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewInfo {
    pub view_name: String,
    pub definition: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TriggerInfo {
    pub trigger_name: String,
    pub event_manipulation: String,
    pub action_timing: String,
    pub action_statement: String,
    pub enabled: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FunctionInfo {
    pub function_name: String,
    pub arguments: String,
    pub return_type: String,
    pub language: String,
    pub volatility: String,
    pub security_definer: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RlsPolicyInfo {
    pub policy_name: String,
    pub command: String,
    pub roles: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub using_expression: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub check_expression: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoleInfo {
    pub role_name: String,
    pub superuser: bool,
    pub createdb: bool,
    pub createrole: bool,
    pub login: bool,
    pub connection_limit: i32,
    pub member_of: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnInfo {
    pub column_name: String,
    pub data_type: String,
    pub is_nullable: bool,
    pub is_primary_key: bool,
    pub default_value: Option<String>,
    pub max_length: Option<i32>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexInfo {
    pub index_name: String,
    pub column_name: String,
    pub is_unique: bool,
    pub is_primary: bool,
    pub index_type: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConstraintInfo {
    pub constraint_name: String,
    pub constraint_type: String,
    pub column_name: String,
    pub foreign_table_schema: Option<String>,
    pub foreign_table_name: Option<String>,
    pub foreign_column_name: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelationshipInfo {
    pub constraint_name: String,
    pub source_schema: String,
    pub source_table: String,
    pub source_column: String,
    pub target_schema: String,
    pub target_table: String,
    pub target_column: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableDataResult {
    pub columns: Vec<ColumnMeta>,
    pub rows: Vec<HashMap<String, serde_json::Value>>,
    pub total_count: i64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnMeta {
    pub name: String,
    pub data_type: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryResult {
    pub columns: Vec<ColumnMeta>,
    pub rows: Vec<HashMap<String, serde_json::Value>>,
    pub row_count: usize,
    pub affected_rows: Option<u64>,
    pub is_select: bool,
    pub execution_time_ms: u64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TestConnectionResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub server_version: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RowMutationStatement {
    pub query: String,
    pub params: Vec<serde_json::Value>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExplainResult {
    pub plan: serde_json::Value,
    pub execution_time_ms: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct QueryOptions {
    pub confirm_destructive: bool,
    pub read_only: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalPgServer {
    pub key: String,
    pub host: String,
    pub port: u16,
    pub running: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalPgDatabase {
    pub name: String,
    pub owner: String,
    pub encoding: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NeonBranch {
    pub id: String,
    pub name: String,
    pub created_at: String,
    pub updated_at: String,
    pub primary: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub connection_uri: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionInfo {
    pub provider: String,
    pub host: String,
    pub port: String,
    pub database: String,
    pub user: String,
    pub server_version: String,
    pub sslmode: String,
    pub is_supabase: bool,
    pub is_neon: bool,
    pub supabase_schemas: Vec<String>,
    pub read_only: bool,
    pub pooled_endpoint: bool,
}

// ---------------------------------------------------------------------------
// App state
// ---------------------------------------------------------------------------

pub struct ActiveConnection {
    pub pool: Arc<deadpool_postgres::Pool>,
    pub read_only: bool,
    pub url: String,
}

pub struct AppState {
    pub connections: tokio::sync::Mutex<HashMap<String, ActiveConnection>>,
    pub config_path: PathBuf,
}

impl AppState {
    pub fn load_config(&self) -> Vec<StoredConnection> {
        if !self.config_path.exists() {
            return Vec::new();
        }
        match std::fs::read_to_string(&self.config_path) {
            Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
            Err(_) => Vec::new(),
        }
    }

    pub fn save_config(&self, conns: &[StoredConnection]) {
        if let Some(dir) = self.config_path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        if let Ok(content) = serde_json::to_string_pretty(conns) {
            let _ = std::fs::write(&self.config_path, content);
        }
    }
}

pub fn detect_provider(url: &str) -> &'static str {
    let lower = url.to_lowercase();
    if lower.contains("neon.tech") || lower.contains("neondb") { "neon" }
    else if lower.contains("supabase.co") || lower.contains("pooler.supabase") { "supabase" }
    else { "postgresql" }
}
