// §71 스냅샷 인덱스 관리 — .baram/snapshots/index.json 읽기/쓰기

use super::{SnapshotEntry, SnapshotError, SnapshotIndex};
use std::path::Path;

/// Load snapshot index from .baram/snapshots/index.json.
/// Creates an empty index if the file does not exist.
pub fn load_index(vault_path: &str) -> Result<SnapshotIndex, SnapshotError> {
    let index_path = Path::new(vault_path)
        .join(".baram")
        .join("snapshots")
        .join("index.json");

    if !index_path.exists() {
        return Ok(SnapshotIndex {
            version: 1,
            snapshots: Vec::new(),
            total_size_bytes: 0,
            oldest_snapshot: None,
            newest_snapshot: None,
        });
    }

    let content = std::fs::read_to_string(&index_path)?;
    let index: SnapshotIndex = serde_json::from_str(&content)?;
    Ok(index)
}

/// Save snapshot index atomically (write .tmp then rename).
pub fn save_index(vault_path: &str, index: &SnapshotIndex) -> Result<(), SnapshotError> {
    let dir = Path::new(vault_path)
        .join(".baram")
        .join("snapshots");
    std::fs::create_dir_all(&dir)?;

    let index_path = dir.join("index.json");
    let tmp_path = dir.join("index.json.tmp");

    let content = serde_json::to_string_pretty(index)?;
    std::fs::write(&tmp_path, &content)?;
    std::fs::rename(&tmp_path, &index_path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp_path);
        SnapshotError::IoError(e)
    })?;

    Ok(())
}

/// Add an entry to the index and update metadata.
pub fn add_entry(index: &mut SnapshotIndex, entry: SnapshotEntry) {
    index.total_size_bytes += entry.total_size_bytes;
    let ts = entry.timestamp.clone();

    index.snapshots.push(entry);

    // Update oldest/newest
    update_metadata(index);

    // If metadata didn't change (e.g. empty before), set from the new entry
    if index.newest_snapshot.is_none() {
        index.newest_snapshot = Some(ts.clone());
    }
    if index.oldest_snapshot.is_none() {
        index.oldest_snapshot = Some(ts);
    }
}

/// Remove an entry from the index by snapshot_id. Returns the removed entry if found.
pub fn remove_entry(
    index: &mut SnapshotIndex,
    snapshot_id: &str,
) -> Option<SnapshotEntry> {
    let pos = index.snapshots.iter().position(|e| e.id == snapshot_id)?;
    let removed = index.snapshots.remove(pos);
    index.total_size_bytes = index.total_size_bytes.saturating_sub(removed.total_size_bytes);
    update_metadata(index);
    Some(removed)
}

/// Find an entry by snapshot_id.
pub fn find_entry<'a>(
    index: &'a SnapshotIndex,
    snapshot_id: &str,
) -> Option<&'a SnapshotEntry> {
    index.snapshots.iter().find(|e| e.id == snapshot_id)
}

/// Find all snapshots that contain a given file path.
pub fn find_file_history<'a>(
    index: &'a SnapshotIndex,
    file_path: &str,
) -> Vec<&'a SnapshotEntry> {
    index
        .snapshots
        .iter()
        .filter(|e| e.files.iter().any(|f| f.path == file_path))
        .collect()
}

