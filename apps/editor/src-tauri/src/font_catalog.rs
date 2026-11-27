use tauri::{Manager, WebviewWindow};

#[tauri::command]
pub async fn installed_font_families(window: WebviewWindow) -> Result<Vec<String>, String> {
    let origin = window.url().map_err(|error| error.to_string())?.origin();
    let bundled = matches!(
        origin.ascii_serialization().as_str(),
        "http://tauri.localhost" | "https://tauri.localhost"
    );
    let development = tauri::is_dev()
        && window
            .app_handle()
            .config()
            .build
            .dev_url
            .as_ref()
            .is_some_and(|url| origin == url.origin());
    if window.label() != "main" || !(bundled || development) {
        return Err("Installed fonts are available only to the local editor.".into());
    }
    #[cfg(windows)]
    return tauri::async_runtime::spawn_blocking(|| {
        system_families().map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?;
    #[cfg(not(windows))]
    Err("Native font discovery is unavailable on this platform.".into())
}

#[cfg(windows)]
fn system_families() -> Result<Vec<String>, Box<dyn std::error::Error>> {
    use windows::{
        core::{w, BOOL},
        Win32::Graphics::DirectWrite::{
            DWriteCreateFactory, IDWriteFactory, DWRITE_FACTORY_TYPE_SHARED,
        },
    };

    // DirectWrite populates the collection and writes UTF-16 into the supplied buffer.
    // The reported length excludes the terminator. Own each result before dropping the collection.
    unsafe {
        let factory: IDWriteFactory = DWriteCreateFactory(DWRITE_FACTORY_TYPE_SHARED)?;
        let mut system_collection = None;
        factory.GetSystemFontCollection(&mut system_collection, true)?;
        let collection =
            system_collection.ok_or("Windows did not return an installed font collection.")?;
        let mut families = Vec::new();
        for index in 0..collection.GetFontFamilyCount() {
            let names = collection.GetFontFamily(index)?.GetFamilyNames()?;
            if names.GetCount() == 0 {
                continue;
            }
            let mut english = 0;
            let mut found = BOOL::default();
            names.FindLocaleName(w!("en-us"), &mut english, &mut found)?;
            let entry = if found.as_bool() { english } else { 0 };
            let length = names.GetStringLength(entry)? as usize;
            // Only names short enough for the existing authored family field are usable.
            if !(1..=100).contains(&length) {
                continue;
            }
            let mut buffer = vec![0u16; length + 1];
            names.GetString(entry, &mut buffer)?;
            if let Ok(family) = String::from_utf16(&buffer[..length]) {
                families.push(family);
            }
        }
        Ok(families)
    }
}
