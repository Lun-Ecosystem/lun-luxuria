//! The voice service, started with the app when it is not already running. The program and the script are
//! fixed; the folder is the one the person chose (`folders.rs`) and must still hold `service.py` at each launch;
//! the arguments, bounded to the flags the screen fills (`checked_service_args`), go to the script as they are,
//! never through a shell.
//! Its output goes to a log file, emptied at each launch: a pipe nobody reads would block it. Only what this app
//! started is stopped, and it joins the app's job (`job.rs`) so that it dies with it.

use serde::Serialize;
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

/** What the service was started with: the page compares it to what it would start now. */
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Running {
    pub folder: String,
    pub args: Vec<String>,
}

/** The service this app started, if any, with what it was started with: one at most, whatever the page asks. */
#[derive(Default)]
pub struct Launched(pub Mutex<Option<(Child, Running)>>);

/** A lock whose holder panicked still holds the processes to stop. */
pub fn hold<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(PoisonError::into_inner)
}

/** A folder by its full path, with `service.py`, kept as given. */
pub fn checked_dir(dir: &str) -> Result<PathBuf, String> {
    crate::folders::holding(dir, SCRIPT, "Dossier du service introuvable.")
}

const INVISIBLE: &str = "caractère invisible ou de contrôle refusé.";

/**
 * A control character, or one that shows as nothing or reorders text: a box would not show what starts.
 * shortcut: a list, not the Unicode categories (no dependency for them); revisit when an invisible character passes.
 */
pub fn hidden(c: char) -> bool {
    c.is_control()
        || matches!(c, '\u{00AD}' | '\u{034F}' | '\u{061C}' | '\u{115F}'..='\u{1160}'
            | '\u{180E}' | '\u{200B}'..='\u{200F}' | '\u{2028}'..='\u{202E}'
            | '\u{2060}'..='\u{2064}' | '\u{2066}'..='\u{2069}' | '\u{3164}'
            | '\u{FE00}'..='\u{FE0F}' | '\u{FEFF}' | '\u{FFA0}' | '\u{FFF9}'..='\u{FFFB}'
            | '\u{E0000}'..='\u{E007F}' | '\u{E0100}'..='\u{E01EF}')
}

/** Their number and their length, for the programs and the service. */
fn checked_limits(args: &[String]) -> Result<(), String> {
    if args.len() > ARGS_MAX {
        return Err(format!("Trop d’arguments ({ARGS_MAX} au plus)."));
    }
    if args.iter().any(|a| a.len() > ARG_LEN_MAX) {
        return Err("Argument illisible.".to_string());
    }
    Ok(())
}

/** A program's: refused by its rank, never shown raw, since what it holds is what would mislead. */
pub fn checked_args(args: &[String]) -> Result<(), String> {
    checked_limits(args)?;
    match (1..).zip(args).find(|(_, a)| a.chars().any(hidden)) {
        Some((rank, _)) => Err(format!("Argument {rank} : {INVISIBLE}")),
        None => Ok(()),
    }
}

/**
 * The flags the screen fills, word for word (argparse reads an abbreviation, `--orig` for `--origin`), with the name
 * the screen gives their field.
 */
const SERVICE_FLAGS: [(&str, &str); 5] = [
    ("--stt", "Transcription"),
    ("--tts", "Voix"),
    ("--rvc", "RVC"),
    ("--rvc-gain", "Gain de RVC"),
    ("--lang", "Langue"),
];

/**
 * The service's arguments: the general limits, then `SERVICE_FLAGS` only, each with its value (`--flag=value` reads
 * as `--flag value`), every occurrence checked since argparse keeps the last. A refusal names the field, an
 * invisible character's too, which is never shown.
 */
