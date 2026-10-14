// §393 The two edges of `ctx.index` (spec 0072 §5.2 · §5.3). Each names the context a read
// answers from, puts each path argument through its tier's own gate, and hands the checked
// read to `plugin::index_reads::run` — one function for both tiers, so their rows cannot
// drift. Generic over the runtime so the tests run the real gates on a mock app.

use crate::context::ContextManager;
use crate::index::service::LinkIndexState;
use crate::plugin::index_reads::{
    check_paths, resolve_scope, run, IndexRead, PathArg, PathForm, Scope,
};
use tauri::Manager;

/// §393 One read from a sandboxed plugin (`PluginOp::Index*`, spec §5.2): the context it
/// names or the active one, each path argument through the file ops' own gate
/// (`plugin_cmd::check_plugin_file_path` — absolute paths, `..`, paths outside every context
/// and `.baram` are refused, as for `ctx.files`), rows relative to that context's root.
/// Authorization and the rate budget happened in `plugin_call` before this runs. `exclude` is
/// how the task panel's exclusions are read — called only for a tasks read; `plugin_call`
/// passes `tasks_exclude`, tests pass a list, so none reads the developer's real `config.json`.
pub(super) async fn sandboxed_read<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    context: Option<String>,
    read: IndexRead,
    exclude: impl FnOnce() -> Vec<String>,
) -> Result<serde_json::Value, String> {
    let ctx_mgr = app.state::<ContextManager>();
    let state = app.state::<LinkIndexState>();
    let scope = Scope {
        ctx: resolve_scope(ctx_mgr.inner(), context).await?,
        form: PathForm::Relative,
    };
    // The id the scope resolved: `None` meant the active context, and every path must anchor
    // to that same one even if the user switches contexts while the read runs.
    let id = scope.ctx.info.id.clone();
    let checked = check_paths(read, |given| sandboxed_path(app, &id, given), exclude).await?;
    run(state.inner(), ctx_mgr.inner(), &scope, checked).await
}

/// One path argument through `check_plugin_file_path`, anchored to the context `id`.
async fn sandboxed_path<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    id: &str,
    given: String,
) -> Result<PathArg, String> {
    let canonical = super::plugin_cmd::check_plugin_file_path(app, Some(id), &given).await?;
    Ok(PathArg { given, canonical })
}

