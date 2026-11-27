#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use serde::Deserialize;
use serde_json::{json, Value};
use std::{collections::HashMap, fs::{self, OpenOptions}, io::{Read, Write}, path::{Component, Path, PathBuf}, sync::{Arc, Mutex, atomic::{AtomicBool, Ordering}}};
use tauri::Manager;

mod audio_storage;
mod desktop_plugins;
mod desktop_update;
mod font_catalog;
mod web_folder_export;
mod still_export;
#[cfg(target_os = "linux")]
mod linux_pen;
mod native_ffmpeg;
mod save_copy;
mod save_lock;
mod save_publication;
#[cfg(any(unix, test, feature = "native-project-test"))]
mod save_reuse;
#[cfg(feature = "native-smoke")]
mod native_smoke;

#[cfg(test)]
fn test_tempdir() -> std::io::Result<tempfile::TempDir> {
    // macOS exposes its temporary directory through a system symlink.
    // Use the physical location so production path guards stay active in tests.
    tempfile::tempdir_in(std::env::temp_dir().canonicalize()?)
}

#[derive(Default)]
struct Projects(Mutex<HashMap<PathBuf, Arc<DirectoryIdentity>>>);

// A pathname is not enough to authorize later access. After Open, a folder can
// be renamed, replaced, or closed while the webview still holds its old path.
struct DirectoryIdentity {
    handle: same_file::Handle,
    released: AtomicBool,
}

struct AuthorizedFolder {
    root: PathBuf,
    identity: Arc<DirectoryIdentity>,
}

impl AuthorizedFolder {
    fn verify(&self) -> Result<()> {
        if self.identity.released.load(Ordering::Acquire) {
            return Err("Project folder access ended. Open the project again.".into());
        }
        no_links(&self.root)?;
        let current = same_file::Handle::from_path(&self.root)
            .map_err(|error| format!("Project folder moved or is unavailable: {error}. Restore the original folder and try again."))?;
        if current != self.identity.handle {
            return Err("Project folder changed on disk. Restore the original folder and try again.".into());
        }
        Ok(())
    }
}
#[derive(Deserialize)]
struct Request { op: String, project: Option<String>, source: Option<String>, path: Option<String>, content: Option<String>, expected: Option<String>, files: Option<Vec<web_folder_export::Entry>> }
type Result<T> = std::result::Result<T, String>;
const LICENSE_LIMIT: u64 = 16384;

fn license_path(app: &tauri::AppHandle) -> Result<PathBuf> {
    let path = app.path().app_data_dir().map_err(err)?.join("SplashAnimator.splashlicense");
    no_links(&path)?;
    Ok(path)
}

#[tauri::command]
fn read_license(app: tauri::AppHandle) -> Result<Option<String>> {
    let file = match fs::File::open(license_path(&app)?) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(err(error)),
    };
    if !file.metadata().map_err(err)?.is_file() { return Err("Invalid license file.".into()); }
    let mut token = String::new();
    file.take(LICENSE_LIMIT + 1).read_to_string(&mut token).map_err(err)?;
    if token.len() as u64 > LICENSE_LIMIT { return Err("License file is too large.".into()); }
    Ok(Some(token))
}

#[tauri::command]
fn write_license(app: tauri::AppHandle, token: String) -> Result<()> {
    if token.is_empty() || token.len() as u64 > LICENSE_LIMIT ||
        !token.bytes().all(|c| c.is_ascii_alphanumeric() || b"-_.".contains(&c)) {
        return Err("Invalid license file.".into());
    }
    let path = license_path(&app)?;
    let temp = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    let result = write_new(&temp, &token).and_then(|_| fs::rename(&temp, &path).map_err(err));
    if result.is_err() { let _ = fs::remove_file(temp); }
    result
}
fn err(e: impl std::fmt::Display) -> String { e.to_string() }
fn required(value: &Option<String>) -> Result<&str> { value.as_deref().ok_or_else(|| "Missing argument".into()) }
fn no_links(path: &Path) -> Result<()> {
    let mut p = PathBuf::new();
    let mut parts = path.components().peekable();
    while let Some(part) = parts.next() {
        p.push(part);
        // A Windows drive prefix by itself is not a filesystem root. Check it
        // together with its root separator before checking descendants.
        if matches!(part, Component::Prefix(_)) && matches!(parts.peek(), Some(Component::RootDir)) {
            continue;
        }
        match fs::symlink_metadata(&p) {
            Ok(m) if m.file_type().is_symlink() => return Err("Symbolic links are not allowed".into()),
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => return Err(err(e)),
            _ => {}
        }
    }
    Ok(())
}
fn relative(root: &Path, value: &str) -> Result<PathBuf> {
    if value.is_empty() || value.contains('\\') || !value.bytes().all(|c| c.is_ascii_alphanumeric() || b"_./-".contains(&c)) || value.split('/').any(|v| v.is_empty() || v == "." || v == "..") || Path::new(value).components().any(|c| !matches!(c, Component::Normal(_))) { return Err("Unsafe project-relative path".into()); }
    let path = root.join(value); no_links(&path)?; Ok(path)
}
fn register(state: &Projects, folder: PathBuf) -> Result<String> {
    no_links(&folder)?;
    if folder.extension().and_then(|s| s.to_str()) != Some("spl") || !folder.is_dir() {
        return Err("Select an actual .spl directory".into());
    }
    let root = folder.canonicalize().map_err(err)?;
    no_links(&root)?;
    let handle = same_file::Handle::from_path(&root).map_err(err)?;
    let mut registered = state.0.lock().map_err(err)?;
    if let Some(identity) = registered.get(&root) {
        if identity.handle != handle {
            return Err("This project folder was replaced. Close its open tab or restore the original folder.".into());
        }
    } else {
        registered.insert(root.clone(), Arc::new(DirectoryIdentity {
            handle,
            released: AtomicBool::new(false),
        }));
    }
    Ok(root.to_string_lossy().into_owned())
}

