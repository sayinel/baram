// §71 스냅샷 파일 I/O — 생성, 복원, 삭제, 체크섬

use super::index::{add_entry, find_entry, load_index, save_index};
use super::policy::enforce_policy;
use super::{SnapshotEntry, SnapshotError, SnapshotFileEntry};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

/// Default max snapshot count for retention policy.
const DEFAULT_MAX_COUNT: usize = 50;

/// Get the data directory for a snapshot by its ID.
pub(crate) fn snapshot_data_dir(vault_path: &str, snapshot_id: &str) -> PathBuf {
    Path::new(vault_path)
        .join(".baram")
        .join("snapshots")
        .join("data")
        .join(snapshot_id)
}

/// Ensure .baram/snapshots/data/ directories exist.
fn ensure_snapshot_dirs(vault_path: &str) -> Result<(), SnapshotError> {
    let data_dir = Path::new(vault_path)
        .join(".baram")
        .join("snapshots")
        .join("data");
    std::fs::create_dir_all(&data_dir)?;
    Ok(())
}

/// Compute SHA-256 checksum of a file. Returns "sha256:{hex}".
pub fn compute_checksum(path: &str) -> Result<String, SnapshotError> {
    let content = std::fs::read(path)?;
    let mut hasher = Sha256::new();
    hasher.update(&content);
    let result = hasher.finalize();
    Ok(format!("sha256:{:x}", result))
}

/// Generate a filesystem-safe ISO 8601 timestamp (uses `-` instead of `:`).
fn make_timestamp() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let secs = now.as_secs();

    // Convert to date-time components (UTC)
    let days = secs / 86400;
    let time_of_day = secs % 86400;
    let hours = time_of_day / 3600;
    let minutes = (time_of_day % 3600) / 60;
    let seconds = time_of_day % 60;

    // Simple date calculation from Unix epoch (1970-01-01)
    let (year, month, day) = days_to_date(days);

    format!(
        "{:04}-{:02}-{:02}T{:02}-{:02}-{:02}",
        year, month, day, hours, minutes, seconds
    )
}

/// Convert days since Unix epoch to (year, month, day).
/// Public for tests in sibling modules.
pub(crate) fn days_to_date(days: u64) -> (u64, u64, u64) {
    // Algorithm from https://howardhinnant.github.io/date_algorithms.html
    let z = days + 719468;
    let era = z / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y, m, d)
}

/// Scan vault for .md files, returning (relative_path, absolute_path) pairs.
fn scan_md_files(vault_path: &str) -> Result<Vec<(String, PathBuf)>, SnapshotError> {
    let vault = Path::new(vault_path);
    let mut files = Vec::new();
    scan_dir_recursive(vault, vault, &mut files)?;
    Ok(files)
}

fn scan_dir_recursive(
    base: &Path,
    dir: &Path,
    files: &mut Vec<(String, PathBuf)>,
) -> Result<(), SnapshotError> {
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => return Ok(()),
        Err(e) => return Err(SnapshotError::IoError(e)),
    };

    for entry in entries {
        let entry = entry?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();

        // Skip hidden dirs/files and common heavy dirs
        if name.starts_with('.') {
            continue;
        }
        const SKIP_DIRS: &[&str] = &[
            "node_modules",
            "target",
            "build",
            "dist",
            "__pycache__",
            ".next",
        ];
        if path.is_dir() && SKIP_DIRS.contains(&name.as_str()) {
            continue;
        }

        if path.is_dir() {
            scan_dir_recursive(base, &path, files)?;
        } else if path.extension().and_then(|e| e.to_str()) == Some("md") {
            let rel = path
                .strip_prefix(base)
                .unwrap_or(&path)
                .to_string_lossy()
                .to_string();
            files.push((rel, path));
        }
    }
    Ok(())
}

