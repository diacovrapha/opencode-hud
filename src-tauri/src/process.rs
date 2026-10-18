use sysinfo::System;

pub fn opencode_running() -> bool {
    let mut sys = System::new_all();
    sys.refresh_processes(sysinfo::ProcessesToUpdate::All, true);
    for p in sys.processes().values() {
        let name = p.name().to_string_lossy().to_ascii_lowercase();
        if name == "opencode" || name == "opencode.exe" || name == "opencode-cli" {
            return true;
        }
    }
    false
}