fn authorized(state: &Projects, folder: &str) -> Result<AuthorizedFolder> {
    let root = PathBuf::from(folder);
    let identity = state.0.lock().map_err(err)?.get(&root).cloned()
        .ok_or("Project folder was not selected by the user")?;
    let folder = AuthorizedFolder { root, identity };
    folder.verify()?;
    Ok(folder)
}

fn release_folder(state: &Projects, folder: &str) -> Result<()> {
    if let Some(identity) = state.0.lock().map_err(err)?.remove(Path::new(folder)) {
        identity.released.store(true, Ordering::Release);
    }
    Ok(())
}

fn open_new_project_file(file: &Path, content: &str) -> Result<fs::File> {
    if content.len() > 32 * 1024 * 1024 { return Err("JSON exceeds 32 MiB limit".into()); }
    fs::create_dir_all(file.parent().ok_or("Invalid file")?).map_err(err)?;
    OpenOptions::new().write(true).create_new(true).open(file).map_err(err)
}

fn write_synced_content(file: &mut fs::File, content: &str) -> Result<()> {
    file.write_all(content.as_bytes()).map_err(err)?;
    file.sync_all().map_err(err)
}

fn write_new(file: &Path, content: &str) -> Result<()> {
    write_synced_content(&mut open_new_project_file(file, content)?, content)
}

fn matches_native_file(path: &Path, identity: &same_file::Handle) -> bool {
    no_links(path).is_ok() && same_file::Handle::from_path(path).is_ok_and(|file| file == *identity)
}
fn read(file: &Path) -> Result<String> { if fs::metadata(file).map_err(err)?.len() > 32 * 1024 * 1024 { return Err("JSON exceeds 32 MiB limit".into()); } fs::read_to_string(file).map_err(err) }
fn script_path(path: &str) -> bool {
    path.starts_with("scripts/") && path.ends_with(".ts") && path.split('/').all(|part| {
        let stem = part.split('.').next().unwrap_or("").to_ascii_lowercase();
        !part.is_empty() && !part.starts_with('.') && !part.ends_with('.') &&
        part.bytes().all(|c| c.is_ascii_alphanumeric() || b"_-.".contains(&c)) &&
        !matches!(stem.as_str(), "con" | "prn" | "aux" | "nul") &&
        !(stem.len() == 4 && (stem.starts_with("com") || stem.starts_with("lpt")) && (b'1'..=b'9').contains(&stem.as_bytes()[3]))
    })
}
fn list_scripts(root: &Path) -> Result<Vec<String>> {
    let mut folders = vec![String::from("scripts")];
    let mut files = Vec::new();
    while let Some(folder) = folders.pop() {
        let dir = relative(root, &folder)?;
        if !dir.exists() { continue; }
        for item in fs::read_dir(dir).map_err(err)? {
            let item = item.map_err(err)?;
            let kind = item.file_type().map_err(err)?;
            let Some(name) = item.file_name().to_str().map(str::to_owned) else { continue; };
            let path = format!("{folder}/{name}");
            if kind.is_dir() && script_path(&format!("{path}/file.ts")) { folders.push(path); }
            else if kind.is_file() && script_path(&path) { files.push(path); }
        }
    }
    files.sort(); Ok(files)
}
#[derive(Debug, serde::Serialize)]
struct CommitReceipt {
    warning: Option<String>,
}

#[cfg(test)]
fn commit(root: &Path, target: &str, content: &str, expected: Option<&str>) -> Result<CommitReceipt> {
    commit_with_publish_check(root, target, content, expected, || Ok(()))
}

fn commit_with_publish_check(
    root: &Path,
    target: &str,
    content: &str,
    expected: Option<&str>,
    before_publish: impl FnOnce() -> Result<()>,
) -> Result<CommitReceipt> {
    commit_with_receipt(root, target, content, expected, before_publish, |parent, identity| {
        #[cfg(feature = "native-project-test")]
        if target == "project.json" && root.join(".splash/native-test-flush-failure").is_file() {
            return Err(std::io::Error::other("Fixture refused the final disk synchronization."));
        }
        save_publication::sync_publication(parent, identity)
    })
}

