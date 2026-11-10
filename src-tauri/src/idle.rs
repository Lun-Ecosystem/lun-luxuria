//! How long the session has had no key or mouse input. The page decides from it whether the person is away.

/// The time between two tick counts, which wrap every 49.7 days.
#[cfg_attr(not(windows), allow(dead_code))]
fn since(now: u32, last: u32) -> u32 {
    now.wrapping_sub(last)
}

/// Milliseconds since the last input on the whole session; 0 when Windows cannot say.
#[tauri::command]
pub fn idle_ms() -> u64 {
    #[cfg(windows)]
    {
        use windows_sys::Win32::System::SystemInformation::GetTickCount;
        use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
        let mut info = LASTINPUTINFO {
            cbSize: size_of::<LASTINPUTINFO>() as u32,
            dwTime: 0,
        };
        // SAFETY: `info` is a valid LASTINPUTINFO with its size set, as the call requires.
        if unsafe { GetLastInputInfo(&mut info) } == 0 {
            return 0;
        }
        // SAFETY: no argument, no pointer.
        u64::from(since(unsafe { GetTickCount() }, info.dwTime))
    }
    #[cfg(not(windows))]
    0
}

#[cfg(test)]
mod tests {
    use super::since;

    #[test]
    fn counts_across_the_wrap_of_the_tick_count() {
        assert_eq!(since(1000, 400), 600);
        assert_eq!(since(5, u32::MAX - 4), 10);
    }
}
