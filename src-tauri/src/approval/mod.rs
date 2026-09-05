// §331 승인 저장소 — Rust가 소유하는 vault 경계 승인 기록.
//
// ‼️ `config.json`이 아니라 별도 파일이어야 한다. `set_config`(commands/config_cmd.rs)은
// 예약 키 없이 임의 키에 임의 값을 쓰므로, 승인 기록을 거기 두면 인가받아야 할 웹뷰가
// 자기 인가를 쓰게 된다 — 이 작업이 없애려는 바로 그 구조다 (§329.3).
//
// Task 1 산출물. Task 2(`commands::approval_cmd::ensure_approved`)가 `load`/`approve`를,
// Task 6(`commands::approval_cmd::revoke_approved_root`)이 `revoke`를 배선했다.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::Manager;

/// 승인 파일 읽기-수정-쓰기 직렬화. `config/mod.rs`의 CONFIG_MUTEX와 같은 이유.
static APPROVAL_MUTEX: Mutex<()> = Mutex::new(());

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ApprovalKind {
    Dir,
    File,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct ApprovalEntry {
    pub path: String,
    pub kind: ApprovalKind,
    #[serde(rename = "approvedAt")]
    pub approved_at: u64,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct ApprovalStore {
    pub version: u32,
    pub entries: Vec<ApprovalEntry>,
}

impl Default for ApprovalStore {
    fn default() -> Self {
        Self {
            version: 1,
            entries: Vec::new(),
        }
    }
}

impl ApprovalStore {
    /// 이미 canonical인 경로가 승인 범위에 드는지. **순수 함수** — 파일시스템을 보지 않는다.
    pub fn covers(&self, canonical: &Path) -> bool {
        self.entries.iter().any(|e| {
            let entry = Path::new(&e.path);
            match e.kind {
                ApprovalKind::File => canonical == entry,
                // ‼️ `Path::starts_with`는 컴포넌트 단위다. 문자열 starts_with를 쓰면
                // `/x/Vault` 승인이 `/x/Vault-secret`을 통과시킨다 (§331).
                ApprovalKind::Dir => canonical.starts_with(entry),
            }
        })
    }
}

#[derive(Debug, PartialEq)]
pub enum Decision {
    Allowed,
    NeedsConfirmation,
    Denied,
}

/// 경로 하나에 대한 판정. 두 번째 값은 **다이얼로그에 표시할 canonical 경로**다 —
/// 원본 문자열을 그대로 보여 주면 `/x/Vault/../../../etc`로 눈속임할 수 있다.
pub fn decide(store: &ApprovalStore, path: &str) -> (Decision, Option<PathBuf>) {
    match std::fs::canonicalize(path) {
        // 존재하지 않는 경로는 승인 대상이 아니다 (§331 fail-closed).
        Err(_) => (Decision::Denied, None),
        Ok(canonical) => {
            if store.covers(&canonical) {
                (Decision::Allowed, Some(canonical))
            } else {
                (Decision::NeedsConfirmation, Some(canonical))
            }
        }
    }
}

/// §333 generic over the runtime — `commands::approval_cmd::ensure_approved` (its only
/// path to this function, via `load`/`approve`) must itself be generic so a
/// `tauri::test::mock_builder()` (runtime = `MockRuntime`, not `Wry`) can dispatch the
/// command that calls it through `generate_handler!`
/// ([[direct-call-test-cannot-see-an-unreachable-command]]). A concrete `tauri::AppHandle`
/// caller is unaffected — `R` infers to `Wry`.
fn store_path<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|_| "앱 데이터 디렉터리를 찾을 수 없습니다".to_string())?;
    Ok(dir.join("approved-roots.json"))
}

/// 읽기는 절대 실패하지 않는다 — 실패는 **승인 0건**이다 (fail-closed).
pub fn load_from(path: &Path) -> ApprovalStore {
    match std::fs::read_to_string(path) {
        Ok(content) => serde_json::from_str(&content).unwrap_or_else(|e| {
            log::warn!("§331 승인 파일 파싱 실패 — 승인 0건으로 진행: {e}");
            ApprovalStore::default()
        }),
        Err(_) => ApprovalStore::default(),
    }
}

pub fn save_to(path: &Path, store: &ApprovalStore) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension("json.tmp");
    let content = serde_json::to_string_pretty(store).map_err(|e| e.to_string())?;
    std::fs::write(&tmp, content).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, path).map_err(|e| e.to_string())
}

pub fn load<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> ApprovalStore {
    match store_path(app) {
        Ok(p) => load_from(&p),
        Err(e) => {
            log::warn!("§331 승인 파일 경로 해석 실패 — 승인 0건으로 진행: {e}");
            ApprovalStore::default()
        }
    }
}

pub fn approve<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    canonical: &Path,
    kind: ApprovalKind,
) -> Result<(), String> {
    let _guard = APPROVAL_MUTEX
        .lock()
        .map_err(|_| "잠금 획득 실패".to_string())?;
    let p = store_path(app)?;
    let mut store = load_from(&p);
    let path = canonical.to_string_lossy().into_owned();
    if store
        .entries
        .iter()
        .any(|e| e.path == path && e.kind == kind)
    {
        return Ok(());
    }
    store.entries.push(ApprovalEntry {
        path,
        kind,
        approved_at: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0),
    });
    save_to(&p, &store)
}

