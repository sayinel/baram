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
    get_backlinks_inner, get_link_index_inner, reconcile_effects, refresh_index_inner,
    rename_block_id_inner, rename_file_with_links_inner, rename_namespace_inner, report,
    require_registered_root, sync_watched_paths_inner, Effect, LinkIndexState,
    NamespaceRenameResult, Reconciled, RenameResult, WatchedSync,
};
use crate::index::{
    find_unlinked_mentions, BacklinkResult, IndexStats, LinkGraph, UnlinkedMentionResult,
};
use tauri::State;

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

#[tauri::command]
pub async fn update_file_index(app: tauri::AppHandle, file_path: String) -> Result<(), String> {
    // §29 #824 the same guarded unit and one `index:changed`, as every writer.
    if reconcile_effects(&app, &[Effect::Path(file_path.clone())]).await {
        Ok(())
    } else {
        Err(format!(
            "{file_path} could not be brought into the link index"
        ))
    }
}

/// §29 Bring paths the file watcher reported into the link indexes that
/// contain them (issue 790): how many reached an index, and which failed.
#[tauri::command]
pub async fn sync_watched_paths(
    app: tauri::AppHandle,
    paths: Vec<String>,
    state: State<'_, LinkIndexState>,
    ctx_mgr: State<'_, ContextManager>,
) -> Result<WatchedSync, String> {
    let mut synced = sync_watched_paths_inner(&state, &ctx_mgr, &paths).await;
    // §29 #824 one `index:changed` for the batch; the frontend invalidates from it.
    report(&app, std::mem::take(&mut synced.reconciled)).await;
    Ok(synced)
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
    // §29 #824 It rebuilds its root itself (and drops the other covering indexes, which
    // the gate rebuilds when next needed); reconciling the moved directories would only
    // rebuild it again. The windows are told once that rebuild has published.
    if result.as_ref().is_ok_and(|r| r.index_rebuilt) {
        report(
            &app,
            vec![Reconciled {
                reached: true,
                rebuilt: vec![root_path],
                ..Reconciled::default()
            }],
        )
        .await;
    }
    result
}