fn commit_with_receipt(
    root: &Path,
    target: &str,
    content: &str,
    expected: Option<&str>,
    before_publish: impl FnOnce() -> Result<()>,
    finish_publication: impl FnOnce(&Path, &same_file::Handle) -> std::io::Result<()>,
) -> Result<CommitReceipt> {
    if !script_path(target) && target != "project.json" && target != ".splash/autosaves/latest.json" { return Err("Invalid commit target".into()); }
    let file = relative(root, target)?;
    let parent = file.parent().ok_or("Invalid save destination.")?;
    let mut directories = vec![(root.to_path_buf(), same_file::Handle::from_path(root).map_err(err)?)];
    fs::create_dir_all(parent).map_err(err)?;
    let mut prefix = root.to_path_buf();
    for part in parent.strip_prefix(root).map_err(err)?.components() {
        prefix.push(part);
        directories.push((prefix.clone(), same_file::Handle::from_path(&prefix).map_err(err)?));
    }
    let same_directories = || no_links(parent).is_ok() && directories.iter().all(|(path, identity)| {
        same_file::Handle::from_path(path).is_ok_and(|current| current == *identity)
    });
    let check_directories = || {
        if !same_directories() {
            return Err("Project folder changed on disk. Restore the original folder and try again.".into());
        }
        Ok::<_, String>(())
    };
    check_directories()?;
    let lock_path = file.with_file_name(format!("{}.lock", file.file_name().unwrap().to_string_lossy()));
    let lock = save_lock::NativeSaveLock::acquire(&lock_path)?;
    let temp = file.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    let mut stage_identity = None;
    let result = (|| {
        check_directories()?;
        let check_current = || {
            no_links(&file)?;
            let current = if file.try_exists().map_err(err)? { Some(read(&file)?) } else { None };
            if current.as_deref() != expected {
                return Err("Project changed on disk; reopen or Save As to avoid overwriting changes".into());
            }
            Ok::<_, String>(current)
        };
        let current = check_current()?;
        if let Some(old) = current.filter(|_| !script_path(target)) { write_new(&relative(root, &format!(".splash/autosaves/previous-{}.json", uuid::Uuid::new_v4()))?, &old)?; }
        let mut stage = open_new_project_file(&temp, content)?;
        let identity = same_file::Handle::from_file(stage.try_clone().map_err(err)?).map_err(err)?;
        stage_identity = Some(identity);
        write_synced_content(&mut stage, content)?;
        drop(stage);
        before_publish()?;
        check_current()?;
        check_directories()?;
        if !lock.is_current() {
            return Err("The project save lock changed. Wait for other editors to finish, then retry.".into());
        }
        if !stage_identity.as_ref().is_some_and(|identity| matches_native_file(&temp, identity)) {
            return Err("The staged project file changed. Retry saving the original project.".into());
        }
        let synchronization = match save_publication::replace(&temp, &file) {
            Ok(()) => finish_publication(parent, &directories.last().unwrap().1),
            Err(error) if stage_identity.as_ref().is_some_and(|identity| matches_native_file(&file, identity)) => Err(error),
            Err(error) => return Err(format!("Cannot replace the saved project file: {error}. Check folder permissions or close any app holding the file, then retry.")),
        };
        Ok(CommitReceipt {
            warning: synchronization.err().map(|error| {
                format!("The file was written, but disk synchronization could not be confirmed: {error}. Retry Save.")
            }),
        })
    })();
    if same_directories() && stage_identity.as_ref().is_some_and(|identity| matches_native_file(&temp, identity)) {
        let _ = fs::remove_file(temp);
    }
    drop(lock);
    result
}
fn project_dialog(window: &tauri::WebviewWindow, title: &str, _test_location: &str) -> rfd::FileDialog {
    let dialog = rfd::FileDialog::new().set_parent(window).set_title(title);
    #[cfg(feature = "native-project-test")]
    if let Some(directory) = std::env::var_os(_test_location) {
        return dialog.set_directory(directory);
    }
    dialog
}

fn initialize_empty_project(folder: &Path) -> Result<()> {
    // Keep these placeholders separate from the revision files written by the editor.
    for directory in [
        "scenes",
        "timelines",
        "symbols",
        "vectors",
        "scripts",
        "assets/images",
        "assets/audio",
        "assets/video",
        "assets/fonts",
        "assets/imported",
        "settings",
        ".splash/autosaves",
        ".splash/cache",
    ] {
        fs::create_dir_all(folder.join(directory)).map_err(err)?;
    }
    write_new(
        &folder.join("scripts/main.ts"),
        "// TypeScript source preserved; runtime planned for M5.\n",
    )?;
    write_new(&folder.join("settings/export.json"), "{\"format\":\"html\"}\n")
}

