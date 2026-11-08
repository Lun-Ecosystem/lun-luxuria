//! The tray icon: one drawing per state, and a menu whose clicks go to the page as `tray` events.
//! Nothing is decided here: the page says the state, and acts on the menu.

use tauri::image::Image;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Wry};

/// The mute entry, checked by the state the page gives.
pub struct MuteItem(CheckMenuItem<Wry>);

/// One drawing per state, readable on a light or a dark bar: full in the accent, full in grey, hollow.
/// Sources: `icons/tray/*.svg`, rendered at 32 px.
pub fn icon_for(state: &str) -> Option<&'static [u8]> {
    match state {
        "present" => Some(include_bytes!("../icons/tray/present.png")),
        "silenced" => Some(include_bytes!("../icons/tray/silenced.png")),
        "unreachable" => Some(include_bytes!("../icons/tray/unreachable.png")),
        _ => None,
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
        .icon(Image::from_bytes(icon_for("present").unwrap_or_default())?)
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
    let icon = icon_for(&state).ok_or_else(|| format!("état inconnu : {state}"))?;
    let tray = app.tray_by_id("main").ok_or("pas d'icône")?;
    tray.set_icon(Some(Image::from_bytes(icon).map_err(|e| e.to_string())?))
        .map_err(|e| e.to_string())?;
    tray.set_tooltip(Some(tooltip)).map_err(|e| e.to_string())?;
    app.state::<MuteItem>()
        .0
        .set_checked(silenced)
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::icon_for;

    #[test]
    fn each_state_has_its_own_drawing() {
        let present = icon_for("present").unwrap();
        let silenced = icon_for("silenced").unwrap();
        let unreachable = icon_for("unreachable").unwrap();
        assert_ne!(present, silenced);
        assert_ne!(silenced, unreachable);
        assert_ne!(present, unreachable);
    }

    #[test]
    fn an_unknown_state_is_refused() {
        assert!(icon_for("away").is_none());
    }
}
