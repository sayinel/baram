// §389 Which vaults the tools may read, and which one a call reads (spec 0068 §3.1–§3.2).
// The CLI resolves `--vault` once per run. Here the set and the default are decided again
// on every call, from the config.json that call read (D13): a vault registered, renamed or
// removed in the app shows on the next call.

use crate::cli::app_config::AppConfig;
use crate::cli::error::{Candidate, CliError, ErrorCode};
use crate::cli::ops::{self, VaultRow};
use crate::cli::vault::{self, Registered, Vault};
use crate::context::manager::resolve_canonical;
use std::path::{Path, PathBuf};

/// What `--vault` fixed when the server started.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum Allowed {
    /// No `--vault`: every root config.json registers at the time of the call. The default
    /// vault is looked for in `inputs`, in order (`mcp::default_inputs`).
    Registered { inputs: Vec<PathBuf> },
    /// The roots `--vault` named — canonical, without repeats, in the order given; the first
    /// is the default. Registered or not: the user wrote them into the client's
    /// configuration (D6).
    Fixed(Vec<PathBuf>),
}

/// `mcp`'s path form (spec 0068 §3.2): absolute, `~` alone, or `~/` (`~\` on Windows).
/// Everything else is a name — `.notes`, the label a vault at `~/.notes` gets, included. A
/// relative path would be relative to the directory the client started the server in,
/// which no client documents (D4).
pub(super) fn is_path_form(arg: &str) -> bool {
    Path::new(arg).is_absolute()
        || arg == "~"
        || arg.starts_with("~/")
        || (cfg!(windows) && arg.starts_with("~\\"))
}

/// Resolves each `--vault` at start (spec 0068 §3.1) the CLI's way, so its errors are the
/// CLI's: a path must be a directory, a name must match one registered root. The first that
/// does not resolve is the error the server exits with.
pub(super) fn start(
    values: &[String],
    registered: &[Registered],
    home: Option<&Path>,
    inputs: Vec<PathBuf>,
) -> Result<Allowed, CliError> {
    if values.is_empty() {
        return Ok(Allowed::Registered { inputs });
    }
    // `from_path` joins a relative path to the current directory. The path form above is
    // never relative once `from_path` has expanded `~`, so this error is never returned.
    let no_cwd = CliError::new(ErrorCode::Io, "`mcp --vault` takes no relative path");
    let mut roots: Vec<PathBuf> = Vec::new();
    for value in values {
        let found = if is_path_form(value) {
            vault::from_path(value, Err(&no_cwd), home, registered)?
        } else {
            vault::from_name(value, registered)?
        };
        if !roots.contains(&found.root) {
            roots.push(found.root);
        }
    }
    Ok(Allowed::Fixed(roots))
}

/// One vault a call may read.
struct Member {
    /// What it is called on this call: the label of the registered root at its directory
    /// (the one `vault::live` keeps — a vault before a folder), or the folder's own name when
    /// nothing registers it.
    name: String,
    /// What a name-form `vault` matches, lowercased: the label and alias of EVERY registered
    /// root at this directory, as the CLI's `from_name` matches them — or the folder name
    /// for a `--vault` the app does not register.
    names: Vec<String>,
    root: PathBuf,
    /// As a candidate line prints it: the registered spelling, or the canonical root.
    path: String,
    registered: bool,
}

impl Member {
    fn vault(&self) -> Vault {
        Vault {
            name: self.name.clone(),
            root: self.root.clone(),
        }
    }

    fn candidate(&self) -> Candidate {
        Candidate {
            name: self.name.clone(),
            path: self.path.clone(),
        }
    }
}

/// The vaults one call may read, built from the config.json that call read.
pub(super) struct Scope<'a> {
    allowed: &'a Allowed,
    config: &'a AppConfig,
    members: Vec<Member>,
}

