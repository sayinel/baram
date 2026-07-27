// §260 Phase 4b — large host→sandbox payloads, staged in Rust and pulled as an invoke
// RESULT instead of pushed as a channel frame.
//
// WHY this exists at all: `channels.rs` documents that any host→sandbox frame ≥8 KiB is
// staged in tauri's app-global `ChannelDataIpcQueue` and fetched through
// `FETCH_CHANNEL_DATA_COMMAND`, which is ACL-EXEMPT and takes a guessable sequential id —
// so another sandboxed plugin could race that fetch and steal (or wedge) the frame. Every
// frame sent before this phase was far under the threshold. `editor.getMarkdown()` is what
// changes that: a 10,000-line document is hundreds of KiB, and it is the user's document
// text.
//
// WHY staging rather than chunking: 3c-2b already solved this for the plugin's own bundle.
// `PluginOp::SourceRead` returns it as a `plugin_call` RESULT, which tauri returns through
// the custom-protocol path (an HTTP body) and which, even on the postMessage fallback, is a
// bare JSON string and so never matches the `{`/`[` condition that routes into the shared
// queue. Same mechanism here, different source: the host stages, the sandbox pulls.
// Chunking would have invented a reassembly state machine — ids, sequence, totals, partial
// delivery, abort — at the realm boundary, where new failure modes cost the most.
use super::label_map::LabelMap;

/// Managed state: sandbox window label (`plugin-<id>`) → the payload waiting for it.
///
/// One slot per plugin, and the label is resolved from `window.label()` on the pull — never
/// from an argument. That is the same rule that makes plugin storage isolated and the same
/// reason `SourceRead` takes no path: a sandbox cannot name whose payload it wants.
#[derive(Default)]
pub struct StagedPayloads {
    slots: LabelMap<Staged>,
}

/// A parked payload and the registration it belongs to.
struct Staged {
    /// `PluginAuthorizer`'s registration epoch, captured when staging was ADMITTED.
    ///
    /// §260 Phase 4b security review (Q5) — the label alone cannot tell one life of a
    /// plugin from the next, and admission and insertion take different locks, so a stage
    /// in flight when a reload lands would otherwise park the previous session's document
    /// under the new registration. `StagedRead` requires no capability, so the reloaded
    /// plugin could then read it with no editor grant at all. Requiring the epoch to match
    /// on the way out closes it by construction rather than by narrowing the window.
    epoch: u64,
    payload: String,
}

impl StagedPayloads {
    pub fn new() -> Self {
        Self::default()
    }

    /// Park a payload for one sandbox, replacing anything already waiting.
    ///
    /// Replacing rather than queueing is deliberate: a staged payload is the answer to a
    /// request the sandbox is currently awaiting, so a second stage can only mean a newer
    /// request — and delivering the older document would be worse than dropping it. The
    /// displaced value drops in the caller, outside the lock (see `LabelMap`), which for a
    /// multi-megabyte document is the difference between a free() and a stall.
    pub fn stage(&self, label: String, epoch: u64, payload: String) {
        drop(self.slots.insert(label, Staged { epoch, payload }));
    }

    /// Take the payload waiting for this sandbox, if any.
    ///
    /// CONSUMED, not read: a document must not linger in memory after delivery, and a
    /// consumed slot cannot be replayed by a plugin that re-issues the pull.
    ///
    /// That claim is about AFTER delivery. A payload whose pull never comes — the sandbox
    /// died between the response and the request, say — sits until the next `stage`
    /// replaces it or `forget` drops it. Bounded, not zero: one slot per plugin at
    /// `MAX_PLUGIN_FILE_BYTES`, and both `plugin_sandbox_register` and
    /// `plugin_sandbox_deregister` clear it, so it cannot survive the session
    /// (§260 Phase 4b code review, P1).
    #[must_use]
    pub fn take(&self, label: &str, epoch: u64) -> Option<String> {
        let staged = self.slots.remove(label)?;
        // REMOVED either way: a slot whose epoch does not match belongs to a registration
        // that is over, so it can never become readable and holding it would only keep a
        // document alive. Returning `None` makes the caller answer "nothing is staged",
        // which is exactly true for the plugin now asking.
        (staged.epoch == epoch).then_some(staged.payload)
    }

