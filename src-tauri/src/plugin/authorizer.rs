// §260 Phase 3a — the sandbox authorizer. Maps a Tauri-verified window label
// (`plugin-<id>`) to the capabilities the host registered for that plugin, and
// authorizes each brokered op by caller identity + capability. The label is
// unforgeable (Tauri sets it); the granted set is populated by the host window
// via `plugin_sandbox_register` (a plugin window is rejected from registering).
use std::collections::HashMap;
use std::sync::Mutex;

use serde::Deserialize;
use thiserror::Error;

use super::PluginFetchInit;

/// `"plugin-<id>"` → `Some("<id>")`; `None` for any non-sandbox window label.
pub fn plugin_id_from_label(label: &str) -> Option<String> {
    label.strip_prefix("plugin-").map(str::to_string)
}

/// An operation a sandboxed plugin asks the broker to perform. Execution wiring
/// for network/files/ai lands in Phase 3c; their authorization lives here now.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PluginOp {
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
}

impl PluginOp {
    /// The capability a caller must have been granted, or `None` for an op that
    /// needs no grant — only a verified, registered identity.
    pub fn required_capability(&self) -> Option<&'static str> {
        match self {
            PluginOp::StorageRead { .. }
            | PluginOp::StorageWrite { .. }
            | PluginOp::StorageList
            | PluginOp::StorageRemove { .. } => Some("storage"),
            PluginOp::HttpFetch { .. } => Some("network"),
            // Reading one's own code is not a grantable privilege: it is the bytes
            // the host was about to hand over anyway, and the op names no file.
            PluginOp::SourceRead => None,
        }
    }
}

#[derive(Debug, Error)]
pub enum AuthzError {
    #[error("caller is not a sandbox window")]
    NotASandbox,
    #[error("caller is not a registered sandbox")]
    Unregistered,
    #[error("capability \"{0}\" not granted to this plugin")]
    Denied(String),
}

/// Managed state: `label` → granted capability strings.
#[derive(Default)]
pub struct PluginAuthorizer {
    granted: Mutex<HashMap<String, Vec<String>>>,
}

impl PluginAuthorizer {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register(&self, label: String, capabilities: Vec<String>) {
        self.granted.lock().unwrap().insert(label, capabilities);
    }

    pub fn deregister(&self, label: &str) {
        self.granted.lock().unwrap().remove(label);
    }

    /// Whether the host has registered this label at all (any capability set,
    /// including an empty one). Phase 3c-2a gates `plugin_sandbox_connect` on
    /// this so a window the host never started cannot park an inbound channel.
    pub fn is_registered(&self, label: &str) -> bool {
        plugin_id_from_label(label).is_some() && self.granted.lock().unwrap().contains_key(label)
    }

    /// Authorize one op by the caller's label: verifies identity + registration
    /// always, and the op's capability when it declares one. Preferred over
    /// `authorize` at call sites, so the "does this op need a grant?" decision lives
    /// with the op rather than being re-derived by every caller.
    pub fn authorize_op(&self, label: &str, op: &PluginOp) -> Result<String, AuthzError> {
        match op.required_capability() {
            Some(cap) => self.authorize(label, cap),
            None => {
                let plugin_id = plugin_id_from_label(label).ok_or(AuthzError::NotASandbox)?;
                if self.granted.lock().unwrap().contains_key(label) {
                    Ok(plugin_id)
                } else {
                    Err(AuthzError::Unregistered)
                }
            }
        }
    }

    /// On success returns the caller's plugin id (derived from the label) so the
    /// broker uses the CALLER identity — never a client-supplied id — for the op.
    pub fn authorize(&self, label: &str, cap: &str) -> Result<String, AuthzError> {
        let plugin_id = plugin_id_from_label(label).ok_or(AuthzError::NotASandbox)?;
        let map = self.granted.lock().unwrap();
        let caps = map.get(label).ok_or(AuthzError::Unregistered)?;
        if caps.iter().any(|c| c == cap) {
            Ok(plugin_id)
        } else {
            Err(AuthzError::Denied(cap.to_string()))
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
        assert_eq!(PluginOp::SourceRead.required_capability(), None);
        let a = PluginAuthorizer::new();
        assert!(matches!(
            a.authorize_op("plugin-alpha", &PluginOp::SourceRead),
            Err(AuthzError::Unregistered)
        ));
        a.register("plugin-alpha".into(), vec![]); // zero capabilities granted
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
        a.register("plugin-alpha".into(), vec!["storage".into()]);
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
        assert_eq!(PluginOp::StorageList.required_capability(), Some("storage"));
        assert_eq!(
            PluginOp::StorageRead { key: "k".into() }.required_capability(),
            Some("storage")
        );
        assert_eq!(
            PluginOp::HttpFetch {
                url: "http://x".into(),
                init: None
            }
            .required_capability(),
            Some("network")
        );
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
        );
        assert_eq!(a.authorize("plugin-alpha", "storage").unwrap(), "alpha");
        assert_eq!(a.authorize("plugin-alpha", "network").unwrap(), "alpha");
    }

    #[test]
    fn authorize_denies_missing_capability() {
        let a = PluginAuthorizer::new();
        a.register("plugin-alpha".into(), vec!["storage".into()]);
        assert!(matches!(
            a.authorize("plugin-alpha", "network"),
            Err(AuthzError::Denied(_))
        ));
    }

    #[test]
    fn authorize_rejects_unregistered_and_non_sandbox() {
        let a = PluginAuthorizer::new();
        assert!(matches!(
            a.authorize("plugin-ghost", "storage"),
            Err(AuthzError::Unregistered)
        ));
        assert!(matches!(
            a.authorize("main", "storage"),
            Err(AuthzError::NotASandbox)
        ));
    }

    #[test]
    fn deregister_revokes() {
        let a = PluginAuthorizer::new();
        a.register("plugin-alpha".into(), vec!["storage".into()]);
        a.deregister("plugin-alpha");
        assert!(matches!(
            a.authorize("plugin-alpha", "storage"),
            Err(AuthzError::Unregistered)
        ));
    }

    #[test]
    fn is_registered_tracks_registration_and_rejects_non_sandbox() {
        let a = PluginAuthorizer::new();
        assert!(!a.is_registered("plugin-alpha"));
        a.register("plugin-alpha".into(), vec![]); // zero capabilities still counts
        assert!(a.is_registered("plugin-alpha"));
        a.deregister("plugin-alpha");
        assert!(!a.is_registered("plugin-alpha"));
        a.register("main".into(), vec!["storage".into()]); // not a sandbox label
        assert!(!a.is_registered("main"));
    }

    #[test]
    fn distinct_plugins_isolated_identities() {
        // The isolation guarantee: each label authorizes as its OWN id, so the
        // broker (Task 2) namespaces storage by the caller, never a shared arg.
        let a = PluginAuthorizer::new();
        a.register("plugin-a".into(), vec!["storage".into()]);
        a.register("plugin-b".into(), vec!["storage".into()]);
        assert_eq!(a.authorize("plugin-a", "storage").unwrap(), "a");
        assert_eq!(a.authorize("plugin-b", "storage").unwrap(), "b");
    }
}
