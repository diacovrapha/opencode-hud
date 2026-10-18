use serde_json::{Map, Value};

use crate::db::run_query;
use crate::db_info::{info as db_info, DbPathInfo};
use crate::opencode_files::read_opencode_file;
use crate::process::opencode_running;

#[tauri::command]
pub fn db_query(
    sql: String,
    params: Vec<Value>,
) -> Result<Vec<Map<String, Value>>, String> {
    run_query(&sql, &params)
}

#[tauri::command]
pub fn read_opencode_file_cmd(kind: String) -> Result<String, String> {
    read_opencode_file(&kind)
}

#[tauri::command]
pub fn opencode_running_cmd() -> bool {
    opencode_running()
}

#[tauri::command]
pub fn db_path_info_cmd() -> DbPathInfo {
    db_info()
}