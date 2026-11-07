//! The body's folder: `corps.json` and the images it names, read inside that folder and nowhere else. The page
//! gets bytes, never a path it could widen: no general access to the disk.

use std::fs;
use std::path::{Path, PathBuf};

pub const CONFIG: &str = "corps.json";
const CONFIG_MAX: u64 = 64 * 1024;
pub const IMAGE_MAX: u64 = 10 * 1024 * 1024;
const EXTENSIONS: [&str; 5] = ["png", "jpg", "jpeg", "webp", "gif"];
const RESERVED: [&str; 22] = [
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

/** A plain file name: no folder, no stream, no device, an image extension. */
pub fn checked_name(name: &str) -> Result<(), String> {
    let refused = || Err(format!("Nom refusé : {name}"));
    if name.is_empty()
        || name.contains(['/', '\\', ':', '\0'])
        || name.starts_with('.')
        || name.contains("..")
    {
        return refused();
    }
    let path = Path::new(name);
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("");
    if RESERVED.iter().any(|r| r.eq_ignore_ascii_case(stem)) {
        return refused();
    }
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase);
    match ext {
        Some(e) if EXTENSIONS.contains(&e.as_str()) => Ok(()),
        _ => Err(format!("Format refusé : {name} (png, jpg, webp ou gif)")),
    }
}

/** The file, once links and junctions are followed, must still lie inside the folder. */
fn inside(folder: &Path, name: &str) -> Result<PathBuf, String> {
    let root = fs::canonicalize(folder).map_err(|_| "Dossier du corps introuvable.".to_string())?;
    let file =
        fs::canonicalize(root.join(name)).map_err(|_| format!("Fichier introuvable : {name}"))?;
    if !file.starts_with(&root) || !file.is_file() {
        return Err(format!("Fichier hors du dossier : {name}"));
    }
    Ok(file)
}

fn read_capped(path: &Path, max: u64, name: &str) -> Result<Vec<u8>, String> {
    let size = fs::metadata(path).map_err(|e| e.to_string())?.len();
    if size > max {
        return Err(format!(
            "Fichier trop lourd : {name} ({} Mo au plus)",
            max / 1024 / 1024
        ));
    }
    fs::read(path).map_err(|_| format!("Fichier illisible : {name}"))
}

pub fn config(folder: &Path) -> Result<String, String> {
    let file = inside(folder, CONFIG)?;
    let bytes = read_capped(&file, CONFIG_MAX, CONFIG)?;
    String::from_utf8(bytes).map_err(|_| format!("{CONFIG} illisible."))
}

pub fn image(folder: &Path, name: &str) -> Result<Vec<u8>, String> {
    checked_name(name)?;
    let file = inside(folder, name)?;
    read_capped(&file, IMAGE_MAX, name)
}

#[tauri::command]
pub fn body_config(folder: String) -> Result<String, String> {
    config(Path::new(&folder))
}

#[tauri::command]
pub fn body_image(folder: String, name: String) -> Result<tauri::ipc::Response, String> {
    image(Path::new(&folder), &name).map(tauri::ipc::Response::new)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn folder(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("luxuria-corps-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn plain_image_names_only() {
        for ok in ["repos.png", "Parole.JPG", "a.b.webp"] {
            assert!(checked_name(ok).is_ok(), "{ok}");
        }
        for bad in [
            "",
            "../repos.png",
            "..\\repos.png",
            "sous/repos.png",
            "sous\\repos.png",
            "C:repos.png",
            "repos.png:cache",
            "CON.png",
            "nul.png",
            "com1.png",
            ".png",
            "repos.exe",
            "repos",
            "repos.svg",
        ] {
            assert!(checked_name(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn reads_the_config_and_an_image_inside_the_folder() {
        let dir = folder("ok");
        fs::write(
            dir.join(CONFIG),
            r#"{"niveau":"images","repos":"repos.png"}"#,
        )
        .unwrap();
        fs::write(dir.join("repos.png"), [1u8, 2, 3]).unwrap();
        assert!(config(&dir).unwrap().contains("repos.png"));
        assert_eq!(image(&dir, "repos.png").unwrap(), vec![1, 2, 3]);
    }

    #[test]
    fn missing_folder_file_or_too_heavy() {
        let dir = folder("manque");
        assert!(config(&dir).unwrap_err().contains("introuvable"));
        assert!(
            image(&dir, "repos.png")
                .unwrap_err()
                .contains("introuvable")
        );
        assert!(config(&dir.join("pas-la")).unwrap_err().contains("Dossier"));
        let heavy = fs::File::create(dir.join("lourd.png")).unwrap();
        heavy.set_len(IMAGE_MAX + 1).unwrap();
        assert!(image(&dir, "lourd.png").unwrap_err().contains("trop lourd"));
    }

    #[test]
    fn a_folder_named_like_an_image_is_not_read() {
        let dir = folder("dossier");
        fs::create_dir_all(dir.join("repos.png")).unwrap();
        assert!(image(&dir, "repos.png").is_err());
    }

    #[test]
    fn a_link_out_of_the_folder_is_refused() {
        let dir = folder("lien");
        let outside = folder("dehors");
        fs::write(outside.join("secret.png"), [9u8]).unwrap();
        // A file link needs a privilege Windows may refuse: the check then has nothing to test.
        #[cfg(windows)]
        let made =
            std::os::windows::fs::symlink_file(outside.join("secret.png"), dir.join("lien.png"));
        #[cfg(unix)]
        let made = std::os::unix::fs::symlink(outside.join("secret.png"), dir.join("lien.png"));
        match made {
            Ok(()) => assert!(
                image(&dir, "lien.png")
                    .unwrap_err()
                    .contains("hors du dossier")
            ),
            // The CI runs with the privilege: there, a skip would hide the only proof.
            Err(e) if std::env::var_os("CI").is_some() => panic!("lien non créé en CI : {e}"),
            Err(e) => eprintln!("lien non créé ({e}) : vérification sautée"),
        }
    }
}
