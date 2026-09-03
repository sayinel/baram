// §5.11 Global Search — IPC command handler

use crate::search::{self, SearchOptions};

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchOptionsInput {
    #[serde(default)]
    pub case_sensitive: bool,
    #[serde(default)]
    pub whole_word: bool,
    #[serde(default)]
    pub regex: bool,
    #[serde(default)]
    pub max_results: Option<usize>,
    #[serde(default)]
    pub include_glob: Option<String>,
    #[serde(default)]
    pub exclude_glob: Option<String>,
}

#[tauri::command]
pub async fn search_files<R: tauri::Runtime>(
    root_path: String,
    query: String,
    options: Option<SearchOptionsInput>,
    app: tauri::AppHandle<R>,
) -> Result<Vec<search::SearchResult>, String> {
    // §5.11 검색 루트는 다른 IPC 읽기와 **같은** 규칙을 받아야 한다. 가드가 없으면 이 명령이
    // 임의 디렉터리를 regex로 훑는 통로가 된다 — `SearchResult`가 `snippet`(매치된 줄의
    // 내용)을 돌려주므로 존재 여부가 아니라 **내용**이 나간다.
    //
    // 정당한 루트는 정확히 "등록된 컨텍스트"다: `GlobalSearch`의 all/all-vaults 스코프가
    // 컨텍스트 경로를 순회하고(`GlobalSearch.tsx:84`), 저널 검색은 저널 디렉터리를,
    // PDF 참조 카운트는 rootPath를 넘긴다. `validate_path_any`가 Vault/Folder를
    // `starts_with`로 보므로 컨텍스트 경로 자기 자신도 통과한다.
    crate::commands::fs_cmd::ensure_path_in_vault(&app, &root_path).await?;

    let opts = match options {
        Some(input) => SearchOptions {
            case_sensitive: input.case_sensitive,
            whole_word: input.whole_word,
            regex: input.regex,
            max_results: input.max_results.unwrap_or(1000),
            include_glob: input.include_glob,
            exclude_glob: input.exclude_glob,
        },
        None => SearchOptions::default(),
    };

    search::search_files(&root_path, &query, &opts).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::context::types::{ContextInfo, ContextType};
    use tauri::Manager;
    use tempfile::TempDir;

    /// A mock-runtime app carrying the two states `ensure_path_in_vault` reads.
    fn app_with_states() -> tauri::App<tauri::test::MockRuntime> {
        let app = tauri::test::mock_app();
        app.manage(crate::VaultRootState(tokio::sync::RwLock::new(None)));
        app.manage(crate::context::ContextManager::new());
        app
    }

    fn folder_context(path: &str) -> ContextInfo {
        ContextInfo {
            id: "ctx-test".to_string(),
            context_type: ContextType::Folder,
            path: path.to_string(),
            label: "test".to_string(),
            color: "#000000".to_string(),
            alias: None,
            vault_type: None,
            added_at: 0,
        }
    }

    /// ‼️ This assertion and the one below are a PAIR, deliberately.
    ///
    /// The rejection alone would still pass if the command stopped searching
    /// altogether, and the success alone would still pass if the guard were deleted.
    /// Only together do they pin "guards, and still searches".
    #[tokio::test]
    async fn rejects_a_root_outside_every_registered_context() {
        let app = app_with_states();
        let inside = TempDir::new().unwrap();
        let outside = TempDir::new().unwrap();
        std::fs::write(outside.path().join("secret.md"), "the needle").unwrap();
        app.state::<crate::context::ContextManager>()
            .add(folder_context(inside.path().to_str().unwrap()))
            .await
            .unwrap();

        let err = search_files(
            outside.path().to_str().unwrap().to_string(),
            "needle".to_string(),
            None,
            app.handle().clone(),
        )
        .await
        .expect_err("a root outside every context must be refused");

        assert!(
            err.contains("outside all registered contexts"),
            "unexpected error: {err}"
        );
    }

    #[tokio::test]
    async fn searches_a_registered_context_root() {
        let app = app_with_states();
        let inside = TempDir::new().unwrap();
        std::fs::write(inside.path().join("note.md"), "the needle").unwrap();
        app.state::<crate::context::ContextManager>()
            .add(folder_context(inside.path().to_str().unwrap()))
            .await
            .unwrap();

        let hits = search_files(
            inside.path().to_str().unwrap().to_string(),
            "needle".to_string(),
            None,
            app.handle().clone(),
        )
        .await
        .expect("a registered context root must be searchable");

        assert_eq!(hits.len(), 1, "expected the one seeded match");
        assert!(hits[0].snippet.contains("needle"));
    }

    /// ‼️ The three tests above call the function directly, so none of them would
    /// notice the command becoming **unreachable from JS**. That is a real risk here:
    /// `search_files` is generic over the runtime, and a generic `#[tauri::command]`
    /// that `generate_handler!` failed to dispatch would still compile — Global Search
    /// would simply stop working, with every Rust test green.
    ///
    /// So this one goes through the real IPC dispatcher: it registers the command with
    /// `generate_handler!` exactly as `lib.rs` does and invokes it by name. `mock_context`
    /// + `noop_assets` keep the app's real config and frontend bundle out of it.
    #[test]
    fn is_dispatchable_by_name_through_generate_handler() {
        let app = tauri::test::mock_builder()
            .invoke_handler(tauri::generate_handler![super::search_files])
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .expect("mock app must build");
        app.manage(crate::VaultRootState(tokio::sync::RwLock::new(None)));
        app.manage(crate::context::ContextManager::new());

        let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .expect("mock webview must build");

        let res = tauri::test::get_ipc_response(
            &webview,
            tauri::webview::InvokeRequest {
                cmd: "search_files".into(),
                callback: tauri::ipc::CallbackFn(0),
                error: tauri::ipc::CallbackFn(1),
                url: if cfg!(any(windows, target_os = "android")) {
                    "http://tauri.localhost"
                } else {
                    "tauri://localhost"
                }
                .parse()
                .unwrap(),
                body: tauri::ipc::InvokeBody::Json(serde_json::json!({
                    "rootPath": "/definitely/not/a/registered/context",
                    "query": "needle",
                })),
                headers: Default::default(),
                invoke_key: tauri::test::INVOKE_KEY.to_string(),
            },
        );

        // The command was found, its camelCase args deserialized, and the guard ran —
        // an unknown command or a deserialization failure would carry a different
        // message, so this pins reachability rather than merely "some error".
        let err = res.expect_err("an unregistered root must be refused");
        assert_eq!(
            err,
            serde_json::json!("Access denied: no vault, folder, or file context is open"),
            "unexpected IPC error payload: {err}"
        );
    }

    /// The cold-start window: nothing open yet. `vault_fallback_decision` denies by
    /// default, and search must inherit that rather than treat "no vault" as "any path".
    #[tokio::test]
    async fn rejects_when_no_context_and_no_vault_root_are_set() {
        let app = app_with_states();
        let dir = TempDir::new().unwrap();
        std::fs::write(dir.path().join("note.md"), "the needle").unwrap();

        let err = search_files(
            dir.path().to_str().unwrap().to_string(),
            "needle".to_string(),
            None,
            app.handle().clone(),
        )
        .await
        .expect_err("search before anything is open must be refused");

        assert!(
            err.contains("no vault, folder, or file context is open"),
            "unexpected error: {err}"
        );
    }
}
