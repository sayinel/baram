//! §393 The read layer's tests. Paths arrive as the tier edges hand them over — `PathArg`s
//! already through a gate (`arg`) — so these pin what the layer itself does: confine, re-root,
//! write and refuse. The gates themselves are tested at the edges
//! (`commands/plugin_index_cmd.rs`).

use super::*;
use crate::context::{ContextInfo, ContextManager, ContextType};
use crate::index::service::LinkIndexState;
use crate::task::TaskStatus;

mod check_paths;
mod refusals;
mod row_shapes;

fn folder(id: &str, path: &str) -> ContextInfo {
    ContextInfo {
        id: id.to_string(),
        context_type: ContextType::Folder,
        path: path.to_string(),
        label: id.to_string(),
        color: "#ffffff".to_string(),
        alias: None,
        vault_type: None,
        added_at: 0,
    }
}

/// A folder context registered under `id`, holding `files` (path under the root, content);
/// the directory and its registered spelling.
async fn context_with(
    ctx: &ContextManager,
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
    ctx.add(folder(id, &root)).await.unwrap();
    (dir, root)
}

/// `relative` (`/`-separated) under `root` as `PathForm::Absolute` writes it: the root as
/// registered, each further part joined with the OS separator. On unix that is
/// `{root}/{relative}`.
fn absolute(root: &str, relative: &str) -> String {
    relative
        .split('/')
        .fold(std::path::PathBuf::from(root), |path, part| path.join(part))
        .to_string_lossy()
        .into_owned()
}

/// The scope an edge would build for `id`.
async fn scope(ctx: &ContextManager, id: &str, form: PathForm) -> Scope {
    Scope {
        ctx: resolve_scope(ctx, Some(id.to_string())).await.unwrap(),
        form,
    }
}

/// `relative` under `dir` as an edge hands it over: the caller's string and the canonical path
/// it names (which may not exist).
fn arg(dir: &tempfile::TempDir, relative: &str) -> PathArg {
    let path = dir.path().join(relative);
    PathArg {
        given: relative.to_string(),
        canonical: crate::context::manager::resolve_canonical(path.to_str().unwrap()).unwrap(),
    }
}
