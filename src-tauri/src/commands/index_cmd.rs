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
    get_backlinks_inner, get_link_index_inner, refresh_index_inner, rename_block_id_inner,
    rename_file_with_links_inner, rename_namespace_inner, require_registered_root,
    update_file_index_inner, LinkIndexState, NamespaceRenameResult, RenameResult,
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
pub async fn update_file_index(
    file_path: String,
    state: State<'_, LinkIndexState>,
    ctx_mgr: State<'_, ContextManager>,
) -> Result<(), String> {
    update_file_index_inner(&state, &ctx_mgr, &file_path).await
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
    old_path: String,
    new_path: String,
    state: State<'_, LinkIndexState>,
    ctx_mgr: State<'_, ContextManager>,
) -> Result<RenameResult, String> {
    rename_file_with_links_inner(&state, &ctx_mgr, &old_path, &new_path).await
}

/// §30a Rename a block ID and update all references in other files
#[tauri::command]
pub async fn rename_block_id(
    file_path: String,
    old_id: String,
    new_id: String,
    state: State<'_, LinkIndexState>,
    ctx_mgr: State<'_, ContextManager>,
) -> Result<RenameResult, String> {
    rename_block_id_inner(&state, &ctx_mgr, &file_path, &old_id, &new_id).await
}

/// §61 Rename a directory (namespace) and update all relative wikilinks that reference it
#[tauri::command]
pub async fn rename_namespace(
    old_dir: String,
    new_dir: String,
    root_path: String,
    state: State<'_, LinkIndexState>,
    ctx_mgr: State<'_, ContextManager>,
) -> Result<NamespaceRenameResult, String> {
    rename_namespace_inner(&state, &ctx_mgr, &old_dir, &new_dir, &root_path).await
}
