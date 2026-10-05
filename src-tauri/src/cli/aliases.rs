// §387 The vault aliases a note answers to, for `backlinks` (spec 0068 D14): the app's rule
// (`index::service::own_aliases`) applied to the contexts the app persists in config.json,
// so a link written behind one of the note's own vault names counts as the backlinks panel
// counts it.

use super::app_config::AppConfig;
use crate::approval::{self, ApprovalStore, Decision};
use crate::context::manager::resolve_canonical;
use crate::context::vault_config::load_vault_config;
use crate::context::VaultType;
use crate::index::service::{own_aliases, space_name, AliasHolder};
use crate::index::LocalAlias;
use std::path::{Path, PathBuf};

#[derive(Clone, Copy, PartialEq, Eq)]
enum Kind {
    Vault,
    Folder,
    File,
}

/// One context config.json lists, as the checks below read it.
struct Listed<'a> {
    holder: AliasHolder<'a>,
    path: &'a str,
    kind: Kind,
    registrable: bool,
}

impl<'a> Listed<'a> {
    fn new(
        id: &'a str,
        alias: Option<&'a str>,
        vault_type: Option<&VaultType>,
        path: &'a str,
        kind: Kind,
        registrable: bool,
    ) -> Self {
        Self {
            holder: AliasHolder {
                id,
                alias,
                space: vault_type.and_then(space_name),
            },
            path,
            kind,
            registrable,
        }
    }
}

/// A context the app holds registered, as the alias rule reads it.
struct Held<'a> {
    holder: AliasHolder<'a>,
    canonical: PathBuf,
    directory: bool,
}

/// The contexts of `config` the app holds registered. At start the app drops the File
/// contexts config.json lists and registers the rest in order (`use-app-startup.ts`), so a
/// File context listed here is one opened since: one the running app holds, or one the
/// last session held while the app is closed. Each goes through the app's `add_context`
/// and `ContextManager::add`, which register it only when all of these hold:
///
/// - it reads as a `ContextInfo` (`registrable`);
/// - its path is approved (`approval::decide` against `approved-roots.json`) — at start
///   an unapproved one other than the active one is skipped, and the active one asks;
///   a refusal leaves it out, and an approval is written to that file;
/// - its canonical path exists in its kind's shape: a directory for a vault or folder, a
///   file for a File context;
/// - for a vault, its `.baram/config.json` loads (`load_vault_config`);
/// - no context held before it has the same canonical path.
///
/// The last is the app's rule, in config.json's order. `vault::live` keeps vaults before
/// folders on a shared directory instead; that order picks a label, not a registration.
fn held(config: &AppConfig) -> Vec<Held<'_>> {
    let approvals = ApprovalStore {
        version: 1,
        entries: config.approved.clone(),
    };
    let directories = config.registered.iter().map(|r| {
        let kind = match r.kind {
            super::vault::RootKind::Vault => Kind::Vault,
            super::vault::RootKind::Folder => Kind::Folder,
        };
        Listed::new(
            &r.id,
            r.alias.as_deref(),
            r.vault_type.as_ref(),
            &r.path,
            kind,
            r.registrable,
        )
    });
    let files = config.files.iter().map(|f| {
        Listed::new(
            &f.id,
            f.alias.as_deref(),
            f.vault_type.as_ref(),
            &f.path,
            Kind::File,
            f.registrable,
        )
    });
    let mut out: Vec<Held<'_>> = Vec::new();
    for listed in directories.chain(files) {
        if !listed.registrable || approval::decide(&approvals, listed.path).0 != Decision::Allowed {
            continue;
        }
        let Ok(canonical) = resolve_canonical(listed.path) else {
            continue;
        };
        let shaped = match listed.kind {
            Kind::File => canonical.is_file(),
            Kind::Vault | Kind::Folder => canonical.is_dir(),
        };
        if !shaped
            || (listed.kind == Kind::Vault && load_vault_config(&canonical).is_err())
            || out.iter().any(|h| h.canonical == canonical)
        {
            continue;
        }
        out.push(Held {
            holder: listed.holder,
            canonical,
            directory: listed.kind != Kind::File,
        });
    }
    out
}

