//! What the page may ask of the core plugins (window, event, image, tray, menu, path, webview), proved through the IPC
//! as the page calls it, on the test app of `net_scope.rs` with `capabilities/default.json` read as it is on disk.

use serde_json::{Value, json};
use tauri::{Manager, test::get_ipc_response};

use crate::net_scope::{TestApp, request, test_app, text};

/// The answer of the `main` window to `cmd` with an empty body: the error text, whatever it is, or `Ok`.
fn call(t: &TestApp, cmd: &str) -> Result<Value, String> {
    let w = t.app.get_webview_window("main").unwrap();
    get_ipc_response(&w, request(cmd, json!({})))
        .map(|b| b.deserialize::<Value>().unwrap_or(Value::Null))
        .map_err(text)
}

/// Tauri's own refusal by the ACL, not an argument the empty body lacks.
fn by_acl(e: &str) -> bool {
    e.contains("not allowed")
}

/// Every command the page calls, with the page's own text that calls it (read from `src/`, never from the
/// capability), so the list below stays true to the page. `onCloseRequested` ends in `destroy`; the drag region
/// is the attribute the core script of Tauri reads to call `start_dragging`.
const PAGE_CALLS: &[(&str, &str)] = &[
    ("plugin:event|listen", "listen("),
    ("plugin:window|available_monitors", "availableMonitors("),
    ("plugin:window|primary_monitor", "primaryMonitor("),
    ("plugin:window|set_fullscreen", ".setFullscreen("),
    ("plugin:window|is_fullscreen", ".isFullscreen("),
    ("plugin:window|set_always_on_top", ".setAlwaysOnTop("),
    ("plugin:window|set_size", ".setSize("),
    ("plugin:window|set_position", ".setPosition("),
    ("plugin:window|inner_size", ".innerSize("),
    ("plugin:window|start_dragging", "data-tauri-drag-region"),
    ("plugin:window|destroy", "onCloseRequested("),
    ("plugin:window|close", ".close("),
    ("plugin:window|show", ".show"),
    ("plugin:window|unminimize", ".unminimize"),
    ("plugin:window|set_focus", ".setFocus"),
];

fn page_source() -> String {
    fn walk(dir: &std::path::Path, out: &mut String) {
        for e in std::fs::read_dir(dir).unwrap() {
            let p = e.unwrap().path();
            let name = p.to_string_lossy();
            if p.is_dir() {
                walk(&p, out);
            } else if (name.ends_with(".ts") || name.ends_with(".svelte"))
                && !name.contains(".test.")
            {
                out.push_str(&std::fs::read_to_string(&p).unwrap());
            }
        }
    }
    let mut all = String::new();
    walk(
        &std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../src"),
        &mut all,
    );
    all
}

#[test]
fn the_page_has_no_door_to_an_image_a_tray_a_menu_a_path_or_a_webview() {
    let t = test_app();
    let wrong: Vec<String> = [
        "plugin:image|from_path",
        "plugin:tray|new",
        "plugin:menu|new",
        "plugin:path|resolve_directory",
        "plugin:webview|create_webview_window",
    ]
    .iter()
    .filter_map(|cmd| match call(&t, cmd) {
        Err(e) if by_acl(&e) => None,
        Err(e) => Some(format!("{cmd}: refused, but not by the ACL: {e}")),
        Ok(v) => Some(format!("{cmd}: should be refused, got {v}")),
    })
    .collect();
    assert!(
        wrong.is_empty(),
        "{}",
        wrong.join(
            "
"
        )
    );
}

/// The witness: a command the page never calls is refused by the ACL in the very words `by_acl` looks for.
#[test]
fn the_acl_refusal_reads_as_the_tests_expect() {
    let e = call(&test_app(), "plugin:window|set_title").unwrap_err();
    assert!(by_acl(&e), "unexpected refusal text: {e}");
}

#[test]
fn the_ipc_still_hears_every_call_the_page_makes() {
    let t = test_app();
    for (cmd, _) in PAGE_CALLS {
        // Under the mock runtime the call may fail for its own reason (an argument, a window): only the ACL matters.
        if let Err(e) = call(&t, cmd) {
            assert!(
                !by_acl(&e),
                "{cmd}: the page asks for it, the ACL refuses: {e}"
            );
        }
    }
}

#[test]
fn every_admitted_command_is_a_call_the_page_makes() {
    let src = page_source();
    for (cmd, text) in PAGE_CALLS {
        assert!(src.contains(text), "{cmd}: `{text}` is nowhere in src/");
    }
}
