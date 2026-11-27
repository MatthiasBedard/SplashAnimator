use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    fs::{self, File, Metadata},
    io::{self, Read},
    path::{Path, PathBuf},
};

const MAX_MANIFEST_BYTES: u64 = 16 * 1024;
const MAX_DIRECTORY_ENTRIES: usize = 512;

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PluginManifest {
    id: String,
    name: String,
    version: String,
    api_version: u32,
    #[serde(default)]
    description: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginCatalog {
    folder: String,
    plugins: Vec<PluginManifest>,
    issues: Vec<String>,
}

fn is_link(metadata: &Metadata) -> bool {
    // Windows junctions and other reparse points can redirect paths too.
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        metadata.file_attributes() & 0x400 != 0
    }
    #[cfg(not(windows))]
    {
        metadata.file_type().is_symlink()
    }
}

fn manifest(path: &Path) -> Result<PluginManifest, String> {
    let metadata = fs::symlink_metadata(path).map_err(|error| error.to_string())?;
    if !metadata.is_file() || is_link(&metadata) {
        return Err("plugin.json must be a regular file.".into());
    }
    if metadata.len() > MAX_MANIFEST_BYTES {
        return Err("plugin.json exceeds 16 KiB.".into());
    }
    let mut data = Vec::new();
    File::open(path)
        .and_then(|file| file.take(MAX_MANIFEST_BYTES + 1).read_to_end(&mut data))
        .map_err(|error| error.to_string())?;
    if data.len() as u64 > MAX_MANIFEST_BYTES {
        return Err("plugin.json exceeds 16 KiB.".into());
    }
    let manifest: PluginManifest =
        serde_json::from_slice(&data).map_err(|error| format!("Invalid plugin.json: {error}"))?;
    if manifest.api_version != 1 {
        return Err(format!(
            "Unsupported plugin API version {}.",
            manifest.api_version
        ));
    }
    if manifest.id.len() > 128
        || !manifest.id.split('.').all(|part| {
            part.starts_with(|ch: char| ch.is_ascii_lowercase())
                && part
                    .bytes()
                    .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == b'-')
        })
        || !manifest.id.contains('.')
    {
        return Err(
            "Use a lowercase namespaced plugin ID (for example, example.my-plugin).".into(),
        );
    }
    let valid_text =
        |value: &str, max: usize| value.len() <= max && !value.chars().any(char::is_control);
    if manifest.name.trim().is_empty()
        || manifest.version.trim().is_empty()
        || !valid_text(&manifest.name, 128)
        || !valid_text(&manifest.version, 64)
        || !valid_text(&manifest.description, 1024)
    {
        return Err("Invalid plugin name, version, or description.".into());
    }
    Ok(manifest)
}

fn packages(root: &Path) -> io::Result<Vec<PathBuf>> {
    let metadata = match fs::symlink_metadata(root) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error),
    };
    if !metadata.is_dir() || is_link(&metadata) {
        return Err(io::Error::other(
            "Plugin folder must be a regular directory.",
        ));
    }
    let mut paths = Vec::new();
    for (index, entry) in fs::read_dir(root)?.enumerate() {
        if index == MAX_DIRECTORY_ENTRIES {
            return Err(io::Error::other("Plugin folder exceeds 512 entries."));
        }
        let path = entry?.path();
        let metadata = fs::symlink_metadata(&path)?;
        if metadata.is_dir() && !is_link(&metadata) {
            paths.push(path);
        }
    }
    paths.sort();
    Ok(paths)
}

fn scan(root: &Path) -> PluginCatalog {
    let mut catalog = PluginCatalog {
        folder: root.display().to_string(),
        plugins: Vec::new(),
        issues: Vec::new(),
    };
    let paths = match packages(root) {
        Ok(paths) => paths,
        Err(error) => {
            catalog.issues.push(format!("{}: {error}", root.display()));
            return catalog;
        }
    };
    let mut candidates = BTreeMap::<String, Option<PluginManifest>>::new();
    for path in paths {
        let manifest_path = path.join("plugin.json");
        match fs::symlink_metadata(&manifest_path) {
            Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
            _ => {}
        }
        match manifest(&manifest_path) {
            Ok(plugin) => {
                use std::collections::btree_map::Entry;
                match candidates.entry(plugin.id.clone()) {
                    Entry::Vacant(entry) => {
                        entry.insert(Some(plugin));
                    }
                    Entry::Occupied(mut entry) => {
                        if entry.insert(None).is_some() {
                            catalog
                                .issues
                                .push(format!("Duplicate plugin ID: {}.", plugin.id));
                        }
                    }
                }
            }
            Err(error) => catalog.issues.push(format!("{}: {error}", path.display())),
        }
    }
    catalog.plugins = candidates.into_values().flatten().collect();
    catalog
}

