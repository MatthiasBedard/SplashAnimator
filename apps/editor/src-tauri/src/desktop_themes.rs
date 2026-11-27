use percent_encoding::percent_decode_str;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File, OpenOptions},
    io::{self, Read, Write},
    path::{Component, Path, PathBuf},
    sync::Mutex,
};
use tauri::{http, Manager, WebviewWindow};
use uuid::Uuid;

use crate::desktop_plugins::is_link;

const ENTRY: &str = "theme.css";
const MAX_ASSET_BYTES: u64 = 16 * 1024 * 1024;
const MAX_FOLDERS: usize = 512;
const LIGHT_CSS: &[u8] = include_bytes!("../resources/themes/Light/theme.css");
const PREVIOUS_LIGHT_SHA256: [[u8; 32]; 4] = [
    [
        0x08, 0x86, 0xe1, 0xab, 0x3d, 0x56, 0x47, 0xc8, 0x06, 0xc4, 0x7a, 0xde, 0x98, 0xc9, 0x36,
        0x46, 0x21, 0x7c, 0xc0, 0x24, 0x41, 0x4e, 0xa5, 0x0d, 0x17, 0xf2, 0x52, 0x88, 0xbe, 0xab,
        0x95, 0x0c,
    ],
    [
        0x19, 0x4b, 0x5b, 0x86, 0xb0, 0xd1, 0x1b, 0x7e, 0xbb, 0x8f, 0xf1, 0x2a, 0x2c, 0x38, 0x78,
        0xba, 0xff, 0xd8, 0x8d, 0x7e, 0x25, 0x7b, 0x01, 0x67, 0x95, 0x45, 0xcf, 0x64, 0x15, 0xe5,
        0x14, 0x8d,
    ],
    [
        0xe5, 0x2d, 0x27, 0xeb, 0x0b, 0x58, 0x91, 0x7a, 0x5a, 0x6a, 0x5a, 0x03, 0x9a, 0x5f, 0xfd,
        0x33, 0x2f, 0x1f, 0x11, 0xed, 0x13, 0xcc, 0x76, 0x4c, 0x09, 0xea, 0x8f, 0x06, 0x63, 0xea,
        0x2d, 0xe3,
    ],
    [
        0x61, 0xed, 0x25, 0xa9, 0x3a, 0x19, 0x8d, 0xbe, 0x05, 0x97, 0x3d, 0x77, 0xa7, 0x61, 0x1b,
        0x40, 0x8b, 0x3b, 0xbe, 0x77, 0x39, 0x05, 0x2b, 0x3a, 0xa5, 0x1f, 0xe5, 0x5a, 0xf9, 0xa3,
        0xce, 0x25,
    ],
];

#[derive(Default)]
pub struct DesktopTheme(Mutex<Option<(Uuid, PathBuf)>>);

#[derive(Serialize)]
pub struct ThemeCatalog {
    folder: String,
    themes: Vec<String>,
}

fn regular_directory(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok_and(|info| info.is_dir() && !is_link(&info))
}

fn default_folder(window: &WebviewWindow) -> Result<PathBuf, String> {
    let root = window
        .path()
        .app_data_dir()
        .map_err(crate::err)?
        .join("themes");
    let light = root.join("Light");
    fs::create_dir_all(&root).map_err(crate::err)?;
    if !regular_directory(&root) {
        return Err("Choose a regular directory for themes.".into());
    }
    fs::create_dir_all(&light).map_err(crate::err)?;
    prepare_light_theme(&light).map_err(crate::err)?;
    Ok(root)
}

fn prepare_light_theme(directory: &Path) -> io::Result<()> {
    if !regular_directory(directory) {
        return Ok(());
    }
    let path = directory.join(ENTRY);
    match OpenOptions::new().write(true).create_new(true).open(&path) {
        Ok(mut file) => file.write_all(LIGHT_CSS),
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
            // Upgrade only unchanged stock files so user edits to Light are preserved.
            let mut previous = String::new();
            if regular_file(&path)
                && File::open(&path)?
                    .take(8192)
                    .read_to_string(&mut previous)
                    .is_ok()
                && PREVIOUS_LIGHT_SHA256
                    .contains(&Sha256::digest(previous.replace("\r\n", "\n")).into())
            {
                let mut staged = tempfile::NamedTempFile::new_in(directory)?;
                staged.write_all(LIGHT_CSS)?;
                staged.persist(&path)?;
            }
            Ok(())
        }
        Err(error) => Err(error),
    }
}

