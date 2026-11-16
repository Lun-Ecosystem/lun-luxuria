//! whisper-server and RVC, started by the app when asked. The page never names what runs: each program is a `.exe`
//! chosen by the person in the system's file dialog, kept here in `programmes.json`, next to the app's settings.
//! Its arguments, the page only proposes: the person confirms them in the system's box, and they are kept in
//! `arguments.json` until another exe is chosen for it. The page gives the address where it answers, on the loopback
//! only (`loopback.rs`). It is launched without a shell or a console, in its own folder, joins the app's job
//! (`job.rs`), and nothing is started when something already answers at its address. Only what this app started is
//! stopped, at exit or when its arguments change.

use crate::one_box::{self, OneBox};
use crate::voice::{checked_args, early_exit, ended, hold, kill_tree, open_log, spawn_logged};
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::net::{SocketAddr, TcpStream, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;
use tauri_plugin_dialog::MessageDialogResult;

/** The only programs there are; a log file each. */
const NAMES: [&str; 2] = ["whisper-server", "rvc"];
const PROBE: Duration = Duration::from_millis(300);
/** A program that cannot start (a missing model, a bad argument) usually ends within this. */
const EARLY: Duration = Duration::from_millis(1500);
const PATHS: &str = "programmes.json";
/** The arguments the person confirmed, by name: an absent key was never confirmed, an empty list was, empty. */
const ARGS: &str = "arguments.json";
const NO_EXE: &str = "Choisis d’abord son programme.";

/** A program this app started, with what it was started with. */
pub struct Held {
    child: Child,
    exe: PathBuf,
    args: Vec<String>,
    log: PathBuf,
}

#[derive(Default)]
pub struct Programs(pub Mutex<HashMap<String, Held>>);

#[derive(Serialize, Debug, PartialEq)]
pub struct Started {
    /** `started`, `restarted` (other arguments), `running` (as it is), `answering` (someone else's). */
    pub outcome: &'static str,
    pub log: String,
}

pub fn checked_name(name: &str) -> Result<&'static str, String> {
    NAMES
        .into_iter()
        .find(|n| *n == name)
        .ok_or_else(|| "Programme inconnu.".to_string())
}

/** How the screen names it. */
pub fn label(name: &str) -> &str {
    if name == "rvc" { "RVC" } else { name }
}

/** An existing `.exe`, by its full path; kept as written, so that its folder is a plain one for the program. */
pub fn checked_exe(path: &str) -> Result<PathBuf, String> {
    let exe = PathBuf::from(path.trim());
    let is_exe = exe
        .extension()
        .is_some_and(|e| e.eq_ignore_ascii_case("exe"));
    if !exe.is_absolute() || !exe.is_file() {
        return Err("Programme introuvable.".to_string());
    }
    if !is_exe {
        return Err("Ce n’est pas un programme .exe.".to_string());
    }
    Ok(exe)
}

