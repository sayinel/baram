// §387 What the CLI reads from the app's config.json. Read-only: the writer is the
// frontend's zustand persist, through `set_config`.

use super::vault::{Registered, RootKind};
use crate::approval::{self, ApprovalEntry};
use crate::config::ConfigError;
use crate::context::{ContextInfo, VaultType};
use serde_json::Value;
use std::path::{Path, PathBuf};

/// `identifier` in tauri.conf.json. tauri's `app_data_dir` is
/// `dirs::data_dir().join(identifier)`, so this constant finds the same directory
/// without a tauri app handle. `the_identifier_is_the_one_in_tauri_conf` holds the two
/// together.
pub(crate) const APP_IDENTIFIER: &str = "com.inel.baram";

const CONTEXT_KEY: &str = "baram:context";
const SETTINGS_KEY: &str = "baram:settings";

/// What the CLI needs from the app's persisted state. Fields this reader does not name
/// are ignored, so the app can add to its stores freely. Of the ones it names, a
/// `contexts`, `path`, `contextType`, `activeContextId` or `tasksExcludePaths` it does not
/// find becomes a warning rather than a silent empty value, and so does a `vaultType` it
/// does not know. Four fall back without one: a missing `id` reads as `""`, a missing
/// `label` as the path, a missing `alias` or `vaultType` as none.
#[derive(Debug, Default, Clone, PartialEq)]
pub(crate) struct AppConfig {
    pub registered: Vec<Registered>,
    /// Files the app registered on their own (§89). Not roots a command reads, but
    /// registrations all the same: the alias rule counts their names (`aliases`).
    pub files: Vec<FileContext>,
    /// What the app was allowed to read (§331), from `approved-roots.json` beside
    /// config.json. The app registers only an approved context, so the alias rule counts
    /// only those (`aliases`). Read the way the app reads it (`approval::load_from`): a
    /// file that is missing or does not parse is no approval at all, without a warning.
    pub approved: Vec<ApprovalEntry>,
    pub active_id: Option<String>,
    /// The app's "exclude from tasks" folders, vault-relative. `tasks` applies them so
    /// its answer matches the app's task panel.
    pub tasks_exclude_paths: Vec<String>,
    pub warnings: Vec<String>,
}

/// A File context (§89): one file the app opened outside any registered directory. The
/// app drops these from its persisted list at start, so config.json holds the ones
/// opened since — while the app runs, the same ones it has registered.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct FileContext {
    pub id: String,
    pub alias: Option<String>,
    pub vault_type: Option<VaultType>,
    pub path: String,
    /// As `Registered::registrable`.
    pub registrable: bool,
}

pub(crate) fn default_path() -> Option<PathBuf> {
    dirs::data_dir().map(|dir| dir.join(APP_IDENTIFIER).join("config.json"))
}

/// Never fails: a config that cannot be read is an empty one plus a warning, and
/// `--vault <path>` still works. A missing FILE is not a warning — the app has not run.
pub(crate) fn load(path: &Path) -> AppConfig {
    let mut config = AppConfig::default();
    let map = match crate::config::read_config_map(&path.to_path_buf()) {
        Ok(map) => map,
        Err(error) => {
            config.warnings.push(format!(
                "cannot read {}: {}",
                path.display(),
                describe(&error)
            ));
            return config;
        }
    };
    if let Some(state) = persisted_state(map.get(CONTEXT_KEY), CONTEXT_KEY, &mut config.warnings) {
        read_contexts(&state, &mut config);
    }
    if let Some(state) = persisted_state(map.get(SETTINGS_KEY), SETTINGS_KEY, &mut config.warnings)
    {
        read_settings(&state, &mut config);
    }
    config.approved = approval::load_from(&path.with_file_name(approval::STORE_FILE)).entries;
    config
}

/// The cause in English — `ConfigError`'s own Display is Korean. No `_` arm.
fn describe(error: &ConfigError) -> String {
    match error {
        ConfigError::ReadError(source) => source.to_string(),
        ConfigError::ParseError(source) => format!("not valid JSON ({source})"),
        ConfigError::NoAppDataDir => "no app data directory".to_string(),
        ConfigError::LockError => "the config lock is poisoned".to_string(),
    }
}