fn theme_root(window: &WebviewWindow, folder: Option<String>) -> Result<PathBuf, String> {
    let root = match folder {
        Some(path) => PathBuf::from(path),
        None => default_folder(window)?,
    };
    if !root.is_absolute() || !regular_directory(&root) {
        return Err("Choose a regular, absolute themes folder.".into());
    }
    Ok(root)
}

fn safe_component(name: &str) -> bool {
    !name.contains(['/', '\\', ':'])
        && !name.chars().any(char::is_control)
        && matches!(
            Path::new(name).components().next(),
            Some(Component::Normal(_))
        )
}

fn regular_file(path: &Path) -> bool {
    fs::symlink_metadata(path)
        .is_ok_and(|info| info.is_file() && !is_link(&info) && info.len() <= MAX_ASSET_BYTES)
}

fn theme_directory(root: &Path, name: &str) -> Option<PathBuf> {
    if !safe_component(name) {
        return None;
    }
    let directory = root.join(name);
    (regular_directory(&directory) && regular_file(&directory.join(ENTRY))).then_some(directory)
}

fn main_editor(window: &WebviewWindow) -> Result<(), String> {
    if window.label() == "main" && crate::editor_window_origin(window)? {
        Ok(())
    } else {
        Err("Themes can only be configured from the local main editor.".into())
    }
}

#[tauri::command]
pub async fn desktop_theme_catalog(
    window: WebviewWindow,
    folder: Option<String>,
) -> Result<ThemeCatalog, String> {
    main_editor(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let root = theme_root(&window, folder)?;
        let mut themes = Vec::new();
        for (index, entry) in fs::read_dir(&root).map_err(crate::err)?.enumerate() {
            if index == MAX_FOLDERS {
                return Err("Choose a themes folder with at most 512 entries.".into());
            }
            let entry = entry.map_err(crate::err)?;
            if let Ok(name) = entry.file_name().into_string() {
                if theme_directory(&root, &name).is_some() {
                    themes.push(name);
                }
            }
        }
        themes.sort_by_key(|name| name.to_lowercase());
        Ok(ThemeCatalog {
            folder: root.to_string_lossy().into_owned(),
            themes,
        })
    })
    .await
    .map_err(crate::err)?
}

#[tauri::command]
pub async fn desktop_theme_choose_folder(window: WebviewWindow) -> Result<Option<String>, String> {
    main_editor(&window)?;
    rfd::AsyncFileDialog::new()
        .set_parent(&window)
        .set_title("Choose the themes folder")
        .pick_folder()
        .await
        .map(|folder| {
            folder
                .path()
                .to_str()
                .map(str::to_owned)
                .ok_or_else(|| "The folder path cannot be represented as text.".into())
        })
        .transpose()
}

fn stylesheet_url(id: Uuid) -> String {
    #[cfg(windows)]
    let origin = "http://splash-theme.localhost";
    #[cfg(not(windows))]
    let origin = "splash-theme://localhost";
    format!("{origin}/{id}/{ENTRY}")
}

#[tauri::command]
pub async fn desktop_theme_select(
    window: WebviewWindow,
    folder: Option<String>,
    name: Option<String>,
) -> Result<Option<String>, String> {
    main_editor(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let selected = name
            .map(|name| {
                let root = theme_root(&window, folder)?;
                let path = theme_directory(&root, &name).ok_or_else(|| {
                    "This theme folder needs a readable theme.css file.".to_owned()
                })?;
                Ok::<_, String>((Uuid::new_v4(), path.canonicalize().map_err(crate::err)?))
            })
            .transpose()?;
        let url = selected.as_ref().map(|(id, _)| stylesheet_url(*id));
        *window
            .state::<DesktopTheme>()
            .0
            .lock()
            .map_err(crate::err)? = selected;
        Ok(url)
    })
    .await
    .map_err(crate::err)?
}