// Commands that show an OS picker can establish new access. Every other
// project operation needs a folder the current editor has already registered.
#[tauri::command]
fn project_operation(request: Request, state: tauri::State<Projects>, window: tauri::WebviewWindow) -> Result<Value> {
    let q = request;
    match q.op.as_str() {
        "export-still" => {
            let format = still_export::extension(required(&q.path)?)?;
            let name = required(&q.project)?;
            let Some(file) = project_dialog(&window, "Save single frame", "SPLASH_NATIVE_PROJECT_SAVE_FOLDER")
                .set_file_name(name).add_filter("Single frame", &[format]).save_file()
            else { return Ok(Value::Null); };
            return Ok(json!(still_export::save(&file, format, required(&q.content)?)?.to_string_lossy()));
        }
        "export-web-folder" => {
            let name = required(&q.project)?;
            let entries = q.files.ok_or("Missing web folder files")?;
            let Some(parent) = project_dialog(&window, &format!("Choose where to create {name}"), "SPLASH_NATIVE_PROJECT_SAVE_FOLDER")
                .pick_folder() else { return Ok(Value::Null) };
            return Ok(json!(web_folder_export::publish(&parent, name, &entries)?.to_string_lossy()));
        }
        "release" => { release_folder(&state, required(&q.project)?)?; return Ok(Value::Null); }
        "select" => { let Some(folder) = project_dialog(&window, "Open a .spl project folder", "SPLASH_NATIVE_PROJECT_OPEN_FOLDER").pick_folder() else { return Ok(Value::Null) }; return Ok(json!(register(&state, folder)?)); }
        "create" | "duplicate" => {
            let name = required(&q.project)?;
            if !name.ends_with(".spl") || name.len() > 85 || !name.bytes().all(|c| c.is_ascii_alphanumeric() || b" _-.".contains(&c)) || name.starts_with('.') || name[..name.len()-4].contains('.') { return Err("Invalid project folder name".into()); }
            let Some(parent) = project_dialog(&window, "Choose parent folder for new .spl project", "SPLASH_NATIVE_PROJECT_SAVE_FOLDER").pick_folder() else { return Ok(Value::Null) };
            let original = if q.op == "duplicate" {
                Some(authorized(&state, required(&q.source)?)?)
            } else {
                None
            };
            no_links(&parent)?;
            if let Some(original) = &original {
                original.verify()?;
                if parent.canonicalize().map_err(err)?.starts_with(&original.root) {
                    return Err("Choose a Save As folder outside the original project.".into());
                }
            }
            let folder = parent.join(name); fs::create_dir(&folder).map_err(err)?;
            if let Some(original) = original {
                save_copy::copy_project(&original.root, &folder, || original.verify(), || {
                    #[cfg(feature = "native-project-test")]
                    if original.root.join(".splash/native-test-copy-failure").is_file() {
                        return Err("Cannot publish the project copy: fixture interrupted Save As. Choose a new folder name and retry.".into());
                    }
                    Ok(())
                })?;
            } else {
                initialize_empty_project(&folder)?;
            }
            return Ok(json!(register(&state, folder)?));
        }
        _ => {}
    }
    let folder = authorized(&state, required(&q.project)?)?;
    let root = &folder.root;
    if q.op == "listScripts" { return Ok(json!(list_scripts(root)?)); }
    let name = required(&q.path)?; let file = relative(root, name)?;
    match q.op.as_str() {
        "read" => Ok(json!(read(&file)?)),
        "exists" => Ok(json!(file.exists())),
        "write" => {
            let content = required(&q.content)?;
            if content.len() > 32 * 1024 * 1024 { return Err("JSON exceeds 32 MiB limit".into()); }
            save_publication::write_component(root, &file, |stage| stage.write_all(content.as_bytes()), || {
                folder.verify()?;
                #[cfg(feature = "native-project-test")]
                if name.starts_with("vectors/") && root.join(".splash/native-test-component-failure").is_file() {
                    return Err("Fixture refused to publish the staged project component. Retry Save.".into());
                }
                Ok(())
            })?;
            Ok(json!(true))
        },
        "commit" => {
            let content = required(&q.content)?;
            Ok(json!(commit_with_publish_check(root, name, content, q.expected.as_deref(), || {
                folder.verify()?;
                // On Unix a component can have been renamed successfully before its
                // directory flush failed. Retry may reuse that file without rewriting it.
                #[cfg(any(unix, feature = "native-project-test"))]
                if matches!(name, "project.json" | ".splash/autosaves/latest.json") {
                    save_reuse::confirm_asset_directories(root, content, |path, identity| {
                        #[cfg(feature = "native-project-test")]
                        if name == "project.json" && path == root.join("assets/bitmaps")
                            && root.join(".splash/native-test-reuse-failure").is_file()
                        {
                            return Err(std::io::Error::other("Fixture refused to synchronize the existing bitmap directory."));
                        }
                        save_publication::sync_publication(path, identity)
                    })?;
                    folder.verify()?;
                }
                Ok(())
            })?))
        },
        _ => Err("Unknown project operation".into())
    }
}
fn packaged_editor_url(url: &tauri::Url) -> bool {
    url.username().is_empty()
        && url.password().is_none()
        && url.port().is_none()
        && matches!((url.scheme(), url.host_str()),
            ("http" | "https", Some("tauri.localhost")) | ("tauri", Some("localhost")))
}

fn editor_window_origin(window: &tauri::WebviewWindow) -> Result<bool> {
    let url = window.url().map_err(err)?;
    Ok(packaged_editor_url(&url) || (tauri::is_dev() &&
        window.app_handle().config().build.dev_url.as_ref()
            .is_some_and(|dev| dev.origin() == url.origin())))
}

#[cfg(target_os = "linux")]
fn enable_ibus_preedit<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) -> tauri::Result<()> {
    window.with_webview(|platform| {
        use gtk::prelude::GtkSettingsExt;
        use webkit2gtk::{InputMethodContextExt, WebViewExt};
        let module = std::env::var("GTK_IM_MODULE").ok().filter(|name| !name.is_empty())
            .or_else(|| gtk::Settings::default()?.gtk_im_module().map(|name| name.to_string()));
        if module.as_deref() == Some("ibus") {
            // Monaco needs inline preedit events. Keep Wry's candidate
            // placement setting for other input modules.
            if let Some(context) = platform.inner().input_method_context() {
                context.set_enable_preedit(true);
            }
        }
    })
}

#[cfg(target_os = "linux")]
fn setup_linux_editor<R: tauri::Runtime>(app: &tauri::App<R>) -> tauri::Result<()> {
    linux_pen::attach(app)?;
    if let Some(window) = app.get_webview_window("main") {
        enable_ibus_preedit(&window)?;
    }
    Ok(())
}

