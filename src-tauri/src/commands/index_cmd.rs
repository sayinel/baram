// §29 인덱스 IPC 커맨드 — 백링크 조회, 인덱스 빌드/갱신
// §33 파일 이름 변경 시 wikilink 자동 갱신
//
// A thin IPC layer (§3.2): every wrapper here hands its arguments to
// `crate::index::service` and returns what it gets back. The link index itself
// — the per-context slot map, the build/publish state machine, the key
// derivation and the renames — lives in `index/service/mod.rs`, whose header
// carries the design (issue 263) and the invariants it rests on. A new command
// belongs here; new behaviour belongs there.

use crate::context::ContextManager;
use crate::index::service::{
    degrade, get_backlinks_inner, get_link_index_inner, reconcile_effects, refresh_index_inner,
    rename_block_id_inner, rename_file_with_links_inner, rename_namespace_inner, report,
    require_registered_root, Effect, LinkIndexState, NamespaceRenameResult, Reconciled,
    RenameResult,
};
use crate::index::{
    find_unlinked_mentions, BacklinkResult, IndexStats, LinkGraph, UnlinkedMentionResult,
};
use tauri::{Manager, State};

#[tauri::command]
pub async fn get_backlinks(
    file_path: String,
    state: State<'_, LinkIndexState>,
    ctx_mgr: State<'_, ContextManager>,
) -> Result<Vec<BacklinkResult>, String> {
    get_backlinks_inner(&state, &ctx_mgr, &file_path).await
}

#[tauri::command]
pub async fn get_link_index(
    root_path: Option<String>,
    state: State<'_, LinkIndexState>,
    ctx_mgr: State<'_, ContextManager>,
) -> Result<LinkGraph, String> {
    get_link_index_inner(&state, &ctx_mgr, root_path).await
}

#[tauri::command]
pub async fn refresh_index(
    root_path: String,
    state: State<'_, LinkIndexState>,
    ctx_mgr: State<'_, ContextManager>,
) -> Result<IndexStats, String> {
    refresh_index_inner(&state, &ctx_mgr, &root_path).await
}

/// §34 Find unlinked mentions — text occurrences of a file's name in other files
#[tauri::command]
pub async fn get_unlinked_mentions(
    file_path: String,
    root_path: String,
    ctx_mgr: State<'_, ContextManager>,
) -> Result<Vec<UnlinkedMentionResult>, String> {
    // The one command here that walks a directory the webview names without
    // touching the index: it still may not walk outside a registered context.
    require_registered_root(&ctx_mgr, &root_path).await?;
    find_unlinked_mentions(&file_path, &root_path)
        .await
        .map_err(|e| e.to_string())
}

/// §33 Rename a file and update all wikilinks that reference it
#[tauri::command]
pub async fn rename_file_with_links(
    app: tauri::AppHandle,
    old_path: String,
    new_path: String,
    state: State<'_, LinkIndexState>,
    ctx_mgr: State<'_, ContextManager>,
) -> Result<RenameResult, String> {
    let result = rename_file_with_links_inner(&state, &ctx_mgr, &old_path, &new_path).await;
    after_rename(&app, vec![old_path, new_path], &result).await;
    result
}

/// §29 #824 A rename applies what it wrote to the index itself; the paths it wrote are
/// then reconciled through the guarded unit as well, so a watcher sync that read one of
/// them before the rename cannot leave old bytes behind — on failure too, since a rename
/// can fail after moving the file. One `index:changed` for all of it.
async fn after_rename(
    app: &tauri::AppHandle,
    mut paths: Vec<String>,
    result: &Result<RenameResult, String>,
) {
    if let Ok(done) = result {
        paths.extend(done.updated_files.iter().cloned());
    }
    paths.sort();
    paths.dedup();
    let effects: Vec<Effect> = paths.into_iter().map(Effect::Path).collect();
    reconcile_effects(app, &effects).await;
}

/// §30a Rename a block ID and update all references in other files
#[tauri::command]
pub async fn rename_block_id(
    app: tauri::AppHandle,
    file_path: String,
    old_id: String,
    new_id: String,
    state: State<'_, LinkIndexState>,
    ctx_mgr: State<'_, ContextManager>,
) -> Result<RenameResult, String> {
    let result = rename_block_id_inner(&state, &ctx_mgr, &file_path, &old_id, &new_id).await;
    after_rename(&app, vec![file_path], &result).await;
    result
}

/// §61 Rename a directory (namespace) and update all relative wikilinks that reference it
#[tauri::command]
pub async fn rename_namespace(
    app: tauri::AppHandle,
    old_dir: String,
    new_dir: String,
    root_path: String,
    state: State<'_, LinkIndexState>,
    ctx_mgr: State<'_, ContextManager>,
) -> Result<NamespaceRenameResult, String> {
    let result = rename_namespace_inner(&state, &ctx_mgr, &old_dir, &new_dir, &root_path).await;
    announce_namespace_rename(&app, &root_path, &result).await;
    result
}

/// §29 #824 A namespace rename rebuilds its root itself (and drops the other covering
/// indexes, which the gate rebuilds when next needed); reconciling the moved directories
/// would only rebuild it again. The windows are told once the root has an index of the
/// new layout: now, when the rename rebuilt it, or once the rebuild `degrade` schedules
/// has published, when the files moved but the rename's own rebuild did not publish. A
/// root no longer registered at that incarnation is left to whoever registers it next.
/// An `Err` moved nothing.
pub(crate) async fn announce_namespace_rename<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    root_path: &str,
    result: &Result<NamespaceRenameResult, String>,
) {
    match result {
        Ok(done) if done.index_rebuilt => {
            report(
                app,
                vec![Reconciled {
                    reached: true,
                    rebuilt: vec![root_path.to_string()],
                    ..Reconciled::default()
                }],
            )
            .await;
        }
        Ok(_) => {
            let ctx_mgr = app.state::<ContextManager>();
            if let Some(at) = ctx_mgr.context_registered_at(root_path).await {
                degrade(app, root_path, at.incarnation).await;
            }
        }
        Err(_) => {}
    }
}