pub fn checked_service_args(args: &[String]) -> Result<(), String> {
    checked_limits(args)?;
    let mut rest = args.iter();
    while let Some(arg) = rest.next() {
        let (flag, inline) = match arg.split_once('=') {
            Some((flag, value)) => (flag, Some(value)),
            None => (arg.as_str(), None),
        };
        let Some(&(_, field)) = SERVICE_FLAGS.iter().find(|(f, _)| *f == flag) else {
            if flag.chars().any(hidden) {
                return Err(format!("Autres arguments : {INVISIBLE}"));
            }
            return Err(format!("Autres arguments : {flag} refusé."));
        };
        // As argparse reads it: a next word that starts with a dash is another flag, unless it is a number.
        // Each rule below refuses a value that starts with a dash.
        let value = inline
            .or_else(|| {
                rest.next()
                    .map(String::as_str)
                    .filter(|v| !v.starts_with('-') || v.parse::<f64>().is_ok())
            })
            .ok_or_else(|| format!("{field} : valeur manquante après {flag}."))?;
        if value.chars().any(hidden) {
            return Err(format!("{field} : {INVISIBLE}"));
        }
        checked_service_value(flag, field, value)?;
    }
    Ok(())
}

fn checked_service_value(flag: &str, field: &str, value: &str) -> Result<(), String> {
    // As the service reads it: `kind:rest`, split at the first `:`.
    let (kind, rest) = value.split_once(':').unwrap_or((value, ""));
    let near = |field: &str, url: &str| match crate::loopback::addr(url) {
        Some(_) => Ok(()),
        None if url.trim().is_empty() => Err(format!("{field} : adresse vide.")),
        None => Err(format!(
            "{field} : adresse refusée : {url} (127.0.0.1, localhost ou [::1] seulement)."
        )),
    };
    match flag {
        "--stt" => match kind {
            // Empty: the service reads `small`. A name only: faster-whisper also reads a path (`.`, `..` included)
            // or a repository.
            "faster"
                if rest.is_empty()
                    || (rest.starts_with(|c: char| c.is_ascii_alphanumeric())
                        && rest
                            .chars()
                            .all(|c| c.is_ascii_alphanumeric() || "._-".contains(c))) =>
            {
                Ok(())
            }
            "faster" => Err(format!(
                "Transcription : modèle refusé : {value} (un nom, sans chemin ni dépôt)."
            )),
            "whisper-server" => near("Transcription", rest),
            _ => Err(format!(
                "Transcription : {value} refusé (faster: ou whisper-server: seulement)."
            )),
        },
        "--rvc" => near("RVC", value),
        "--tts" => match kind {
            _ if value == "aucun" => Ok(()),
            "piper" if voice_file(rest) => Ok(()),
            "piper" => Err(format!(
                "Voix : fichier refusé : {rest} (un .onnx de ce poste, par son chemin complet)."
            )),
            "kokoro" => Err("Voix : kokoro ne se lance pas depuis l’appli.".to_string()),
            _ => Err(format!(
                "Voix : {value} refusé (piper:<fichier .onnx> ou aucun)."
            )),
        },
        // The page's own bound (`ServiceVoix.svelte`); a range holds neither infinity nor NaN. `-0` is in it.
        "--rvc-gain"
            if !value.starts_with('-')
                && value
                    .parse::<f64>()
                    .is_ok_and(|g| (0.0..=10.0).contains(&g)) =>
        {
            Ok(())
        }
        "--rvc-gain" => Err(format!("{field} : {value} refusé (un nombre de 0 à 10).")),
        "--lang"
            if (2..=3).contains(&value.len()) && value.bytes().all(|b| b.is_ascii_lowercase()) =>
        {
            Ok(())
        }
        // `--lang`, the last of `SERVICE_FLAGS`: a flag added there without its rule is refused.
        _ => Err(format!(
            "{field} : {value} refusé (deux ou trois lettres minuscules)."
        )),
    }
}

/**
 * A `.onnx` file of this PC by its full path. The drive letter is checked first: a `\\host` or `//host` path would
 * make Windows open a network connection as soon as the file is looked at.
 */
