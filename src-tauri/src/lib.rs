//! The window around the page: everything Luxuria decides stays in the page (`src/`), this side only gives it
//! what a browser tab cannot: a window of its own, global keys, requests without CORS.

mod body;

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
        .invoke_handler(tauri::generate_handler![
            body::body_config,
            body::body_image
        ])
        .run(tauri::generate_context!())
        .expect("error while running Lun'Luxuria");
}
