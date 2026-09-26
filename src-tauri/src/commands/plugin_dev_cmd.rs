// §379 개발자 모드 — dev 폴더 커맨드 (spec 0058 §6.2 R2).
//
// 판정은 `plugin::dev_mode` 에 있고, 이 파일은 앱에 닿는 얇은 층이다 — R1 파일이 어디 있는지
// (`DevModeHost`), 네이티브 대화상자(폴더 피커·켜기 확인창, `DevDialogs`), asset scope 부여,
// 옛 목록 읽기. 공개 커맨드는 빌드를 받지 않고 코어에 `Build::current()` 를 넘긴다. 테스트는
// 코어에 `Build::release()` 를 넘겨 릴리스 분기를 본다.
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager, Runtime, State};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tokio::sync::oneshot;

use crate::approval::{self, Decision};
use crate::plugin;
use crate::plugin::dev_mode::{self, Build, DevConsent, DevFolder, DevModeState};

/// PR #738 이전의 dev 폴더 목록 — `config.json` 의 키. 여기서 읽는 것은 dev 빌드의 1회 이전뿐이다:
/// `legacy_dev_folders` 는 `dev_mode::load_or_migrate`·`update` 에 클로저로 넘겨질 뿐이고, 그
/// 함수들은 릴리스 빌드에서 이것을 부르지 않는다. 스캔 테스트와 동작 테스트가 둘 다 고정한다.
const LEGACY_DEV_FOLDERS_KEY: &str = "plugin.devFolders";

fn legacy_dev_folders<R: Runtime>(app: &AppHandle<R>) -> Option<String> {
    crate::config::get_config(app, LEGACY_DEV_FOLDERS_KEY)
        .ok()
        .flatten()
}

/// 네이티브 대화상자 — 확인자 주입 지점 (spec 0058 §6.2 "테스트 가능성").
///
/// 테스트는 대본대로 답하는 구현을 `DevModeHost` 에 넣어 승낙·거절을 고른다. 이전의
/// `plugin_add_dev_folder_refuses_an_unapproved_path_through_generate_handler`
/// (`commands/plugin_cmd.rs`, §329.6 이 더하고 44f30762 이 지웠다)는 해석 실패 분기만 지나
/// 대화상자를 띄운 적이 없었다 — 이 트레이트가 그 빈자리다.
pub trait DevDialogs: Send + Sync {
    /// 폴더 피커. 고른 폴더, 또는 취소면 `Ok(None)` — 피커 자체의 실패(예: 경로 해석 실패)는
    /// `Err` 다(§332 `pick_approved_dir` 와 같은 구분, M2 리뷰: 실패를 취소로 뭉개지 않는다).
    fn pick_folder(&self, title: String) -> oneshot::Receiver<Result<Option<PathBuf>, String>>;
    /// 확인 대화상자. 승낙이면 `true`.
    fn confirm(&self, copy: DialogCopy) -> oneshot::Receiver<bool>;
}

/// 확인 대화상자의 문구 — 로케일은 호출자가 고른다(`is_korean`).
pub struct DialogCopy {
    pub title: String,
    pub body: String,
    pub ok: String,
    pub cancel: String,
}

/// 앱의 것. `blocking_*` 이 아니라 콜백 + oneshot — `approval_cmd::ensure_approved` 와 같은 이유.
struct NativeDevDialogs<R: Runtime> {
    app: AppHandle<R>,
}

impl<R: Runtime> DevDialogs for NativeDevDialogs<R> {
    fn pick_folder(&self, title: String) -> oneshot::Receiver<Result<Option<PathBuf>, String>> {
        let (tx, rx) = oneshot::channel();
        self.app
            .dialog()
            .file()
            .set_title(title)
            .pick_folder(move |picked| {
                let _ = tx.send(
                    picked
                        .map(|p| p.into_path().map_err(|e| e.to_string()))
                        .transpose(),
                );
            });
        rx
    }

    fn confirm(&self, copy: DialogCopy) -> oneshot::Receiver<bool> {
        let (tx, rx) = oneshot::channel();
        self.app
            .dialog()
            .message(copy.body)
            .title(copy.title)
            .kind(MessageDialogKind::Warning)
            .buttons(MessageDialogButtons::OkCancelCustom(copy.ok, copy.cancel))
            .show(move |granted| {
                let _ = tx.send(granted);
            });
        rx
    }
}

/// 피커 제목 — 피커에는 본문 자리가 없다(§332 `pick_approved_dir` 와 같은 한계).
fn picker_title(korean: bool) -> &'static str {
    if korean {
        "개발 중인 플러그인 폴더 선택"
    } else {
        "Choose a plugin development folder"
    }
}

/// 개발자 모드를 켜기 전의 경고 (R2). 끄기는 묻지 않는다 — 좁히는 방향이다.
fn enable_warning(korean: bool) -> DialogCopy {
    if korean {
        DialogCopy {
            title: "개발자 모드를 켤까요?".into(),
            body: "개발자 모드는 고른 폴더의 플러그인을 레지스트리 검증 없이 실행합니다. \
                   sandboxed 플러그인만 불러올 수 있고, 플러그인마다 불러오기 전에 권한을 묻습니다.\n\n\
                   다른 사람이 보낸 폴더는 불러오지 마십시오."
                .into(),
            ok: "켜기".into(),
            cancel: "취소".into(),
        }
    } else {
        DialogCopy {
            title: "Turn on developer mode?".into(),
            body: "Developer mode runs plugins from folders you choose, without the registry's \
                   checks. Only sandboxed plugins can load, and each one asks for its permissions \
                   before it loads.\n\nDo not load a folder someone else sent you."
                .into(),
            ok: "Turn On".into(),
            cancel: "Cancel".into(),
        }
    }
}

/// dev 커맨드가 기대는 장소 — managed state (`lib.rs` 의 `setup`). plan 0106 P8 이 말하는 단일
/// 주입 지점이다: 세 디렉터리뿐 아니라 `dialogs`(네이티브 피커·확인창, `DevDialogs`)도 여기서
/// 갈린다 — 테스트는 `ScriptedDialogs` 를, 앱은 `NativeDevDialogs` 를 심는다.
///
/// 앱에서는 앱 데이터 디렉터리 · `~/.baram/plugins` · `~/.baram/plugin-data`, 테스트에서는
/// tempdir 다. ‼️ 세 디렉터리가 주입 지점인 이유: `tauri::test::mock_context` 의 identifier 가
/// 빈 문자열이라 `app.path().app_data_dir()`(= `dirs::data_dir()` 에 identifier 를 이어붙인
/// 것, `tauri-2.11.5` `path/desktop.rs`)이 identifier 없이 `data_dir()` 자체가 된다 — macOS 에서는
/// `~/Library/Application Support` 자체다. 그리로 쓰는 테스트는 개발자 머신에 파일을 남긴다.
/// 두 루트도 같은 이유로 여기 있다 — I4 의 판정이 실제 홈을 보지 않게.
pub struct DevModeHost {
    data_dir: PathBuf,
    plugin_root: PathBuf,
    storage_root: PathBuf,
    dialogs: Box<dyn DevDialogs>,
}

impl DevModeHost {
    pub fn native<R: Runtime>(app: &AppHandle<R>) -> Result<Self, String> {
        Ok(Self {
            data_dir: app.path().app_data_dir().map_err(|e| e.to_string())?,
            plugin_root: plugin::get_plugin_dir().map_err(|e| e.to_string())?,
            storage_root: plugin::plugin_data_root()?,
            dialogs: Box::new(NativeDevDialogs { app: app.clone() }),
        })
    }

    #[cfg(test)]
    fn at(
        data_dir: PathBuf,
        plugin_root: PathBuf,
        storage_root: PathBuf,
        dialogs: impl DevDialogs + 'static,
    ) -> Self {
        Self {
            data_dir,
            plugin_root,
            storage_root,
            dialogs: Box::new(dialogs),
        }
    }

