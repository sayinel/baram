// §394 The note a plugin-rendered block's `data-note` link opens (spec 0073 D11 ②). A host-window
// command: the main window judges a click inside a block it drew and asks this for the path to
// open, or a refusal. Generic over the runtime so the tests run the real gate on a mock app.

use crate::context::{ContextManager, ContextType};
use std::path::Path;
use tauri::Manager;

/// The refusal the frontend receives for every reason (spec 0073 §6): it shows a fixed toast. The
/// reason itself goes to the log — it can name a resolved path, which is the app's, not the user's
/// business in a toast.
const NOT_A_NOTE: &str = "the link does not name a note in this vault";

/// §394 Resolve `path` — `/`-relative to context `context`'s root, as a `data-note` value is — to
/// the absolute path of an existing note under that root, spelled under the root's REGISTERED
/// path (what the app's tabs and file tree use). Refuses with `NOT_A_NOTE` and logs why.
#[tauri::command]
pub async fn plugin_note_link<R: tauri::Runtime>(
    context: String,
    path: String,
    app: tauri::AppHandle<R>,
) -> Result<String, String> {
    note_link(&app, &context, &path).await.map_err(|reason| {
        log::warn!("{}", refusal_line(&path, &context, &reason));
        NOT_A_NOTE.to_string()
    })
}

/// The log line of a refusal. `path` is a sandboxed plugin's text (`data-note`), and a reason can
/// repeat it — the gate's reason for a `..` path quotes the path as written — so all three are
/// written escaped (`{:?}`): a line break in them cannot start a line of its own in the app log.
fn refusal_line(path: &str, context: &str, reason: &str) -> String {
    format!("[plugin note link] refused {path:?} in context {context:?}: {reason:?}")
}

