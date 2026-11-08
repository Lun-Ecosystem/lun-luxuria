//! What this app starts dies with it, even when the app is killed or crashes: each child joins a Windows job
//! object that kills its members when its last handle closes, which the system does when the app's process ends.
//! A normal exit still stops them first, one by one (`voice::stop`, `programs::stop_all`).

use std::process::Child;

#[cfg(windows)]
mod imp {
    use std::os::windows::io::AsRawHandle;
    use std::process::Child;
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation,
        SetInformationJobObject,
    };

    pub struct Job(HANDLE);
    // The handle is only ever passed to the system, which serialises its own calls on it.
    unsafe impl Send for Job {}
    unsafe impl Sync for Job {}

    impl Job {
        pub fn new() -> Option<Job> {
            // SAFETY: a handle we own, and a zeroed limit structure with one flag set, as the API expects.
            unsafe {
                let handle = CreateJobObjectW(std::ptr::null(), std::ptr::null());
                if handle.is_null() {
                    return None;
                }
                let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
                info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                let set = SetInformationJobObject(
                    handle,
                    JobObjectExtendedLimitInformation,
                    (&raw const info).cast(),
                    size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                );
                if set == 0 {
                    CloseHandle(handle);
                    return None;
                }
                Some(Job(handle))
            }
        }

        pub fn adopt(&self, child: &Child) -> bool {
            // SAFETY: both handles stay valid while `self` and `child` live.
            unsafe { AssignProcessToJobObject(self.0, child.as_raw_handle() as HANDLE) != 0 }
        }
    }

    impl Drop for Job {
        fn drop(&mut self) {
            // SAFETY: the handle is ours and closed once.
            unsafe { CloseHandle(self.0) };
        }
    }
}

/**
 * Puts a child in the app's job; false when the system refused, and it then stops only at a normal exit.
 * shortcut: a child that starts its own child within microseconds of its spawn could leave it outside the job;
 * start the process suspended if a program ever does.
 */
pub fn adopt(child: &Child) -> bool {
    #[cfg(windows)]
    {
        use std::sync::OnceLock;
        // Never dropped: its handle closes with the app's process, which is the point.
        static JOB: OnceLock<Option<imp::Job>> = OnceLock::new();
        JOB.get_or_init(imp::Job::new)
            .as_ref()
            .is_some_and(|job| job.adopt(child))
    }
    #[cfg(not(windows))]
    {
        let _ = child;
        false
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::imp::Job;
    use std::process::{Command, Stdio};
    use std::time::{Duration, Instant};

    #[test]
    fn a_child_dies_when_its_job_closes() {
        let job = Job::new().expect("job");
        let mut child = Command::new("C:\\Windows\\System32\\PING.EXE")
            .args(["-n", "30", "127.0.0.1"])
            .stdout(Stdio::null())
            .spawn()
            .unwrap();
        assert!(job.adopt(&child));
        assert!(matches!(child.try_wait(), Ok(None)));
        drop(job);
        let until = Instant::now() + Duration::from_secs(5);
        while matches!(child.try_wait(), Ok(None)) && Instant::now() < until {
            std::thread::sleep(Duration::from_millis(50));
        }
        assert!(
            child.try_wait().unwrap().is_some(),
            "the job's end should end the child"
        );
    }
}
