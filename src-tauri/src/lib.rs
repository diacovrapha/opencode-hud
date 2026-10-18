mod commands;
mod db;
mod db_info;
mod opencode_files;
mod paths;
mod process;

use std::sync::Arc;

use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, WebviewUrl, WebviewWindowBuilder,
};
use tauri_plugin_autostart::{ManagerExt, MacosLauncher};

// Nomes/labels das janelas (também usados em capabilities).
const WIN_DASHBOARD: &str = "dashboard";
const WIN_WIDGET: &str = "widget";

// Tamanhos do widget (largura × altura em pixels lógicos, DIPs).
// Compacto: cabeçalho + "Hoje" + barra de orçamento + linha de tokens/sessão.
// Expandido: lista rolável de sessões/modelos/agentes.
pub const WIDGET_W: f64 = 340.0;
pub const WIDGET_COMPACT_H: f64 = 158.0;
pub const WIDGET_EXPANDED_H: f64 = 460.0;

// Estado compartilhado entre callbacks do tray e o setup.
#[derive(Clone, Default)]
pub struct TrayState {
    pub autostart_item: Arc<Option<CheckMenuItem<tauri::Wry>>>,
}

fn ensure_dashboard(app: &AppHandle) -> tauri::Result<()> {
    if app.get_webview_window(WIN_DASHBOARD).is_some() {
        return Ok(());
    }
    let url = WebviewUrl::App("index.html".into());
    WebviewWindowBuilder::new(app, WIN_DASHBOARD, url)
        .title("opencode HUD")
        .inner_size(1100.0, 720.0)
        .min_inner_size(800.0, 560.0)
        .decorations(false)
        .transparent(false)
        .skip_taskbar(false)
        .visible(false)
        .resizable(true)
        .build()?;
    Ok(())
}

/// Garante que a janela dashboard comece **escondida**. O `tauri.conf.json`
/// já marca `visible: false`, mas o plugin `window-state` (em versões
/// mais agressivas) ou flags restauradas podem torná-la visível. Esta
/// função é um cinto-e-suspensórios.
fn hide_dashboard_if_visible(app: &AppHandle) {
    if let Some(win) = app.get_webview_window(WIN_DASHBOARD) {
        if let Ok(true) = win.is_visible() {
            let _ = win.hide();
        }
    }
}

fn ensure_widget(app: &AppHandle) -> tauri::Result<()> {
    // ATENÇÃO: o widget normalmente JÁ EXISTE aqui, porque está declarado em
    // tauri.conf.json (o Tauri cria as janelas do config antes do setup).
    // A versão antiga saía com `return` nesse caso e nunca posicionava a
    // janela — por isso o widget abria sempre no canto errado.
    let window = match app.get_webview_window(WIN_WIDGET) {
        Some(w) => w,
        None => WebviewWindowBuilder::new(
            app,
            WIN_WIDGET,
            WebviewUrl::App("index.html?view=widget#/widget".into()),
        )
        .title("opencode HUD widget")
        .inner_size(WIDGET_W, WIDGET_COMPACT_H)
        .min_inner_size(WIDGET_W, WIDGET_COMPACT_H)
        .max_inner_size(WIDGET_W, WIDGET_EXPANDED_H)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(true)
        .resizable(false)
        .build()?,
    };

    // Primeira execução (nenhuma posição salva pelo window-state): canto
    // superior direito. Se o usuário já arrastou o widget, respeitamos a
    // posição salva — desde que ela ainda caia em algum monitor.
    if !has_saved_widget_position(app) {
        place_widget_top_right(&window);
    }
    ensure_widget_within_monitors(&window);
    Ok(())
}

/// O plugin window-state grava `.window-state.json` no diretório de config
/// do app, com uma chave por label de janela.
fn has_saved_widget_position(app: &AppHandle) -> bool {
    let Ok(dir) = app.path().app_config_dir() else { return false };
    std::fs::read_to_string(dir.join(".window-state.json"))
        .map(|s| s.contains(&format!("\"{WIN_WIDGET}\"")))
        .unwrap_or(false)
}

