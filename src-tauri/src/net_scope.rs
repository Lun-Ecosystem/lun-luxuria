//! What the page may reach through the HTTP plugin, proved through the IPC as the page calls it. The test app below
//! is shared: it is built on the real context (ACL manifests and configuration, plugins included), with every
//! directory of the app in a temporary folder, so no test reads or writes the app's real folders on this machine.

use std::{
    io::{Read, Write},
    net::TcpListener,
    path::PathBuf,
    sync::atomic::{AtomicU32, Ordering},
};

use serde_json::{Value, json};
use tauri::{
    Manager, WebviewWindowBuilder,
    ipc::{CallbackFn, InvokeBody},
    test::{INVOKE_KEY, MockRuntime, get_ipc_response, mock_builder},
    utils::config::AppDirectoriesOverride,
    webview::InvokeRequest,
};

const DENIED: &str = "url not allowed on the configured scope";

/// The temporary root of an app; the folder goes when the guard does, panic or not.
pub(crate) struct TempRoot(pub(crate) PathBuf);

impl Drop for TempRoot {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// The app and its temporary root (fields drop in order: the app, then the folder).
pub(crate) struct TestApp {
    pub(crate) app: tauri::App<MockRuntime>,
    pub(crate) root: TempRoot,
}

/// A capability for one window, with `http:default` and the given scope entries.
fn capability(label: &str, urls: &[&str]) -> Value {
    let allow: Vec<Value> = urls.iter().map(|u| json!({ "url": u })).collect();
    json!({
        "identifier": label,
        "windows": [label],
        "permissions": [{ "identifier": "http:default", "allow": allow }],
    })
}

/// An app on the real context with the HTTP plugin only, on the mock runtime, with the trial capabilities `essai`, `essai-v6` and
/// `essai-v6e`, each for its own window; `main` keeps `default.json`.
pub(crate) fn test_app() -> TestApp {
    static N: AtomicU32 = AtomicU32::new(0);
    let root = std::env::temp_dir().join(format!(
        "lun-luxuria-net-scope-{}-{}",
        std::process::id(),
        N.fetch_add(1, Ordering::Relaxed)
    ));
    std::fs::create_dir_all(&root).unwrap();
    let root = TempRoot(root);

    let mut ctx = tauri::generate_context!();
    ctx.config_mut().app.app_directories_override =
        Some(AppDirectoriesOverride::Root(root.0.clone()));
    let app = mock_builder()
        .plugin(tauri_plugin_http::init())
        .build(ctx)
        .unwrap();

    let loopback = [
        "http://127.0.0.1:*/*",
        "https://127.0.0.1:*/*",
        "http://localhost:*/*",
        "https://localhost:*/*",
    ];
    let cap = |label, urls: &[&str]| {
        app.add_capability(capability(label, urls).to_string())
            .unwrap()
    };
    cap("essai", &loopback);
    cap("essai-v6", &["http://[::1]:*/*", "https://[::1]:*/*"]);
    cap(
        "essai-v6e",
        &["http://[\\:\\:1]:*/*", "https://[\\:\\:1]:*/*"],
    );
    for label in ["main", "essai", "essai-v6", "essai-v6e"] {
        WebviewWindowBuilder::new(&app, label, Default::default())
            .build()
            .unwrap();
    }
    TestApp { app, root }
}

fn request(cmd: &str, body: Value) -> InvokeRequest {
    InvokeRequest {
        cmd: cmd.into(),
        callback: CallbackFn(0),
        error: CallbackFn(1),
        url: "http://tauri.localhost".parse().unwrap(),
        body: InvokeBody::Json(body),
        headers: Default::default(),
        invoke_key: INVOKE_KEY.to_string(),
    }
}

fn text(e: Value) -> String {
    e.as_str().map_or_else(|| e.to_string(), str::to_string)
}

/// `plugin:http|fetch` from the page of `label`: the resource number, or the error text.
fn fetch(t: &TestApp, label: &str, url: &str) -> Result<u64, String> {
    let w = t.app.get_webview_window(label).unwrap();
    let body = json!({ "clientConfig": {
        "method": "GET", "url": url, "headers": [], "data": null, "connectTimeout": 300,
    }});
    get_ipc_response(&w, request("plugin:http|fetch", body))
        .map(|b| b.deserialize::<u64>().unwrap())
        .map_err(text)
}

fn fetch_send(t: &TestApp, label: &str, rid: u64) -> Result<Value, String> {
    let w = t.app.get_webview_window(label).unwrap();
    get_ipc_response(&w, request("plugin:http|fetch_send", json!({ "rid": rid })))
        .map(|b| b.deserialize::<Value>().unwrap())
        .map_err(text)
}

fn assert_admitted(t: &TestApp, label: &str, urls: &[&str]) {
    for url in urls {
        let r = fetch(t, label, url);
        assert!(r.is_ok(), "{label}: {url} should be admitted, got {r:?}");
    }
}

fn assert_denied(t: &TestApp, label: &str, urls: &[&str]) {
    for url in urls {
        match fetch(t, label, url) {
            Err(e) => assert!(e.contains(DENIED), "{label}: {url}: wrong refusal: {e}"),
            Ok(rid) => panic!("{label}: {url} should be refused, got resource {rid}"),
        }
    }
}

#[test]
fn every_directory_of_the_app_is_under_the_temporary_root() {
    let t = test_app();
    let p = t.app.path();
    let dirs = [
        p.app_cache_dir(),
        p.app_config_dir(),
        p.app_data_dir(),
        p.app_local_data_dir(),
        p.app_log_dir(),
    ];
    for dir in dirs {
        let dir = dir.unwrap();
        assert!(
            dir.starts_with(&t.root.0),
            "{dir:?} is outside {:?}",
            t.root.0
        );
    }
}

#[test]
fn loopback_entries_admit_the_loopback_hosts_with_and_without_a_port() {
    let t = test_app();
    assert_admitted(
        &t,
        "essai",
        &[
            "http://127.0.0.1/",
            "http://127.0.0.1:8080/v1",
            "http://localhost/",
            "http://localhost:11434/x",
            "https://127.0.0.1/",
            "https://127.0.0.1:8080/v1",
            "https://localhost/",
            "https://localhost:11434/x",
        ],
    );
}

#[test]
fn loopback_entries_refuse_every_other_host() {
    let t = test_app();
    assert_denied(
        &t,
        "essai",
        &[
            "http://127.0.0.2/",
            "http://127.0.0.1.example/",
            "http://localhost.example/",
            "http://example.com/",
            "http://[::2]/",
        ],
    );
}

/// Observed on tauri-plugin-http 2.8.3 / urlpattern 0.6.0: the raw `http://[::1]:*/*` is not readable. The scope is
/// parsed at each call, and the whole capability fails: every request of that window, `[::1]` or not, ends in
/// "error deserializing scope ... not a valid URL pattern". The other windows are not affected (the other tests
/// run in the same app). The escaped form is the one to write (next test).
#[test]
fn the_raw_ipv6_entry_is_unreadable_and_only_its_window_fails() {
    let t = test_app();
    for url in [
        "http://[::1]/",
        "http://[::1]:8788/",
        "http://[::2]/",
        "http://127.0.0.1/",
    ] {
        let e = fetch(&t, "essai-v6", url).unwrap_err();
        assert!(
            e.contains("is not a valid URL pattern"),
            "essai-v6: {url}: {e}"
        );
    }
    assert_admitted(&t, "essai", &["http://127.0.0.1/"]);
}

#[test]
fn the_escaped_ipv6_entry_admits_only_the_loopback() {
    let t = test_app();
    assert_admitted(
        &t,
        "essai-v6e",
        &[
            "http://[::1]/",
            "http://[::1]:8788/",
            "https://[::1]/",
            "https://[::1]:8788/",
        ],
    );
    assert_denied(&t, "essai-v6e", &["http://[::2]/", "http://127.0.0.1/"]);
}

/// The scope of `main` as `default.json` writes it: any host. This test changes meaning the day it narrows.
#[test]
fn main_admits_any_host_today() {
    let t = test_app();
    assert_admitted(
        &t,
        "main",
        &[
            "https://example.com/",
            "http://example.com:8080/",
            "http://192.0.2.1/",
        ],
    );
}

/// A redirect out of the scope must be refused, not followed: the 302 points at a documentation address.
/// Without `scopeRedirects` in `tauri.conf.json`, the redirect is followed and ends in a network error.
#[test]
fn a_redirect_out_of_the_scope_is_refused() {
    let t = test_app();
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let (served, was_served) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        if let Ok((mut s, _)) = listener.accept() {
            // The whole request is read before answering: closing with unread data resets the connection.
            let mut request = Vec::new();
            let mut buf = [0u8; 1024];
            while !request.ends_with(b"\r\n\r\n") {
                match s.read(&mut buf) {
                    Ok(n) if n > 0 => request.extend_from_slice(&buf[..n]),
                    _ => break,
                }
            }
            let _ = s.write_all(
                b"HTTP/1.1 302 Found\r\nLocation: http://192.0.2.1/\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
            );
            let _ = served.send(());
        }
    });
    let rid = fetch(&t, "essai", &format!("http://127.0.0.1:{port}/")).unwrap();
    let err = fetch_send(&t, "essai", rid).unwrap_err();
    assert!(
        // The server signals after writing the 302; the client may have answered first, so wait for it.
        was_served
            .recv_timeout(std::time::Duration::from_secs(5))
            .is_ok(),
        "the 302 was never served: {err}"
    );
    assert!(
        err.contains(&format!("{DENIED}: http://192.0.2.1/")),
        "expected the scope refusal naming the redirect target, got: {err}"
    );
}

/// Task 2 drops the plugin's `cookies` feature: the page sends none, and the plugin would rewrite a file on each
/// `Set-Cookie`. With the feature, the plugin creates `.cookies` in the cache folder when it is set up.
#[test]
fn no_cookie_file_is_created() {
    let t = test_app();
    let cache = t.app.path().app_cache_dir().unwrap();
    assert!(
        !cache.join(".cookies").exists(),
        "the plugin created {cache:?}/.cookies"
    );
}
