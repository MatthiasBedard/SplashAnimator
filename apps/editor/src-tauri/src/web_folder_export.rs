use crate::{err, matches_native_file, no_links, relative, Result};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::Deserialize;
use std::{
    collections::HashSet,
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};

const LIMIT: usize = 512 * 1024 * 1024;
const INDEX: &str = "index.html";
const PLAYER: &str = "scripts/player.js";
const DATA: &str = "data/animation.js";
const LOCAL_MEDIA: &str = "data/local-media.js";

#[derive(Deserialize)]
pub struct Entry {
    path: String,
    text: Option<String>,
    base64: Option<String>,
}

fn numbered_asset(path: &str, prefix: &str, extension: &str) -> bool {
    path.strip_prefix(prefix)
        .and_then(|name| name.strip_suffix(extension))
        .is_some_and(|number| {
            !number.is_empty() && number.bytes().all(|byte| byte.is_ascii_digit())
        })
}

fn validate(entries: &[Entry]) -> Result<()> {
    let mut paths = HashSet::new();
    let mut bytes = 0usize;
    if entries.len() > 65535 {
        return Err("Too many web export files.".into());
    }
    for entry in entries {
        let path = entry.path.as_str();
        if !paths.insert(path) {
            return Err("Duplicate web export file.".into());
        }
        let size = match (&entry.text, &entry.base64) {
            (Some(text), None) if matches!(path, INDEX | PLAYER | DATA | LOCAL_MEDIA) => text.len(),
            (None, Some(encoded))
                if numbered_asset(path, "assets/images/image-", ".png")
                    || numbered_asset(path, "assets/fonts/font-", ".ttf")
                    || matches!(
                        path,
                        "assets/audio/soundtrack.wav" | "assets/audio/soundtrack.ogg"
                    ) =>
            {
                encoded.len() / 4 * 3
            }
            _ => return Err("Invalid web export file.".into()),
        };
        bytes = bytes.saturating_add(size);
        if bytes > LIMIT {
            return Err("Web folder exceeds the 512 MiB export limit.".into());
        }
    }
    if ![INDEX, PLAYER, DATA]
        .iter()
        .all(|path| paths.contains(path))
    {
        return Err("Incomplete web folder export.".into());
    }
    Ok(())
}

pub fn publish(parent: &Path, name: &str, entries: &[Entry]) -> Result<PathBuf> {
    if name.len() > 74
        || !name.ends_with("-web")
        || !name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b" _-".contains(&byte))
    {
        return Err("Invalid web export folder name.".into());
    }
    validate(entries)?;
    no_links(parent)?;
    let parent = parent.canonicalize().map_err(err)?;
    if parent.ancestors().any(|path| {
        path.extension()
            .and_then(|ext| ext.to_str())
            .is_some_and(|ext| ext.eq_ignore_ascii_case("spl"))
    }) {
        return Err("Choose an export location outside any .spl folder.".into());
    }
    let parent_identity = same_file::Handle::from_path(&parent).map_err(err)?;
    // Reserve the exact directory name without ever replacing a previous export.
    let mut folder = tempfile::Builder::new()
        .prefix(name)
        .rand_bytes(0)
        .tempdir_in(&parent)
        .map_err(|error| {
            format!(
                "Could not create {name}. Choose another location if it already exists. {error}"
            )
        })?;
    let identity = same_file::Handle::from_path(folder.path()).map_err(err)?;
    let owns_folder = |path: &Path| {
        matches_native_file(&parent, &parent_identity) && matches_native_file(path, &identity)
    };
    let result: Result<()> = (|| {
        // Publish the entry point after every dependency is complete.
        for entry in entries
            .iter()
            .filter(|entry| entry.path != INDEX)
            .chain(entries.iter().filter(|entry| entry.path == INDEX))
        {
            if !owns_folder(folder.path()) {
                return Err("The web export folder moved during export.".into());
            }
            let path = relative(folder.path(), &entry.path)?;
            let directory = path.parent().ok_or("Invalid web export path.")?;
            fs::create_dir_all(directory).map_err(err)?;
            let mut file = OpenOptions::new()
                .create_new(true)
                .write(true)
                .open(path)
                .map_err(err)?;
            if let Some(text) = &entry.text {
                file.write_all(text.as_bytes()).map_err(err)?;
            } else {
                let encoded = entry.base64.as_deref().ok_or("Missing web export asset.")?;
                let bytes = STANDARD.decode(encoded).map_err(err)?;
                file.write_all(&bytes).map_err(err)?;
            }
            file.sync_all().map_err(err)?;
        }
        if !owns_folder(folder.path()) {
            return Err("The web export folder moved during export.".into());
        }
        Ok(())
    })();
    if result.is_err() && !owns_folder(folder.path()) {
        folder.disable_cleanup(true);
    }
    result?;
    Ok(folder.keep())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(path: &str, text: &str) -> Entry {
        Entry {
            path: path.into(),
            text: Some(text.into()),
            base64: None,
        }
    }

    #[test]
    fn publishes_files_and_preserves_an_existing_export() {
        let parent = tempfile::tempdir().unwrap();
        let entries = [
            entry(INDEX, "<canvas></canvas>"),
            entry(PLAYER, "const ready = true;"),
            entry(DATA, "{}"),
            Entry {
                path: "assets/images/image-1.png".into(),
                text: None,
                base64: Some("AQID".into()),
            },
        ];
        let folder = publish(parent.path(), "Example-web", &entries).unwrap();
        assert_eq!(
            folder,
            parent.path().canonicalize().unwrap().join("Example-web")
        );
        assert_eq!(
            fs::read(folder.join("assets/images/image-1.png")).unwrap(),
            [1, 2, 3]
        );
        assert!(publish(parent.path(), "Example-web", &entries).is_err());
        assert_eq!(
            fs::read_to_string(folder.join(INDEX)).unwrap(),
            "<canvas></canvas>"
        );
    }

    #[test]
    fn rejects_invalid_paths_and_cleans_up_failed_writes() {
        let parent = tempfile::tempdir().unwrap();
        let mut entries = [
            entry(INDEX, "<canvas></canvas>"),
            entry(PLAYER, "const ready = true;"),
            entry(DATA, "{}"),
            Entry {
                path: "assets/images/image-1.png".into(),
                text: None,
                base64: Some("bad!".into()),
            },
        ];
        assert!(publish(parent.path(), "Example-web", &entries).is_err());
        assert!(!parent.path().join("Example-web").exists());
        entries[3].path = "../outside.png".into();
        assert!(publish(parent.path(), "Example-web", &entries).is_err());
        assert!(!parent.path().join("Example-web").exists());
    }
}
