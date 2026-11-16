//! The folders the person chose (the body's, the voice service's) in the system's dialog, opened here: checked, kept
//! in `dossiers.json` next to `programmes.json`, read back by the commands. The page never gives a folder.

use crate::programs::{read_paths, save_entry};
use serde::Serialize;
use std::path::{Path, PathBuf};

const NAMES: [&str; 2] = ["corps", "voix"];
const FILE: &str = "dossiers.json";

/** What the page reads: a folder not chosen is left out, never `null`. */
#[derive(Serialize, Default)]
pub struct Paths {
    #[serde(skip_serializing_if = "Option::is_none")]
    corps: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    voix: Option<String>,
}

pub fn checked_name(name: &str) -> Result<&'static str, String> {
    NAMES
        .into_iter()
        .find(|n| *n == name)
        .ok_or_else(|| "Dossier inconnu.".to_string())
}

/**
 * An existing folder by its full path that holds `file`, kept as given, like `checked_exe`: `fs::canonicalize`
 * would give `\\?\` on Windows.
 */
pub fn holding(dir: &str, file: &str, missing: &str) -> Result<PathBuf, String> {
    let root = PathBuf::from(dir);
    if !root.is_absolute() || !root.is_dir() {
        return Err(missing.to_string());
    }
    if !root.join(file).is_file() {
        return Err(format!("Ce dossier n’a pas de {file}."));
    }
    Ok(root)
}

/** Checks the folder for its name, then keeps it; refused, nothing is written and the old choice stays. */
pub fn keep(file: &Path, name: &str, dir: &str) -> Result<String, String> {
    let name = checked_name(name)?;
    let root = match name {
        "corps" => holding(dir, crate::body::CONFIG, "Dossier du corps introuvable.")?,
        _ => crate::voice::checked_dir(dir)?,
    };
    save_entry(file, name, Some(&root))?;
    Ok(root.display().to_string())
}

/** The folder kept under `name`; an absent or unreadable file reads as none chosen. */
pub fn kept(file: &Path, name: &str) -> Option<String> {
    read_paths(file).remove(name)
}

pub fn forget(file: &Path, name: &str) -> Result<(), String> {
    save_entry(file, checked_name(name)?, None)
}

pub fn paths(file: &Path) -> Paths {
    let mut all = read_paths(file);
    Paths {
        corps: all.remove("corps"),
        voix: all.remove("voix"),
    }
}

pub fn file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    crate::programs::config_file(app, FILE)
}

/**
 * The system's folder dialog, opened here, like `program_pick`: the chosen path, or `None` when cancelled. Modal to
 * the window, behind the app's one box.
 */
#[tauri::command(async)]
pub fn folder_pick(
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
        .set_title(match name {
            "corps" => "Le dossier du corps",
            _ => "Le dossier du service voix",
        })
        .blocking_pick_folder()
    else {
        return Ok(None);
    };
    let dir = picked.into_path().map_err(|e| e.to_string())?;
    keep(&file(&app)?, name, &dir.display().to_string()).map(Some)
}

#[tauri::command]
pub fn folder_paths(app: tauri::AppHandle) -> Result<Paths, String> {
    Ok(paths(&file(&app)?))
}