    /// Drop whatever is parked for a sandbox — called on deregister, so a stopped plugin
    /// leaves no document behind (the same reason `SandboxChannels::disconnect` and
    /// `PluginRateLimiter::forget` are called there).
    pub fn forget(&self, label: &str) {
        drop(self.slots.remove(label));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Every test here stages under one registration, so the epoch is fixed; the epoch's
    /// own property has its own test below.
    const E: u64 = 7;

    #[test]
    fn a_staged_payload_is_delivered_once_and_only_to_its_own_label() {
        let staged = StagedPayloads::new();
        staged.stage("plugin-alpha".into(), E, "# alpha".into());
        staged.stage("plugin-beta".into(), E, "# beta".into());

        // Isolation: the label is the key, and the pull resolves it from the caller's
        // window — a plugin cannot name someone else's slot.
        assert_eq!(staged.take("plugin-beta", E).as_deref(), Some("# beta"));
        assert_eq!(staged.take("plugin-alpha", E).as_deref(), Some("# alpha"));

        // Consumed: a second pull gets nothing, so a replayed request cannot re-read a
        // document the plugin was already given.
        assert_eq!(staged.take("plugin-alpha", E), None);
        assert_eq!(staged.take("plugin-beta", E), None);
    }

    #[test]
    fn staging_again_replaces_the_older_payload() {
        // The slot answers the request currently in flight; an older document would be a
        // wrong answer, not a queued one.
        let staged = StagedPayloads::new();
        staged.stage("plugin-alpha".into(), E, "first".into());
        staged.stage("plugin-alpha".into(), E, "second".into());
        assert_eq!(staged.take("plugin-alpha", E).as_deref(), Some("second"));
        assert_eq!(staged.take("plugin-alpha", E), None);
    }

    /// §260 Phase 4b security review (Q5) — the property `forget`-on-register could only
    /// narrow: a stage ADMITTED under the previous registration but landing after the
    /// reload must not be readable by the new one, whatever the interleaving.
    #[test]
    fn a_payload_admitted_under_an_earlier_registration_is_never_delivered() {
        let staged = StagedPayloads::new();

        // The old session's stage lands LAST — after the reload has already cleared the
        // slot and re-registered. `forget` alone cannot help here; the epoch can.
        staged.stage(
            "plugin-alpha".into(),
            1,
            "the previous session's document".into(),
        );

        assert_eq!(
            staged.take("plugin-alpha", 2),
            None,
            "a document from a registration that is over must not be readable, even \
             though the reloaded plugin may declare no editor grant at all"
        );
        // And it is GONE, not merely withheld: a stale slot can never become valid, so
        // keeping it would only hold a document in memory.
        assert_eq!(staged.take("plugin-alpha", 1), None);
    }

    #[test]
    fn forget_leaves_no_document_behind() {
        let staged = StagedPayloads::new();
        staged.stage("plugin-alpha".into(), E, "# secret".into());
        staged.forget("plugin-alpha");
        assert_eq!(staged.take("plugin-alpha", E), None);
        // Forgetting an unknown label is a no-op, like the other per-plugin teardowns.
        staged.forget("plugin-ghost");
    }

    #[test]
    fn an_unstaged_pull_returns_nothing_rather_than_an_empty_document() {
        // The caller must be able to tell "nothing was staged for you" from "your document
        // is empty" — an empty string is a legitimate document.
        let staged = StagedPayloads::new();
        assert_eq!(staged.take("plugin-alpha", E), None);
        staged.stage("plugin-alpha".into(), E, String::new());
        assert_eq!(staged.take("plugin-alpha", E).as_deref(), Some(""));
    }
}
