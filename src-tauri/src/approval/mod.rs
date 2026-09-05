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

    /// 이 (경로, 종류) 승인을 **새로 기록할 필요가 없는지**. `approve`의 관문이다.
    ///
    /// ‼️ `covers`를 그대로 쓰면 안 된다 — 종류를 봐야 한다. Dir 승인은 **Dir 항목**이
    /// 덮을 때만 불필요하다. 같은 경로의 File 항목이 있다고 Dir 기록을 건너뛰면, 그
    /// 디렉터리는 실제로는 승인되지 않은 채 "승인했다"고 끝나서 하위 파일마다 확인이
    /// 다시 뜬다.
    ///
    /// 이게 없으면 (§335 리뷰 I2) 이미 승인된 vault 안에서 Cmd+O로 연 파일마다 영구
    /// `File` 항목이 쌓이고, Settings 목록에서 그 줄을 회수해도 부모 Dir 항목 때문에
    /// `covers`는 여전히 true다 — **아무 일도 하지 않은 회수를 했다고 보고하는 보안
    /// UI**가 된다.
    fn already_covers(&self, canonical: &Path, kind: ApprovalKind) -> bool {
        match kind {
            ApprovalKind::File => self.covers(canonical),
            ApprovalKind::Dir => self
                .entries
                .iter()
                .any(|e| e.kind == ApprovalKind::Dir && canonical.starts_with(Path::new(&e.path))),
        }
    }
}

#[derive(Debug, PartialEq)]
pub enum Decision {
    Allowed,
    NeedsConfirmation,
    /// `canonicalize` 실패 — 삭제된 vault, 언마운트된 드라이브, 오타.
    ///
    /// ‼️ **사용자 거부가 아니다.** 예전에는 이 경우가 `Denied`였고 호출자가 그것을
    /// `VAULT_APPROVAL_DENIED`로 옮겨서, 뜬 적도 없는 다이얼로그를 "거부했다"고 보고했다
    /// (§333 리뷰 I3). 두 결과를 가르는 것이 §333이 전용 에러 코드를 만든 이유다.
    Unresolvable,
}

