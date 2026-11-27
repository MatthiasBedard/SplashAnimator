use crate::{err, matches_native_file, no_links, Result};
use std::fs;
use std::{io, path::Path};

#[cfg(windows)]
pub fn replace(staged: &Path, destination: &Path) -> io::Result<()> {
    move_file(staged, destination, true)
}

#[cfg(windows)]
fn move_file(staged: &Path, destination: &Path, replace: bool) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows::{
        core::PCWSTR,
        Win32::Storage::FileSystem::{
            MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
        },
    };

    let source: Vec<u16> = staged.as_os_str().encode_wide().chain([0]).collect();
    let target: Vec<u16> = destination.as_os_str().encode_wide().chain([0]).collect();
    let flags = if replace {
        MOVEFILE_WRITE_THROUGH | MOVEFILE_REPLACE_EXISTING
    } else {
        MOVEFILE_WRITE_THROUGH
    };
    // The owned staging file and target are in the same directory. No copy fallback.
    unsafe {
        MoveFileExW(
            PCWSTR::from_raw(source.as_ptr()),
            PCWSTR::from_raw(target.as_ptr()),
            flags,
        )
    }
    .map_err(io::Error::other)
}

#[cfg(windows)]
fn publish_new(staged: &Path, destination: &Path) -> io::Result<()> {
    move_file(staged, destination, false)
}

#[cfg(unix)]
fn publish_new(staged: &Path, destination: &Path) -> io::Result<()> {
    let mut stage = tempfile::TempPath::try_from_path(staged)?;
    // Cleanup must still check the original file and directory identities.
    stage.disable_cleanup(true);
    stage
        .persist_noclobber(destination)
        .map_err(|failure| failure.error)
}

#[cfg(not(windows))]
pub fn replace(staged: &Path, destination: &Path) -> io::Result<()> {
    fs::rename(staged, destination)
}

#[cfg(unix)]
pub fn sync_publication(parent: &Path, identity: &same_file::Handle) -> io::Result<()> {
    let directory = fs::File::open(parent)?;
    let opened = same_file::Handle::from_file(directory.try_clone()?)?;
    if opened != *identity {
        return Err(io::Error::other(
            "The destination directory moved after publication.",
        ));
    }
    directory.sync_all()
}

#[cfg(windows)]
pub fn sync_publication(_parent: &Path, _identity: &same_file::Handle) -> io::Result<()> {
    // MoveFileExW already requested write-through for this rename.
    Ok(())
}

/// Write a complete immutable component before a manifest can refer to it.
pub fn write_component(
    root: &Path,
    destination: &Path,
    write: impl FnOnce(&mut fs::File) -> io::Result<()>,
    verify: impl FnOnce() -> Result<()>,
) -> Result<()> {
    write_component_with_sync(root, destination, write, verify, sync_publication)
}

