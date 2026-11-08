//! The voice service, started with the app when it is not already running. The program and the script are
//! fixed; the folder must hold `service.py`; the arguments go to the script as they are, never through a shell.
//! Its output goes to a log file, emptied at each launch: a pipe nobody reads would block it. Only what this app
//! started is stopped, and it joins the app's job (`job.rs`) so that it dies with it.

use std::fs::{self, File, OpenOptions};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::{Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

const SCRIPT: &str = "service.py";
const ARGS_MAX: usize = 32;
const ARG_LEN_MAX: usize = 1024;
#[cfg(windows)]
pub const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/** The service this app started, if any, with its arguments: one at most, whatever the page asks. */
#[derive(Default)]
pub struct Launched(pub Mutex<Option<(Child, Vec<String>)>>);

/** A lock whose holder panicked still holds the processes to stop. */
pub fn hold<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(PoisonError::into_inner)
}

pub fn checked_dir(dir: &str) -> Result<PathBuf, String> {
    let root = fs::canonicalize(dir).map_err(|_| "Dossier du service introuvable.".to_string())?;
    if !root.join(SCRIPT).is_file() {
        return Err(format!("Ce dossier n’a pas de {SCRIPT}."));
    }
    Ok(root)
}

pub fn checked_args(args: &[String]) -> Result<(), String> {
    if args.len() > ARGS_MAX {
        return Err(format!("Trop d’arguments ({ARGS_MAX} au plus)."));
    }
    if args
        .iter()
        .any(|a| a.len() > ARG_LEN_MAX || a.contains('\0'))
    {
        return Err("Argument illisible.".to_string());
    }
    Ok(())
}

