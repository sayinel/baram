// §260 Phase 3a — the sandbox authorizer. Maps a Tauri-verified window label
// (`plugin-<id>`) to the capabilities the host registered for that plugin, and
// authorizes each brokered op by caller identity + capability. The label is
// unforgeable (Tauri sets it); the granted set is populated by the host window
// via `plugin_sandbox_register` (a plugin window is rejected from registering).
use std::collections::HashMap;
use std::sync::Mutex;

use serde::Deserialize;
use thiserror::Error;

use super::{PluginFetchInit, RateClass};

/// `"plugin-<id>"` → `Some("<id>")`; `None` for any non-sandbox window label.
pub fn plugin_id_from_label(label: &str) -> Option<String> {
    label.strip_prefix("plugin-").map(str::to_string)
}

/// What a caller must hold for one op.
///
/// `AnyOf` exists because `files` and `files:readonly` are alternatives, not a
/// hierarchy: a read is admitted by either. The rejected alternative was a
/// "capability implies capability" table — that would be a second place to encode
/// the semantics (and to get them wrong), for a relation only files/editor have.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CapabilityRequirement {
    /// Any ONE of these admits the op.
    AnyOf(&'static [&'static str]),
    /// A verified, registered identity is enough — no grant needed.
    None,
}

/// An operation a sandboxed plugin asks the broker to perform. `ai` is deliberately
/// absent: its policy (privacy mode, per-task model/provider) is frontend state, so
/// it is host-mediated over the sandbox transport instead — an `ai` op here would
/// have to take a model/provider FROM the sandbox (Phase 3c-2c).
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PluginOp {
    /// §260 Phase 3c-2c — vault-bounded file ops. The path is checked against the
    /// SAME vault rule as `read_file` (`fs_cmd::ensure_path_in_vault`), so a
    /// sandboxed plugin reaches exactly the tree the trusted tier does, minus the
    /// app's own `.baram` state (see `plugin_cmd::reject_app_state_path`).
    ///
    /// §260 Phase 4a — `path` is **relative to a context root** and an absolute one is
    /// refused (`plugin_cmd::vault_relative`). The sandbox is never told a root, so it
    /// cannot form an absolute path in the first place; this keeps the user's home
    /// directory out of the tier entirely. `context` names which registered context to
    /// anchor to — a plugin learns ids from delivered events — and defaults to the
    /// active one.
    FilesList {
        context: Option<String>,
        path: String,
    },
    FilesRead {
        context: Option<String>,
        path: String,
    },
    FilesWrite {
        content: String,
        context: Option<String>,
        path: String,
    },
    StorageRead {
        key: String,
    },
    StorageWrite {
        key: String,
        value: String,
    },
    StorageList,
    StorageRemove {
        key: String,
    },
    HttpFetch {
        url: String,
        init: Option<PluginFetchInit>,
    },
    /// §260 Phase 3c-2b — hand the caller its OWN plugin bundle so it can import it
    /// from a `blob:` URL. Takes no path: Rust resolves the caller's directory from
    /// the label-derived id, which is why the sandbox realm needs no `asset:` (and
    /// therefore has no file-read capability at all).
    SourceRead,
    /// §260 Phase 4b — collect the payload the HOST staged for this sandbox
    /// (`StagedPayloads`), delivered as an invoke result rather than a channel frame so a
    /// document never enters tauri's app-global channel-data queue. Takes no handle: Rust
    /// resolves the slot from the caller's window label, so a sandbox cannot name whose
    /// payload it wants.
    StagedRead,
}

impl PluginOp {
    /// What the caller must hold for this op. Lives on the op so no call site has to
    /// re-derive it (and none can get it wrong) — see `authorize_op`.
    pub fn capability_requirement(&self) -> CapabilityRequirement {
        use CapabilityRequirement::{AnyOf, None};
        match self {
            PluginOp::StorageRead { .. }
            | PluginOp::StorageWrite { .. }
            | PluginOp::StorageList
            | PluginOp::StorageRemove { .. } => AnyOf(&["storage"]),
            PluginOp::HttpFetch { .. } => AnyOf(&["network"]),
            // Reading is admitted by either files grant; writing needs the rw one.
            PluginOp::FilesRead { .. } | PluginOp::FilesList { .. } => {
                AnyOf(&["files", "files:readonly"])
            }
            PluginOp::FilesWrite { .. } => AnyOf(&["files"]),
            // Reading one's own code is not a grantable privilege: it is the bytes
            // the host was about to hand over anyway, and the op names no file.
            PluginOp::SourceRead => None,
            // Nor is collecting an answer the host already decided to give: whatever is
            // in this sandbox's slot was put there by the host AFTER it checked the
            // capability for the request that produced it (`editor:readonly` for a
            // document read). A plugin that holds nothing has nothing staged, so the pull
            // returns an error rather than someone else's document. Identity and
            // registration are still enforced, as for every op.
            PluginOp::StagedRead => None,
        }
    }

