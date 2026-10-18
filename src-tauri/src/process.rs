use std::sync::Mutex;
use std::time::{Duration, Instant};

use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};

/// Processo iniciado há menos disso conta como "recente".
const RECENT_SECS: u64 = 120;
/// A listagem de processos custa caro; reaproveitamos o resultado por um tempo.
const CACHE_TTL: Duration = Duration::from_secs(5);

#[derive(Debug, Clone, Default)]
pub struct OpencodeStatus {
    /// Há pelo menos um processo cujo nome começa com "opencode" (exceto o HUD).
    pub process_running: bool,
    /// Algum desses processos foi iniciado há menos de `RECENT_SECS`.
    pub recent_activity: bool,
}

struct Cache {
    sys: System,
    at: Option<Instant>,
    last: OpencodeStatus,
}

static CACHE: Mutex<Option<Cache>> = Mutex::new(None);

/// Status do opencode, com cache de `CACHE_TTL`. Só atualiza a lista de
/// processos (nome + tempo de execução), nunca discos/rede/sensores.
pub fn opencode_status() -> OpencodeStatus {
    let mut guard = match CACHE.lock() {
        Ok(g) => g,
        Err(poisoned) => poisoned.into_inner(),
    };
    let cache = guard.get_or_insert_with(|| Cache {
        sys: System::new(),
        at: None,
        last: OpencodeStatus::default(),
    });

    if let Some(at) = cache.at {
        if at.elapsed() < CACHE_TTL {
            return cache.last.clone();
        }
    }

    cache.sys.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::new().with_exe(UpdateKind::Never),
    );

    let mut status = OpencodeStatus::default();
    for p in cache.sys.processes().values() {
        if matches_opencode(&p.name().to_string_lossy()) {
            status.process_running = true;
            if p.run_time() <= RECENT_SECS {
                status.recent_activity = true;
            }
        }
    }
    cache.at = Some(Instant::now());
    cache.last = status.clone();
    status
}

/// Nome do executável começa com "opencode" (sem diferenciar maiúsculas),
/// excluindo o próprio HUD.
fn matches_opencode(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    let trimmed = lower.trim_end_matches(".exe");
    if trimmed.starts_with("opencode-hud") {
        return false;
    }
    trimmed.starts_with("opencode")
}

#[cfg(test)]
mod tests {
    use super::matches_opencode;

    #[test]
    fn matches_names() {
        assert!(matches_opencode("opencode.exe"));
        assert!(matches_opencode("OpenCode.EXE"));
        assert!(!matches_opencode("opencode-hud.exe"));
        assert!(!matches_opencode("node.exe"));
    }
}
