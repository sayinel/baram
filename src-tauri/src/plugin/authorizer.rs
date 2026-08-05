// §260 Phase 3a — the sandbox authorizer. Maps a Tauri-verified window label
// (`plugin-<id>`) to the capabilities the host registered for that plugin, and
// authorizes each brokered op by caller identity + capability. The label is
// unforgeable (Tauri sets it); the granted set is populated by the host window
// via `plugin_sandbox_register` (a plugin window is rejected from registering).
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
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
    /// Which REGISTRATION this grant is, globally and monotonically.
    ///
    /// §260 Phase 4b security review (Q5) — a label is reused across a plugin's lives
    /// (dev reload, disable→enable), so "is `plugin-x` registered?" cannot distinguish
    /// one life from the next. Staging reads that answer under one lock and writes the
    /// slot under another, so a stage still in flight when a reload lands could park the
    /// old session's document under the NEW registration — and `StagedRead` needs no
    /// capability, so the reloaded plugin could read it with no editor grant declared.
    /// Carrying the epoch into the slot and requiring it to match on the way out makes
    /// that impossible rather than merely unlikely.
    pub epoch: u64,
    pub source_dir: String,
}

/// Managed state: `label` → what the host granted it.
#[derive(Default)]
pub struct PluginAuthorizer {
    granted: Mutex<HashMap<String, SandboxGrant>>,
    /// Monotonic across ALL labels, so an epoch identifies a registration outright and
    /// two plugins can never present the same one.
    next_epoch: AtomicU64,
}

impl PluginAuthorizer {
    pub fn new() -> Self {
        Self::default()
    }

    /// Bind a sandbox's grants, and return the epoch identifying this registration.
    pub fn register(&self, label: String, capabilities: Vec<String>, source_dir: String) -> u64 {
        let epoch = self.next_epoch.fetch_add(1, Ordering::Relaxed);
        self.granted.lock().unwrap().insert(
            label,
            SandboxGrant {
                capabilities,
                epoch,
                source_dir,
            },
        );
        epoch
    }