/// The judgement, with the reason kept for the log and the tests. In order: a directory context
/// (a File context has no interior path); the gate `ctx.files` paths take
/// (`plugin_cmd::check_plugin_file_path` — absolute paths, `..`, `.baram` and paths outside every
/// registered context are refused, and the result is canonical, symlinks resolved); the canonical
/// path under THIS context's canonical root (the gate admits any registered context, so a symlink
/// under this root that leads into another one passes it); a note name (`fs::is_note_name` — a
/// click must not open `.html` in the script-running preview); an existing file.
async fn note_link<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    context: &str,
    path: &str,
) -> Result<String, String> {
    let registered = app
        .state::<ContextManager>()
        .registered(context)
        .await
        .ok_or_else(|| format!("unknown context {context:?}"))?;
    match registered.info.context_type {
        ContextType::Vault | ContextType::Folder => {}
        ContextType::File => return Err(format!("context {context:?} is a single file")),
    }
    let canonical = super::plugin_cmd::check_plugin_file_path(app, Some(context), path).await?;
    let relative = canonical
        .strip_prefix(&registered.canonical_path)
        .map_err(|_| "the resolved path leaves the context root".to_string())?;
    let name = canonical
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default();
    if !crate::fs::is_note_name(name) {
        return Err(format!("{name:?} is not a note"));
    }
    let metadata = tokio::fs::metadata(&canonical)
        .await
        .map_err(|e| format!("cannot read the target: {e}"))?;
    if !metadata.is_file() {
        return Err("the target is not a file".to_string());
    }
    Path::new(&registered.info.path)
        .join(relative)
        .to_str()
        .map(str::to_string)
        .ok_or_else(|| "the path is not valid UTF-8".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::context::ContextInfo;

    /// A mock-runtime app carrying the states the gate reads (the same three
    /// `plugin_index_cmd`'s tests manage).
    fn app_with_states() -> tauri::App<tauri::test::MockRuntime> {
        let app = tauri::test::mock_app();
        app.manage(crate::VaultRootState(tokio::sync::RwLock::new(None)));
        app.manage(ContextManager::new());
        app.manage(crate::index::service::LinkIndexState::new());
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

    const NOTES: &[(&str, &str)] = &[
        ("notes/a.md", "a\n"),
        ("notes/b.markdown", "b\n"),
        ("page.html", "<p>x</p>\n"),
        ("dir.md/inner.md", "inner\n"),
        (".baram/state.md", "s\n"),
    ];

    /// §394 What fails this: returning the canonical spelling (on macOS a tempdir root is
    /// `/var/…`, canonical `/private/var/…` — a tab opened there would not match the file tree's
    /// path), or refusing `.markdown`. The pair of every refusal below.
    #[tokio::test]
    async fn a_note_under_the_root_opens_in_the_registered_spelling() {
        let app = app_with_states();
        let (_dir, root) = folder_with(&app, "ctx", NOTES).await;
        let handle = app.handle();
        assert_eq!(
            note_link(handle, "ctx", "notes/a.md").await,
            Ok(format!("{root}/notes/a.md"))
        );
        assert_eq!(
            note_link(handle, "ctx", "notes/b.markdown").await,
            Ok(format!("{root}/notes/b.markdown"))
        );
    }

    /// §394 spec §7 — `..`, an absolute path, `.baram`, a non-note (`.html` — the HTML preview
    /// runs scripts), a missing file, a directory whose name ends in `.md`, an unknown context.
    /// What fails this: dropping any one of the checks `note_link` adds on top of the gate, or
    /// calling a weaker gate than `check_plugin_file_path`.
    #[tokio::test]
    async fn the_gate_refuses_what_is_not_an_existing_note_under_the_root() {
        let app = app_with_states();
        let (_dir, root) = folder_with(&app, "ctx", NOTES).await;
        let handle = app.handle();
        for path in [
            "../outside.md".to_string(),
            format!("{root}/notes/a.md"),
            ".baram/state.md".to_string(),
            "page.html".to_string(),
            "notes/missing.md".to_string(),
            "dir.md".to_string(),
        ] {
            assert!(note_link(handle, "ctx", &path).await.is_err(), "{path}");
        }
        assert!(note_link(handle, "nope", "notes/a.md").await.is_err());
        // The command's refusal is the fixed sentence, whatever the reason.
        assert_eq!(
            plugin_note_link("ctx".into(), "page.html".into(), handle.clone()).await,
            Err(NOT_A_NOTE.to_string())
        );
    }

    /// §394 plan 0125 final review M2 — `path` is a sandboxed plugin's text, and a reason can
    /// repeat it: the gate's reason for a `..` path quotes it as written (the positive half below —
    /// the reason does hold the line break). What fails this: a log line that writes `path`,
    /// `context` or the reason with Display (a line break in `data-note` would start a forged line in
    /// the app log), or a reason of this file's that writes the file name with Display.
    #[tokio::test]
    async fn a_refusal_is_logged_on_one_line_whatever_the_link_holds() {
        let app = app_with_states();
        let (_dir, _root) = folder_with(&app, "ctx", NOTES).await;
        let handle = app.handle();
        let path = "../x\n[forged] line";
        let reason = note_link(handle, "ctx", path).await.unwrap_err();
        assert!(reason.contains('\n'), "{reason}");
        let line = refusal_line(path, "ctx\n[forged]", &reason);
        assert!(!line.contains('\n'), "{line}");
        assert!(line.contains(r"\n[forged] line"), "{line}");
        let reason = note_link(handle, "ctx", "notes/a\n.html")
            .await
            .unwrap_err();
        assert!(!reason.contains('\n'), "{reason}");
    }

    /// §394 spec D11 ② "루트 밖을 가리키는 심볼릭 링크" — a link under context A that leads into
    /// ANOTHER registered context passes `check_plugin_file_path` (it admits any registered
    /// context), so only the canonical-root check stops it. What fails this: removing
    /// `strip_prefix(&registered.canonical_path)`. The pair: a link to a note inside A opens it.
    #[cfg(unix)]
    #[tokio::test]
    async fn a_symlink_out_of_the_root_is_refused_and_one_inside_it_opens_its_target() {
        let app = app_with_states();
        let (dir_a, root_a) = folder_with(&app, "a", NOTES).await;
        let (dir_b, _root_b) = folder_with(&app, "b", &[("secret.md", "s\n")]).await;
        std::os::unix::fs::symlink(dir_b.path().join("secret.md"), dir_a.path().join("out.md"))
            .unwrap();
        std::os::unix::fs::symlink(dir_a.path().join("notes/a.md"), dir_a.path().join("in.md"))
            .unwrap();
        let handle = app.handle();
        assert!(note_link(handle, "a", "out.md").await.is_err());
        assert_eq!(
            note_link(handle, "a", "in.md").await,
            Ok(format!("{root_a}/notes/a.md"))
        );
    }
}
