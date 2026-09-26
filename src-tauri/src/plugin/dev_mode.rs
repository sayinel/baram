// §379 개발자 모드 — 폴더 목록·켜짐 상태·dev 동의·폴더가 쥔 id 를 Rust 가 소유한다 (spec 0058 §6.2 R1).
//
// ‼️ `config.json` 이 아니라 별도 파일이다 — `approved-roots.json`(§331)과 같은 이유다.
// `set_config` 는 아무 키에나 쓰므로, 목록이 거기 살면 웹뷰가 사이드로드 목록을 스스로
// 늘린다(spec 0058 4장 G4). 이 파일을 쓰는 것은 이 모듈의 `update` 와 dev 빌드의 1회
// 이전뿐이고, 그 둘을 부르는 곳은 `commands::plugin_dev_cmd` 다.
//
// 판정은 여기에, 앱에 닿는 일(파일 위치·asset scope·네이티브 대화상자)은 그 커맨드 파일에 있다.

use std::path::Path;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use super::registry::{PluginManifest, PluginTrust};

/// R1 의 파일 이름. 앱 데이터 디렉터리에서 `approved-roots.json` 옆에 산다.
pub const STORE_FILE: &str = "plugin-dev.json";

// ‼️ 아래 아홉 `DEV_*` 코드는 `scripts/rust-constants.ts` 의 `devModeErrorCodes` 가 이 파일에서
// 전부 긁어 `src/ipc/plugin-dev-errors.ts` 의 번역과 대조한다(`dev-mode-error-codes.test.ts`).
// 코드를 더하면 번역도 더해야 그 테스트가 초록이다. 이 파일을 옮기면 그 테스트의 경로도 옮길 것.
/// 개발자 모드가 꺼져 있다.
pub const DEV_MODE_INACTIVE: &str = "DEV_MODE_INACTIVE";
/// R1 에 없는 경로 — Reload·동의 기록은 이미 고른 폴더만 받는다.
pub const DEV_FOLDER_NOT_LISTED: &str = "DEV_FOLDER_NOT_LISTED";
/// 폴더가 없다 — canonicalize 가 실패했다.
pub const DEV_FOLDER_MISSING: &str = "DEV_FOLDER_MISSING";
/// 승인 저장소(`approved-roots.json`)가 이 폴더를 덮지 않는다.
pub const DEV_FOLDER_NOT_APPROVED: &str = "DEV_FOLDER_NOT_APPROVED";
/// 릴리스 빌드에서 매니페스트의 `trust` 가 `sandboxed` 가 아니다 (I1).
pub const DEV_PLUGIN_NOT_SANDBOXED: &str = "DEV_PLUGIN_NOT_SANDBOXED";
/// 릴리스 빌드에서 id 가 `baram-` 로 시작한다 — 퍼스트파티 예약 (I4-2).
pub const DEV_PLUGIN_ID_RESERVED: &str = "DEV_PLUGIN_ID_RESERVED";
/// 릴리스 빌드에서 설치된 플러그인과 id 가 같다 (I4-1).
pub const DEV_PLUGIN_ID_INSTALLED: &str = "DEV_PLUGIN_ID_INSTALLED";
/// 릴리스 빌드에서 `plugin-data/<id>` 가 이미 있는데 R1 의 어떤 항목도 그 id 를 기록하지 않았다 (I4-3).
pub const DEV_PLUGIN_STORAGE_TAKEN: &str = "DEV_PLUGIN_STORAGE_TAKEN";
/// 릴리스 빌드의 개발자 모드가 켜져 있는 동안, R1 이 기록한 id 의 플러그인 설치 (I4 의 반대 방향 —
/// 폴더의 플러그인이 심은 저장소를 설치본이 물려받는다).
pub const DEV_PLUGIN_ID_HELD: &str = "DEV_PLUGIN_ID_HELD";

/// 퍼스트파티 id 접두사 — 스펙 0058 7.2 게이트 2 와 같은 규칙.
const FIRST_PARTY_PREFIX: &str = "baram-";

/// R1 파일 읽기-수정-쓰기 직렬화. `approval/mod.rs` 의 `APPROVAL_MUTEX` 와 같은 이유.
static DEV_MODE_MUTEX: Mutex<()> = Mutex::new(());

/// 이 바이너리의 빌드 — dev 폴더 판정이 받는 빌드 값.
///
/// ‼️ 필드가 비공개라 이 모듈 밖에서는 `Build::current()` 로만 만들 수 있다. PR #738 은
/// "공개 함수는 빌드 플래그를 받지 않는다" 를 스캔 테스트로 지켰다. 여기서는 타입이 지킨다:
/// 커맨드는 판정 코어에 빌드를 넘기지만, 넘길 수 있는 값이 이 바이너리의 빌드뿐이다.
/// 테스트만 `dev()`·`release()` 를 쓴다 — 테스트는 debug 빌드라 `cfg!(debug_assertions)`
/// 로는 릴리스 분기에 닿을 수 없다.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Build {
    dev: bool,
}

