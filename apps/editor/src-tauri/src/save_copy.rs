use crate::{err, matches_native_file, no_links, save_publication, Result};
use same_file::Handle;
use std::{fs, io, path::Path};

const MANIFEST: &str = "project.json";

pub fn copy_project(
    source: &Path,
    target: &Path,
    verify_source: impl Fn() -> Result<()>,
    before_manifest: impl FnOnce() -> Result<()>,
) -> Result<()> {
    verify_source()?;
    no_links(target)?;
    if fs::canonicalize(target)
        .map_err(err)?
        .starts_with(fs::canonicalize(source).map_err(err)?)
    {
        return Err("Choose a Save As folder outside the original project.".into());
    }
    let target_id = Handle::from_path(target).map_err(err)?;
    let verify = || {
        verify_source()?;
        verify_path(target, &target_id)
    };

    // Open the committed manifest before copying any files. Ordinary saves
    // publish a new manifest identity and leave its old component files intact.
    let manifest_path = source.join(MANIFEST);
    let (manifest, manifest_id) = open_source(&manifest_path)?;
    copy_entries(source, target, target, true, &verify)?;
    copy_file(
        manifest,
        &manifest_path,
        &manifest_id,
        target,
        &target.join(MANIFEST),
        || {
            before_manifest()?;
            verify()
        },
    )
}

fn verify_path(path: &Path, identity: &Handle) -> Result<()> {
    if matches_native_file(path, identity) {
        return Ok(());
    }
    Err("A project copy path changed on disk. Choose a new folder name and retry Save As.".into())
}

fn open_source(path: &Path) -> Result<(fs::File, Handle)> {
    no_links(path)?;
    if !fs::symlink_metadata(path).map_err(err)?.is_file() {
        return Err("Save As can copy only regular project files and folders.".into());
    }
    let file = fs::File::open(path).map_err(err)?;
    if !file.metadata().map_err(err)?.is_file() {
        return Err("Save As can copy only regular project files and folders.".into());
    }
    let id = Handle::from_file(file.try_clone().map_err(err)?).map_err(err)?;
    verify_path(path, &id)?;
    Ok((file, id))
}

fn copy_file(
    mut source: fs::File,
    from: &Path,
    source_id: &Handle,
    root: &Path,
    to: &Path,
    verify: impl FnOnce() -> Result<()>,
) -> Result<()> {
    save_publication::write_component(
        root,
        to,
        |stage| {
            io::copy(&mut source, stage)?;
            stage.set_permissions(source.metadata()?.permissions())
        },
        || {
            verify()?;
            verify_path(from, source_id)
        },
    )
}

fn copy_entries(
    source: &Path,
    target: &Path,
    root: &Path,
    is_root: bool,
    verify_parent: &dyn Fn() -> Result<()>,
) -> Result<()> {
    no_links(source)?;
    let source_id = Handle::from_path(source).map_err(err)?;
    let target_id = Handle::from_path(target).map_err(err)?;
    let verify = || {
        verify_parent()?;
        verify_path(source, &source_id)?;
        verify_path(target, &target_id)
    };
    verify()?;
    for entry in fs::read_dir(source).map_err(err)? {
        let entry = entry.map_err(err)?;
        let name = entry.file_name();
        if is_root && (name == MANIFEST || (cfg!(windows) && name.eq_ignore_ascii_case(MANIFEST))) {
            continue;
        }
        let from = entry.path();
        let to = target.join(&name);
        verify()?;
        no_links(&from)?;
        if entry.file_type().map_err(err)?.is_dir() {
            fs::create_dir(&to).map_err(err)?;
            copy_entries(&from, &to, root, false, &verify)?;
        } else {
            let (input, id) = open_source(&from)?;
            copy_file(input, &from, &id, root, &to, &verify)?;
        }
    }
    verify()?;
    // This covers empty directories too, even when no file publication went
    // through this branch of the copy.
    save_publication::sync_publication(target, &target_id).map_err(err)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn copy_waits_for_every_component_and_preserves_an_interrupted_source() {
        let container = crate::test_tempdir().unwrap();
        let source = container.path().join("source.spl");
        fs::create_dir_all(source.join("artwork/empty")).unwrap();
        fs::write(source.join(MANIFEST), "original manifest").unwrap();
        fs::write(source.join("artwork/drawing.bin"), b"artwork").unwrap();
        let failed = container.path().join("interrupted.spl");
        fs::create_dir(&failed).unwrap();
        let result = copy_project(
            &source,
            &failed,
            || Ok(()),
            || {
                assert_eq!(
                    fs::read(failed.join("artwork/drawing.bin")).unwrap(),
                    b"artwork"
                );
                assert!(failed.join("artwork/empty").is_dir());
                assert!(!failed.join(MANIFEST).exists());
                Err("fixture stopped before manifest publication".into())
            },
        );
        assert_eq!(
            result.unwrap_err(),
            "fixture stopped before manifest publication"
        );
        assert!(!failed.join(MANIFEST).exists());
        assert_eq!(
            fs::read(source.join(MANIFEST)).unwrap(),
            b"original manifest"
        );
        assert_eq!(
            fs::read(source.join("artwork/drawing.bin")).unwrap(),
            b"artwork"
        );

        let retried = container.path().join("retry.spl");
        fs::create_dir(&retried).unwrap();
        copy_project(&source, &retried, || Ok(()), || Ok(())).unwrap();
        assert_eq!(
            fs::read(retried.join(MANIFEST)).unwrap(),
            b"original manifest"
        );
        assert_eq!(
            fs::read(retried.join("artwork/drawing.bin")).unwrap(),
            b"artwork"
        );
        assert!(retried.join("artwork/empty").is_dir());
    }

    #[test]
    fn copy_preserves_a_destination_collision_and_refuses_a_nested_target() {
        let container = crate::test_tempdir().unwrap();
        let source = container.path().join("source.spl");
        let target = container.path().join("copy.spl");
        fs::create_dir(&source).unwrap();
        fs::create_dir(&target).unwrap();
        fs::write(source.join(MANIFEST), b"manifest").unwrap();
        fs::write(source.join("user.txt"), b"source artwork").unwrap();
        fs::write(target.join("user.txt"), b"foreign artwork").unwrap();
        assert!(copy_project(&source, &target, || Ok(()), || Ok(())).is_err());
        assert_eq!(
            fs::read(target.join("user.txt")).unwrap(),
            b"foreign artwork"
        );
        assert!(!target.join(MANIFEST).exists());

        let nested = source.join("nested.spl");
        fs::create_dir(&nested).unwrap();
        let result = copy_project(&source, &nested, || Ok(()), || Ok(()));
        assert!(result.unwrap_err().contains("outside the original project"));
        assert_eq!(fs::read_dir(nested).unwrap().count(), 0);
    }
}
