//! The filter of the window's network: `NetGuard` wraps the HTTP plugin under its name, `http`, so that the ACL
//! (`http:default`), the route `plugin:http|…` and `plugins.http` stay the plugin's, and checks `fetch` before the
//! plugin sees it. Admitted: no proxy, no redirection followed, an http or https address on the loopback or at an
//! origin the person confirmed in the system's box. The origins are kept in `hotes.json`, next to `programmes.json`,
//! and read again at each `fetch`: a forgotten one is refused at once. The other commands, and the body's stream, are
//! the plugin's own.

use crate::one_box::{self, OneBox};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{
    AppHandle, Manager, RunEvent, Runtime, Url, Webview, Window,
    ipc::{Invoke, InvokeBody},
    plugin::Plugin,
    webview::PageLoadPayload,
};
use tauri_plugin_dialog::MessageDialogResult;
use tauri_runtime::webview::InitializationScript;

const FILE: &str = "hotes.json";
const NOT_JSON: &str = "Requête refusée : corps illisible.";
const NOT_HTTP: &str = "Adresse refusée pour la fenêtre : http ou https seulement.";
const UNREADABLE: &str = "Adresse illisible pour la fenêtre.";

/** The HTTP plugin, behind the filter; each method of the trait is the plugin's, `extend_api` after the check. */
pub struct NetGuard<R: Runtime>(Box<dyn Plugin<R>>);

impl<R: Runtime> NetGuard<R> {
    pub fn new() -> Self {
        Self(Box::new(tauri_plugin_http::init()))
    }
}

impl<R: Runtime> Plugin<R> for NetGuard<R> {
    fn name(&self) -> &'static str {
        self.0.name()
    }

    fn initialize(
        &mut self,
        app: &AppHandle<R>,
        config: serde_json::Value,
    ) -> Result<(), Box<dyn std::error::Error>> {
        self.0.initialize(app, config)
    }

    fn initialization_script(&self) -> Option<String> {
        self.0.initialization_script()
    }

    fn initialization_script_2(&self) -> Option<InitializationScript> {
        self.0.initialization_script_2()
    }

    fn window_created(&mut self, window: Window<R>) {
        self.0.window_created(window)
    }

    fn webview_created(&mut self, webview: Webview<R>) {
        self.0.webview_created(webview)
    }

    fn on_navigation(&mut self, webview: &Webview<R>, url: &Url) -> bool {
        self.0.on_navigation(webview, url)
    }

    fn on_page_load(&mut self, webview: &Webview<R>, payload: &PageLoadPayload<'_>) {
        self.0.on_page_load(webview, payload)
    }

    fn on_event(&mut self, app: &AppHandle<R>, event: &RunEvent) {
        self.0.on_event(app, event)
    }

    fn extend_api(&mut self, invoke: Invoke<R>) -> bool {
        if invoke.message.command() == "fetch" {
            let app = invoke.message.webview_ref().app_handle();
            let hosts = || file(app).map(|f| read(&f)).unwrap_or_default();
            if let Err(refused) = checked(invoke.message.payload(), hosts) {
                // Answered here: the plugin never sees the request, nothing is created.
                invoke.resolver.reject(refused);
                return true;
            }
        }
        self.0.extend_api(invoke)
    }
}

/** The rules of `fetch`, in this order; `hosts` is read only for an address out of the loopback. */
fn checked(body: &InvokeBody, hosts: impl FnOnce() -> Vec<String>) -> Result<(), String> {
    let InvokeBody::Json(body) = body else {
        return Err(NOT_JSON.into());
    };
    let config = &body["clientConfig"];
    if !config["proxy"].is_null() {
        return Err("Proxy refusé.".into());
    }
    if config["maxRedirections"].as_u64() != Some(0) {
        return Err("Redirections refusées.".into());
    }
    match origin(config["url"].as_str().unwrap_or_default())? {
        Some(o) if !hosts().contains(&o) => {
            Err(format!("Adresse non confirmée pour la fenêtre : {o}."))
        }
        _ => Ok(()),
    }
}