/// Recalculate oldest/newest snapshot timestamps from the entries.
fn update_metadata(index: &mut SnapshotIndex) {
    if index.snapshots.is_empty() {
        index.oldest_snapshot = None;
        index.newest_snapshot = None;
        index.total_size_bytes = 0;
        return;
    }

    // Timestamps are ISO 8601 strings — lexicographic sort works correctly
    index.oldest_snapshot = index
        .snapshots
        .iter()
        .map(|e| e.timestamp.clone())
        .min();
    index.newest_snapshot = index
        .snapshots
        .iter()
        .map(|e| e.timestamp.clone())
        .max();
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::snapshot::SnapshotFileEntry;
    use tempfile::TempDir;

    fn make_entry(id: &str, ts: &str, snap_type: &str, label: Option<&str>) -> SnapshotEntry {
        SnapshotEntry {
            id: id.to_string(),
            timestamp: ts.to_string(),
            snapshot_type: snap_type.to_string(),
            label: label.map(|s| s.to_string()),
            files: vec![SnapshotFileEntry {
                path: "test.md".to_string(),
                checksum: "sha256:abc123".to_string(),
                size_bytes: 100,
            }],
            total_size_bytes: 100,
        }
    }

    #[test]
    fn test_load_index_empty() {
        let tmp = TempDir::new().unwrap();
        let vault = tmp.path().to_string_lossy().to_string();
        let index = load_index(&vault).unwrap();
        assert_eq!(index.version, 1);
        assert!(index.snapshots.is_empty());
        assert_eq!(index.total_size_bytes, 0);
        assert!(index.oldest_snapshot.is_none());
        assert!(index.newest_snapshot.is_none());
    }

    #[test]
    fn test_save_and_load_index() {
        let tmp = TempDir::new().unwrap();
        let vault = tmp.path().to_string_lossy().to_string();

        let mut index = load_index(&vault).unwrap();
        let entry = make_entry("snap-001", "2026-03-07T10-00-00", "auto", None);
        add_entry(&mut index, entry);
        save_index(&vault, &index).unwrap();

        let loaded = load_index(&vault).unwrap();
        assert_eq!(loaded.snapshots.len(), 1);
        assert_eq!(loaded.snapshots[0].id, "snap-001");
        assert_eq!(loaded.total_size_bytes, 100);
    }

    #[test]
    fn test_add_entry_updates_metadata() {
        let mut index = SnapshotIndex {
            version: 1,
            snapshots: Vec::new(),
            total_size_bytes: 0,
            oldest_snapshot: None,
            newest_snapshot: None,
        };

        add_entry(
            &mut index,
            make_entry("snap-001", "2026-03-07T10-00-00", "auto", None),
        );
        assert_eq!(index.total_size_bytes, 100);
        assert_eq!(
            index.oldest_snapshot.as_deref(),
            Some("2026-03-07T10-00-00")
        );
        assert_eq!(
            index.newest_snapshot.as_deref(),
            Some("2026-03-07T10-00-00")
        );

        add_entry(
            &mut index,
            make_entry("snap-002", "2026-03-08T10-00-00", "manual", Some("release")),
        );
        assert_eq!(index.total_size_bytes, 200);
        assert_eq!(
            index.oldest_snapshot.as_deref(),
            Some("2026-03-07T10-00-00")
        );
        assert_eq!(
            index.newest_snapshot.as_deref(),
            Some("2026-03-08T10-00-00")
        );
    }

    #[test]
    fn test_remove_entry() {
        let mut index = SnapshotIndex {
            version: 1,
            snapshots: Vec::new(),
            total_size_bytes: 0,
            oldest_snapshot: None,
            newest_snapshot: None,
        };

        add_entry(
            &mut index,
            make_entry("snap-001", "2026-03-07T10-00-00", "auto", None),
        );
        add_entry(
            &mut index,
            make_entry("snap-002", "2026-03-08T10-00-00", "auto", None),
        );

        let removed = remove_entry(&mut index, "snap-001");
        assert!(removed.is_some());
        assert_eq!(removed.unwrap().id, "snap-001");
        assert_eq!(index.snapshots.len(), 1);
        assert_eq!(index.total_size_bytes, 100);
        assert_eq!(
            index.oldest_snapshot.as_deref(),
            Some("2026-03-08T10-00-00")
        );

        // Remove non-existent
        assert!(remove_entry(&mut index, "snap-999").is_none());
    }

    #[test]
    fn test_find_entry() {
        let mut index = SnapshotIndex {
            version: 1,
            snapshots: Vec::new(),
            total_size_bytes: 0,
            oldest_snapshot: None,
            newest_snapshot: None,
        };

        add_entry(
            &mut index,
            make_entry("snap-001", "2026-03-07T10-00-00", "auto", None),
        );

        assert!(find_entry(&index, "snap-001").is_some());
        assert!(find_entry(&index, "snap-999").is_none());
    }

    #[test]
    fn test_find_file_history() {
        let mut index = SnapshotIndex {
            version: 1,
            snapshots: Vec::new(),
            total_size_bytes: 0,
            oldest_snapshot: None,
            newest_snapshot: None,
        };

        add_entry(
            &mut index,
            make_entry("snap-001", "2026-03-07T10-00-00", "auto", None),
        );

        let mut entry2 = make_entry("snap-002", "2026-03-08T10-00-00", "auto", None);
        entry2.files = vec![SnapshotFileEntry {
            path: "other.md".to_string(),
            checksum: "sha256:def456".to_string(),
            size_bytes: 200,
        }];
        add_entry(&mut index, entry2);

        let history = find_file_history(&index, "test.md");
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].id, "snap-001");

        let history2 = find_file_history(&index, "other.md");
        assert_eq!(history2.len(), 1);
        assert_eq!(history2[0].id, "snap-002");

        let history3 = find_file_history(&index, "nonexistent.md");
        assert!(history3.is_empty());
    }
}