impl Build {
    pub fn current() -> Self {
        Self {
            dev: cfg!(debug_assertions),
        }
    }

    pub fn is_dev(self) -> bool {
        self.dev
    }
}

#[cfg(test)]
impl Build {
    pub fn dev() -> Self {
        Self { dev: true }
    }

    pub fn release() -> Self {
        Self { dev: false }
    }
}

/// 사용자가 한 폴더에 대해 승인한 것 — TS `PluginConsent`(`src/plugins/types.ts`)와 같은 모양.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct DevConsent {
    pub capabilities: Vec<String>,
    pub trust: PluginTrust,
}

/// R1 의 폴더 하나. 피커가 더한 항목의 `path` 는 canonical 경로다(피커가 canonicalize 한 것을
/// 쓴다) — 단 dev 빌드가 `config.json` 의 옛 목록에서 옮긴 항목은 그 목록에 저장돼 있던
/// 문자열을 그대로 옮긴 것이라 canonical 이라는 보장이 없다(`migrated`).
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct DevFolder {
    pub path: String,
    /// 이 폴더가 저장소 `plugin-data/<id>` 를 쓸 권리로 기록된 id 들 (I4-3) — **집합**이다. 릴리스
    /// 빌드가 이 폴더를 받아들일 때마다(피커·목록·Reload) 그 매니페스트 id 를 더한다 — 코드가 돌아
    /// 저장소를 만들기 전에. 덮어쓰지 않는 이유: 작성자가 id 를 바꾸면 옛 id 로 심은 저장소도 여전히
    /// 이 폴더의 것이어야 한다(스펙 "기록한 적이"). 지우는 곳은 둘 — 폴더 제거(항목째)와 같은 id 의
    /// 플러그인 설치 커밋(`forget_id`). dev 빌드는 더하지 않는다(plan 0106 P22). 스펙의 v1 모양
    /// `{ path, consent? }` 에는 없던 필드라 그 파일은 빈 집합으로 읽힌다.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub consent: Option<DevConsent>,
}

/// `plugin-dev.json` 전체 — `{ version: 1, enabled, folders: [{ path, ids?, consent? }] }`.
#[derive(Debug, Deserialize, PartialEq, Serialize)]
pub struct DevModeState {
    pub version: u32,
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub folders: Vec<DevFolder>,
}

impl Default for DevModeState {
    fn default() -> Self {
        Self {
            version: 1,
            enabled: false,
            folders: Vec::new(),
        }
    }
}

impl DevModeState {
    pub fn find(&self, path: &str) -> Option<&DevFolder> {
        self.folders.iter().find(|f| f.path == path)
    }

    /// 좁히는 방향이라 확인이 없다. 없는 경로면 아무것도 하지 않는다.
    pub fn remove_folder(&mut self, path: &str) {
        self.folders.retain(|f| f.path != path);
    }

    /// I4-3 — R1 의 **어떤** 항목이든 이 id 를 기록한 적이 있는가(그 폴더가 목록에 남아 있고, 그
    /// 사이 같은 id 의 설치 커밋이 기록을 지우지 않은 동안 — 스펙 "R1 의 어떤 항목도 …").
    pub fn records_id(&self, id: &str) -> bool {
        self.folders
            .iter()
            .any(|f| f.ids.iter().any(|recorded| recorded == id))
    }

    /// 폴더의 기록에 id 를 더한다(이미 있으면 그대로). 목록에 없는 경로면 아무것도 하지 않는다 —
    /// 목록을 늘리지 못한다.
    pub fn record_id(&mut self, path: &str, id: &str) {
        if let Some(entry) = self.folders.iter_mut().find(|f| f.path == path) {
            if !entry.ids.iter().any(|recorded| recorded == id) {
                entry.ids.push(id.to_string());
            }
        }
    }

    /// 목록에 더한다 — 이미 있으면 그대로(동의도 그대로) 둔다. 더해진, 또는 있던 항목을 돌려준다.
    pub fn add_folder(&mut self, path: &str) -> &DevFolder {
        if let Some(index) = self.folders.iter().position(|f| f.path == path) {
            return &self.folders[index];
        }
        self.folders.push(DevFolder {
            path: path.to_string(),
            ids: Vec::new(),
            consent: None,
        });
        self.folders.last().expect("just pushed")
    }

    /// F2 의 동의를 R1 항목에 기록한다. 목록을 늘리지 못한다 — 없는 경로는 거부한다.
    /// 릴리스 빌드는 sandboxed 가 아닌 동의를 받지 않는다 — 동의 기록은 티어를 넓힐 수 있는
    /// 유일한 쓰기다(그런 폴더는 `admit_manifest` 가 이미 거부한다).
    pub fn record_consent(
        &mut self,
        build: Build,
        path: &str,
        consent: DevConsent,
    ) -> Result<(), String> {
        if !build.is_dev() && consent.trust != PluginTrust::Sandboxed {
            return Err(DEV_PLUGIN_NOT_SANDBOXED.to_string());
        }
        let entry = self
            .folders
            .iter_mut()
            .find(|f| f.path == path)
            .ok_or_else(|| DEV_FOLDER_NOT_LISTED.to_string())?;
        entry.consent = Some(consent);
        Ok(())
    }

