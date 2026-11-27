use crate::{err, matches_native_file, no_links, Result};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use std::{
    io::Write,
    path::{Path, PathBuf},
};

pub fn extension(format: &str) -> Result<&str> {
    match format {
        "gif" | "png" | "jpg" | "bmp" | "tiff" | "svg" | "eps" => Ok(format),
        _ => Err("Unsupported single-frame export format.".into()),
    }
}

pub fn save(selection: &Path, format: &str, encoded: &str) -> Result<PathBuf> {
    let extension = extension(format)?;
    let appended = selection.extension().is_none();
    let file = if appended {
        selection.with_extension(extension)
    } else {
        selection.to_path_buf()
    };
    if !file
        .extension()
        .and_then(|value| value.to_str())
        .is_some_and(|value| value.eq_ignore_ascii_case(extension))
    {
        return Err(format!("Choose a .{extension} filename."));
    }
    no_links(&file)?;
    if file.ancestors().skip(1).any(|path| {
        path.extension()
            .and_then(|value| value.to_str())
            .is_some_and(|value| value.eq_ignore_ascii_case("spl"))
    }) {
        return Err("Choose an export location outside any .spl folder.".into());
    }
    if encoded.len() > 384 * 1024 * 1024 {
        return Err("Single-frame export exceeds the desktop output limit.".into());
    }
    let parent = file.parent().ok_or("Invalid export location.")?;
    let identity = same_file::Handle::from_path(parent).map_err(err)?;
    let bytes = STANDARD.decode(encoded).map_err(err)?;
    if bytes.is_empty() {
        return Err("The exported frame is empty.".into());
    }
    let mut staged = tempfile::NamedTempFile::new_in(parent).map_err(err)?;
    staged.write_all(&bytes).map_err(err)?;
    staged.as_file().sync_all().map_err(err)?;
    no_links(&file)?;
    if !matches_native_file(parent, &identity) {
        return Err("The destination folder moved during export.".into());
    }
    if appended {
        // The chooser confirmed the extensionless path, so never replace an
        // existing file at the new path that we derived from it.
        staged.persist_noclobber(&file).map_err(err)?;
    } else {
        staged.persist(&file).map_err(err)?;
    }
    Ok(file)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn writes_binary_bytes_and_preserves_an_unconfirmed_destination() {
        let root = tempfile::tempdir().unwrap();
        let selection = root.path().join("art");
        let file = save(&selection, "tiff", "AAEC/w==").unwrap();
        assert_eq!(file, selection.with_extension("tiff"));
        assert_eq!(fs::read(&file).unwrap(), [0, 1, 2, 255]);
        assert!(save(&selection, "tiff", "AA==").is_err());
        assert!(save(&file, "bmp", "AA==").is_err());
        assert_eq!(fs::read(&file).unwrap(), [0, 1, 2, 255]);
    }
}
