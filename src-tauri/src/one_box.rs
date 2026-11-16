//! One system dialog at a time: the guard of the app's single box. A box modal to the window stops a second click,
//! not a second call from the page: every box Rust opens takes this guard first.

use std::sync::atomic::{AtomicBool, Ordering};

/** The app's one box: `true` while a box is open. */
#[derive(Default)]
pub struct OneBox(AtomicBool);

/** Held while the box is open; gives it back when dropped, on every path out, an error's included. */
pub struct Taken<'a>(&'a OneBox);

impl Drop for Taken<'_> {
    fn drop(&mut self) {
        self.0.0.store(false, Ordering::Release);
    }
}

/** The guard, or « Une boîte est déjà ouverte. » and nothing opens. */
pub fn take(one: &OneBox) -> Result<Taken<'_>, String> {
    one.0
        .compare_exchange(false, true, Ordering::Acquire, Ordering::Relaxed)
        .map(|_| Taken(one))
        .map_err(|_| "Une boîte est déjà ouverte.".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    const BUSY: &str = "Une boîte est déjà ouverte.";

    #[test]
    fn a_taken_guard_refuses_a_second_one() {
        let one = OneBox::default();
        let first = take(&one).unwrap();
        assert_eq!(take(&one).err().as_deref(), Some(BUSY));
        drop(first);
    }

    #[test]
    fn the_guard_is_given_back_at_its_end() {
        let one = OneBox::default();
        drop(take(&one).unwrap());
        assert!(take(&one).is_ok());
    }

    #[test]
    fn the_guard_is_given_back_even_when_the_box_fails() {
        fn pick(one: &OneBox) -> Result<Option<String>, String> {
            let _box = take(one)?;
            Err("Ce dossier n’a pas de service.py.".to_string())
        }
        let one = OneBox::default();
        assert!(pick(&one).is_err());
        assert!(take(&one).is_ok(), "the refusal left the box taken");
    }

    #[test]
    fn a_refused_second_take_does_not_free_the_first() {
        let one = OneBox::default();
        let _first = take(&one).unwrap();
        let _ = take(&one);
        assert!(take(&one).is_err());
    }
}
