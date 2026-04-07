use tauri::{
    Manager,
    tray::TrayIconBuilder,
    menu::{Menu, MenuItem},
};
use tauri_plugin_shell::ShellExt;
use std::sync::Mutex;

/// State holding the child sidecar handle so we can kill it on shutdown.
struct SidecarState {
    child: Option<tauri_plugin_shell::process::CommandChild>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(Mutex::new(SidecarState { child: None }))
        .setup(|app| {
            #[cfg(debug_assertions)]
            {
                let window = app.get_webview_window("main").unwrap();
                window.open_devtools();
            }

            // ── System tray ──
            let quit = MenuItem::with_id(app, "quit", "退出 AI Video Pipeline", true, None::<&str>)?;
            let show = MenuItem::with_id(app, "show", "显示主窗口", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .tooltip("AI Video Pipeline")
                .on_menu_event(|app, event| {
                    match event.id.as_ref() {
                        "quit" => {
                            // Kill sidecar before quitting
                            if let Some(state) = app.try_state::<Mutex<SidecarState>>() {
                                if let Ok(mut s) = state.lock() {
                                    if let Some(child) = s.child.take() {
                                        let _ = child.kill();
                                    }
                                }
                            }
                            app.exit(0);
                        }
                        "show" => {
                            if let Some(w) = app.get_webview_window("main") {
                                let _ = w.show();
                                let _ = w.set_focus();
                            }
                        }
                        _ => {}
                    }
                })
                .build(app)?;

            // ── Launch Node.js backend sidecar ──
            let shell = app.shell();
            let data_dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| std::path::PathBuf::from("data"));

            // Ensure data directory exists
            let _ = std::fs::create_dir_all(&data_dir);

            let sidecar = shell
                .sidecar("ai-video-server")
                .expect("failed to create sidecar command")
                .env("TAURI_SIDECAR", "1")
                .env("APPDATA_DIR", data_dir.to_string_lossy().to_string())
                .env("PORT", "3220");

            match sidecar.spawn() {
                Ok((mut rx, child)) => {
                    log::info!("Backend sidecar started (pid group)");

                    // Store child handle for cleanup
                    if let Some(state) = app.try_state::<Mutex<SidecarState>>() {
                        if let Ok(mut s) = state.lock() {
                            s.child = Some(child);
                        }
                    }

                    // Stream sidecar stdout/stderr to Rust log
                    tauri::async_runtime::spawn(async move {
                        use tauri_plugin_shell::process::CommandEvent;
                        while let Some(event) = rx.recv().await {
                            match event {
                                CommandEvent::Stdout(line) => {
                                    log::info!("[backend] {}", String::from_utf8_lossy(&line));
                                }
                                CommandEvent::Stderr(line) => {
                                    log::warn!("[backend] {}", String::from_utf8_lossy(&line));
                                }
                                CommandEvent::Terminated(payload) => {
                                    log::info!("[backend] terminated: code={:?}", payload.code);
                                    break;
                                }
                                _ => {}
                            }
                        }
                    });
                }
                Err(e) => {
                    log::error!("Failed to start backend sidecar: {e}");
                    // App can still run — user will see connection errors in the UI
                }
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            // Kill sidecar when last window is closed
            if let tauri::WindowEvent::Destroyed = event {
                if let Some(state) = window.try_state::<Mutex<SidecarState>>() {
                    if let Ok(mut s) = state.lock() {
                        if let Some(child) = s.child.take() {
                            let _ = child.kill();
                        }
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
