// §29 #824 Every command that changes vault content brings the link index up to date
// before it answers. A scan by effect, not by name: a command whose body reaches a
// vault-writing call must also go through one of the reconciling wrappers.
//
// Corpus: every `#[tauri::command]` in `src/commands/*_cmd.rs`, each body read up to the
// next command or the file's test module. What it does not see: a command that writes
// through a helper not listed in `WRITES` — add the helper here when one is added.

/// Calls that change vault content.
const WRITES: &[&str] = &[
    "crate::fs::write_file",
    "crate::fs::create_file",
    "crate::fs::rename_file",
    "crate::fs::delete_file",
    "crate::fs::delete_dir",
    "crate::fs::copy_file",
    "crate::fs::copy_dir_all",
    "crate::fs::extract_zip",
    "tokio::fs::rename(",
    "crate::task::set_task_state",
    "crate::task::set_task_field",
    "crate::task::set_task_tag",
    "crate::task::append_line",
    "crate::task::delete_line",
    "crate::task::archive_tasks",
    "crate::tag::rename_tag",
    "restore_files",
    "crate::git::switch_branch",
    "crate::git::discard",
    "crate::git::stash_save",
    "crate::git::stash_pop",
    "crate::git::pull",
    "generate_pdf",
    "run_pandoc",
    "run_custom_export(&",
    "rename_file_with_links_inner",
    "rename_block_id_inner",
    "rename_namespace_inner",
];

/// What brings the index up to date after those calls (`index::service::commit`).
const RECONCILES: &[&str] = &[
    "in_index(",
    "committed(",
    "exported(",
    "after_rename(",
    "report(",
    "git_in_index(",
];

/// Commands that write somewhere no link index can cover, and why.
const OUTSIDE_ANY_INDEX: &[(&str, &str)] = &[];

fn commands() -> Vec<(String, String, String)> {
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/commands");
    let mut out = Vec::new();
    for entry in std::fs::read_dir(&dir).unwrap() {
        let path = entry.unwrap().path();
        let name = path.file_name().unwrap().to_string_lossy().into_owned();
        if !name.ends_with("_cmd.rs") {
            continue;
        }
        let text = std::fs::read_to_string(&path).unwrap();
        let text = text.split("#[cfg(test)]").next().unwrap().to_string();
        for block in text.split("#[tauri::command]").skip(1) {
            let fn_name = block
                .split("fn ")
                .nth(1)
                .and_then(|rest| rest.split(['(', '<']).next())
                .unwrap_or("?")
                .trim()
                .to_string();
            out.push((name.clone(), fn_name, block.to_string()));
        }
    }
    out
}

#[test]
fn every_command_that_writes_vault_content_reconciles_the_link_index() {
    // 이것을 실패시키는 것: 쓰기 커맨드 하나에서 `in_index` 를 걷고 맨 쓰기만 남긴다(예: `delete_file`).
    let all = commands();
    let writers: Vec<&(String, String, String)> = all
        .iter()
        .filter(|(_, _, body)| WRITES.iter().any(|w| body.contains(w)))
        .collect();
    // Not vacuous: the scan finds the writers it is meant to (each family at least once).
    for family in [
        "write_file",
        "set_task_state",
        "rename_tag",
        "restore_snapshot",
        "git_pull",
        "export_pdf",
        "rename_file_with_links",
    ] {
        assert!(
            writers.iter().any(|(_, f, _)| f == family),
            "{family} not found by the scan"
        );
    }
    let missing: Vec<String> = writers
        .iter()
        .filter(|(_, f, body)| {
            !RECONCILES.iter().any(|r| body.contains(r))
                && !OUTSIDE_ANY_INDEX.iter().any(|(name, _)| name == f)
        })
        .map(|(file, f, _)| format!("{file}::{f}"))
        .collect();
    assert!(
        missing.is_empty(),
        "write without reconciling the link index: {missing:?}"
    );
}
