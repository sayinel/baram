// §29 #824 Every command that changes vault content brings the link index up to date
// before it answers — from inside its commit, except the `RECONCILED_AFTER` ones. A scan
// by effect, not by name, over the parsed source: in a command, every reference to a
// vault-writing function listed in `WRITES` must sit inside a closure or async block
// passed directly to an owned wrapper (`committed`, `in_index`, `git_in_index`) — the
// write then runs inside the wrapper's owned task, with its effects declared first
// (`index::service::committed`). A write before, after or beside such a wrapper, or in
// an argument the wrapper receives already evaluated, is outside.
//
// Corpus: every top-level fn carrying an attribute whose path ends in `command`
// (`#[tauri::command]`, and `#[command]` under `use tauri::command`) in
// `src/commands/*_cmd.rs`; their number per file is checked against the attribute
// lines, so a command the parse does not reach fails. A macro's body is read as a list
// of expressions; one that does not parse that way and names a writer counts as a write
// outside.
//
// What it does not see: a write behind a helper not listed in `WRITES`, a writer
// imported under another name (`use … as w`), a wrapper whose closure is never run or
// whose future is never awaited, a wrong effect path, and anything outside the command
// files (the broker's `execute_op` is pinned by `in_index` directly). A commit token
// only `committed` can construct, required by every vault-writing primitive, would
// close those; it would have to thread through `task/`, `tag/` and the rename modules,
// and the renames do not run inside `committed` yet (`RECONCILED_AFTER`).

use syn::punctuated::Punctuated;
use syn::visit::Visit;

/// Functions that change vault content, by path. A reference matches when one of the
/// two paths is a suffix of the other (`fs::write_file` for `crate::fs::write_file`).
const WRITES: &[&str] = &[
    "crate::fs::write_file",
    "crate::fs::write_file_mtime",
    "crate::fs::create_file",
    "crate::fs::rename_file",
    "crate::fs::delete_file",
    "crate::fs::delete_dir",
    "crate::fs::copy_file",
    "crate::fs::copy_dir_all",
    "crate::fs::extract_zip",
    "tokio::fs::rename",
    "crate::task::set_task_state",
    "crate::task::set_task_field",
    "crate::task::set_task_tag",
    "crate::task::append_line",
    "crate::task::delete_line",
    "crate::task::archive_tasks",
    "crate::tag::rename_tag",
    "crate::tag::rename_tag_declaring",
    "restore_files",
    "restore_files_declaring",
    "crate::git::switch_branch",
    "crate::git::discard",
    "crate::git::stash_save",
    "crate::git::stash_pop",
    "crate::git::pull",
    "generate_pdf",
    "run_pandoc",
    "pandoc::run_custom_export",
    "rename_file_with_links_inner",
    "rename_block_id_inner",
    "rename_namespace_inner",
    "export_document_to",
    "std::fs::write",
    "tokio::fs::write",
    "std::fs::copy",
    "std::fs::remove_file",
    "std::fs::rename",
];

/// Wrappers that run what they are given inside an owned, reconciled commit.
const OWNED: &[&str] = &["committed", "in_index", "git_in_index"];

/// What reconciles after a command's body has returned (`RECONCILED_AFTER`).
const AFTER: &[&str] = &[
    "exported",
    "after_rename",
    "report",
    "announce_namespace_rename",
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

/// The writes one command's body references, by where they sit.
#[derive(Debug, Default)]
struct Uses {
    inside: Vec<String>,
    outside: Vec<String>,
    after: usize,
}

struct Scan {
    owned: usize,
    uses: Uses,
}

fn segments(path: &syn::Path) -> Vec<String> {
    path.segments.iter().map(|s| s.ident.to_string()).collect()
}

fn writer(path: &syn::Path) -> Option<&'static str> {
    let got = segments(path);
    WRITES.iter().copied().find(|w| {
        let want: Vec<&str> = w.split("::").collect();
        let n = got.len().min(want.len());
        n > 0
            && got[got.len() - n..]
                .iter()
                .zip(&want[want.len() - n..])
                .all(|(a, b)| a == b)
    })
}