impl<'a> Scope<'a> {
    pub(super) fn new(allowed: &'a Allowed, config: &'a AppConfig) -> Self {
        let live = vault::live(&config.registered);
        // Every registered root whose directory is there, with its canonical path — the
        // names a member answers to come from all of them, not only the one `live` keeps.
        let present: Vec<(&Registered, PathBuf)> = config
            .registered
            .iter()
            .filter(|entry| Path::new(&entry.path).is_dir())
            .filter_map(|entry| {
                resolve_canonical(&entry.path)
                    .ok()
                    .map(|root| (entry, root))
            })
            .collect();
        let roots: Vec<PathBuf> = match allowed {
            Allowed::Registered { .. } => live.iter().map(|(_, root)| root.clone()).collect(),
            Allowed::Fixed(roots) => roots.clone(),
        };
        let members = roots
            .into_iter()
            .map(|root| match live.iter().find(|(_, seen)| *seen == root) {
                Some((shown, _)) => Member {
                    name: shown.label.clone(),
                    names: present
                        .iter()
                        .filter(|(_, seen)| *seen == root)
                        .flat_map(|(entry, _)| {
                            std::iter::once(entry.label.to_lowercase())
                                .chain(entry.alias.as_deref().map(str::to_lowercase))
                        })
                        .collect(),
                    path: shown.path.clone(),
                    registered: true,
                    root,
                },
                None => {
                    let name = vault::folder_name(&root);
                    Member {
                        names: vec![name.to_lowercase()],
                        path: root.to_string_lossy().into_owned(),
                        registered: false,
                        name,
                        root,
                    }
                }
            })
            .collect();
        Self {
            allowed,
            config,
            members,
        }
    }

    /// The vault a call reads (spec 0068 §3.2): its `vault` argument, inside this scope, or
    /// the default.
    pub(super) fn resolve(
        &self,
        arg: Option<&str>,
        home: Option<&Path>,
    ) -> Result<Vault, CliError> {
        match arg {
            Some(arg) if is_path_form(arg) => self.by_path(arg, home),
            Some(arg) => self.by_name(arg),
            None => self.default_vault(),
        }
    }

    /// Without regard to case, as the CLI matches names. Each member is one directory, so two
    /// matches are two vaults — and only those in scope count: a vault of the same name
    /// outside it does not make the name ambiguous.
    fn by_name(&self, name: &str) -> Result<Vault, CliError> {
        let wanted = name.to_lowercase();
        let matched: Vec<&Member> = self
            .members
            .iter()
            .filter(|member| member.names.contains(&wanted))
            .collect();
        match matched.as_slice() {
            [member] => Ok(member.vault()),
            [] => Err(CliError::new(
                ErrorCode::VaultNotFound,
                format!("no vault this server reads is named `{name}`"),
            )
            .with_candidates(self.candidates())),
            _ => Err(CliError::new(
                ErrorCode::VaultAmbiguous,
                format!("more than one vault this server reads is named `{name}`"),
            )
            .with_candidates(matched.iter().map(|member| member.candidate()).collect())),
        }
    }

    /// Only a path that IS one of the roots, after both are canonicalized. A path that does
    /// not exist and one that exists outside the scope get the same error: the server does
    /// not tell which directories are there (spec 0068 §3.2).
    fn by_path(&self, arg: &str, home: Option<&Path>) -> Result<Vault, CliError> {
        expand(arg, home)
            .and_then(|path| resolve_canonical(&path.to_string_lossy()).ok())
            .and_then(|root| self.members.iter().find(|member| member.root == root))
            .map(Member::vault)
            .ok_or_else(|| {
                CliError::new(
                    ErrorCode::VaultNotFound,
                    format!("`{arg}` is not a vault this server reads"),
                )
                .with_candidates(self.candidates())
            })
    }

    /// The first `--vault`; without one, the registered vault that holds the first input that
    /// any registered vault holds, by the CLI's containment rule (spec 0068 D4).
    fn default_vault(&self) -> Result<Vault, CliError> {
        let found = match self.allowed {
            Allowed::Fixed(_) => self.members.first().map(Member::vault),
            Allowed::Registered { inputs } => inputs
                .iter()
                .find_map(|input| vault::from_cwd(input, &self.config.registered).ok()),
        };
        found.ok_or_else(|| {
            CliError::new(
                ErrorCode::VaultNotFound,
                "no default vault: neither the project directory nor the directory the \
                 server started in is inside a vault this server reads; pass `vault`",
            )
            .with_candidates(self.candidates())
        })
    }

    fn candidates(&self) -> Vec<Candidate> {
        self.members.iter().map(Member::candidate).collect()
    }