    /// 같은 id 의 플러그인 설치가 커밋됐다 — 모든 항목의 기록에서 뺀다. 그 뒤의 `plugin-data/<id>`
    /// 는 설치본(과 그 제거 뒤의 잔여)의 것이지 이 폴더의 것이 아니다(plan 0106 P25).
    pub fn forget_id(&mut self, id: &str) {
        for folder in &mut self.folders {
            folder.ids.retain(|recorded| recorded != id);
        }
    }
}

/// R2 — 목록을 읽거나 넓히는 dev 커맨드가 거치는 판정 하나: dev 빌드이거나, 사용자가 켰다.
/// 제거(`plugin_remove_dev_folder`)는 거치지 않는다 — 좁히는 쓰기라 비활성 중에도 허용한다.
pub fn developer_mode_active(build: Build, state: &DevModeState) -> bool {
    build.is_dev() || state.enabled
}

/// 이 빌드가 다룰 폴더. 비활성이면 없다 — 목록은 파일에 남는다(다시 켜면 돌아온다).
pub fn visible_folders(build: Build, state: &DevModeState) -> &[DevFolder] {
    if developer_mode_active(build, state) {
        &state.folders
    } else {
        &[]
    }
}

/// I4 의 반대 방향 — 플러그인 설치 커밋이 거부할 id. 릴리스 빌드에서 개발자 모드가 켜져 있으면
/// R1 이 기록한 모든 id(한 번씩), 아니면 없다: dev 빌드는 폴더가 설치본을 대신하는 경로이고(스펙
/// R3), 꺼져 있으면 지금 저장소를 심을 폴더가 로드돼 있지 않다.
pub fn held_ids(build: Build, state: &DevModeState) -> Vec<String> {
    if build.is_dev() || !developer_mode_active(build, state) {
        return Vec::new();
    }
    let mut ids: Vec<String> = state
        .folders
        .iter()
        .flat_map(|folder| folder.ids.iter().cloned())
        .collect();
    ids.sort();
    ids.dedup();
    ids
}

/// R3 — 폴더의 매니페스트가 이 빌드에서 설 수 있는가.
///
/// 릴리스 빌드, 이 순서로:
/// - I1: `trust` 가 `sandboxed` 여야 한다 — Rust 의 `validate_manifest` 는 `trust` 를 보지
///   않으므로 이 경로에 따로 둔다.
/// - I4-2: id 가 `baram-` 로 시작하면 안 된다(퍼스트파티 예약).
/// - I4-1: 설치된 플러그인의 id 를 쓸 수 없다.
/// - I4-3: `plugin-data/<id>` 가 이미 있으면 R1 의 어떤 항목이 그 id 를 기록했어야 한다 —
///   제거(`uninstall_installed`)는 설치 디렉터리만 지우고 저장소를 남기므로, 설치 디렉터리만
///   보면 제거된 플러그인의 저장소를 물려받는다. 기록이 있으면 그 저장소는 R1 폴더의 것이다
///   (자기 저장소로 재시작하는 dev 플러그인은 막지 않는다).
///
/// dev 빌드는 아무것도 막지 않는다 — 발행한 플러그인의 다음 버전을 설치본 자리에서 개발하는
/// 경로다(스펙 R3).
pub fn admit_manifest(
    build: Build,
    manifest: &PluginManifest,
    state: &DevModeState,
    plugin_root: &Path,
    storage_root: &Path,
) -> Result<(), String> {
    if build.is_dev() {
        return Ok(());
    }
    if manifest.trust != Some(PluginTrust::Sandboxed) {
        return Err(DEV_PLUGIN_NOT_SANDBOXED.to_string());
    }
    if manifest.id.starts_with(FIRST_PARTY_PREFIX) {
        return Err(DEV_PLUGIN_ID_RESERVED.to_string());
    }
    if installed_plugin_ids(plugin_root)?
        .iter()
        .any(|id| id == &manifest.id)
    {
        return Err(DEV_PLUGIN_ID_INSTALLED.to_string());
    }
    if storage_exists(storage_root, &manifest.id) && !state.records_id(&manifest.id) {
        return Err(DEV_PLUGIN_STORAGE_TAKEN.to_string());
    }
    Ok(())
}

/// `plugin-data/<id>` 가 있는가. `NotFound` 가 아닌 실패는 "있다" 로 친다 — 없음을 보이지
/// 못했으므로 `admit_manifest` 는 거부로 끝난다. `id` 는 `read_manifest_at` 의
/// `validate_manifest` 를 지난 값이라(`[a-z0-9-]`) 경로 한 조각이다.
fn storage_exists(storage_root: &Path, id: &str) -> bool {
    match std::fs::symlink_metadata(storage_root.join(id)) {
        Ok(_) => true,
        Err(e) => e.kind() != std::io::ErrorKind::NotFound,
    }
}