/**
 * An http or https address, read by `tauri::Url` as the plugin and reqwest read it: `None` on the loopback, else its
 * origin as `ascii_serialization()` writes it.
 */
fn origin(url: &str) -> Result<Option<String>, String> {
    let url = Url::parse(url).map_err(|_| UNREADABLE.to_string())?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err(NOT_HTTP.into());
    }
    // The parsed host, serialized: `0x7f.0.0.1` is `127.0.0.1`, and `[::ffff:127.0.0.1]` is not `[::1]`.
    if matches!(url.host_str(), Some("127.0.0.1" | "localhost" | "[::1]")) {
        return Ok(None);
    }
    Ok(Some(url.origin().ascii_serialization()))
}

fn file<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    crate::programs::config_file(app, FILE)
}

/** The confirmed origins; an absent or unreadable file, or one that is not an array of strings, reads as none. */
fn read(file: &Path) -> Vec<String> {
    fs::read_to_string(file)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

/** Changes the origins kept in `file`, written as `programs::save_entry` writes its file. */
fn save(file: &Path, change: impl FnOnce(&mut Vec<String>)) -> Result<(), String> {
    let mut hosts = read(file);
    change(&mut hosts);
    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let text = serde_json::to_string_pretty(&hosts).map_err(|e| e.to_string())?;
    fs::write(file, text).map_err(|e| e.to_string())
}

/**
 * `true` when `url` may be joined: the loopback and a confirmed origin at once, without a box; a new origin once the
 * person confirms it in `ask`, then kept. `false`: refused at the box, nothing kept.
 */
pub fn confirm(
    file: &Path,
    one: &OneBox,
    url: &str,
    ask: impl FnOnce(&str) -> MessageDialogResult,
) -> Result<bool, String> {
    let Some(origin) = origin(url)? else {
        return Ok(true);
    };
    if read(file).contains(&origin) {
        return Ok(true);
    }
    let _box = one_box::take(one)?;
    if !one_box::confirmed(&ask(&origin)) {
        return Ok(false);
    }
    // Read again: the file may have changed while the box was open.
    save(file, |hosts| {
        if !hosts.contains(&origin) {
            hosts.push(origin);
        }
    })?;
    Ok(true)
}

#[tauri::command]
pub fn net_hosts<R: Runtime>(app: AppHandle<R>) -> Result<Vec<String>, String> {
    Ok(read(&file(&app)?))
}

/** Off the window's thread, like `program_pick`: the box blocks until answered. */
#[tauri::command(async)]
pub fn net_host_confirm(
    app: tauri::AppHandle,
    window: tauri::Window,
    one: tauri::State<'_, OneBox>,
    url: String,
) -> Result<bool, String> {
    confirm(&file(&app)?, &one, &url, |origin| {
        one_box::ask(
            &window,
            "Une adresse hors de ce poste",
            &format!("La fenêtre pourra joindre {origin}."),
        )
    })
}

#[tauri::command]
pub fn net_host_forget<R: Runtime>(app: AppHandle<R>, origin: String) -> Result<(), String> {
    save(&file(&app)?, |hosts| hosts.retain(|h| *h != origin))
}

#[cfg(test)]
mod tests {
    use std::{
        cell::Cell,
        io::{Read, Write},
        net::TcpListener,
        path::PathBuf,
    };

    use serde_json::{Value, json};
    use tauri::{
        Manager,
        ipc::InvokeBody,
        plugin::Plugin,
        test::{MockRuntime, get_ipc_response},
    };
    use tauri_plugin_dialog::MessageDialogResult;

    use super::{NetGuard, confirm, net_host_forget, net_hosts};
    use crate::net_scope::{TestApp, request, test_app, test_app_with, text};
    use crate::one_box::{OneBox, take};

    const HOSTS: &str = "hotes.json";
    const BUSY: &str = "Une boîte est déjà ouverte.";

    fn guarded() -> TestApp {
        test_app_with(NetGuard::<MockRuntime>::new())
    }

    /// `hotes.json` of this app, in its temporary config folder.
    fn hosts_file(t: &TestApp) -> PathBuf {
        // Written out, not taken from `programs::config_file`: the tests check where the code reads and writes.
        t.app.path().app_config_dir().unwrap().join(HOSTS)
    }

    fn write_hosts(t: &TestApp, content: &str) {
        let file = hosts_file(t);
        std::fs::create_dir_all(file.parent().unwrap()).unwrap();
        std::fs::write(file, content).unwrap();
    }

    /// A command of the plugin from the `main` page, whose scope (`default.json`) admits any host: only the guard
    /// is left to refuse.
    fn ipc(t: &TestApp, cmd: &str, body: Value) -> Result<Value, String> {
        let w = t.app.get_webview_window("main").unwrap();
        get_ipc_response(&w, request(&format!("plugin:http|{cmd}"), body))
            .map(|b| b.deserialize::<Value>().unwrap())
            .map_err(text)
    }

    /// What the page sends for a `fetch` as `net.ts` will: no proxy, no redirection followed.
    fn page(url: &str) -> Value {
        json!({ "clientConfig": {
            "method": "GET", "url": url, "headers": [], "data": null,
            "connectTimeout": 300, "maxRedirections": 0,
        }})
    }

    fn with(url: &str, key: &str, value: Option<Value>) -> Value {
        let mut body = page(url);
        let config = body["clientConfig"].as_object_mut().unwrap();
        match value {
            Some(v) => config.insert(key.into(), v),
            None => config.remove(key),
        };
        body
    }

    fn fetch(t: &TestApp, body: Value) -> Result<Value, String> {
        ipc(t, "fetch", body)
    }

    fn unconfirmed(origin: &str) -> String {
        format!("Adresse non confirmée pour la fenêtre : {origin}.")
    }

    fn assert_admitted(t: &TestApp, urls: &[&str]) {
        for url in urls {
            let r = fetch(t, page(url));
            assert!(
                r.as_ref().is_ok_and(Value::is_u64),
                "{url} should give a resource number, got {r:?}"
            );
        }
    }

    /// Each URL is refused with the message naming its origin (the origin as `ascii_serialization()` writes it).
    fn assert_unconfirmed(t: &TestApp, cases: &[(&str, &str)]) {
        for (url, origin) in cases {
            assert_eq!(
                fetch(t, page(url)),
                Err(unconfirmed(origin)),
                "{url} should be refused"
            );
        }
    }

    /// One connection, answered with `answer`, on the loopback; the port.
    fn serve_once(answer: &'static [u8]) -> u16 {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
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
                let _ = s.write_all(answer);
            }
        });
        port
    }

    // The wrapper itself.

    #[test]
    fn the_wrapper_is_named_http_so_that_the_acl_and_the_route_stay() {
        assert_eq!(NetGuard::<MockRuntime>::new().name(), "http");
        // The route `plugin:http|fetch` reaches the plugin through the wrapper.
        let t = guarded();
        assert_admitted(&t, &["http://127.0.0.1/"]);
    }

    #[test]
    fn the_loopback_is_admitted_with_a_resource_number() {
        let t = guarded();
        assert_admitted(
            &t,
            &[
                "http://127.0.0.1/",
                "http://127.0.0.1:8080/v1",
                "https://127.0.0.1:8080/v1",
                "http://localhost/",
                "http://localhost:11434/x",
                "https://localhost/",
                "http://[::1]/",
                "http://[::1]:8788/",
                "https://[::1]:8788/",
                // The host is lowercased by the parser, the plugin's and ours.
                "http://LOCALHOST:8080/",
                "HTTP://127.0.0.1/",
            ],
        );
    }

    /// The task-2 test, through the wrapper: a 302 is not followed (`maxRedirections: 0`), so the answer is the 302
    /// itself and nothing reaches its target. The plugin's own scope refusal needs redirections, which the guard
    /// forbids, so it can no longer be seen here.
    #[test]
    fn a_redirect_is_not_followed_through_the_wrapper() {
        let t = guarded();
        let port = serve_once(
            b"HTTP/1.1 302 Found\r\nLocation: http://192.0.2.1/\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
        );
        let rid = fetch(&t, page(&format!("http://127.0.0.1:{port}/"))).unwrap();
        let answer = ipc(&t, "fetch_send", json!({ "rid": rid })).unwrap();
        assert_eq!(answer["status"], 302, "{answer}");
        assert_eq!(answer["url"], format!("http://127.0.0.1:{port}/"));
    }

    #[test]
    fn an_admitted_request_is_served_by_the_plugin() {
        let t = guarded();
        let port = serve_once(b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
        let rid = fetch(&t, page(&format!("http://127.0.0.1:{port}/"))).unwrap();
        let answer = ipc(&t, "fetch_send", json!({ "rid": rid })).unwrap();
        assert_eq!(answer["status"], 200, "{answer}");
    }

    // The refusals, each with its message.

    #[test]
    fn a_proxy_is_refused() {
        let t = guarded();
        for proxy in [
            json!({ "all": "http://127.0.0.1:9" }),
            json!({ "http": "http://127.0.0.1:9" }),
            json!({}),
        ] {
            let r = fetch(&t, with("http://127.0.0.1/", "proxy", Some(proxy.clone())));
            assert_eq!(r, Err("Proxy refusé.".to_string()), "proxy {proxy}");
        }
    }

    #[test]
    fn an_absent_or_null_proxy_is_admitted() {
        let t = guarded();
        let url = "http://127.0.0.1/";
        assert!(fetch(&t, with(url, "proxy", None)).is_ok());
        assert!(fetch(&t, with(url, "proxy", Some(Value::Null))).is_ok());
    }

    #[test]
    fn redirections_other_than_zero_are_refused() {
        let t = guarded();
        let url = "http://127.0.0.1/";
        let refused = Err("Redirections refusées.".to_string());
        for max in [
            None,
            Some(json!(1)),
            Some(json!(20)),
            Some(json!("0")),
            Some(json!(-1)),
            Some(json!(0.5)),
            Some(Value::Null),
            Some(json!(false)),
        ] {
            let r = fetch(&t, with(url, "maxRedirections", max.clone()));
            assert_eq!(r, refused, "maxRedirections {max:?}");
        }
        assert!(fetch(&t, with(url, "maxRedirections", Some(json!(0)))).is_ok());
    }

    #[test]
    fn a_host_out_of_the_loopback_is_refused_before_any_connection() {
        let t = guarded();
        // `fetch` only builds the request: a refusal is a refusal before any socket. Documentation addresses and
        // `example.com` are never joined.
        assert_unconfirmed(
            &t,
            &[
                ("http://example.com/", "http://example.com"),
                ("https://example.com/", "https://example.com"),
                ("http://192.0.2.1:8080/", "http://192.0.2.1:8080"),
                // The host is what follows `@`.
                ("http://127.0.0.1@example.com/", "http://example.com"),
                ("http://localhost:80@192.0.2.1/", "http://192.0.2.1"),
                ("http://127.0.0.2/", "http://127.0.0.2"),
                ("http://localhost.example/", "http://localhost.example"),
                ("http://127.0.0.1.example/", "http://127.0.0.1.example"),
                ("http://[::2]/", "http://[::2]"),
                // An IPv4-mapped IPv6 address is not `::1`, whatever it maps to.
                ("http://[::ffff:127.0.0.1]/", "http://[::ffff:7f00:1]"),
                ("http://EXAMPLE.com/", "http://example.com"),
            ],
        );
    }

    /// The URL parser, the plugin's and reqwest's, reads `0x7f.0.0.1` as `127.0.0.1`: the host is the loopback, so
    /// the request goes there and nowhere else. Admitted because the guard compares the parsed host (`host_str()`),
    /// not the address as written.
    #[test]
    fn a_hex_spelling_of_the_loopback_is_read_as_the_loopback() {
        let t = guarded();
        assert_admitted(&t, &["http://0x7f.0.0.1/", "http://2130706433/"]);
    }

    /// Not an origin to confirm: the message says what the window joins, not an opaque `null` origin.
    #[test]
    fn an_address_that_is_not_http_is_refused() {
        let t = guarded();
        let refused = Err("Adresse refusée pour la fenêtre : http ou https seulement.".to_string());
        for url in [
            "data:text/plain,x",
            "ws://127.0.0.1/",
            "file:///etc/hosts",
            "ftp://127.0.0.1/",
        ] {
            assert_eq!(fetch(&t, page(url)), refused, "{url}");
        }
    }

    /// An address the parser cannot read is not a scheme to refuse: it has its own message.
    #[test]
    fn an_unreadable_address_is_refused_as_unreadable() {
        let t = guarded();
        let refused = Err("Adresse illisible pour la fenêtre.".to_string());
        for url in [
            "http://127.0.0.1:65536/",
            "http://%00/",
            "http://exa%00mple.com/",
            "https://",
            "not an address",
            "",
        ] {
            assert_eq!(fetch(&t, page(url)), refused, "{url:?}");
        }
        // No address to read: absent, or not a string.
        for url in [None, Some(Value::Null), Some(json!(12))] {
            let body = with("http://127.0.0.1/", "url", url.clone());
            assert_eq!(fetch(&t, body), refused, "url {url:?}");
        }
    }

    /// A refused `fetch` creates nothing: no request waits in the window's table, where a `fetch_send` would start it.
    /// The numbers are drawn at random (tauri 2.12), so the table is counted rather than guessed.
    #[test]
    fn a_refused_fetch_creates_no_request() {
        let t = guarded();
        let w = t.app.get_webview_window("main").unwrap();
        let count = || w.resources_table().names().count();
        let empty = count();
        // An admitted request is in the table once its number is given: its two abort ends, then itself.
        fetch(&t, page("http://127.0.0.1/")).unwrap();
        let one = count();
        assert_eq!(one, empty + 3);
        // Served by the plugin without any socket, were it created.
        assert!(fetch(&t, page("data:text/plain,x")).is_err());
        // The plugin builds its request off the IPC's thread: a created one has had the time to appear.
        std::thread::sleep(std::time::Duration::from_millis(300));
        assert_eq!(count(), one, "the refused request was created");
    }

    /// The rules are read in order, the body, the proxy, the redirections, the address: a request that breaks two
    /// gets the first one's message.
    #[test]
    fn the_first_broken_rule_gives_its_message() {
        let t = guarded();
        let mut all = with(
            "http://example.com/",
            "proxy",
            Some(json!({ "all": "http://127.0.0.1:9" })),
        );
        all["clientConfig"]["maxRedirections"] = json!(1);
        assert_eq!(fetch(&t, all), Err("Proxy refusé.".to_string()));
        let redirections = Err("Redirections refusées.".to_string());
        for url in ["http://example.com/", "data:text/plain,x"] {
            assert_eq!(
                fetch(&t, with(url, "maxRedirections", Some(json!(1)))),
                redirections,
                "{url}"
            );
        }
    }

    #[test]
    fn a_request_that_is_not_json_or_has_no_readable_address_is_refused() {
        let plain = test_app();
        let t = guarded();
        // The guard answers itself: its refusal is not the plugin's own error for the same request.
        let raw = |t: &TestApp| {
            let w = t.app.get_webview_window("main").unwrap();
            let mut r = request("plugin:http|fetch", Value::Null);
            r.body = InvokeBody::Raw(b"not json".to_vec());
            get_ipc_response(&w, r).map(|_| ()).map_err(text)
        };
        let e = raw(&t).unwrap_err();
        assert_eq!(e, "Requête refusée : corps illisible.");
        assert_ne!(Err(e), raw(&plain), "a raw body reached the plugin");

        let unreadable = "Adresse illisible pour la fenêtre.";
        for (body, message) in [
            (json!({}), "Redirections refusées."),
            (json!({ "clientConfig": {} }), "Redirections refusées."),
            (
                json!({ "clientConfig": { "maxRedirections": 0, "url": 12 } }),
                unreadable,
            ),
            (
                json!({ "clientConfig": { "maxRedirections": 0, "url": "not an address" } }),
                unreadable,
            ),
        ] {
            let e = fetch(&t, body.clone()).unwrap_err();
            assert_eq!(e, message, "{body}");
            assert_ne!(
                Err(e),
                fetch(&plain, body.clone()),
                "{body} reached the plugin"
            );
        }
    }

    // The other commands of the plugin pass untouched.

    /// The guard looks at `fetch` only: for the others, the answer is the plugin's, the same as without the wrapper.
    #[test]
    fn the_other_commands_are_the_plugins_own() {
        let plain = test_app();
        let t = guarded();
        for cmd in [
            "fetch_cancel",
            "fetch_send",
            "fetch_read_body",
            "fetch_cancel_body",
        ] {
            let body = json!({ "rid": 4_000_000 });
            let want = ipc(&plain, cmd, body.clone());
            let got = ipc(&t, cmd, body);
            let e = got.clone().unwrap_err();
            assert_eq!(got, want, "{cmd} must be the plugin's answer");
            for guard in [
                "Proxy refusé.",
                "Redirections refusées.",
                "Adresse non confirmée",
            ] {
                assert!(!e.contains(guard), "{cmd}: the guard answered: {e}");
            }
        }
    }

    // `hotes.json`.

    #[test]
    fn a_confirmed_origin_is_admitted_and_only_it() {
        let t = guarded();
        assert_unconfirmed(&t, &[("https://example.com/", "https://example.com")]);
        write_hosts(&t, r#"["https://example.com"]"#);
        assert_admitted(
            &t,
            &[
                "https://example.com/",
                "https://example.com/v1/chat?x=1",
                "https://example.com:443/",
                "https://EXAMPLE.com/",
            ],
        );
        assert_unconfirmed(
            &t,
            &[
                ("https://example.com:8443/", "https://example.com:8443"),
                // The scheme is part of the origin.
                ("http://example.com/", "http://example.com"),
                ("https://sub.example.com/", "https://sub.example.com"),
                ("https://example.org/", "https://example.org"),
            ],
        );
    }

    #[test]
    fn a_confirmed_origin_with_a_port_admits_that_port_only() {
        let t = guarded();
        write_hosts(&t, r#"["https://example.com:8443"]"#);
        assert_admitted(&t, &["https://example.com:8443/"]);
        assert_unconfirmed(&t, &[("https://example.com/", "https://example.com")]);
    }

    #[test]
    fn the_file_is_read_at_each_fetch() {
        let t = guarded();
        let url = "https://example.com/";
        assert!(fetch(&t, page(url)).is_err());
        write_hosts(&t, r#"["https://example.com"]"#);
        assert!(fetch(&t, page(url)).is_ok());
        write_hosts(&t, "[]");
        assert!(
            fetch(&t, page(url)).is_err(),
            "a removed host stays admitted"
        );
    }

    #[test]
    fn a_forgotten_origin_is_refused_at_the_next_fetch() {
        let t = guarded();
        write_hosts(&t, r#"["https://example.com","https://example.org"]"#);
        assert_admitted(&t, &["https://example.com/"]);
        net_host_forget(t.app.handle().clone(), "https://example.com".into()).unwrap();
        assert_unconfirmed(&t, &[("https://example.com/", "https://example.com")]);
        assert_admitted(&t, &["https://example.org/"]);
    }

    #[test]
    fn an_unreadable_file_means_no_host() {
        let t = guarded();
        for content in ["{ not json", "", r#"{"https://example.com": true}"#, "42"] {
            write_hosts(&t, content);
            assert_unconfirmed(&t, &[("https://example.com/", "https://example.com")]);
            // The loopback never depended on the file.
            assert_admitted(&t, &["http://127.0.0.1/"]);
            assert_eq!(
                net_hosts(t.app.handle().clone()).unwrap(),
                Vec::<String>::new()
            );
        }
        // A folder where the file should be: unreadable too.
        let file = hosts_file(&t);
        std::fs::remove_file(&file).unwrap();
        std::fs::create_dir(&file).unwrap();
        assert_unconfirmed(&t, &[("https://example.com/", "https://example.com")]);
    }

    #[test]
    fn a_missing_file_means_no_host() {
        let t = guarded();
        assert!(!hosts_file(&t).exists());
        assert_unconfirmed(&t, &[("https://example.com/", "https://example.com")]);
        assert_eq!(
            net_hosts(t.app.handle().clone()).unwrap(),
            Vec::<String>::new()
        );
    }

    // `net_hosts`, `net_host_confirm`.

    #[test]
    fn net_hosts_gives_the_origins_as_strings() {
        let t = guarded();
        write_hosts(&t, r#"["https://example.com","http://192.0.2.1:8080"]"#);
        let hosts = net_hosts(t.app.handle().clone()).unwrap();
        assert_eq!(hosts, ["https://example.com", "http://192.0.2.1:8080"]);
    }

    #[test]
    fn a_confirmed_url_is_kept_as_its_origin_and_listed() {
        let t = guarded();
        let file = hosts_file(&t);
        let one = OneBox::default();
        let asked = Cell::new(0);
        let ask = |origin: &str| {
            asked.set(asked.get() + 1);
            assert_eq!(origin, "https://example.com:8443");
            MessageDialogResult::Custom("Confirmer".into())
        };
        let kept = confirm(&file, &one, "https://EXAMPLE.com:8443/v1/x?q=1#f", ask);
        assert_eq!(kept, Ok(true));
        assert_eq!(asked.get(), 1);
        // `ascii_serialization()`: lowercase, no path, a default port left out.
        assert_eq!(
            net_hosts(t.app.handle().clone()).unwrap(),
            ["https://example.com:8443"]
        );
        assert_admitted(&t, &["https://example.com:8443/"]);

        let kept = confirm(&file, &one, "https://example.org:443/", |_| {
            MessageDialogResult::Custom("Confirmer".into())
        });
        assert_eq!(kept, Ok(true));
        assert_eq!(
            net_hosts(t.app.handle().clone()).unwrap(),
            ["https://example.com:8443", "https://example.org"]
        );
    }

    #[test]
    fn any_other_button_keeps_nothing() {
        let t = guarded();
        let file = hosts_file(&t);
        let one = OneBox::default();
        for button in [
            MessageDialogResult::Custom("Annuler".into()),
            MessageDialogResult::Custom("Fermer".into()),
            MessageDialogResult::Cancel,
            MessageDialogResult::Yes,
            MessageDialogResult::Ok,
            MessageDialogResult::No,
            MessageDialogResult::Custom("confirmer".into()),
        ] {
            let asked = Cell::new(false);
            let r = confirm(&file, &one, "https://example.com/", |_| {
                asked.set(true);
                button.clone()
            });
            assert_eq!(r, Ok(false), "{button:?} must not confirm");
            assert!(asked.get());
            assert!(net_hosts(t.app.handle().clone()).unwrap().is_empty());
            assert_unconfirmed(&t, &[("https://example.com/", "https://example.com")]);
        }
        assert!(take(&one).is_ok(), "a refusal left the box taken");
    }

    #[test]
    fn no_box_for_the_loopback_or_a_confirmed_host() {
        let t = guarded();
        let file = hosts_file(&t);
        write_hosts(&t, r#"["https://example.com"]"#);
        let one = OneBox::default();
        let never = |_: &str| -> MessageDialogResult { panic!("the box must not open") };
        for url in [
            "http://127.0.0.1/",
            "http://127.0.0.1:8080/x",
            "https://localhost:11434/",
            "http://[::1]:8788/",
            "http://LOCALHOST/",
            "https://example.com/",
            "https://example.com:443/other?x",
        ] {
            assert_eq!(confirm(&file, &one, url, never), Ok(true), "{url}");
        }
    }

    /// The loopback and a known host need no box, so a box already open does not stop them.
    #[test]
    fn a_taken_guard_stops_a_new_host_only() {
        let t = guarded();
        let file = hosts_file(&t);
        write_hosts(&t, r#"["https://example.com"]"#);
        let one = OneBox::default();
        let first = take(&one).unwrap();
        let asked = Cell::new(false);
        let r = confirm(&file, &one, "https://example.org/", |_| {
            asked.set(true);
            MessageDialogResult::Custom("Confirmer".into())
        });
        assert_eq!(r, Err(BUSY.to_string()));
        assert!(!asked.get(), "a box opened over another one");
        assert_eq!(
            net_hosts(t.app.handle().clone()).unwrap(),
            ["https://example.com"]
        );

        let never = |_: &str| -> MessageDialogResult { panic!("the box must not open") };
        assert_eq!(confirm(&file, &one, "http://127.0.0.1/", never), Ok(true));
        assert_eq!(
            confirm(&file, &one, "https://example.com/", never),
            Ok(true)
        );
        drop(first);
    }

    /// The file is read again after the box: an origin forgotten while it was open stays forgotten.
    #[test]
    fn an_origin_forgotten_during_the_box_stays_forgotten() {
        let t = guarded();
        let file = hosts_file(&t);
        write_hosts(&t, r#"["https://example.com","https://example.org"]"#);
        let one = OneBox::default();
        let r = confirm(&file, &one, "https://example.net/", |_| {
            net_host_forget(t.app.handle().clone(), "https://example.org".into()).unwrap();
            MessageDialogResult::Custom("Confirmer".into())
        });
        assert_eq!(r, Ok(true));
        assert_eq!(
            net_hosts(t.app.handle().clone()).unwrap(),
            ["https://example.com", "https://example.net"]
        );
    }

    #[test]
    fn the_box_gives_the_guard_back_at_its_end() {
        let t = guarded();
        let file = hosts_file(&t);
        let one = OneBox::default();
        let during = Cell::new(false);
        let r = confirm(&file, &one, "https://example.com/", |_| {
            during.set(take(&one).is_err());
            MessageDialogResult::Cancel
        });
        assert_eq!(r, Ok(false));
        assert!(
            during.get(),
            "the guard was not held while the box was open"
        );
        assert!(take(&one).is_ok(), "the guard was not given back");
    }

    #[test]
    fn a_url_without_an_origin_is_not_asked() {
        let t = guarded();
        let file = hosts_file(&t);
        let one = OneBox::default();
        let never = |_: &str| -> MessageDialogResult { panic!("the box must not open") };
        for url in ["data:text/plain,x", "not an address", "", "file:///x"] {
            assert!(confirm(&file, &one, url, never).is_err(), "{url:?}");
        }
        assert!(!file.exists(), "a refusal wrote the file");
    }

    #[test]
    fn forgetting_an_unknown_origin_is_not_an_error() {
        let t = guarded();
        write_hosts(&t, r#"["https://example.com"]"#);
        net_host_forget(t.app.handle().clone(), "https://example.org".into()).unwrap();
        assert_eq!(
            net_hosts(t.app.handle().clone()).unwrap(),
            ["https://example.com"]
        );
    }
}