    fn store_file(&self) -> PathBuf {
        self.data_dir.join(dev_mode::STORE_FILE)
    }

    /// `approval::load`·`approve` 가 여는 것과 같은 파일 — 같은 디렉터리, `approval::STORE_FILE`.
    fn approvals_file(&self) -> PathBuf {
        self.data_dir.join(approval::STORE_FILE)
    }

    fn load<R: Runtime>(&self, app: &AppHandle<R>, build: Build) -> DevModeState {
        dev_mode::load_or_migrate(&self.store_file(), build, || legacy_dev_folders(app))
    }

    fn update<R: Runtime, T>(
        &self,
        app: &AppHandle<R>,
        build: Build,
        edit: impl FnOnce(&mut DevModeState) -> Result<T, String>,
    ) -> Result<T, String> {
        dev_mode::update(&self.store_file(), build, || legacy_dev_folders(app), edit)
    }
}

/// `plugin_list_dev` 의 답.
///
/// `active` 는 `dev_mode::developer_mode_active` 의 답 그대로다 — 프런트가 `devBuild || enabled`
/// 를 다시 계산하지 않는다(판정은 하나, spec 0058 R2). `devBuild` 는 프런트가 동의를 물을지와
/// 폐기를 면제할지를 가른다(F2·F3).
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DevModeSnapshot {
    pub active: bool,
    pub dev_build: bool,
    pub enabled: bool,
    pub folders: Vec<DevFolderRow>,
}

/// 폴더 하나 — `folder_row` 가 `plugin` 과 `error` 중 하나만 채운다. `ids` 는 이 폴더가 쥔
/// id 들이다 — R1 의 기록에, 릴리스 빌드가 방금 받아들였으면 그 매니페스트 id 를 더한 것.
/// 프런트의 설치 흐름이 UX 선거부에 읽는다(I4 의 반대 방향, plan 0106 P23).
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DevFolderRow {
    pub consent: Option<DevConsent>,
    pub error: Option<String>,
    pub ids: Vec<String>,
    pub path: String,
    pub plugin: Option<plugin::InstalledPluginInfo>,
}

/// 폴더 하나를 로드 가능한 dev 플러그인으로 만든다 — 승인 → 매니페스트 → R3·I4 → id 기록 →
/// asset scope 부여, 이 순서로. 앞 단계가 거부하면 뒤 단계는 없다.
///
/// ‼️ 부여 앞의 승인 판정 (스펙 R2): 피커가 더한 폴더는 그 선택이 승인으로 기록돼 있지만, dev
/// 빌드가 옮겨 온 옛 목록은 `config.json` — 웹뷰가 쓰는 파일 — 에서 왔다. 그래서 목록 소속이
/// 아니라 승인 저장소가 이 폴더를 덮는지로 부여를 가른다(다이얼로그 없음). 설정에서 그 승인을
/// 회수하면 다음 목록부터 부여가 멈춘다.
///
/// ‼️ id 기록이 부여 **앞**에 있는 이유 (I4-3, plan 0106 P22): 부여 뒤에는 코드가 돌 수 있고,
/// 그 코드가 만드는 `plugin-data/<id>` 는 기록이 먼저 있어야 다음 실행에 이 폴더의 것으로
/// 읽힌다. 릴리스 빌드에서만, 기록에 매니페스트 id 가 없을 때만 쓴다.
fn admit_folder<R: Runtime>(
    app: &AppHandle<R>,
    host: &DevModeHost,
    build: Build,
    state: &DevModeState,
    entry: &DevFolder,
) -> Result<plugin::InstalledPluginInfo, String> {
    match approval::decide(&approval::load_from(&host.approvals_file()), &entry.path).0 {
        Decision::Allowed => {}
        Decision::Unresolvable => return Err(dev_mode::DEV_FOLDER_MISSING.to_string()),
        Decision::NeedsConfirmation => return Err(dev_mode::DEV_FOLDER_NOT_APPROVED.to_string()),
    }
    let folder = Path::new(&entry.path);
    let manifest = plugin::read_manifest_at(folder).map_err(|e| e.to_string())?;
    dev_mode::admit_manifest(
        build,
        &manifest,
        state,
        &host.plugin_root,
        &host.storage_root,
    )?;
    if !build.is_dev() && !entry.ids.iter().any(|recorded| recorded == &manifest.id) {
        host.update(app, build, |stored| {
            stored.record_id(&entry.path, &manifest.id);
            Ok(())
        })?;
    }
    app.asset_protocol_scope()
        .allow_directory(folder, true)
        .map_err(|e| e.to_string())?;
    Ok(plugin::InstalledPluginInfo {
        manifest,
        install_path: entry.path.clone(),
        checksum: String::new(),
        is_dev: true,
    })
}

/// 목록의 한 줄 — 거부는 행 오류로 남는다(사라진 폴더·깨진 매니페스트는 지금처럼, spec 6.3).
fn folder_row<R: Runtime>(
    app: &AppHandle<R>,
    host: &DevModeHost,
    build: Build,
    state: &DevModeState,
    entry: &DevFolder,
) -> DevFolderRow {
    let (plugin, error) = match admit_folder(app, host, build, state, entry) {
        Ok(info) => (Some(info), None),
        Err(error) => {
            log::warn!("[plugin] dev folder {}: {error}", entry.path);
            (None, Some(error))
        }
    };
    // Admitted in a release build: `admit_folder` has just recorded the manifest id.
    let mut ids = entry.ids.clone();
    if let (Some(info), false) = (&plugin, build.is_dev()) {
        if !ids.contains(&info.manifest.id) {
            ids.push(info.manifest.id.clone());
        }
    }
    DevFolderRow {
        consent: entry.consent.clone(),
        error,
        ids,
        path: entry.path.clone(),
        plugin,
    }
}

/// R2 — R1 을 읽는다(dev 빌드의 첫 실행이라 파일이 아직 없으면 `config.json` 의 옛 목록을
/// 한 번 옮겨 옴 — `dev_mode::load_or_migrate`). 비활성이면 빈 목록이다. 릴리스 빌드가 폴더를
/// 받아들이며 매니페스트 id 를 새로 기록할 때는 R1 파일을 다시 쓴다(`admit_folder`).
#[tauri::command]
pub async fn plugin_list_dev<R: Runtime>(
    app: AppHandle<R>,
    host: State<'_, DevModeHost>,
) -> Result<DevModeSnapshot, String> {
    Ok(list_dev(&app, &host, Build::current()))
}

fn list_dev<R: Runtime>(app: &AppHandle<R>, host: &DevModeHost, build: Build) -> DevModeSnapshot {
    let state = host.load(app, build);
    DevModeSnapshot {
        active: dev_mode::developer_mode_active(build, &state),
        dev_build: build.is_dev(),
        enabled: state.enabled,
        folders: dev_mode::visible_folders(build, &state)
            .iter()
            .map(|entry| folder_row(app, host, build, &state, entry))
            .collect(),
    }
}

/// R2 — R1 에 이미 있는 경로만 받아 매니페스트를 다시 읽는다. 확인창이 없다.
#[tauri::command]
pub async fn plugin_reload_dev_folder<R: Runtime>(
    app: AppHandle<R>,
    host: State<'_, DevModeHost>,
    path: String,
) -> Result<DevFolderRow, String> {
    reload_dev_folder(&app, &host, Build::current(), &path)
}