#[tauri::command]
async fn script_panel_window(window: tauri::WebviewWindow, session: String, action: String) -> Result<()> {
    use tauri::{Emitter, WebviewUrl, WebviewWindowBuilder};
    if window.label() != "main" || session.len() != 36 || !session.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-') {
        return Err("Invalid script panel session".into());
    }
    let app = window.app_handle();
    if !editor_window_origin(&window)? {
        return Err("Script windows belong to the local editor".into());
    }
    let label = format!("script-panel-{session}");
    if let Some(panel) = app.get_webview_window(&label) {
        return match action.as_str() {
            "close" => panel.destroy().map_err(err),
            "focus" | "open" => panel.set_focus().map_err(err),
            _ => Err("Unknown script panel action".into()),
        };
    }
    if action == "close" { return Ok(()); }
    if action != "open" { return Err("Script panel is closed".into()); }
    let url = WebviewUrl::App(format!("index.html#script-panel={session}").into());
    let panel = WebviewWindowBuilder::new(app, label, url).title("Script Editor · Splash Animator")
        .inner_size(820.0, 620.0).min_inner_size(340.0, 220.0).build().map_err(err)?;
    #[cfg(target_os = "linux")]
    enable_ibus_preedit(&panel).map_err(err)?;
    let owner = window.clone();
    let closing_panel = panel.clone();
    let returning_source = std::sync::atomic::AtomicBool::new(false);
    panel.on_window_event(move |event| match event {
        tauri::WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            if returning_source.swap(true, std::sync::atomic::Ordering::Relaxed) { return; }
            if owner.emit("script-panel-close-requested", &session).is_err() {
                let _ = closing_panel.destroy();
                return;
            }
            // Let a stalled or disconnected editor window close as well.
            let fallback = closing_panel.clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_secs(4));
                let _ = fallback.destroy();
            });
        }
        tauri::WindowEvent::Destroyed => { let _ = owner.emit("script-panel-closed", &session); }
        _ => {}
    });
    Ok(())
}

#[tauri::command]
async fn documentation_window(window: tauri::WebviewWindow) -> Result<()> {
    use tauri::{WebviewUrl, WebviewWindowBuilder};
    let app = window.app_handle();
    if window.label() != "main" || !editor_window_origin(&window)? {
        return Err("Documentation windows belong to the local editor".into());
    }
    if let Some(viewer) = app.get_webview_window("documentation") {
        return viewer.set_focus().map_err(err);
    }
    WebviewWindowBuilder::new(app, "documentation", WebviewUrl::App("docs/index.html".into()))
        .title("Documentation · Splash Animator")
        .inner_size(1000.0, 760.0)
        .min_inner_size(380.0, 300.0)
        .build()
        .map_err(err)?;
    Ok(())
}