    /// The current registration's epoch, or `None` when the label is not registered.
    /// Read together with the registration check so staging cannot straddle a reload.
    pub fn epoch(&self, label: &str) -> Option<u64> {
        self.granted.lock().unwrap().get(label).map(|g| g.epoch)
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

    /// The op→capability mapping, spelled out for EVERY variant.
    ///
    /// §260 Phase 6 code review (L4). This test used to name three ops, and the adversary sweeps
    /// are both grant-set-wide — the fixture holds none of the broker grants and the admit-side
    /// plugin holds all of them — so **cross-wiring was invisible**: making `StorageRemove`
    /// require `"network"` left all 70 plugin tests green (verified by mutation). A plugin
    /// holding `network` but not `storage` could then reach its own storage namespace.
    ///
    /// Exhaustive by construction: the list is driven off `adversary_ops()`, whose coverage of
    /// every variant is itself asserted, and `kind_name` has no wildcard arm — so a new op
    /// cannot arrive without an expected capability here.
    #[test]
    fn required_capability_mapping_is_exhaustive_and_not_cross_wired() {
        use CapabilityRequirement::{AnyOf, None};

        // The hand-written expectation. Deliberately NOT derived from
        // `capability_requirement()` — that is the thing under test.
        let expected = |name: &str| -> CapabilityRequirement {
            match name {
                "files_list" | "files_read" => AnyOf(&["files", "files:readonly"]),
                "files_write" => AnyOf(&["files"]),
                "http_fetch" => AnyOf(&["network"]),
                "source_read" | "staged_read" => None,
                "storage_list" | "storage_read" | "storage_remove" | "storage_write" => {
                    AnyOf(&["storage"])
                }
                other => panic!("no expected capability recorded for op \"{other}\""),
            }
        };

        let mut seen: Vec<&str> = Vec::new();
        for (op, _) in adversary_ops() {
            let name = kind_name(&op);
            assert_eq!(
                op.capability_requirement(),
                expected(name),
                "{name} is wired to the wrong capability"
            );
            seen.push(name);
        }
        seen.sort_unstable();
        seen.dedup();
        assert_eq!(seen.len(), 10, "every PluginOp variant must be mapped here");
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

    // ─────────────────────────────────────────────────────────────────────────────────
    // §260 Phase 6 — the malicious-fixture adversary sweep.
    //
    // #260's last completion criterion is that a malicious plugin fixture verifies the deny
    // paths in CI. `examples/plugins/malicious-fixture` is that plugin: it holds `commands`
    // and `statusbar`, and asks for everything else. Its vitest half
    // (`malicious-fixture.test.ts`) runs the real bundle through the real client and session
    // and proves the host-mediated refusals plus reachability; the DECISION for every brokered
    // op is made here, so it is asserted here.
    //
    // What is new relative to the tests above: they check one grant against one op each. This
    // sweeps EVERY `PluginOp` variant against one minimal grant, which is the shape an actual
    // adversary has.
    // ─────────────────────────────────────────────────────────────────────────────────

    /// What the adversary is supposed to get for an op.
    #[derive(Debug, PartialEq)]
    enum Expect {
        /// Refused for want of a grant.
        Denied,
        /// Admitted for a REGISTERED caller with no grant at all — the op needs none.
        NeedsNoGrant,
    }

    /// The op's discriminant name, via a match with **no wildcard arm**.
    ///
    /// This is the anti-drift device, and it is the whole reason this helper exists rather than
    /// a `format!("{op:?}")`: adding a `PluginOp` variant fails to COMPILE here until someone
    /// names it, and the expected-coverage list below then fails until the adversary table
    /// gets an entry for it. A source scan or a `_ =>` arm would let a new op ship unattacked.
    /// `malicious-fixture.test.ts` has the same device as an exhaustive `Record`.
    fn kind_name(op: &PluginOp) -> &'static str {
        match op {
            PluginOp::FilesList { .. } => "files_list",
            PluginOp::FilesRead { .. } => "files_read",
            PluginOp::FilesWrite { .. } => "files_write",
            PluginOp::HttpFetch { .. } => "http_fetch",
            PluginOp::SourceRead => "source_read",
            PluginOp::StagedRead => "staged_read",
            PluginOp::StorageList => "storage_list",
            PluginOp::StorageRead { .. } => "storage_read",
            PluginOp::StorageRemove { .. } => "storage_remove",
            PluginOp::StorageWrite { .. } => "storage_write",
        }
    }

    /// Every op the fixture attempts, with what a `commands`+`statusbar` plugin must get.
    ///
    /// The hostile paths and the cross-plugin storage key are the fixture's verbatim
    /// arguments: this layer refuses them for want of a grant BEFORE any path rule runs, which
    /// is why `plugin_cmd`'s `plugin_target_path` / `reject_app_state_path` tests cover the
    /// shapes separately — a `files`-granted plugin is the one those guards exist for.
    fn adversary_ops() -> Vec<(PluginOp, Expect)> {
        vec![
            (
                PluginOp::StorageWrite {
                    key: "stolen".into(),
                    value: "x".into(),
                },
                Expect::Denied,
            ),
            (
                PluginOp::StorageRead {
                    key: "stolen".into(),
                },
                Expect::Denied,
            ),
            (PluginOp::StorageList, Expect::Denied),
            (
                PluginOp::StorageRemove {
                    key: "stolen".into(),
                },
                Expect::Denied,
            ),
            (
                PluginOp::StorageRead {
                    key: "../baram-word-count/config.json".into(),
                },
                Expect::Denied,
            ),
            (
                PluginOp::HttpFetch {
                    url: "https://example.test/exfiltrate".into(),
                    init: None,
                },
                Expect::Denied,
            ),
            (
                PluginOp::FilesList {
                    context: None,
                    path: String::new(),
                },
                Expect::Denied,
            ),
            (
                PluginOp::FilesRead {
                    context: None,
                    path: "notes.md".into(),
                },
                Expect::Denied,
            ),
            (
                PluginOp::FilesWrite {
                    content: "pwned".into(),
                    context: None,
                    path: "owned.md".into(),
                },
                Expect::Denied,
            ),
            (
                PluginOp::FilesRead {
                    context: None,
                    path: "/etc/passwd".into(),
                },
                Expect::Denied,
            ),
            (
                PluginOp::FilesRead {
                    context: None,
                    path: "../../../etc/passwd".into(),
                },
                Expect::Denied,
            ),
            (
                PluginOp::FilesRead {
                    context: None,
                    path: ".baram/config.json".into(),
                },
                Expect::Denied,
            ),
            // Reading one's own bundle is how the sandbox boots, and the op names no file.
            (PluginOp::SourceRead, Expect::NeedsNoGrant),
            // Collecting an answer the host already decided to give. A plugin that holds
            // nothing has nothing staged, so this returns an error LATER, from an empty slot —
            // not a capability refusal, which is exactly the distinction being pinned.
            (PluginOp::StagedRead, Expect::NeedsNoGrant),
        ]
    }

    /// The adversary's table must cover every variant — see `kind_name`.
    #[test]
    fn the_adversary_attacks_every_plugin_op_variant() {
        let mut covered: Vec<&str> = adversary_ops()
            .iter()
            .map(|(op, _)| kind_name(op))
            .collect();
        covered.sort_unstable();
        covered.dedup();
        assert_eq!(
            covered,
            vec![
                "files_list",
                "files_read",
                "files_write",
                "http_fetch",
                "source_read",
                "staged_read",
                "storage_list",
                "storage_read",
                "storage_remove",
                "storage_write",
            ],
            "a PluginOp variant with no adversary entry would ship unattacked"
        );
    }

    #[test]
    fn a_minimally_granted_plugin_is_refused_every_op_that_needs_a_grant() {
        let a = PluginAuthorizer::new();
        // Exactly what the fixture's manifest declares. Neither capability names a broker op,
        // so every grant-requiring op below must fail — and `commands`/`statusbar` being
        // non-empty is what keeps this from passing merely because the grant list is empty.
        a.register(
            "plugin-baram-malicious-fixture".into(),
            vec!["commands".into(), "statusbar".into()],
            "/p/malicious".into(),
        );

        for (op, expected) in adversary_ops() {
            let name = kind_name(&op);
            let result = a.authorize_op("plugin-baram-malicious-fixture", &op);
            match expected {
                Expect::Denied => assert!(
                    matches!(result, Err(AuthzError::Denied(_))),
                    "{name} must be denied, got {result:?}"
                ),
                Expect::NeedsNoGrant => assert_eq!(
                    result.as_deref().ok(),
                    Some("baram-malicious-fixture"),
                    "{name} needs no grant, so a registered caller must be admitted"
                ),
            }
        }
    }

    /// The same table, from the other side — so the sweep above cannot pass by denying too
    /// much (§260 Phase 6 security review, informational note 3).
    ///
    /// A one-sided deny sweep is satisfied by an authorizer that refuses everything, and by a
    /// `capability_requirement()` mutated to demand a grant no manifest can declare: the
    /// fixture would still be refused, the test would still be green, and every REAL plugin
    /// would be broken. Running the identical op list against a plugin holding the grants those
    /// ops name turns the table into a two-sided oracle — the ops must be refused for want of a
    /// grant and admitted once it is held, or one of the two directions fails.
    #[test]
    fn a_fully_granted_plugin_is_admitted_every_op_in_the_same_table() {
        let a = PluginAuthorizer::new();
        // `files` rather than `files:readonly`, because the table includes a write. These three
        // are the whole set the broker ops name — `ai` is deliberately not among them (it is
        // host-mediated, never a `PluginOp`), which is why no op here should need it.
        a.register(
            "plugin-granted".into(),
            vec!["storage".into(), "network".into(), "files".into()],
            "/p/granted".into(),
        );

        for (op, _) in adversary_ops() {
            let name = kind_name(&op);
            assert_eq!(
                a.authorize_op("plugin-granted", &op).as_deref().ok(),
                Some("granted"),
                "{name} must be ADMITTED for a plugin holding storage+network+files; a deny \
                 here means the op demands a grant a real plugin cannot obtain"
            );
        }
    }

    #[test]
    fn the_refusal_names_the_grant_the_plugin_would_need() {
        // The message is what a plugin author reads to learn which capability to declare, and
        // the sandbox surfaces it verbatim. An any-of op must name every acceptable grant, or
        // an author adds `files` when `files:readonly` would have done.
        let a = PluginAuthorizer::new();
        a.register("plugin-x".into(), vec!["commands".into()], "/p/x".into());

        let read = a.authorize_op(
            "plugin-x",
            &PluginOp::FilesRead {
                context: None,
                path: "notes.md".into(),
            },
        );
        let message = read.unwrap_err().to_string();
        assert!(message.contains("files"), "{message}");
        assert!(message.contains("files:readonly"), "{message}");

        // …and the write half must NOT offer the readonly grant as a way in.
        let write = a.authorize_op(
            "plugin-x",
            &PluginOp::FilesWrite {
                content: "x".into(),
                context: None,
                path: "owned.md".into(),
            },
        );
        let message = write.unwrap_err().to_string();
        assert!(message.contains("files"), "{message}");
        assert!(!message.contains("files:readonly"), "{message}");
    }

    #[test]
    fn an_unregistered_adversary_is_refused_even_the_ops_that_need_no_grant() {
        // Identity is checked before capability, so a plugin the host never registered — a
        // stale webview, or one that outlived its deregistration — reaches nothing at all.
        // Without this, `SourceRead`/`StagedRead` needing no grant could be read as needing
        // no caller either.
        let a = PluginAuthorizer::new();
        for (op, _) in adversary_ops() {
            let name = kind_name(&op);
            assert!(
                matches!(
                    a.authorize_op("plugin-ghost", &op),
                    Err(AuthzError::Unregistered)
                ),
                "{name} must be refused for an unregistered caller"
            );
            // …and a HOST window is not a sandbox, whatever it claims to hold.
            assert!(
                matches!(a.authorize_op("main", &op), Err(AuthzError::NotASandbox)),
                "{name} must be refused for a non-sandbox caller"
            );
        }
    }
}