fn reload_dev_folder<R: Runtime>(
    app: &AppHandle<R>,
    host: &DevModeHost,
    build: Build,
    path: &str,
) -> Result<DevFolderRow, String> {
    let state = host.load(app, build);
    if !dev_mode::developer_mode_active(build, &state) {
        return Err(dev_mode::DEV_MODE_INACTIVE.to_string());
    }
    let entry = state
        .find(path)
        .ok_or_else(|| dev_mode::DEV_FOLDER_NOT_LISTED.to_string())?;
    let row = folder_row(app, host, build, &state, entry);
    match row.error {
        Some(error) => Err(error),
        None => Ok(row),
    }
}

/// R2 — R1 에서 뺀다. 좁히는 방향이라 확인도, 활성 판정도 없다.
#[tauri::command]
pub async fn plugin_remove_dev_folder<R: Runtime>(
    app: AppHandle<R>,
    host: State<'_, DevModeHost>,
    path: String,
) -> Result<(), String> {
    host.update(&app, Build::current(), |state| {
        state.remove_folder(&path);
        Ok(())
    })
}

/// R2 — Rust 가 네이티브 피커를 띄우고, 사용자가 고른 경로만 R1 에 더한다. 선택 자체가 코드
/// 실행 승인이자 §332 의 경로 승인이다(`approve_at` — `ensure_approved` 는 방금 고른 미승인
/// 폴더에 두 번째 확인창을 띄운다, plan 0106 P5).
///
/// ‼️ 순서가 계약이다 (P6): 매니페스트 → R3 → 승인 기록 → R1 → 부여. 거부된 선택은 승인도,
/// 목록 항목도, scope 도 남기지 않는다.
#[tauri::command]
pub async fn plugin_pick_dev_folder<R: Runtime>(
    app: AppHandle<R>,
    host: State<'_, DevModeHost>,
) -> Result<Option<DevFolderRow>, String> {
    pick_dev_folder(&app, &host, Build::current()).await
}

async fn pick_dev_folder<R: Runtime>(
    app: &AppHandle<R>,
    host: &DevModeHost,
    build: Build,
) -> Result<Option<DevFolderRow>, String> {
    let state = host.load(app, build);
    if !dev_mode::developer_mode_active(build, &state) {
        return Err(dev_mode::DEV_MODE_INACTIVE.to_string());
    }
    let title = picker_title(crate::commands::approval_cmd::is_korean(app)).to_string();
    let Some(picked) = host
        .dialogs
        .pick_folder(title)
        .await
        .map_err(|e| e.to_string())??
    else {
        return Ok(None);
    };
    // ‼️ M1 리뷰 — 피커는 사용자를 기다리는 열린 대기다. 그 사이 개발자 모드가 꺼질 수 있으니,
    // 위에서 읽은 `state` 로 admit_manifest 를 먹이면 안 된다 — 다시 읽고 다시 판정한다.
    let state = host.load(app, build);
    if !dev_mode::developer_mode_active(build, &state) {
        return Err(dev_mode::DEV_MODE_INACTIVE.to_string());
    }
    let canonical = std::fs::canonicalize(&picked).map_err(|e| e.to_string())?;
    let manifest = plugin::read_manifest_at(&canonical).map_err(|e| e.to_string())?;
    dev_mode::admit_manifest(
        build,
        &manifest,
        &state,
        &host.plugin_root,
        &host.storage_root,
    )?;
    approval::approve_at(
        &host.approvals_file(),
        &canonical,
        approval::ApprovalKind::Dir,
    )?;
    let path = canonical.to_string_lossy().into_owned();
    // I4-3 — a release build records the manifest id WITH the folder (spec "고를 때의 매니페스트
    // id"), before anything can run. A dev build records nothing (plan 0106 P22).
    host.update(app, build, |stored| {
        stored.add_folder(&path);
        if !build.is_dev() {
            stored.record_id(&path, &manifest.id);
        }
        Ok(())
    })?;
    let state = host.load(app, build);
    let entry = state
        .find(&path)
        .ok_or_else(|| dev_mode::DEV_FOLDER_NOT_LISTED.to_string())?;
    Ok(Some(folder_row(app, host, build, &state, entry)))
}

/// R2 — F2 의 동의를 R1 항목에 기록한다. 이 커맨드는 목록을 늘리지 못한다.
#[tauri::command]
pub async fn plugin_record_dev_consent<R: Runtime>(
    app: AppHandle<R>,
    host: State<'_, DevModeHost>,
    path: String,
    consent: DevConsent,
) -> Result<(), String> {
    record_dev_consent(&app, &host, Build::current(), path, consent).await
}

async fn record_dev_consent<R: Runtime>(
    app: &AppHandle<R>,
    host: &DevModeHost,
    build: Build,
    path: String,
    consent: DevConsent,
) -> Result<(), String> {
    host.update(app, build, |state| {
        if !dev_mode::developer_mode_active(build, state) {
            return Err(dev_mode::DEV_MODE_INACTIVE.to_string());
        }
        state.record_consent(build, &path, consent)
    })
}

/// R2 — 켜기는 네이티브 경고 확인 뒤, 끄기는 묻지 않는다. 호출 뒤의 켜짐 상태를 돌려준다
/// (거절하면 그대로 `false`). 끈 뒤의 언로드는 프런트가 한다.
#[tauri::command]
pub async fn plugin_set_developer_mode<R: Runtime>(
    app: AppHandle<R>,
    host: State<'_, DevModeHost>,
    enabled: bool,
) -> Result<bool, String> {
    set_developer_mode(&app, &host, Build::current(), enabled).await
}

async fn set_developer_mode<R: Runtime>(
    app: &AppHandle<R>,
    host: &DevModeHost,
    build: Build,
    enabled: bool,
) -> Result<bool, String> {
    let current = host.load(app, build).enabled;
    if enabled && !current {
        let copy = enable_warning(crate::commands::approval_cmd::is_korean(app));
        if !host.dialogs.confirm(copy).await.unwrap_or(false) {
            return Ok(current);
        }
    }
    host.update(app, build, |state| {
        state.enabled = enabled;
        Ok(enabled)
    })
}

