//! whisper-server and RVC, started by the app when asked: each is a `.exe` named by its path in the settings,
//! with its arguments, launched without a shell or a console in its own folder. Nothing is started when
//! something already answers at its address. Only what this app started is stopped, at exit.

use crate::voice::{checked_args, kill_tree};
use std::collections::HashMap;
use std::fs::{self, OpenOptions};
use std::net::{TcpStream, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;

/** The only programs the page may name; a log file each. */
const NAMES: [&str; 2] = ["whisper-server", "rvc"];
const PROBE: Duration = Duration::from_millis(300);
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Default)]
pub struct Programs(pub Mutex<HashMap<String, Child>>);

pub fn checked_name(name: &str) -> Result<&'static str, String> {
    NAMES
        .into_iter()
        .find(|n| *n == name)
        .ok_or_else(|| "Programme inconnu.".to_string())
}

/** An existing `.exe` file, by its full path. */
pub fn checked_exe(path: &str) -> Result<PathBuf, String> {
    let exe = fs::canonicalize(path.trim()).map_err(|_| "Programme introuvable.".to_string())?;
    let is_exe = exe
        .extension()
        .is_some_and(|e| e.eq_ignore_ascii_case("exe"));
    if !exe.is_file() || !is_exe {
        return Err("Ce n’est pas un programme .exe.".to_string());
    }
    Ok(exe)
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
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

/** `started`, `running` (this app's, still alive) or `answering` (someone else's at the address). */
pub fn start(
    programs: &Programs,
    name: &str,
    path: &str,
    args: &[String],
    addr: &str,
    log: &Path,
) -> Result<&'static str, String> {
    let name = checked_name(name)?;
    let mut held = programs
        .0
        .lock()
        .map_err(|_| "État des programmes illisible.".to_string())?;
    if let Some(child) = held.get_mut(name)
        && matches!(child.try_wait(), Ok(None))
    {
        return Ok("running");
    }
    if listening(addr) {
        return Ok("answering");
    }
    let exe = checked_exe(path)?;
    checked_args(args)?;
    if let Some(parent) = log.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let out = OpenOptions::new()
        .create(true)
        .append(true)
        .open(log)
        .map_err(|e| e.to_string())?;
    let err = out.try_clone().map_err(|e| e.to_string())?;
    let child = command(&exe, args)
        .stdout(out)
        .stderr(err)
        .spawn()
        .map_err(|e| format!("Lancement refusé : {e}"))?;
    held.insert(name.to_string(), child);
    Ok("started")
}

/** At exit: every program this app started, with what it started in turn. */
pub fn stop_all(programs: &Programs) {
    let Ok(mut held) = programs.0.lock() else {
        return;
    };
    for (_, mut child) in held.drain() {
        kill_tree(&mut child);
    }
}

#[tauri::command]
pub fn program_start(
    app: tauri::AppHandle,
    programs: tauri::State<'_, Programs>,
    name: String,
    path: String,
    args: Vec<String>,
    addr: String,
) -> Result<String, String> {
    use tauri::Manager;
    let logs = app.path().app_log_dir().map_err(|e| e.to_string())?;
    let log = logs.join(format!("{}.log", checked_name(&name)?));
    start(&programs, &name, &path, &args, &addr, &log).map(String::from)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;

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
    fn only_an_existing_exe_is_accepted() {
        let d = dir("exe");
        fs::write(d.join("whisper-server.exe"), "").unwrap();
        fs::write(d.join("start.bat"), "").unwrap();
        fs::create_dir_all(d.join("dossier.exe")).unwrap();
        assert!(checked_exe(d.join("whisper-server.exe").to_str().unwrap()).is_ok());
        assert!(
            checked_exe(d.join("start.bat").to_str().unwrap())
                .unwrap_err()
                .contains(".exe")
        );
        assert!(checked_exe(d.join("dossier.exe").to_str().unwrap()).is_err());
        assert!(
            checked_exe("Z:\\pas\\la.exe")
                .unwrap_err()
                .contains("introuvable")
        );
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
    fn something_answering_is_left_alone() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap().to_string();
        assert!(listening(&addr));
        let programs = Programs::default();
        let log = dir("log").join("rvc.log");
        // The path is not even read: nothing starts.
        assert_eq!(
            start(&programs, "rvc", "Z:\\absent.exe", &[], &addr, &log),
            Ok("answering")
        );
        assert!(programs.0.lock().unwrap().is_empty());
        drop(listener);
        assert!(!listening(&addr));
        assert!(!listening("pas une adresse"));
    }

    #[test]
    fn a_refused_program_starts_nothing() {
        let programs = Programs::default();
        let log = dir("refus").join("x.log");
        assert!(
            start(
                &programs,
                "cmd",
                "C:\\Windows\\System32\\cmd.exe",
                &[],
                "127.0.0.1:9",
                &log
            )
            .is_err()
        );
        assert!(start(&programs, "rvc", "Z:\\absent.exe", &[], "127.0.0.1:9", &log).is_err());
        assert!(programs.0.lock().unwrap().is_empty());
    }

    #[cfg(windows)]
    #[test]
    fn a_started_program_is_held_then_stopped() {
        let programs = Programs::default();
        let log = dir("lance").join("rvc.log");
        let ping = "C:\\Windows\\System32\\PING.EXE";
        let args = vec!["-n".to_string(), "30".to_string(), "127.0.0.1".to_string()];
        assert_eq!(
            start(&programs, "rvc", ping, &args, "127.0.0.1:9", &log),
            Ok("started")
        );
        assert_eq!(
            start(&programs, "rvc", ping, &args, "127.0.0.1:9", &log),
            Ok("running")
        );
        stop_all(&programs);
        assert!(programs.0.lock().unwrap().is_empty());
    }
}