/// The task panel's excluded folders, from the app's own `config.json` (spec D9), read on
/// every tasks read — a setting the store has persisted applies to the next read. The real
/// reader `plugin_call`'s `index_read` hands to `sandboxed_read`.
pub(super) fn tasks_exclude<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Vec<String> {
    match crate::config::config_path(app) {
        Ok(config_json) => crate::cli::tasks_exclude_paths(&config_json),
        Err(error) => {
            log::warn!("[plugin index] no config.json to read task exclusions from: {error}");
            Vec::new()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::context::{ContextInfo, ContextType};
    use crate::plugin::index_reads::SearchArgs;
    use serde_json::json;

    /// A mock-runtime app carrying the states the two edges read.
    fn app_with_states() -> tauri::App<tauri::test::MockRuntime> {
        let app = tauri::test::mock_app();
        app.manage(crate::VaultRootState(tokio::sync::RwLock::new(None)));
        app.manage(ContextManager::new());
        app.manage(LinkIndexState::new());
        app
    }

    fn info(id: &str, path: &str, kind: ContextType) -> ContextInfo {
        ContextInfo {
            id: id.to_string(),
            context_type: kind,
            path: path.to_string(),
            label: id.to_string(),
            color: "#ffffff".to_string(),
            alias: None,
            vault_type: None,
            added_at: 0,
        }
    }

    /// A folder context `id` holding `files`; the directory and its registered path.
    async fn folder_with(
        app: &tauri::App<tauri::test::MockRuntime>,
        id: &str,
        files: &[(&str, &str)],
    ) -> (tempfile::TempDir, String) {
        let dir = tempfile::tempdir().unwrap();
        for (path, content) in files {
            let path = dir.path().join(path);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, content).unwrap();
        }
        let root = dir.path().to_str().unwrap().to_string();
        app.state::<ContextManager>()
            .add(info(id, &root, ContextType::Folder))
            .await
            .unwrap();
        (dir, root)
    }

    /// The `path` of each row of a rows array — the one helper for that shape in this module.
    fn paths(rows: serde_json::Value) -> Vec<String> {
        rows.as_array()
            .unwrap()
            .iter()
            .map(|row| row["path"].as_str().unwrap().to_string())
            .collect()
    }

    const LINKED: &[(&str, &str)] = &[("a.md", "see [[b]] #t\n- [ ] task\n"), ("b.md", "target\n")];

    /// Every read, with context-relative paths that name what `LINKED` holds.
    fn every_relative_read() -> Vec<IndexRead> {
        vec![
            IndexRead::Backlinks {
                path: "b.md".into(),
            },
            IndexRead::Links {
                path: "a.md".into(),
            },
            IndexRead::NotesWithTag { tag: "t".into() },
            IndexRead::Search {
                query: "see".into(),
                options: SearchArgs::default(),
            },
            IndexRead::Tags,
            IndexRead::Tasks {
                status: None,
                file: Some("a.md".into()),
            },
        ]
    }

    /// Spec §5.2 · §8 (B): each path argument meets the file ops' own gate — an absolute path,
    /// a `..` and `.baram` (a search `folder` too: `.baram/snapshots` holds deleted versions)
    /// are refused as `ctx.files` refuses them. What fails this: checking with
    /// `plugin_target_path` alone (no vault rule, no `.baram`), or a `file`/`folder` left
    /// unchecked. The pair: every read with in-vault paths answers.
    #[tokio::test]
    async fn a_sandboxed_read_refuses_the_paths_the_file_ops_refuse() {
        let app = app_with_states();
        let (_dir, _root) = folder_with(&app, "ctx-a", LINKED).await;
        app.state::<ContextManager>()
            .set_active("ctx-a")
            .await
            .unwrap();
        let path_reads = |path: &str| {
            vec![
                IndexRead::Backlinks { path: path.into() },
                IndexRead::Links { path: path.into() },
                IndexRead::Tasks {
                    status: None,
                    file: Some(path.into()),
                },
                IndexRead::Search {
                    query: "x".into(),
                    options: SearchArgs {
                        folder: Some(path.into()),
                        ..SearchArgs::default()
                    },
                },
            ]
        };
        for (path, refusal) in [
            ("/etc/passwd", "must be relative to the context root"),
            ("../outside.md", "must be relative to the context root"),
            (".baram/config.json", ".baram/ is app state"),
            (".baram/snapshots", ".baram/ is app state"),
        ] {
            for read in path_reads(path) {
                let err = sandboxed_read(app.handle(), None, read.clone(), Vec::new)
                    .await
                    .unwrap_err();
                assert!(err.contains(refusal), "{path} {read:?}: {err}");
            }
        }
        for read in every_relative_read() {
            let answer = sandboxed_read(app.handle(), None, read.clone(), Vec::new).await;
            assert!(answer.is_ok(), "{read:?}: {answer:?}");
        }
    }

    /// D17 · spec §7: an unknown context and a single-file context are refused by the id the
    /// caller sent, for all six reads. What fails this: anchoring either to the active context.
    /// The pair: the same reads with the folder's id answer.
    #[tokio::test]
    async fn a_sandboxed_read_refuses_an_unknown_or_single_file_context_by_id() {
        let app = app_with_states();
        let (dir, _root) = folder_with(&app, "ctx-a", LINKED).await;
        let file = dir.path().join("b.md");
        app.state::<ContextManager>()
            .add(info("ctx-file", file.to_str().unwrap(), ContextType::File))
            .await
            .unwrap();
        app.state::<ContextManager>()
            .set_active("ctx-a")
            .await
            .unwrap();
        for read in every_relative_read() {
            let unknown = sandboxed_read(app.handle(), Some("nope".into()), read.clone(), Vec::new)
                .await
                .unwrap_err();
            let single = sandboxed_read(
                app.handle(),
                Some("ctx-file".into()),
                read.clone(),
                Vec::new,
            )
            .await
            .unwrap_err();
            assert_eq!(unknown, "unknown context \"nope\"", "{read:?}");
            assert_eq!(
                single, "context \"ctx-file\" is a single file, which has no index",
                "{read:?}"
            );
            let named =
                sandboxed_read(app.handle(), Some("ctx-a".into()), read.clone(), Vec::new).await;
            assert!(named.is_ok(), "{read:?}: {named:?}");
        }
    }

    /// D6: the sandboxed edge writes rows relative to the context root. What fails this: the
    /// edge building its scope with `PathForm::Absolute` (the row would carry the vault's
    /// location into the sandbox).
    #[tokio::test]
    async fn a_sandboxed_read_answers_with_context_relative_rows() {
        let app = app_with_states();
        let (_dir, root) = folder_with(&app, "ctx-a", LINKED).await;
        let rows = sandboxed_read(
            app.handle(),
            Some("ctx-a".into()),
            IndexRead::Backlinks {
                path: "b.md".into(),
            },
            Vec::new,
        )
        .await
        .unwrap();
        assert_eq!(
            rows,
            json!([{ "blockId": null, "line": 1, "path": "a.md", "snippet": "see [[b]] #t", "type": "wikilink" }])
        );
        assert!(!rows.to_string().contains(&root));
    }

    /// D9 (m3): the exclusions the edge is handed reach the tasks read — and are read only for
    /// it. The tests here inject them, so none reads the developer's real `config.json`. What
    /// fails this: the edge dropping `exclude` on the way to `check_paths`, or calling it for
    /// a read that is not `Tasks`. The pair: with an empty list the excluded folder's task is
    /// there.
    #[tokio::test]
    async fn a_sandboxed_tasks_read_applies_the_exclusions_it_is_handed() {
        let app = app_with_states();
        let (_dir, _root) = folder_with(
            &app,
            "ctx-a",
            &[("a.md", "- [ ] keep\n"), ("archive/o.md", "- [ ] hidden\n")],
        )
        .await;
        app.state::<ContextManager>()
            .set_active("ctx-a")
            .await
            .unwrap();
        let tasks = IndexRead::Tasks {
            status: None,
            file: None,
        };

        let excluded = sandboxed_read(app.handle(), None, tasks.clone(), || {
            vec!["archive".to_string()]
        })
        .await
        .unwrap();
        let all = sandboxed_read(app.handle(), None, tasks, Vec::new)
            .await
            .unwrap();
        let tags = sandboxed_read(app.handle(), None, IndexRead::Tags, || {
            panic!("only a tasks read reads the exclusions")
        })
        .await;

        assert_eq!(paths(excluded), ["a.md"]);
        assert_eq!(paths(all), ["a.md", "archive/o.md"]);
        assert!(tags.is_ok());
    }
}