/** The chosen paths, by name: the programs', the folders' (`folders.rs`); an unreadable file reads as none chosen. */
pub fn read_paths(file: &Path) -> HashMap<String, String> {
    fs::read_to_string(file)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

/** Keeps a program's path, or forgets it with `None`. */
pub fn save_path(file: &Path, name: &str, path: Option<&Path>) -> Result<(), String> {
    save_entry(file, checked_name(name)?, path)
}

/** Keeps `name`'s path in `file`, or forgets it with `None`; the name is checked by the caller. */
pub fn save_entry(file: &Path, name: &str, path: Option<&Path>) -> Result<(), String> {
    let mut paths = read_paths(file);
    match path {
        Some(p) => paths.insert(name.to_string(), p.display().to_string()),
        None => paths.remove(name),
    };
    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let text = serde_json::to_string_pretty(&paths).map_err(|e| e.to_string())?;
    fs::write(file, text).map_err(|e| e.to_string())
}

/** The confirmed arguments, by name; an unreadable file, or one that is not lists of strings, reads as none. */
pub fn read_arguments(file: &Path) -> HashMap<String, Vec<String>> {
    fs::read_to_string(file)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

/** Keeps `name`'s confirmed arguments, or forgets them with `None`; written as `save_entry` writes its file. */
pub fn save_arguments(file: &Path, name: &str, args: Option<&[String]>) -> Result<(), String> {
    let name = checked_name(name)?;
    let mut all = read_arguments(file);
    match args {
        Some(a) => all.insert(name.to_string(), a.to_vec()),
        None => all.remove(name),
    };
    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let text = serde_json::to_string_pretty(&all).map_err(|e| e.to_string())?;
    fs::write(file, text).map_err(|e| e.to_string())
}

/**
 * Keeps the exe picked for `name`. Another one than the exe kept drops its confirmed arguments, which were for that
 * program; dropped first, so that a failed write never leaves them to the new one.
 */
pub fn pick_saved(
    paths_file: &Path,
    args_file: &Path,
    name: &str,
    exe: &Path,
) -> Result<(), String> {
    let name = checked_name(name)?;
    if read_paths(paths_file).get(name) != Some(&exe.display().to_string()) {
        save_arguments(args_file, name, None)?;
    }
    save_entry(paths_file, name, Some(exe))
}

/** Forgets `name`'s exe and its confirmed arguments, these first. */
pub fn forget(paths_file: &Path, args_file: &Path, name: &str) -> Result<(), String> {
    save_arguments(args_file, name, None)?;
    save_path(paths_file, name, None)
}

/**
 * `true` when `name` may start with `args`: the arguments already confirmed at once, without a box; others once the
 * person confirms them in `ask` (its title, its text), then kept. `false`: refused at the box, nothing kept. Refused
 * before any box: an unknown name, no exe chosen, what `checked_args` refuses, a box already open.
 */
pub fn confirm_args(
    paths_file: &Path,
    args_file: &Path,
    one: &OneBox,
    name: &str,
    args: &[String],
    ask: impl FnOnce(&str, &str) -> MessageDialogResult,
) -> Result<bool, String> {
    let name = checked_name(name)?;
    if !read_paths(paths_file).contains_key(name) {
        return Err(NO_EXE.into());
    }
    checked_args(args)?;
    if read_arguments(args_file)
        .get(name)
        .is_some_and(|kept| kept.as_slice() == args)
    {
        return Ok(true);
    }
    let _box = one_box::take(one)?;
    let text = if args.is_empty() {
        "Aucun argument.".to_string()
    } else {
        args.join("\n")
    };
    if !one_box::confirmed(&ask(&format!("Les arguments de {}", label(name)), &text)) {
        return Ok(false);
    }
    // `save_arguments` reads the file again: it may have changed while the box was open.
    save_arguments(args_file, name, Some(args))?;
    Ok(true)
}

/** The field's address, as `host:port` on the loopback (`loopback.rs`); refused, as typed, when it is not. */
fn probed(url: &str) -> Result<String, String> {
    crate::loopback::addr(url).ok_or_else(|| {
        format!("Adresse refusée : {url} (127.0.0.1, localhost ou [::1] seulement).")
    })
}

/** Something listens at `host:port`, from `probed`: a program already running, started by hand or by another app. */
fn listening(addr: &str) -> bool {
    addr.to_socket_addrs()
        .map(|all| on_loopback(all).any(|a| TcpStream::connect_timeout(&a, PROBE).is_ok()))
        .unwrap_or(false)
}

/** `localhost` goes through the system's resolver, which a `hosts` line can send elsewhere: only the loopback stays. */
fn on_loopback(all: impl Iterator<Item = SocketAddr>) -> impl Iterator<Item = SocketAddr> {
    all.filter(|a| a.ip().is_loopback())
}

/** The program in its own folder, where it finds its models and files, without a console. */
pub fn command(exe: &Path, args: &[String]) -> Command {
    let mut cmd = Command::new(exe);
    cmd.args(args).stdin(Stdio::null());
    if let Some(dir) = exe.parent() {
        cmd.current_dir(dir);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(crate::voice::CREATE_NO_WINDOW);
    }
    cmd
}

pub fn start(
    programs: &Programs,
    name: &str,
    path: Option<&str>,
    args: &[String],
    url: &str,
    log: &Path,
) -> Result<Started, String> {
    let name = checked_name(name)?;
    let addr = probed(url)?;
    let exe = checked_exe(path.ok_or("Choisis d’abord son programme.")?)?;
    checked_args(args)?;
    // shortcut: held through the probe and the early wait (1.5 s), so two programs start one after the other;
    // one lock per program if starting them ever feels slow.
    let mut held = hold(&programs.0);
    let mut restarted = false;
    if let Some(h) = held.get_mut(name)
        && matches!(h.child.try_wait(), Ok(None))
    {
        if h.exe == exe && h.args == args {
            return Ok(Started {
                outcome: "running",
                log: h.log.display().to_string(),
            });
        }
        // Ours, with what it was given before: it makes room for the new arguments.
        kill_tree(&mut h.child);
        restarted = true;
    } else if listening(&addr) {
        return Ok(Started {
            outcome: "answering",
            log: String::new(),
        });
    }
    held.remove(name);
    let out = open_log(log)?;
    let mut child =
        spawn_logged(command(&exe, args), out).map_err(|e| format!("Lancement refusé : {e}"))?;
    if let Some(status) = early_exit(&mut child, EARLY) {
        return Err(format!(
            "{} s’est arrêté aussitôt ({}). Journal : {}",
            label(name),
            ended(status),
            log.display()
        ));
    }
    held.insert(
        name.to_string(),
        Held {
            child,
            exe,
            args: args.to_vec(),
            log: log.to_path_buf(),
        },
    );
    Ok(Started {
        outcome: if restarted { "restarted" } else { "started" },
        log: log.display().to_string(),
    })
}

/** `start` with the exe kept for `name` and the arguments confirmed for it; never confirmed, nothing starts. */
pub fn start_confirmed(
    programs: &Programs,
    name: &str,
    paths_file: &Path,
    args_file: &Path,
    url: &str,
    log: &Path,
) -> Result<Started, String> {
    let name = checked_name(name)?;
    // Before the files are read; `start` checks it again, as it does the name.
    probed(url)?;
    let path = read_paths(paths_file).remove(name).ok_or(NO_EXE)?;
    let args = read_arguments(args_file)
        .remove(name)
        .ok_or("Confirme d’abord ses arguments.")?;
    start(programs, name, Some(&path), &args, url, log)
}

/** `answering` at its address; else this app's `starting` (alive) or `stopped` (gone); else `absent`. */
pub fn state(programs: &Programs, name: &str, url: &str) -> Result<&'static str, String> {
    let name = checked_name(name)?;
    if listening(&probed(url)?) {
        return Ok("answering");
    }
    let mut held = hold(&programs.0);
    Ok(match held.get_mut(name).map(|h| h.child.try_wait()) {
        Some(Ok(None)) => "starting",
        Some(_) => "stopped",
        None => "absent",
    })
}

/** At exit: every program this app started, with what it started in turn. */
pub fn stop_all(programs: &Programs) {
    for (_, mut h) in hold(&programs.0).drain() {
        kill_tree(&mut h.child);
    }
}

/** A file of the app's config folder, where the person's choices are kept. */
pub fn config_file<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    name: &str,
) -> Result<PathBuf, String> {
    use tauri::Manager;
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join(name))
}

