use crate::{err, matches_native_file, relative, Result};
use same_file::Handle;
use serde::Deserialize;
use std::{collections::BTreeMap, fs, io, path::Path};

#[derive(Deserialize)]
struct AssetManifest<'a> {
    format: &'a str,
    document: AssetList,
}

#[derive(Deserialize)]
struct AssetList {
    assets: Vec<AssetPath>,
}

#[derive(Deserialize)]
struct AssetPath {
    path: String,
}

/// A synced asset can outlive a failed directory flush. Verify its directories
/// again before a manifest that reuses the same pathname is published.
pub fn confirm_asset_directories(
    root: &Path,
    manifest: &str,
    mut synchronize: impl FnMut(&Path, &Handle) -> io::Result<()>,
) -> Result<()> {
    let manifest: AssetManifest = serde_json::from_str(manifest).map_err(err)?;
    if manifest.format != "splash-directory" {
        return Err("Invalid project manifest format.".into());
    }
    let container = root.parent().ok_or("Invalid project folder parent.")?;
    let mut directories = BTreeMap::new();
    for asset in manifest.document.assets {
        let file = relative(root, &asset.path)?;
        match fs::symlink_metadata(&file) {
            // Recovery already allows a project to reference missing assets.
            Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
            Ok(metadata) if metadata.is_file() => {}
            Ok(_) => return Err(format!("Project asset is not a file: {}", asset.path)),
            Err(error) => return Err(err(error)),
        }
        for directory in file.ancestors().skip(1) {
            if !directories.contains_key(directory) {
                directories.insert(
                    directory.to_path_buf(),
                    Handle::from_path(directory).map_err(err)?,
                );
            }
            if directory == container {
                break;
            }
        }
    }
    // Path ordering puts descendants after their prefixes. Flush inside-out
    // so newly created parent entries are also covered.
    for (directory, identity) in directories.iter().rev() {
        synchronize(directory, identity).map_err(|error| {
            format!("Cannot synchronize an existing project asset directory: {error}. Retry Save.")
        })?;
    }
    for (directory, identity) in &directories {
        if !matches_native_file(directory, identity) {
            return Err(
                "A project asset directory changed on disk. Restore it and retry Save.".into(),
            );
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{commit_with_publish_check, save_publication};
    use std::io::Write;

    fn publish(
        root: &Path,
        expected: &str,
        manifest: &str,
        sync: impl FnMut(&Path, &Handle) -> io::Result<()>,
    ) -> Result<crate::CommitReceipt> {
        commit_with_publish_check(root, "project.json", manifest, Some(expected), || {
            confirm_asset_directories(root, manifest, sync)
        })
    }

    #[test]
    fn reused_asset_waits_for_directory_sync_before_manifest_replacement() {
        let container = crate::test_tempdir().unwrap();
        let root = container.path().join("project.spl");
        fs::create_dir(&root).unwrap();
        let asset = root.join("assets/bitmaps/item.json");
        let asset_dir = asset.parent().unwrap();
        let previous = r#"{"format":"splash-directory","document":{"assets":[]}}"#;
        let manifest = r#"{"format":"splash-directory","document":{"assets":[{"path":"assets/bitmaps/item.json"},{"path":"assets/bitmaps/two.json"},{"path":"assets/missing.wav"}]}}"#;
        fs::write(root.join("project.json"), previous).unwrap();
        let refused = publish(&root, previous, manifest, |_, _| unreachable!());
        // Even a missing asset stays a valid manifest reference. Restore the
        // previous revision for the failure and reuse checks below.
        assert!(refused.unwrap().warning.is_none());
        fs::write(root.join("project.json"), previous).unwrap();

        let first = save_publication::write_component_with_sync(
            &root,
            &asset,
            |file| file.write_all(b"preserve original bytes"),
            || Ok(()),
            |path, _| {
                assert_eq!(path, asset_dir);
                Err(io::Error::other(
                    "fixture refused directory sync after rename",
                ))
            },
        );
        assert!(first.unwrap_err().contains("after rename"));
        assert_eq!(fs::read(&asset).unwrap(), b"preserve original bytes");
        fs::write(asset_dir.join("two.json"), b"another asset").unwrap();
        let refusal = publish(&root, previous, manifest, |path, _| {
            assert_eq!(path, asset_dir);
            Err(io::Error::other("fixture refused reused asset directory"))
        });
        assert!(refusal
            .unwrap_err()
            .contains("fixture refused reused asset directory"));
        assert_eq!(
            fs::read_to_string(root.join("project.json")).unwrap(),
            previous
        );
        assert_eq!(fs::read(&asset).unwrap(), b"preserve original bytes");

        let mut synced = Vec::new();
        let receipt = publish(&root, previous, manifest, |path, identity| {
            synced.push(path.to_path_buf());
            save_publication::sync_publication(path, identity)
        })
        .unwrap();
        assert!(receipt.warning.is_none());
        assert_eq!(
            synced,
            [asset_dir, &root.join("assets"), &root, container.path()]
        );
        assert_eq!(
            fs::read_to_string(root.join("project.json")).unwrap(),
            manifest
        );
        assert_eq!(fs::read(&asset).unwrap(), b"preserve original bytes");
        assert!(!root.join("assets/missing.wav").exists());
    }
}