    /// Which rate budget this op spends (§260 3c-2c). On the op for the same reason
    /// the capability requirement is: so a new variant cannot quietly inherit the
    /// wrong bucket by being handled at some call site.
    pub fn rate_class(&self) -> RateClass {
        match self {
            // The CORS-free proxy is the one op whose cost lands on a third party.
            PluginOp::HttpFetch { .. } => RateClass::Network,
            _ => RateClass::Default,
        }
    }
}

#[derive(Debug, Error)]
pub enum AuthzError {
    #[error("caller is not a sandbox window")]
    NotASandbox,
    #[error("caller is not a registered sandbox")]
    Unregistered,
    /// Phrased to carry a LIST (`"files or files:readonly"`), because an any-of op
    /// has several acceptable grants and naming only one misleads the author.
    #[error("this plugin was not granted {0}")]
    Denied(String),
}

/// What the host granted one sandbox: its capabilities and the directory its code
/// came from. Binding the directory here (§260 3c-2b review, I2) rather than
/// re-deriving it per call is what keeps the executed bundle and the
/// validated/authorized manifest from disagreeing — the host resolves both together
/// (a dev folder overrides an installed copy of the same id), so Rust must not
/// re-guess.
#[derive(Debug, Clone)]
pub struct SandboxGrant {
    pub capabilities: Vec<String>,
    pub source_dir: String,
}

/// Managed state: `label` → what the host granted it.
#[derive(Default)]
pub struct PluginAuthorizer {
    granted: Mutex<HashMap<String, SandboxGrant>>,
}

impl PluginAuthorizer {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register(&self, label: String, capabilities: Vec<String>, source_dir: String) {
        self.granted.lock().unwrap().insert(
            label,
            SandboxGrant {
                capabilities,
                source_dir,
            },
        );
    }

    pub fn deregister(&self, label: &str) {
        self.granted.lock().unwrap().remove(label);
    }

    /// The directory the host loaded this sandbox's plugin from. `None` when the
    /// label is not a registered sandbox, so `SourceRead` fails closed.
    pub fn source_dir(&self, label: &str) -> Option<String> {
        self.granted
            .lock()
            .unwrap()
            .get(label)
            .map(|g| g.source_dir.clone())
    }

    /// Whether the host has registered this label at all (any capability set,
    /// including an empty one). Phase 3c-2a gates `plugin_sandbox_connect` on
    /// this so a window the host never started cannot park an inbound channel.
    pub fn is_registered(&self, label: &str) -> bool {
        plugin_id_from_label(label).is_some() && self.granted.lock().unwrap().contains_key(label)
    }

    /// Authorize one op by the caller's label: verifies identity + registration
    /// always, and the op's capability requirement when it declares one. The only
    /// form a call site should use, so the "what does this op need?" decision lives
    /// with the op rather than being re-derived by every caller.
    pub fn authorize_op(&self, label: &str, op: &PluginOp) -> Result<String, AuthzError> {
        match op.capability_requirement() {
            CapabilityRequirement::AnyOf(caps) => self.authorize_any(label, caps),
            CapabilityRequirement::None => {
                let plugin_id = plugin_id_from_label(label).ok_or(AuthzError::NotASandbox)?;
                if self.granted.lock().unwrap().contains_key(label) {
                    Ok(plugin_id)
                } else {
                    Err(AuthzError::Unregistered)
                }
            }
        }
    }

