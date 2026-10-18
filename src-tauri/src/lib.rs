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
    if app.get_webview_window(WIN_WIDGET).is_some() {
        return Ok(());
    }
    let url = WebviewUrl::App("index.html?view=widget#/widget".into());

    // O widget é construído sem posição fixa e depois posicionado a partir
    // do monitor principal (via window após o build). Definir a posição
    // ANTES do build é frágil porque `window-state` pode sobrescrever.
    let window = WebviewWindowBuilder::new(app, WIN_WIDGET, url)
        .title("opencode HUD widget")
        .inner_size(340.0, 120.0)
        .min_inner_size(340.0, 120.0)
        .max_inner_size(1200.0, 720.0)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(true)
        .resizable(false)
        .build()?;

    // Posiciona no canto superior direito do monitor principal (com fallback).
    place_widget_top_right(&window);
    // Reaplica a posição após um pequeno delay, garantindo que sobreviva a
    // plugins como window-state que restauram estado após o build.
    let w2 = window.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(800));
        place_widget_top_right(&w2);
        ensure_widget_within_monitors(&w2);
    });
    Ok(())
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
    let mw = usable.size.width as f64;
    let mh = usable.size.height as f64;
    if mw <= 0.0 || mh <= 0.0 {
        return;
    }
    let margin = 16.0;
    let ww = 340.0;
    let _wh = 120.0;
    let x = (usable.position.x as f64) + (mw - ww - margin).max(0.0);
    let y = (usable.position.y as f64) + margin;
    eprintln!(
        "[widget] monitor pos=({},{}) size=({},{}) work=({},{} {}x{}) -> widget at ({},{})",
        m.position().x, m.position().y, m.size().width, m.size().height,
        usable.position.x, usable.position.y, usable.size.width, usable.size.height,
        x, y,
    );
    let _ = window.set_position(tauri::LogicalPosition::new(x, y));
}

/// Devolve a posição (x, y) — canto superior direito do monitor principal
/// considerando DPI e área de trabalho (sem cobrir a barra de tarefas).
/// (Mantida por compat — não está sendo usada; o posicionamento real é
/// feito por `place_widget_top_right` depois do build.)
#[allow(dead_code)]
fn primary_top_right_for(app: &AppHandle, width: f64, height: f64, margin: f64) -> (f64, f64) {
    let primary = app
        .primary_monitor()
        .ok()
        .flatten()
        .or_else(|| app.available_monitors().ok().and_then(|m| m.into_iter().next()));
    if let Some(m) = primary {
        // `monitor.position()` está em DIPs — `Monitor::size()` igual.
        // O position final do canto superior direito é:
        //   x = posição_x_monitor + largura_monitor - widget_width - margem
        //   y = posição_y_monitor + margem (mas respeitando usable_area)
        let usable = m.work_area();
        // Fallback se work_area for degenerado (raro):
        let (target_w, target_h) = if usable.size.width > 0 && usable.size.height > 0 {
            (usable.size.width as f64, usable.size.height as f64)
        } else {
            (m.size().width as f64, m.size().height as f64)
        };
        let _ = (target_h, height); // evitarmos warning; só usamos width p/ canto direito
        let x = (usable.position.x as f64) + (target_w - width - margin).max(0.0);
        let y = (usable.position.y as f64) + margin;
        return (x, y);
    }
    // Sem informação: cai num canto seguro em 1920x1080.
    (1920.0 - width - margin, margin)
}

/// Se a posição atual da janela não cair dentro de nenhum monitor,
/// reposiciona-a no canto superior direito do monitor principal.
/// Usa unidades lógicas (DIPs).
fn ensure_widget_within_monitors(window: &tauri::WebviewWindow) {
    let Ok(monitors) = window.available_monitors() else { return };
    if monitors.is_empty() {
        return;
    }
    let Ok(current_pos) = window.outer_position() else { return };
    let Ok(current_size) = window.outer_size() else { return };
    let scale = window.scale_factor().unwrap_or(1.0);
    let cw = (current_pos.x as f64) / scale;
    let ch = (current_pos.y as f64) / scale;
    let cw_w = (current_size.width as f64) / scale;
    let ch_h = (current_size.height as f64) / scale;

    let inside_any = monitors.iter().any(|m| {
        let p = m.position();
        let s = m.size();
        cw + cw_w > p.x as f64
            && cw < p.x as f64 + s.width as f64
            && ch + ch_h > p.y as f64
            && ch < p.y as f64 + s.height as f64
    });
    if inside_any {
        return;
    }

    // Fallback: canto superior direito do monitor principal.
    if let Ok(Some(primary)) = window.primary_monitor() {
        let usable = primary.work_area();
        let w = primary.size().width as f64;
        let margin = 16.0;
        let x = (usable.position.x as f64) + (w - cw_w - margin).max(0.0);
        let y = (usable.position.y as f64) + margin;
        let _ = ch_h; // referência mantida (não usamos — o widget tem tamanho fixo)
        let _ = window.set_position(tauri::LogicalPosition::new(x, y));
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