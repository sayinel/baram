// §3.2 The directory-watch commands (issue 797): who may watch what, and telling a
// window when a lease it holds has ended. The lease model is `fs::watch_registry`.
//
// Two events leave here:
// - `watch:lease-ended` `{ lease }`, to the window that held it — the registry ended it
//   (its watcher stopped, its host could not start, what authorized it went away). The
//   frontend queues that watch again (`src/services/watch-leases.ts`).
// - `watch:retry`, to every window — a watcher stopped (room under the cap) or a context
//   was registered (a refused watch may be authorized now). Queued watches ask again.

use std::path::{Path, PathBuf};

use tauri::{Emitter, Manager};

use super::fs_cmd::{check, vault_fallback_decision};
use crate::fs::watch_registry::{LeaseRequest, LeaseView, WatchSpec, UNAUTHORIZED};
use crate::index::service::ExternalChanges;

/// §3.2 Watch `path` for the calling window and answer the lease that holds the watch
/// (#797); `unwatch_dir` gives it back, and the window's destruction gives back every
/// lease it holds. `page` is what `release_window_watches` answered this page.
///
/// Only what the app already opened may be watched (the events tell a page the names
/// and times of what changes there) — `authorize_watch`.
#[tauri::command]
pub async fn watch_dir(
    path: String,
    recursive: Option<bool>,
    focus: Option<String>,
    page: u64,
    window: tauri::Window,
    app_handle: tauri::AppHandle,
) -> Result<u64, String> {
    let request = Request {
        window: window.label(),
        path: &path,
        recursive: recursive.unwrap_or(true),
        focus: focus.as_deref(),
        page,
    };
    take_lease(&app_handle, &request, || authorize(&app_handle, &request)).await
}

/// What a page asks `watch_dir` for.
struct Request<'a> {
    window: &'a str,
    path: &'a str,
    recursive: bool,
    focus: Option<&'a str>,
    page: u64,
}

/// Authorize `request`, take its lease, and authorize it again: a context removed or an
/// approval revoked while it was being taken swept the leases before this one existed,
/// so the second check — against the state after the sweep — gives it back.
async fn take_lease<R: tauri::Runtime, F: std::future::Future<Output = Result<PathBuf, String>>>(
    app: &tauri::AppHandle<R>,
    request: &Request<'_>,
    authorize: impl Fn() -> F,
) -> Result<u64, String> {
    let authority = authorize().await?;
    let id = with_registry(app, |registry, spawn| {
        registry.acquire(
            LeaseRequest {
                window: request.window,
                path: request.path,
                recursive: request.recursive,
                focus: request.focus,
                authority,
                page: request.page,
            },
            spawn,
        )
    })??;
    if let Err(e) = authorize().await {
        let _ = with_registry(app, |registry, spawn| {
            registry.release(request.window, id, spawn)
        });
        return Err(e);
    }
    Ok(id)
}

/// `authorize_watch` against the app's contexts, legacy root and approvals now.
async fn authorize<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    request: &Request<'_>,
) -> Result<PathBuf, String> {
    let ctx_mgr = app.state::<crate::context::ContextManager>();
    let legacy_root = app.state::<crate::VaultRootState>().0.read().await.clone();
    let approvals = crate::approval::load(app);
    authorize_watch(
        &ctx_mgr,
        legacy_root.as_deref(),
        &approvals,
        request.path,
        request.recursive,
        request.focus,
    )
    .await
    .map_err(|e| format!("{UNAUTHORIZED}: {e}"))
}

/// §3.2 What `watch_dir` may watch (#797), and the canonical root that allows it:
/// - recursively (the default), only a registered folder or vault root — exactly one,
///   not a folder below or above it — which is the authority;
/// - non-recursively, only the folder of a `focus` file a registered context holds
///   (`check_vault`'s rule: any context, or the legacy vault root when none is
///   registered) — `path` must be that file's canonical folder, and the file is the
///   authority.
///
/// Either way the authority must be approved now (§331): a registration outlives the
/// revocation of its approval until the frontend closes the context, and a watch must
/// not.
pub(crate) async fn authorize_watch(
    ctx_mgr: &crate::context::ContextManager,
    legacy_root: Option<&Path>,
    approvals: &crate::approval::ApprovalStore,
    path: &str,
    recursive: bool,
    focus: Option<&str>,
) -> Result<PathBuf, String> {
    check(path)?;
    if recursive {
        if ctx_mgr.context_registered_at(path).await.is_none() {
            return Err(format!("{path} is not a registered folder or vault"));
        }
        return approved(approvals, crate::context::manager::resolve_canonical(path)?);
    }
    let Some(file) = focus else {
        return Err("a folder watched for one file must name that file".into());
    };
    check(file)?;
    if ctx_mgr.list().await.is_empty() {
        vault_fallback_decision(legacy_root, file)?;
    } else {
        ctx_mgr.validate_path_any(file).await?;
    }
    let file = crate::context::manager::resolve_canonical(file)?;
    if file.parent() != Some(crate::context::manager::resolve_canonical(path)?.as_path()) {
        return Err(format!("{path} is not the folder of {}", file.display()));
    }
    approved(approvals, file)
}

