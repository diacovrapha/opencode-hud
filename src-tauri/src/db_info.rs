use std::fs;
use std::time::SystemTime;

use serde::Serialize;

use crate::paths::db_path;

#[derive(Serialize)]
pub struct DbPathInfo {
    pub path: String,
    pub exists: bool,
    pub size: u64,
    pub modified: Option<String>,
}

pub fn info() -> DbPathInfo {
    let path = db_path();
    let exists = path.exists();
    let mut size: u64 = 0;
    let mut modified: Option<String> = None;

    if exists {
        if let Ok(meta) = fs::metadata(&path) {
            size = meta.len();
            if let Ok(mtime) = meta.modified() {
                if let Ok(dur) = mtime.duration_since(SystemTime::UNIX_EPOCH) {
                    modified = Some(dur.as_secs().to_string());
                }
            }
        }
    }

    DbPathInfo {
        path: path.to_string_lossy().into_owned(),
        exists,
        size,
        modified,
    }
}