/// Posiciona `window` no canto superior direito do monitor principal.
/// Devolve silenciosamente em caso de erro. Usa coordenadas lógicas
/// (DIPs) porque `Monitor::position()` e `Monitor::size()` devolvem DIPs.
fn place_widget_top_right(window: &tauri::WebviewWindow) {
    let primary = window
        .primary_monitor()
        .ok()
        .flatten()
        .or_else(|| {
            window
                .available_monitors()
                .ok()
                .and_then(|m| m.into_iter().next())
        });
    let Some(m) = primary else { return; };
    let usable = m.work_area();
    let mw_phys = usable.size.width as f64;
    let mh_phys = usable.size.height as f64;
    if mw_phys <= 0.0 || mh_phys <= 0.0 {
        return;
    }
    let margin_phys: f64 = 16.0; // margem pequena em pixels físicos.
    let scale = window.scale_factor().unwrap_or(1.0).max(0.01);
    let widget_w_phys = (WIDGET_W * scale).ceil();
    let widget_h_phys = (WIDGET_COMPACT_H * scale).ceil();
    let x_phys = (usable.position.x as f64) + (mw_phys - widget_w_phys - margin_phys).max(0.0);
    let y_phys = (usable.position.y as f64) + margin_phys;
    let _ = (widget_h_phys, mh_phys);
    eprintln!(
        "[widget] monitor work=({},{} {}x{}) scale={} widget_phys={}x{} -> at ({},{})",
        usable.position.x, usable.position.y, usable.size.width, usable.size.height,
        scale, widget_w_phys, widget_h_phys, x_phys, y_phys,
    );
    let _ = window.set_position(tauri::PhysicalPosition::new(
        x_phys.round() as i32,
        y_phys.round() as i32,
    ));
}

/// Se a posição atual da janela não cair dentro de nenhum monitor
/// (monitor desconectado, restaurada para fora da tela, etc.), recoloca
/// o widget no canto superior direito do monitor principal.
///
/// Tudo em pixels físicos (consistente com `place_widget_top_right`).
fn ensure_widget_within_monitors(window: &tauri::WebviewWindow) {
    let Ok(monitors) = window.available_monitors() else { return };
    if monitors.is_empty() {
        return;
    }
    let Ok(current_pos) = window.outer_position() else { return };
    let Ok(current_size) = window.outer_size() else { return };

    let inside_any = monitors.iter().any(|m| {
        let p = m.position();
        let s = m.size();
        current_pos.x as i64 + current_size.width as i64 > p.x as i64
            && (current_pos.x as i64) < p.x as i64 + s.width as i64
            && current_pos.y as i64 + current_size.height as i64 > p.y as i64
            && (current_pos.y as i64) < p.y as i64 + s.height as i64
    });
    if inside_any {
        return;
    }

    // Fallback: canto superior direito do monitor principal.
    if let Ok(Some(primary)) = window.primary_monitor() {
        let usable = primary.work_area();
        let scale = window.scale_factor().unwrap_or(1.0).max(0.01);
        let widget_w_phys = (WIDGET_W * scale).ceil();
        let margin_phys: f64 = 16.0;
        let x_phys = (usable.position.x as f64)
            + (usable.size.width as f64 - widget_w_phys - margin_phys).max(0.0);
        let y_phys = (usable.position.y as f64) + margin_phys;
        let _ = window.set_position(tauri::PhysicalPosition::new(
            x_phys.round() as i32,
            y_phys.round() as i32,
        ));
    }
}

fn show_hide_window(app: &AppHandle, label: &str) {
    if let Some(win) = app.get_webview_window(label) {
        match win.is_visible() {
            Ok(true) => {
                let _ = win.hide();
            }
            _ => {
                let _ = win.show();
                let _ = win.set_focus();
            }
        }
    }
}