/// ‼️ 회수는 **기록 삭제만** 한다. `Scope::forbid_*`를 부르지 않는다 — tauri의 forbid는
/// allow보다 항상 우선하고 해제 API가 없어서, 같은 루트를 다시 승인해도 그 세션 내내
/// asset://이 죽는다 (§335). 현재 세션의 부여는 재시작으로 정리된다.
///
/// `commands::approval_cmd::revoke_approved_root`(§335)가 이 함수를 IPC 커맨드로 배선한다.
pub fn revoke(app: &tauri::AppHandle, path: &str) -> Result<(), String> {
    let _guard = APPROVAL_MUTEX
        .lock()
        .map_err(|_| "잠금 획득 실패".to_string())?;
    let p = store_path(app)?;
    let mut store = load_from(&p);
    store.entries.retain(|e| e.path != path);
    save_to(&p, &store)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    fn dir(p: &str) -> ApprovalEntry {
        ApprovalEntry {
            path: p.into(),
            kind: ApprovalKind::Dir,
            approved_at: 0,
        }
    }
    fn file(p: &str) -> ApprovalEntry {
        ApprovalEntry {
            path: p.into(),
            kind: ApprovalKind::File,
            approved_at: 0,
        }
    }
    fn store(entries: Vec<ApprovalEntry>) -> ApprovalStore {
        ApprovalStore {
            version: 1,
            entries,
        }
    }

    #[test]
    fn dir_entry_covers_itself_and_descendants() {
        let s = store(vec![dir("/x/Vault")]);
        assert!(s.covers(Path::new("/x/Vault")));
        assert!(s.covers(Path::new("/x/Vault/notes/a.md")));
    }

    /// ‼️ §331의 핵심 계약. 문자열 `starts_with`였다면 이 단정이 통과한다 —
    /// 그래서 이 테스트 하나가 그 구현을 영구히 배제한다.
    #[test]
    fn dir_entry_does_not_cover_sibling_sharing_a_string_prefix() {
        let s = store(vec![dir("/x/Vault")]);
        assert!(!s.covers(Path::new("/x/Vault-secret/a.md")));
        assert!(!s.covers(Path::new("/x/VaultBackup")));
    }

    #[test]
    fn file_entry_covers_only_itself_never_its_directory() {
        let s = store(vec![file("/x/memo.md")]);
        assert!(s.covers(Path::new("/x/memo.md")));
        assert!(!s.covers(Path::new("/x/other.md")));
        assert!(!s.covers(Path::new("/x")));
    }

    #[test]
    fn empty_store_covers_nothing_including_root() {
        assert!(!ApprovalStore::default().covers(Path::new("/")));
    }

    #[test]
    fn corrupt_file_loads_as_empty_store() {
        let tmp = std::env::temp_dir().join(format!(
            "baram-approval-corrupt-{}.json",
            std::process::id()
        ));
        std::fs::write(&tmp, "{ this is not json").unwrap();
        let s = load_from(&tmp);
        assert!(
            s.entries.is_empty(),
            "손상된 승인 파일은 승인 0건이어야 한다 (fail-closed)"
        );
        std::fs::remove_file(&tmp).ok();
    }

    #[test]
    fn missing_file_loads_as_empty_store() {
        let s = load_from(Path::new("/definitely/not/here/approved-roots.json"));
        assert!(s.entries.is_empty());
    }

    #[test]
    fn save_then_load_round_trips() {
        let tmp =
            std::env::temp_dir().join(format!("baram-approval-rt-{}.json", std::process::id()));
        let original = store(vec![dir("/x/Vault"), file("/x/memo.md")]);
        save_to(&tmp, &original).unwrap();
        let read_back = load_from(&tmp);
        assert_eq!(read_back.entries, original.entries);
        std::fs::remove_file(&tmp).ok();
    }

    #[test]
    fn nonexistent_path_is_denied_not_merely_unapproved() {
        let s = store(vec![dir("/")]);
        let (decision, canonical) = decide(&s, "/definitely/not/here/at/all");
        assert_eq!(
            decision,
            Decision::Denied,
            "canonicalize 실패는 fail-closed 거부여야 한다"
        );
        assert!(canonical.is_none());
    }

    /// 심링크로 승인 경계를 우회할 수 없다: 승인도 판정도 canonical 경로로 한다.
    #[cfg(unix)]
    #[test]
    fn symlink_into_an_unapproved_directory_is_not_covered() {
        let base =
            std::env::temp_dir().join(format!("baram-approval-symlink-{}", std::process::id()));
        let approved = base.join("approved");
        let secret = base.join("secret");
        std::fs::create_dir_all(&approved).unwrap();
        std::fs::create_dir_all(&secret).unwrap();
        std::fs::write(secret.join("k.txt"), "s").unwrap();
        let link = approved.join("link-to-secret");
        std::os::unix::fs::symlink(&secret, &link).unwrap();

        let canonical_approved = std::fs::canonicalize(&approved).unwrap();
        let s = store(vec![ApprovalEntry {
            path: canonical_approved.to_string_lossy().into_owned(),
            kind: ApprovalKind::Dir,
            approved_at: 0,
        }]);

        let (decision, _) = decide(&s, link.join("k.txt").to_str().unwrap());
        assert_eq!(
            decision,
            Decision::NeedsConfirmation,
            "심링크가 가리키는 실경로는 승인 밖이므로 자동 통과해서는 안 된다"
        );

        std::fs::remove_dir_all(&base).ok();
    }

    /// ‼️ §335 — 크레이트 전체에서 `Scope::forbid_directory`/`forbid_file`를 새로 부르면
    /// 안 된다. tauri의 forbid는 allow보다 **항상** 우선하고 해제 API가 없어서, 같은
    /// 루트를 다시 승인해도 그 세션 내내 asset://가 죽는다.
    ///
    /// 이전 버전은 `approval/mod.rs` 한 파일만 `include_str!`로 봤다 — 하지만 이 API를
    /// 부를 손이 가장 먼저 닿는 곳은 `AppHandle`을 이미 쥔 IPC 커맨드
    /// (`commands/approval_cmd.rs`의 `revoke_approved_root`)이지, 이 파일이 아니다.
    /// 그래서 `src-tauri/src/` 전체를 재귀로 훑는다(리뷰 Important).
    ///
    /// 예외는 정확히 하나 — `commands/plugin_cmd.rs`의 `plugin_prepare_scopes`가 §260
    /// 스테이징 카브아웃으로 부르는 그 한 줄. 파일 경로가 아니라 **그 줄의 정확한
    /// 텍스트**로 매칭해서, 같은 파일에 다른 forbid 호출이 추가돼도 여전히 걸리게 한다.
    ///
    /// 찾는 문자열은 `concat!`로 조각내 만든다(아래 상수) — 이 파일의 소스 텍스트 자체에
    /// 그 온전한 문자열이 나타나면(예전 버전의 `body.contains` 인자가 그랬듯) 이 테스트가
    /// **자기 자신**을 위반으로 잡는다. 모듈 이름에 기대는 `split` 트릭보다 이쪽이
    /// 안전하다 — 이름을 바꿔도 깨지지 않는다.
    #[test]
    fn no_new_scope_forbid_call_anywhere_in_the_crate() {
        const FORBID_DIR_CALL: &str = concat!(".", "forbid_directory", "(");
        const FORBID_FILE_CALL: &str = concat!(".", "forbid_file", "(");

        // (그 줄이 있어야 할 상대 경로, 그 줄에 있어야 할 정확한 텍스트) — 둘 다
        // 맞아야 허용된다.
        const ALLOWED: &[(&str, &str)] = &[(
            "commands/plugin_cmd.rs",
            "forbid_directory(plugin::staging_dir_of(&dir), true)",
        )];

        let src_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let mut offenders = Vec::new();
        collect_forbid_calls(
            &src_dir,
            &src_dir,
            FORBID_DIR_CALL,
            FORBID_FILE_CALL,
            &mut offenders,
        );

        let unexpected: Vec<_> = offenders
            .into_iter()
            .filter(|(rel_path, _line_no, line)| {
                !ALLOWED
                    .iter()
                    .any(|(f, snippet)| rel_path == f && line.contains(snippet))
            })
            .collect();

        assert!(
            unexpected.is_empty(),
            "§335: 새 Scope::forbid_* 호출을 찾았습니다 — {unexpected:?}\n\n\
             forbid는 allow보다 항상 우선하고 해제 API가 없어서, 같은 루트를 다시 \
             승인해도 그 세션 내내 asset://가 죽는다. 즉시 차단이 필요해 보이면 이 \
             테스트의 allowlist가 아니라 설계를 먼저 의심할 것 — 회수는 기록 삭제만으로 \
             충분해야 한다."
        );
    }

    /// `root` 기준 상대 경로, 1-기반 줄 번호, 그 줄의 trim된 텍스트를 `out`에 모은다.
    fn collect_forbid_calls(
        root: &Path,
        dir: &Path,
        dir_call: &str,
        file_call: &str,
        out: &mut Vec<(String, usize, String)>,
    ) {
        let Ok(entries) = std::fs::read_dir(dir) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                collect_forbid_calls(root, &path, dir_call, file_call, out);
                continue;
            }
            if path.extension().and_then(|e| e.to_str()) != Some("rs") {
                continue;
            }
            let Ok(content) = std::fs::read_to_string(&path) else {
                continue;
            };
            let rel = path
                .strip_prefix(root)
                .unwrap_or(&path)
                .to_string_lossy()
                .replace('\\', "/");
            for (i, line) in content.lines().enumerate() {
                if line.contains(dir_call) || line.contains(file_call) {
                    out.push((rel.clone(), i + 1, line.trim().to_string()));
                }
            }
        }
    }
}