/// The aliases local to the note at `note`, for `LinkIndex::get_backlinks`. The note's
/// contexts are the ones `ContextManager::contexts_containing` would give: every held
/// vault or folder whose root contains it, or — when none does — a File context held for
/// that very file. Each alias resolves paths against its context's CANONICAL root: the
/// index compares that root with the note's path as strings (`root_relative_key`), and
/// `paths::locate` gives a canonical path for the note.
pub(crate) fn of_note(config: &AppConfig, note: &Path) -> Vec<LocalAlias> {
    let Ok(note) = resolve_canonical(&note.to_string_lossy()) else {
        return Vec::new();
    };
    let held = held(config);
    let mut contexts: Vec<&Held<'_>> = held
        .iter()
        .filter(|h| h.directory && note.starts_with(&h.canonical))
        .collect();
    if contexts.is_empty() {
        contexts = held
            .iter()
            .filter(|h| !h.directory && h.canonical == note)
            .take(1)
            .collect();
    }
    let roots: Vec<String> = contexts
        .iter()
        .map(|h| h.canonical.to_string_lossy().into_owned())
        .collect();
    let own: Vec<(AliasHolder<'_>, &str)> = contexts
        .iter()
        .zip(&roots)
        .map(|(h, root)| (h.holder, root.as_str()))
        .collect();
    let registered: Vec<AliasHolder<'_>> = held.iter().map(|h| h.holder).collect();
    own_aliases(&own, &registered).local
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::approval::{ApprovalEntry, ApprovalKind};
    use crate::cli::app_config::FileContext;
    use crate::cli::vault::{Registered, RootKind};
    use tempfile::TempDir;

    fn dir_entry(
        id: &str,
        alias: Option<&str>,
        vault_type: Option<VaultType>,
        path: &Path,
    ) -> Registered {
        Registered {
            id: id.to_string(),
            label: id.to_string(),
            alias: alias.map(str::to_string),
            vault_type,
            path: path.to_string_lossy().into_owned(),
            kind: RootKind::Vault,
            registrable: true,
        }
    }

    fn approved(dir: &Path) -> ApprovalEntry {
        ApprovalEntry {
            path: dir.to_string_lossy().into_owned(),
            kind: ApprovalKind::Dir,
            approved_at: 0,
        }
    }

    /// A canonical temp dir holding `v/n.md`, an empty `w/`, and `one.md` outside both.
    fn tree() -> (TempDir, PathBuf) {
        let dir = TempDir::new().unwrap();
        let base = dir.path().canonicalize().unwrap();
        std::fs::create_dir_all(base.join("v")).unwrap();
        std::fs::create_dir_all(base.join("w")).unwrap();
        std::fs::write(base.join("v/n.md"), "").unwrap();
        std::fs::write(base.join("one.md"), "").unwrap();
        (dir, base)
    }

    fn names(aliases: &[LocalAlias]) -> Vec<(&str, &str)> {
        aliases
            .iter()
            .map(|a| (a.alias.as_str(), a.root.as_str()))
            .collect()
    }

    #[test]
    fn a_vaults_own_alias_and_space_name_are_local_with_the_canonical_root() {
        let (_dir, base) = tree();
        let v = base.join("v");
        let config = AppConfig {
            // Spelled through `..`: the root handed to the index is the canonical one.
            registered: vec![dir_entry(
                "a",
                Some("Work"),
                Some(VaultType::Journal),
                &base.join("w/../v"),
            )],
            approved: vec![approved(&base)],
            ..AppConfig::default()
        };
        let root = v.to_string_lossy();
        assert_eq!(
            names(&of_note(&config, &v.join("n.md"))),
            [("journal", root.as_ref()), ("work", root.as_ref())]
        );
        // A note not written yet is asked about the same way.
        assert_eq!(of_note(&config, &v.join("later.md")).len(), 2);
        // Outside the vault, none.
        assert!(of_note(&config, &base.join("one.md")).is_empty());
    }

    #[test]
    fn a_name_another_held_context_carries_is_not_local_but_a_gone_one_does_not_count() {
        let (_dir, base) = tree();
        let note = base.join("v/n.md");
        let mine = dir_entry("a", Some("work"), None, &base.join("v"));
        // Two checks in `held` refuse the gone registration — `approval::decide` cannot
        // resolve its path, and it has no directory — so only dropping both fails this.
        let gone = dir_entry("b", Some("WORK"), None, &base.join("gone"));
        let config = AppConfig {
            registered: vec![mine.clone(), gone],
            approved: vec![approved(&base)],
            ..AppConfig::default()
        };
        assert_eq!(
            names(&of_note(&config, &note)),
            [("work", base.join("v").to_string_lossy().as_ref())]
        );

        let other = dir_entry("c", Some("WORK"), None, &base.join("w"));
        let config = AppConfig {
            registered: vec![mine, other],
            approved: vec![approved(&base)],
            ..AppConfig::default()
        };
        assert!(
            of_note(&config, &note).is_empty(),
            "two vaults answer to `work`"
        );
    }

    #[test]
    fn a_context_the_app_would_refuse_does_not_share_a_name() {
        // Each refusal in `held`'s list, applied to a second vault that carries the same
        // alias. Held, it makes `work` ambiguous (the last assertion); refused, it does not.
        // What fails this: dropping any one of the four checks — that case turns empty.
        let (_dir, base) = tree();
        let note = base.join("v/n.md");
        let mine = dir_entry("a", Some("work"), None, &base.join("v"));
        let other = dir_entry("c", Some("WORK"), None, &base.join("w"));
        let ask = |registered: Vec<Registered>, approved: Vec<ApprovalEntry>| {
            let config = AppConfig {
                registered,
                approved,
                ..AppConfig::default()
            };
            of_note(&config, &note).len()
        };
        let only_mine = vec![approved(&base.join("v"))];
        assert_eq!(
            ask(vec![mine.clone(), other.clone()], only_mine),
            1,
            "w not approved"
        );
        let unreadable = Registered {
            registrable: false,
            ..other.clone()
        };
        let all = vec![approved(&base)];
        assert_eq!(
            ask(vec![mine.clone(), unreadable], all.clone()),
            1,
            "not a ContextInfo"
        );
        std::fs::create_dir_all(base.join("w/.baram")).unwrap();
        std::fs::write(base.join("w/.baram/config.json"), "{ not json").unwrap();
        assert_eq!(
            ask(vec![mine.clone(), other.clone()], all.clone()),
            1,
            "bad vault config"
        );
        std::fs::remove_file(base.join("w/.baram/config.json")).unwrap();
        let a_file = dir_entry("d", Some("WORK"), None, &base.join("one.md"));
        assert_eq!(
            ask(vec![mine.clone(), a_file], all.clone()),
            1,
            "a vault at a file"
        );
        assert_eq!(ask(vec![mine, other], all), 0, "held, `w` shares the alias");
    }

    #[test]
    fn the_first_registration_of_a_directory_is_the_one_held() {
        let (_dir, base) = tree();
        let first = dir_entry("a", Some("first"), None, &base.join("v"));
        let again = dir_entry("b", Some("second"), None, &base.join("v/"));
        let config = AppConfig {
            registered: vec![first, again],
            approved: vec![approved(&base)],
            ..AppConfig::default()
        };
        let got = of_note(&config, &base.join("v/n.md"));
        assert_eq!(
            got.iter().map(|a| a.alias.as_str()).collect::<Vec<_>>(),
            ["first"]
        );
    }

    #[test]
    fn a_file_context_counts_among_the_registrations_and_answers_for_its_own_file() {
        let (_dir, base) = tree();
        let file = FileContext {
            id: "f".into(),
            alias: Some("work".into()),
            vault_type: None,
            path: base.join("one.md").to_string_lossy().into_owned(),
            registrable: true,
        };
        let config = AppConfig {
            registered: vec![dir_entry("a", Some("work"), None, &base.join("v"))],
            files: vec![file.clone()],
            approved: vec![approved(&base)],
            ..AppConfig::default()
        };
        // The vault's `work` is shared with the File context, so not local.
        assert!(of_note(&config, &base.join("v/n.md")).is_empty());

        // No directory context contains `one.md`: its own File context does.
        let config = AppConfig {
            files: vec![FileContext {
                alias: Some("solo".into()),
                ..file.clone()
            }],
            approved: vec![approved(&base)],
            ..AppConfig::default()
        };
        assert_eq!(
            names(&of_note(&config, &base.join("one.md"))),
            [("solo", base.join("one.md").to_string_lossy().as_ref())]
        );

        // A File context for a note a held vault contains does not answer for it: the
        // vault does. What fails this: taking File contexts even when a directory one holds
        // the note — `solo` is then local too.
        let config = AppConfig {
            registered: vec![dir_entry("a", Some("mine"), None, &base.join("v"))],
            files: vec![FileContext {
                alias: Some("solo".into()),
                path: base.join("v/n.md").to_string_lossy().into_owned(),
                ..file
            }],
            approved: vec![approved(&base)],
            ..AppConfig::default()
        };
        assert_eq!(
            of_note(&config, &base.join("v/n.md"))
                .iter()
                .map(|a| a.alias.as_str())
                .collect::<Vec<_>>(),
            ["mine"]
        );
    }
}
