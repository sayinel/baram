//! §260 Phase 3b — opt every app command into the Tauri ACL.
//!
//! Tauri v2 leaves an app's own `#[tauri::command]`s ungated by default: with no
//! AppManifest, `has_app_acl_manifest` is false and any window's JS realm (incl. a
//! loaded plugin) can invoke any command. Registering the commands here flips that
//! global switch — EVERY app command now requires an ACL grant from the calling
//! window's capability. `main`/`file-*` are granted all-but-`plugin_call` in
//! `capabilities/default.json`; `plugin-*` sandbox windows get only `plugin_call`.
//! A command listed here but granted to no window is rejected at runtime, so
//! `tests/acl_lockdown.rs` asserts this list stays identical to `generate_handler!`.
fn main() {
    let app_manifest = tauri_build::AppManifest::new().commands(&[
        "add_context",
        "append_task_line",
        "archive_task_lines",
        "confirm_quit",
        "copy_file",
        "create_dir",
        "create_file",
        "create_snapshot",
        "delete_dir",
        "delete_file",
        "delete_snapshot",
        "delete_task_line",
        "detect_pandoc",
        "diff_texts",
        "embed_text",
        "export_binary_file",
        "export_document",
        "export_pandoc",
        "export_pdf",
        "extract_zip",
        "font_list",
        "get_backlinks",
        "get_config",
        "get_contexts",
        "get_file_history",
        "get_file_tasks",
        "get_files_by_tag",
        "get_link_index",
        "get_opened_urls",
        "get_snapshot_diff",
        "get_tasks_linking_to",
        "get_unlinked_mentions",
        "get_vault_config",
        "get_vault_config_by_path",
        "get_vault_tags",
        "get_vault_tasks",
        "git_ahead_behind",
        "git_branches",
        "git_commit",
        "git_create_branch",
        "git_delete_branch",
        "git_diff_file",
        "git_discard",
        "git_fetch",
        "git_log",
        "git_pull",
        "git_push",
        "git_remotes",
        "git_stage",
        "git_stash_drop",
        "git_stash_list",
        "git_stash_pop",
        "git_stash_save",
        "git_status",
        "git_switch_branch",
        "git_unstage",
        "import_dir",
        "import_file",
        "index_file",
        "index_status",
        "index_vault",
        "init_vault",
        "is_path_approved",
        "keyring_delete_provider_key",
        "keyring_provider_configured",
        "keyring_set_provider_key",
        "list_approved_roots",
        "list_dir",
        "list_snapshots",
        "llm_cancel",
        "llm_complete",
        "llm_list_models",
        "merge_texts",
        "photo_thumbnail",
        "pick_approved_dir",
        "pick_approved_file",
        "plugin_call",
        "plugin_fetch_community_registry",
        "plugin_fetch_readme",
        "plugin_fetch_registry",
        "plugin_fetch_revocations",
        "plugin_get_dir",
        "plugin_http_fetch",
        "plugin_index_read",
        "plugin_install_commit",
        "plugin_install_discard",
        "plugin_install_stage",
        "plugin_list_dev",
        "plugin_list_installed",
        "plugin_note_link",
        "plugin_pick_dev_folder",
        "plugin_prepare_scopes",
        "plugin_read_manifest",
        "plugin_record_dev_consent",
        "plugin_reload_dev_folder",
        "plugin_remove_dev_folder",
        "plugin_sandbox_connect",
        "plugin_sandbox_deregister",
        "plugin_sandbox_register",
        "plugin_sandbox_report",
        "plugin_sandbox_send",
        "plugin_sandbox_stage",
        "plugin_set_developer_mode",
        "plugin_storage_list",
        "plugin_storage_read",
        "plugin_storage_remove",
        "plugin_storage_write",
        "plugin_uninstall",
        "preview_task_field_line",
        "preview_task_state_line",
        "preview_task_tag_line",
        "read_file",
        "read_media_data_url",
        "refresh_index",
        "remove_config",
        "remove_context",
        "rename_block_id",
        "rename_file",
        "rename_file_with_links",
        "rename_namespace",
        "rename_tag",
        "replace_search_matches",
        "resolve_cross_vault_link",
        "resolve_settings",
        "restore_snapshot",
        "revoke_approved_root",
        "run_custom_export",
        "search_files",
        "search_knowledge",
        "set_active_context",
        "set_config",
        "set_task_field",
        "set_task_state",
        "set_task_tag",
        "set_vault_config",
        "set_vault_config_by_path",
        "set_vault_root",
        "sync_index_paths",
        "theme_import_pick",
        "theme_install_commit",
        "theme_install_discard",
        "theme_install_stage",
        "theme_package_build",
        "theme_read_stored_css",
        "theme_stage_read",
        "theme_uninstall",
        "update_context_alias",
        "update_context_color",
        "update_context_label",
        "update_file_index",
        "update_menu_enabled",
        "update_menu_locale",
        "update_recent_menu",
        "watch_dir",
        "write_binary_file",
        "write_file",
    ]);
    let mut attributes = tauri_build::Attributes::new().app_manifest(app_manifest);
    if targets_windows_msvc() {
        // tauri-build's resource still brings the icon and version info, but not the
        // manifest: that comes from `embed_the_windows_manifest_in_every_target` instead,
        // and two RT_MANIFEST resources with the same id would not link.
        attributes = attributes
            .windows_attributes(tauri_build::WindowsAttributes::new_without_app_manifest());
        embed_the_windows_manifest_in_every_target();
    }
    tauri_build::try_build(attributes).expect("failed to run tauri-build");
}

/// Whether this build produces Windows MSVC binaries. A build script runs on the HOST,
/// so `cfg!(windows)` here would describe the machine running it; cargo passes the
/// target's configuration in these variables instead.
fn targets_windows_msvc() -> bool {
    std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
        && std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc")
}

/// Links the Common Controls 6.0 manifest (`windows-app-manifest.rc`) into every target
/// the package links: the app, and also the test harnesses.
///
/// ‼️ Without it no test that links the library starts on Windows: the library's test
/// harness and the `tests/*.rs` that call into the library exit with 0xC0000139
/// (STATUS_ENTRYPOINT_NOT_FOUND) before running a test. tauri-build compiles its default
/// manifest into a resource that `embed_resource::compile` passes with
/// `cargo:rustc-link-arg-bins`, so only binaries carry it; a harness without it loads the
/// system's default comctl32, which lacks `TaskDialogIndirect` — imported by
/// tauri-runtime-wry, muda and rfd. Upstream: https://github.com/tauri-apps/tauri/issues/13419
/// (still open), whose analysis is that `compile_for_everything`, which this calls, would
/// reach the tests. `rustc-link-arg-tests` would not be enough: it reaches `tests/*.rs`
/// but not the library's own harness (https://github.com/rust-lang/cargo/issues/10937).
///
/// A resource rather than the linker's `/MANIFEST:EMBED` + `/MANIFESTINPUT`, the
/// workaround a maintainer posted in that issue, because the linker writes its own XML:
/// the app exe would carry different manifest bytes from the ones it shipped with. This
/// resource is the one tauri-build wrote, so the exe's manifest keeps its bytes.
fn embed_the_windows_manifest_in_every_target() {
    let resource = std::path::Path::new(
        &std::env::var("CARGO_MANIFEST_DIR").expect("cargo sets CARGO_MANIFEST_DIR"),
    )
    .join("windows-app-manifest.rc");
    println!("cargo:rerun-if-changed={}", resource.display());
    embed_resource::compile_for_everything(&resource, embed_resource::NONE)
        .manifest_required()
        .expect("failed to compile windows-app-manifest.rc");
}
