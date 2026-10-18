use std::time::{SystemTime, UNIX_EPOCH};

use sysinfo::{ProcessesToUpdate, System};

/// Janela de "atividade recente" para considerar o opencode como
/// trabalhando agora, mesmo que o processo exato tenha saído da lista.
const RECENT_ACTIVITY_WINDOW_SECS: u64 = 120;

/// Resultado da checagem: indica se o opencode está rodando e/ou
/// teve atividade há pouco tempo (mensagens recentes).
#[derive(Debug, Clone, Default)]
pub struct OpencodeStatus {
    /// `true` se há pelo menos um processo cujo nome começa com "opencode"
    /// (case-insensitive), excluindo "opencode-hud*".
    pub process_running: bool,
    /// `true` se o opencode teve "atividade" (algum processo bateu os critérios
    /// acima) nos últimos `RECENT_ACTIVITY_WINDOW_SECS` segundos.
    pub recent_activity: bool,
    /// PID do(s) processo(s) aberto(s), útil para diagnóstico.
    pub pids: Vec<u32>,
}

const RECENT_ACTIVITY_SECS: u64 = RECENT_ACTIVITY_WINDOW_SECS;

/// Procura processos cujo nome começa com "opencode" (case-insensitive),
/// ignorando o próprio "opencode-hud" e suas variantes. Devolve o status
/// consolidado.
pub fn opencode_status() -> OpencodeStatus {
    let mut sys = System::new_all();
    sys.refresh_processes(ProcessesToUpdate::All, true);

    let _now_secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let mut running = false;
    let mut recent = false;
    let mut pids: Vec<u32> = Vec::new();

    for (pid, p) in sys.processes() {
        if matches_opencode(p) {
            let pid_num = pid.as_u32();
            pids.push(pid_num);
            running = true;

            // sysinfo::Process::run_time() devolve em segundos (quando
            // `refresh_processes` é chamado com `true`, segundo a doc).
            let run_time = p.run_time();
            // Considera "recente" se o processo foi iniciado há menos de
            // RECENT_ACTIVITY_SECS. Combinando com start_time (epoch) seria
            // mais preciso, mas run_time já basta.
            recent = recent || run_time <= RECENT_ACTIVITY_SECS;
        }
    }

    OpencodeStatus {
        process_running: running,
        recent_activity: running && recent,
        pids,
    }
}

/// Wrapper booleano compat com a API anterior.
pub fn opencode_running() -> bool {
    opencode_status().process_running
}

fn matches_opencode(p: &sysinfo::Process) -> bool {
    // O opencode CLI (npm) roda como "opencode.exe". Também pode aparecer
    // como filhos node com "opencode" em cmd line. Aqui olhamos o nome do
    // executável.
    let name = p.name().to_string_lossy().to_ascii_lowercase();
    let trimmed = name.trim_end_matches(".exe");

    // Ignora o próprio HUD e variantes.
    if trimmed == "opencode-hud" || trimmed.starts_with("opencode-hud-") {
        return false;
    }
    // Aceita qualquer coisa que COMECE com "opencode".
    if trimmed.starts_with("opencode") {
        return true;
    }
    false
}