/// 경로 하나에 대한 판정. 두 번째 값은 **다이얼로그에 표시할 canonical 경로**다 —
/// 원본 문자열을 그대로 보여 주면 `/x/Vault/../../../etc`로 눈속임할 수 있다.
pub fn decide(store: &ApprovalStore, path: &str) -> (Decision, Option<PathBuf>) {
    match std::fs::canonicalize(path) {
        // 존재하지 않는 경로는 승인 대상이 아니다 (§331 fail-closed).
        Err(_) => (Decision::Unresolvable, None),
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
    if !record(&mut store, canonical, kind) {
        return Ok(());
    }
    save_to(&p, &store)
}

/// 승인 하나를 저장소에 반영한다. 이미 덮여 있으면 **아무것도 하지 않고** false.
///
/// ‼️ `approve`에서 떼어낸 순수 함수인 이유: `already_covers`만 단정하는 테스트는
/// `approve`가 그 관문을 **부르지 않아도** 초록이다. 저장소를 실제로 바꾸는 이 함수를
/// 테스트해야 "새 항목이 생기지 않는다"가 고정된다 (§335 리뷰 I2).
///
/// ‼️ 정확히 같은 (경로, 종류)가 아니라 **이미 덮여 있는가**를 본다 — 근거는
/// `already_covers`의 주석. 대가는 정직하다: 부모 Dir을 회수하면 그 아래 자식 항목도
/// 함께 사라진다(애초에 자식 항목이 생기지 않으므로).
fn record(store: &mut ApprovalStore, canonical: &Path, kind: ApprovalKind) -> bool {
    if store.already_covers(canonical, kind) {
        return false;
    }
    store.entries.push(ApprovalEntry {
        path: canonical.to_string_lossy().into_owned(),
        kind,
        approved_at: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0),
    });
    true
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

    /// ‼️ fail-closed는 유지하되 **이유가 다르다.** 이 경로는 사용자가 거부한 것이
    /// 아니라 해석되지 않은 것이다 — `Denied`로 뭉뚱그리면 호출자가
    /// `VAULT_APPROVAL_DENIED`를 돌려주고, 뜬 적 없는 다이얼로그를 "허용되지
    /// 않았습니다"로 보고한다 (§333 리뷰 I3).
    #[test]
    fn nonexistent_path_is_unresolvable_not_a_user_denial() {
        let s = store(vec![dir("/")]);
        let (decision, canonical) = decide(&s, "/definitely/not/here/at/all");
        assert_eq!(
            decision,
            Decision::Unresolvable,
            "canonicalize 실패는 fail-closed지만 사용자 거부와는 다른 결과여야 한다"
        );
        assert!(canonical.is_none());
    }

    // ── §335 리뷰 I2 — 이미 덮인 승인은 새 항목을 만들지 않는다 ──────────────────

    /// 승인된 vault 안에서 Cmd+O로 연 파일마다 영구 `File` 항목이 쌓이던 결함.
    /// Settings 목록에서 그 줄은 독립 부여로 보이지만, 회수해도 부모 Dir이 여전히
    /// 덮으므로 **아무것도 회수되지 않는다.**
    #[test]
    fn a_file_inside_an_approved_dir_records_no_new_entry() {
        let mut s = store(vec![dir("/x/Vault")]);
        assert!(!record(
            &mut s,
            Path::new("/x/Vault/notes/a.md"),
            ApprovalKind::File
        ));
        assert_eq!(s.entries.len(), 1, "새 항목이 생기면 안 된다");
    }

    #[test]
    fn re_approving_the_same_dir_records_no_new_entry() {
        let mut s = store(vec![dir("/x/Vault")]);
        assert!(!record(&mut s, Path::new("/x/Vault"), ApprovalKind::Dir));
        assert!(!record(
            &mut s,
            Path::new("/x/Vault/sub"),
            ApprovalKind::Dir
        ));
        assert_eq!(s.entries.len(), 1);
    }

    /// ‼️ 종류를 무시하고 `covers`를 그대로 썼다면 이 단정이 실패한다. File 항목은
    /// 하위를 열지 않으므로 Dir 승인의 중복 판정 근거가 될 수 없다 — 건너뛰면 그
    /// 디렉터리는 승인되지 않은 채 "승인했다"로 끝난다.
    #[test]
    fn a_dir_approval_is_still_recorded_when_only_a_file_entry_shares_its_path() {
        let mut s = store(vec![file("/x/Vault")]);
        assert!(s.covers(Path::new("/x/Vault")), "전제: covers는 true다");
        assert!(
            record(&mut s, Path::new("/x/Vault"), ApprovalKind::Dir),
            "같은 경로의 File 항목은 Dir 승인을 대신할 수 없다"
        );
        assert_eq!(s.entries.len(), 2);
        assert!(s.covers(Path::new("/x/Vault/inside.md")));
    }

    #[test]
    fn an_unrelated_path_is_recorded() {
        let mut s = store(vec![dir("/x/Vault")]);
        assert!(record(
            &mut s,
            Path::new("/x/Vault-secret/a.md"),
            ApprovalKind::File
        ));
        assert!(record(&mut s, Path::new("/y/Other"), ApprovalKind::Dir));
        assert_eq!(s.entries.len(), 3);
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
        collect_calls(
            &src_dir,
            &src_dir,
            &[FORBID_DIR_CALL, FORBID_FILE_CALL],
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

    /// ‼️ §329.6이 세 번째 입구(`plugin_add_dev_folder`)를 잡은 방법이 바로 이것 —
    /// 심볼 grep이 아니라 **효과 grep**(`allow_directory`/`allow_file` 크레이트 전수)이다.
    /// 위 `forbid` 가드는 "절대 나타나면 안 되는 것"을 지키지만, 이 브랜치가 없애려는
    /// 결함 부류는 그게 아니라 **웹뷰 경로에서 도달 가능한 새 asset 부여**다. 그걸
    /// 지키는 것이 없으면 네 번째 입구를 막을 장치가 없다 (§335 리뷰 I6).
    ///
    /// 새 부여를 추가하려면 그 경로가 먼저 `approval_cmd::ensure_approved`(또는
    /// `pick_approved_*`)를 통과하는지 확인하고, 그때 이 목록에 줄을 추가한다.
    ///
    /// 규율은 `forbid` 가드와 같다 — (상대 경로, 그 줄의 정확한 텍스트) 쌍이고,
    /// 찾는 문자열은 `concat!`로 조각내며, 목록의 텍스트에는 **선행 점이 없다**(있으면
    /// 이 파일이 자기 자신을 위반으로 잡는다). 더해서 **총 개수까지 단정**한다:
    /// 쌍 매칭만으로는 이미 허용된 파일에 같은 모양의 줄을 하나 더 넣는 것을 못 막는다.
    #[test]
    fn no_new_asset_scope_grant_outside_the_allowlist() {
        const ALLOW_DIR_CALL: &str = concat!(".", "allow_directory", "(");
        const ALLOW_FILE_CALL: &str = concat!(".", "allow_file", "(");

        const ALLOWED: &[(&str, &str)] = &[
            // §69 썸네일 캐시 — 앱이 소유한 app_data_dir 하위. 웹뷰 경로가 아니다.
            ("lib.rs", "allow_directory(&dir, true)"),
            // §backlog#3/§89 컨텍스트 등록. `add_context`가 ensure_approved 뒤에만 부른다.
            ("commands/context_cmd.rs", "allow_file(&path)"),
            ("commands/context_cmd.rs", "allow_directory(&path, true)"),
            // §333 set_vault_root — 같은 게이트를 자기 진입에서 통과한다.
            ("commands/fs_cmd.rs", "allow_directory(&path, true)"),
            // §260 설치된 플러그인 디렉터리 — 앱이 소유한 plugins 루트 하위.
            ("commands/plugin_cmd.rs", "allow_directory(&dir, true)"),
            // §329.6 세 번째 입구. `plugin_add_dev_folder`가 ensure_approved 뒤에만 부른다.
            ("commands/plugin_cmd.rs", "allow_directory(folder, true)"),
        ];

        let src_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let mut grants = Vec::new();
        collect_calls(
            &src_dir,
            &src_dir,
            &[ALLOW_DIR_CALL, ALLOW_FILE_CALL],
            &mut grants,
        );

        let unexpected: Vec<_> = grants
            .iter()
            .filter(|(rel_path, _line_no, line)| {
                !ALLOWED
                    .iter()
                    .any(|(f, snippet)| rel_path == f && line.contains(snippet))
            })
            .collect();

        assert!(
            unexpected.is_empty(),
            "§333: 목록에 없는 asset scope 부여를 찾았습니다 — {unexpected:?}\n\n\
             새 부여는 vault 경계를 넓힌다. 그 경로가 approval_cmd::ensure_approved 또는 \
             pick_approved_* 를 먼저 통과하는지 확인하고, 통과한다면 이 테스트의 \
             ALLOWED에 (파일, 줄 텍스트)를 추가할 것."
        );
        assert_eq!(
            grants.len(),
            ALLOWED.len(),
            "§333: asset scope 부여 개수가 {}에서 {}로 바뀌었습니다 — {grants:?}\n\n\
             쌍 매칭만으로는 이미 허용된 파일에 같은 모양의 줄을 하나 더 넣는 것을 \
             막지 못한다. 개수를 함께 고정하는 이유다.",
            ALLOWED.len(),
            grants.len()
        );
    }

    /// `root` 기준 상대 경로, 1-기반 줄 번호, 그 줄의 trim된 텍스트를 `out`에 모은다.
    /// `needles` 중 **하나라도** 포함하는 줄을 모은다.
    fn collect_calls(
        root: &Path,
        dir: &Path,
        needles: &[&str],
        out: &mut Vec<(String, usize, String)>,
    ) {
        let Ok(entries) = std::fs::read_dir(dir) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                collect_calls(root, &path, needles, out);
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
                if needles.iter().any(|n| line.contains(n)) {
                    out.push((rel.clone(), i + 1, line.trim().to_string()));
                }
            }
        }
    }
}
