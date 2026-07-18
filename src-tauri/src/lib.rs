mod types;
mod pg;
mod sqlite;
mod commands;

use std::collections::HashMap;
use std::path::PathBuf;
use tauri::Manager;

pub use types::*;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir().unwrap_or_else(|_| PathBuf::from("."));
            let _ = std::fs::create_dir_all(&data_dir);
            let config_path = data_dir.join("connections.json");
            app.manage(AppState {
                connections: tokio::sync::Mutex::new(HashMap::new()),
                config_path,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_connections,
            commands::add_connection,
            commands::update_connection,
            commands::delete_connection,
            commands::test_connection,
            commands::connect,
            commands::disconnect,
            commands::is_connected,
            commands::get_schemas,
            commands::get_tables,
            commands::get_columns,
            commands::get_indexes,
            commands::get_constraints,
            commands::get_relationships,
            commands::get_schema_relationships,
            commands::get_table_data,
            commands::execute_query,
            commands::detect_local_servers,
            commands::list_local_databases,
            commands::create_local_database,
            commands::drop_local_database,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
