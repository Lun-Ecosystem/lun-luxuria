//! The voice service, started with the app when it is not already running. The program and the script are
//! fixed; the folder must hold `service.py`; the arguments go to the script as they are, never through a shell.
//! Its output goes to a log file: a pipe nobody reads would block it. Only what this app started is stopped.

use std::fs::{self, OpenOptions};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

const SCRIPT: &str = "service.py";
const ARGS_MAX: usize = 32;
const ARG_LEN_MAX: usize = 1024;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/** The service this app started, if any: one at most, whatever the page asks. */
#[derive(Default)]
pub struct Launched(pub Mutex<Option<Child>>);

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

/** Starts the service once; a second call while it runs only says so. Returns the log's path. */
pub fn start(
    launched: &Launched,
    dir: &str,
    args: &[String],
    log: &Path,
) -> Result<String, String> {
    let mut held = launched
        .0
        .lock()
        .map_err(|_| "État du service illisible.".to_string())?;
    if let Some(child) = held.as_mut()
        && matches!(child.try_wait(), Ok(None))
    {
        return Ok(log.display().to_string());
    }
    let root = checked_dir(dir)?;
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
    let child = command(&root, args)
        .stdout(out)
        .stderr(err)
        .spawn()
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                "uv introuvable : installe uv, ou lance le service toi-même.".to_string()
            } else {
                format!("Lancement refusé : {e}")
            }
        })?;
    *held = Some(child);
    Ok(log.display().to_string())
}

/** At exit: the whole tree this app started (uv, then python), nothing else. */
pub fn stop(launched: &Launched) {
    let Ok(mut held) = launched.0.lock() else {
        return;
    };
    if let Some(mut child) = held.take() {
        // A service already gone: its id may belong to another process by now.
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
}

#[tauri::command]
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
}