#[tauri::command]
pub fn program_paths(app: tauri::AppHandle) -> Result<HashMap<String, String>, String> {
    Ok(read_paths(&config_file(&app, PATHS)?))
}

/**
 * The system's dialog, opened here: only the person chooses what the app may launch. `None`: cancelled. Modal to
 * the window, so that a second click cannot open another one; the app's one box (`one_box.rs`) stops a second call.
 */
#[tauri::command(async)]
pub fn program_pick(
    app: tauri::AppHandle,
    window: tauri::Window,
    one: tauri::State<'_, crate::one_box::OneBox>,
    name: String,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let name = checked_name(&name)?;
    let _box = crate::one_box::take(&one)?;
    let Some(picked) = app
        .dialog()
        .file()
        .set_parent(&window)
        .set_title(format!("Le programme de {}", label(name)))
        .add_filter("Programme", &["exe"])
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let path = picked.into_path().map_err(|e| e.to_string())?;
    let exe = checked_exe(&path.display().to_string())?;
    pick_saved(
        &config_file(&app, PATHS)?,
        &config_file(&app, ARGS)?,
        name,
        &exe,
    )?;
    Ok(Some(exe.display().to_string()))
}

#[tauri::command]
pub fn program_forget(app: tauri::AppHandle, name: String) -> Result<(), String> {
    forget(&config_file(&app, PATHS)?, &config_file(&app, ARGS)?, &name)
}

#[tauri::command]
pub fn program_arguments(app: tauri::AppHandle) -> Result<HashMap<String, Vec<String>>, String> {
    Ok(read_arguments(&config_file(&app, ARGS)?))
}

/**
 * The arguments the page proposes, confirmed by the person in the app's box (`one_box.rs`), modal to the window.
 * Off the window's thread, like `program_pick`: the box blocks until answered.
 */
#[tauri::command(async)]
pub fn program_args(
    app: tauri::AppHandle,
    window: tauri::Window,
    one: tauri::State<'_, OneBox>,
    name: String,
    args: Vec<String>,
) -> Result<bool, String> {
    confirm_args(
        &config_file(&app, PATHS)?,
        &config_file(&app, ARGS)?,
        &one,
        &name,
        &args,
        |title, text| one_box::ask(&window, title, text),
    )
}

/** Off the window's thread: the probe, the early wait and a stop take a moment. */
#[tauri::command(async)]
pub fn program_start(
    app: tauri::AppHandle,
    programs: tauri::State<'_, Programs>,
    name: String,
    url: String,
) -> Result<Started, String> {
    use tauri::Manager;
    // Before it names the log file.
    let name = checked_name(&name)?;
    let logs = app.path().app_log_dir().map_err(|e| e.to_string())?;
    let log = logs.join(format!("{name}.log"));
    start_confirmed(
        &programs,
        name,
        &config_file(&app, PATHS)?,
        &config_file(&app, ARGS)?,
        &url,
        &log,
    )
}

