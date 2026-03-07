// §71 스냅샷 보존 정책 — 시간 기반 thinning + 최대 개수 제한

use super::index::{remove_entry, save_index};
use super::io::delete_snapshot_data;
use super::{SnapshotError, SnapshotIndex};

/// Enforce retention policy on the snapshot index.
///
/// Rules:
/// - Keep all snapshots < 24h old
/// - 1-7 days: max 1 per hour (keep newest in each hour)
/// - 7-30 days: max 1 per day (keep newest in each day)
/// - 30+ days: max 1 per week (keep newest in each week)
/// - Manual snapshots with labels are never auto-deleted
/// - Enforce max_count limit (default 50)
///
/// Returns list of deleted snapshot IDs.
pub fn enforce_policy(
    vault_path: &str,
    index: &mut SnapshotIndex,
    max_count: usize,
) -> Result<Vec<String>, SnapshotError> {
    let now = current_timestamp_secs();
    let mut to_delete: Vec<String> = Vec::new();

    // Phase 1: Time-based thinning
    // Collect auto snapshots grouped by time buckets
    let secs_1d: u64 = 86400;
    let secs_7d: u64 = 7 * secs_1d;
    let secs_30d: u64 = 30 * secs_1d;

    // Parse timestamps and group
    let mut auto_snapshots: Vec<(String, u64, String)> = Vec::new(); // (id, epoch_secs, timestamp)
    for entry in &index.snapshots {
        // Skip manual snapshots with labels — never auto-delete
        if entry.snapshot_type == "manual" && entry.label.is_some() {
            continue;
        }
        if let Some(epoch) = parse_timestamp_to_epoch(&entry.timestamp) {
            auto_snapshots.push((entry.id.clone(), epoch, entry.timestamp.clone()));
        }
    }

    // Sort by epoch (oldest first)
    auto_snapshots.sort_by_key(|(_id, epoch, _ts)| *epoch);

    // Apply thinning rules per time bucket
    // 1-7 days: keep 1 per hour
    let candidates_1_7d: Vec<&(String, u64, String)> = auto_snapshots
        .iter()
        .filter(|(_id, epoch, _ts)| {
            let age = now.saturating_sub(*epoch);
            age >= secs_1d && age < secs_7d
        })
        .collect();
    to_delete.extend(thin_by_bucket(&candidates_1_7d, 3600));

    // 7-30 days: keep 1 per day
    let candidates_7_30d: Vec<&(String, u64, String)> = auto_snapshots
        .iter()
        .filter(|(_id, epoch, _ts)| {
            let age = now.saturating_sub(*epoch);
            age >= secs_7d && age < secs_30d
        })
        .collect();
    to_delete.extend(thin_by_bucket(&candidates_7_30d, secs_1d));

    // 30+ days: keep 1 per week
    let candidates_30plus: Vec<&(String, u64, String)> = auto_snapshots
        .iter()
        .filter(|(_id, epoch, _ts)| {
            let age = now.saturating_sub(*epoch);
            age >= secs_30d
        })
        .collect();
    to_delete.extend(thin_by_bucket(&candidates_30plus, 7 * secs_1d));

    // Phase 2: Enforce max_count (delete oldest auto snapshots first)
    // After thinning, check count
    let remaining_count = index.snapshots.len() - to_delete.len();
    if remaining_count > max_count {
        let excess = remaining_count - max_count;
        // Collect auto snapshots not already marked for deletion, oldest first
        let mut deletable: Vec<(String, u64)> = Vec::new();
        for entry in &index.snapshots {
            if to_delete.contains(&entry.id) {
                continue;
            }
            // Prefer deleting auto over manual
            if entry.snapshot_type == "manual" && entry.label.is_some() {
                continue;
            }
            if let Some(epoch) = parse_timestamp_to_epoch(&entry.timestamp) {
                deletable.push((entry.id.clone(), epoch));
            }
        }
        deletable.sort_by_key(|(_id, epoch)| *epoch);
        for (id, _) in deletable.into_iter().take(excess) {
            if !to_delete.contains(&id) {
                to_delete.push(id);
            }
        }
    }

    // Execute deletions
    let mut deleted_ids = Vec::new();
    for id in &to_delete {
        // Get the timestamp before removal
        let timestamp = index
            .snapshots
            .iter()
            .find(|e| &e.id == id)
            .map(|e| e.timestamp.clone());

        if let Some(ts) = timestamp {
            let _ = delete_snapshot_data(vault_path, id, &ts);
        }
        remove_entry(index, id);
        deleted_ids.push(id.clone());
    }

    if !deleted_ids.is_empty() {
        save_index(vault_path, index)?;
    }

    Ok(deleted_ids)
}