fn approved(
    approvals: &crate::approval::ApprovalStore,
    authority: PathBuf,
) -> Result<PathBuf, String> {
    match crate::approval::decide(approvals, &authority.to_string_lossy()).0 {
        crate::approval::Decision::Allowed => Ok(authority),
        _ => Err(format!("{} is not approved", authority.display())),
    }
}

/// §3.2 Give back a watch lease the calling window holds (#797). Another window's
/// lease is refused.
#[tauri::command]
pub async fn unwatch_dir(
    lease: u64,
    window: tauri::Window,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    with_registry(&app_handle, |registry, spawn| {
        registry.release(window.label(), lease, spawn)
    })?
}

/// §3.2 A page of the calling window begins (#797): every lease the window holds is
/// given back and requests from its earlier pages are refused. A page calls it once
/// when it loads, before it watches anything — a reload or navigation fires no
/// `Destroyed` and need not run the old page's cleanups, and an old page's `watch_dir`
/// may still be in flight. Answers the page number `watch_dir` must carry.
#[tauri::command]
pub async fn release_window_watches(
    window: tauri::Window,
    app_handle: tauri::AppHandle,
) -> Result<u64, String> {
    with_registry(&app_handle, |registry, spawn| {
        registry.begin_page(window.label(), spawn)
    })
}

/// The window `label` is gone: its leases go with it.
pub(crate) fn release_window<R: tauri::Runtime>(app: &tauri::AppHandle<R>, label: &str) {
    let _ = with_registry(app, |registry, spawn| registry.release_window(label, spawn));
}

/// §3.2 Context `removed` (canonical) was removed (#797): every lease it authorized is
/// checked again, and those nothing else authorizes end — a file window watching a
/// file of the removed vault stops at once, not when its page next asks.
pub(crate) async fn after_context_removed<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    removed: &Path,
) {
    let views = match with_registry(app, |registry, _| {
        registry.leases_where(|lease| lease.authority.starts_with(removed))
    }) {
        Ok(views) => views,
        Err(_) => return,
    };
    let ctx_mgr = app.state::<crate::context::ContextManager>();
    let legacy_root = app.state::<crate::VaultRootState>().0.read().await.clone();
    let approvals = crate::approval::load(app);
    let (kept, lapsed) = reauthorize(&ctx_mgr, legacy_root.as_deref(), &approvals, views).await;
    let _ = with_registry(app, |registry, spawn| {
        for (id, authority) in kept {
            registry.set_authority(id, authority);
        }
        registry.end_leases(&lapsed, spawn);
    });
}

/// Each lease checked again: those still authorized, with what authorizes them now,
/// and those not.
async fn reauthorize(
    ctx_mgr: &crate::context::ContextManager,
    legacy_root: Option<&Path>,
    approvals: &crate::approval::ApprovalStore,
    views: Vec<LeaseView>,
) -> (Vec<(u64, PathBuf)>, Vec<u64>) {
    let mut kept = Vec::new();
    let mut lapsed = Vec::new();
    for view in views {
        match authorize_watch(
            ctx_mgr,
            legacy_root,
            approvals,
            &view.path,
            view.recursive,
            view.focus.as_deref(),
        )
        .await
        {
            Ok(authority) => kept.push((view.id, authority)),
            Err(_) => lapsed.push(view.id),
        }
    }
    (kept, lapsed)
}

/// §3.2 Approval of `revoked` was withdrawn (#797, §335): every lease authorized under it
/// that the store no longer covers ends, before the frontend closes the contexts.
pub(crate) fn after_approval_revoked<R: tauri::Runtime>(app: &tauri::AppHandle<R>, revoked: &str) {
    let store = crate::approval::load(app);
    let revoked = crate::context::manager::resolve_canonical(revoked)
        .unwrap_or_else(|_| PathBuf::from(revoked));
    let _ = with_registry(app, |registry, spawn| {
        let lapsed = lapsed_by_revocation(&store, &revoked, &registry.leases_where(|_| true));
        registry.end_leases(&lapsed, spawn);
    });
}

