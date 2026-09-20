// §360 Theme Marketplace — IPC command handlers (spec 0049 §9).
//
// Themes ride the plugin install machinery: same download, same checksum, same
// `ExtractBounds` zip defences, same #261 atomic swap. What differs is the tree
// (`~/.baram/themes/`, §9.2), the manifest (`baram-theme.json`, §4), and one extra step —
// the CSS hygiene pipeline, which runs on the FRONTEND between staging and committing.
//
// ‼️ THE ORDER IS THE SECURITY PROPERTY, and these five commands are shaped to make it the
// only order available:
//
//   theme_install_stage   → download + extract, installs nothing
//   theme_stage_read      → the frontend reads the authored CSS, tokens and assets
//   (frontend)            → sanitizeThemeCss → inlineThemeAssets → verifyStoredThemeCss
//   theme_install_commit  → WRITES the sanitized CSS into the staged tree, then swaps
//   theme_install_discard → the undo for every refusal above
//
// There is deliberately no "write into the staged tree" command. Storing is something only
// a commit can do, so the installed directory cannot exist in a state where its CSS has not
// been through the pipeline — the swap is what creates it, and the sanitized files are in
// it before the swap runs. See `plugin::commit_staged_install`'s `stored_css` parameter.
//
// ‼️ `InstallKind::Theme` is FIXED HERE, at the commands that only ever install themes,
// never accepted as an argument — the webview chooses which COMMAND to invoke, never which
// root a command resolves to (§329–§336, `plugin::InstallKind`).
use crate::plugin;

/// §360 — download a theme ZIP and extract it to the theme tree's staging directory.
///
/// Installs NOTHING, exactly as `plugin_install_stage` does not: whatever version of this
/// theme is installed stays installed and applied until `theme_install_commit` runs, so
/// every refusal the hygiene pipeline can make costs a `theme_install_discard`.
///
/// The returned `manifest` is the raw `baram-theme.json` TEXT. Rust reads only the id out
/// of it — see `plugin::StagedThemeInfo::manifest` — and `validateThemeManifest` on the
/// frontend is its structural validator.
#[tauri::command]
pub async fn theme_install_stage(
    url: String,
    registry_url: String,
    checksum: Option<String>,
    expected_id: Option<String>,
) -> Result<plugin::StagedThemeInfo, String> {
    plugin::stage_install(
        plugin::InstallKind::Theme,
        &url,
        &registry_url,
        checksum.as_deref(),
        expected_id.as_deref(),
    )
    .await
    .and_then(plugin::StagedInstall::into_theme)
    .map_err(|e| e.to_string())
}

/// §360 — write a staged theme's sanitized CSS and install it, atomically replacing any
/// version already installed.
///
/// `stored_css` is the output of the frontend's hygiene pipeline. It is written into the
/// staged tree and published by the same swap that installs everything else, which is what
/// makes "no unverified CSS is ever reachable at the install path" structural rather than a
/// property of call order — see this module's header.
#[tauri::command]
pub async fn theme_install_commit(
    stage_id: String,
    expected_id: String,
    manifest_sha256: String,
    stored_css: plugin::StoredThemeCss,
) -> Result<plugin::CommittedThemeInfo, String> {
    plugin::commit_staged_install(
        plugin::InstallKind::Theme,
        &stage_id,
        &expected_id,
        &manifest_sha256,
        Some(stored_css),
    )
    .await
    .and_then(plugin::CommittedInstall::into_theme)
    .map_err(|e| e.to_string())
}

/// §360 — throw away a staged theme. Nothing installed is touched.
#[tauri::command]
pub async fn theme_install_discard(stage_id: String) -> Result<(), String> {
    plugin::discard_staged_install(plugin::InstallKind::Theme, &stage_id)
        .await
        .map_err(|e| e.to_string())
}

/// §360 — read one file out of a staged theme, as bytes.
///
/// Bytes rather than text because the same command serves three readers: the authored
/// stylesheet, a mode's `tokens.json`, and the bundled fonts and images `inlineThemeAssets`
/// base64-encodes. Decoding the last of those as UTF-8 would corrupt them.
///
/// `tauri::ipc::Response` rather than `Vec<u8>`: a plain byte vector is serialized as a
/// JSON array of numbers, which for a 2 MiB font is several times its own size in text on
/// the way across. This hands the webview an `ArrayBuffer`.
///
/// Containment and the no-decoding rule are `plugin::read_staged_file`'s — see its doc
/// comment for why `%2e%2e` must stay a directory name.
#[tauri::command]
pub async fn theme_stage_read(
    stage_id: String,
    path: String,
) -> Result<tauri::ipc::Response, String> {
    plugin::read_staged_file(plugin::InstallKind::Theme, &stage_id, &path)
        .await
        .map(tauri::ipc::Response::new)
        .map_err(|e| e.to_string())
}

/// §360 — read an installed theme's stored (sanitized) CSS for one mode.
///
/// The load-time read. What comes back still goes through `verifyStoredThemeCss` before it
/// is injected: install-time hygiene freezes the rules OF THAT DAY, and the installed
/// directory is one a person can open afterwards.
#[tauri::command]
pub async fn theme_read_stored_css(
    theme_id: String,
    mode: plugin::ThemeMode,
) -> Result<String, String> {
    plugin::read_stored_theme_css(&theme_id, mode)
        .await
        .map_err(|e| e.to_string())
}