pub(crate) fn write_component_with_sync(
    root: &Path,
    destination: &Path,
    write: impl FnOnce(&mut fs::File) -> io::Result<()>,
    verify: impl FnOnce() -> Result<()>,
    mut synchronize: impl FnMut(&Path, &same_file::Handle) -> io::Result<()>,
) -> Result<()> {
    let parent = destination
        .parent()
        .ok_or("Invalid component destination.")?;
    let relative = parent.strip_prefix(root).map_err(err)?;
    no_links(destination)?;
    let container = root.parent().ok_or("Invalid project folder parent.")?;
    let mut directories = vec![
        (
            container.to_path_buf(),
            same_file::Handle::from_path(container).map_err(err)?,
        ),
        (
            root.to_path_buf(),
            same_file::Handle::from_path(root).map_err(err)?,
        ),
    ];
    fs::create_dir_all(parent).map_err(err)?;
    no_links(parent)?;
    let mut path = root.to_path_buf();
    for component in relative.components() {
        path.push(component);
        directories.push((
            path.clone(),
            same_file::Handle::from_path(&path).map_err(err)?,
        ));
    }
    let same_directories = || {
        no_links(parent).is_ok()
            && directories.iter().all(|(path, identity)| {
                same_file::Handle::from_path(path).is_ok_and(|current| current == *identity)
            })
    };
    let changed = "Project component folder changed on disk. Restore it and retry Save.";
    if !same_directories() {
        return Err(changed.into());
    }

    let stage = parent.join(format!(".splash-write-{}.tmp", uuid::Uuid::new_v4()));
    let mut file = fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&stage)
        .map_err(err)?;
    let identity = same_file::Handle::from_file(file.try_clone().map_err(err)?).map_err(err)?;
    let result = (|| {
        write(&mut file).map_err(err)?;
        file.sync_all().map_err(err)?;
        drop(file);
        verify()?;
        if !same_directories() || !matches_native_file(&stage, &identity) {
            return Err(changed.into());
        }
        no_links(destination)?;
        publish_new(&stage, destination).map_err(err)?;
        for (path, identity) in directories.iter().rev() {
            synchronize(path, identity).map_err(|error| {
                format!("Cannot synchronize project component directory: {error}. Retry Save.")
            })?;
        }
        Ok(())
    })();
    if same_directories() && matches_native_file(&stage, &identity) {
        let _ = fs::remove_file(&stage);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn component_publication_preserves_existing_data_and_retries_after_rejection() {
        let container = tempfile::tempdir().unwrap();
        let root = container.path().join("first.spl");
        fs::create_dir(&root).unwrap();
        let target = root.join("assets/bitmaps/new.json");
        let rejected = write_component(
            &root,
            &target,
            |file| file.write_all(b"complete"),
            || {
                assert!(!target.exists());
                Err("fixture refused publication".into())
            },
        );
        assert_eq!(rejected.unwrap_err(), "fixture refused publication");
        assert_eq!(fs::read_dir(target.parent().unwrap()).unwrap().count(), 0);
        write_component(
            &root,
            &target,
            |file| file.write_all(b"complete"),
            || Ok(()),
        )
        .unwrap();
        assert!(write_component(
            &root,
            &target,
            |file| file.write_all(b"different"),
            || Ok(())
        )
        .is_err());
        assert_eq!(fs::read(&target).unwrap(), b"complete");
        assert_eq!(fs::read_dir(target.parent().unwrap()).unwrap().count(), 1);
    }

    #[test]
    fn component_publication_preserves_a_replacement_directory() {
        let container = tempfile::tempdir().unwrap();
        let root = container.path().join("first.spl");
        fs::create_dir(&root).unwrap();
        let parent = root.join("vectors");
        let target = parent.join("new.json");
        let original = root.join("original-vectors");
        let mut move_error = None;
        let rejected = write_component(
            &root,
            &target,
            |file| file.write_all(b"complete"),
            || {
                if let Err(error) = fs::rename(&parent, &original) {
                    move_error = Some(error);
                    return Err("The open component prevented moving the directory.".into());
                }
                fs::create_dir(&parent).unwrap();
                fs::write(&target, b"foreign").unwrap();
                Ok(())
            },
        );
        if let Some(error) = move_error {
            assert!(
                cfg!(windows) && matches!(error.raw_os_error(), Some(5) | Some(32)),
                "{error}"
            );
            assert!(rejected.is_err());
            assert_eq!(fs::read_dir(&parent).unwrap().count(), 0);
        } else {
            assert!(rejected.unwrap_err().contains("folder changed"));
            assert_eq!(fs::read(&target).unwrap(), b"foreign");
            assert_eq!(fs::read_dir(&parent).unwrap().count(), 1);
        }
        let other = parent.join("retry.json");
        write_component(&root, &other, |file| file.write_all(b"new"), || Ok(())).unwrap();
        assert_eq!(fs::read(other).unwrap(), b"new");
    }
}
