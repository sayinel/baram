// §29 #824 Every command that changes vault content brings the link index up to date
// before it answers, from inside its commit. A scan by effect, not by name: a command
// whose body reaches a vault-writing call must start a reconciling wrapper BEFORE that
// call — the write then runs inside the wrapper's owned task, with its effects declared
// first (`index::service::committed`).
//
// Corpus: every `#[tauri::command]` in `src/commands/*_cmd.rs`, each body taken by brace
// matching from its `fn` (braces inside strings are not told apart — no command body has
// one today). What it does not see: a write behind a helper not listed in `WRITES`, a
// wrong effect path, and anything outside the command files (the broker's `execute_op`
// is pinned by `in_index` directly). A commit token only `committed` can construct,
// required by every vault-writing primitive, would close those; it would have to thread
// through `task/`, `tag/` and the rename modules, and the renames do not run inside
// `committed` yet (`RECONCILED_AFTER`).

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
    "export_document_to",
    "std::fs::write",
    "tokio::fs::write(",
    "std::fs::copy",
    "std::fs::remove_file",
    "std::fs::rename",
];

/// What brings the index up to date after those calls (`index::service::commit`).
const RECONCILES: &[&str] = &[
    "in_index(",
    "committed(",
    "exported(",
    "after_rename(",
    "report(",
    "git_in_index(",
    "announce_namespace_rename(",
];

/// Commands that write somewhere no link index can cover, and why.
const OUTSIDE_ANY_INDEX: &[(&str, &str)] = &[];

/// Commands that reconcile only after their body returns: cancelled after the write
/// lands, they leave the index stale. The same is true on the umbrella base, which did
/// not reconcile them at all; moving them inside `committed` is a follow-up.
const RECONCILED_AFTER: &[&str] = &[
    "export_pdf",
    "export_document",
    "export_pandoc",
    "run_custom_export",
    "rename_file_with_links",
    "rename_block_id",
    "rename_namespace",
];

/// The body of the `fn` at the start of `block`, by brace matching.
fn body_of(block: &str) -> String {
    let start = block.find('{').unwrap_or(0);
    let mut depth = 0usize;
    for (i, c) in block[start..].char_indices() {
        match c {
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    return block[start..=start + i].to_string();
                }
            }
            _ => {}
        }
    }
    block[start..].to_string()
}

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
            let from_fn = &block[block.find("fn ").unwrap_or(0)..];
            out.push((name.clone(), fn_name, body_of(from_fn)));
        }
    }
    out
}

/// Where the first of `needles` occurs in `body`.
fn first(body: &str, needles: &[&str]) -> Option<usize> {
    needles.iter().filter_map(|n| body.find(n)).min()
}

#[test]
fn every_command_that_writes_vault_content_reconciles_the_link_index() {
    // 이것을 실패시키는 것: 쓰기 커맨드 하나에서 `in_index` 를 걷고 맨 쓰기만 남긴다(예: `delete_file`) —
    // 또는 쓰기를 wrapper 앞으로 꺼내고 wrapper 를 그 뒤에 둔다.
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
    // The exceptions are real writers that still reconcile after their body: one that
    // moves inside its commit leaves this list.
    for name in RECONCILED_AFTER {
        let (_, _, body) = writers
            .iter()
            .find(|(_, f, _)| f == name)
            .unwrap_or_else(|| panic!("{name} is not a writing command"));
        assert!(
            first(body, WRITES) < first(body, RECONCILES),
            "{name} now reconciles from inside its commit; take it off RECONCILED_AFTER"
        );
    }
    let missing: Vec<String> = writers
        .iter()
        .filter(|(_, f, body)| {
            if OUTSIDE_ANY_INDEX.iter().any(|(name, _)| name == f) {
                return false;
            }
            let wrapped = first(body, RECONCILES);
            let written = first(body, WRITES);
            match (wrapped, written) {
                // The wrapper starts first, so the write runs inside it.
                (Some(w), Some(x)) if w < x => false,
                (Some(_), Some(_)) => !RECONCILED_AFTER.contains(&f.as_str()),
                _ => true,
            }
        })
        .map(|(file, f, _)| format!("{file}::{f}"))
        .collect();
    assert!(
        missing.is_empty(),
        "write without reconciling the link index: {missing:?}"
    );
}
