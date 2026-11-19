//! §397 타일 캐시 — 피라미드는 `{cache}/v2/tiles/t1/{key}/` 에 산다(spec D4).
//!
//! - 짓기(`commit_pyramid`): 임시 디렉터리에 다 쓰고 manifest 를 마지막에 쓴 뒤 `{key}` 로 rename 한다 —
//!   반쯤 쓴 피라미드는 `{key}` 라는 이름으로 보이지 않는다.
//! - 세대 정리(`purge_stale`): 앱 시작의 `purge_stale_generations` 가 부른다. 낡은 타일 세대와 앞선 실행이
//!   남긴 임시를 지운다.
//! - 상한(`evict_over_cap`): 새 피라미드를 쓴 뒤 합계가 상한을 넘으면 마지막 사용(manifest 의 mtime)이
//!   오래된 것부터 지운다. 사진이 바뀌어 키가 달라진 고아 피라미드도 이것이 회수한다.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use super::{TileManifest, TILE_GENERATION};
use crate::thumbnail::{ThumbnailError, CACHE_GENERATION};

const MANIFEST: &str = "manifest.json";

/// 임시 디렉터리 이름의 표지 — 이름은 `{key}.tmp-{pid}-{n}`. 키는 16진수 32자(`SourceIdentity::digest`)라
/// 이 글자를 담지 않으므로 이름만으로 임시와 피라미드가 갈린다.
const TEMP_MARK: &str = ".tmp-";

/// 모든 타일 세대가 사는 곳 — `{cache}/v2/tiles/`, 썸네일 크기 디렉터리(`v2/{max_px}/`) 옆.
fn generations_dir(cache_dir: &Path) -> PathBuf {
    cache_dir.join(CACHE_GENERATION).join("tiles")
}

/// 현재 세대의 피라미드가 사는 곳 — `{cache}/v2/tiles/t1/`.
///
/// ‼️ 썸네일 세대(`v2`) **아래**다. `purge_stale_generations` 는 시작마다 캐시 루트에서 `v2` 하나만 남기고
/// 지우므로, `v2` 옆에 두면 재시작마다 사라진다(spec §2.2 — 스파이크 측정 2회차가 이것으로 실패했다).
pub(super) fn tiles_root(cache_dir: &Path) -> PathBuf {
    generations_dir(cache_dir).join(TILE_GENERATION)
}

/// `{dir}/manifest.json` 을 읽는다. 없으면 `NotFound` — 호출자는 그것을 "캐시에 없음" 으로 읽는다.
pub(super) fn read_manifest(dir: &Path) -> io::Result<TileManifest> {
    let bytes = fs::read(dir.join(MANIFEST))?;
    serde_json::from_slice(&bytes).map_err(io::Error::from)
}

/// manifest 의 mtime 을 지금으로 — 마지막 사용(spec D4). 실패는 무시한다: 그러면 이 피라미드가 상한
/// 정리에서 실제보다 오래된 것으로 읽힐 뿐이다.
pub(super) fn mark_used(dir: &Path) {
    let now = SystemTime::now();
    let _ = fs::OpenOptions::new()
        .write(true)
        .open(dir.join(MANIFEST))
        .and_then(|file| file.set_modified(now));
}

/// 낡은 타일 세대와, 현재 세대에 남은 다른 프로세스의 임시 디렉터리를 지우고 그 수를 돌려준다. 실패는
/// 무시한다(`purge_stale_generations` 와 같은 이유 — 캐시는 지워도 다시 만들어진다).
///
/// ‼️ 이 프로세스의 임시는 남긴다 — 짓는 중일 수 있다. 짓는 중에 지우면 `write_pyramid` 가 다음 레벨의
/// `create_dir_all` 로 그 디렉터리를 다시 만들어, 앞 레벨이 빠진 피라미드가 manifest 를 얻고 rename 된다.
/// 대가: 앞선 실행이 지금과 같은 pid 였다면 그 임시는 다음 시작까지 남는다.
pub(crate) fn purge_stale(cache_dir: &Path) -> usize {
    let mut removed = 0;
    for entry in entries_of(&generations_dir(cache_dir)) {
        let current = is_dir(&entry) && entry.file_name() == TILE_GENERATION;
        if !current && remove(&entry) {
            removed += 1;
        }
    }
    let ours = own_temp_mark();
    for entry in entries_of(&tiles_root(cache_dir)) {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.contains(TEMP_MARK) && !name.contains(&ours) && remove(&entry) {
            removed += 1;
        }
    }
    removed
}

