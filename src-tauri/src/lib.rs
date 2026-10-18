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

fn ensure_widget(app: &AppHandle) -> tauri::Result<()> {
    if app.get_webview_window(WIN_WIDGET).is_some() {
        return Ok(());
    }
    let url = WebviewUrl::App("index.html?view=widget#/widget".into());
    WebviewWindowBuilder::new(app, WIN_WIDGET, url)
        .title("opencode HUD widget")
        .inner_size(340.0, 120.0)
        .min_inner_size(340.0, 120.0)
        .max_inner_size(1200.0, 720.0)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(true)
        .resizable(false)
        .position(100.0, 100.0)
        .build()?;
    Ok(())
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
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .setup({
            let tray_state = tray_state.clone();
            move |app| {
                if let Err(e) = ensure_dashboard(&app.handle()) {
                    eprintln!("ensure_dashboard (setup): {e}");
                }
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
            commands::read_opencode_file_cmd,
            commands::opencode_running_cmd,
            commands::db_path_info_cmd,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}