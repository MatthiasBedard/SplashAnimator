use crate::{authorized, err, relative, Projects, Result};
use std::{
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{
    ipc::{InvokeBody, Request, Response},
    Manager, State, WebviewWindow,
};

const MAX_WAV_BYTES: usize = 64 * 1024 * 1024;
const MAX_OWNER_BYTES: usize = 128 * 1024;
static AUDIO_FILE_TRANSFER: Mutex<()> = Mutex::new(());

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AudioOwner {
    project: String,
    path: String,
}

fn main_editor(window: &WebviewWindow) -> Result<()> {
    let url = window.url().map_err(err)?;
    let origin = url.origin();
    if window.label() == "main"
        && (matches!(
            origin.ascii_serialization().as_str(),
            "http://tauri.localhost" | "https://tauri.localhost"
        ) || (url.scheme() == "tauri" && url.host_str() == Some("localhost"))
            || (tauri::is_dev()
                && window
                    .app_handle()
                    .config()
                    .build
                    .dev_url
                    .as_ref()
                    .is_some_and(|url| url.origin() == origin)))
    {
        Ok(())
    } else {
        Err("Project audio storage belongs to the main editor.".into())
    }
}

fn asset_path(root: &Path, name: &str) -> Result<PathBuf> {
    let stem = name
        .strip_prefix("assets/audio/")
        .and_then(|name| name.strip_suffix(".wav"))
        .filter(|name| {
            !name.is_empty()
                && name.len() <= 200
                && name
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || b"_-".contains(&byte))
        })
        .ok_or("Invalid project WAV asset path.")?;
    let device = stem.to_ascii_uppercase();
    if matches!(device.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (device.len() == 4
            && (device.starts_with("COM") || device.starts_with("LPT"))
            && matches!(device.as_bytes()[3], b'0'..=b'9'))
    {
        return Err("Invalid project WAV asset path.".into());
    }
    if !relative(root, "project.json")?.is_file() {
        return Err("Save the project before storing audio.".into());
    }
    let path = relative(root, name)?;
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        for candidate in [root.join("assets"), root.join("assets/audio"), path.clone()] {
            match fs::symlink_metadata(candidate) {
                Ok(metadata) if metadata.file_attributes() & 0x400 != 0 => {
                    return Err("Linked audio paths are not allowed.".into());
                }
                Err(error) if error.kind() != std::io::ErrorKind::NotFound => {
                    return Err(err(error));
                }
                _ => {}
            }
        }
    }
    Ok(path)
}

fn validate_wav(bytes: &[u8]) -> Result<()> {
    if !(12..=MAX_WAV_BYTES).contains(&bytes.len())
        || &bytes[..4] != b"RIFF"
        || &bytes[8..12] != b"WAVE"
        || bytes[4..8] != ((bytes.len() - 8) as u32).to_le_bytes()
    {
        return Err("Audio asset is missing or has an invalid WAV length or header.".into());
    }
    Ok(())
}

fn write_audio(root: &Path, name: &str, bytes: &[u8], check_folder: impl FnOnce() -> Result<()>) -> Result<()> {
    validate_wav(bytes)?;
    let path = asset_path(root, name)?;
    crate::save_publication::write_component(root, &path, |staged| staged.write_all(bytes), || {
        check_folder()?;
        asset_path(root, name)?;
        Ok(())
    })
}

fn read_audio(root: &Path, name: &str) -> Result<Vec<u8>> {
    let file = File::open(asset_path(root, name)?).map_err(err)?;
    let metadata = file.metadata().map_err(err)?;
    let size = metadata.len();
    if !metadata.is_file() || !(12..=MAX_WAV_BYTES as u64).contains(&size) {
        return Err("Audio asset is missing or exceeds the WAV byte limit.".into());
    }
    let mut data = Vec::with_capacity(size as usize);
    file.take(size + 1).read_to_end(&mut data).map_err(err)?;
    if data.len() as u64 != size {
        return Err("Audio asset changed during reading.".into());
    }
    validate_wav(&data)?;
    Ok(data)
}