fn build_tray(app: &AppHandle, state: TrayState) -> tauri::Result<()> {
    let open_dash = MenuItem::with_id(app, "open_dashboard", "Abrir dashboard", true, None::<&str>)?;
    let toggle_widget =
        MenuItem::with_id(app, "toggle_widget", "Mostrar/ocultar widget", true, None::<&str>)?;
    let autostart = CheckMenuItem::with_id(
        app,
        "autostart",
        "Iniciar com o Windows",
        true,
        false,
        None::<&str>,
    )?;
    let sep = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Sair", true, None::<&str>)?;

    let menu = Menu::with_items(
        app,
        &[&open_dash, &toggle_widget, &autostart, &sep, &quit],
    )?;

    let autostart_handle = autostart.clone();
    if let Some(slot) = Arc::get_mut(&mut state.autostart_item.clone()) {
        // substituímos o placeholder pela handle real
        let _ = slot.replace(autostart);
    }

    let state_for_menu = state.clone();
    let _ = TrayIconBuilder::with_id("main-tray")
        .tooltip("opencode HUD")
        .icon(
            app.default_window_icon()
                .cloned()
                .ok_or_else(|| tauri::Error::AssetNotFound("default window icon not set".into()))?,
        )
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| match event.id.as_ref() {
            "open_dashboard" => {
                if let Err(e) = ensure_dashboard(app) {
                    eprintln!("ensure_dashboard: {e}");
                }
                if let Some(win) = app.get_webview_window(WIN_DASHBOARD) {
                    let _ = win.show();
                    let _ = win.set_focus();
                    let _ = win.unminimize();
                }
            }
            "toggle_widget" => show_hide_window(app, WIN_WIDGET),
            "autostart" => {
                let manager = app.autolaunch();
                let now = manager.is_enabled().unwrap_or(false);
                let result = if now {
                    manager.disable()
                } else {
                    manager.enable()
                };
                if let Err(e) = result {
                    eprintln!("autostart toggle: {e}");
                }
                let now_after = manager.is_enabled().unwrap_or(false);
                let _ = autostart_handle.set_checked(now_after);

                // Mantém o estado compartilhado coerente para uso fora do tray.
                let _ = state_for_menu; // referência viva para evitar warning
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Err(e) = ensure_dashboard(app) {
                    eprintln!("ensure_dashboard: {e}");
                }
                if let Some(win) = app.get_webview_window(WIN_DASHBOARD) {
                    let _ = win.show();
                    let _ = win.set_focus();
                    let _ = win.unminimize();
                }
            }
        })
        .build(app)?;
    Ok(())
}

fn sync_autostart_state(app: &AppHandle, state: &TrayState) {
    let manager = app.autolaunch();
    let enabled = manager.is_enabled().unwrap_or(false);
    if let Some(item) = state.autostart_item.as_ref() {
        let _ = item.set_checked(enabled);
    }
    if !enabled {
        let _ = manager.enable();
        if let Some(item) = state.autostart_item.as_ref() {
            let _ = item.set_checked(true);
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let tray_state = TrayState::default();

    tauri::Builder::default()
        // single-instance deve ser registrado PRIMEIRO para capturar a segunda
        // instância antes que ela crie janelas.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Err(e) = ensure_dashboard(app) {
                eprintln!("ensure_dashboard: {e}");
            }
            if let Some(win) = app.get_webview_window(WIN_DASHBOARD) {
                let _ = win.show();
                let _ = win.unminimize();
                let _ = win.set_focus();
            }
        }))
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--autostart"]),
        ))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_window_state::Builder::new().with_state_flags(
            // Não restaurar visibilidade/maximized (a app decide isso).
            // Restaurar só tamanho e posição.
            tauri_plugin_window_state::StateFlags::POSITION | tauri_plugin_window_state::StateFlags::SIZE,
        ).build())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .setup({
            let tray_state = tray_state.clone();
            move |app| {
                if let Err(e) = ensure_dashboard(&app.handle()) {
                    eprintln!("ensure_dashboard (setup): {e}");
                }
                // Garantia adicional: força o estado "escondido" para a dashboard
                // mesmo que flags restauradas (window-state ou outras) a tornem visível.
                hide_dashboard_if_visible(&app.handle());
                if let Err(e) = ensure_widget(&app.handle()) {
                    eprintln!("ensure_widget (setup): {e}");
                }
                if let Err(e) = build_tray(&app.handle(), tray_state.clone()) {
                    eprintln!("build_tray: {e}");
                }
                sync_autostart_state(&app.handle(), &tray_state);
                Ok(())
            }
        })
        .on_window_event(|window, event| {
            if window.label() == WIN_DASHBOARD {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::db_query,
            commands::read_opencode_file,
            commands::opencode_running,
            commands::opencode_status_cmd,
            commands::db_path_info,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}