use serde::Serialize;
use serde_json::{Map, Value};

use crate::db::run_query;
use crate::db_info::{info as db_info, DbPathInfo};
use crate::opencode_files::read_opencode_file as read_opencode_file_impl;
use crate::process::{opencode_running as process_running, opencode_status};

#[derive(Serialize)]
pub struct OpencodeStatusDto {
    /// Existe um processo cujo nome começa com "opencode" (excluindo o HUD)?
    pub running: bool,
    /// Houve atividade nos últimos ~2 min (ou processo está rodando há
    /// pouco tempo)?
    pub recent: bool,
}

#[tauri::command]
pub fn db_query(
    sql: String,
    params: Vec<Value>,
) -> Result<Vec<Map<String, Value>>, String> {
    run_query(&sql, &params)
}

// Nomes expostos ao front casam com os wrappers em `src/lib/data/api.ts`.
#[tauri::command]
pub fn read_opencode_file(kind: String) -> Result<String, String> {
    read_opencode_file_impl(&kind)
}

#[tauri::command]
pub fn opencode_running() -> bool {
    process_running()
}

/// Versão estruturada: devolve running + recent para a UI combinar como quiser.
#[tauri::command]
pub fn opencode_status_cmd() -> OpencodeStatusDto {
    let s = opencode_status();
    OpencodeStatusDto {
        running: s.process_running,
        recent: s.recent_activity,
    }
}

#[tauri::command]
pub fn db_path_info() -> DbPathInfo {
    db_info()
}