/// Thin snapshots within a time bucket: keep only the newest per bucket_secs interval.
/// Returns IDs to delete.
fn thin_by_bucket(
    snapshots: &[&(String, u64, String)],
    bucket_secs: u64,
) -> Vec<String> {
    if snapshots.is_empty() {
        return Vec::new();
    }

    let mut to_delete = Vec::new();

    // Group by bucket
    let mut buckets: std::collections::HashMap<u64, Vec<&(String, u64, String)>> =
        std::collections::HashMap::new();

    for snap in snapshots {
        let bucket = snap.1 / bucket_secs;
        buckets.entry(bucket).or_default().push(snap);
    }

    // In each bucket, keep only the newest (highest epoch), delete the rest
    for (_bucket, mut entries) in buckets {
        if entries.len() <= 1 {
            continue;
        }
        // Sort by epoch descending — keep first (newest)
        entries.sort_by(|a, b| b.1.cmp(&a.1));
        for entry in entries.into_iter().skip(1) {
            to_delete.push(entry.0.clone());
        }
    }

    to_delete
}

/// Parse a filesystem-safe timestamp (YYYY-MM-DDTHH-MM-SS) to Unix epoch seconds.
fn parse_timestamp_to_epoch(ts: &str) -> Option<u64> {
    // Format: "2026-03-07T10-00-00"
    if ts.len() < 19 {
        return None;
    }
    let year: u64 = ts[0..4].parse().ok()?;
    let month: u64 = ts[5..7].parse().ok()?;
    let day: u64 = ts[8..10].parse().ok()?;
    let hour: u64 = ts[11..13].parse().ok()?;
    let min: u64 = ts[14..16].parse().ok()?;
    let sec: u64 = ts[17..19].parse().ok()?;

    // Convert to days since epoch using reverse of days_to_date
    let days = date_to_days(year, month, day)?;
    Some(days * 86400 + hour * 3600 + min * 60 + sec)
}