/// The `state` object zustand persist wrote under `key`. The value in config.json is a
/// JSON STRING (`set_config` stores what persist hands it); an object is accepted too,
/// the way `get_config` accepts one. An absent KEY is not a warning: a store that was
/// never written has no key.
fn persisted_state(raw: Option<&Value>, key: &str, warnings: &mut Vec<String>) -> Option<Value> {
    let parsed = match raw? {
        Value::String(text) => match serde_json::from_str::<Value>(text) {
            Ok(value) => value,
            Err(error) => {
                warnings.push(format!("{key}: not valid JSON ({error})"));
                return None;
            }
        },
        other => other.clone(),
    };
    match parsed.get("state") {
        Some(state) if state.is_object() => Some(state.clone()),
        _ => {
            warnings.push(format!("{key}: no `state` object"));
            None
        }
    }
}

fn read_contexts(state: &Value, config: &mut AppConfig) {
    let Some(list) = state.get("contexts").and_then(Value::as_array) else {
        config
            .warnings
            .push(format!("{CONTEXT_KEY}: no `state.contexts` array"));
        return;
    };
    for (index, item) in list.iter().enumerate() {
        let path = item.get("path").and_then(Value::as_str);
        let kind = item.get("contextType").and_then(Value::as_str);
        let (Some(path), Some(kind)) = (path, kind) else {
            config.warnings.push(format!(
                "{CONTEXT_KEY}: contexts[{index}] has no `path` or `contextType`"
            ));
            continue;
        };
        let text = |field: &str| item.get(field).and_then(Value::as_str).map(str::to_string);
        let registrable = serde_json::from_value::<ContextInfo>(item.clone()).is_ok();
        let vault_type = match item.get("vaultType") {
            None | Some(Value::Null) => None,
            Some(value) => match serde_json::from_value::<VaultType>(value.clone()) {
                Ok(vault_type) => Some(vault_type),
                Err(_) => {
                    config.warnings.push(format!(
                        "{CONTEXT_KEY}: contexts[{index}] has an unknown vaultType {value}"
                    ));
                    None
                }
            },
        };
        let kind = match kind {
            "vault" => RootKind::Vault,
            "folder" => RootKind::Folder,
            // A single file opened on its own is not a root to search.
            "file" => {
                config.files.push(FileContext {
                    id: text("id").unwrap_or_default(),
                    alias: text("alias"),
                    vault_type,
                    path: path.to_string(),
                    registrable,
                });
                continue;
            }
            other => {
                config.warnings.push(format!(
                    "{CONTEXT_KEY}: contexts[{index}] has an unknown contextType `{other}`"
                ));
                continue;
            }
        };
        config.registered.push(Registered {
            id: text("id").unwrap_or_default(),
            label: text("label").unwrap_or_else(|| path.to_string()),
            alias: text("alias"),
            vault_type,
            path: path.to_string(),
            kind,
            registrable,
        });
    }
    match state.get("activeContextId") {
        Some(Value::String(id)) => config.active_id = Some(id.clone()),
        Some(Value::Null) => {}
        _ => config
            .warnings
            .push(format!("{CONTEXT_KEY}: no `state.activeContextId`")),
    }
}