/// 피라미드 합계(manifest 의 `bytes`)가 `cap` 을 넘으면 마지막 사용(manifest 의 mtime)이 오래된 것부터
/// 지워 `cap` 이하로 만들고, 지운 수를 돌려준다. `keep` 은 지우지 않는다 — 방금 쓰거나 돌려준 피라미드다.
///
/// manifest 를 읽을 수 없는 `{key}` 는 상한과 무관하게 지운다 — `commit_pyramid` 가 rename 전에 manifest 를
/// 쓰므로 다 지은 피라미드에는 manifest 가 있다(예: 지우다 만 축출이 그런 디렉터리를 남긴다).
/// 임시 디렉터리는 세지도 지우지도 않는다 — 짓는 중일 수 있고, 남은 임시는 `purge_stale` 의 몫이다.
pub(crate) fn evict_over_cap(root: &Path, cap: u64, keep: &Path) -> usize {
    let mut removed = 0;
    let mut pyramids = Vec::new();
    for entry in entries_of(root) {
        if !is_dir(&entry) || entry.file_name().to_string_lossy().contains(TEMP_MARK) {
            continue;
        }
        let path = entry.path();
        let Ok(manifest) = read_manifest(&path) else {
            if path != keep && fs::remove_dir_all(&path).is_ok() {
                removed += 1;
            }
            continue;
        };
        pyramids.push((last_used(&path), path, manifest.bytes));
    }

    pyramids.sort();
    let mut total = pyramids
        .iter()
        .fold(0u64, |sum, (_, _, bytes)| sum.saturating_add(*bytes));
    for (_, path, bytes) in pyramids {
        if total <= cap {
            break;
        }
        if path != keep && fs::remove_dir_all(&path).is_ok() {
            removed += 1;
            total = total.saturating_sub(bytes);
        }
    }
    removed
}

