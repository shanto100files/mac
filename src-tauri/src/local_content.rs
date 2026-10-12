use serde::Serialize;
use std::path::Path;

#[derive(Serialize)]
pub struct LocalEntry {
    uri: String,
    name: String,
    directory: bool,
}

fn list_directory(path: &Path) -> Result<Vec<LocalEntry>, String> {
    let entries = std::fs::read_dir(path)
        .map_err(|error| format!("Cannot read folder {}: {error}", path.display()))?;
    let mut result = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|error| error.to_string())?;
        let kind = entry.file_type().map_err(|error| error.to_string())?;
        // Do not follow directory symlinks/junctions into loops or other roots.
        if !kind.is_dir() && !kind.is_file() {
            continue;
        }
        result.push(LocalEntry {
            uri: entry.path().to_string_lossy().into_owned(),
            name: entry.file_name().to_string_lossy().into_owned(),
            directory: kind.is_dir(),
        });
    }
    Ok(result)
}

#[tauri::command]
pub async fn list_local_directory(path: String) -> Result<Vec<LocalEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || list_directory(Path::new(&path)))
        .await
        .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_folder_is_an_error() {
        let path = std::env::temp_dir().join(format!("vega-missing-{}", std::process::id()));
        assert!(list_directory(&path).is_err());
    }

    #[test]
    fn lists_files_and_folders_with_full_paths() {
        let path = std::env::temp_dir().join(format!("vega-local-test-{}", std::process::id()));
        std::fs::create_dir_all(path.join("Season 01")).unwrap();
        std::fs::write(path.join("Movie.mkv"), b"video").unwrap();
        let entries = list_directory(&path).unwrap();
        assert!(entries.iter().any(|entry| entry.name == "Season 01" && entry.directory));
        assert!(entries.iter().any(|entry| entry.name == "Movie.mkv" && !entry.directory
            && Path::new(&entry.uri) == path.join("Movie.mkv")));
        std::fs::remove_file(path.join("Movie.mkv")).unwrap();
        std::fs::remove_dir(path.join("Season 01")).unwrap();
        std::fs::remove_dir(path).unwrap();
    }
}