/// Create a snapshot of the vault.
///
/// 1. Scan vault for .md files
/// 2. Compute SHA-256 checksums
/// 3. Compare with last snapshot to find changed files
/// 4. Copy changed files to .baram/snapshots/data/{snapshot_id}/
/// 5. Generate snapshot ID
/// 6. Update index
/// 7. Run retention policy
/// 8. Return snapshot_id
pub fn create_snapshot(
    vault_path: &str,
    snapshot_type: &str,
    label: Option<String>,
) -> Result<String, SnapshotError> {
    ensure_snapshot_dirs(vault_path)?;

    let timestamp = make_timestamp();
    let snapshot_id = format!("snap-{}", &uuid::Uuid::new_v4().to_string()[..8]);

    // Scan .md files
    let md_files = scan_md_files(vault_path)?;

    // Load current index to compare with last snapshot
    let mut index = load_index(vault_path)?;
    let last_checksums: std::collections::HashMap<String, String> = index
        .snapshots
        .last()
        .map(|last| {
            last.files
                .iter()
                .map(|f| (f.path.clone(), f.checksum.clone()))
                .collect()
        })
        .unwrap_or_default();

    // Compute checksums and find changed files
    let mut snapshot_files = Vec::new();
    let mut total_size: u64 = 0;
    let data_dir = snapshot_data_dir(vault_path, &snapshot_id);

    for (rel_path, abs_path) in &md_files {
        let abs_str = abs_path.to_string_lossy().to_string();
        let checksum = compute_checksum(&abs_str)?;
        let metadata = std::fs::metadata(abs_path)?;
        let size = metadata.len();

        // Check if file changed since last snapshot
        let changed = last_checksums
            .get(rel_path)
            .map(|old_cs| old_cs != &checksum)
            .unwrap_or(true); // new file = changed

        if changed {
            // Copy to snapshot data dir, preserving relative path structure
            let dest = data_dir.join(rel_path);
            if let Some(parent) = dest.parent() {
                std::fs::create_dir_all(parent)?;
            }
            std::fs::copy(abs_path, &dest)?;
        }

        snapshot_files.push(SnapshotFileEntry {
            path: rel_path.clone(),
            checksum,
            size_bytes: size,
        });
        total_size += size;
    }

    let entry = SnapshotEntry {
        id: snapshot_id.clone(),
        timestamp,
        snapshot_type: snapshot_type.to_string(),
        label,
        files: snapshot_files,
        total_size_bytes: total_size,
    };

    add_entry(&mut index, entry);
    save_index(vault_path, &index)?;

    // Run retention policy
    let _ = enforce_policy(vault_path, &mut index, DEFAULT_MAX_COUNT);
    // Save again after policy enforcement
    save_index(vault_path, &index)?;

    Ok(snapshot_id)
}

/// Restore files from a snapshot.
///
/// 1. Create auto snapshot of current state first
/// 2. For each file to restore, find the snapshot data file and copy back
/// 3. If file isn't directly in this snapshot's data dir, walk backwards
///    through older snapshots to find the most recent version
pub fn restore_files(
    vault_path: &str,
    snapshot_id: &str,
    files: Option<Vec<String>>,
) -> Result<(), SnapshotError> {
    let index = load_index(vault_path)?;

    let entry = find_entry(&index, snapshot_id)
        .ok_or_else(|| SnapshotError::NotFound(snapshot_id.to_string()))?
        .clone();

    // Determine which files to restore
    let files_to_restore: Vec<String> = match files {
        Some(f) => f,
        None => entry.files.iter().map(|f| f.path.clone()).collect(),
    };

    // Create auto snapshot of current state before restoring
    let _ = create_snapshot(vault_path, "auto", Some("Pre-restore backup".to_string()));

    // Reload index after creating backup snapshot
    let index = load_index(vault_path)?;

    // Find target snapshot position
    let target_idx = index
        .snapshots
        .iter()
        .position(|e| e.id == snapshot_id)
        .ok_or_else(|| SnapshotError::NotFound(snapshot_id.to_string()))?;

    let vault = Path::new(vault_path);

    for file_path in &files_to_restore {
        // Walk backwards from the target snapshot to find the file data
        let mut restored = false;
        for i in (0..=target_idx).rev() {
            let snap = &index.snapshots[i];
            // Check if this snapshot has the file in its manifest
            if snap.files.iter().any(|f| &f.path == file_path) {
                let data_file = snapshot_data_dir(vault_path, &snap.id).join(file_path);
                if data_file.exists() {
                    let dest = vault.join(file_path);
                    if let Some(parent) = dest.parent() {
                        std::fs::create_dir_all(parent)?;
                    }
                    std::fs::copy(&data_file, &dest)?;
                    restored = true;
                    break;
                }
            }
        }

        if !restored {
            return Err(SnapshotError::General(format!(
                "파일을 복원할 수 없습니다: {}",
                file_path
            )));
        }
    }

    Ok(())
}

