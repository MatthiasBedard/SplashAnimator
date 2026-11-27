use crate::{err, no_links, Result};
use std::{
    fs::{self, File, OpenOptions},
    io::{self, Read, Write},
    path::{Path, PathBuf},
};

const MARKER: &[u8] = b"Splash Animator native save lock v1\n";
const BUSY: &str = "Another editor is saving this project. Wait for it to finish and retry.";
const LEGACY: &str = "An older or unrecognized save lock exists. Close other editors before resolving that lock file.";

pub struct NativeSaveLock {
    identity: LockIdentity,
    _file: File,
}

impl NativeSaveLock {
    pub fn is_current(&self) -> bool {
        self.identity.is_current()
    }

    pub fn acquire(path: &Path) -> Result<Self> {
        let parent = path.parent().ok_or("Invalid save lock location.")?;
        for _ in 0..3 {
            no_links(path)?;
            match OpenOptions::new().read(true).write(true).open(path) {
                Ok(mut file) => {
                    try_lock(&file)?;
                    let guard = lock_identity(path, &file)?;
                    if !guard.is_current() {
                        continue;
                    }
                    let mut marker = Vec::with_capacity(MARKER.len() + 1);
                    (&mut file)
                        .take((MARKER.len() + 1) as u64)
                        .read_to_end(&mut marker)
                        .map_err(lock_access)?;
                    if marker != MARKER {
                        return Err(LEGACY.into());
                    }
                    return Ok(guard.own(file));
                }
                Err(error) if error.kind() == io::ErrorKind::NotFound => {
                    let mut staged =
                        tempfile::NamedTempFile::new_in(parent).map_err(lock_access)?;
                    staged.write_all(MARKER).map_err(lock_access)?;
                    staged.as_file().sync_all().map_err(lock_access)?;
                    try_lock(staged.as_file())?;
                    let guard = lock_identity(path, staged.as_file())?;
                    match staged.persist_noclobber(path) {
                        Ok(file) => return Ok(guard.own(file)),
                        Err(error) if error.error.kind() == io::ErrorKind::AlreadyExists => {
                            continue
                        }
                        Err(error) => return Err(lock_access(error.error)),
                    }
                }
                Err(error) => return Err(lock_access(error)),
            }
        }
        Err(BUSY.into())
    }
}

struct LockIdentity {
    path: PathBuf,
    identity: same_file::Handle,
}

impl LockIdentity {
    fn is_current(&self) -> bool {
        no_links(&self.path).is_ok()
            && same_file::Handle::from_path(&self.path)
                .is_ok_and(|current| current == self.identity)
    }

    fn own(self, file: File) -> NativeSaveLock {
        NativeSaveLock {
            identity: self,
            _file: file,
        }
    }
}

impl Drop for NativeSaveLock {
    fn drop(&mut self) {
        // Remove only our matching sentinel, while the OS lock is still held.
        if self.identity.is_current() {
            let _ = fs::remove_file(&self.identity.path);
        }
    }
}

fn lock_identity(path: &Path, file: &File) -> Result<LockIdentity> {
    Ok(LockIdentity {
        path: path.to_path_buf(),
        identity: same_file::Handle::from_file(file.try_clone().map_err(err)?).map_err(err)?,
    })
}

fn try_lock(file: &File) -> Result<()> {
    fs2::FileExt::try_lock_exclusive(file).map_err(|error| {
        if error.raw_os_error() == fs2::lock_contended_error().raw_os_error() {
            BUSY.into()
        } else {
            lock_access(error)
        }
    })
}

fn lock_access(error: io::Error) -> String {
    format!("Cannot access the save lock: {error}. Check folder permissions or close any app holding the file, then retry.")
}