#[tauri::command(async)]
pub fn program_state(
    programs: tauri::State<'_, Programs>,
    name: String,
    url: String,
) -> Result<&'static str, String> {
    state(&programs, &name, &url)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dir(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("luxuria-prog-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn only_the_two_programs_are_known() {
        assert_eq!(checked_name("rvc"), Ok("rvc"));
        assert_eq!(checked_name("whisper-server"), Ok("whisper-server"));
        assert!(checked_name("cmd").is_err());
        assert_eq!(label("rvc"), "RVC");
        assert_eq!(label("whisper-server"), "whisper-server");
    }

    #[test]
    fn only_an_existing_exe_by_its_full_path_is_accepted() {
        let d = dir("exe");
        fs::write(d.join("whisper-server.exe"), "").unwrap();
        fs::write(d.join("start.bat"), "").unwrap();
        fs::create_dir_all(d.join("dossier.exe")).unwrap();
        let ok = d.join("whisper-server.exe");
        assert_eq!(checked_exe(ok.to_str().unwrap()), Ok(ok.clone()));
        assert!(
            checked_exe(d.join("start.bat").to_str().unwrap())
                .unwrap_err()
                .contains(".exe")
        );
        assert!(checked_exe(d.join("dossier.exe").to_str().unwrap()).is_err());
        assert!(checked_exe("whisper-server.exe").is_err());
        assert!(
            checked_exe("Z:\\pas\\la.exe")
                .unwrap_err()
                .contains("introuvable")
        );
    }

    #[test]
    fn the_chosen_paths_are_kept_and_forgotten_by_name() {
        let file = dir("chemins").join("conf").join(PATHS);
        assert!(read_paths(&file).is_empty());
        save_path(&file, "rvc", Some(Path::new("D:\\rvc\\MMVCServerSIO.exe"))).unwrap();
        save_path(
            &file,
            "whisper-server",
            Some(Path::new("D:\\w\\whisper-server.exe")),
        )
        .unwrap();
        assert_eq!(read_paths(&file)["rvc"], "D:\\rvc\\MMVCServerSIO.exe");
        save_path(&file, "rvc", None).unwrap();
        assert!(!read_paths(&file).contains_key("rvc"));
        assert!(save_path(&file, "cmd", Some(Path::new("C:\\x.exe"))).is_err());
        fs::write(&file, "pas du json").unwrap();
        assert!(read_paths(&file).is_empty());
    }

    #[test]
    fn runs_in_its_own_folder_with_its_arguments() {
        let d = dir("cmd");
        let exe = d.join("whisper-server.exe");
        let args = vec!["-m".to_string(), "models\\ggml small.bin".to_string()];
        let cmd = command(&exe, &args);
        assert_eq!(cmd.get_program(), exe.as_os_str());
        let got: Vec<_> = cmd
            .get_args()
            .map(|a| a.to_string_lossy().into_owned())
            .collect();
        assert_eq!(got, ["-m", "models\\ggml small.bin"]);
        assert_eq!(cmd.get_current_dir(), Some(d.as_path()));
    }

    #[test]
    fn nothing_chosen_or_refused_starts_nothing() {
        let programs = Programs::default();
        let log = dir("refus").join("x.log");
        let none = start(&programs, "rvc", None, &[], "http://127.0.0.1:9", &log);
        assert!(none.unwrap_err().contains("Choisis"));
        assert!(
            start(
                &programs,
                "cmd",
                Some("C:\\x.exe"),
                &[],
                "http://127.0.0.1:9",
                &log
            )
            .is_err()
        );
        assert!(
            start(
                &programs,
                "rvc",
                Some("Z:\\absent.exe"),
                &[],
                "http://127.0.0.1:9",
                &log
            )
            .is_err()
        );
        assert!(programs.0.lock().unwrap().is_empty());
    }

    /// Addresses the field may hold that are not the loopback, or not an address at all.
    const REFUSED: [&str; 7] = [
        "http://192.0.2.1:8080",
        "http://example.com:80",
        "http://127.0.0.1@example.com:80",
        "127.0.0.1:9",
        "http://localhost:9/inference",
        "",
        "pas une adresse",
    ];

    fn is_refusal(err: &str, url: &str) -> bool {
        err.starts_with("Adresse refusée : ")
            && err.contains(url)
            && err.ends_with("(127.0.0.1, localhost ou [::1] seulement).")
    }

    #[test]
    fn state_refuses_an_address_off_the_loopback_without_probing() {
        let programs = Programs::default();
        for url in REFUSED {
            let err = state(&programs, "rvc", url).unwrap_err();
            assert!(is_refusal(&err, url), "{url:?} -> {err}");
        }
    }

    #[test]
    fn a_refused_address_never_reaches_a_listener() {
        // Each of these would read as the listener's `host:port` to a parser that looks only for one.
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let port = listener.local_addr().unwrap().port();
        let programs = Programs::default();
        let urls = [
            format!("http://127.0.0.1:{port}@example.com:80"),
            format!("http://user@127.0.0.1:{port}"),
            format!("http://127.0.0.1:{port}/inference"),
            format!("127.0.0.1:{port}"),
        ];
        let log = dir("sonde").join("rvc.log");
        for url in &urls {
            assert!(state(&programs, "rvc", url).is_err(), "{url}");
            assert!(
                start(&programs, "rvc", Some("C:\\x.exe"), &[], url, &log).is_err(),
                "{url}"
            );
        }
        let touched = listener.accept().map(|_| ()).map_err(|e| e.kind());
        assert_eq!(touched, Err(std::io::ErrorKind::WouldBlock));
    }

    #[test]
    fn the_loopback_hosts_are_admitted_by_the_probe() {
        let programs = Programs::default();
        for url in [
            "http://localhost:9",
            "http://[::1]:9",
            "http://127.0.0.1:9/",
        ] {
            assert_eq!(state(&programs, "rvc", url), Ok("absent"), "{url}");
        }
    }

    #[test]
    fn an_unknown_program_is_still_refused_by_name() {
        let programs = Programs::default();
        assert_eq!(
            state(&programs, "cmd", "http://127.0.0.1:9"),
            Err("Programme inconnu.".to_string())
        );
    }

    #[test]
    fn the_name_is_checked_before_the_address() {
        let programs = Programs::default();
        let url = "http://192.0.2.1:8080";
        assert_eq!(
            state(&programs, "cmd", url).unwrap_err(),
            "Programme inconnu."
        );
        let log = dir("nom").join("cmd.log");
        let err = start(&programs, "cmd", None, &[], url, &log).unwrap_err();
        assert_eq!(err, "Programme inconnu.");
    }

    #[test]
    fn the_address_is_checked_before_the_program() {
        let programs = Programs::default();
        let log = dir("ordre").join("rvc.log");
        let url = "http://192.0.2.1:8080";
        let err = start(&programs, "rvc", None, &[], url, &log).unwrap_err();
        assert!(is_refusal(&err, url), "{err}");
    }

    #[test]
    fn a_resolved_address_off_the_loopback_is_never_probed() {
        // What a `hosts` line could make `localhost` resolve to, next to what it should.
        let all: Vec<SocketAddr> = [
            "192.0.2.1:9",
            "127.0.0.1:9",
            "[::1]:9",
            "[::ffff:127.0.0.1]:9",
        ]
        .iter()
        .map(|a| a.parse().unwrap())
        .collect();
        let kept: Vec<_> = on_loopback(all.into_iter())
            .map(|a| a.to_string())
            .collect();
        assert_eq!(kept, ["127.0.0.1:9", "[::1]:9"]);
    }

    /// Task 6: the arguments the person confirmed, kept in `arguments.json` next to `programmes.json`. The functions
    /// named here are the contract: `read_arguments`, `save_arguments`, `confirm_args` (the box passed as a parameter,
    /// like `net_guard::confirm`), `pick_saved`, `forget`, `start_confirmed`.
    mod confirmed_args {
        use super::*;
        use crate::net_scope::TempRoot;
        use crate::one_box::{OneBox, take};
        use std::cell::RefCell;
        use tauri_plugin_dialog::MessageDialogResult;

        const BUSY: &str = "Une boîte est déjà ouverte.";
        const LOOP: &str = "http://127.0.0.1:9";

        struct Setup {
            paths: PathBuf,
            args: PathBuf,
            exe: PathBuf,
            other: PathBuf,
            /// The test's folder, logs included; it goes with the setup, panic or not.
            root: TempRoot,
        }

        /// Temporary files only; `rvc` has `rvc/a.exe` chosen when `chosen`, `rvc/b.exe` is another real exe.
        fn setup(tag: &str, chosen: bool) -> Setup {
            let d = dir(tag);
            let exe = d.join("a.exe");
            let other = d.join("b.exe");
            fs::write(&exe, "").unwrap();
            fs::write(&other, "").unwrap();
            let s = Setup {
                paths: d.join("conf").join(PATHS),
                args: d.join("conf").join("arguments.json"),
                exe,
                other,
                root: TempRoot(d),
            };
            if chosen {
                save_entry(&s.paths, "rvc", Some(&s.exe)).unwrap();
            }
            s
        }

        fn v(a: &[&str]) -> Vec<String> {
            a.iter().map(|s| s.to_string()).collect()
        }

        type Seen = RefCell<Vec<(String, String)>>;

        fn run(
            s: &Setup,
            one: &OneBox,
            name: &str,
            args: &[String],
            answer: MessageDialogResult,
            seen: &Seen,
        ) -> Result<bool, String> {
            confirm_args(&s.paths, &s.args, one, name, args, |title, text| {
                seen.borrow_mut().push((title.into(), text.into()));
                answer
            })
        }

        fn confirmed(s: &Setup, args: &[&str]) {
            save_arguments(&s.args, "rvc", Some(&v(args))).unwrap();
        }

        #[test]
        fn no_exe_chosen_refuses_without_a_box() {
            let s = setup("args-sans-exe", false);
            let (one, seen) = (OneBox::default(), Seen::default());
            let err = run(
                &s,
                &one,
                "rvc",
                &v(&["-p"]),
                MessageDialogResult::Yes,
                &seen,
            );
            assert!(err.unwrap_err().contains("Choisis d"));
            assert!(seen.borrow().is_empty());
            assert!(read_arguments(&s.args).is_empty());
        }

        #[test]
        fn a_name_off_the_list_is_refused_without_a_box() {
            let s = setup("args-inconnu", true);
            let (one, seen) = (OneBox::default(), Seen::default());
            let err = run(
                &s,
                &one,
                "cmd",
                &v(&["/c"]),
                MessageDialogResult::Yes,
                &seen,
            );
            assert_eq!(err, Err("Programme inconnu.".to_string()));
            assert!(seen.borrow().is_empty());
            assert!(!s.args.exists(), "nothing written for an unknown name");
        }

        #[test]
        fn the_arguments_already_confirmed_say_true_without_a_box() {
            let s = setup("args-egaux", true);
            confirmed(&s, &["-p", "7860"]);
            let (one, seen) = (OneBox::default(), Seen::default());
            let got = run(
                &s,
                &one,
                "rvc",
                &v(&["-p", "7860"]),
                MessageDialogResult::Cancel,
                &seen,
            );
            assert_eq!(got, Ok(true));
            assert!(seen.borrow().is_empty());
            // The guard taken does not matter: no box is needed.
            let _held = take(&one).unwrap();
            let again = run(
                &s,
                &one,
                "rvc",
                &v(&["-p", "7860"]),
                MessageDialogResult::Cancel,
                &seen,
            );
            assert_eq!(again, Ok(true));
            assert!(seen.borrow().is_empty());
        }

        #[test]
        fn confirmed_empty_equals_empty_but_never_confirmed_does_not() {
            let s = setup("args-vide", true);
            let (one, seen) = (OneBox::default(), Seen::default());
            // Never confirmed: the empty list is a change, so the box opens.
            let got = run(&s, &one, "rvc", &[], MessageDialogResult::Cancel, &seen);
            assert_eq!(got, Ok(false));
            assert_eq!(seen.borrow().len(), 1);
            confirmed(&s, &[]);
            let got = run(&s, &one, "rvc", &[], MessageDialogResult::Cancel, &seen);
            assert_eq!(got, Ok(true));
            assert_eq!(seen.borrow().len(), 1, "confirmed empty: no second box");
        }

        #[test]
        fn a_taken_guard_refuses_a_change_without_a_box() {
            let s = setup("args-garde", true);
            confirmed(&s, &["-p", "1"]);
            let (one, seen) = (OneBox::default(), Seen::default());
            let _held = take(&one).unwrap();
            let got = run(
                &s,
                &one,
                "rvc",
                &v(&["-p", "2"]),
                MessageDialogResult::Custom("Confirmer".into()),
                &seen,
            );
            assert_eq!(got, Err(BUSY.to_string()));
            assert!(seen.borrow().is_empty());
            assert_eq!(read_arguments(&s.args)["rvc"], v(&["-p", "1"]));
        }

        #[test]
        fn an_argument_refused_by_checked_args_opens_no_box() {
            let s = setup("args-bornes", true);
            let (one, seen) = (OneBox::default(), Seen::default());
            let yes = || MessageDialogResult::Custom("Confirmer".into());
            let many = vec!["x".to_string(); 33];
            assert!(run(&s, &one, "rvc", &many, yes(), &seen).is_err());
            assert!(run(&s, &one, "rvc", &v(&["a\0b"]), yes(), &seen).is_err());
            assert!(run(&s, &one, "rvc", &["y".repeat(1025)], yes(), &seen).is_err());
            assert!(seen.borrow().is_empty());
            assert!(read_arguments(&s.args).is_empty());
            assert!(take(&one).is_ok(), "the guard was not left taken");
        }

        #[test]
        fn an_invisible_or_control_character_opens_no_box() {
            // The box must show what starts: each of these would hide, split or reorder a line.
            let s = setup("args-invisibles", true);
            let (one, seen) = (OneBox::default(), Seen::default());
            for c in ['\n', '\r', '\t', '\u{202E}', '\u{200B}'] {
                let args = v(&["-p", &format!("1{c}--host")]);
                let yes = MessageDialogResult::Custom("Confirmer".into());
                assert_eq!(
                    run(&s, &one, "rvc", &args, yes, &seen),
                    Err("Argument 2 : caractère invisible ou de contrôle refusé.".to_string()),
                    "{c:?}"
                );
            }
            assert!(seen.borrow().is_empty());
            assert!(read_arguments(&s.args).is_empty());
        }

        #[test]
        fn accents_and_spaces_reach_the_box_as_they_are() {
            let s = setup("args-accents", true);
            let (one, seen) = (OneBox::default(), Seen::default());
            let args = v(&["--modèle", "C:\\Mes modèles\\voix d’été.bin"]);
            let yes = MessageDialogResult::Custom("Confirmer".into());
            assert_eq!(run(&s, &one, "rvc", &args, yes, &seen), Ok(true));
            assert_eq!(seen.borrow()[0].1.lines().collect::<Vec<_>>(), args);
            assert_eq!(read_arguments(&s.args)["rvc"], args);
        }

        #[test]
        fn only_confirmer_keeps_the_arguments() {
            let s = setup("args-reponses", true);
            let (one, seen) = (OneBox::default(), Seen::default());
            let no = [
                MessageDialogResult::Custom("Annuler".into()),
                MessageDialogResult::Custom("Fermer".into()),
                MessageDialogResult::Custom("confirmer".into()),
                MessageDialogResult::Cancel,
                MessageDialogResult::Yes,
                MessageDialogResult::No,
                MessageDialogResult::Ok,
            ];
            for answer in no {
                let label = format!("{answer:?}");
                let got = run(&s, &one, "rvc", &v(&["-p", "1"]), answer, &seen);
                assert_eq!(got, Ok(false), "{label}");
                assert!(read_arguments(&s.args).is_empty(), "{label} kept something");
                assert!(take(&one).is_ok(), "{label}: the guard was not given back");
            }
            let yes = MessageDialogResult::Custom("Confirmer".into());
            assert_eq!(run(&s, &one, "rvc", &v(&["-p", "1"]), yes, &seen), Ok(true));
            assert_eq!(read_arguments(&s.args)["rvc"], v(&["-p", "1"]));
            assert!(take(&one).is_ok(), "the guard was not given back");
        }

        #[test]
        fn a_refused_change_keeps_the_arguments_confirmed_before() {
            let s = setup("args-refus-garde", true);
            confirmed(&s, &["-p", "1"]);
            let (one, seen) = (OneBox::default(), Seen::default());
            let got = run(
                &s,
                &one,
                "rvc",
                &v(&["-p", "2"]),
                MessageDialogResult::Custom("Annuler".into()),
                &seen,
            );
            assert_eq!(got, Ok(false));
            assert_eq!(read_arguments(&s.args)["rvc"], v(&["-p", "1"]));
        }

        #[test]
        fn the_box_is_titled_with_the_program_and_lists_one_argument_per_line() {
            let s = setup("args-boite", true);
            let (one, seen) = (OneBox::default(), Seen::default());
            let args = v(&["-m", "models\\ggml small.bin", "--port", "8080"]);
            let _ = run(&s, &one, "rvc", &args, MessageDialogResult::Cancel, &seen);
            let seen = seen.borrow();
            assert_eq!(seen.len(), 1);
            assert_eq!(seen[0].0, "Les arguments de RVC");
            assert_eq!(seen[0].1.lines().collect::<Vec<_>>(), args);
            save_entry(&s.paths, "whisper-server", Some(&s.exe)).unwrap();
            let again = Seen::default();
            let _ = run(
                &s,
                &one,
                "whisper-server",
                &v(&["-m"]),
                MessageDialogResult::Cancel,
                &again,
            );
            assert_eq!(again.borrow()[0].0, "Les arguments de whisper-server");
        }

        #[test]
        fn confirmed_and_never_confirmed_are_not_the_same_in_the_file() {
            let s = setup("args-fichier", false);
            assert!(read_arguments(&s.args).is_empty());
            assert!(!read_arguments(&s.args).contains_key("rvc"));
            save_arguments(&s.args, "rvc", Some(&[])).unwrap();
            let read = read_arguments(&s.args);
            assert_eq!(read.get("rvc"), Some(&Vec::<String>::new()));
            assert!(!read.contains_key("whisper-server"));
        }

        #[test]
        fn writing_one_name_keeps_the_other_and_none_forgets() {
            let s = setup("args-deux", false);
            save_arguments(&s.args, "rvc", Some(&v(&["-p", "1"]))).unwrap();
            save_arguments(&s.args, "whisper-server", Some(&v(&["-m", "x"]))).unwrap();
            save_arguments(&s.args, "rvc", Some(&v(&["-p", "2"]))).unwrap();
            let read = read_arguments(&s.args);
            assert_eq!(read["rvc"], v(&["-p", "2"]));
            assert_eq!(read["whisper-server"], v(&["-m", "x"]));
            save_arguments(&s.args, "rvc", None).unwrap();
            let read = read_arguments(&s.args);
            assert!(!read.contains_key("rvc"));
            assert_eq!(read["whisper-server"], v(&["-m", "x"]));
            assert!(save_arguments(&s.args, "cmd", Some(&v(&["/c"]))).is_err());
        }

        #[test]
        fn an_unreadable_file_reads_as_none_and_can_be_written_over() {
            let s = setup("args-illisible", false);
            fs::create_dir_all(s.args.parent().unwrap()).unwrap();
            for junk in ["pas du json", "{\"rvc\": \"pas une liste\"}", "[1, 2]", ""] {
                fs::write(&s.args, junk).unwrap();
                assert!(read_arguments(&s.args).is_empty(), "{junk:?}");
            }
            fs::write(&s.args, "pas du json").unwrap();
            save_arguments(&s.args, "rvc", Some(&v(&["-p"]))).unwrap();
            assert_eq!(read_arguments(&s.args)["rvc"], v(&["-p"]));
        }

        #[test]
        fn another_exe_for_the_name_drops_its_confirmation() {
            // The plan says nothing: the cautious side, a confirmation was for one program.
            let s = setup("args-autre-exe", true);
            save_entry(&s.paths, "whisper-server", Some(&s.exe)).unwrap();
            confirmed(&s, &["-p", "1"]);
            save_arguments(&s.args, "whisper-server", Some(&v(&["-m", "x"]))).unwrap();
            pick_saved(&s.paths, &s.args, "rvc", &s.other).unwrap();
            assert_eq!(read_paths(&s.paths)["rvc"], s.other.display().to_string());
            let read = read_arguments(&s.args);
            assert!(
                !read.contains_key("rvc"),
                "the confirmation outlived its exe"
            );
            assert_eq!(
                read["whisper-server"],
                v(&["-m", "x"]),
                "the other name is untouched"
            );
            // Seen from the box: the same arguments ask again.
            let (one, seen) = (OneBox::default(), Seen::default());
            let got = run(
                &s,
                &one,
                "rvc",
                &v(&["-p", "1"]),
                MessageDialogResult::Cancel,
                &seen,
            );
            assert_eq!(got, Ok(false));
            assert_eq!(seen.borrow().len(), 1);
        }

        #[test]
        fn the_same_exe_picked_again_keeps_its_confirmation() {
            let s = setup("args-meme-exe", true);
            confirmed(&s, &["-p", "1"]);
            pick_saved(&s.paths, &s.args, "rvc", &s.exe).unwrap();
            assert_eq!(read_arguments(&s.args)["rvc"], v(&["-p", "1"]));
        }

        #[test]
        fn forgetting_a_program_forgets_its_arguments_too() {
            let s = setup("args-oubli", true);
            save_entry(&s.paths, "whisper-server", Some(&s.exe)).unwrap();
            confirmed(&s, &["-p", "1"]);
            save_arguments(&s.args, "whisper-server", Some(&v(&["-m"]))).unwrap();
            forget(&s.paths, &s.args, "rvc").unwrap();
            assert!(!read_paths(&s.paths).contains_key("rvc"));
            let read = read_arguments(&s.args);
            assert!(!read.contains_key("rvc"));
            assert_eq!(read["whisper-server"], v(&["-m"]));
            assert!(forget(&s.paths, &s.args, "cmd").is_err());
        }

        #[test]
        fn never_confirmed_arguments_start_nothing() {
            let s = setup("args-lance-jamais", true);
            let programs = Programs::default();
            let log = s.root.0.join("log").join("rvc.log");
            let err = start_confirmed(&programs, "rvc", &s.paths, &s.args, LOOP, &log).unwrap_err();
            assert!(
                err.contains("Confirme d") && err.contains("ses arguments"),
                "{err}"
            );
            assert!(programs.0.lock().unwrap().is_empty());
            assert!(!log.exists(), "no log: nothing was opened");
        }

        #[test]
        fn confirmed_empty_is_not_never_confirmed_at_start() {
            let s = setup("args-lance-vide", true);
            confirmed(&s, &[]);
            let programs = Programs::default();
            let log = s.root.0.join("log").join("rvc.log");
            // The empty file is no program: it fails to launch, which is past the arguments' check.
            let err = start_confirmed(&programs, "rvc", &s.paths, &s.args, LOOP, &log).unwrap_err();
            assert!(!err.contains("Confirme d"), "{err}");
            assert!(programs.0.lock().unwrap().is_empty());
        }

        #[test]
        fn start_keeps_the_name_and_the_address_checks() {
            let s = setup("args-lance-refus", true);
            confirmed(&s, &["-p"]);
            let programs = Programs::default();
            let log = s.root.0.join("log").join("x.log");
            let unknown = start_confirmed(&programs, "cmd", &s.paths, &s.args, LOOP, &log);
            assert_eq!(unknown, Err("Programme inconnu.".to_string()));
            let off = "http://192.0.2.1:8080";
            let err = start_confirmed(&programs, "rvc", &s.paths, &s.args, off, &log).unwrap_err();
            assert!(is_refusal(&err, off), "{err}");
            assert!(programs.0.lock().unwrap().is_empty());
        }

        #[cfg(windows)]
        #[test]
        fn start_runs_with_the_confirmed_arguments_and_compares_to_them() {
            const PING: &str = "C:\\Windows\\System32\\PING.EXE";
            let s = setup("args-lance", false);
            save_entry(&s.paths, "rvc", Some(Path::new(PING))).unwrap();
            let programs = Programs::default();
            let log = s.root.0.join("log").join("rvc.log");
            let held_args = |p: &Programs| p.0.lock().unwrap()["rvc"].args.clone();
            confirmed(&s, &["-n", "30", "127.0.0.1"]);
            let first = start_confirmed(&programs, "rvc", &s.paths, &s.args, LOOP, &log).unwrap();
            assert_eq!(first.outcome, "started");
            assert_eq!(held_args(&programs), v(&["-n", "30", "127.0.0.1"]));
            // Already running with these arguments: the confirmed ones are what it compares to.
            let same = start_confirmed(&programs, "rvc", &s.paths, &s.args, LOOP, &log).unwrap();
            assert_eq!(same.outcome, "running");
            confirmed(&s, &["-n", "40", "127.0.0.1"]);
            let other = start_confirmed(&programs, "rvc", &s.paths, &s.args, LOOP, &log).unwrap();
            assert_eq!(other.outcome, "restarted");
            assert_eq!(held_args(&programs), v(&["-n", "40", "127.0.0.1"]));
            stop_all(&programs);
        }
    }

    #[cfg(windows)]
    mod on_windows {
        use super::*;
        use std::net::TcpListener;
        const PING: &str = "C:\\Windows\\System32\\PING.EXE";
        fn args(n: &str) -> Vec<String> {
            vec!["-n".to_string(), n.to_string(), "127.0.0.1".to_string()]
        }

        #[test]
        fn something_answering_is_left_alone() {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let addr = listener.local_addr().unwrap().to_string();
            let url = format!("http://{addr}");
            assert!(listening(&addr));
            let programs = Programs::default();
            let log = dir("repond").join("rvc.log");
            let got = start(&programs, "rvc", Some(PING), &args("30"), &url, &log).unwrap();
            assert_eq!(got.outcome, "answering");
            assert!(programs.0.lock().unwrap().is_empty());
            assert_eq!(state(&programs, "rvc", &url), Ok("answering"));
            drop(listener);
            assert!(!listening(&addr));
            assert!(!listening("pas une adresse"));
        }

        #[test]
        fn started_held_kept_then_restarted_with_new_arguments_then_stopped() {
            use crate::job::probe::{Watch, in_job};
            let programs = Programs::default();
            let log = dir("lance").join("rvc.log");
            let addr = "http://127.0.0.1:9";
            let pid = |p: &Programs| p.0.lock().unwrap()["rvc"].child.id();
            let first = start(&programs, "rvc", Some(PING), &args("30"), addr, &log).unwrap();
            assert_eq!(first.outcome, "started");
            assert_eq!(first.log, log.display().to_string());
            assert!(in_job(&programs.0.lock().unwrap()["rvc"].child));
            assert_eq!(state(&programs, "rvc", addr), Ok("starting"));
            let first_run = Watch::new(pid(&programs));
            let same = start(&programs, "rvc", Some(PING), &args("30"), addr, &log).unwrap();
            assert_eq!(same.outcome, "running");
            assert!(!first_run.ended(Duration::ZERO));
            let other = start(&programs, "rvc", Some(PING), &args("40"), addr, &log).unwrap();
            assert_eq!(other.outcome, "restarted");
            assert!(
                first_run.ended(Duration::from_secs(5)),
                "the old run must stop"
            );
            let second_run = Watch::new(pid(&programs));
            stop_all(&programs);
            assert!(
                second_run.ended(Duration::from_secs(5)),
                "nothing stays after exit"
            );
            assert!(programs.0.lock().unwrap().is_empty());
            assert_eq!(state(&programs, "rvc", addr), Ok("absent"));
        }

        #[test]
        fn a_program_that_ends_at_once_says_so_with_its_log() {
            let programs = Programs::default();
            let log = dir("aussitot").join("whisper-server.log");
            let whoami = "C:\\Windows\\System32\\whoami.exe";
            let err = start(
                &programs,
                "whisper-server",
                Some(whoami),
                &[],
                "http://127.0.0.1:9",
                &log,
            )
            .unwrap_err();
            assert!(err.contains("s’est arrêté aussitôt"), "{err}");
            assert!(err.contains("whisper-server.log"));
            assert!(programs.0.lock().unwrap().is_empty());
        }

        #[test]
        fn a_refused_address_launches_nothing() {
            let programs = Programs::default();
            let log = dir("refuse").join("rvc.log");
            for url in REFUSED {
                let err = start(&programs, "rvc", Some(PING), &args("30"), url, &log).unwrap_err();
                assert!(is_refusal(&err, url), "{url:?} -> {err}");
                assert!(programs.0.lock().unwrap().is_empty());
                assert!(!log.exists(), "no log: nothing was opened for {url:?}");
            }
        }
    }
}
