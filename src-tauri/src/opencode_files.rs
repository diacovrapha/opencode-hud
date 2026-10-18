use std::fs;
use std::path::Path;

use serde_json::{Map, Value};

use crate::paths::{agents_dir, config_path, models_path};

/// Lê arquivos do opencode respeitando uma whitelist estrita.
pub fn read_opencode_file(kind: &str) -> Result<String, String> {
    match kind {
        "models" => read_to_string(&models_path()),
        "config" => read_to_string(&config_path()),
        "agents" => collect_agents(),
        other => Err(format!("kind não suportado: {other}")),
    }
}

fn read_to_string(path: &Path) -> Result<String, String> {
    if !path.exists() {
        return Err(format!("arquivo não encontrado: {}", path.display()));
    }
    fs::read_to_string(path).map_err(|e| format!("ler {}: {e}", path.display()))
}

fn collect_agents() -> Result<String, String> {
    let dir = agents_dir();
    if !dir.exists() {
        return Err(format!("diretório não existe: {}", dir.display()));
    }
    let entries = fs::read_dir(&dir).map_err(|e| format!("listar {}: {e}", dir.display()))?;
    let mut map = Map::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("md") {
            continue;
        }
        let name = match path.file_name().and_then(|s| s.to_str()) {
            Some(s) => s.to_string(),
            None => continue,
        };
        let body = fs::read_to_string(&path)
            .map_err(|e| format!("ler {}: {e}", path.display()))?;
        map.insert(name, Value::String(body));
    }
    Ok(Value::Object(map).to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unknown_kind_errors() {
        let err = read_opencode_file("secret").unwrap_err();
        assert!(err.contains("não suportado"));
    }
}