// §393 The two edges of `ctx.index` (spec 0072 §5.2 · §5.3). Each names the context a read
// answers from, puts each path argument through its tier's own gate, and hands the checked
// read to `plugin::index_reads::run` — one function for both tiers, so their rows cannot
// drift. Generic over the runtime so the tests run the real gates on a mock app.

use crate::context::manager::Registered;
use crate::context::{ContextManager, ContextType};
use crate::index::service::LinkIndexState;
use crate::plugin::index_reads::{
    check_paths, resolve_scope, run, IndexRead, PathArg, PathForm, Scope,
};
use crate::plugin::vault_path::{authorized_path_str, reject_app_state_path};
use std::path::Path;
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

/// §393 One read from a trusted plugin (spec §5.3): a host-window command — the trusted tier's
/// way to the same Rust reads the broker runs, so the two tiers' rows cannot drift. The plugin
/// shares the app's realm and could reach the app's own commands (`get_backlinks`), so this adds
/// no boundary, and like those commands it has no rate budget. The context is the one named,
/// else — for a read that takes a path — the innermost directory context holding that path,
/// else the active one. Every path must be absolute, inside a registered context, outside
/// `.baram`, and under the chosen context's root (`index_reads`). Rows are absolute.
#[tauri::command]
pub async fn plugin_index_read<R: tauri::Runtime>(
    context: Option<String>,
    read: IndexRead,
    app: tauri::AppHandle<R>,
) -> Result<serde_json::Value, String> {
    index_read_with(context, read, &app, || tasks_exclude(&app)).await
}

/// `plugin_index_read` with the task panel's exclusions injected (m3): the command passes the
/// app's `config.json` reader, tests pass a list, so none reads the developer's real one.
async fn index_read_with<R: tauri::Runtime>(
    context: Option<String>,
    read: IndexRead,
    app: &tauri::AppHandle<R>,
    exclude: impl FnOnce() -> Vec<String>,
) -> Result<serde_json::Value, String> {
    let ctx_mgr = app.state::<ContextManager>();
    let state = app.state::<LinkIndexState>();
    let scope = Scope {
        ctx: trusted_scope(ctx_mgr.inner(), context, &read).await?,
        form: PathForm::Absolute,
    };
    let checked = check_paths(read, |given| trusted_path(app, given), exclude).await?;
    run(state.inner(), ctx_mgr.inner(), &scope, checked).await
}

/// The context a trusted read answers from (spec §4 `IndexOptions.context`): the one named;
/// else, for a read that takes an absolute path, the innermost directory context holding it
/// (`contexts_containing` lists them deepest first); else the active one.
async fn trusted_scope(
    ctx_mgr: &ContextManager,
    context: Option<String>,
    read: &IndexRead,
) -> Result<Registered, String> {
    if context.is_none() {
        if let Some(path) = read.path_arg().filter(|path| Path::new(path).is_absolute()) {
            let innermost =
                ctx_mgr
                    .contexts_containing(path)
                    .await
                    .into_iter()
                    .find(|ctx| match ctx.info.context_type {
                        ContextType::Vault | ContextType::Folder => true,
                        ContextType::File => false,
                    });
            if let Some(innermost) = innermost {
                return Ok(innermost);
            }
        }
    }
    resolve_scope(ctx_mgr, context).await
}

