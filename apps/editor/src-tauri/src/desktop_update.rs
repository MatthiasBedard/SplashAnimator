use serde::Serialize;
use std::{
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::{
    async_runtime::Mutex as AsyncMutex,
    ipc::Channel,
    utils::{config::BundleType, platform::bundle_type},
    AppHandle, State, Url, WebviewWindow,
};
use tauri_plugin_updater::{Update, UpdaterExt};
use uuid::Uuid;

#[derive(Default)]
pub struct DesktopUpdates(AsyncMutex<Option<Candidate>>);

struct Candidate {
    ticket: String,
    update: Update,
    bytes: Option<Vec<u8>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseCheck {
    installed: String,
    latest: Option<String>,
    ticket: Option<String>,
    unavailable: Option<&'static str>,
}

#[derive(Clone, Serialize)]
pub struct DownloadProgress {
    received: u64,
    total: Option<u64>,
}

fn authorize(window: &WebviewWindow) -> crate::Result<()> {
    if window.label() == "main" && crate::editor_window_origin(window)? {
        Ok(())
    } else {
        Err("Updates belong to the local editor.".into())
    }
}

fn https_endpoint(value: &str) -> Option<Url> {
    let url = Url::parse(value).ok()?;
    (url.scheme() == "https"
        && url.host().is_some()
        && url.username().is_empty()
        && url.password().is_none()
        && url.fragment().is_none())
    .then_some(url)
}

#[tauri::command]
pub async fn desktop_update_check(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, DesktopUpdates>,
) -> crate::Result<ReleaseCheck> {
    authorize(&window)?;
    let mut slot = state
        .0
        .try_lock()
        .map_err(|_| "An update operation is already running.")?;
    *slot = None;
    let mut result = ReleaseCheck {
        installed: app.package_info().version.to_string(),
        latest: None,
        ticket: None,
        unavailable: None,
    };
    let (Some(feed), Some(key)) = (
        option_env!("SPLASH_UPDATE_FEED"),
        option_env!("SPLASH_UPDATE_PUBLIC_KEY"),
    ) else {
        result.unavailable = Some("This build has no update feed configured.");
        return Ok(result);
    };
    if !matches!(
        bundle_type(),
        Some(BundleType::Nsis | BundleType::Msi | BundleType::AppImage)
    ) {
        result.unavailable =
            Some("Install a packaged Splash Animator release to use automatic updates.");
        return Ok(result);
    }
    let endpoint = https_endpoint(feed.trim())
        .filter(|_| !key.trim().is_empty())
        .ok_or("This build has invalid update settings.")?;
    let latest = Arc::new(Mutex::new(None));
    let observed = Arc::clone(&latest);
    let check = app
        .updater_builder()
        .pubkey(key.trim())
        .endpoints(vec![endpoint])
        .map_err(|_| "This build has an invalid update feed.")?
        .timeout(Duration::from_secs(12))
        .configure_client(|client| client.https_only(true))
        .version_comparator(move |installed, release| {
            *observed.lock().unwrap() = Some(release.version.to_string());
            release.version > installed
        })
        .build()
        .map_err(|_| "Automatic updates are unavailable for this installation.")?;
    let update = check
        .check()
        .await
        .map_err(|_| "Could not check the release feed. Try again in a moment.")?;
    result.latest = latest.lock().unwrap().take();
    if let Some(mut update) = update {
        if https_endpoint(update.download_url.as_str()).is_none() {
            return Err("The release feed returned an invalid download URL.".into());
        }
        update.timeout = Some(Duration::from_secs(300));
        let ticket = Uuid::new_v4().to_string();
        result.ticket = Some(ticket.clone());
        *slot = Some(Candidate {
            ticket,
            update,
            bytes: None,
        });
    }
    Ok(result)
}

#[tauri::command]
pub async fn desktop_update_download(
    window: WebviewWindow,
    state: State<'_, DesktopUpdates>,
    ticket: String,
    progress: Channel<DownloadProgress>,
) -> crate::Result<()> {
    authorize(&window)?;
    let mut slot = state
        .0
        .try_lock()
        .map_err(|_| "An update operation is already running.")?;
    let candidate = slot
        .as_mut()
        .filter(|candidate| candidate.ticket == ticket)
        .ok_or("Check for updates again before downloading.")?;
    if candidate.bytes.is_none() {
        let mut received = 0;
        let mut reported = 0;
        let bytes = candidate
            .update
            .download(
                |length, total| {
                    received += length as u64;
                    if reported == 0 || received - reported >= 512 * 1024 || total == Some(received)
                    {
                        let _ = progress.send(DownloadProgress { received, total });
                        reported = received;
                    }
                },
                || {},
            )
            .await
            .map_err(|_| "Could not download or verify the update. Try again.")?;
        candidate.bytes = Some(bytes);
    }
    Ok(())
}

#[tauri::command]
pub async fn desktop_update_install(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, DesktopUpdates>,
    ticket: String,
) -> crate::Result<()> {
    authorize(&window)?;
    let mut slot = state
        .0
        .try_lock()
        .map_err(|_| "An update operation is already running.")?;
    let candidate = slot
        .as_ref()
        .filter(|candidate| candidate.ticket == ticket)
        .ok_or("Check for updates again before installing.")?;
    let bytes = candidate
        .bytes
        .as_ref()
        .ok_or("Download the update before installing.")?;
    candidate
        .update
        .install(bytes)
        .map_err(|_| "Could not install the update. Try again.")?;
    *slot = None;
    drop(slot);
    app.restart();
}

#[cfg(test)]
mod tests {
    use super::https_endpoint;

    #[test]
    fn base_config_requires_version_bound_signatures() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let updater: tauri_plugin_updater::Config =
            serde_json::from_value(config["plugins"]["updater"].clone()).unwrap();
        assert!(updater.require_signed_version);
        assert!(updater.endpoints.is_empty());
        assert!(updater.pubkey.is_empty());
    }

    #[test]
    fn accepts_public_https_update_urls_only() {
        assert!(https_endpoint(
            "https://github.com/example/editor/releases/latest/download/latest.json"
        )
        .is_some());
        for invalid in [
            "http://example.com",
            "https://user@example.com",
            "https://user:pass@example.com",
            "https://example.com/#update",
            "file:///latest.json",
            "/latest.json",
        ] {
            assert!(https_endpoint(invalid).is_none(), "{invalid}");
        }
    }
}