    /// Holding ANY of `caps` admits the caller; on success returns the caller's
    /// plugin id (derived from the label) so the broker uses the CALLER identity —
    /// never a client-supplied id — for the op. The denial names every acceptable
    /// capability, because a plugin author reading "files not granted" cannot tell
    /// that `files:readonly` would also have worked.
    ///
    /// There is no single-capability convenience wrapper: one entry point means one
    /// place where a capability comparison can be wrong.
    pub fn authorize_any(&self, label: &str, caps: &[&str]) -> Result<String, AuthzError> {
        let plugin_id = plugin_id_from_label(label).ok_or(AuthzError::NotASandbox)?;
        let map = self.granted.lock().unwrap();
        let grant = map.get(label).ok_or(AuthzError::Unregistered)?;
        if grant
            .capabilities
            .iter()
            .any(|c| caps.iter().any(|want| c == want))
        {
            Ok(plugin_id)
        } else {
            Err(AuthzError::Denied(caps.join(" or ")))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn label_parsing() {
        assert_eq!(plugin_id_from_label("plugin-abc").as_deref(), Some("abc"));
        assert_eq!(plugin_id_from_label("main"), None);
        assert_eq!(plugin_id_from_label("file-123"), None);
    }

    #[test]
    fn source_read_needs_no_capability_only_registration() {
        // Reading one's OWN bundle is not a grantable privilege: it is the bytes the
        // host was about to hand over anyway, and the op names no file. Identity is
        // still verified, and an unregistered or non-sandbox caller is still refused.
        assert_eq!(
            PluginOp::SourceRead.capability_requirement(),
            CapabilityRequirement::None
        );
        let a = PluginAuthorizer::new();
        assert!(matches!(
            a.authorize_op("plugin-alpha", &PluginOp::SourceRead),
            Err(AuthzError::Unregistered)
        ));
        a.register("plugin-alpha".into(), vec![], "/p/plugin-alpha".into()); // zero capabilities granted
        assert_eq!(
            a.authorize_op("plugin-alpha", &PluginOp::SourceRead)
                .unwrap(),
            "alpha"
        );
        assert!(matches!(
            a.authorize_op("main", &PluginOp::SourceRead),
            Err(AuthzError::NotASandbox)
        ));
    }

    #[test]
    fn authorize_op_still_enforces_capabilities_for_grantable_ops() {
        let a = PluginAuthorizer::new();
        a.register(
            "plugin-alpha".into(),
            vec!["storage".into()],
            "/p/plugin-alpha".into(),
        );
        assert_eq!(
            a.authorize_op("plugin-alpha", &PluginOp::StorageList)
                .unwrap(),
            "alpha"
        );
        assert!(matches!(
            a.authorize_op(
                "plugin-alpha",
                &PluginOp::HttpFetch {
                    url: "http://x".into(),
                    init: None
                }
            ),
            Err(AuthzError::Denied(_))
        ));
    }

    #[test]
    fn required_capability_mapping() {
        use CapabilityRequirement::AnyOf;
        assert_eq!(
            PluginOp::StorageList.capability_requirement(),
            AnyOf(&["storage"])
        );
        assert_eq!(
            PluginOp::StorageRead { key: "k".into() }.capability_requirement(),
            AnyOf(&["storage"])
        );
        assert_eq!(
            PluginOp::HttpFetch {
                url: "http://x".into(),
                init: None
            }
            .capability_requirement(),
            AnyOf(&["network"])
        );
    }

    /// The point of `AnyOf`: a read-only grant is a real grant for reads, and the
    /// write op must not silently accept it.
    #[test]
    fn readonly_files_grant_admits_reads_and_refuses_writes() {
        let a = PluginAuthorizer::new();
        a.register(
            "plugin-alpha".into(),
            vec!["files:readonly".into()],
            "/p/alpha".into(),
        );
        let read = PluginOp::FilesRead {
            context: None,
            path: "note.md".into(),
        };
        let list = PluginOp::FilesList {
            context: None,
            path: String::new(),
        };
        let write = PluginOp::FilesWrite {
            content: "x".into(),
            context: None,
            path: "note.md".into(),
        };
        assert_eq!(a.authorize_op("plugin-alpha", &read).unwrap(), "alpha");
        assert_eq!(a.authorize_op("plugin-alpha", &list).unwrap(), "alpha");
        assert!(matches!(
            a.authorize_op("plugin-alpha", &write),
            Err(AuthzError::Denied(_))
        ));
        // A files grant of either kind is not a storage grant.
        assert!(matches!(
            a.authorize_op("plugin-alpha", &PluginOp::StorageList),
            Err(AuthzError::Denied(_))
        ));
    }

    #[test]
    fn read_write_files_grant_admits_both() {
        let a = PluginAuthorizer::new();
        a.register(
            "plugin-alpha".into(),
            vec!["files".into()],
            "/p/alpha".into(),
        );
        assert!(a
            .authorize_op(
                "plugin-alpha",
                &PluginOp::FilesRead {
                    context: None,
                    path: "note.md".into()
                }
            )
            .is_ok());
        assert!(a
            .authorize_op(
                "plugin-alpha",
                &PluginOp::FilesWrite {
                    content: "x".into(),
                    context: None,
                    path: "note.md".into()
                }
            )
            .is_ok());
    }

    /// A plugin author who reads "files not granted" cannot tell that
    /// `files:readonly` would also have admitted the call — so say both.
    #[test]
    fn denial_names_every_acceptable_capability() {
        let a = PluginAuthorizer::new();
        a.register("plugin-alpha".into(), vec![], "/p/alpha".into());
        let err = a
            .authorize_op(
                "plugin-alpha",
                &PluginOp::FilesRead {
                    context: None,
                    path: "note.md".into(),
                },
            )
            .expect_err("no grant must be refused");
        let msg = err.to_string();
        assert!(msg.contains("files"), "unexpected message: {msg}");
        assert!(msg.contains("files:readonly"), "unexpected message: {msg}");
    }

    #[test]
    fn op_deserializes_internally_tagged() {
        let op: PluginOp =
            serde_json::from_str(r#"{"kind":"storage_write","key":"k","value":"v"}"#).unwrap();
        assert!(matches!(op, PluginOp::StorageWrite { .. }));
    }

    #[test]
    fn authorize_grants_when_capability_present_and_returns_caller_id() {
        let a = PluginAuthorizer::new();
        a.register(
            "plugin-alpha".into(),
            vec!["storage".into(), "network".into()],
            "/p/plugin-alpha".into(),
        );
        assert_eq!(
            a.authorize_any("plugin-alpha", &["storage"]).unwrap(),
            "alpha"
        );
        assert_eq!(
            a.authorize_any("plugin-alpha", &["network"]).unwrap(),
            "alpha"
        );
    }

    #[test]
    fn authorize_denies_missing_capability() {
        let a = PluginAuthorizer::new();
        a.register(
            "plugin-alpha".into(),
            vec!["storage".into()],
            "/p/plugin-alpha".into(),
        );
        assert!(matches!(
            a.authorize_any("plugin-alpha", &["network"]),
            Err(AuthzError::Denied(_))
        ));
    }

    #[test]
    fn authorize_rejects_unregistered_and_non_sandbox() {
        let a = PluginAuthorizer::new();
        assert!(matches!(
            a.authorize_any("plugin-ghost", &["storage"]),
            Err(AuthzError::Unregistered)
        ));
        assert!(matches!(
            a.authorize_any("main", &["storage"]),
            Err(AuthzError::NotASandbox)
        ));
    }

    #[test]
    fn deregister_revokes() {
        let a = PluginAuthorizer::new();
        a.register(
            "plugin-alpha".into(),
            vec!["storage".into()],
            "/p/plugin-alpha".into(),
        );
        a.deregister("plugin-alpha");
        assert!(matches!(
            a.authorize_any("plugin-alpha", &["storage"]),
            Err(AuthzError::Unregistered)
        ));
    }

    #[test]
    fn is_registered_tracks_registration_and_rejects_non_sandbox() {
        let a = PluginAuthorizer::new();
        assert!(!a.is_registered("plugin-alpha"));
        a.register("plugin-alpha".into(), vec![], "/p/plugin-alpha".into()); // zero capabilities still counts
        assert!(a.is_registered("plugin-alpha"));
        a.deregister("plugin-alpha");
        assert!(!a.is_registered("plugin-alpha"));
        a.register("main".into(), vec!["storage".into()], "/p/main".into()); // not a sandbox label
        assert!(!a.is_registered("main"));
    }

    #[test]
    fn distinct_plugins_isolated_identities() {
        // The isolation guarantee: each label authorizes as its OWN id, so the
        // broker (Task 2) namespaces storage by the caller, never a shared arg.
        let a = PluginAuthorizer::new();
        a.register(
            "plugin-a".into(),
            vec!["storage".into()],
            "/p/plugin-a".into(),
        );
        a.register(
            "plugin-b".into(),
            vec!["storage".into()],
            "/p/plugin-b".into(),
        );
        assert_eq!(a.authorize_any("plugin-a", &["storage"]).unwrap(), "a");
        assert_eq!(a.authorize_any("plugin-b", &["storage"]).unwrap(), "b");
    }
}