#[tauri::command]
pub fn folder_forget(app: tauri::AppHandle, name: String) -> Result<(), String> {
    forget(&file(&app)?, &name)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::{Path, PathBuf};

    /** A fresh folder under the temp folder, removed when the test ends, even by a failed assert. */
    struct Scratch(PathBuf);

    impl Scratch {
        fn new(tag: &str) -> Self {
            let dir =
                std::env::temp_dir().join(format!("luxuria-dossiers-{tag}-{}", std::process::id()));
            let _ = fs::remove_dir_all(&dir);
            fs::create_dir_all(&dir).unwrap();
            Scratch(dir)
        }

        /** A sub-folder, with the file that makes it a body folder (`corps.json`) or a service one (`service.py`). */
        fn sub(&self, name: &str, file: Option<&str>) -> PathBuf {
            let dir = self.0.join(name);
            fs::create_dir_all(&dir).unwrap();
            if let Some(f) = file {
                fs::write(dir.join(f), "{}").unwrap();
            }
            dir
        }

        fn file(&self) -> PathBuf {
            self.0.join("conf").join("dossiers.json")
        }
    }

    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn s(p: &Path) -> &str {
        p.to_str().unwrap()
    }

    #[test]
    fn only_the_two_listed_names_are_folders() {
        assert_eq!(checked_name("corps").unwrap(), "corps");
        assert_eq!(checked_name("voix").unwrap(), "voix");
        for bad in [
            "",
            "Corps",
            "rvc",
            "whisper-server",
            "../corps",
            "corps ",
            "voix\0",
        ] {
            assert!(checked_name(bad).is_err(), "{bad:?}");
        }
        let t = Scratch::new("nom");
        let dir = t.sub("c", Some("corps.json"));
        assert!(keep(&t.file(), "rvc", s(&dir)).is_err());
        assert!(!t.file().exists(), "a refused name wrote a file");
    }

    #[test]
    fn a_body_folder_without_its_config_is_refused_and_nothing_is_written() {
        let t = Scratch::new("sans-corps");
        let empty = t.sub("vide", None);
        assert!(keep(&t.file(), "corps", s(&empty)).is_err());
        assert!(
            keep(&t.file(), "corps", s(&t.0.join("absent"))).is_err(),
            "a missing folder was kept"
        );
        // Only `service.py` is not enough for the body.
        let other = t.sub("autre", Some("service.py"));
        assert!(keep(&t.file(), "corps", s(&other)).is_err());
        assert!(!t.file().exists(), "a refusal wrote the file");
    }

    #[test]
    fn a_voice_folder_without_its_script_is_refused_and_nothing_is_written() {
        let t = Scratch::new("sans-service");
        let empty = t.sub("vide", None);
        let err = keep(&t.file(), "voix", s(&empty)).unwrap_err();
        assert!(err.contains("service.py"), "{err}");
        // Only `corps.json` is not enough for the voice.
        let other = t.sub("autre", Some("corps.json"));
        assert!(keep(&t.file(), "voix", s(&other)).is_err());
        assert!(!t.file().exists(), "a refusal wrote the file");
    }

    #[test]
    fn a_refused_folder_leaves_the_old_choice() {
        let t = Scratch::new("ancien");
        let good = t.sub("bon", Some("corps.json"));
        keep(&t.file(), "corps", s(&good)).unwrap();
        let before = fs::read_to_string(t.file()).unwrap();
        let bad = t.sub("mauvais", None);
        assert!(keep(&t.file(), "corps", s(&bad)).is_err());
        assert_eq!(fs::read_to_string(t.file()).unwrap(), before);
        assert_eq!(kept(&t.file(), "corps"), Some(s(&good).to_string()));
    }

    #[test]
    fn a_folder_is_kept_read_then_forgotten_by_its_name() {
        let t = Scratch::new("garde");
        let corps = t.sub("corps", Some("corps.json"));
        let voix = t.sub("voix", Some("service.py"));
        assert_eq!(kept(&t.file(), "corps"), None);
        assert_eq!(keep(&t.file(), "corps", s(&corps)).unwrap(), s(&corps));
        keep(&t.file(), "voix", s(&voix)).unwrap();
        assert_eq!(kept(&t.file(), "corps"), Some(s(&corps).to_string()));
        assert_eq!(kept(&t.file(), "voix"), Some(s(&voix).to_string()));
        forget(&t.file(), "corps").unwrap();
        assert_eq!(kept(&t.file(), "corps"), None);
        assert_eq!(
            kept(&t.file(), "voix"),
            Some(s(&voix).to_string()),
            "forgetting one name forgot the other"
        );
        assert!(forget(&t.file(), "rvc").is_err());
    }

    #[test]
    fn an_unreadable_file_reads_as_no_choice() {
        let t = Scratch::new("illisible");
        fs::create_dir_all(t.file().parent().unwrap()).unwrap();
        fs::write(t.file(), "pas du json").unwrap();
        assert_eq!(kept(&t.file(), "corps"), None);
        assert_eq!(kept(&t.file(), "voix"), None);
        let json = serde_json::to_string(&paths(&t.file())).unwrap();
        assert_eq!(json, "{}");
    }

    #[test]
    fn a_kept_folder_is_read_by_a_function_that_takes_the_files_path() {
        let t = Scratch::new("lecture");
        // The file is absent: no choice, no error.
        assert_eq!(kept(&t.file(), "voix"), None);
        let voix = t.sub("voix", Some("service.py"));
        keep(&t.file(), "voix", s(&voix)).unwrap();
        assert_eq!(kept(&t.file(), "voix"), Some(s(&voix).to_string()));
    }

    #[test]
    fn the_paths_omit_an_absent_folder_and_are_never_null() {
        let t = Scratch::new("serie");
        let json = |t: &Scratch| serde_json::to_value(paths(&t.file())).unwrap();
        assert_eq!(json(&t), serde_json::json!({}));
        let corps = t.sub("corps", Some("corps.json"));
        keep(&t.file(), "corps", s(&corps)).unwrap();
        assert_eq!(json(&t), serde_json::json!({ "corps": s(&corps) }));
        let voix = t.sub("voix", Some("service.py"));
        keep(&t.file(), "voix", s(&voix)).unwrap();
        forget(&t.file(), "corps").unwrap();
        let both = json(&t);
        assert_eq!(both, serde_json::json!({ "voix": s(&voix) }));
        assert!(!both.to_string().contains("null"));
    }

    #[test]
    fn the_voice_folder_check_keeps_the_path_as_given_without_the_extended_prefix() {
        let t = Scratch::new("prefixe");
        let dir = t.sub("voix", Some("service.py"));
        let got = crate::voice::checked_dir(s(&dir)).unwrap();
        assert_eq!(got, dir);
        assert!(!got.to_string_lossy().starts_with(r"\\?\"), "{got:?}");
        // Still refused: absolute, a folder, with the script.
        assert!(crate::voice::checked_dir(s(&t.sub("v", None))).is_err());
        assert!(crate::voice::checked_dir(s(&t.0.join("absent"))).is_err());
        assert!(
            crate::voice::checked_dir("voix").is_err(),
            "a relative path"
        );
        assert!(crate::voice::checked_dir(s(&dir.join("service.py"))).is_err());
    }

    #[test]
    fn the_body_reads_the_kept_folder_and_says_so_when_there_is_none() {
        let t = Scratch::new("corps-lu");
        assert_eq!(
            crate::body::config_kept(&t.file()).unwrap_err(),
            "Aucun dossier du corps choisi."
        );
        let corps = t.sub("corps", Some("corps.json"));
        fs::write(corps.join("corps.json"), "{\"nom\":\"x\"}").unwrap();
        keep(&t.file(), "corps", s(&corps)).unwrap();
        assert_eq!(
            crate::body::config_kept(&t.file()).unwrap(),
            "{\"nom\":\"x\"}"
        );
        assert_eq!(
            crate::body::image_kept(&t.file(), "repos.png").unwrap_err(),
            "Fichier introuvable : repos.png"
        );
        forget(&t.file(), "corps").unwrap();
        assert_eq!(
            crate::body::image_kept(&t.file(), "repos.png").unwrap_err(),
            "Aucun dossier du corps choisi."
        );
    }

    #[test]
    fn the_service_does_not_start_without_a_kept_folder() {
        let t = Scratch::new("service-sans");
        let launched = crate::voice::Launched::default();
        let log = t.0.join("log").join("voix.log");
        assert_eq!(
            crate::voice::start_kept(&launched, &t.file(), &[], &log).unwrap_err(),
            "Choisis d’abord le dossier du service."
        );
        assert!(launched.0.lock().unwrap().is_none());
        assert!(!log.exists(), "a refusal opened the log");
    }

    #[test]
    fn the_kept_voice_folder_is_checked_again_at_launch() {
        let t = Scratch::new("service-change");
        let voix = t.sub("voix", Some("service.py"));
        keep(&t.file(), "voix", s(&voix)).unwrap();
        // The folder changed on the disk since it was kept.
        fs::remove_file(voix.join("service.py")).unwrap();
        let launched = crate::voice::Launched::default();
        let log = t.0.join("log").join("voix.log");
        let err = crate::voice::start_kept(&launched, &t.file(), &[], &log).unwrap_err();
        assert!(err.contains("service.py"), "{err}");
        assert!(launched.0.lock().unwrap().is_none());
    }

    /** Needs a live process to hold: Windows only, like the other launch tests of `voice.rs`. */
    #[cfg(windows)]
    #[test]
    fn running_gives_the_folder_with_the_arguments() {
        use std::process::{Command, Stdio};
        let launched = crate::voice::Launched::default();
        assert!(crate::voice::running(&launched).is_none());
        let args = vec!["--lang".to_string(), "fr".to_string()];
        let mut ping = Command::new("C:\\Windows\\System32\\PING.EXE");
        ping.args(["-n", "30", "127.0.0.1"]).stdout(Stdio::null());
        let child = ping.spawn().unwrap();
        let run = crate::voice::Running {
            folder: "C:\\voix\\ma voix".to_string(),
            args: args.clone(),
        };
        *launched.0.lock().unwrap() = Some((child, run));
        let got = crate::voice::running(&launched).unwrap();
        assert_eq!(got.folder, "C:\\voix\\ma voix");
        assert_eq!(got.args, args);
        assert_eq!(
            serde_json::to_value(&got).unwrap(),
            serde_json::json!({ "folder": "C:\\voix\\ma voix", "args": ["--lang", "fr"] })
        );
        crate::voice::stop(&launched);
        assert!(crate::voice::running(&launched).is_none());
    }
}