fn voice_file(path: &str) -> bool {
    let file = Path::new(path);
    matches!(path.as_bytes(), [l, b':', b'\\' | b'/', ..] if l.is_ascii_alphabetic())
        && file
            .extension()
            .is_some_and(|e| e.eq_ignore_ascii_case("onnx"))
        && file.is_file()
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

/** The log of a launch, checked before anything stops; emptied by `spawn_logged`, once what it replaces is gone. */
pub fn open_log(log: &Path) -> Result<File, String> {
    if let Some(parent) = log.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(false)
        .open(log)
        .map_err(|e| format!("Journal impossible à ouvrir : {e}"))
}

/** Spawns with its output in the log, emptied now so that it says this run only, and puts it in the app's job. */
pub fn spawn_logged(mut cmd: Command, out: File) -> Result<Child, std::io::Error> {
    out.set_len(0)?;
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

/** « code 1 », a system status in hexadecimal (« code 0xc0000135 »), or what the system says when there is none. */
pub fn ended(status: ExitStatus) -> String {
    status.code().map_or_else(
        || status.to_string(),
        |c| {
            if c < 0 {
                format!("code {:#x}", c as u32)
            } else {
                format!("code {c}")
            }
        },
    )
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
    checked_service_args(args)?;
    let out = open_log(log)?;
    spawn_into(&mut held, command(&root, args), out, &root, args, log)
}

/** The folder kept in `file` (`dossiers.json`). */
fn kept_dir(file: &Path) -> Result<String, String> {
    crate::folders::kept(file, "voix")
        .ok_or_else(|| "Choisis d’abord le dossier du service.".to_string())
}

/** `start` in the folder the person chose, checked again: it may have changed on the disk since. */
pub fn start_kept(
    launched: &Launched,
    file: &Path,
    args: &[String],
    log: &Path,
) -> Result<String, String> {
    start(launched, &kept_dir(file)?, args, log)
}

/** What the service this app started was started with, while it runs; `None`: not started here, or gone. */
pub fn running(launched: &Launched) -> Option<Running> {
    let mut held = hold(&launched.0);
    let (child, run) = held.as_mut()?;
    matches!(child.try_wait(), Ok(None)).then(|| run.clone())
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
    checked_service_args(args)?;
    let out = open_log(log)?;
    // Ours, alive or already gone: it makes room for the new one.
    if let Some((mut child, _)) = held.take() {
        kill_tree(&mut child);
    }
    spawn_into(&mut held, make(&root, args), out, &root, args, log)
}

fn spawn_into(
    held: &mut Option<(Child, Running)>,
    cmd: Command,
    out: File,
    root: &Path,
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
    let run = Running {
        folder: root.display().to_string(),
        args: args.to_vec(),
    };
    *held = Some((child, run));
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
    args: Vec<String>,
) -> Result<String, String> {
    use tauri::Manager;
    let logs = app.path().app_log_dir().map_err(|e| e.to_string())?;
    start_kept(
        &launched,
        &crate::folders::file(&app)?,
        &args,
        &logs.join("voix.log"),
    )
}

#[tauri::command(async)]
pub fn voice_restart(
    app: tauri::AppHandle,
    launched: tauri::State<'_, Launched>,
    args: Vec<String>,
) -> Result<String, String> {
    use tauri::Manager;
    let logs = app.path().app_log_dir().map_err(|e| e.to_string())?;
    let dir = kept_dir(&crate::folders::file(&app)?)?;
    restart(&launched, &dir, &args, &logs.join("voix.log"))
}

#[tauri::command]
pub fn voice_running(launched: tauri::State<'_, Launched>) -> Option<Running> {
    running(&launched)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(windows)]
    use crate::job::probe::{Watch, in_job};

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
            "piper:C:\\voix\\ma voix.onnx".to_string(),
        ];
        let cmd = command(&dir, &args);
        assert_eq!(cmd.get_program(), "uv");
        let got: Vec<_> = cmd
            .get_args()
            .map(|a| a.to_string_lossy().into_owned())
            .collect();
        assert_eq!(
            got,
            ["run", "service.py", "--tts", "piper:C:\\voix\\ma voix.onnx"]
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
    fn an_invisible_or_control_character_is_refused_by_its_rank() {
        // Each refused range by its ends, and controls past `\n`, `\r` and `\t`.
        let hidden = "\n\r\t\0\u{7F}\u{85}\u{00AD}\u{034F}\u{061C}\u{115F}\u{1160}\u{180E}\
            \u{200B}\u{200F}\u{2028}\u{2029}\u{202A}\u{202E}\u{2060}\u{2064}\u{2066}\u{2069}\
            \u{3164}\u{FE00}\u{FE0F}\u{FEFF}\u{FFA0}\u{FFF9}\u{FFFB}\u{E0000}\u{E007F}\u{E0100}\
            \u{E01EF}";
        assert_eq!(hidden.chars().count(), 33);
        for c in hidden.chars() {
            let args = ["-m".to_string(), "x".to_string(), format!("a{c}b")];
            assert_eq!(
                checked_args(&args),
                Err("Argument 3 : caractère invisible ou de contrôle refusé.".to_string()),
                "{c:?}"
            );
        }
    }

    #[test]
    fn accents_and_spaces_pass() {
        let args = [
            "--modèle".to_string(),
            "C:\\Mes modèles\\voix d’été.bin".to_string(),
        ];
        assert_eq!(checked_args(&args), Ok(()));
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

    #[cfg(windows)]
    #[test]
    fn each_launch_empties_its_log_once_what_it_replaces_is_gone() {
        let log = folder("journal", false).join("voix.log");
        fs::write(&log, "ancien").unwrap();
        // Opened before the old run stops, which may still write: emptied only at the launch.
        let out = open_log(&log).unwrap();
        assert_eq!(fs::read(&log).unwrap(), b"ancien");
        let mut child =
            spawn_logged(Command::new("C:\\Windows\\System32\\whoami.exe"), out).unwrap();
        child.wait().unwrap();
        let now = fs::read(&log).unwrap();
        assert!(!now.is_empty() && !now.windows(6).any(|w| w == b"ancien"));
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
        let was = Running {
            folder: "C:\\voix\\avant".to_string(),
            args: args.clone(),
        };
        *launched.0.lock().unwrap() = Some((first, was.clone()));
        assert_eq!(running(&launched), Some(was.clone()));
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
        assert_eq!(running(&launched), Some(was));
        let next = vec![
            "--stt".to_string(),
            "whisper-server:http://127.0.0.1:8080".to_string(),
        ];
        let log = base.join("voix.log");
        let pid = |l: &Launched| l.0.lock().unwrap().as_ref().unwrap().0.id();
        let old = Watch::new(pid(&launched));
        assert!(
            restart_with(&launched, dir.to_str().unwrap(), &next, &log, |_, _| ping(
                "30"
            ))
            .is_ok()
        );
        assert!(old.ended(Duration::from_secs(5)), "the old run must stop");
        // The new folder comes with the new arguments: the page sees either change.
        assert_eq!(
            running(&launched),
            Some(Running {
                folder: dir.display().to_string(),
                args: next
            })
        );
        assert!(in_job(&launched.0.lock().unwrap().as_ref().unwrap().0));
        let now = Watch::new(pid(&launched));
        stop(&launched);
        assert!(
            now.ended(Duration::from_secs(5)),
            "nothing stays after exit"
        );
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
        use std::os::windows::process::ExitStatusExt;
        assert_eq!(ended(ExitStatus::from_raw(1)), "code 1");
        // A missing DLL, as the system says it: only readable in hexadecimal.
        assert_eq!(ended(ExitStatus::from_raw(0xC000_0135)), "code 0xc0000135");
        let mut long = ping("30").stdout(Stdio::null()).spawn().unwrap();
        assert!(early_exit(&mut long, Duration::from_millis(200)).is_none());
        kill_tree(&mut long);
    }
}

/** The service's arguments, as the page builds them (`serviceArgs`, `src/desktop/voix.ts`) and as Rust bounds them. */
#[cfg(test)]
mod service_args {
    use super::*;

    fn strings(a: &[&str]) -> Vec<String> {
        a.iter().map(|s| s.to_string()).collect()
    }

    fn ok(a: &[&str]) {
        if let Err(e) = checked_service_args(&strings(a)) {
            panic!("{a:?} must pass, refused: {e}");
        }
    }

    /// Refused, and the message names the field the screen shows and the argument.
    fn refused(a: &[&str], field: &str, shown: &str) {
        let err = checked_service_args(&strings(a)).expect_err(&format!("{a:?} must be refused"));
        assert!(err.contains(field), "{err:?} must name {field:?}");
        assert!(err.contains(shown), "{err:?} must show {shown:?}");
    }

    /// A voice file in a temporary folder; the folder is the test's own.
    fn voice_file(tag: &str, name: &str) -> String {
        let dir = std::env::temp_dir().join(format!("luxuria-args-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join(name);
        fs::write(&file, "").unwrap();
        file.to_str().unwrap().to_string()
    }

    fn service_dir(tag: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("luxuria-args-dir-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join(SCRIPT), "").unwrap();
        dir
    }

    // What the page sends today.

    #[test]
    fn the_default_settings_pass() {
        ok(&["--stt", "faster:small"]);
    }

    #[test]
    fn whisper_server_on_the_loopback_passes() {
        ok(&["--stt", "whisper-server:http://127.0.0.1:8080"]);
        ok(&["--stt", "whisper-server:http://localhost:8080/"]);
        ok(&["--stt", "whisper-server:http://[::1]:8080"]);
    }

    #[cfg(windows)]
    #[test]
    fn a_voice_file_of_this_pc_passes_even_with_a_space() {
        let file = voice_file("ok", "ma voix.onnx");
        ok(&["--stt", "faster:small", "--tts", &format!("piper:{file}")]);
    }

    #[test]
    fn no_voice_passes() {
        ok(&["--stt", "faster:small", "--tts", "aucun"]);
    }

    #[test]
    fn rvc_and_its_gain_pass() {
        ok(&[
            "--stt",
            "faster:small",
            "--rvc",
            "http://127.0.0.1:5000",
            "--rvc-gain",
            "1",
        ]);
        ok(&["--rvc", "http://localhost:5000", "--rvc-gain", "0.75"]);
        // Out of the page's bound, 0 to 10 (`ServiceVoix.svelte`).
        refused(
            &["--rvc", "http://[::1]:5000", "--rvc-gain", "-2"],
            "Gain de RVC",
            "-2",
        );
    }

    #[test]
    fn a_gain_is_between_zero_and_ten() {
        ok(&["--rvc-gain", "0"]);
        ok(&["--rvc-gain", "10"]);
        refused(&["--rvc-gain", "10.5"], "Gain de RVC", "10.5");
        refused(&["--rvc-gain", "1e3"], "Gain de RVC", "1e3");
        // In the range as a number, but a value never starts with a dash.
        refused(&["--rvc-gain=-0"], "Gain de RVC", "-0");
    }

    #[cfg(windows)]
    #[test]
    fn every_field_together_passes() {
        let file = voice_file("tout", "voix.onnx");
        ok(&[
            "--stt",
            "whisper-server:http://127.0.0.1:8080",
            "--tts",
            &format!("piper:{file}"),
            "--rvc",
            "http://127.0.0.1:5000",
            "--rvc-gain",
            "1",
            "--lang",
            "fr",
        ]);
    }

    #[test]
    fn the_free_lines_may_hold_the_allowed_flags() {
        ok(&["--stt", "faster:small", "--lang", "fr"]);
        ok(&["--stt", "faster:small", "--lang", "eng"]);
    }

    #[test]
    fn a_flag_with_equals_reads_as_with_a_space() {
        ok(&["--stt=faster:small"]);
        ok(&["--stt=whisper-server:http://127.0.0.1:8080"]);
        refused(
            &["--stt=whisper-server:http://192.0.2.1:8080"],
            "Transcription",
            "192.0.2.1",
        );
        refused(&["--origin=x"], "Autres arguments", "--origin");
    }

    #[test]
    fn a_faster_model_name_may_hold_dots_underscores_and_dashes() {
        ok(&["--stt", "faster:large-v3"]);
        ok(&["--stt", "faster:distil_large.v3"]);
    }

    #[test]
    fn no_arguments_pass() {
        ok(&[]);
    }

    #[test]
    fn the_general_limits_still_apply() {
        let many = vec!["--stt".to_string(); ARGS_MAX + 1];
        assert!(checked_service_args(&many).is_err());
        assert!(checked_service_args(&strings(&["--lang", "f\0r"])).is_err());
    }

    #[test]
    fn an_invisible_or_control_character_names_the_field_of_its_flag() {
        for c in ['\n', '\r', '\t', '\u{202E}', '\u{200B}'] {
            let value = format!("f{c}r");
            let err = checked_service_args(&strings(&["--stt", "faster:small", "--lang", &value]));
            assert_eq!(
                err,
                Err("Langue : caractère invisible ou de contrôle refusé.".to_string()),
                "{c:?}"
            );
        }
    }

    #[test]
    fn an_empty_address_names_its_field() {
        let cases: [(&[&str], &str); 4] = [
            (&["--stt", "whisper-server:"], "Transcription"),
            (&["--stt=whisper-server:  "], "Transcription"),
            (&["--rvc", ""], "RVC"),
            (&["--rvc=  "], "RVC"),
        ];
        for (args, field) in cases {
            let err = checked_service_args(&strings(args));
            assert_eq!(err, Err(format!("{field} : adresse vide.")), "{args:?}");
        }
    }

    #[test]
    fn a_path_copied_with_its_hidden_mark_names_the_voice() {
        // Windows' file properties, « Sécurité », copy the path behind a U+202A.
        let voice = "Voix : caractère invisible ou de contrôle refusé.".to_string();
        let path = "piper:\u{202A}C:\\voix\\fr.onnx";
        let spaced = checked_service_args(&strings(&["--stt", "faster:small", "--tts", path]));
        assert_eq!(spaced, Err(voice.clone()));
        let inline = checked_service_args(&strings(&[&format!("--tts={path}")]));
        assert_eq!(inline, Err(voice));
    }

    #[test]
    fn an_invisible_character_off_the_flags_is_other_arguments_never_shown() {
        let err = checked_service_args(&strings(&["--stt\u{200B}", "faster:small"])).unwrap_err();
        assert_eq!(
            err,
            "Autres arguments : caractère invisible ou de contrôle refusé."
        );
    }

    #[cfg(windows)]
    #[test]
    fn a_voice_file_with_accents_passes() {
        let file = voice_file("accents", "voix d’été.onnx");
        let _root = crate::net_scope::TempRoot(Path::new(&file).parent().unwrap().to_path_buf());
        ok(&["--stt", "faster:small", "--tts", &format!("piper:{file}")]);
    }

    // Refused flags.

    #[test]
    fn origin_is_refused() {
        refused(&["--origin", "x"], "Autres arguments", "--origin");
    }

    #[test]
    fn origin_with_equals_is_refused() {
        refused(&["--origin=x"], "Autres arguments", "--origin");
    }

    #[test]
    fn the_abbreviation_of_origin_is_refused() {
        refused(&["--orig", "x"], "Autres arguments", "--orig");
    }

    #[test]
    fn port_is_refused() {
        refused(&["--port", "9"], "Autres arguments", "--port");
    }

    #[test]
    fn help_is_refused() {
        refused(&["-h"], "Autres arguments", "-h");
    }

    #[test]
    fn a_double_dash_is_refused() {
        refused(&["--"], "Autres arguments", "--");
    }

    #[test]
    fn a_lone_word_is_refused() {
        refused(
            &["--stt", "faster:small", "inference"],
            "Autres arguments",
            "inference",
        );
    }

    #[test]
    fn a_refused_flag_among_good_ones_is_refused() {
        refused(
            &["--stt", "faster:small", "--origin", "x"],
            "Autres arguments",
            "--origin",
        );
    }

    #[test]
    fn a_flag_without_a_value_is_refused() {
        refused(&["--stt"], "Transcription", "--stt");
        refused(&["--rvc"], "RVC", "--rvc");
        refused(&["--stt", "faster:small", "--lang"], "Langue", "--lang");
    }

    #[test]
    fn a_value_that_starts_with_a_dash_is_refused() {
        refused(&["--stt", "--tts", "aucun"], "Transcription", "--stt");
    }

    // Transcription.

    #[test]
    fn whisper_server_off_the_loopback_is_refused() {
        refused(
            &["--stt", "whisper-server:http://192.0.2.1:8080"],
            "Transcription",
            "192.0.2.1",
        );
    }

    #[test]
    fn whisper_server_with_a_path_is_refused() {
        refused(
            &["--stt", "whisper-server:http://127.0.0.1:8080/inference"],
            "Transcription",
            "/inference",
        );
    }

    #[test]
    fn an_empty_faster_model_name_passes() {
        ok(&["--stt", "faster:"]);
        ok(&["--stt", "faster"]);
    }

    #[test]
    fn a_faster_name_that_does_not_start_with_a_letter_or_digit_is_refused() {
        refused(&["--stt", "faster:."], "Transcription", "faster:.");
        refused(&["--stt", "faster:.."], "Transcription", "faster:..");
        refused(&["--stt", "faster:_small"], "Transcription", "_small");
    }

    #[test]
    fn a_faster_repository_is_refused() {
        refused(&["--stt", "faster:org/model"], "Transcription", "org/model");
    }

    #[test]
    fn a_faster_path_is_refused() {
        refused(&["--stt", "faster:C:\\m"], "Transcription", "C:\\m");
    }

    #[test]
    fn another_transcription_kind_is_refused() {
        refused(&["--stt", "cloud:small"], "Transcription", "cloud:small");
    }

    // RVC.

    #[test]
    fn rvc_off_the_loopback_is_refused() {
        refused(&["--rvc", "http://example.com"], "RVC", "example.com");
    }

    #[test]
    fn rvc_with_user_info_is_refused() {
        refused(
            &["--rvc", "http://127.0.0.1:5000@example.com"],
            "RVC",
            "example.com",
        );
    }

    #[test]
    fn a_gain_that_is_not_finite_is_refused() {
        refused(&["--rvc-gain", "inf"], "Gain de RVC", "inf");
        refused(&["--rvc-gain", "NaN"], "Gain de RVC", "NaN");
        refused(&["--rvc-gain", "loud"], "Gain de RVC", "loud");
    }

    // Voice.

    #[cfg(windows)]
    #[test]
    fn a_network_path_is_refused() {
        refused(
            &["--tts", "piper:\\\\hote\\partage\\v.onnx"],
            "Voix",
            "partage",
        );
    }

    #[cfg(windows)]
    #[test]
    fn a_forward_slash_network_path_is_refused() {
        refused(&["--tts", "piper://hote/partage/v.onnx"], "Voix", "partage");
    }

    #[test]
    fn a_relative_voice_is_refused() {
        refused(&["--tts", "piper:v.onnx"], "Voix", "v.onnx");
    }

    #[cfg(windows)]
    #[test]
    fn a_device_path_to_a_voice_file_that_exists_is_refused() {
        let file = voice_file("appareil", "voix.onnx");
        // The file exists: only the drive letter rule refuses these.
        ok(&["--tts", &format!("piper:{file}")]);
        refused(
            &["--tts", &format!("piper:\\\\?\\{file}")],
            "Voix",
            "voix.onnx",
        );
        refused(
            &["--tts", &format!("piper:\\\\.\\{file}")],
            "Voix",
            "voix.onnx",
        );
    }

    #[cfg(windows)]
    #[test]
    fn a_voice_file_that_does_not_exist_is_refused() {
        let file = voice_file("absent", "voix.onnx");
        fs::remove_file(&file).unwrap();
        refused(&["--tts", &format!("piper:{file}")], "Voix", "voix.onnx");
    }

    #[cfg(windows)]
    #[test]
    fn a_voice_file_that_is_not_onnx_is_refused() {
        let file = voice_file("txt", "voix.txt");
        refused(&["--tts", &format!("piper:{file}")], "Voix", "voix.txt");
    }

    #[cfg(windows)]
    #[test]
    fn a_folder_named_onnx_is_refused() {
        let file = voice_file("dir", "voix.onnx");
        fs::remove_file(&file).unwrap();
        fs::create_dir(&file).unwrap();
        refused(&["--tts", &format!("piper:{file}")], "Voix", "voix.onnx");
    }

    #[test]
    fn kokoro_is_refused_with_its_message() {
        refused(&["--tts", "kokoro:m.onnx:v.bin"], "Voix", "kokoro");
    }

    #[test]
    fn another_voice_kind_is_refused() {
        refused(&["--tts", "cloud:v"], "Voix", "cloud");
    }

    // Language.

    #[test]
    fn a_language_is_two_or_three_lowercase_letters() {
        refused(&["--lang", "FR"], "Langue", "FR");
        refused(&["--lang", "f"], "Langue", "f");
        refused(&["--lang", "french"], "Langue", "french");
        refused(&["--lang", "f1"], "Langue", "f1");
    }

    // Each occurrence is checked: argparse keeps the last one.

    #[test]
    fn a_refused_last_occurrence_is_refused() {
        refused(
            &[
                "--stt",
                "faster:small",
                "--stt",
                "whisper-server:http://192.0.2.1:8080",
            ],
            "Transcription",
            "192.0.2.1",
        );
    }

    #[test]
    fn a_refused_first_occurrence_is_refused_too() {
        refused(
            &[
                "--stt",
                "whisper-server:http://192.0.2.1:8080",
                "--stt",
                "faster:small",
            ],
            "Transcription",
            "192.0.2.1",
        );
    }

    // What the launch and the restart receive.

    #[test]
    fn a_refused_argument_starts_nothing() {
        let launched = Launched::default();
        let dir = service_dir("start");
        let log = dir.join("logs").join("voix.log");
        let err = start(
            &launched,
            dir.to_str().unwrap(),
            &strings(&["--origin", "x"]),
            &log,
        )
        .unwrap_err();
        assert!(err.contains("Autres arguments"), "{err:?}");
        assert!(launched.0.lock().unwrap().is_none());
        assert!(!log.exists(), "the log is not opened for a refused launch");
    }

    #[cfg(windows)]
    fn ping() -> Command {
        let mut cmd = Command::new("C:\\Windows\\System32\\PING.EXE");
        cmd.args(["-n", "30", "127.0.0.1"]);
        cmd
    }

    #[cfg(windows)]
    #[test]
    fn a_refused_restart_stops_nothing_and_launches_nothing() {
        use std::cell::Cell;
        let launched = Launched::default();
        let args = strings(&["--stt", "faster:small"]);
        let first = ping().stdout(Stdio::null()).spawn().unwrap();
        let pid = first.id();
        let was = Running {
            folder: "C:\\voix\\avant".to_string(),
            args: args.clone(),
        };
        *launched.0.lock().unwrap() = Some((first, was.clone()));
        let dir = service_dir("restart");
        let log = dir.join("voix.log");
        let made = Cell::new(false);
        for bad in [
            strings(&["--origin", "x"]),
            strings(&["--stt", "whisper-server:http://192.0.2.1:8080"]),
            strings(&["--rvc", "http://example.com"]),
        ] {
            let err = restart_with(&launched, dir.to_str().unwrap(), &bad, &log, |_, _| {
                made.set(true);
                ping()
            })
            .unwrap_err();
            assert!(!err.is_empty());
            assert_eq!(
                running(&launched),
                Some(was.clone()),
                "the running one stays"
            );
            assert_eq!(launched.0.lock().unwrap().as_ref().unwrap().0.id(), pid);
        }
        assert!(!made.get(), "no new process is built for a refused restart");
        assert!(!log.exists(), "the log is not opened either");
        stop(&launched);
    }
}
