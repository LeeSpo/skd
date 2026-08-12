use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveItemInput {
    pub name: String,
    pub path: String,
    pub is_directory: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveItemsRequest {
    pub mode: String,
    pub connection_id: Option<String>,
    pub target_directory: String,
    pub items: Vec<MoveItemInput>,
    pub overwrite: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveItemResult {
    pub name: String,
    pub success: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveItemsResponse {
    pub conflicts: Vec<String>,
    pub results: Vec<MoveItemResult>,
}

pub fn validate_move_request(request: &MoveItemsRequest) -> Result<(), String> {
    if request.mode != "local" && request.mode != "remote" {
        return Err("mode must be 'local' or 'remote'".into());
    }
    if request.mode == "remote" && request.connection_id.as_deref().unwrap_or("").is_empty() {
        return Err("connectionId is required for remote moves".into());
    }
    if request.items.is_empty() {
        return Err("at least one item is required".into());
    }
    if request.target_directory.is_empty() {
        return Err("targetDirectory is required".into());
    }

    let mut names = HashSet::new();
    for item in &request.items {
        if item.name.is_empty()
            || item.name == "."
            || item.name == ".."
            || item.name.contains('/')
            || item.name.contains('\\')
        {
            return Err(format!("invalid item name: {}", item.name));
        }
        if item.path.is_empty() || !names.insert(item.name.clone()) {
            return Err(format!("invalid or duplicate item: {}", item.name));
        }
        let target_directory = Path::new(&request.target_directory);
        let source = Path::new(&item.path);
        let destination = target_directory.join(&item.name);
        if destination == source
            || (item.is_directory
                && (target_directory == source || target_directory.starts_with(source)))
        {
            return Err(format!("cannot move {} into itself", item.name));
        }
    }
    Ok(())
}

pub fn move_local_items(request: &MoveItemsRequest) -> Result<MoveItemsResponse, String> {
    validate_move_request(request)?;
    let target = Path::new(&request.target_directory);
    if !target.is_dir() {
        return Err("targetDirectory is not a directory".into());
    }

    let conflicts = request
        .items
        .iter()
        .filter(|item| path_exists(&target.join(&item.name)))
        .map(|item| item.name.clone())
        .collect::<Vec<_>>();
    if !request.overwrite && !conflicts.is_empty() {
        return Ok(MoveItemsResponse {
            conflicts,
            results: Vec::new(),
        });
    }

    let results = request
        .items
        .iter()
        .enumerate()
        .map(|(index, item)| move_one_local_item(item, target, request.overwrite, index))
        .collect();

    Ok(MoveItemsResponse {
        conflicts: Vec::new(),
        results,
    })
}

fn move_one_local_item(
    item: &MoveItemInput,
    target_directory: &Path,
    overwrite: bool,
    index: usize,
) -> MoveItemResult {
    let source = Path::new(&item.path);
    let destination = target_directory.join(&item.name);
    let mut backup: Option<PathBuf> = None;

    if overwrite && path_exists(&destination) {
        let backup_path = unique_backup_path(target_directory, &item.name, index);
        if let Err(error) = std::fs::rename(&destination, &backup_path) {
            return failed_result(item, format!("failed to preserve existing target: {error}"));
        }
        backup = Some(backup_path);
    }

    if let Err(error) = std::fs::rename(source, &destination) {
        if let Some(backup_path) = &backup {
            let _ = std::fs::rename(backup_path, &destination);
        }
        return failed_result(item, error.to_string());
    }

    if let Some(backup_path) = backup {
        if let Err(error) = remove_path(&backup_path) {
            return failed_result(item, format!("moved, but failed to remove backup: {error}"));
        }
    }

    MoveItemResult {
        name: item.name.clone(),
        success: true,
        error: None,
    }
}

fn failed_result(item: &MoveItemInput, error: String) -> MoveItemResult {
    MoveItemResult {
        name: item.name.clone(),
        success: false,
        error: Some(error),
    }
}

fn unique_backup_path(target_directory: &Path, name: &str, index: usize) -> PathBuf {
    let process = std::process::id();
    let mut attempt = 0usize;
    loop {
        let candidate = target_directory.join(format!(
            ".skd-move-backup-{process}-{index}-{attempt}-{name}"
        ));
        if !path_exists(&candidate) {
            return candidate;
        }
        attempt += 1;
    }
}

fn remove_path(path: &Path) -> std::io::Result<()> {
    if path.symlink_metadata()?.file_type().is_dir() {
        std::fs::remove_dir_all(path)
    } else {
        std::fs::remove_file(path)
    }
}

fn path_exists(path: &Path) -> bool {
    path.symlink_metadata().is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn preflight_reports_all_conflicts_without_moving_any_source() {
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("source");
        let target = temp.path().join("target");
        fs::create_dir_all(&source).unwrap();
        fs::create_dir_all(&target).unwrap();
        fs::write(source.join("alpha.txt"), "new alpha").unwrap();
        fs::write(source.join("bravo.txt"), "new bravo").unwrap();
        fs::write(target.join("alpha.txt"), "old alpha").unwrap();

        let request = MoveItemsRequest {
            mode: "local".into(),
            connection_id: None,
            target_directory: target.to_string_lossy().into_owned(),
            items: vec!["alpha.txt", "bravo.txt"]
                .into_iter()
                .map(|name| MoveItemInput {
                    name: name.into(),
                    path: source.join(name).to_string_lossy().into_owned(),
                    is_directory: false,
                })
                .collect(),
            overwrite: false,
        };

        let response = move_local_items(&request).unwrap();

        assert_eq!(response.conflicts, vec!["alpha.txt"]);
        assert!(response.results.is_empty());
        assert_eq!(
            fs::read_to_string(source.join("alpha.txt")).unwrap(),
            "new alpha"
        );
        assert_eq!(
            fs::read_to_string(source.join("bravo.txt")).unwrap(),
            "new bravo"
        );
        assert_eq!(
            fs::read_to_string(target.join("alpha.txt")).unwrap(),
            "old alpha"
        );
    }

    #[test]
    fn overwrite_replaces_conflicts_and_moves_the_whole_batch() {
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("source");
        let target = temp.path().join("target");
        fs::create_dir_all(&source).unwrap();
        fs::create_dir_all(&target).unwrap();
        fs::write(source.join("alpha.txt"), "new alpha").unwrap();
        fs::write(source.join("bravo.txt"), "new bravo").unwrap();
        fs::write(target.join("alpha.txt"), "old alpha").unwrap();

        let request = MoveItemsRequest {
            mode: "local".into(),
            connection_id: None,
            target_directory: target.to_string_lossy().into_owned(),
            items: vec!["alpha.txt", "bravo.txt"]
                .into_iter()
                .map(|name| MoveItemInput {
                    name: name.into(),
                    path: source.join(name).to_string_lossy().into_owned(),
                    is_directory: false,
                })
                .collect(),
            overwrite: true,
        };

        let response = move_local_items(&request).unwrap();

        assert!(response.conflicts.is_empty());
        assert!(response.results.iter().all(|result| result.success));
        assert_eq!(
            fs::read_to_string(target.join("alpha.txt")).unwrap(),
            "new alpha"
        );
        assert_eq!(
            fs::read_to_string(target.join("bravo.txt")).unwrap(),
            "new bravo"
        );
        assert!(!source.join("alpha.txt").exists());
        assert!(!source.join("bravo.txt").exists());
    }

    #[test]
    fn overwrite_restores_the_existing_target_when_the_source_move_fails() {
        let temp = tempfile::tempdir().unwrap();
        let target = temp.path().join("target");
        fs::create_dir_all(&target).unwrap();
        fs::write(target.join("missing.txt"), "keep me").unwrap();
        let request = MoveItemsRequest {
            mode: "local".into(),
            connection_id: None,
            target_directory: target.to_string_lossy().into_owned(),
            items: vec![MoveItemInput {
                name: "missing.txt".into(),
                path: temp
                    .path()
                    .join("missing.txt")
                    .to_string_lossy()
                    .into_owned(),
                is_directory: false,
            }],
            overwrite: true,
        };

        let response = move_local_items(&request).unwrap();

        assert!(!response.results[0].success);
        assert_eq!(
            fs::read_to_string(target.join("missing.txt")).unwrap(),
            "keep me"
        );
    }

    #[test]
    fn reports_partial_failures_without_undoing_successful_items() {
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("source");
        let target = temp.path().join("target");
        fs::create_dir_all(&source).unwrap();
        fs::create_dir_all(&target).unwrap();
        fs::write(source.join("alpha.txt"), "alpha").unwrap();

        let request = MoveItemsRequest {
            mode: "local".into(),
            connection_id: None,
            target_directory: target.to_string_lossy().into_owned(),
            items: vec![
                MoveItemInput {
                    name: "alpha.txt".into(),
                    path: source.join("alpha.txt").to_string_lossy().into_owned(),
                    is_directory: false,
                },
                MoveItemInput {
                    name: "missing.txt".into(),
                    path: source.join("missing.txt").to_string_lossy().into_owned(),
                    is_directory: false,
                },
            ],
            overwrite: false,
        };

        let response = move_local_items(&request).unwrap();

        assert!(response.results[0].success);
        assert!(!response.results[1].success);
        assert_eq!(
            fs::read_to_string(target.join("alpha.txt")).unwrap(),
            "alpha"
        );
    }

    #[test]
    fn rejects_moving_a_directory_into_its_descendant() {
        let request = MoveItemsRequest {
            mode: "local".into(),
            connection_id: None,
            target_directory: "/tmp/project/child".into(),
            items: vec![MoveItemInput {
                name: "project".into(),
                path: "/tmp/project".into(),
                is_directory: true,
            }],
            overwrite: false,
        };

        assert!(validate_move_request(&request)
            .unwrap_err()
            .contains("itself"));
    }
}
