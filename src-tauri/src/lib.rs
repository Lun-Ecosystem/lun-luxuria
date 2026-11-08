//! The window around the page: everything Luxuria decides stays in the page (`src/`), this side only gives it
//! what a browser tab cannot: a window of its own, global keys, requests without CORS.

mod body;
mod programs;
mod tray;
mod voice;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // First: a second launch shows the running one instead of opening a second window.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            use tauri::Manager;
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
            }
        }))
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        // Starting with Windows is the person's switch on the settings screen; nothing is set here.
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .setup(|app| Ok(tray::setup(app.handle())?))
        .manage(voice::Launched::default())
        .manage(programs::Programs::default())
        .invoke_handler(tauri::generate_handler![
            body::body_config,
            body::body_image,
            voice::voice_start,
            voice::voice_restart,
            voice::voice_running,
            programs::program_start,
            tray::tray_state
        ])
        .build(tauri::generate_context!())
        .expect("error while building Lun'Luxuria")
        .run(|app, event| {
            // The voice service and the programs this app started go with it.
            if let tauri::RunEvent::Exit = event {
                use tauri::Manager;
                voice::stop(&app.state::<voice::Launched>());
                programs::stop_all(&app.state::<programs::Programs>());
            }
        });
}