/// 설치된 플러그인의 id — 설치 디렉터리 이름이 곧 id 다(`install.rs` 의 commit 이
/// `plugin_root.join(manifest.id())` 에 둔다). 매니페스트를 읽지 않는 이유: 깨진 매니페스트로
/// 남은 설치본도 저장소는 쥐고 있다. 점으로 시작하는 이름(`.staging`)은 설치본이 아니다.
/// 루트가 없으면 설치본이 없는 것이고, 그 밖의 읽기 실패는 오류다 — 충돌이 없음을 보이지
/// 못했으므로 호출자(`admit_manifest`)는 거부로 끝난다.
fn installed_plugin_ids(plugin_root: &Path) -> Result<Vec<String>, String> {
    let entries = match std::fs::read_dir(plugin_root) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(format!("installed plugins could not be listed: {e}")),
    };
    let mut ids = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| format!("installed plugins could not be listed: {e}"))?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue;
        }
        // `Path::is_dir()` swallows a stat failure and reports `false` — that would treat
        // an entry this can't read as "not installed" (fails open). `metadata` (follows
        // symlinks, same as `is_dir()`) lets a failure other than the entry having vanished
        // reach the caller as the documented error.
        let is_dir = match std::fs::metadata(entry.path()) {
            Ok(meta) => meta.is_dir(),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => false,
            Err(e) => return Err(format!("installed plugins could not be listed: {e}")),
        };
        if is_dir {
            ids.push(name);
        }
    }
    Ok(ids)
}

/// 읽기는 실패하지 않는다 — 없음·손상은 꺼짐·빈 목록이다 (fail-closed, §331 과 같다).
pub fn load_from(path: &Path) -> DevModeState {
    match std::fs::read_to_string(path) {
        Ok(content) => serde_json::from_str(&content).unwrap_or_else(|e| {
            log::warn!(
                "[plugin] §379 {STORE_FILE} is unreadable — developer mode off, no folders: {e}"
            );
            DevModeState::default()
        }),
        Err(_) => DevModeState::default(),
    }
}

fn save_to(path: &Path, state: &DevModeState) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension("json.tmp");
    let content = serde_json::to_string_pretty(state).map_err(|e| e.to_string())?;
    std::fs::write(&tmp, content).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, path).map_err(|e| e.to_string())
}

/// 옛 목록(`config.json` 의 `plugin.devFolders`, JSON 문자열 배열)을 R1 모양으로. 손상은 빈 목록.
fn migrated(legacy: Option<String>) -> DevModeState {
    let paths: Vec<String> = legacy
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default();
    let mut state = DevModeState::default();
    for path in paths {
        if state.find(&path).is_none() {
            state.folders.push(DevFolder {
                path,
                ids: Vec::new(),
                consent: None,
            });
        }
    }
    state
}

/// R1 을 읽는다. 파일이 없으면 dev 빌드는 옛 목록을 한 번 옮겨 파일로 남기고, 릴리스
/// 빌드는 기본값(꺼짐·빈 목록)을 돌려준다 — `legacy` 를 부르지도, 파일을 쓰지도 않는다.
///
/// ‼️ 릴리스가 옛 목록을 옮기지 않는 이유 (spec 0058 R1): 그 키는 v0.4.0·v0.4.1(관문 없는 추가),
/// 같은 앱 데이터 디렉터리를 쓰는 dev 빌드, 그리고 웹뷰의 `set_config` 가 쓴다 — 릴리스가 들이면
/// 사용자가 고르지 않은 폴더가 목록에 든다. dev 빌드가 옮긴 항목도 승인된 폴더라는 보장은 없다 —
/// 그래서 asset scope 부여는 목록 소속이 아니라 승인 저장소로 가른다(`plugin_dev_cmd::admit_folder`).
/// 옛 키는 지우지 않는다 — dev 빌드의 목록이기도 하다.
pub fn load_or_migrate(
    store: &Path,
    build: Build,
    legacy: impl FnOnce() -> Option<String>,
) -> DevModeState {
    let _guard = DEV_MODE_MUTEX.lock().unwrap_or_else(|e| e.into_inner());
    load_or_migrate_locked(store, build, legacy)
}

fn load_or_migrate_locked(
    store: &Path,
    build: Build,
    legacy: impl FnOnce() -> Option<String>,
) -> DevModeState {
    if store.exists() || !build.is_dev() {
        return load_from(store);
    }
    let state = migrated(legacy());
    if let Err(e) = save_to(store, &state) {
        log::warn!("[plugin] §379 could not record the migrated dev folder list: {e}");
    }
    state
}