/// Delete snapshot data directory.
pub fn delete_snapshot_data(
    vault_path: &str,
    snapshot_id: &str,
    _timestamp: &str,
) -> Result<(), SnapshotError> {
    let data_dir = snapshot_data_dir(vault_path, snapshot_id);
    if data_dir.exists() {
        std::fs::remove_dir_all(&data_dir)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn setup_vault(tmp: &TempDir) -> String {
        let vault = tmp.path().to_string_lossy().to_string();
        // Create some .md files
        std::fs::write(tmp.path().join("hello.md"), "# Hello\n\nWorld").unwrap();
        std::fs::write(tmp.path().join("notes.md"), "# Notes\n\n- Item 1").unwrap();
        // Create a subdirectory with a file
        std::fs::create_dir_all(tmp.path().join("subdir")).unwrap();
        std::fs::write(
            tmp.path().join("subdir").join("deep.md"),
            "# Deep\n\nNested content",
        )
        .unwrap();
        vault
    }

    #[test]
    fn test_compute_checksum() {
        let tmp = TempDir::new().unwrap();
        let file_path = tmp.path().join("test.md");
        std::fs::write(&file_path, "hello world").unwrap();

        let checksum = compute_checksum(&file_path.to_string_lossy()).unwrap();
        assert!(checksum.starts_with("sha256:"));
        assert_eq!(checksum.len(), 7 + 64); // "sha256:" + 64 hex chars
    }

    #[test]
    fn test_compute_checksum_deterministic() {
        let tmp = TempDir::new().unwrap();
        let file_path = tmp.path().join("test.md");
        std::fs::write(&file_path, "hello world").unwrap();

        let cs1 = compute_checksum(&file_path.to_string_lossy()).unwrap();
        let cs2 = compute_checksum(&file_path.to_string_lossy()).unwrap();
        assert_eq!(cs1, cs2);
    }

    #[test]
    fn test_create_snapshot() {
        let tmp = TempDir::new().unwrap();
        let vault = setup_vault(&tmp);

        let snap_id = create_snapshot(&vault, "auto", None).unwrap();
        assert!(snap_id.starts_with("snap-"));
        assert_eq!(snap_id.len(), 13); // "snap-" + 8 hex chars

        // Verify index was created
        let index = load_index(&vault).unwrap();
        assert_eq!(index.snapshots.len(), 1);
        assert_eq!(index.snapshots[0].id, snap_id);
        assert_eq!(index.snapshots[0].snapshot_type, "auto");
        assert_eq!(index.snapshots[0].files.len(), 3);
        assert!(index.snapshots[0].total_size_bytes > 0);

        // Verify data directory was created with files (keyed by snapshot ID)
        let data_dir = snapshot_data_dir(&vault, &snap_id);
        assert!(data_dir.exists());
        assert!(data_dir.join("hello.md").exists());
        assert!(data_dir.join("notes.md").exists());
        assert!(data_dir.join("subdir").join("deep.md").exists());
    }

    #[test]
    fn test_create_snapshot_only_copies_changed_files() {
        let tmp = TempDir::new().unwrap();
        let vault = setup_vault(&tmp);

        // First snapshot — all files are new, so all get copied
        let snap1 = create_snapshot(&vault, "auto", None).unwrap();

        // Modify only one file
        std::fs::write(tmp.path().join("hello.md"), "# Hello Updated\n\nNew").unwrap();

        // Second snapshot — only hello.md changed
        let snap2 = create_snapshot(&vault, "auto", None).unwrap();

        let index = load_index(&vault).unwrap();
        assert_eq!(index.snapshots.len(), 2);

        // Data dirs are keyed by snapshot ID — guaranteed unique
        let data_dir1 = snapshot_data_dir(&vault, &snap1);
        let data_dir2 = snapshot_data_dir(&vault, &snap2);
        assert_ne!(data_dir1, data_dir2);

        // Only hello.md should be in the second snapshot's data dir
        assert!(data_dir2.join("hello.md").exists());
        assert!(!data_dir2.join("notes.md").exists());
        assert!(!data_dir2.join("subdir").join("deep.md").exists());
    }

    #[test]
    fn test_create_snapshot_manual_with_label() {
        let tmp = TempDir::new().unwrap();
        let vault = setup_vault(&tmp);

        let snap_id = create_snapshot(&vault, "manual", Some("v1.0 release".to_string())).unwrap();

        let index = load_index(&vault).unwrap();
        let entry = find_entry(&index, &snap_id).unwrap();
        assert_eq!(entry.snapshot_type, "manual");
        assert_eq!(entry.label.as_deref(), Some("v1.0 release"));
    }

    #[test]
    fn test_restore_files() {
        let tmp = TempDir::new().unwrap();
        let vault = setup_vault(&tmp);

        // Create snapshot
        let snap_id = create_snapshot(&vault, "auto", None).unwrap();

        // Modify the file
        std::fs::write(tmp.path().join("hello.md"), "# Modified content").unwrap();
        assert_eq!(
            std::fs::read_to_string(tmp.path().join("hello.md")).unwrap(),
            "# Modified content"
        );

        // Restore from snapshot
        restore_files(&vault, &snap_id, Some(vec!["hello.md".to_string()])).unwrap();

        // Verify the file is restored
        assert_eq!(
            std::fs::read_to_string(tmp.path().join("hello.md")).unwrap(),
            "# Hello\n\nWorld"
        );
    }

    #[test]
    fn test_delete_snapshot_data() {
        let tmp = TempDir::new().unwrap();
        let vault = setup_vault(&tmp);

        let snap_id = create_snapshot(&vault, "auto", None).unwrap();

        let data_dir = snapshot_data_dir(&vault, &snap_id);
        assert!(data_dir.exists());

        delete_snapshot_data(&vault, &snap_id, "unused").unwrap();
        assert!(!data_dir.exists());
    }

    #[test]
    fn test_make_timestamp_format() {
        let ts = make_timestamp();
        // Should match pattern: YYYY-MM-DDTHH-MM-SS (19 chars)
        assert_eq!(ts.len(), 19);
        assert_eq!(&ts[4..5], "-");
        assert_eq!(&ts[7..8], "-");
        assert_eq!(&ts[10..11], "T");
        assert_eq!(&ts[13..14], "-");
        assert_eq!(&ts[16..17], "-");
        // Should not contain colons (filesystem safe)
        assert!(!ts.contains(':'));
    }

    #[test]
    fn test_scan_md_files() {
        let tmp = TempDir::new().unwrap();
        let vault = setup_vault(&tmp);

        let files = scan_md_files(&vault).unwrap();
        let paths: Vec<&str> = files.iter().map(|(p, _)| p.as_str()).collect();
        assert!(paths.contains(&"hello.md"));
        assert!(paths.contains(&"notes.md"));
        // subdir/deep.md — path separator may vary
        assert!(files.iter().any(|(p, _)| p.ends_with("deep.md")));
        assert_eq!(files.len(), 3);
    }

    #[test]
    fn test_scan_skips_hidden_and_heavy_dirs() {
        let tmp = TempDir::new().unwrap();
        let vault = setup_vault(&tmp);

        // Create hidden and heavy dirs
        std::fs::create_dir_all(tmp.path().join(".hidden")).unwrap();
        std::fs::write(tmp.path().join(".hidden").join("secret.md"), "secret").unwrap();
        std::fs::create_dir_all(tmp.path().join("node_modules")).unwrap();
        std::fs::write(tmp.path().join("node_modules").join("pkg.md"), "package").unwrap();

        let files = scan_md_files(&vault).unwrap();
        assert_eq!(files.len(), 3); // Only original 3 files
    }
}