fn default_folder() -> Result<PathBuf, String> {
    let executable = std::env::current_exe().map_err(|error| error.to_string())?;
    #[cfg(target_os = "linux")]
    let executable = std::env::var_os("APPIMAGE")
        .map(PathBuf::from)
        .filter(|path| path.is_absolute())
        .unwrap_or(executable);
    executable
        .parent()
        .map(|parent| parent.join("plugins"))
        .ok_or_else(|| "Could not locate the executable's plugin folder.".into())
}

fn main_editor(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err("Plugins can only be configured from the main editor.".into())
    }
}

#[tauri::command]
pub async fn desktop_plugins_discover(
    window: tauri::WebviewWindow,
    folder: Option<String>,
) -> Result<PluginCatalog, String> {
    main_editor(&window)?;
    let root = match folder {
        Some(path) => {
            let path = PathBuf::from(path);
            if !path.is_absolute() {
                return Err("Choose an absolute plugin folder.".into());
            }
            path
        }
        None => default_folder()?,
    };
    tauri::async_runtime::spawn_blocking(move || scan(&root))
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn desktop_plugins_choose_folder(
    window: tauri::WebviewWindow,
) -> Result<Option<String>, String> {
    main_editor(&window)?;
    rfd::AsyncFileDialog::new()
        .set_parent(&window)
        .set_title("Choose the plugin folder")
        .pick_folder()
        .await
        .map(|folder| {
            let path = folder.path();
            let metadata = fs::symlink_metadata(path).map_err(|error| error.to_string())?;
            if !metadata.is_dir() || is_link(&metadata) {
                return Err("Choose a regular directory for the plugin folder.".into());
            }
            path.to_str()
                .map(str::to_owned)
                .ok_or_else(|| "The folder path cannot be represented as text.".into())
        })
        .transpose()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn package(root: &Path, folder: &str, contents: &str) {
        let directory = root.join(folder);
        fs::create_dir(&directory).unwrap();
        fs::write(directory.join("plugin.json"), contents).unwrap();
    }

    const VALID: &str =
        r#"{"id":"example.tools","name":"Example Tools","version":"1.0.0","apiVersion":1}"#;

    #[test]
    fn discovers_supported_manifests_without_loading_payloads() {
        let root = tempfile::tempdir().unwrap();
        package(root.path(), "valid", VALID);
        fs::write(root.path().join("valid").join("plugin.js"), "throw Error()").unwrap();
        package(
            root.path(),
            "future",
            &VALID.replace("apiVersion\":1", "apiVersion\":2"),
        );
        package(root.path(), "invalid", "{");
        package(
            root.path(),
            "large",
            &" ".repeat(MAX_MANIFEST_BYTES as usize + 1),
        );
        fs::create_dir(root.path().join("unrelated")).unwrap();
        let catalog = scan(root.path());
        assert_eq!(catalog.plugins.len(), 1);
        assert_eq!(catalog.plugins[0].id, "example.tools");
        assert_eq!(catalog.issues.len(), 3);
        assert!(catalog
            .issues
            .iter()
            .any(|issue| issue.contains("Unsupported plugin API version")));
        assert!(catalog
            .issues
            .iter()
            .any(|issue| issue.contains("exceeds 16 KiB")));
    }

    #[test]
    fn reports_duplicate_ids_without_picking_a_winner() {
        let root = tempfile::tempdir().unwrap();
        package(root.path(), "first", VALID);
        package(root.path(), "second", VALID);
        let catalog = scan(root.path());
        assert!(catalog.plugins.is_empty());
        assert_eq!(catalog.issues, ["Duplicate plugin ID: example.tools."]);
    }

    #[test]
    fn a_missing_folder_is_empty_and_default_is_absolute() {
        let root = tempfile::tempdir().unwrap();
        assert!(scan(&root.path().join("absent")).issues.is_empty());
        let default = default_folder().unwrap();
        assert!(default.is_absolute());
        assert!(default.ends_with("plugins"));
    }

    #[test]
    fn rejects_a_non_directory_root_and_enforces_scan_bounds() {
        let root = tempfile::tempdir().unwrap();
        for index in 0..MAX_DIRECTORY_ENTRIES {
            fs::write(root.path().join(index.to_string()), "").unwrap();
        }
        assert!(packages(root.path()).unwrap().is_empty());
        assert!(packages(&root.path().join("0")).is_err());
        fs::write(root.path().join("extra"), "").unwrap();
        assert!(packages(root.path())
            .unwrap_err()
            .to_string()
            .contains("512"));
    }
}