/// 읽고-고치고-쓴다. `edit` 이 `Err` 를 돌려주면 아무것도 쓰지 않는다.
pub fn update<T>(
    store: &Path,
    build: Build,
    legacy: impl FnOnce() -> Option<String>,
    edit: impl FnOnce(&mut DevModeState) -> Result<T, String>,
) -> Result<T, String> {
    let _guard = DEV_MODE_MUTEX
        .lock()
        .map_err(|_| "잠금 획득 실패".to_string())?;
    let mut state = load_or_migrate_locked(store, build, legacy);
    let out = edit(&mut state)?;
    save_to(store, &state)?;
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manifest(id: &str, trust: Option<&str>) -> PluginManifest {
        let mut value = serde_json::json!({
            "id": id, "name": "Dev", "description": "", "version": "1.0.0", "author": "",
            "license": "MIT", "main": "index.mjs", "engines": { "baram": ">=0.2.0" },
            "capabilities": ["statusbar"]
        });
        if let Some(trust) = trust {
            value["trust"] = serde_json::json!(trust);
        }
        serde_json::from_value(value).expect("fixture manifest parses")
    }

    fn folder(path: &str) -> DevFolder {
        DevFolder {
            path: path.into(),
            ids: Vec::new(),
            consent: None,
        }
    }

    /// `admit_manifest` against an empty list and an empty storage root — for the checks
    /// that do not involve storage.
    fn admit(build: Build, manifest: &PluginManifest, plugin_root: &Path) -> Result<(), String> {
        let storage = tempfile::tempdir().unwrap();
        admit_manifest(
            build,
            manifest,
            &DevModeState::default(),
            plugin_root,
            storage.path(),
        )
    }

    /// Handed to the migration where it must NOT read the legacy list.
    fn never_read() -> Option<String> {
        panic!("the legacy config.json dev-folder list must not be read here")
    }

    #[test]
    fn developer_mode_is_active_in_a_dev_build_or_when_the_user_turned_it_on() {
        let off = DevModeState::default();
        let on = DevModeState {
            enabled: true,
            ..DevModeState::default()
        };
        assert!(developer_mode_active(Build::dev(), &off));
        assert!(developer_mode_active(Build::dev(), &on));
        assert!(!developer_mode_active(Build::release(), &off));
        assert!(developer_mode_active(Build::release(), &on));
    }

    #[test]
    fn a_release_build_with_developer_mode_off_sees_no_folders() {
        let mut state = DevModeState {
            folders: vec![folder("/stored/plugin")],
            ..DevModeState::default()
        };
        assert!(visible_folders(Build::release(), &state).is_empty());
        // The positive half: the same stored list IS visible once the user turns it on,
        // and in a dev build regardless.
        state.enabled = true;
        assert_eq!(
            visible_folders(Build::release(), &state),
            &[folder("/stored/plugin")][..]
        );
        state.enabled = false;
        assert_eq!(visible_folders(Build::dev(), &state).len(), 1);
    }

    #[test]
    fn a_release_build_admits_only_sandboxed_manifests() {
        let root = tempfile::tempdir().unwrap();
        for trust in [Some("trusted"), None] {
            assert_eq!(
                admit(Build::release(), &manifest("dev-x", trust), root.path()),
                Err(DEV_PLUGIN_NOT_SANDBOXED.to_string()),
                "trust {trust:?}"
            );
        }
        assert_eq!(
            admit(
                Build::release(),
                &manifest("dev-x", Some("sandboxed")),
                root.path()
            ),
            Ok(())
        );
    }

    /// I4-2 — `baram-` is the first-party prefix (spec 0058 7.2 gate 2).
    #[test]
    fn a_release_build_refuses_a_first_party_id() {
        let root = tempfile::tempdir().unwrap();
        assert_eq!(
            admit(
                Build::release(),
                &manifest("baram-x", Some("sandboxed")),
                root.path()
            ),
            Err(DEV_PLUGIN_ID_RESERVED.to_string())
        );
        // Only the PREFIX: an id that merely contains the word passes.
        assert_eq!(
            admit(
                Build::release(),
                &manifest("my-baram-x", Some("sandboxed")),
                root.path()
            ),
            Ok(())
        );
    }

    #[test]
    fn a_release_build_refuses_an_id_an_installed_plugin_holds() {
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir(root.path().join("dev-x")).unwrap();
        std::fs::create_dir(root.path().join(".staging")).unwrap();
        std::fs::write(root.path().join("loose-file"), "x").unwrap();
        let sandboxed = |id: &str| manifest(id, Some("sandboxed"));
        assert_eq!(
            admit(Build::release(), &sandboxed("dev-x"), root.path()),
            Err(DEV_PLUGIN_ID_INSTALLED.to_string())
        );
        // A stray file is not an installed plugin, and an unrelated id passes.
        assert_eq!(
            admit(Build::release(), &sandboxed("loose-file"), root.path()),
            Ok(())
        );
        assert_eq!(
            admit(Build::release(), &sandboxed("other"), root.path()),
            Ok(())
        );
    }

    /// I4-3 — `uninstall_installed` removes the install directory and leaves
    /// `plugin-data/<id>`, so a folder reusing that id would inherit what is in it. The
    /// restart case is the positive half: storage some R1 entry recorded is the folder's own.
    #[test]
    fn a_release_build_refuses_storage_no_folder_recorded() {
        let plugins = tempfile::tempdir().unwrap();
        let storage = tempfile::tempdir().unwrap();
        std::fs::create_dir(storage.path().join("dev-x")).unwrap();
        let sandboxed = manifest("dev-x", Some("sandboxed"));
        let unrecorded = DevModeState {
            folders: vec![folder("/a")],
            ..DevModeState::default()
        };
        let admit_with = |state: &DevModeState, m: &PluginManifest, build: Build| {
            admit_manifest(build, m, state, plugins.path(), storage.path())
        };

        assert_eq!(
            admit_with(&unrecorded, &sandboxed, Build::release()),
            Err(DEV_PLUGIN_STORAGE_TAKEN.to_string())
        );
        let recorded = DevModeState {
            folders: vec![DevFolder {
                path: "/a".into(),
                ids: vec!["dev-x".into()],
                consent: None,
            }],
            ..DevModeState::default()
        };
        assert_eq!(admit_with(&recorded, &sandboxed, Build::release()), Ok(()));
        // No storage for the id: nothing to inherit.
        assert_eq!(
            admit_with(
                &unrecorded,
                &manifest("dev-y", Some("sandboxed")),
                Build::release()
            ),
            Ok(())
        );
    }

    #[test]
    fn storage_that_cannot_be_read_counts_as_taken() {
        let plugins = tempfile::tempdir().unwrap();
        let dir = tempfile::tempdir().unwrap();
        let not_a_dir = dir.path().join("plugin-data");
        std::fs::write(&not_a_dir, "x").unwrap();
        assert_eq!(
            admit_manifest(
                Build::release(),
                &manifest("dev-x", Some("sandboxed")),
                &DevModeState::default(),
                plugins.path(),
                &not_a_dir
            ),
            Err(DEV_PLUGIN_STORAGE_TAKEN.to_string())
        );
    }

    /// Spec 0058 R3: a dev build keeps today's behaviour — a trusted folder loads, a folder
    /// may shadow an installed plugin of the same id, and none of I4's checks apply.
    #[test]
    fn a_dev_build_admits_what_a_release_build_refuses() {
        let plugins = tempfile::tempdir().unwrap();
        let storage = tempfile::tempdir().unwrap();
        std::fs::create_dir(plugins.path().join("baram-x")).unwrap();
        std::fs::create_dir(storage.path().join("baram-x")).unwrap();
        assert_eq!(
            admit_manifest(
                Build::dev(),
                &manifest("baram-x", Some("trusted")),
                &DevModeState::default(),
                plugins.path(),
                storage.path()
            ),
            Ok(())
        );
    }

    #[test]
    fn a_release_build_refuses_when_it_cannot_list_installed_plugins() {
        let dir = tempfile::tempdir().unwrap();
        let not_a_dir = dir.path().join("plugins");
        std::fs::write(&not_a_dir, "x").unwrap();
        let sandboxed = manifest("dev-x", Some("sandboxed"));
        assert!(admit(Build::release(), &sandboxed, &not_a_dir).is_err());
        // …while a plugin root that does not exist yet means nothing is installed.
        assert_eq!(
            admit(Build::release(), &sandboxed, &dir.path().join("absent")),
            Ok(())
        );
    }

    /// The other fail-closed edge: not the plugin root itself missing, but ONE ENTRY inside
    /// it that cannot be stat'd. `Path::is_dir()` would swallow that and report `false`
    /// (treated as "not installed" — I4-1 fails open for it). A self-referencing symlink
    /// makes `std::fs::metadata` (which follows symlinks) fail with ELOOP, not NotFound, so
    /// this pins the branch NotFound-only handling would miss.
    #[cfg(unix)]
    #[test]
    fn a_release_build_refuses_when_an_entry_cannot_be_stat_ed() {
        let root = tempfile::tempdir().unwrap();
        std::os::unix::fs::symlink(root.path().join("loop"), root.path().join("loop")).unwrap();
        let sandboxed = manifest("dev-x", Some("sandboxed"));
        let err = admit(Build::release(), &sandboxed, root.path()).unwrap_err();
        assert!(
            err.contains("installed plugins could not be listed"),
            "{err}"
        );
    }

    #[test]
    fn recording_an_id_touches_only_a_listed_folder() {
        let mut state = DevModeState {
            folders: vec![folder("/a")],
            ..DevModeState::default()
        };
        state.record_id("/b", "dev-x");
        assert!(
            !state.records_id("dev-x"),
            "an unlisted path must not record anything"
        );
        state.record_id("/a", "dev-x");
        assert!(state.records_id("dev-x"));
        assert_eq!(state.find("/a").unwrap().ids, vec!["dev-x".to_string()]);
    }

    /// The record is a SET: a folder whose author changed the id keeps the old one, so the
    /// storage seeded under it is still the folder's — and still "held" (plan 0106 P22·P25).
    #[test]
    fn a_changed_id_is_added_to_the_record_not_swapped_in() {
        let mut state = DevModeState {
            folders: vec![folder("/a")],
            ..DevModeState::default()
        };
        state.record_id("/a", "dev-x");
        state.record_id("/a", "dev-x");
        state.record_id("/a", "dev-y");
        assert_eq!(
            state.find("/a").unwrap().ids,
            vec!["dev-x".to_string(), "dev-y".to_string()],
            "deduplicated, in the order recorded"
        );
        assert!(state.records_id("dev-x"));
    }

    #[test]
    fn a_missing_or_corrupt_file_is_off_and_empty() {
        let dir = tempfile::tempdir().unwrap();
        let store = dir.path().join(STORE_FILE);
        assert_eq!(load_from(&store), DevModeState::default());
        std::fs::write(&store, "{ not json").unwrap();
        assert_eq!(load_from(&store), DevModeState::default());
    }

    /// The spec's v1 shape (`{ path, consent? }`) has no `ids` — such a file still reads, with an
    /// empty set, so nothing written before the field existed has to be migrated.
    #[test]
    fn the_file_reads_in_the_documented_shape_with_or_without_ids() {
        let dir = tempfile::tempdir().unwrap();
        let store = dir.path().join(STORE_FILE);
        std::fs::write(
            &store,
            r#"{"version":1,"enabled":true,"folders":[{"path":"/a"},{"path":"/b","consent":{"capabilities":["statusbar"],"trust":"sandboxed"}},{"path":"/c","ids":["dev-c"]}]}"#,
        )
        .unwrap();
        let state = load_from(&store);
        assert!(state.enabled);
        assert_eq!(state.folders[0], folder("/a"));
        assert_eq!(
            state.folders[1].consent,
            Some(DevConsent {
                capabilities: vec!["statusbar".into()],
                trust: PluginTrust::Sandboxed,
            })
        );
        assert_eq!(state.folders[2].ids, vec!["dev-c".to_string()]);
    }

    #[test]
    fn a_release_build_never_reads_the_legacy_list() {
        let dir = tempfile::tempdir().unwrap();
        let store = dir.path().join(STORE_FILE);
        assert_eq!(
            load_or_migrate(&store, Build::release(), never_read),
            DevModeState::default()
        );
        assert!(
            !store.exists(),
            "a release build must not write a migrated list either"
        );
    }

    #[test]
    fn a_dev_build_migrates_the_legacy_list_once() {
        let dir = tempfile::tempdir().unwrap();
        let store = dir.path().join(STORE_FILE);
        let first = load_or_migrate(&store, Build::dev(), || {
            Some(r#"["/a","/b","/a"]"#.to_string())
        });
        assert_eq!(first.folders, vec![folder("/a"), folder("/b")]);
        assert!(!first.enabled);
        assert!(
            store.exists(),
            "the migration must leave the file, or it runs again"
        );
        // Once: the file exists now, so the legacy list is not consulted again.
        assert_eq!(load_or_migrate(&store, Build::dev(), never_read), first);
    }

    #[test]
    fn a_corrupt_legacy_list_migrates_as_empty() {
        let dir = tempfile::tempdir().unwrap();
        let store = dir.path().join(STORE_FILE);
        let state = load_or_migrate(&store, Build::dev(), || Some("not json".into()));
        assert_eq!(state.folders, Vec::<DevFolder>::new());
    }

    #[test]
    fn an_edit_that_fails_writes_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let store = dir.path().join(STORE_FILE);
        std::fs::write(&store, r#"{"version":1,"folders":[{"path":"/a"}]}"#).unwrap();
        let refused = update(&store, Build::release(), never_read, |state| {
            state.remove_folder("/a");
            Err::<(), _>("refused".to_string())
        });
        assert_eq!(refused, Err("refused".to_string()));
        assert_eq!(load_from(&store).folders, vec![folder("/a")]);
        // The positive half: the same edit, allowed, lands.
        update(&store, Build::release(), never_read, |state| {
            state.remove_folder("/a");
            Ok(())
        })
        .unwrap();
        assert!(load_from(&store).folders.is_empty());
    }

    /// ‼️ Everything that can make a `Build` in production, enumerated: the three
    /// `Self { dev… }` constructions — `current()`, which reads the compile-time flag, and the
    /// two `#[cfg(test)]` constructors — and the one `Build { dev… }` in this file, which is the
    /// struct DEFINITION with exactly the derives listed below (no `Default`, no `Deserialize`:
    /// a derive constructs without a literal, and this scan could not see it). The private field
    /// keeps every other module out; this keeps THIS module honest. A fourth construction would
    /// hand every dev command a dev build inside a release binary — the defect class PR #738
    /// closed — and no behavioural test could see it, because tests run as a debug build.
    ///
    /// The needles are the squashed form of what rustfmt WRITES (`src-tauri/rustfmt.toml`):
    /// - `struct_lit_width` (default 18) breaks `Self { dev: cfg!(debug_assertions) }` over
    ///   lines with a trailing comma — `Self{dev:cfg!(debug_assertions),}`;
    /// - `use_field_init_shorthand = true` turns `Self { dev: dev }` into `Self { dev }`, so the
    ///   counts use `Self{dev` and `Build{dev` WITHOUT the colon — `Self{dev:` would miss a
    ///   `from_flag(dev: bool) -> Self { Self { dev } }`.
    ///
    /// No doc comment above the test module may spell `Self { dev` or `Build { dev`.
    #[test]
    fn the_only_production_build_is_the_compiled_one() {
        let squashed: String = include_str!("dev_mode.rs")
            .split_once(concat!("#[cfg(test)]\nmod ", "tests {"))
            .expect("this file has a test module")
            .0
            .chars()
            .filter(|c| !c.is_whitespace())
            .collect();
        assert_eq!(
            squashed.matches(concat!("Self{", "dev")).count(),
            3,
            "Build is constructed somewhere new"
        );
        assert_eq!(
            squashed.matches(concat!("Build{", "dev")).count(),
            1,
            "a `Build {{ dev… }}` other than the definition"
        );
        assert_eq!(
            squashed
                .matches(concat!(
                    "#[derive(Clone,Copy,Debug,PartialEq,Eq)]",
                    "pubstructBuild{dev:bool,}"
                ))
                .count(),
            1,
            "the definition or its derives changed"
        );
        assert_eq!(
            squashed
                .matches(concat!("Self{dev:", "cfg!(debug_assertions),}"))
                .count(),
            1,
            "current() must build from the compile-time flag"
        );
        assert_eq!(
            squashed
                .matches(concat!(
                    "#[cfg(test)]implBuild{pubfndev()->Self{Self{dev:true}}",
                    "pubfnrelease()->Self{Self{dev:false}}}"
                ))
                .count(),
            1,
            "the test constructors must stay behind #[cfg(test)]"
        );
    }

    #[test]
    fn adding_a_listed_folder_keeps_its_consent() {
        let mut state = DevModeState::default();
        let consent = DevConsent {
            capabilities: vec!["statusbar".into()],
            trust: PluginTrust::Sandboxed,
        };
        state.add_folder("/a");
        state
            .record_consent(Build::release(), "/a", consent.clone())
            .unwrap();
        assert_eq!(state.add_folder("/a").consent, Some(consent));
        assert_eq!(
            state.folders.len(),
            1,
            "a re-pick must not duplicate the entry"
        );
    }

    /// Recording a consent can never grow the list (spec 0058 R2).
    #[test]
    fn consent_is_recorded_only_for_a_listed_folder() {
        let mut state = DevModeState::default();
        let consent = DevConsent {
            capabilities: vec![],
            trust: PluginTrust::Sandboxed,
        };
        assert_eq!(
            state.record_consent(Build::dev(), "/a", consent.clone()),
            Err(DEV_FOLDER_NOT_LISTED.to_string())
        );
        assert!(state.folders.is_empty());
        state.add_folder("/a");
        assert_eq!(state.record_consent(Build::dev(), "/a", consent), Ok(()));
    }

    #[test]
    fn a_release_build_refuses_to_record_a_trusted_consent() {
        let mut state = DevModeState::default();
        state.add_folder("/a");
        let trusted = DevConsent {
            capabilities: vec![],
            trust: PluginTrust::Trusted,
        };
        assert_eq!(
            state.record_consent(Build::release(), "/a", trusted.clone()),
            Err(DEV_PLUGIN_NOT_SANDBOXED.to_string())
        );
        assert_eq!(state.find("/a").unwrap().consent, None);
        // A dev build does not restrict the tier (spec R3).
        assert_eq!(state.record_consent(Build::dev(), "/a", trusted), Ok(()));
    }

    /// I4, the reverse direction: what the install commit refuses. Only an ACTIVE RELEASE
    /// developer mode holds ids — a dev build's folder may stand in for an install (spec R3),
    /// and with the switch off nothing is loaded that could seed storage now.
    #[test]
    fn only_an_active_release_developer_mode_holds_ids() {
        let mut state = DevModeState {
            enabled: true,
            folders: vec![
                DevFolder {
                    path: "/a".into(),
                    ids: vec!["dev-x".into(), "dev-y".into()],
                    consent: None,
                },
                DevFolder {
                    path: "/b".into(),
                    ids: vec!["dev-x".into()],
                    consent: None,
                },
            ],
            ..DevModeState::default()
        };
        assert_eq!(
            held_ids(Build::release(), &state),
            vec!["dev-x".to_string(), "dev-y".to_string()],
            "every recorded id, once"
        );
        assert!(held_ids(Build::dev(), &state).is_empty());
        state.enabled = false;
        assert!(held_ids(Build::release(), &state).is_empty());
    }

    #[test]
    fn forgetting_an_id_clears_it_from_every_folder_and_nothing_else() {
        let mut state = DevModeState {
            folders: vec![
                DevFolder {
                    path: "/a".into(),
                    ids: vec!["dev-x".into(), "dev-y".into()],
                    consent: None,
                },
                DevFolder {
                    path: "/b".into(),
                    ids: vec!["dev-x".into()],
                    consent: None,
                },
            ],
            ..DevModeState::default()
        };
        state.forget_id("dev-x");
        assert!(!state.records_id("dev-x"));
        assert_eq!(state.find("/a").unwrap().ids, vec!["dev-y".to_string()]);
        assert_eq!(state.folders.len(), 2, "the folders themselves stay listed");
    }
}