fn split_upload(body: &[u8]) -> Result<(AudioOwner, &[u8])> {
    let header: [u8; 4] = body
        .get(..4)
        .and_then(|bytes| bytes.try_into().ok())
        .ok_or("Missing audio upload owner.")?;
    let size = u32::from_le_bytes(header) as usize;
    if size == 0
        || size > MAX_OWNER_BYTES
        || body.len() < 4 + size
        || body.len() - 4 - size > MAX_WAV_BYTES
    {
        return Err("Invalid audio upload owner.".into());
    }
    let owner = serde_json::from_slice(&body[4..4 + size]).map_err(err)?;
    Ok((owner, &body[4 + size..]))
}

#[tauri::command]
pub async fn project_audio_read(
    window: WebviewWindow,
    state: State<'_, Projects>,
    owner: AudioOwner,
) -> Result<Response> {
    main_editor(&window)?;
    let folder = authorized(&state, &owner.project)?;
    let bytes = tauri::async_runtime::spawn_blocking(move || {
        let _transfer = AUDIO_FILE_TRANSFER
            .try_lock()
            .map_err(|_| "Another audio transfer is in progress.")?;
        folder.verify()?;
        let bytes = read_audio(&folder.root, &owner.path)?;
        folder.verify()?;
        Ok::<_, String>(bytes)
    })
    .await
    .map_err(err)??;
    Ok(Response::new(bytes))
}

#[tauri::command]
pub async fn project_audio_write(
    window: WebviewWindow,
    state: State<'_, Projects>,
    request: Request<'_>,
) -> Result<()> {
    main_editor(&window)?;
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("Expected a binary audio upload.".into());
    };
    let (owner, wav) = split_upload(bytes)?;
    let folder = authorized(&state, &owner.project)?;
    let _transfer = AUDIO_FILE_TRANSFER
        .try_lock()
        .map_err(|_| "Another audio transfer is in progress.")?;
    write_audio(&folder.root, &owner.path, wav, || folder.verify())
}

#[cfg(test)]
mod tests {
    use super::*;

    const WAV_HEADER: &[u8] = b"RIFF\x04\0\0\0WAVE";

    #[test]
    fn round_trips_owned_bytes_and_preserves_existing_assets() {
        let root = tempfile::tempdir().unwrap();
        let name = "assets/audio/track_1.wav";
        assert!(write_audio(root.path(), name, WAV_HEADER, || Ok(())).is_err());
        fs::write(root.path().join("project.json"), "{}").unwrap();
        write_audio(root.path(), name, WAV_HEADER, || Ok(())).unwrap();
        let replacement = b"RIFF\x05\0\0\0WAVE\x01";
        assert!(write_audio(root.path(), name, replacement, || Ok(())).is_err());
        assert_eq!(read_audio(root.path(), name).unwrap(), WAV_HEADER);
        assert_eq!(
            fs::read_dir(root.path().join("assets/audio"))
                .unwrap()
                .count(),
            1
        );
        for name in [
            "assets/audio/../else.wav",
            "assets/audio/NUL.wav",
            "assets/audio/other.mp3",
        ] {
            assert!(write_audio(root.path(), name, WAV_HEADER, || Ok(())).is_err());
        }
        assert!(write_audio(
            root.path(),
            "assets/audio/truncated.wav",
            &replacement[..12],
            || Ok(())
        )
        .is_err());
    }

    #[test]
    fn accepts_unicode_project_owners_and_rejects_incomplete_envelopes() {
        let owner = r#"{"project":"Cours d'été.spl","path":"assets/audio/track.wav"}"#;
        let mut bytes = (owner.len() as u32).to_le_bytes().to_vec();
        bytes.extend_from_slice(owner.as_bytes());
        bytes.extend_from_slice(WAV_HEADER);
        let (actual, payload) = split_upload(&bytes).unwrap();
        assert_eq!(actual.project, "Cours d'été.spl");
        assert_eq!(actual.path, "assets/audio/track.wav");
        assert_eq!(payload, WAV_HEADER);
        assert!(split_upload(&bytes[..8]).is_err());
        bytes[..4].copy_from_slice(&u32::MAX.to_le_bytes());
        assert!(split_upload(&bytes).is_err());
    }
}