fn last_is(path: &syn::Path, names: &[&str]) -> bool {
    path.segments
        .last()
        .is_some_and(|s| names.iter().any(|n| s.ident == n))
}

impl Scan {
    fn note(&mut self, write: &str) {
        let list = if self.owned > 0 {
            &mut self.uses.inside
        } else {
            &mut self.uses.outside
        };
        list.push(write.to_string());
    }
}

impl<'ast> Visit<'ast> for Scan {
    // A path of two or more segments is a writer wherever it appears (called, or passed
    // as a function); a one-segment path only as a call's callee — as a value it is a
    // local (`write.validate()` names a `StateWrite`, not `std::fs::write`).
    fn visit_expr_path(&mut self, e: &'ast syn::ExprPath) {
        if e.path.segments.len() > 1 {
            if let Some(w) = writer(&e.path) {
                self.note(w);
            }
        }
        syn::visit::visit_expr_path(self, e);
    }

    fn visit_expr_call(&mut self, call: &'ast syn::ExprCall) {
        let callee = match &*call.func {
            syn::Expr::Path(p) => Some(&p.path),
            _ => None,
        };
        if let Some(w) = callee.filter(|p| p.segments.len() == 1).and_then(writer) {
            self.note(w);
        }
        if callee.is_some_and(|p| last_is(p, AFTER)) {
            self.uses.after += 1;
        }
        if !callee.is_some_and(|p| last_is(p, OWNED)) {
            return syn::visit::visit_expr_call(self, call);
        }
        self.visit_expr(&call.func);
        for arg in &call.args {
            // Only what the wrapper runs is inside; an argument it receives evaluated
            // ran before the wrapper started.
            let deferred = matches!(arg, syn::Expr::Closure(_) | syn::Expr::Async(_));
            self.owned += usize::from(deferred);
            self.visit_expr(arg);
            self.owned -= usize::from(deferred);
        }
    }

    fn visit_macro(&mut self, mac: &'ast syn::Macro) {
        match mac.parse_body_with(Punctuated::<syn::Expr, syn::Token![,]>::parse_terminated) {
            Ok(exprs) => exprs.iter().for_each(|e| self.visit_expr(e)),
            Err(_) => {
                let text = mac.tokens.to_string();
                for w in WRITES {
                    let name = w.rsplit("::").next().unwrap_or(w);
                    if text
                        .split(|c: char| !c.is_alphanumeric() && c != '_')
                        .any(|t| t == name)
                    {
                        self.uses
                            .outside
                            .push(format!("{w} (in an unparsed macro)"));
                    }
                }
            }
        }
    }
}

fn uses_of(item: &syn::ItemFn) -> Uses {
    let mut scan = Scan {
        owned: 0,
        uses: Uses::default(),
    };
    scan.visit_block(&item.block);
    scan.uses
}

fn is_command(item: &syn::ItemFn) -> bool {
    item.attrs.iter().any(|a| last_is(a.path(), &["command"]))
}

fn commands() -> Vec<(String, String, Uses)> {
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/commands");
    let mut out = Vec::new();
    for entry in std::fs::read_dir(&dir).unwrap() {
        let path = entry.unwrap().path();
        let name = path.file_name().unwrap().to_string_lossy().into_owned();
        if !name.ends_with("_cmd.rs") {
            continue;
        }
        let text = std::fs::read_to_string(&path).unwrap();
        let file = syn::parse_file(&text).unwrap_or_else(|e| panic!("{name}: {e}"));
        let mut found = 0;
        for item in &file.items {
            if let syn::Item::Fn(f) = item {
                if is_command(f) {
                    found += 1;
                    out.push((name.clone(), f.sig.ident.to_string(), uses_of(f)));
                }
            }
        }
        let attributes = text
            .lines()
            .filter(|l| matches!(l.trim(), "#[tauri::command]" | "#[command]"))
            .count();
        assert_eq!(
            found, attributes,
            "{name}: a command the parse did not reach"
        );
    }
    out
}