/// Convert (year, month, day) to days since Unix epoch.
fn date_to_days(year: u64, month: u64, day: u64) -> Option<u64> {
    // Algorithm from https://howardhinnant.github.io/date_algorithms.html (civil_from_days inverse)
    if month < 1 || month > 12 || day < 1 || day > 31 {
        return None;
    }
    let y = if month <= 2 { year - 1 } else { year };
    let m = if month <= 2 { month + 9 } else { month - 3 };
    let era = y / 400;
    let yoe = y - era * 400;
    let doy = (153 * m + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146097 + doe;
    // Subtract Unix epoch offset (days from 0000-03-01 to 1970-01-01)
    days.checked_sub(719468)
}

/// Get current time as Unix epoch seconds.
fn current_timestamp_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::snapshot::index::add_entry;
    use crate::snapshot::{SnapshotEntry, SnapshotFileEntry, SnapshotIndex};
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
    fn test_parse_timestamp_to_epoch() {
        let epoch = parse_timestamp_to_epoch("2026-03-07T10-00-00");
        assert!(epoch.is_some());
        let secs = epoch.unwrap();
        // 2026-03-07 should be after 2025-01-01 (1735689600)
        assert!(secs > 1735689600);
    }

    #[test]
    fn test_parse_timestamp_roundtrip() {
        // Known date: 2024-01-01T00-00-00 = 1704067200
        let epoch = parse_timestamp_to_epoch("2024-01-01T00-00-00");
        assert_eq!(epoch, Some(1704067200));
    }

    #[test]
    fn test_parse_timestamp_invalid() {
        assert!(parse_timestamp_to_epoch("invalid").is_none());
        assert!(parse_timestamp_to_epoch("2026-13-07T10-00-00").is_none()); // month 13
    }

    #[test]
    fn test_thin_by_bucket_empty() {
        let result = thin_by_bucket(&[], 3600);
        assert!(result.is_empty());
    }

    #[test]
    fn test_thin_by_bucket_single() {
        let snap = ("snap-001".to_string(), 1000u64, "ts".to_string());
        let result = thin_by_bucket(&[&snap], 3600);
        assert!(result.is_empty()); // Single entry per bucket — nothing to delete
    }

    #[test]
    fn test_thin_by_bucket_keeps_newest() {
        let snap1 = ("snap-001".to_string(), 3600u64, "ts1".to_string());
        let snap2 = ("snap-002".to_string(), 3700u64, "ts2".to_string());
        let snap3 = ("snap-003".to_string(), 3500u64, "ts3".to_string());

        // All in same hour bucket (3600/3600 = 1, 3700/3600 = 1, 3500/3600 = 0)
        // snap1 and snap2 are in bucket 1, snap3 is in bucket 0
        let result = thin_by_bucket(&[&snap1, &snap2, &snap3], 3600);

        // snap1 (3600) should be deleted because snap2 (3700) is newer in the same bucket
        assert_eq!(result.len(), 1);
        assert!(result.contains(&"snap-001".to_string()));
    }

    #[test]
    fn test_enforce_policy_manual_snapshots_preserved() {
        let tmp = TempDir::new().unwrap();
        let vault = tmp.path().to_string_lossy().to_string();

        let mut index = SnapshotIndex {
            version: 1,
            snapshots: Vec::new(),
            total_size_bytes: 0,
            oldest_snapshot: None,
            newest_snapshot: None,
        };

        // Add a manual labeled snapshot with very old timestamp
        add_entry(
            &mut index,
            make_entry("snap-manual", "2020-01-01T00-00-00", "manual", Some("important")),
        );
        // Add some auto snapshots
        add_entry(
            &mut index,
            make_entry("snap-auto", "2020-01-01T01-00-00", "auto", None),
        );

        // Create .baram/snapshots dir for save_index
        std::fs::create_dir_all(tmp.path().join(".baram").join("snapshots")).unwrap();
        crate::snapshot::index::save_index(&vault, &index).unwrap();

        let deleted = enforce_policy(&vault, &mut index, 50).unwrap();

        // Manual snapshot should NOT be deleted even though it's old
        assert!(!deleted.contains(&"snap-manual".to_string()));
    }

    #[test]
    fn test_enforce_policy_max_count() {
        let tmp = TempDir::new().unwrap();
        let vault = tmp.path().to_string_lossy().to_string();
        std::fs::create_dir_all(tmp.path().join(".baram").join("snapshots")).unwrap();

        let mut index = SnapshotIndex {
            version: 1,
            snapshots: Vec::new(),
            total_size_bytes: 0,
            oldest_snapshot: None,
            newest_snapshot: None,
        };

        // Add 10 auto snapshots (all recent so time-based thinning won't apply)
        let now = current_timestamp_secs();
        for i in 0..10 {
            let epoch = now - (i * 60); // each 1 minute apart, all within 24h
            // Convert epoch back to timestamp string for testing
            let ts = epoch_to_timestamp(epoch);
            add_entry(
                &mut index,
                make_entry(&format!("snap-{:03}", i), &ts, "auto", None),
            );
        }

        crate::snapshot::index::save_index(&vault, &index).unwrap();

        // Enforce max_count=5 — should delete 5 oldest
        let deleted = enforce_policy(&vault, &mut index, 5).unwrap();
        assert_eq!(deleted.len(), 5);
        assert_eq!(index.snapshots.len(), 5);
    }

    /// Helper: convert epoch secs back to filesystem-safe timestamp.
    fn epoch_to_timestamp(secs: u64) -> String {
        let days = secs / 86400;
        let time_of_day = secs % 86400;
        let hours = time_of_day / 3600;
        let minutes = (time_of_day % 3600) / 60;
        let seconds = time_of_day % 60;
        let (y, m, d) = crate::snapshot::io::days_to_date(days);
        format!(
            "{:04}-{:02}-{:02}T{:02}-{:02}-{:02}",
            y, m, d, hours, minutes, seconds
        )
    }
}