/// The leases authorized under `revoked` that `store` no longer covers.
fn lapsed_by_revocation(
    store: &crate::approval::ApprovalStore,
    revoked: &Path,
    views: &[LeaseView],
) -> Vec<u64> {
    views
        .iter()
        .filter(|lease| {
            lease.authority.starts_with(revoked)
                && !matches!(
                    crate::approval::decide(store, &lease.authority.to_string_lossy()).0,
                    crate::approval::Decision::Allowed
                )
        })
        .map(|lease| lease.id)
        .collect()
}

/// A context was registered: a watch refused for want of one may be allowed now.
pub(crate) fn may_retry<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    let _ = app.emit("watch:retry", ());
}

/// Run `f` on the registry, then tell the windows what it ended and whether room was
/// freed.
fn with_registry<R: tauri::Runtime, T>(
    app: &tauri::AppHandle<R>,
    f: impl FnOnce(
        &mut crate::WatchLeases,
        &dyn Fn(&WatchSpec) -> Result<notify::RecommendedWatcher, crate::fs::FsError>,
    ) -> T,
) -> Result<T, String> {
    let state = app.state::<crate::WatcherState>();
    let mut registry = state.0.lock().map_err(|e| e.to_string())?;
    let out = f(&mut registry, &|spec| spawn_watcher(app, spec));
    let (ended, freed) = registry.take_news();
    drop(registry);
    for lease in ended {
        let _ = app.emit_to(
            lease.window.as_str(),
            "watch:lease-ended",
            serde_json::json!({ "lease": lease.lease }),
        );
    }
    if freed {
        may_retry(app);
    }
    Ok(out)
}

/// Start a watcher whose own end — an error, its folder removed — ends the leases it
/// serves, if it is still its host's watcher then. §29 #824 A host whose last watcher
/// ended is rescanned once the new one watches: what changed in between was never
/// reported. Only then — a start that fails keeps the host marked, and a rescan taken
/// while the start is still under way could not see what changes before it watches.
fn spawn_watcher<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    spec: &WatchSpec,
) -> Result<notify::RecommendedWatcher, crate::fs::FsError> {
    #[cfg(test)]
    hold_start(&spec.key);
    let watcher = crate::fs::start_watching(spec, app.clone(), sinks_for(app, spec))?;
    if let Some(changes) = app.try_state::<ExternalChanges>() {
        changes.started(&spec.key);
    }
    Ok(watcher)
}

/// A test-only hold on the next start of a watcher for one host: the start waits for the
/// sender to send (or drop).
#[cfg(test)]
pub(crate) static START_GATE: std::sync::Mutex<Option<(PathBuf, std::sync::mpsc::Receiver<()>)>> =
    std::sync::Mutex::new(None);

#[cfg(test)]
fn hold_start(host: &Path) {
    let gate = {
        let mut gate = START_GATE.lock().unwrap();
        match gate.as_ref() {
            Some((at, _)) if at == host => gate.take(),
            _ => None,
        }
    };
    if let Some((_, release)) = gate {
        let _ = release.recv();
    }
}

/// What the router of `spec`'s watcher reports to besides the webview. §29 #824 The
/// marks go to the link index applier (`ExternalChanges`) — a std mutex, never the
/// registry this is called under, nor an index lock.
pub(crate) fn sinks_for<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    spec: &WatchSpec,
) -> crate::fs::WatchSinks {
    let ended_app = app.clone();
    let key = spec.key.clone();
    let generation = spec.generation;
    let marks = app.clone();
    let host = spec.key.clone();
    let rescans = app.clone();
    let rescanned = spec.key.clone();
    crate::fs::WatchSinks {
        on_end: Box::new(move || {
            if let Some(changes) = ended_app.try_state::<ExternalChanges>() {
                changes.note_ended(&key);
            }
            let _ = with_registry(&ended_app, |registry, spawn| {
                registry.watch_ended(&key, generation, spawn)
            });
        }),
        on_paths: Box::new(move |routed| {
            if let Some(changes) = marks.try_state::<ExternalChanges>() {
                changes.mark(&host, routed);
            }
        }),
        on_rescan: Box::new(move || {
            if let Some(changes) = rescans.try_state::<ExternalChanges>() {
                changes.mark_rescan(&rescanned);
            }
        }),
    }
}

#[cfg(test)]
#[path = "watch_cmd_tests.rs"]
mod tests;