fn main() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(desktop_update::DesktopUpdates::default());
    #[cfg(feature = "native-smoke")]
    let builder = native_smoke::attach(builder);
    #[cfg(all(target_os = "linux", not(feature = "native-smoke")))]
    let builder = builder.setup(|app| {
        setup_linux_editor(app)?;
        Ok(())
    });
    builder.on_window_event(|window, event| {
        if window.label() == "main" {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if let Some(first) = window.state::<native_ffmpeg::FFmpeg>().defer_close() {
                    api.prevent_close();
                    if first {
                        let owner = window.clone();
                        tauri::async_runtime::spawn_blocking(move || {
                            while owner.state::<native_ffmpeg::FFmpeg>().running() {
                                std::thread::sleep(std::time::Duration::from_millis(25));
                            }
                            let _ = owner.close();
                        });
                    }
                }
            }
        }
        if window.label() == "main" && matches!(event, tauri::WindowEvent::Destroyed) {
            window.state::<native_ffmpeg::FFmpeg>().close();
            for (label, panel) in window.app_handle().webview_windows() {
                if label.starts_with("script-panel-") || label == "documentation" { let _ = panel.close(); }
            }
        }
    }).manage(Projects::default()).manage(native_ffmpeg::FFmpeg::default()).invoke_handler(tauri::generate_handler![script_panel_window, documentation_window, project_operation, audio_storage::project_audio_read, audio_storage::project_audio_write, font_catalog::installed_font_families, read_license, write_license, desktop_plugins::desktop_plugins_discover, desktop_plugins::desktop_plugins_choose_folder, desktop_update::desktop_update_check, desktop_update::desktop_update_download, desktop_update::desktop_update_install, native_ffmpeg::ffmpeg_choose, native_ffmpeg::ffmpeg_choose_capture, native_ffmpeg::ffmpeg_push_frame, native_ffmpeg::ffmpeg_push_audio, native_ffmpeg::ffmpeg_encode, native_ffmpeg::ffmpeg_publish, native_ffmpeg::ffmpeg_cancel]).run(tauri::generate_context!()).expect("Unable to start Splash Animator");
}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn packaged_editor_url_checks_scheme_and_host_without_an_opaque_origin_match() {
        for value in ["tauri://localhost/index.html", "https://tauri.localhost/", "http://tauri.localhost/"] {
            assert!(packaged_editor_url(&tauri::Url::parse(value).unwrap()), "{value}");
        }
        for value in ["https://localhost/", "tauri://elsewhere/", "other://localhost/",
            "tauri://localhost:8080/", "http://tauri.localhost:8080/",
            "tauri://user@localhost/", "file:///index.html", "https://tauri.localhost.example/"] {
            assert!(!packaged_editor_url(&tauri::Url::parse(value).unwrap()), "{value}");
        }
    }
    #[test]
    fn saves_and_reopens_using_the_registered_folder_path() {
        let temp = crate::test_tempdir().unwrap();
        let folder = temp.path().join("My Animation.spl");
        fs::create_dir(&folder).unwrap();
        let projects = Projects::default();
        let handle = register(&projects, folder.clone()).unwrap();
        let root = authorized(&projects, &handle).unwrap().root;
        assert_eq!(root, folder.canonicalize().unwrap());

        write_new(&relative(&root, "scenes/first.json").unwrap(), "{}").unwrap();
        commit(&root, "project.json", "{\"version\":1}", None).unwrap();
        commit(&root, "project.json", "{\"version\":2}", Some("{\"version\":1}")).unwrap();
        commit(&root, ".splash/autosaves/latest.json", "{}", None).unwrap();

        let reopened = authorized(&projects, &register(&projects, folder).unwrap()).unwrap().root;
        assert_eq!(read(&relative(&reopened, "project.json").unwrap()).unwrap(), "{\"version\":2}");
        assert_eq!(read(&relative(&reopened, "scenes/first.json").unwrap()).unwrap(), "{}");
        assert_eq!(read(&relative(&reopened, ".splash/autosaves/latest.json").unwrap()).unwrap(), "{}");
    }
    #[test] fn rejects_traversal() { let temp = crate::test_tempdir().unwrap(); for p in ["../secret", "/etc/passwd", "a/../b", "C:/data", "a\\b", "a//b"] { assert!(relative(temp.path(), p).is_err()); } }
    #[test]
    fn project_scripts_roundtrip_and_detect_conflicts() {
        let temp = crate::test_tempdir().unwrap();
        let root = temp.path();
        let file = "scripts/actors/player.ts";
        commit(root, file, "first", None).unwrap();
        assert_eq!(list_scripts(root).unwrap(), vec![file]);
        commit(root, file, "second", Some("first")).unwrap();
        assert!(commit(root, file, "stale", Some("first")).is_err());
        assert_eq!(read(&relative(root, file).unwrap()).unwrap(), "second");
        for invalid in ["scripts/../outside.ts", "scripts/con.ts", "settings/config.ts"] {
            assert!(commit(root, invalid, "", None).is_err());
        }
    }
    #[test]
    fn native_save_rechecks_manifest_after_staging() {
        let temp = crate::test_tempdir().unwrap();
        let root = temp.path();
        let file = root.join("project.json");
        let unrelated = root.join("original-artwork.txt");
        let lock = root.join("project.json.lock");
        commit(root, "project.json", "baseline", None).unwrap();
        fs::write(&unrelated, "user artwork").unwrap();

        let result = commit_with_publish_check(root, "project.json", "draft", Some("baseline"), || {
            assert!(lock.is_file());
            assert!(fs::read_dir(root).unwrap().flatten().any(|item| {
                item.path().extension().and_then(|ext| ext.to_str()) == Some("tmp")
            }));
            fs::write(&file, "external save").map_err(err)
        });

        assert!(result.unwrap_err().contains("Project changed on disk"));
        assert_eq!(read(&file).unwrap(), "external save");
        assert_eq!(read(&unrelated).unwrap(), "user artwork");
        assert!(!lock.exists());
        assert!(!fs::read_dir(root).unwrap().flatten().any(|item| {
            item.path().extension().and_then(|ext| ext.to_str()) == Some("tmp")
        }));
        commit(root, "project.json", "merged", Some("external save")).unwrap();
        assert_eq!(read(&file).unwrap(), "merged");
    }

    #[test]
    fn keeps_the_registered_native_folder_identity() {
        let temp = crate::test_tempdir().unwrap();
        let folder = temp.path().join("original.spl");
        let parked = temp.path().join("parked.spl");
        fs::create_dir(&folder).unwrap();
        fs::write(folder.join("project.json"), "same manifest").unwrap();
        let projects = Projects::default();
        let path = register(&projects, folder.clone()).unwrap();
        let owner = authorized(&projects, &path).unwrap();
        assert_eq!(register(&projects, folder.clone()).unwrap(), path);

        fs::rename(&folder, &parked).unwrap();
        fs::create_dir(&folder).unwrap();
        fs::write(folder.join("project.json"), "same manifest").unwrap();
        fs::write(folder.join("artwork.txt"), "replacement artwork").unwrap();
        assert!(authorized(&projects, &path).is_err());
        assert!(owner.verify().is_err());
        assert!(register(&projects, folder.clone()).is_err());
        assert_eq!(read(&folder.join("artwork.txt")).unwrap(), "replacement artwork");

        let replacement = temp.path().join("replacement.spl");
        fs::rename(&folder, &replacement).unwrap();
        fs::rename(&parked, &folder).unwrap();
        authorized(&projects, &path).unwrap();
        fs::rename(&folder, &parked).unwrap();
        fs::rename(&replacement, &folder).unwrap();
        release_folder(&projects, &path).unwrap();
        let new_path = register(&projects, folder.clone()).unwrap();
        assert_eq!(new_path, path);
        assert!(owner.verify().is_err());
        assert_eq!(read(&authorized(&projects, &new_path).unwrap().root.join("artwork.txt")).unwrap(), "replacement artwork");
    }

    #[test]
    fn native_save_does_not_clean_files_in_a_replacement_folder() {
        let temp = crate::test_tempdir().unwrap();
        let root = temp.path().join("artwork.spl");
        let parked = temp.path().join("original.spl");
        fs::create_dir(&root).unwrap();
        commit(&root, "project.json", "same manifest", None).unwrap();

        let mut move_error = None;
        let result = commit_with_publish_check(&root, "project.json", "draft", Some("same manifest"), || {
            if let Err(error) = fs::rename(&root, &parked) {
                move_error = Some(error);
                return Err("The running save prevented moving the fixture folder.".into());
            }
            fs::create_dir(&root).map_err(err)?;
            fs::write(root.join("project.json"), "same manifest").map_err(err)?;
            fs::write(root.join("project.json.lock"), "other writer").map_err(err)
        });

        if let Some(error) = move_error {
            assert!(cfg!(windows) && matches!(error.raw_os_error(), Some(5) | Some(32)), "{error}");
            assert!(result.is_err());
            assert_eq!(read(&root.join("project.json")).unwrap(), "same manifest");
            assert!(!root.join("project.json.lock").exists());
            return;
        }
        assert!(result.unwrap_err().contains("Project folder changed on disk"));
        assert_eq!(read(&root.join("project.json")).unwrap(), "same manifest");
        assert_eq!(read(&root.join("project.json.lock")).unwrap(), "other writer");
        assert_eq!(read(&parked.join("project.json")).unwrap(), "same manifest");
    }

    #[test]
    fn native_save_has_a_live_process_fixture() {
        let Some(root) = std::env::var_os("SPLASH_TEST_NATIVE_SAVE_WRITER") else { return };
        let root = PathBuf::from(root);
        let _ = commit_with_publish_check(&root, "project.json", "interrupted draft", Some("baseline"), || {
            fs::write(root.join("writer-ready"), "staged").map_err(err)?;
            std::thread::sleep(std::time::Duration::from_secs(30));
            Err("Fixture writer timed out.".into())
        });
    }

    #[test]
    fn interrupted_native_writer_releases_the_save_lock() {
        use std::{process::{Child, Command, Stdio}, thread, time::{Duration, Instant}};

        struct Writer(Child);
        impl Drop for Writer {
            fn drop(&mut self) {
                let _ = self.0.kill();
                let _ = self.0.wait();
            }
        }

        let temp = crate::test_tempdir().unwrap();
        let root = temp.path();
        let manifest = root.join("project.json");
        let lock = root.join("project.json.lock");
        let unrelated = root.join("user-artwork.txt");
        commit(root, "project.json", "baseline", None).unwrap();
        fs::write(&unrelated, "user file").unwrap();

        let mut writer = Writer(Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "tests::native_save_has_a_live_process_fixture"])
            .env("SPLASH_TEST_NATIVE_SAVE_WRITER", root)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn().unwrap());
        let deadline = Instant::now() + Duration::from_secs(8);
        while !root.join("writer-ready").exists() {
            assert!(Instant::now() < deadline && writer.0.try_wait().unwrap().is_none(),
                "The child did not acquire and stage its native save.");
            thread::sleep(Duration::from_millis(25));
        }

        assert!(lock.is_file());
        let conflict = commit(root, "project.json", "concurrent draft", Some("baseline")).unwrap_err();
        assert!(conflict.contains("Another editor is saving"), "{conflict}");
        assert_eq!(read(&manifest).unwrap(), "baseline");
        writer.0.kill().unwrap();
        writer.0.wait().unwrap();
        assert!(lock.is_file());
        assert_eq!(read(&manifest).unwrap(), "baseline");

        commit(root, "project.json", "recovered draft", Some("baseline")).unwrap();
        assert_eq!(read(&manifest).unwrap(), "recovered draft");
        assert_eq!(read(&unrelated).unwrap(), "user file");
        assert!(!lock.exists());
    }

    #[test]
    fn native_save_preserves_an_unrecognized_legacy_lock() {
        let temp = crate::test_tempdir().unwrap();
        let root = temp.path();
        let lock = root.join("project.json.lock");
        commit(root, "project.json", "baseline", None).unwrap();
        for legacy in ["", "external lock data"] {
            fs::write(&lock, legacy).unwrap();
            let failure = commit(root, "project.json", "draft", Some("baseline")).unwrap_err();
            assert!(failure.contains("older or unrecognized"), "{failure}");
            assert_eq!(read(&lock).unwrap(), legacy);
            assert_eq!(read(&root.join("project.json")).unwrap(), "baseline");
        }
    }

    #[cfg(windows)]
    #[test]
    fn native_save_preserves_manifest_during_real_windows_sharing_failure() {
        use std::os::windows::fs::OpenOptionsExt;

        let temp = crate::test_tempdir().unwrap();
        let root = temp.path();
        let manifest = root.join("project.json");
        commit(root, "project.json", "baseline", None).unwrap();
        // Deliberately omit FILE_SHARE_DELETE so Windows refuses the rename.
        let reader = OpenOptions::new().read(true).share_mode(1).open(&manifest).unwrap();
        let failure = commit(root, "project.json", "draft", Some("baseline")).unwrap_err();
        assert!(failure.contains("Cannot replace the saved project file"), "{failure}");
        assert_eq!(read(&manifest).unwrap(), "baseline");
        assert!(!root.join("project.json.lock").exists());

        drop(reader);
        commit(root, "project.json", "draft", Some("baseline")).unwrap();
        assert_eq!(read(&manifest).unwrap(), "draft");
    }

    #[cfg(windows)]
    #[test]
    fn native_save_reports_read_only_lock_access() {
        let temp = crate::test_tempdir().unwrap();
        let root = temp.path();
        let lock = root.join("project.json.lock");
        let manifest = root.join("project.json");
        commit(root, "project.json", "baseline", None).unwrap();
        fs::write(&lock, "user file").unwrap();
        let original = fs::metadata(&lock).unwrap().permissions();
        let mut read_only = original.clone();
        read_only.set_readonly(true);
        fs::set_permissions(&lock, read_only).unwrap();
        let result = commit(root, "project.json", "draft", Some("baseline"));
        fs::set_permissions(&lock, original).unwrap();
        let failure = result.unwrap_err();
        assert!(failure.contains("Check folder permissions"), "{failure}");
        assert_eq!(read(&manifest).unwrap(), "baseline");
        assert_eq!(read(&lock).unwrap(), "user file");
        fs::remove_file(lock).unwrap();
        commit(root, "project.json", "draft", Some("baseline")).unwrap();
        assert_eq!(read(&manifest).unwrap(), "draft");
    }

    #[test]
    fn native_save_preserves_a_replaced_nested_autosave_directory() {
        let temp = crate::test_tempdir().unwrap();
        let root = temp.path();
        let target = ".splash/autosaves/latest.json";
        let parked = root.join("parked");
        commit(root, target, "baseline", None).unwrap();

        let mut move_error = None;
        let result = commit_with_publish_check(root, target, "draft", Some("baseline"), || {
            if let Err(error) = fs::rename(root.join(".splash"), &parked) {
                move_error = Some(error);
                return Err("The running save prevented moving the fixture directory.".into());
            }
            fs::create_dir_all(root.join(".splash/autosaves")).map_err(err)?;
            fs::write(root.join(target), "baseline").map_err(err)?;
            fs::write(root.join(".splash/autosaves/latest.json.lock"), "replacement lock").map_err(err)?;
            fs::write(root.join(".splash/autosaves/user-artwork.txt"), "user bytes").map_err(err)
        });

        if let Some(error) = move_error {
            assert!(cfg!(windows) && matches!(error.raw_os_error(), Some(5) | Some(32)), "{error}");
            assert!(result.is_err());
            assert_eq!(read(&root.join(target)).unwrap(), "baseline");
            assert!(!root.join(".splash/autosaves/latest.json.lock").exists());
        } else {
            assert!(result.unwrap_err().contains("Project folder changed on disk"));
            assert_eq!(read(&root.join(target)).unwrap(), "baseline");
            assert_eq!(read(&parked.join("autosaves/latest.json")).unwrap(), "baseline");
            assert_eq!(read(&root.join(".splash/autosaves/latest.json.lock")).unwrap(), "replacement lock");
            assert_eq!(read(&root.join(".splash/autosaves/user-artwork.txt")).unwrap(), "user bytes");
            fs::rename(root.join(".splash"), root.join("replacement")).unwrap();
            fs::rename(parked, root.join(".splash")).unwrap();
        }
        commit(root, target, "retry", Some("baseline")).unwrap();
        assert_eq!(read(&root.join(target)).unwrap(), "retry");
    }

    #[test]
    fn native_save_cannot_publish_or_delete_a_replacement_stage_or_lock() {
        for replace_lock in [false, true] {
            let temp = crate::test_tempdir().unwrap();
            let root = temp.path();
            let target = "project.json";
            commit(root, target, "baseline", None).unwrap();

            let mut substituted = None;
            let result = commit_with_publish_check(root, target, "draft", Some("baseline"), || {
                let path = if replace_lock {
                    root.join("project.json.lock")
                } else {
                    fs::read_dir(root).map_err(err)?.flatten().map(|entry| entry.path())
                        .find(|path| path.extension().and_then(|ext| ext.to_str()) == Some("tmp"))
                        .ok_or("Missing staged candidate")?
                };
                fs::rename(&path, root.join("original-owned-file")).map_err(err)?;
                fs::write(&path, "foreign bytes").map_err(err)?;
                substituted = Some(path);
                Ok(())
            });

            let expected = if replace_lock { "save lock changed" } else { "staged project file changed" };
            let failure = result.unwrap_err();
            assert!(failure.contains(expected), "{failure}");
            assert_eq!(read(&root.join(target)).unwrap(), "baseline");
            let foreign = substituted.unwrap();
            assert_eq!(read(&foreign).unwrap(), "foreign bytes");
            if replace_lock {
                fs::rename(&foreign, root.join("foreign-lock-copy")).unwrap();
            }
            commit(root, target, "retry", Some("baseline")).unwrap();
            assert_eq!(read(&root.join(target)).unwrap(), "retry");
            if !replace_lock {
                assert_eq!(read(&foreign).unwrap(), "foreign bytes");
            }
        }
    }

    #[test]
    fn native_save_receipt_survives_a_failed_flush_after_publication() {
        let temp = crate::test_tempdir().unwrap();
        let root = temp.path();
        let file = root.join("project.json");
        commit(root, "project.json", "baseline", None).unwrap();
        let receipt = commit_with_receipt(root, "project.json", "written", Some("baseline"), || Ok(()), |parent, _| {
            assert_eq!(parent, root);
            assert_eq!(read(&file).unwrap(), "written");
            Err(std::io::Error::other("fixture flush failure"))
        }).unwrap();
        assert!(receipt.warning.unwrap().contains("fixture flush failure"));
        assert_eq!(read(&file).unwrap(), "written");
        assert!(!root.join("project.json.lock").exists());
        let retry = commit(root, "project.json", "retried", Some("written")).unwrap();
        assert!(retry.warning.is_none());
        assert_eq!(read(&file).unwrap(), "retried");
    }

    #[test] fn commit_checks_conflicts() { let temp = crate::test_tempdir().unwrap(); commit(temp.path(), "project.json", "one", None).unwrap(); assert!(commit(temp.path(), "project.json", "two", None).is_err()); assert_eq!(read(&temp.path().join("project.json")).unwrap(), "one"); commit(temp.path(), "project.json", "two", Some("one")).unwrap(); assert_eq!(read(&temp.path().join("project.json")).unwrap(), "two"); }
}
