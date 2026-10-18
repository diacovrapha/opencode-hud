use serde::Serialize;
use serde_json::{Map, Value};

use crate::db::run_query;
use crate::db_info::{info as db_info, DbPathInfo};
use crate::opencode_files::read_opencode_file as read_opencode_file_impl;
use crate::process::opencode_status;

// IMPORTANTE: comandos Tauri síncronos (`pub fn`) rodam na THREAD PRINCIPAL,
// a mesma que cuida das janelas. Qualquer trabalho pesado ali (SQLite, ler
// um JSON de 6 MB, listar processos) congela a UI e enfileira todas as
// outras chamadas IPC. Por isso todos os comandos são `async` e o trabalho
// bloqueante vai para `spawn_blocking`.

async fn blocking<T, F>(f: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| format!("tarefa interna falhou: {e}"))?
}

#[derive(Serialize)]
pub struct OpencodeStatusDto {
    /// Existe um processo cujo nome começa com "opencode" (excluindo o HUD)?
    pub running: bool,
    /// O processo foi iniciado há pouco (~2 min)?
    pub recent: bool,
}

#[tauri::command]
pub async fn db_query(sql: String, params: Vec<Value>) -> Result<Vec<Map<String, Value>>, String> {
    blocking(move || run_query(&sql, &params)).await
}

#[tauri::command]
pub async fn read_opencode_file(kind: String) -> Result<String, String> {
    blocking(move || read_opencode_file_impl(&kind)).await
}

#[tauri::command]
pub async fn opencode_running() -> Result<bool, String> {
    blocking(|| Ok(opencode_status().process_running)).await
}

#[tauri::command]
pub async fn opencode_status_cmd() -> Result<OpencodeStatusDto, String> {
    blocking(|| {
        let s = opencode_status();
        Ok(OpencodeStatusDto { running: s.process_running, recent: s.recent_activity })
    })
    .await
}

#[tauri::command]
pub async fn db_path_info() -> Result<DbPathInfo, String> {
    blocking(|| Ok(db_info())).await
}