fn asset_type(path: &Path) -> Option<&'static str> {
    Some(
        match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
            "css" => "text/css; charset=utf-8",
            "png" => "image/png",
            "apng" => "image/apng",
            "bmp" => "image/bmp",
            "jpeg" | "jpg" => "image/jpeg",
            "gif" => "image/gif",
            "webp" => "image/webp",
            "avif" => "image/avif",
            "svg" => "image/svg+xml",
            "ico" | "cur" => "image/x-icon",
            "woff" => "font/woff",
            "woff2" => "font/woff2",
            "ttf" => "font/ttf",
            "otf" => "font/otf",
            _ => return None,
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundled_light_seeds_a_missing_file_and_preserves_user_edits() {
        let folder = crate::test_tempdir().unwrap();
        prepare_light_theme(folder.path()).unwrap();
        let css = folder.path().join(ENTRY);
        assert_eq!(fs::read(&css).unwrap(), LIGHT_CSS);
        fs::write(&css, b":root { --accent: purple; }").unwrap();
        prepare_light_theme(folder.path()).unwrap();
        assert_eq!(fs::read(css).unwrap(), b":root { --accent: purple; }");
    }

    #[test]
    fn themes_serve_relative_assets_and_reject_paths_outside_the_package() {
        let temp = crate::test_tempdir().unwrap();
        let root = temp.path().join("Example");
        fs::create_dir_all(root.join("assets")).unwrap();
        fs::write(root.join(ENTRY), b"body { color: red; }").unwrap();
        fs::write(root.join("assets/accent icon.svg"), b"<svg/>").unwrap();
        fs::write(root.join("assets/theme.woff2"), b"font").unwrap();
        fs::write(root.join("assets/script.js"), b"// script").unwrap();
        fs::write(temp.path().join("outside.css"), b"body {}").unwrap();
        assert_eq!(theme_directory(temp.path(), "Example"), Some(root.clone()));
        assert!(theme_directory(temp.path(), "..").is_none());

        let root = root.canonicalize().unwrap();
        assert_eq!(
            read_asset(&root, ENTRY).unwrap().0,
            "text/css; charset=utf-8"
        );
        assert_eq!(
            read_asset(&root, "assets/accent%20icon.svg").unwrap().0,
            "image/svg+xml"
        );
        assert_eq!(
            read_asset(&root, "assets/theme.woff2").unwrap().0,
            "font/woff2"
        );
        for path in [
            "../outside.css",
            "%2e%2e/outside.css",
            "assets%5cscript.js",
            "assets/script.js",
        ] {
            assert!(read_asset(&root, path).is_none(), "{path}");
        }
    }
}

fn read_asset(root: &Path, relative: &str) -> Option<(&'static str, Vec<u8>)> {
    if !regular_directory(root) || root.canonicalize().ok()? != root {
        return None;
    }
    let mut path = root.to_owned();
    let mut segments = relative.split('/').peekable();
    while let Some(segment) = segments.next() {
        let name = percent_decode_str(segment).decode_utf8().ok()?;
        if !safe_component(&name) {
            return None;
        }
        path.push(name.as_ref());
        if segments.peek().is_some() && !regular_directory(&path) {
            return None;
        }
    }
    let mime = asset_type(&path)?;
    if !regular_file(&path) || !path.canonicalize().ok()?.starts_with(root) {
        return None;
    }
    let mut bytes = Vec::new();
    File::open(path)
        .ok()?
        .take(MAX_ASSET_BYTES + 1)
        .read_to_end(&mut bytes)
        .ok()?;
    (bytes.len() as u64 <= MAX_ASSET_BYTES).then_some((mime, bytes))
}

pub fn serve(
    context: tauri::UriSchemeContext<'_, tauri::Wry>,
    request: http::Request<Vec<u8>>,
    responder: tauri::UriSchemeResponder,
) {
    let path = request.uri().path().trim_start_matches('/').to_owned();
    let label = context.webview_label();
    let editor = label == "main" || label.starts_with("script-panel-");
    let root = if editor && request.method() == http::Method::GET {
        context
            .app_handle()
            .state::<DesktopTheme>()
            .0
            .lock()
            .ok()
            .and_then(|selection| selection.clone())
    } else {
        None
    };
    tauri::async_runtime::spawn_blocking(move || {
        let asset = root.and_then(|(id, root)| {
            let (requested, relative) = path.split_once('/')?;
            (Uuid::parse_str(requested).ok()? == id).then_some(())?;
            read_asset(&root, relative)
        });
        let (status, mime, bytes) = match asset {
            Some((mime, bytes)) => (http::StatusCode::OK, mime, bytes),
            None => (http::StatusCode::NOT_FOUND, "text/plain", Vec::new()),
        };
        responder.respond(
            http::Response::builder()
                .status(status)
                .header(http::header::CONTENT_TYPE, mime)
                .header(http::header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                .header(http::header::X_CONTENT_TYPE_OPTIONS, "nosniff")
                .header(http::header::CONTENT_SECURITY_POLICY, "default-src 'none'")
                .body(bytes)
                .expect("valid theme response"),
        );
    });
}
