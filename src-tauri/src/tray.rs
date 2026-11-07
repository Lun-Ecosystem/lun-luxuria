//! The tray icon: three states drawn from the app icon, and a menu whose clicks go to the page as `tray` events.
//! Nothing is decided here: the page says the state, and acts on the menu.

use tauri::image::Image;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Wry};

const ICON: &[u8] = include_bytes!("../icons/32x32.png");

/// The mute entry, checked by the state the page gives.
pub struct MuteItem(CheckMenuItem<Wry>);

/// Grey for silenced; grey and faded for unreachable; the plain icon otherwise. RGBA, in place.
pub fn shade(rgba: &mut [u8], state: &str) {
    if state == "present" {
        return;
    }
    for px in rgba.as_chunks_mut::<4>().0 {
        let grey = ((px[0] as u32 * 30 + px[1] as u32 * 59 + px[2] as u32 * 11) / 100) as u8;
        px[0] = grey;
        px[1] = grey;
        px[2] = grey;
        if state == "unreachable" {
            px[3] /= 3;
        }
    }
}

pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    let mute = CheckMenuItem::with_id(app, "mute", "En sourdine", true, false, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &MenuItem::with_id(app, "show", "Afficher", true, None::<&str>)?,
            &mute,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "quit", "Quitter", true, None::<&str>)?,
        ],
    )?;
    TrayIconBuilder::with_id("main")
        .icon(Image::from_bytes(ICON)?)
        .tooltip("Lun'Luxuria")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, e| {
            let _ = app.emit("tray", e.id().as_ref());
        })
        .on_tray_icon_event(|tray, e| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = e
            {
                let _ = tray.app_handle().emit("tray", "show");
            }
        })
        .build(app)?;
    app.manage(MuteItem(mute));
    Ok(())
}

/// The page's state on the icon: `present`, `silenced` or `unreachable`, its tooltip, and the mute for the entry.
#[tauri::command]
pub fn tray_state(
    app: AppHandle,
    state: String,
    tooltip: String,
    silenced: bool,
) -> Result<(), String> {
    if !matches!(state.as_str(), "present" | "silenced" | "unreachable") {
        return Err(format!("état inconnu : {state}"));
    }
    let tray = app.tray_by_id("main").ok_or("pas d'icône")?;
    let base = Image::from_bytes(ICON).map_err(|e| e.to_string())?;
    let mut rgba = base.rgba().to_vec();
    shade(&mut rgba, &state);
    tray.set_icon(Some(Image::new_owned(rgba, base.width(), base.height())))
        .map_err(|e| e.to_string())?;
    tray.set_tooltip(Some(tooltip)).map_err(|e| e.to_string())?;
    app.state::<MuteItem>()
        .0
        .set_checked(silenced)
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::shade;

    #[test]
    fn present_keeps_the_icon() {
        let mut px = [200, 100, 50, 255];
        shade(&mut px, "present");
        assert_eq!(px, [200, 100, 50, 255]);
    }

    #[test]
    fn silenced_is_grey_and_opaque() {
        let mut px = [200, 100, 50, 255];
        shade(&mut px, "silenced");
        assert_eq!(px, [124, 124, 124, 255]);
    }

    #[test]
    fn unreachable_is_grey_and_faded() {
        let mut px = [200, 100, 50, 255, 0, 0, 0, 0];
        shade(&mut px, "unreachable");
        assert_eq!(px, [124, 124, 124, 85, 0, 0, 0, 0]);
    }
}