/** `uv run service.py <args>` in the folder, without a console. */
pub fn command(dir: &Path, args: &[String]) -> Command {
    let mut cmd = Command::new("uv");
    cmd.arg("run")
        .arg(SCRIPT)
        .args(args)
        .current_dir(dir)
        .stdin(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

/** The log of this launch, emptied: what it says is about this run. */
pub fn open_log(log: &Path) -> Result<File, String> {
    if let Some(parent) = log.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(log)
        .map_err(|e| format!("Journal impossible à ouvrir : {e}"))
}

/** Spawns with its output in the log, and puts it in the app's job. */
pub fn spawn_logged(mut cmd: Command, out: File) -> Result<Child, std::io::Error> {
    let err = out.try_clone()?;
    let child = cmd.stdout(out).stderr(err).spawn()?;
    crate::job::adopt(&child);
    Ok(child)
}

/** How a process ended within `within`, if it did: a program that cannot start says so at once. */
pub fn early_exit(child: &mut Child, within: Duration) -> Option<ExitStatus> {
    let until = Instant::now() + within;
    loop {
        if let Ok(Some(status)) = child.try_wait() {
            return Some(status);
        }
        if Instant::now() >= until {
            return None;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
}

/** « code 1 », or what the system says when there is none. */
pub fn ended(status: ExitStatus) -> String {
    status
        .code()
        .map_or_else(|| status.to_string(), |c| format!("code {c}"))
}

/** Starts the service once; a second call while it runs only says so. Returns the log's path. */
pub fn start(
    launched: &Launched,
    dir: &str,
    args: &[String],
    log: &Path,
) -> Result<String, String> {
    let mut held = hold(&launched.0);
    if let Some((child, _)) = held.as_mut()
        && matches!(child.try_wait(), Ok(None))
    {
        return Ok(log.display().to_string());
    }
    let root = checked_dir(dir)?;
    checked_args(args)?;
    let out = open_log(log)?;
    spawn_into(&mut held, command(&root, args), out, args, log)
}

/** The arguments of the service this app started, while it runs; `None`: not started here, or gone. */
pub fn running(launched: &Launched) -> Option<Vec<String>> {
    let mut held = hold(&launched.0);
    let (child, args) = held.as_mut()?;
    matches!(child.try_wait(), Ok(None)).then(|| args.clone())
}

/**
 * Stops the service this app started and starts it with new settings, under one lock. One started by hand is
 * never touched: its process is not ours to stop. The new folder, the arguments and the log are checked before the
 * running one stops.
 */
pub fn restart(
    launched: &Launched,
    dir: &str,
    args: &[String],
    log: &Path,
) -> Result<String, String> {
    restart_with(launched, dir, args, log, command)
}

fn restart_with(
    launched: &Launched,
    dir: &str,
    args: &[String],
    log: &Path,
    make: impl Fn(&Path, &[String]) -> Command,
) -> Result<String, String> {
    let mut held = hold(&launched.0);
    if held.is_none() {
        return Err(
            "Le service voix n’a pas été lancé par l’appli : arrête-le toi-même, puis « Lancer ou vérifier »."
                .to_string(),
        );
    }
    let root = checked_dir(dir)?;
    checked_args(args)?;
    let out = open_log(log)?;
    // Ours, alive or already gone: it makes room for the new one.
    if let Some((mut child, _)) = held.take() {
        kill_tree(&mut child);
    }
    spawn_into(&mut held, make(&root, args), out, args, log)
}

fn spawn_into(
    held: &mut Option<(Child, Vec<String>)>,
    cmd: Command,
    out: File,
    args: &[String],
    log: &Path,
) -> Result<String, String> {
    let child = spawn_logged(cmd, out).map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            "uv introuvable : installe uv, ou lance le service toi-même.".to_string()
        } else {
            format!("Lancement refusé : {e}")
        }
    })?;
    *held = Some((child, args.to_vec()));
    Ok(log.display().to_string())
}

/** At exit: the whole tree this app started (uv, then python), nothing else. */
pub fn stop(launched: &Launched) {
    if let Some((mut child, _)) = hold(&launched.0).take() {
        kill_tree(&mut child);
    }
}

/** A process this app started, with what it started in turn. */
pub fn kill_tree(child: &mut Child) {
    // A process already gone: its id may belong to another one by now.
    #[cfg(windows)]
    if matches!(child.try_wait(), Ok(None)) {
        use std::os::windows::process::CommandExt;
        let _ = Command::new("taskkill")
            .args(["/T", "/F", "/PID", &child.id().to_string()])
            .creation_flags(CREATE_NO_WINDOW)
            .status();
    }
    let _ = child.kill();
    let _ = child.wait();
}

/** Off the window's thread: a launch checks files, opens its log and may stop a process. */
#[tauri::command(async)]
pub fn voice_start(
    app: tauri::AppHandle,
    launched: tauri::State<'_, Launched>,
    dir: String,
    args: Vec<String>,
) -> Result<String, String> {
    use tauri::Manager;
    let logs = app.path().app_log_dir().map_err(|e| e.to_string())?;
    start(&launched, &dir, &args, &logs.join("voix.log"))
}

#[tauri::command(async)]
pub fn voice_restart(
    app: tauri::AppHandle,
    launched: tauri::State<'_, Launched>,
    dir: String,
    args: Vec<String>,
) -> Result<String, String> {
    use tauri::Manager;
    let logs = app.path().app_log_dir().map_err(|e| e.to_string())?;
    restart(&launched, &dir, &args, &logs.join("voix.log"))
}

#[tauri::command]
pub fn voice_running(launched: tauri::State<'_, Launched>) -> Option<Vec<String>> {
    running(&launched)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn folder(tag: &str, with_script: bool) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("luxuria-voix-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        if with_script {
            fs::write(dir.join(SCRIPT), "").unwrap();
        }
        dir
    }

    #[test]
    fn the_folder_must_hold_the_script() {
        assert!(checked_dir(folder("ok", true).to_str().unwrap()).is_ok());
        assert!(
            checked_dir(folder("vide", false).to_str().unwrap())
                .unwrap_err()
                .contains("service.py")
        );
        assert!(
            checked_dir("Z:\\pas\\la")
                .unwrap_err()
                .contains("introuvable")
        );
    }

    #[test]
    fn arguments_pass_as_they_are_after_the_script() {
        let dir = folder("cmd", true);
        let args = vec![
            "--tts".to_string(),
            "piper:D:\\projets perso\\voix fr.onnx".to_string(),
        ];
        let cmd = command(&dir, &args);
        assert_eq!(cmd.get_program(), "uv");
        let got: Vec<_> = cmd
            .get_args()
            .map(|a| a.to_string_lossy().into_owned())
            .collect();
        assert_eq!(
            got,
            [
                "run",
                "service.py",
                "--tts",
                "piper:D:\\projets perso\\voix fr.onnx"
            ]
        );
        assert_eq!(cmd.get_current_dir(), Some(dir.as_path()));
    }

    #[test]
    fn too_many_or_unreadable_arguments_are_refused() {
        assert!(checked_args(&vec!["x".to_string(); ARGS_MAX + 1]).is_err());
        assert!(checked_args(&["a\0b".to_string()]).is_err());
        assert!(checked_args(&["x".repeat(ARG_LEN_MAX + 1)]).is_err());
        assert!(checked_args(&["--stt".to_string(), "faster:small".to_string()]).is_ok());
    }

    #[test]
    fn a_refused_folder_starts_nothing() {
        let launched = Launched::default();
        let log = folder("log", false).join("voix.log");
        assert!(
            start(
                &launched,
                folder("sans", false).to_str().unwrap(),
                &[],
                &log
            )
            .is_err()
        );
        assert!(launched.0.lock().unwrap().is_none());
    }

    #[test]
    fn a_service_not_started_here_is_not_restarted() {
        let launched = Launched::default();
        let log = folder("relance", false).join("voix.log");
        let dir = folder("relance-ok", true);
        let err = restart(&launched, dir.to_str().unwrap(), &[], &log).unwrap_err();
        assert!(err.contains("arrête-le toi-même"));
        assert!(running(&launched).is_none());
    }

    #[test]
    fn each_launch_empties_its_log() {
        let log = folder("journal", false).join("voix.log");
        fs::write(&log, "ancien").unwrap();
        drop(open_log(&log).unwrap());
        assert_eq!(fs::read_to_string(&log).unwrap(), "");
    }

    #[cfg(windows)]
    fn ping(seconds: &str) -> Command {
        let mut cmd = Command::new("C:\\Windows\\System32\\PING.EXE");
        cmd.args(["-n", seconds, "127.0.0.1"]);
        cmd
    }

    #[cfg(windows)]
    #[test]
    fn a_running_service_survives_a_refused_restart_then_restarts() {
        let launched = Launched::default();
        let args = vec!["--stt".to_string(), "faster:small".to_string()];
        let first = ping("30").stdout(Stdio::null()).spawn().unwrap();
        *launched.0.lock().unwrap() = Some((first, args.clone()));
        assert_eq!(running(&launched), Some(args.clone()));
        let base = folder("relance-refus", false);
        // A folder without the script, or a log that cannot open: refused before the running one stops.
        let no_script = folder("sans-script", false);
        assert!(
            restart(
                &launched,
                no_script.to_str().unwrap(),
                &[],
                &base.join("voix.log")
            )
            .is_err()
        );
        let dir = folder("relance-script", true);
        assert!(
            restart_with(&launched, dir.to_str().unwrap(), &[], &base, |_, _| ping(
                "30"
            ))
            .unwrap_err()
            .contains("Journal")
        );
        assert_eq!(running(&launched), Some(args));
        let next = vec![
            "--stt".to_string(),
            "whisper-server:http://127.0.0.1:8080".to_string(),
        ];
        let log = base.join("voix.log");
        assert!(
            restart_with(&launched, dir.to_str().unwrap(), &next, &log, |_, _| ping(
                "30"
            ))
            .is_ok()
        );
        assert_eq!(running(&launched), Some(next));
        stop(&launched);
        assert!(running(&launched).is_none());
    }

    #[cfg(windows)]
    #[test]
    fn a_process_that_ends_at_once_says_how() {
        let mut child = Command::new("C:\\Windows\\System32\\whoami.exe")
            .stdout(Stdio::null())
            .spawn()
            .unwrap();
        let status = early_exit(&mut child, Duration::from_secs(5)).expect("ended");
        assert!(ended(status).starts_with("code"));
        let mut long = ping("30").stdout(Stdio::null()).spawn().unwrap();
        assert!(early_exit(&mut long, Duration::from_millis(200)).is_none());
        kill_tree(&mut long);
    }
}