/// `plugin_cmd::is_plugin_directory` 가 받는 dev 폴더 — 비활성이면, 또는 host 가 관리되지
/// 않으면 없다.
pub(crate) fn active_dev_folder_paths<R: Runtime>(app: &AppHandle<R>) -> Vec<String> {
    let Some(host) = app.try_state::<DevModeHost>() else {
        return Vec::new();
    };
    let build = Build::current();
    let state = host.load(app, build);
    dev_mode::visible_folders(build, &state)
        .iter()
        .map(|entry| entry.path.clone())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Every writable location a test uses — nothing goes through the mock app's paths.
    struct Fixture {
        data: tempfile::TempDir,
        plugins: tempfile::TempDir,
        sources: tempfile::TempDir,
        storage: tempfile::TempDir,
    }

    /// A tempdir whose name does NOT start with a dot. `tempfile::tempdir()` names it
    /// `.tmpXXXX`, and the asset scope matches with `require_literal_leading_dot` on unix
    /// (`tauri-2.11.5/src/scope/fs.rs`) — keeping dots out of the fixture paths keeps that
    /// option out of what `granted` measures.
    fn dir() -> tempfile::TempDir {
        tempfile::Builder::new()
            .prefix("devmode-")
            .tempdir()
            .unwrap()
    }

    fn fixture() -> Fixture {
        Fixture {
            data: dir(),
            plugins: dir(),
            sources: dir(),
            storage: dir(),
        }
    }

    /// The test half of the confirmer injection seam (spec 0058 §6.2 "테스트 가능성"): answers
    /// every dialog from a script and records which ones were shown.
    ///
    /// `during_pick` runs (if set) after the picker is "shown" but before it answers — the seam
    /// M1's regression test uses to simulate developer mode turning off during the picker's
    /// open-ended wait (e.g. writing R1 with `enabled: false` through the host's data dir).
    #[derive(Default)]
    struct ScriptedDialogs {
        pick: Option<PathBuf>,
        confirm: bool,
        shown: std::sync::Arc<std::sync::Mutex<Vec<&'static str>>>,
        during_pick: Option<Box<dyn Fn() + Send + Sync>>,
    }

    impl DevDialogs for ScriptedDialogs {
        fn pick_folder(
            &self,
            _title: String,
        ) -> tokio::sync::oneshot::Receiver<Result<Option<PathBuf>, String>> {
            self.shown.lock().unwrap().push("pick");
            if let Some(during_pick) = &self.during_pick {
                during_pick();
            }
            let (tx, rx) = tokio::sync::oneshot::channel();
            let _ = tx.send(Ok(self.pick.clone()));
            rx
        }

        fn confirm(&self, _copy: DialogCopy) -> tokio::sync::oneshot::Receiver<bool> {
            self.shown.lock().unwrap().push("confirm");
            let (tx, rx) = tokio::sync::oneshot::channel();
            let _ = tx.send(self.confirm);
            rx
        }
    }

    fn host(f: &Fixture) -> DevModeHost {
        host_with(f, ScriptedDialogs::default())
    }

    fn host_with(f: &Fixture, dialogs: ScriptedDialogs) -> DevModeHost {
        DevModeHost::at(
            f.data.path().to_path_buf(),
            f.plugins.path().to_path_buf(),
            f.storage.path().to_path_buf(),
            dialogs,
        )
    }

    fn shown() -> std::sync::Arc<std::sync::Mutex<Vec<&'static str>>> {
        std::sync::Arc::new(std::sync::Mutex::new(Vec::new()))
    }

    /// A sandboxed `DevConsent` — built from JSON like every other consent in this file's tests,
    /// because `PluginTrust` lives in `plugin::registry`, a module private to `plugin` (this
    /// file is outside it and only `DevConsent`/`DevFolder`, not the tier enum, are re-exported).
    fn sandboxed_consent(capabilities: &[&str]) -> DevConsent {
        serde_json::from_value(serde_json::json!({
            "capabilities": capabilities,
            "trust": "sandboxed"
        }))
        .expect("fixture consent parses")
    }

    /// A plugin folder of the given tier. Canonical, like every path the picker writes into
    /// R1 — on macOS the tempdir under `/var` canonicalizes to `/private/var`.
    fn plugin_folder(root: &Path, id: &str, trust: &str) -> String {
        let dir = root.join(id);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("baram-plugin.json"),
            serde_json::json!({
                "id": id, "name": "Dev", "description": "", "version": "1.0.0", "author": "",
                "license": "MIT", "main": "index.mjs", "engines": { "baram": ">=0.2.0" },
                "capabilities": ["statusbar"], "trust": trust
            })
            .to_string(),
        )
        .unwrap();
        std::fs::canonicalize(&dir)
            .unwrap()
            .to_string_lossy()
            .into_owned()
    }

    /// R1 as it sits on disk — written as literal JSON, so these tests also pin the shape.
    /// ‼️ Every IPC test seeds this FIRST: without the file a dev build migrates, and the
    /// migration reads `config.json` through the mock app's path — the developer's machine.
    fn write_r1(f: &Fixture, r1: serde_json::Value) {
        std::fs::write(f.data.path().join(dev_mode::STORE_FILE), r1.to_string()).unwrap();
    }

    /// R1 as the commands left it.
    fn r1(f: &Fixture) -> DevModeState {
        dev_mode::load_from(&f.data.path().join(dev_mode::STORE_FILE))
    }

    fn approve(f: &Fixture, paths: &[&str]) {
        let store = approval::ApprovalStore {
            version: 1,
            entries: paths
                .iter()
                .map(|p| approval::ApprovalEntry {
                    path: (*p).to_string(),
                    kind: approval::ApprovalKind::Dir,
                    approved_at: 0,
                })
                .collect(),
        };
        std::fs::write(
            f.data.path().join(approval::STORE_FILE),
            serde_json::to_string(&store).unwrap(),
        )
        .unwrap();
    }

    /// Did the asset scope admit this folder? ‼️ OPEN RISK: no test in this crate has asserted
    /// `Scope::is_allowed` on a mock app before (its one production caller is
    /// `protocol/html_preview.rs`). If a POSITIVE `granted` assertion is red although the row
    /// came back with `plugin` set (so `admit_folder` reached the grant), swap the body for
    /// `app.asset_protocol_scope().allowed_patterns().iter().any(|p| p.matches_path(&manifest))`
    /// with `manifest = Path::new(path).join("baram-plugin.json")` — `allowed_patterns()` is
    /// public on the same `Scope` and skips `is_allowed`'s canonicalize — and record the swap in
    /// the task report. Do not weaken a NEGATIVE assertion instead.
    fn granted<R: Runtime>(app: &AppHandle<R>, path: &str) -> bool {
        app.asset_protocol_scope()
            .is_allowed(Path::new(path).join("baram-plugin.json"))
    }

    fn ipc_app(
        host: DevModeHost,
    ) -> (
        tauri::App<tauri::test::MockRuntime>,
        tauri::WebviewWindow<tauri::test::MockRuntime>,
    ) {
        let app = tauri::test::mock_builder()
            .manage(host)
            .invoke_handler(tauri::generate_handler![
                super::plugin_list_dev,
                super::plugin_reload_dev_folder,
                super::plugin_remove_dev_folder,
                super::plugin_pick_dev_folder,
                super::plugin_record_dev_consent,
                super::plugin_set_developer_mode
            ])
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .expect("mock app must build");
        let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .expect("mock webview must build");
        (app, webview)
    }

    fn invoke(
        webview: &tauri::WebviewWindow<tauri::test::MockRuntime>,
        cmd: &str,
        body: serde_json::Value,
    ) -> Result<serde_json::Value, serde_json::Value> {
        tauri::test::get_ipc_response(
            webview,
            tauri::webview::InvokeRequest {
                cmd: cmd.into(),
                callback: tauri::ipc::CallbackFn(0),
                error: tauri::ipc::CallbackFn(1),
                url: if cfg!(any(windows, target_os = "android")) {
                    "http://tauri.localhost"
                } else {
                    "tauri://localhost"
                }
                .parse()
                .unwrap(),
                body: tauri::ipc::InvokeBody::Json(body),
                headers: Default::default(),
                invoke_key: tauri::test::INVOKE_KEY.to_string(),
            },
        )
        .map(|b| b.deserialize::<serde_json::Value>().expect("a JSON answer"))
    }

    /// Through `generate_handler!`: the list comes from R1, and an approved folder is granted.
    #[test]
    fn list_answers_from_the_rust_file_and_grants_an_approved_folder() {
        let f = fixture();
        let path = plugin_folder(f.sources.path(), "dev-x", "sandboxed");
        write_r1(
            &f,
            serde_json::json!({ "version": 1, "enabled": false, "folders": [{ "path": path }] }),
        );
        approve(&f, &[&path]);
        let (app, webview) = ipc_app(host(&f));

        let snapshot = invoke(&webview, "plugin_list_dev", serde_json::json!({}))
            .expect("plugin_list_dev must be registered");

        // Tests are a debug build: developer mode is active without the switch.
        assert_eq!(snapshot["devBuild"], true);
        assert_eq!(snapshot["active"], true);
        assert_eq!(snapshot["enabled"], false);
        assert_eq!(snapshot["folders"][0]["path"], path.as_str());
        assert_eq!(snapshot["folders"][0]["plugin"]["manifest"]["id"], "dev-x");
        assert_eq!(snapshot["folders"][0]["plugin"]["is_dev"], true);
        assert_eq!(snapshot["folders"][0]["error"], serde_json::Value::Null);
        assert!(granted(app.handle(), &path));
    }

    /// ‼️ The grant rests on the approval store, not on R1 membership — a dev build migrates
    /// `config.json` entries nobody approved (plan P4). The test above is the positive half.
    #[test]
    fn an_unapproved_folder_is_listed_with_its_reason_and_granted_nothing() {
        let f = fixture();
        let path = plugin_folder(f.sources.path(), "dev-x", "sandboxed");
        write_r1(
            &f,
            serde_json::json!({ "version": 1, "folders": [{ "path": path }] }),
        );
        let app = tauri::test::mock_app();

        let snapshot = list_dev(app.handle(), &host(&f), Build::dev());

        let row = &snapshot.folders[0];
        assert_eq!(
            row.error.as_deref(),
            Some(dev_mode::DEV_FOLDER_NOT_APPROVED)
        );
        assert!(row.plugin.is_none());
        assert!(!granted(app.handle(), &path));
    }

    #[test]
    fn a_missing_folder_is_a_row_error_and_the_rest_still_load() {
        let f = fixture();
        let path = plugin_folder(f.sources.path(), "dev-x", "sandboxed");
        write_r1(
            &f,
            serde_json::json!({ "version": 1, "folders": [
                { "path": "/definitely/not/here/plugin" }, { "path": path }
            ] }),
        );
        approve(&f, &[&path]);
        let app = tauri::test::mock_app();

        let snapshot = list_dev(app.handle(), &host(&f), Build::dev());

        assert_eq!(
            snapshot.folders[0].error.as_deref(),
            Some(dev_mode::DEV_FOLDER_MISSING)
        );
        assert_eq!(
            snapshot.folders[1]
                .plugin
                .as_ref()
                .map(|p| p.manifest.id.as_str()),
            Some("dev-x")
        );
    }

    #[test]
    fn a_release_build_lists_nothing_while_developer_mode_is_off() {
        let f = fixture();
        let path = plugin_folder(f.sources.path(), "dev-x", "sandboxed");
        approve(&f, &[&path]);
        write_r1(
            &f,
            serde_json::json!({ "version": 1, "enabled": false, "folders": [{ "path": path }] }),
        );
        let app = tauri::test::mock_app();

        let off = list_dev(app.handle(), &host(&f), Build::release());
        assert!(!off.active);
        assert!(!off.dev_build);
        assert!(off.folders.is_empty());
        assert!(
            !granted(app.handle(), &path),
            "an inactive list must grant nothing"
        );

        write_r1(
            &f,
            serde_json::json!({ "version": 1, "enabled": true, "folders": [{ "path": path }] }),
        );
        let on = list_dev(app.handle(), &host(&f), Build::release());
        assert!(on.active);
        assert_eq!(on.folders.len(), 1);
        assert!(granted(app.handle(), &path));
    }

    #[test]
    fn a_release_build_refuses_a_trusted_folder_and_grants_it_nothing() {
        let f = fixture();
        let trusted = plugin_folder(f.sources.path(), "dev-trusted", "trusted");
        let sandboxed = plugin_folder(f.sources.path(), "dev-sandboxed", "sandboxed");
        approve(&f, &[&trusted, &sandboxed]);
        write_r1(
            &f,
            serde_json::json!({ "version": 1, "enabled": true, "folders": [
                { "path": trusted }, { "path": sandboxed }
            ] }),
        );
        let app = tauri::test::mock_app();

        let snapshot = list_dev(app.handle(), &host(&f), Build::release());

        assert_eq!(
            snapshot.folders[0].error.as_deref(),
            Some(dev_mode::DEV_PLUGIN_NOT_SANDBOXED)
        );
        assert!(!granted(app.handle(), &trusted));
        assert!(snapshot.folders[1].plugin.is_some());
        assert!(granted(app.handle(), &sandboxed));
    }

    #[test]
    fn a_release_build_refuses_a_folder_whose_id_is_installed() {
        let f = fixture();
        std::fs::create_dir(f.plugins.path().join("dev-x")).unwrap();
        let path = plugin_folder(f.sources.path(), "dev-x", "sandboxed");
        approve(&f, &[&path]);
        write_r1(
            &f,
            serde_json::json!({ "version": 1, "enabled": true, "folders": [{ "path": path }] }),
        );
        let app = tauri::test::mock_app();

        let snapshot = list_dev(app.handle(), &host(&f), Build::release());

        assert_eq!(
            snapshot.folders[0].error.as_deref(),
            Some(dev_mode::DEV_PLUGIN_ID_INSTALLED)
        );
        assert!(!granted(app.handle(), &path));
    }

    /// I4-2 on the list path. Every example under `examples/plugins/` has a `baram-` id, so
    /// this is what a release build answers for an unmodified example folder.
    #[test]
    fn a_release_build_refuses_a_first_party_id_and_grants_it_nothing() {
        let f = fixture();
        let path = plugin_folder(f.sources.path(), "baram-x", "sandboxed");
        approve(&f, &[&path]);
        write_r1(
            &f,
            serde_json::json!({ "version": 1, "enabled": true, "folders": [{ "path": path }] }),
        );
        let app = tauri::test::mock_app();

        let snapshot = list_dev(app.handle(), &host(&f), Build::release());

        assert_eq!(
            snapshot.folders[0].error.as_deref(),
            Some(dev_mode::DEV_PLUGIN_ID_RESERVED)
        );
        assert!(!granted(app.handle(), &path));
    }

    /// I4-3 — `uninstall_installed` removes only the install directory, so an uninstalled
    /// plugin's `plugin-data/<id>` stays behind. A folder reusing that id must not inherit it.
    #[test]
    fn a_release_build_refuses_a_folder_whose_id_left_storage_behind() {
        let f = fixture();
        std::fs::create_dir(f.storage.path().join("dev-x")).unwrap();
        let path = plugin_folder(f.sources.path(), "dev-x", "sandboxed");
        approve(&f, &[&path]);
        write_r1(
            &f,
            serde_json::json!({ "version": 1, "enabled": true, "folders": [{ "path": path }] }),
        );
        let app = tauri::test::mock_app();

        let snapshot = list_dev(app.handle(), &host(&f), Build::release());

        assert_eq!(
            snapshot.folders[0].error.as_deref(),
            Some(dev_mode::DEV_PLUGIN_STORAGE_TAKEN)
        );
        assert!(!granted(app.handle(), &path));
        assert_eq!(
            r1(&f).folders[0].ids,
            Vec::<String>::new(),
            "a refused folder records nothing"
        );
    }

    /// The restart the spec protects (I4-3): the folder's plugin used its storage after it was
    /// admitted, and the id recorded AT that admission lets the next launch through.
    #[test]
    fn a_release_build_records_the_id_so_its_own_storage_does_not_block_a_restart() {
        let f = fixture();
        let path = plugin_folder(f.sources.path(), "dev-x", "sandboxed");
        approve(&f, &[&path]);
        write_r1(
            &f,
            serde_json::json!({ "version": 1, "enabled": true, "folders": [{ "path": path }] }),
        );
        let app = tauri::test::mock_app();

        let first = list_dev(app.handle(), &host(&f), Build::release());
        assert!(first.folders[0].plugin.is_some());
        assert_eq!(first.folders[0].ids, vec!["dev-x".to_string()]);
        assert_eq!(
            r1(&f).folders[0].ids,
            vec!["dev-x".to_string()],
            "the id is recorded before the folder's code can run"
        );

        // The plugin ran and touched storage — `plugin_data_dir` creates the directory.
        std::fs::create_dir(f.storage.path().join("dev-x")).unwrap();
        let restart = list_dev(app.handle(), &host(&f), Build::release());
        assert!(
            restart.folders[0].plugin.is_some(),
            "the folder's own storage must not block it: {:?}",
            restart.folders[0].error
        );
    }

    /// The record is a set (verification pass, M2c): an author who renames the plugin keeps
    /// the old id recorded, so the storage seeded under it is still held by this folder and the
    /// install boundary (`plugin_install_commit`) still sees it.
    #[test]
    fn an_id_change_adds_to_the_record() {
        let f = fixture();
        let path = plugin_folder(f.sources.path(), "dev-y", "sandboxed");
        approve(&f, &[&path]);
        write_r1(
            &f,
            serde_json::json!({ "version": 1, "enabled": true, "folders": [
                { "path": path, "ids": ["dev-x"] }
            ] }),
        );
        let app = tauri::test::mock_app();

        let snapshot = list_dev(app.handle(), &host(&f), Build::release());

        assert!(snapshot.folders[0].plugin.is_some());
        assert_eq!(
            r1(&f).folders[0].ids,
            vec!["dev-x".to_string(), "dev-y".to_string()]
        );
    }

    /// Dev builds record nothing (plan 0106 P22) — a claim is made only where it is checked.
    #[test]
    fn a_dev_build_records_no_id() {
        let f = fixture();
        let path = plugin_folder(f.sources.path(), "dev-x", "sandboxed");
        approve(&f, &[&path]);
        write_r1(
            &f,
            serde_json::json!({ "version": 1, "folders": [{ "path": path }] }),
        );
        let app = tauri::test::mock_app();

        let snapshot = list_dev(app.handle(), &host(&f), Build::dev());

        assert!(snapshot.folders[0].plugin.is_some());
        assert_eq!(snapshot.folders[0].ids, Vec::<String>::new());
        assert_eq!(r1(&f).folders[0].ids, Vec::<String>::new());
    }

    #[test]
    fn reload_takes_only_a_folder_already_in_the_list() {
        let f = fixture();
        let listed = plugin_folder(f.sources.path(), "dev-x", "sandboxed");
        let stranger = plugin_folder(f.sources.path(), "dev-y", "sandboxed");
        approve(&f, &[&listed, &stranger]);
        write_r1(
            &f,
            serde_json::json!({ "version": 1, "folders": [{
                "path": listed,
                "consent": { "capabilities": ["statusbar"], "trust": "sandboxed" }
            }] }),
        );
        let (_app, webview) = ipc_app(host(&f));

        let err = invoke(
            &webview,
            "plugin_reload_dev_folder",
            serde_json::json!({ "path": stranger }),
        )
        .expect_err("an unlisted path must be refused");
        assert_eq!(err, serde_json::json!(dev_mode::DEV_FOLDER_NOT_LISTED));

        let row = invoke(
            &webview,
            "plugin_reload_dev_folder",
            serde_json::json!({ "path": listed }),
        )
        .expect("a listed folder reloads");
        assert_eq!(row["plugin"]["manifest"]["id"], "dev-x");
        assert_eq!(row["consent"]["capabilities"][0], "statusbar");
    }

    #[test]
    fn reload_refuses_while_developer_mode_is_off() {
        let f = fixture();
        let path = plugin_folder(f.sources.path(), "dev-x", "sandboxed");
        approve(&f, &[&path]);
        write_r1(
            &f,
            serde_json::json!({ "version": 1, "enabled": false, "folders": [{ "path": path }] }),
        );
        let app = tauri::test::mock_app();

        assert_eq!(
            reload_dev_folder(app.handle(), &host(&f), Build::release(), &path).map(|_| ()),
            Err(dev_mode::DEV_MODE_INACTIVE.to_string())
        );
    }

    #[test]
    fn remove_drops_the_folder_from_the_rust_file() {
        let f = fixture();
        write_r1(
            &f,
            serde_json::json!({ "version": 1, "folders": [{ "path": "/a" }, { "path": "/b" }] }),
        );
        let (_app, webview) = ipc_app(host(&f));

        invoke(
            &webview,
            "plugin_remove_dev_folder",
            serde_json::json!({ "path": "/a" }),
        )
        .expect("plugin_remove_dev_folder must be registered");

        let folders = dev_mode::load_from(&f.data.path().join(dev_mode::STORE_FILE)).folders;
        assert_eq!(
            folders.iter().map(|d| d.path.as_str()).collect::<Vec<_>>(),
            vec!["/b"]
        );
    }

    /// `plugin_cmd::is_plugin_directory` reads dev locations through this.
    #[test]
    fn dev_plugin_locations_come_from_the_managed_host_only() {
        let f = fixture();
        write_r1(
            &f,
            serde_json::json!({ "version": 1, "folders": [{ "path": "/dev/x" }] }),
        );
        let bare = tauri::test::mock_app();
        assert!(
            active_dev_folder_paths(bare.handle()).is_empty(),
            "no managed host, no dev locations"
        );
        let app = tauri::test::mock_app();
        app.manage(host(&f));
        assert_eq!(
            active_dev_folder_paths(app.handle()),
            vec!["/dev/x".to_string()]
        );
    }

    /// §379 — the pre-#738 list in `config.json` is read in ONE place, and only as the
    /// closure the dev-build migration may call. `a_release_build_never_reads_the_legacy_list`
    /// (`dev_mode.rs`) pins that the migration does not call it in a release build; this pins
    /// that nothing else reads the key. Every call to `legacy_dev_folders(` in this file's
    /// production text — any argument, not just `(app)` — must be a `|| legacy_dev_folders(`
    /// closure hand-off (the definition itself does not count: it squashes to
    /// `fnlegacy_dev_folders<R:Runtime>(`, never `legacy_dev_folders(`, verified below), and the
    /// key literal must appear exactly once. Replaces #738's
    /// `the_dev_folder_list_is_read_once_and_only_through_the_build_gate`.
    #[test]
    fn the_legacy_dev_folder_key_is_read_only_by_the_migration() {
        let squash = |s: &str| -> String { s.chars().filter(|c| !c.is_whitespace()).collect() };
        let src = include_str!("plugin_dev_cmd.rs");
        let prod = squash(
            src.split_once(concat!("#[cfg(test)]\nmod ", "tests {"))
                .expect("this file has a test module")
                .0,
        );
        let key = concat!("LEGACY_DEV_FOLDERS", "_KEY");
        let definition = format!("const{key}:&str=");
        let read = format!("crate::config::get_config(app,{key}).ok().flatten()");
        assert_eq!(prod.matches(definition.as_str()).count(), 1);
        assert_eq!(prod.matches(read.as_str()).count(), 1);
        assert_eq!(
            prod.matches(key).count(),
            2,
            "a use of the legacy key is neither its definition nor its one read"
        );

        // ‼️ Match the CALL, not one fixed argument spelling — `legacy_dev_folders(app)` misses
        // `legacy_dev_folders(&app)`, which a direct (non-closure) read inside a command that
        // owns `app: AppHandle<R>` would naturally be written as. The function DEFINITION does
        // not confuse this count: it squashes to `fnlegacy_dev_folders<R:Runtime>(`, which does
        // not contain `legacy_dev_folders(` — the generic parameter list sits between the name
        // and the paren. Sanity-checked directly, not inferred:
        let definition_shape = concat!(
            "fnlegacy_dev_folders<R:Runtime>",
            "(app:&AppHandle<R>)->Option<String>{"
        );
        assert!(
            prod.contains(definition_shape),
            "the function definition's squashed shape changed — recheck the sanity check below"
        );
        assert!(
            !definition_shape.contains(concat!("legacy_dev_folders", "(")),
            "sanity: the definition must not itself match the call needle, \
             or `calls` below would count it"
        );
        let calls = prod.matches(concat!("legacy_dev_folders", "(")).count();
        let handed = prod.matches(concat!("||legacy_dev_folders", "(")).count();
        assert!(handed >= 1, "the scan window does not reach the hand-offs");
        assert_eq!(
            calls, handed,
            "a call to legacy_dev_folders( exists outside a `|| legacy_dev_folders(` closure hand-off"
        );

        let literal = concat!("\"plugin.", "devFolders\"");
        assert!(
            src.contains(literal),
            "the key literal moved — this scan would pass an offender"
        );
        assert_eq!(
            prod.matches(literal).count(),
            1,
            "the legacy key literal must appear exactly once in this file's production text"
        );
        let mut offenders = Vec::new();
        let mut dirs = vec![std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src")];
        while let Some(dir) = dirs.pop() {
            for entry in std::fs::read_dir(&dir).expect("src is readable") {
                let path = entry.expect("dir entry is readable").path();
                if path.is_dir() {
                    dirs.push(path);
                } else if path.extension().is_some_and(|ext| ext == "rs")
                    && !path.ends_with("commands/plugin_dev_cmd.rs")
                    && std::fs::read_to_string(&path)
                        .expect("source is readable")
                        .contains(literal)
                {
                    offenders.push(path);
                }
            }
        }
        assert!(
            offenders.is_empty(),
            "only plugin_dev_cmd.rs may name the legacy key: {offenders:?}"
        );
    }

    #[test]
    fn pick_through_generate_handler_adds_the_chosen_folder_and_its_approval() {
        let f = fixture();
        let path = plugin_folder(f.sources.path(), "dev-x", "sandboxed");
        write_r1(&f, serde_json::json!({ "version": 1, "folders": [] }));
        let log = shown();
        let (app, webview) = ipc_app(host_with(
            &f,
            ScriptedDialogs {
                pick: Some(PathBuf::from(&path)),
                shown: log.clone(),
                ..ScriptedDialogs::default()
            },
        ));

        let row = invoke(&webview, "plugin_pick_dev_folder", serde_json::json!({}))
            .expect("plugin_pick_dev_folder must be registered");

        assert_eq!(row["plugin"]["manifest"]["id"], "dev-x");
        assert_eq!(*log.lock().unwrap(), vec!["pick"]);
        assert_eq!(
            r1(&f)
                .folders
                .iter()
                .map(|d| d.path.as_str())
                .collect::<Vec<_>>(),
            vec![path.as_str()]
        );
        assert_eq!(
            r1(&f).folders[0].ids,
            Vec::<String>::new(),
            "a dev build records no id (plan 0106 P22)"
        );
        // The pick itself is the approval (§332) — and the grant then rests on it.
        let approvals = approval::load_from(&f.data.path().join(approval::STORE_FILE));
        assert!(approvals.covers(Path::new(&path)));
        assert!(granted(app.handle(), &path));
    }

    #[test]
    fn a_cancelled_pick_writes_nothing() {
        let f = fixture();
        write_r1(&f, serde_json::json!({ "version": 1, "folders": [] }));
        let log = shown();
        let (_app, webview) = ipc_app(host_with(
            &f,
            ScriptedDialogs {
                shown: log.clone(),
                ..ScriptedDialogs::default()
            },
        ));

        let answer = invoke(&webview, "plugin_pick_dev_folder", serde_json::json!({})).unwrap();

        assert_eq!(answer, serde_json::Value::Null);
        assert_eq!(*log.lock().unwrap(), vec!["pick"]);
        assert!(r1(&f).folders.is_empty());
        assert!(!f.data.path().join(approval::STORE_FILE).exists());
    }

    /// I1 + P6 — refused BEFORE anything is written: no approval, no list entry, no scope.
    #[tokio::test]
    async fn a_release_build_refuses_a_trusted_pick_before_writing_anything() {
        let f = fixture();
        let path = plugin_folder(f.sources.path(), "dev-x", "trusted");
        write_r1(
            &f,
            serde_json::json!({ "version": 1, "enabled": true, "folders": [] }),
        );
        let host = host_with(
            &f,
            ScriptedDialogs {
                pick: Some(PathBuf::from(&path)),
                ..ScriptedDialogs::default()
            },
        );
        let app = tauri::test::mock_app();

        let refused = pick_dev_folder(app.handle(), &host, Build::release()).await;

        assert_eq!(
            refused.map(|_| ()),
            Err(dev_mode::DEV_PLUGIN_NOT_SANDBOXED.to_string())
        );
        assert!(r1(&f).folders.is_empty());
        assert!(!f.data.path().join(approval::STORE_FILE).exists());
        assert!(!granted(app.handle(), &path));
    }

    #[tokio::test]
    async fn a_release_build_refuses_a_pick_whose_id_is_installed() {
        let f = fixture();
        std::fs::create_dir(f.plugins.path().join("dev-x")).unwrap();
        let path = plugin_folder(f.sources.path(), "dev-x", "sandboxed");
        write_r1(
            &f,
            serde_json::json!({ "version": 1, "enabled": true, "folders": [] }),
        );
        let host = host_with(
            &f,
            ScriptedDialogs {
                pick: Some(PathBuf::from(&path)),
                ..ScriptedDialogs::default()
            },
        );
        let app = tauri::test::mock_app();

        let refused = pick_dev_folder(app.handle(), &host, Build::release()).await;

        assert_eq!(
            refused.map(|_| ()),
            Err(dev_mode::DEV_PLUGIN_ID_INSTALLED.to_string())
        );
        assert!(r1(&f).folders.is_empty());
        // P6 — "no approval, no entry, no scope": the entry-emptiness above is the second half.
        assert!(!f.data.path().join(approval::STORE_FILE).exists());
    }

    /// I4-3 on the pick path — the storage an uninstalled plugin left behind is refused before
    /// anything is written, like every other R3 refusal (P6).
    #[tokio::test]
    async fn a_release_build_refuses_a_pick_that_would_inherit_storage() {
        let f = fixture();
        std::fs::create_dir(f.storage.path().join("dev-x")).unwrap();
        let path = plugin_folder(f.sources.path(), "dev-x", "sandboxed");
        write_r1(
            &f,
            serde_json::json!({ "version": 1, "enabled": true, "folders": [] }),
        );
        let host = host_with(
            &f,
            ScriptedDialogs {
                pick: Some(PathBuf::from(&path)),
                ..ScriptedDialogs::default()
            },
        );
        let app = tauri::test::mock_app();

        let refused = pick_dev_folder(app.handle(), &host, Build::release()).await;

        assert_eq!(
            refused.map(|_| ()),
            Err(dev_mode::DEV_PLUGIN_STORAGE_TAKEN.to_string())
        );
        assert!(r1(&f).folders.is_empty());
        assert!(!f.data.path().join(approval::STORE_FILE).exists());
    }

    /// I4-3 — the release pick records the manifest id with the folder ("고를 때의 매니페스트 id").
    #[tokio::test]
    async fn a_release_pick_records_the_manifest_id() {
        let f = fixture();
        let path = plugin_folder(f.sources.path(), "dev-x", "sandboxed");
        write_r1(
            &f,
            serde_json::json!({ "version": 1, "enabled": true, "folders": [] }),
        );
        let host = host_with(
            &f,
            ScriptedDialogs {
                pick: Some(PathBuf::from(&path)),
                ..ScriptedDialogs::default()
            },
        );
        let app = tauri::test::mock_app();

        let row = pick_dev_folder(app.handle(), &host, Build::release())
            .await
            .expect("a sandboxed, unclaimed folder is admitted")
            .expect("the scripted picker chose a folder");

        assert_eq!(row.ids, vec!["dev-x".to_string()]);
        assert_eq!(r1(&f).folders[0].ids, vec!["dev-x".to_string()]);
    }

    #[tokio::test]
    async fn no_picker_opens_while_developer_mode_is_off() {
        let f = fixture();
        write_r1(
            &f,
            serde_json::json!({ "version": 1, "enabled": false, "folders": [] }),
        );
        let log = shown();
        let host = host_with(
            &f,
            ScriptedDialogs {
                shown: log.clone(),
                ..ScriptedDialogs::default()
            },
        );
        let app = tauri::test::mock_app();

        let refused = pick_dev_folder(app.handle(), &host, Build::release()).await;

        assert_eq!(
            refused.map(|_| ()),
            Err(dev_mode::DEV_MODE_INACTIVE.to_string())
        );
        assert!(log.lock().unwrap().is_empty());
    }

    #[test]
    fn enabling_asks_first_and_a_refusal_leaves_it_off() {
        let f = fixture();
        write_r1(
            &f,
            serde_json::json!({ "version": 1, "enabled": false, "folders": [] }),
        );
        let log = shown();
        let (_app, webview) = ipc_app(host_with(
            &f,
            ScriptedDialogs {
                confirm: false,
                shown: log.clone(),
                ..ScriptedDialogs::default()
            },
        ));

        let enabled = invoke(
            &webview,
            "plugin_set_developer_mode",
            serde_json::json!({ "enabled": true }),
        )
        .expect("plugin_set_developer_mode must be registered");

        assert_eq!(enabled, false);
        assert_eq!(*log.lock().unwrap(), vec!["confirm"]);
        assert!(!r1(&f).enabled);
    }

    #[test]
    fn enabling_after_consent_persists_and_disabling_asks_nothing() {
        let f = fixture();
        write_r1(
            &f,
            serde_json::json!({ "version": 1, "enabled": false, "folders": [] }),
        );
        let log = shown();
        let (_app, webview) = ipc_app(host_with(
            &f,
            ScriptedDialogs {
                confirm: true,
                shown: log.clone(),
                ..ScriptedDialogs::default()
            },
        ));

        let on = invoke(
            &webview,
            "plugin_set_developer_mode",
            serde_json::json!({ "enabled": true }),
        )
        .unwrap();
        assert_eq!(on, true);
        assert!(r1(&f).enabled);

        let off = invoke(
            &webview,
            "plugin_set_developer_mode",
            serde_json::json!({ "enabled": false }),
        )
        .unwrap();
        assert_eq!(off, false);
        assert!(!r1(&f).enabled);
        assert_eq!(
            *log.lock().unwrap(),
            vec!["confirm"],
            "turning it off must not ask"
        );
    }

    #[test]
    fn consent_is_recorded_through_generate_handler_only_for_a_listed_folder() {
        let f = fixture();
        write_r1(
            &f,
            serde_json::json!({ "version": 1, "folders": [{ "path": "/dev/x" }] }),
        );
        let (_app, webview) = ipc_app(host(&f));
        let consent = serde_json::json!({ "capabilities": ["statusbar"], "trust": "sandboxed" });

        invoke(
            &webview,
            "plugin_record_dev_consent",
            serde_json::json!({ "path": "/dev/x", "consent": consent }),
        )
        .expect("plugin_record_dev_consent must be registered");
        let err = invoke(
            &webview,
            "plugin_record_dev_consent",
            serde_json::json!({ "path": "/dev/y", "consent": consent }),
        )
        .expect_err("an unlisted path must be refused");

        assert_eq!(err, serde_json::json!(dev_mode::DEV_FOLDER_NOT_LISTED));
        let state = r1(&f);
        assert_eq!(
            state.folders.len(),
            1,
            "recording a consent must not grow the list"
        );
        assert_eq!(
            state.folders[0]
                .consent
                .as_ref()
                .map(|c| c.capabilities.clone()),
            Some(vec!["statusbar".to_string()])
        );
    }

    #[test]
    fn the_enable_warning_names_the_sandboxed_limit_in_both_locales() {
        let en = enable_warning(false);
        let ko = enable_warning(true);
        assert!(en.body.contains("sandboxed"));
        assert!(ko.body.contains("sandboxed"));
        assert!(ko.body.contains("권한"));
        assert_ne!(en.title, ko.title);
        assert_ne!(picker_title(false), picker_title(true));
    }

    /// M1 (review round 1) — the picker is an open-ended user wait. Developer mode turning off
    /// DURING that wait must not be admitted against the state read before it.
    #[tokio::test]
    async fn a_release_pick_is_refused_if_developer_mode_turns_off_during_the_picker() {
        let f = fixture();
        let path = plugin_folder(f.sources.path(), "dev-x", "sandboxed");
        write_r1(
            &f,
            serde_json::json!({ "version": 1, "enabled": true, "folders": [] }),
        );
        let data_dir = f.data.path().to_path_buf();
        let host = host_with(
            &f,
            ScriptedDialogs {
                pick: Some(PathBuf::from(&path)),
                during_pick: Some(Box::new(move || {
                    std::fs::write(
                        data_dir.join(dev_mode::STORE_FILE),
                        serde_json::json!({ "version": 1, "enabled": false, "folders": [] })
                            .to_string(),
                    )
                    .unwrap();
                })),
                ..ScriptedDialogs::default()
            },
        );
        let app = tauri::test::mock_app();

        let refused = pick_dev_folder(app.handle(), &host, Build::release()).await;

        assert_eq!(
            refused.map(|_| ()),
            Err(dev_mode::DEV_MODE_INACTIVE.to_string())
        );
        assert!(r1(&f).folders.is_empty());
        assert!(!f.data.path().join(approval::STORE_FILE).exists());
    }

    /// M3 (review round 1) — this command has its own inactive gate, distinct from the pick and
    /// enable/disable commands', and it was deletable with no red test (every test here runs as
    /// a dev build, which is always active). Pin both halves through the build-taking core.
    #[tokio::test]
    async fn recording_consent_refuses_while_developer_mode_is_off_in_a_release_build() {
        let f = fixture();
        write_r1(
            &f,
            serde_json::json!({ "version": 1, "enabled": false, "folders": [{ "path": "/dev/x" }] }),
        );
        let host = host(&f);
        let consent = sandboxed_consent(&["statusbar"]);
        let app = tauri::test::mock_app();

        let refused = record_dev_consent(
            app.handle(),
            &host,
            Build::release(),
            "/dev/x".to_string(),
            consent,
        )
        .await;

        assert_eq!(refused, Err(dev_mode::DEV_MODE_INACTIVE.to_string()));
        assert_eq!(r1(&f).folders[0].consent, None);
    }

    #[tokio::test]
    async fn recording_consent_succeeds_while_developer_mode_is_on_in_a_release_build() {
        let f = fixture();
        write_r1(
            &f,
            serde_json::json!({ "version": 1, "enabled": true, "folders": [{ "path": "/dev/x" }] }),
        );
        let host = host(&f);
        let consent = sandboxed_consent(&["statusbar"]);
        let app = tauri::test::mock_app();

        let recorded = record_dev_consent(
            app.handle(),
            &host,
            Build::release(),
            "/dev/x".to_string(),
            consent,
        )
        .await;

        assert_eq!(recorded, Ok(()));
        assert_eq!(
            r1(&f).folders[0]
                .consent
                .as_ref()
                .map(|c| c.capabilities.clone()),
            Some(vec!["statusbar".to_string()])
        );
    }

    /// M7(b) (review round 1) — the positive half of `enabling_asks_first_and_a_refusal_leaves_it_off`:
    /// turning it on when it is already on must not prompt at all.
    #[test]
    fn enabling_when_already_on_shows_no_prompt() {
        let f = fixture();
        write_r1(
            &f,
            serde_json::json!({ "version": 1, "enabled": true, "folders": [] }),
        );
        let log = shown();
        let (_app, webview) = ipc_app(host_with(
            &f,
            ScriptedDialogs {
                shown: log.clone(),
                ..ScriptedDialogs::default()
            },
        ));

        let enabled = invoke(
            &webview,
            "plugin_set_developer_mode",
            serde_json::json!({ "enabled": true }),
        )
        .unwrap();

        assert_eq!(enabled, true);
        assert!(
            log.lock().unwrap().is_empty(),
            "already-on must not show a prompt"
        );
        assert!(r1(&f).enabled);
    }
}