/// One fn body, scanned as a command's would be.
fn uses_in(body: &str) -> Uses {
    let item: syn::ItemFn = syn::parse_str(&format!("async fn c() {{ {body} }}")).unwrap();
    uses_of(&item)
}

#[test]
fn the_scan_tells_a_write_inside_its_wrapper_from_one_beside_it() {
    // 이것을 실패시키는 것: wrapper 의 인자를 closure 인지 보지 않고 모두 안으로 센다 (이미 평가된 인자) —
    // 또는 wrapper 호출 뒤의 쓰기를 안으로 센다 — 또는 macro 본문을 읽지 않는다 — 또는 한 segment
    // 경로를 값으로도 쓰기로 센다 / callee 로도 세지 않는다.
    let inside =
        uses_in("in_index(&app, paths, async move { crate::fs::write_file(&p, &c) }).await");
    assert_eq!(inside.inside, ["crate::fs::write_file"]);
    assert!(inside.outside.is_empty());
    let closure = uses_in("committed(&app, move |log| async move { fs::delete_file(&p) }).await");
    assert_eq!(closure.inside, ["crate::fs::delete_file"]);
    // An unrelated commit, then a bare write.
    let beside = uses_in(
        "committed(&app, move |log| async move { Ok(()) }).await; crate::fs::write_file(&p, &c)",
    );
    assert_eq!(beside.outside, ["crate::fs::write_file"]);
    // Evaluated before the wrapper runs.
    let evaluated = uses_in("committed(&app, crate::fs::write_file(&p, &c)?).await");
    assert_eq!(evaluated.outside, ["crate::fs::write_file"]);
    let in_macro = uses_in("tokio::join!(crate::fs::write_file(&p, &c), other())");
    assert_eq!(in_macro.outside, ["crate::fs::write_file"]);
    let unparsed = uses_in("tokio::select! { _ = crate::fs::write_file(&p, &c) => {} }");
    assert_eq!(unparsed.outside.len(), 1);
    let local = uses_in("let write = w; write.validate()?; restore_files(&a, &b)");
    assert_eq!(local.outside, ["restore_files"]);
    let after = uses_in(
        "let r = rename_block_id_inner(&s, &c, &f, &o, &n).await; after_rename(&app, v, &r).await",
    );
    assert_eq!((after.outside.len(), after.after), (1, 1));
}

#[test]
fn every_command_that_writes_vault_content_reconciles_the_link_index() {
    // 이것을 실패시키는 것: 쓰기 커맨드 하나에서 commit 뒤에 쓰기를 하나 더 둔다(예: `write_file` 의
    // `committed(..).await` 다음 줄에 `crate::fs::write_file_mtime`) — 또는 `RECONCILED_AFTER` 의 커맨드에서
    // 뒤의 맞춤(`announce_namespace_rename` 등)을 걷는다.
    let all = commands();
    let writers: Vec<&(String, String, Uses)> = all
        .iter()
        .filter(|(_, _, u)| !u.inside.is_empty() || !u.outside.is_empty())
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
        let (_, _, uses) = writers
            .iter()
            .find(|(_, f, _)| f == name)
            .unwrap_or_else(|| panic!("{name} is not a writing command"));
        assert!(
            !uses.outside.is_empty(),
            "{name} now reconciles from inside its commit; take it off RECONCILED_AFTER"
        );
        assert!(
            uses.after > 0,
            "{name} writes outside a commit and no longer reconciles after it"
        );
    }
    let missing: Vec<String> = writers
        .iter()
        .filter(|(_, f, uses)| {
            !OUTSIDE_ANY_INDEX.iter().any(|(name, _)| name == f)
                && !RECONCILED_AFTER.contains(&f.as_str())
                && !uses.outside.is_empty()
        })
        .map(|(file, f, uses)| format!("{file}::{f} {:?}", uses.outside))
        .collect();
    assert!(
        missing.is_empty(),
        "write outside a reconciling wrapper: {missing:?}"
    );
}