/// A trusted path argument: absolute, free of a `..` segment and a null byte (the first check
/// `fs_cmd::read_file` runs, `fs::validate_path`, applied to the path as given, before it is
/// resolved), inside a registered context (`fs_cmd::ensure_path_in_vault`, the vault check
/// `read_file` also runs) and outside `.baram` (`vault_path::reject_app_state_path`, which the
/// sandboxed file ops run). A relative path is refused rather than resolved against the
/// process's directory.
async fn trusted_path<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    given: String,
) -> Result<PathArg, String> {
    if !Path::new(&given).is_absolute() {
        return Err(format!("path \"{given}\" must be absolute"));
    }
    crate::fs::validate_path(&given).map_err(|e| e.to_string())?;
    let canonical = crate::context::manager::resolve_canonical(&given)?;
    super::fs_cmd::ensure_path_in_vault(app, authorized_path_str(&canonical)?).await?;
    reject_app_state_path(&canonical)?;
    Ok(PathArg { given, canonical })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::context::ContextInfo;
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

    /// `relative` (`/`-separated) under `root` as a trusted row writes it (`PathForm::Absolute`):
    /// the root as registered, each further part joined with the OS separator. On unix that is
    /// `{root}/{relative}`.
    fn absolute(root: &str, relative: &str) -> String {
        relative
            .split('/')
            .fold(std::path::PathBuf::from(root), |path, part| path.join(part))
            .to_string_lossy()
            .into_owned()
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

    /// Spec §5.3: a named context answers, and a path outside it is refused rather than
    /// answered from wherever the path lies. What fails this: choosing the context by the path
    /// even when one is named, or no root check (P12). The pair: naming the path's own context
    /// answers, with absolute rows in its registered spelling.
    #[tokio::test]
    async fn a_trusted_read_answers_from_the_named_context_and_refuses_a_path_outside_it() {
        let app = app_with_states();
        let (_a, _a_root) = folder_with(&app, "ctx-a", &[("x.md", "x\n")]).await;
        let (_b, b_root) = folder_with(&app, "ctx-b", LINKED).await;
        app.state::<ContextManager>()
            .set_active("ctx-a")
            .await
            .unwrap();
        let note = format!("{b_root}/b.md");
        let backlinks = |context: &str| {
            index_read_with(
                Some(context.into()),
                IndexRead::Backlinks { path: note.clone() },
                app.handle(),
                Vec::new,
            )
        };

        assert_eq!(
            backlinks("ctx-a").await.unwrap_err(),
            format!("path \"{note}\" is not inside context \"ctx-a\"")
        );
        assert_eq!(
            backlinks("ctx-b").await.unwrap(),
            json!([{ "blockId": null, "line": 1, "path": absolute(&b_root, "a.md"), "snippet": "see [[b]] #t", "type": "wikilink" }])
        );
    }

    /// Spec §4 `IndexOptions.context`: with no name, a read that takes a path answers from the
    /// innermost vault or folder holding it — one context (D7). What fails this: answering from
    /// the active context (the outer vault here), whose rows include the note outside the
    /// folder. The pair: naming the outer vault gets those rows.
    #[tokio::test]
    async fn without_a_name_a_path_read_answers_from_the_innermost_directory_context() {
        let app = app_with_states();
        let (_outer, outer_root) = folder_with(
            &app,
            "ctx-outer",
            &[
                ("sub/n.md", "target\n"),
                ("sub/in.md", "[[n]]\n"),
                ("out.md", "[[n]]\n"),
            ],
        )
        .await;
        let inner_root = format!("{outer_root}/sub");
        app.state::<ContextManager>()
            .add(info("ctx-inner", &inner_root, ContextType::Folder))
            .await
            .unwrap();
        app.state::<ContextManager>()
            .set_active("ctx-outer")
            .await
            .unwrap();
        let note = format!("{inner_root}/n.md");

        let unnamed = index_read_with(
            None,
            IndexRead::Backlinks { path: note.clone() },
            app.handle(),
            Vec::new,
        )
        .await
        .unwrap();
        let named = index_read_with(
            Some("ctx-outer".into()),
            IndexRead::Backlinks { path: note },
            app.handle(),
            Vec::new,
        )
        .await
        .unwrap();

        assert_eq!(paths(unnamed), [absolute(&inner_root, "in.md")]);
        assert_eq!(
            paths(named),
            [
                absolute(&outer_root, "out.md"),
                absolute(&outer_root, "sub/in.md")
            ]
        );
    }

    /// With no name and no path, the active context answers; switching it switches the answer.
    /// What fails this: a context fixed at the first read.
    #[tokio::test]
    async fn without_a_name_or_a_path_the_active_context_answers() {
        let app = app_with_states();
        let (_a, _) = folder_with(&app, "ctx-a", &[("a.md", "#alpha\n")]).await;
        let (_b, _) = folder_with(&app, "ctx-b", &[("b.md", "#beta\n")]).await;
        let ctx_mgr = app.state::<ContextManager>();

        ctx_mgr.set_active("ctx-a").await.unwrap();
        let first = index_read_with(None, IndexRead::Tags, app.handle(), Vec::new)
            .await
            .unwrap();
        ctx_mgr.set_active("ctx-b").await.unwrap();
        let second = index_read_with(None, IndexRead::Tags, app.handle(), Vec::new)
            .await
            .unwrap();

        assert_eq!(first, json!([{ "count": 1, "tag": "alpha" }]));
        assert_eq!(second, json!([{ "count": 1, "tag": "beta" }]));
    }

    /// Spec §5.3 · §7: a trusted path must be absolute, inside a registered context and outside
    /// `.baram`. What fails this: resolving a relative path against the process's directory, or
    /// skipping `ensure_path_in_vault` / `reject_app_state_path`. The pair: the same read with
    /// the note's absolute path answers.
    #[tokio::test]
    async fn a_trusted_path_must_be_absolute_registered_and_not_app_state() {
        let app = app_with_states();
        let (_a, root) = folder_with(&app, "ctx-a", LINKED).await;
        let elsewhere = tempfile::tempdir().unwrap();
        std::fs::write(elsewhere.path().join("x.md"), "x\n").unwrap();
        app.state::<ContextManager>()
            .set_active("ctx-a")
            .await
            .unwrap();
        let links =
            |path: String| index_read_with(None, IndexRead::Links { path }, app.handle(), Vec::new);

        assert_eq!(
            links("a.md".into()).await.unwrap_err(),
            "path \"a.md\" must be absolute"
        );
        assert!(links(format!("{root}/.baram/x.md"))
            .await
            .unwrap_err()
            .contains(".baram/ is app state"));
        assert!(
            links(elsewhere.path().join("x.md").to_string_lossy().into_owned())
                .await
                .unwrap_err()
                .contains("outside all registered contexts")
        );
        assert!(links(format!("{root}/a.md")).await.is_ok());
    }

    /// Spec §7: a trusted path with a `..` segment is refused with the file ops' own wording
    /// (`fs::validate_path`, the first check `fs_cmd::read_file` runs). What fails this:
    /// canonicalising before checking, which resolves `a/../a.md` to an in-vault note and
    /// answers. The pair: the same note without the `..` answers.
    #[tokio::test]
    async fn a_trusted_path_with_a_parent_segment_is_refused_as_the_file_ops_refuse_it() {
        let app = app_with_states();
        let (_a, root) =
            folder_with(&app, "ctx-a", &[("a/a.md", "see [[b]]\n"), ("b.md", "t\n")]).await;
        let links =
            |path: String| index_read_with(None, IndexRead::Links { path }, app.handle(), Vec::new);

        let traversal = format!("{root}/a/../a/a.md");
        let refusal = crate::fs::validate_path(&traversal)
            .unwrap_err()
            .to_string();
        assert!(refusal.contains("Path traversal is not allowed"));
        assert_eq!(links(traversal).await.unwrap_err(), refusal);
        assert!(links(format!("{root}/a/a.md")).await.is_ok());
    }

    /// D9 (m3): the trusted edge hands the exclusions it is given to the tasks read, and the
    /// tests inject them — none reads the developer's real `config.json`. What fails this: the
    /// edge dropping `exclude` before `check_paths`. The pair: an empty list keeps the excluded
    /// folder's task, in its absolute spelling.
    #[tokio::test]
    async fn a_trusted_tasks_read_applies_the_exclusions_it_is_handed() {
        let app = app_with_states();
        let (_a, root) = folder_with(
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

        let excluded = index_read_with(None, tasks.clone(), app.handle(), || {
            vec!["archive".to_string()]
        })
        .await
        .unwrap();
        let all = index_read_with(None, tasks, app.handle(), Vec::new)
            .await
            .unwrap();

        assert_eq!(paths(excluded), [absolute(&root, "a.md")]);
        assert_eq!(
            paths(all),
            [absolute(&root, "a.md"), absolute(&root, "archive/o.md")]
        );
    }

    /// The command is reachable by name, with its camelCase arguments and its `read` tag. The
    /// tests above call the function directly and would not notice it unregistered or its
    /// argument shape changed — `search_cmd`'s twin exists for the same reason. What fails
    /// this: a `read` that does not deserialize (serde's error instead) or an unknown command.
    #[test]
    fn plugin_index_read_is_dispatchable_by_name() {
        let app = tauri::test::mock_builder()
            .invoke_handler(tauri::generate_handler![super::plugin_index_read])
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .expect("mock app must build");
        app.manage(crate::VaultRootState(tokio::sync::RwLock::new(None)));
        app.manage(ContextManager::new());
        app.manage(LinkIndexState::new());
        let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .expect("mock webview must build");

        let res = tauri::test::get_ipc_response(
            &webview,
            tauri::webview::InvokeRequest {
                cmd: "plugin_index_read".into(),
                callback: tauri::ipc::CallbackFn(0),
                error: tauri::ipc::CallbackFn(1),
                url: if cfg!(any(windows, target_os = "android")) {
                    "http://tauri.localhost"
                } else {
                    "tauri://localhost"
                }
                .parse()
                .unwrap(),
                body: tauri::ipc::InvokeBody::Json(json!({ "read": { "read": "tags" } })),
                headers: Default::default(),
                invoke_key: tauri::test::INVOKE_KEY.to_string(),
            },
        );

        assert_eq!(
            res.expect_err("no context is registered yet"),
            json!("no context is open")
        );
    }
}