/// The settings store's `partialize` always carries `tasksExcludePaths`, so a settings
/// key WITHOUT it means the format moved — a warning, not a silent "exclude nothing".
fn read_settings(state: &Value, config: &mut AppConfig) {
    let Some(list) = state.get("tasksExcludePaths").and_then(Value::as_array) else {
        config.warnings.push(format!(
            "{SETTINGS_KEY}: no `state.tasksExcludePaths` array"
        ));
        return;
    };
    config.tasks_exclude_paths = list
        .iter()
        .filter_map(Value::as_str)
        .map(str::to_string)
        .collect();
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::context::types::{ContextInfo, ContextType, VaultType};
    use tempfile::TempDir;

    const FIXTURE: &str = include_str!("fixtures/persisted-config.json");

    fn load_text(body: &str) -> AppConfig {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("config.json");
        std::fs::write(&path, body).unwrap();
        load(&path)
    }

    /// A config.json holding one persisted store, stored the way `set_config` stores it.
    fn config_with(key: &str, persisted: &Value) -> String {
        serde_json::json!({ key: persisted.to_string() }).to_string()
    }

    #[test]
    fn the_fixture_reads_to_the_registered_roots() {
        let config = load_text(FIXTURE);
        assert_eq!(config.warnings, Vec::<String>::new());
        assert_eq!(
            config.registered,
            vec![
                Registered {
                    id: "ctx-1".into(),
                    label: "Notes".into(),
                    alias: Some("notes".into()),
                    vault_type: Some(VaultType::General),
                    path: "/vaults/notes".into(),
                    kind: RootKind::Vault,
                    registrable: true,
                },
                Registered {
                    id: "ctx-2".into(),
                    label: "work".into(),
                    alias: None,
                    vault_type: None,
                    path: "/work".into(),
                    kind: RootKind::Folder,
                    registrable: true,
                },
            ],
            "the file context is not a root; the other two are"
        );
        assert_eq!(
            config.files,
            vec![FileContext {
                id: "ctx-3".into(),
                alias: None,
                vault_type: None,
                path: "/tmp/one.md".into(),
                registrable: true,
            }],
            "but it is a registration"
        );
        assert_eq!(
            config.approved,
            Vec::new(),
            "no approved-roots.json beside it"
        );
        assert_eq!(config.active_id.as_deref(), Some("ctx-1"));
        assert_eq!(config.tasks_exclude_paths, ["archive", "templates/"]);
    }

    #[test]
    fn a_missing_file_is_empty_and_silent() {
        let dir = TempDir::new().unwrap();
        assert_eq!(load(&dir.path().join("config.json")), AppConfig::default());
    }

    #[test]
    fn a_file_that_is_not_json_is_a_warning() {
        let config = load_text("{ not json");
        assert!(config.registered.is_empty());
        assert_eq!(config.warnings.len(), 1);
        assert!(
            config.warnings[0].contains("not valid JSON"),
            "{:?}",
            config.warnings
        );
    }

    #[test]
    fn an_absent_key_is_silent() {
        assert_eq!(load_text(r#"{ "uiLocale": "ko" }"#), AppConfig::default());
    }

    #[test]
    fn a_key_that_is_there_but_unreadable_is_a_warning_not_a_silent_empty_list() {
        for body in [
            // The stored string is not JSON.
            serde_json::json!({ CONTEXT_KEY: "{ not json" }).to_string(),
            // No `state`.
            config_with(CONTEXT_KEY, &serde_json::json!({ "version": 1 })),
            // `state` without `contexts`.
            config_with(
                CONTEXT_KEY,
                &serde_json::json!({ "state": { "activeContextId": null } }),
            ),
            // `contexts` without `activeContextId`.
            config_with(
                CONTEXT_KEY,
                &serde_json::json!({ "state": { "contexts": [] } }),
            ),
        ] {
            let config = load_text(&body);
            assert!(config.registered.is_empty(), "{body}");
            assert_eq!(config.warnings.len(), 1, "{body}: {:?}", config.warnings);
            assert!(
                config.warnings[0].starts_with(CONTEXT_KEY),
                "{:?}",
                config.warnings
            );
        }
    }

    #[test]
    fn an_entry_without_a_path_is_skipped_with_a_warning_and_the_rest_are_kept() {
        let config = load_text(&config_with(
            CONTEXT_KEY,
            &serde_json::json!({ "state": {
                "contexts": [
                    { "contextType": "vault", "label": "no path" },
                    { "contextType": "vault", "path": "/v", "label": "ok" },
                    { "contextType": "spaceship", "path": "/s" }
                ],
                "activeContextId": null
            }}),
        ));
        assert_eq!(config.registered.len(), 1);
        assert_eq!(config.registered[0].label, "ok");
        assert_eq!(config.warnings.len(), 2, "{:?}", config.warnings);
    }

    #[test]
    fn a_vault_type_this_build_does_not_know_is_a_warning_and_reads_as_none() {
        let config = load_text(&config_with(
            CONTEXT_KEY,
            &serde_json::json!({ "state": {
                "contexts": [
                    { "id": "a", "contextType": "vault", "path": "/a", "label": "a",
                      "color": "#000000", "addedAt": 1, "vaultType": "garden" },
                    { "id": "b", "contextType": "vault", "path": "/b", "label": "b",
                      "color": "#000000", "addedAt": 2, "vaultType": "journal" },
                    { "id": "c", "contextType": "vault", "path": "/c", "label": "c",
                      "color": "#000000", "addedAt": 3, "vaultType": null },
                    { "id": "d", "contextType": "vault", "path": "/d" }
                ],
                "activeContextId": null
            }}),
        ));
        let types: Vec<_> = config
            .registered
            .iter()
            .map(|r| r.vault_type.clone())
            .collect();
        assert_eq!(types, [None, Some(VaultType::Journal), None, None]);
        // The app's `add_context` could not read `a` (an unknown variant) or `d` (no label,
        // color or addedAt), so it never registers them; the alias rule skips them.
        let registrable: Vec<_> = config.registered.iter().map(|r| r.registrable).collect();
        assert_eq!(registrable, [false, true, true, false]);
        assert_eq!(config.warnings.len(), 1, "{:?}", config.warnings);
        assert!(
            config.warnings[0].contains("contexts[0]") && config.warnings[0].contains("garden"),
            "{:?}",
            config.warnings
        );
    }

    #[test]
    fn a_file_context_keeps_its_alias_and_vault_type() {
        let config = load_text(&config_with(
            CONTEXT_KEY,
            &serde_json::json!({ "state": {
                "contexts": [
                    { "id": "f", "contextType": "file", "path": "/one.md", "label": "one.md",
                      "color": "#000000", "addedAt": 1, "alias": "solo", "vaultType": "journal" }
                ],
                "activeContextId": null
            }}),
        ));
        assert_eq!(config.warnings, Vec::<String>::new());
        assert_eq!(
            config.files,
            [FileContext {
                id: "f".into(),
                alias: Some("solo".into()),
                vault_type: Some(VaultType::Journal),
                path: "/one.md".into(),
                registrable: true,
            }]
        );
    }

    #[test]
    fn the_approvals_beside_config_json_are_read_and_a_bad_file_is_none() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("config.json");
        std::fs::write(&path, "{}").unwrap();
        let store = dir.path().join(approval::STORE_FILE);
        std::fs::write(
            &store,
            r#"{ "version": 1, "entries": [ { "path": "/v", "kind": "dir", "approvedAt": 5 } ] }"#,
        )
        .unwrap();
        let config = load(&path);
        assert_eq!(config.approved.len(), 1);
        assert_eq!(config.approved[0].path, "/v");
        assert_eq!(config.warnings, Vec::<String>::new());
        // As the app reads it: a file that does not parse approves nothing.
        std::fs::write(&store, "{ not json").unwrap();
        assert_eq!(load(&path).approved, Vec::new());
    }

    /// What ends up in the persisted list is what the Rust `add_context` returned, so
    /// the app's own serializer is the format this reader must accept.
    #[test]
    fn what_the_app_serializes_is_what_this_reads() {
        let info = ContextInfo {
            id: "ctx-9".into(),
            context_type: ContextType::Vault,
            path: "/vaults/z".into(),
            label: "Z".into(),
            color: "#000000".into(),
            alias: Some("zed".into()),
            vault_type: Some(VaultType::Zettelkasten),
            added_at: 7,
        };
        let config = load_text(&config_with(
            CONTEXT_KEY,
            &serde_json::json!({
                "state": { "contexts": [info], "activeContextId": "ctx-9" },
                "version": 1
            }),
        ));
        assert_eq!(config.warnings, Vec::<String>::new());
        assert_eq!(
            config.registered,
            vec![Registered {
                id: "ctx-9".into(),
                label: "Z".into(),
                alias: Some("zed".into()),
                vault_type: Some(VaultType::Zettelkasten),
                path: "/vaults/z".into(),
                kind: RootKind::Vault,
                registrable: true,
            }]
        );
    }

    #[test]
    fn settings_without_the_exclude_list_are_a_warning() {
        let config = load_text(&config_with(
            SETTINGS_KEY,
            &serde_json::json!({ "state": { "tasksEnabled": true }, "version": 28 }),
        ));
        assert!(config.tasks_exclude_paths.is_empty());
        assert_eq!(config.warnings.len(), 1, "{:?}", config.warnings);
        assert!(
            config.warnings[0].starts_with(SETTINGS_KEY),
            "{:?}",
            config.warnings
        );
    }

    #[test]
    fn a_fresh_install_without_a_settings_key_is_silent() {
        let config = load_text(&config_with(
            CONTEXT_KEY,
            &serde_json::json!({ "state": { "contexts": [], "activeContextId": null } }),
        ));
        assert_eq!(config, AppConfig::default());
    }

    #[test]
    fn the_identifier_is_the_one_in_tauri_conf() {
        let conf: Value = serde_json::from_str(include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/tauri.conf.json"
        )))
        .unwrap();
        assert_eq!(conf["identifier"], APP_IDENTIFIER);
    }
}