    /// `list_vaults`' rows (spec 0068 §3.2): the CLI's `vaults` rows for the registered roots
    /// in scope, and a row of type `unregistered` for each `--vault` the app does not register.
    pub(super) fn rows(&self, current: Option<&Vault>) -> Vec<VaultRow> {
        let Allowed::Fixed(roots) = self.allowed else {
            return ops::vaults(self.config, current).items;
        };
        let registered: Vec<Registered> = self
            .config
            .registered
            .iter()
            .filter(|entry| Path::new(&entry.path).is_dir())
            .filter(|entry| resolve_canonical(&entry.path).is_ok_and(|root| roots.contains(&root)))
            .cloned()
            .collect();
        let in_scope = AppConfig {
            registered,
            ..self.config.clone()
        };
        let mut rows = ops::vaults(&in_scope, current).items;
        rows.extend(
            self.members
                .iter()
                .filter(|member| !member.registered)
                .map(|member| VaultRow {
                    name: member.name.clone(),
                    path: member.path.clone(),
                    alias: None,
                    kind: "unregistered",
                    current: current.is_some_and(|vault| vault.root == member.root),
                    active: false,
                    exists: member.root.is_dir(),
                }),
        );
        ops::sort_vault_rows(&mut rows);
        rows
    }
}

/// `~` and `~/…` (`~\…` on Windows) against the home directory read at start; anything else
/// as written. `None` when there is no home directory to expand against.
fn expand(arg: &str, home: Option<&Path>) -> Option<PathBuf> {
    let rest = if arg == "~" {
        Some("")
    } else if cfg!(windows) {
        arg.strip_prefix("~/").or_else(|| arg.strip_prefix("~\\"))
    } else {
        arg.strip_prefix("~/")
    };
    match rest {
        Some(rest) => home.map(|home| home.join(rest)),
        None => Some(PathBuf::from(arg)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cli::vault::RootKind;
    use tempfile::TempDir;

    /// Folders on disk, canonical so they compare with what the scope resolves: `a`, `b`,
    /// `u` (never registered), `.notes`, and `gone`, which does not exist.
    struct Disk {
        _dir: TempDir,
        a: PathBuf,
        b: PathBuf,
        u: PathBuf,
        notes: PathBuf,
        gone: PathBuf,
    }

    fn disk() -> Disk {
        let dir = TempDir::new().unwrap();
        let base = dir.path().canonicalize().unwrap();
        for name in ["a/sub", "b/sub", "u", ".notes"] {
            std::fs::create_dir_all(base.join(name)).unwrap();
        }
        Disk {
            a: base.join("a"),
            b: base.join("b"),
            u: base.join("u"),
            notes: base.join(".notes"),
            gone: base.join("gone"),
            _dir: dir,
        }
    }

    fn entry(label: &str, alias: Option<&str>, path: &Path) -> Registered {
        Registered {
            id: format!("ctx-{label}-{}", path.display()),
            label: label.to_string(),
            alias: alias.map(str::to_string),
            vault_type: None,
            path: path.to_string_lossy().into_owned(),
            kind: RootKind::Vault,
            registrable: true,
        }
    }

    fn config(registered: Vec<Registered>) -> AppConfig {
        AppConfig {
            registered,
            ..AppConfig::default()
        }
    }

    fn everything(inputs: Vec<PathBuf>) -> Allowed {
        Allowed::Registered { inputs }
    }

    fn arg(path: &Path) -> String {
        path.to_string_lossy().into_owned()
    }

    fn root(result: Result<Vault, CliError>) -> PathBuf {
        result.expect("a vault").root
    }

    fn error(result: Result<Vault, CliError>) -> CliError {
        result.expect_err("an error")
    }

    /// What fails this: names matched with case; the alias not matched; a path compared
    /// before canonicalization.
    #[test]
    fn without_vault_flags_a_registered_name_alias_or_root_is_in_scope() {
        let d = disk();
        let cfg = config(vec![
            entry("Alpha", Some("al"), &d.a),
            entry("Beta", None, &d.b),
        ]);
        let allowed = everything(Vec::new());
        let scope = Scope::new(&allowed, &cfg);
        assert_eq!(root(scope.resolve(Some("Alpha"), None)), d.a);
        assert_eq!(root(scope.resolve(Some("AL"), None)), d.a);
        assert_eq!(root(scope.resolve(Some("beta"), None)), d.b);
        let spelled = format!("{}/../a", arg(&d.b));
        assert_eq!(root(scope.resolve(Some(&spelled), None)), d.a);
    }

    /// The same error for a path that is not there and one outside the scope (spec 0068
    /// §3.2), with and without `--vault`.
    ///
    /// What fails this: an existence check before the scope (the CLI's `no directory at …`);
    /// a `--vault A` scope that still lets a registered `B` in by name or path.
    #[test]
    fn a_path_outside_the_scope_and_a_path_that_is_not_there_get_the_same_answer() {
        let d = disk();
        let cfg = config(vec![entry("Alpha", None, &d.a), entry("Beta", None, &d.b)]);
        let registered = everything(Vec::new());
        let only_a = Allowed::Fixed(vec![d.a.clone()]);
        for (allowed, outside) in [(&registered, &d.u), (&only_a, &d.b)] {
            let scope = Scope::new(allowed, &cfg);
            let there = error(scope.resolve(Some(&arg(outside)), None));
            let absent = error(scope.resolve(Some(&arg(&d.gone)), None));
            assert_eq!(there.code, ErrorCode::VaultNotFound);
            assert_eq!(absent.code, ErrorCode::VaultNotFound);
            assert_eq!(
                there.message.replace(&arg(outside), "<path>"),
                absent.message.replace(&arg(&d.gone), "<path>")
            );
            assert_eq!(there.candidates, absent.candidates);
            // The scope's own vault resolves: the errors above are the scope's, not the paths'.
            assert_eq!(root(scope.resolve(Some(&arg(&d.a)), None)), d.a);
        }
        let scope = Scope::new(&only_a, &cfg);
        assert_eq!(
            error(scope.resolve(Some("Beta"), None)).code,
            ErrorCode::VaultNotFound
        );
    }

    /// What fails this: an unregistered `--vault` given no member; its row left out or
    /// typed as a vault; the registered vault outside `--vault` listed.
    #[test]
    fn an_unregistered_vault_flag_answers_to_its_folder_name_and_path() {
        let d = disk();
        let cfg = config(vec![entry("Alpha", None, &d.a)]);
        let allowed = Allowed::Fixed(vec![d.u.clone()]);
        let scope = Scope::new(&allowed, &cfg);
        let by_name = scope.resolve(Some("U"), None).unwrap();
        assert_eq!(
            (by_name.name.as_str(), by_name.root.as_path()),
            ("u", d.u.as_path())
        );
        assert_eq!(root(scope.resolve(Some(&arg(&d.u)), None)), d.u);
        let rows = scope.rows(Some(&by_name));
        assert_eq!(rows.len(), 1, "{rows:?}");
        assert_eq!(
            (
                rows[0].name.as_str(),
                rows[0].kind,
                rows[0].path.as_str(),
                rows[0].current,
                rows[0].exists
            ),
            ("u", "unregistered", arg(&d.u).as_str(), true, true)
        );
    }

    /// What fails this: the CLI's `is_path_form` (`.notes` would be a relative path, `a/x` a
    /// missing directory); `~user` expanded.
    #[test]
    fn a_name_is_whatever_is_not_absolute_or_tilde() {
        assert!(is_path_form("~"));
        assert!(is_path_form("~/notes"));
        assert!(is_path_form(&std::env::temp_dir().to_string_lossy()));
        for name in [".notes", "~user", "a/x", "./a", "notes"] {
            assert!(!is_path_form(name), "{name}");
        }
        let d = disk();
        let cfg = config(vec![entry(".notes", None, &d.notes)]);
        let allowed = everything(Vec::new());
        let scope = Scope::new(&allowed, &cfg);
        assert_eq!(root(scope.resolve(Some(".notes"), None)), d.notes);
        let missing = error(scope.resolve(Some("a/x"), None));
        assert_eq!(missing.code, ErrorCode::VaultNotFound);
        assert_eq!(missing.message, "no vault this server reads is named `a/x`");
        assert_eq!(root(scope.resolve(Some("~"), Some(&d.notes))), d.notes);
    }

    /// What fails this: matches counted over every registered root instead of the scope's.
    #[test]
    fn two_vaults_of_one_name_are_ambiguous_only_inside_the_scope() {
        let d = disk();
        let cfg = config(vec![entry("Same", None, &d.a), entry("same", None, &d.b)]);
        let allowed = everything(Vec::new());
        let both = error(Scope::new(&allowed, &cfg).resolve(Some("SAME"), None));
        assert_eq!(both.code, ErrorCode::VaultAmbiguous);
        assert_eq!(both.candidates.len(), 2);
        let only_a = Allowed::Fixed(vec![d.a.clone()]);
        assert_eq!(
            root(Scope::new(&only_a, &cfg).resolve(Some("same"), None)),
            d.a
        );
    }

    /// What fails this: the default taken from the last `--vault`, or from the inputs when
    /// `--vault` is given.
    #[test]
    fn the_first_vault_flag_is_the_default() {
        let d = disk();
        let cfg = config(vec![entry("Alpha", None, &d.a), entry("Beta", None, &d.b)]);
        let allowed = Allowed::Fixed(vec![d.b.clone(), d.a.clone()]);
        assert_eq!(root(Scope::new(&allowed, &cfg).resolve(None, None)), d.b);
    }

    /// Without `--vault`, the default is decided on each call from that call's config
    /// (spec 0068 §3.1): the first input a registered vault holds wins; unregistering it hands
    /// the default to the next input; with none left there is no default, and the rows still
    /// list; registering one later makes it the default.
    ///
    /// What fails this: the default fixed at start; inputs tried in another order; the rows
    /// failing with the default.
    #[test]
    fn without_vault_flags_the_default_follows_the_registrations_of_each_call() {
        let d = disk();
        let allowed = everything(vec![d.b.join("sub"), d.a.join("sub")]);
        let both = config(vec![entry("Alpha", None, &d.a), entry("Beta", None, &d.b)]);
        assert_eq!(root(Scope::new(&allowed, &both).resolve(None, None)), d.b);
        let only_a = config(vec![entry("Alpha", None, &d.a)]);
        assert_eq!(root(Scope::new(&allowed, &only_a).resolve(None, None)), d.a);
        let elsewhere = config(vec![entry("Unrelated", None, &d.u)]);
        let scope = Scope::new(&allowed, &elsewhere);
        assert_eq!(
            error(scope.resolve(None, None)).code,
            ErrorCode::VaultNotFound
        );
        assert_eq!(scope.rows(None).len(), 1);
        assert_eq!(root(Scope::new(&allowed, &both).resolve(None, None)), d.b);
    }

    /// What fails this: a `--vault` root's name taken at start instead of from each call.
    #[test]
    fn a_vault_flag_root_answers_to_the_name_the_app_gives_it_now() {
        let d = disk();
        let allowed = Allowed::Fixed(vec![d.a.clone()]);
        let before = config(vec![entry("Alpha", None, &d.a)]);
        assert_eq!(
            root(Scope::new(&allowed, &before).resolve(Some("Alpha"), None)),
            d.a
        );
        let after = config(vec![entry("Gamma", None, &d.a)]);
        let scope = Scope::new(&allowed, &after);
        assert_eq!(root(scope.resolve(Some("Gamma"), None)), d.a);
        assert_eq!(scope.resolve(None, None).unwrap().name, "Gamma");
        assert_eq!(
            error(scope.resolve(Some("Alpha"), None)).code,
            ErrorCode::VaultNotFound
        );
    }

    /// What fails this: `--vault` values kept twice; the CLI's path rule used at start; an
    /// error that does not stop the start.
    #[test]
    fn start_resolves_each_vault_flag_and_stops_on_the_first_that_does_not() {
        let d = disk();
        let registered = vec![entry("Alpha", None, &d.a)];
        let values = |list: &[&str]| list.iter().map(|v| v.to_string()).collect::<Vec<_>>();
        let started = start(
            &values(&["Alpha", arg(&d.a).as_str(), "~"]),
            &registered,
            Some(&d.b),
            Vec::new(),
        );
        assert_eq!(
            started.unwrap(),
            Allowed::Fixed(vec![d.a.clone(), d.b.clone()])
        );
        let inputs = vec![d.u.clone()];
        assert_eq!(
            start(&[], &registered, None, inputs.clone()).unwrap(),
            Allowed::Registered { inputs }
        );
        let nope = start(&values(&["Alpha", "nope"]), &registered, None, Vec::new()).unwrap_err();
        assert_eq!(nope.message, "no registered vault is named `nope`");
        let gone = start(
            &values(&[arg(&d.gone).as_str()]),
            &registered,
            None,
            Vec::new(),
        )
        .unwrap_err();
        assert_eq!(
            gone.message,
            format!("no directory at {}", d.gone.display())
        );
        let relative = start(&values(&["a/x"]), &registered, None, Vec::new()).unwrap_err();
        assert_eq!(relative.message, "no registered vault is named `a/x`");
    }
}