/// 피라미드 하나를 짓는다 — `root/{key}.tmp-{pid}-{n}` 을 만들어 `build` 에 넘기고, `build` 가 돌려준
/// manifest 를 그 안에 마지막으로 쓴 뒤 `root/{key}` 로 rename 한다.
///
/// - `build` 나 manifest 쓰기가 실패하면 임시를 지우고 `Err`. `write_pyramid` 는 실패해도 이미 쓴 타일을
///   남기므로 그 정리가 여기 몫이다.
/// - rename 이 먼저 놓인 `{key}` 에 막히면 임시를 지우고 그쪽 manifest 를 돌려준다 — 키가 같으니 같은
///   원본(경로 · mtime · 크기)의 같은 세대 피라미드다. 그쪽도 읽을 수 없으면 rename 의 `Err`.
///
/// 임시 이름은 호출마다 다르다 — 같은 키를 동시에 짓는 두 호출이 한 디렉터리를 함께 쓰지 않게(이유는
/// `write_atomic` 과 같다).
pub(crate) fn commit_pyramid(
    root: &Path,
    key: &str,
    build: impl FnOnce(&Path) -> Result<TileManifest, ThumbnailError>,
) -> Result<(PathBuf, TileManifest), ThumbnailError> {
    static NEXT: AtomicU64 = AtomicU64::new(0);
    fs::create_dir_all(root)?;
    let tmp = root.join(format!(
        "{key}{}{}",
        own_temp_mark(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    fs::create_dir(&tmp)?;

    let manifest = match build(&tmp).and_then(|manifest| {
        let json = serde_json::to_vec(&manifest).map_err(io::Error::from)?;
        fs::write(tmp.join(MANIFEST), json)?;
        Ok(manifest)
    }) {
        Ok(manifest) => manifest,
        Err(e) => {
            let _ = fs::remove_dir_all(&tmp);
            return Err(e);
        }
    };

    let dest = root.join(key);
    if let Err(e) = fs::rename(&tmp, &dest) {
        let _ = fs::remove_dir_all(&tmp);
        return match read_manifest(&dest) {
            Ok(existing) => {
                mark_used(&dest);
                Ok((dest, existing))
            }
            Err(_) => Err(e.into()),
        };
    }
    Ok((dest, manifest))
}

/// 이 프로세스가 짓는 임시의 이름 조각 — `.tmp-{pid}-`. 뒤의 `-` 가 pid 를 닫아 `12` 가 `123` 에 걸리지 않는다.
fn own_temp_mark() -> String {
    format!("{TEMP_MARK}{}-", std::process::id())
}

/// manifest 의 mtime. 읽을 수 없으면 가장 오래된 것으로 본다.
fn last_used(dir: &Path) -> SystemTime {
    fs::metadata(dir.join(MANIFEST))
        .and_then(|meta| meta.modified())
        .unwrap_or(UNIX_EPOCH)
}

fn entries_of(dir: &Path) -> impl Iterator<Item = fs::DirEntry> {
    fs::read_dir(dir).into_iter().flatten().flatten()
}

/// 링크를 따라가지 않는다 — `DirEntry::file_type` 은 링크 자신을 본다.
fn is_dir(entry: &fs::DirEntry) -> bool {
    entry.file_type().is_ok_and(|kind| kind.is_dir())
}

fn remove(entry: &fs::DirEntry) -> bool {
    let path = entry.path();
    let outcome = if is_dir(entry) {
        fs::remove_dir_all(path)
    } else {
        fs::remove_file(path)
    };
    outcome.is_ok()
}

#[cfg(test)]
mod tests {
    use std::fs::{self, File};
    use std::time::{Duration, SystemTime, UNIX_EPOCH};

    use tempfile::TempDir;

    use super::*;
    use crate::thumbnail::tiles::LevelSize;

    fn manifest(bytes: u64) -> TileManifest {
        TileManifest {
            width: 2049,
            height: 10,
            tile: 512,
            ext: "jpg".to_string(),
            levels: vec![LevelSize { w: 2049, h: 10 }],
            bytes,
        }
    }

    /// `root/{key}/manifest.json` 을 쓰고 그 mtime(마지막 사용)을 `used` 로 둔다.
    fn put(root: &Path, key: &str, m: &TileManifest, used: SystemTime) -> PathBuf {
        let dir = root.join(key);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join(MANIFEST), serde_json::to_vec(m).unwrap()).unwrap();
        File::options()
            .write(true)
            .open(dir.join(MANIFEST))
            .unwrap()
            .set_modified(used)
            .unwrap();
        dir
    }

    fn names_in(dir: &Path) -> Vec<String> {
        let Ok(entries) = fs::read_dir(dir) else {
            return Vec::new();
        };
        let mut names: Vec<String> = entries
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        names
    }

    fn day(n: u64) -> SystemTime {
        UNIX_EPOCH + Duration::from_secs(86_400 * n)
    }

    #[test]
    fn purging_keeps_the_current_tile_generation_and_drops_old_ones_and_temp_dirs() {
        let dir = TempDir::new().unwrap();
        let cache = dir.path().join("cache");
        let tiles = cache.join("v2").join("tiles");
        assert_eq!(tiles_root(&cache), tiles.join("t1"));
        fs::create_dir_all(tiles.join("t0").join("a")).unwrap();
        let live = put(&tiles.join("t1"), "k", &manifest(10), SystemTime::now());
        fs::create_dir_all(tiles.join("t1").join("k.tmp-1-0")).unwrap();
        // 이 프로세스가 짓는 중인 임시 — 지우면 다음 레벨의 `create_dir_all` 이 되살려 반쪽 피라미드가 된다.
        let building = tiles.join("t1").join(format!("j{}0", own_temp_mark()));
        fs::create_dir_all(&building).unwrap();
        let thumb = cache.join("v2").join("2048").join("x.jpg");
        fs::create_dir_all(thumb.parent().unwrap()).unwrap();
        fs::write(&thumb, b"thumb").unwrap();

        let removed = crate::thumbnail::purge_stale_generations(&cache);

        assert_eq!(removed, 2, "the old generation and the temp dir");
        assert!(!tiles.join("t0").exists());
        assert!(live.join(MANIFEST).is_file());
        assert!(!tiles.join("t1").join("k.tmp-1-0").exists());
        assert!(building.is_dir(), "this process's own temp dir stays");
        assert!(thumb.is_file());
    }

    #[test]
    fn eviction_drops_least_recently_used_pyramids_until_under_the_cap_but_never_the_one_in_use() {
        let dir = TempDir::new().unwrap();
        let root = dir.path().join("first");
        let a = put(&root, "a", &manifest(10), day(1));
        put(&root, "b", &manifest(10), day(2));
        put(&root, "c", &manifest(10), day(3));

        assert_eq!(evict_over_cap(&root, 15, &a), 2);
        assert_eq!(names_in(&root), ["a"]);

        let root = dir.path().join("second");
        put(&root, "a", &manifest(10), day(1));
        put(&root, "b", &manifest(10), day(2));
        let c = put(&root, "c", &manifest(10), day(3));

        assert_eq!(evict_over_cap(&root, 25, &c), 1);
        assert_eq!(names_in(&root), ["b", "c"]);
    }

    #[test]
    fn a_pyramid_without_a_readable_manifest_is_dropped_by_eviction() {
        let dir = TempDir::new().unwrap();
        let root = dir.path().join("root");
        let keep = put(&root, "good", &manifest(10), SystemTime::now());
        fs::create_dir_all(root.join("garbled")).unwrap();
        fs::write(root.join("garbled").join(MANIFEST), b"{not json").unwrap();
        fs::create_dir_all(root.join("missing").join("0")).unwrap();
        // 짓는 중인 피라미드도 manifest 가 없다 — 그것은 피라미드가 아니라 임시이므로 두어야 한다.
        fs::create_dir_all(root.join("good.tmp-1-0").join("0")).unwrap();

        assert_eq!(evict_over_cap(&root, u64::MAX, &keep), 2);
        assert_eq!(names_in(&root), ["good", "good.tmp-1-0"]);
    }

    #[test]
    fn a_failed_build_leaves_no_pyramid_and_no_temp_dir() {
        let dir = TempDir::new().unwrap();
        let root = dir.path().join("root");

        let result = commit_pyramid(&root, "k", |tmp| {
            fs::create_dir_all(tmp.join("0")).unwrap();
            fs::write(tmp.join("0").join("0_0.jpg"), b"half").unwrap();
            Err(ThumbnailError::Io(std::io::Error::other("tile 1_0 failed")))
        });

        assert!(result.is_err(), "{result:?}");
        assert_eq!(names_in(&root), Vec::<String>::new());
    }

    #[test]
    fn a_successful_build_is_renamed_into_place() {
        let dir = TempDir::new().unwrap();
        let root = dir.path().join("root");

        let (pyramid, built) = commit_pyramid(&root, "k", |tmp| {
            fs::create_dir_all(tmp.join("0"))?;
            fs::write(tmp.join("0").join("0_0.jpg"), b"tile")?;
            Ok(manifest(4))
        })
        .unwrap();

        assert_eq!(pyramid, root.join("k"));
        assert_eq!(built, manifest(4));
        assert_eq!(names_in(&root), ["k"]);
        assert_eq!(read_manifest(&pyramid).unwrap(), manifest(4));
        assert!(pyramid.join("0").join("0_0.jpg").is_file());
    }

    #[test]
    fn a_build_that_loses_the_race_keeps_the_existing_pyramid() {
        let dir = TempDir::new().unwrap();
        let root = dir.path().join("root");
        let existing = put(&root, "k", &manifest(5), SystemTime::now());
        fs::write(existing.join("first"), b"").unwrap();

        let (pyramid, got) = commit_pyramid(&root, "k", |_| Ok(manifest(9))).unwrap();

        assert_eq!(pyramid, existing);
        assert_eq!(got, manifest(5));
        assert_eq!(names_in(&root), ["k"]);
        assert!(existing.join("first").is_file());
    }
}
