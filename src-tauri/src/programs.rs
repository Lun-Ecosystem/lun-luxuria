//! whisper-server and RVC, started by the app when asked. The page never names what runs: each program is a `.exe`
//! chosen by the person in the system's file dialog, kept here in `programmes.json`, next to the app's settings.
//! The page only gives its arguments and the address where it answers. It is launched without a shell or a console,
//! in its own folder, joins the app's job (`job.rs`), and nothing is started when something already answers at its
//! address. Only what this app started is stopped, at exit or when its arguments change.

use crate::voice::{checked_args, early_exit, ended, hold, kill_tree, open_log, spawn_logged};
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::net::{TcpStream, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;

/** The only programs there are; a log file each. */
const NAMES: [&str; 2] = ["whisper-server", "rvc"];
const PROBE: Duration = Duration::from_millis(300);
/** A program that cannot start (a missing model, a bad argument) usually ends within this. */
const EARLY: Duration = Duration::from_millis(1500);
const PATHS: &str = "programmes.json";

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

/** The chosen programs, by name; an unreadable file reads as none chosen. */
pub fn read_paths(file: &Path) -> HashMap<String, String> {
    fs::read_to_string(file)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

/** Keeps a program's path, or forgets it with `None`. */
pub fn save_path(file: &Path, name: &str, path: Option<&Path>) -> Result<(), String> {
    let name = checked_name(name)?;
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

/** Something listens at `host:port`: a program already running, started by hand or by another app. */
pub fn listening(addr: &str) -> bool {
    addr.to_socket_addrs()
        .map(|mut all| all.any(|a| TcpStream::connect_timeout(&a, PROBE).is_ok()))
        .unwrap_or(false)
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
    addr: &str,
    log: &Path,
) -> Result<Started, String> {
    let name = checked_name(name)?;
    let exe = checked_exe(path.ok_or("Choisis d’abord son programme.")?)?;
    checked_args(args)?;
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
    } else if listening(addr) {
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
            "{name} s’est arrêté aussitôt ({}). Journal : {}",
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

/** `answering` at its address; else this app's `starting` (alive) or `stopped` (gone); else `absent`. */
pub fn state(programs: &Programs, name: &str, addr: &str) -> Result<&'static str, String> {
    let name = checked_name(name)?;
    if listening(addr) {
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

fn paths_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    use tauri::Manager;
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join(PATHS))
}

#[tauri::command]
pub fn program_paths(app: tauri::AppHandle) -> Result<HashMap<String, String>, String> {
    Ok(read_paths(&paths_file(&app)?))
}

/** The system's dialog, opened here: only the person chooses what the app may launch. `None`: cancelled. */
#[tauri::command(async)]
pub fn program_pick(app: tauri::AppHandle, name: String) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let name = checked_name(&name)?;
    let Some(picked) = app
        .dialog()
        .file()
        .set_title(format!("Le programme de {name}"))
        .add_filter("Programme", &["exe"])
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let path = picked.into_path().map_err(|e| e.to_string())?;
    let exe = checked_exe(&path.display().to_string())?;
    save_path(&paths_file(&app)?, name, Some(&exe))?;
    Ok(Some(exe.display().to_string()))
}

#[tauri::command]
pub fn program_forget(app: tauri::AppHandle, name: String) -> Result<(), String> {
    save_path(&paths_file(&app)?, &name, None)
}

/** Off the window's thread: the probe, the early wait and a stop take a moment. */
#[tauri::command(async)]
pub fn program_start(
    app: tauri::AppHandle,
    programs: tauri::State<'_, Programs>,
    name: String,
    args: Vec<String>,
    addr: String,
) -> Result<Started, String> {
    use tauri::Manager;
    let name = checked_name(&name)?;
    let path = read_paths(&paths_file(&app)?).remove(name);
    let logs = app.path().app_log_dir().map_err(|e| e.to_string())?;
    let log = logs.join(format!("{name}.log"));
    start(&programs, name, path.as_deref(), &args, &addr, &log)
}

#[tauri::command(async)]
pub fn program_state(
    programs: tauri::State<'_, Programs>,
    name: String,
    addr: String,
) -> Result<&'static str, String> {
    state(&programs, &name, &addr)
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
        let none = start(&programs, "rvc", None, &[], "127.0.0.1:9", &log);
        assert!(none.unwrap_err().contains("Choisis"));
        assert!(
            start(
                &programs,
                "cmd",
                Some("C:\\x.exe"),
                &[],
                "127.0.0.1:9",
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
                "127.0.0.1:9",
                &log
            )
            .is_err()
        );
        assert!(programs.0.lock().unwrap().is_empty());
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
            assert!(listening(&addr));
            let programs = Programs::default();
            let log = dir("repond").join("rvc.log");
            let got = start(&programs, "rvc", Some(PING), &args("30"), &addr, &log).unwrap();
            assert_eq!(got.outcome, "answering");
            assert!(programs.0.lock().unwrap().is_empty());
            assert_eq!(state(&programs, "rvc", &addr), Ok("answering"));
            drop(listener);
            assert!(!listening(&addr));
            assert!(!listening("pas une adresse"));
        }

        #[test]
        fn started_held_kept_then_restarted_with_new_arguments_then_stopped() {
            let programs = Programs::default();
            let log = dir("lance").join("rvc.log");
            let addr = "127.0.0.1:9";
            let first = start(&programs, "rvc", Some(PING), &args("30"), addr, &log).unwrap();
            assert_eq!(first.outcome, "started");
            assert_eq!(first.log, log.display().to_string());
            assert_eq!(state(&programs, "rvc", addr), Ok("starting"));
            let same = start(&programs, "rvc", Some(PING), &args("30"), addr, &log).unwrap();
            assert_eq!(same.outcome, "running");
            let other = start(&programs, "rvc", Some(PING), &args("40"), addr, &log).unwrap();
            assert_eq!(other.outcome, "restarted");
            stop_all(&programs);
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
                "127.0.0.1:9",
                &log,
            )
            .unwrap_err();
            assert!(err.contains("s’est arrêté aussitôt"), "{err}");
            assert!(err.contains("whisper-server.log"));
            assert!(programs.0.lock().unwrap().is_empty());
        }
    }
}
