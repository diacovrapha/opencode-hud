// Lê caminhos conhecidos do opencode respeitando Windows/Linux/macOS.
use std::path::PathBuf;

pub fn data_dir() -> PathBuf {
    if let Some(home) = dirs::home_dir() {
        return home.join(".local").join("share").join("opencode");
    }
    PathBuf::from(".")
}

pub fn cache_dir() -> PathBuf {
    if let Some(home) = dirs::home_dir() {
        return home.join(".cache").join("opencode");
    }
    PathBuf::from(".")
}

pub fn config_dir() -> PathBuf {
    if let Some(home) = dirs::home_dir() {
        return home.join(".config").join("opencode");
    }
    PathBuf::from(".")
}

pub fn db_path() -> PathBuf {
    data_dir().join("opencode.db")
}

pub fn models_path() -> PathBuf {
    cache_dir().join("models.json")
}

pub fn config_path() -> PathBuf {
    let cfg = config_dir();
    let jsonc = cfg.join("opencode.jsonc");
    if jsonc.exists() {
        return jsonc;
    }
    cfg.join("opencode.json")
}

pub fn agents_dir() -> PathBuf {
    config_dir().join("agents")
}