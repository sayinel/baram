// §260 Phase 3c-2a — the host→sandbox message path. One `tauri::ipc::Channel`
// per live sandbox webview, keyed by the Tauri-verified window label.
//
// WHY a channel and not an event: a `Channel` resolves the *caller webview's* own
// IPC callback, so a message reaches exactly that sandbox. Tauri events cannot do
// this — `emit_to`/`emit_filter` are both short-circuited by
// `match_any_or_filter` (tauri/src/event/listener.rs) for any JS listener
// registered with the default `EventTarget::Any`, which is what
// `listen(name, cb)` produces. That is why `plugin-*` windows hold no
// `core:event:*` permission at all and talk over commands + this channel instead.
use std::collections::HashMap;
use std::sync::Mutex;

use tauri::ipc::Channel;

/// Label → value map that guarantees **no value is ever dropped, or used, while
/// the lock is held**. That is not a style preference: a `Channel` obtained from a
/// command argument carries an `on_drop` that evals `{end:true}` into its webview
/// (tauri `ipc/channel.rs`), and `Webview::eval` reaches the event loop — under the
/// `tracing` feature it even blocks on a reply from the main thread, and on the main
/// thread it runs `handle_user_message` inline. Holding a lock across that is a
/// deadlock waiting for a main-thread caller of this map.
///
/// The subtlety this type exists to contain: `map.lock().unwrap().insert(k, v);` as
/// a bare statement drops the **returned old value first** (temporaries drop in
/// reverse creation order, and the guard was created first), i.e. under the lock.
/// Returning the displaced value to the caller moves that drop past the guard.
struct LabelMap<T> {
    inner: Mutex<HashMap<String, T>>,
}

impl<T> Default for LabelMap<T> {
    fn default() -> Self {
        Self {
            inner: Mutex::new(HashMap::new()),
        }
    }
}

impl<T> LabelMap<T> {
    /// Test-only probe: is the map lockable right now? Used to prove that values
    /// drop with the lock released (a same-thread `try_lock` fails while held).
    #[cfg(test)]
    fn is_unlocked(&self) -> bool {
        self.inner.try_lock().is_ok()
    }
}

impl<T: Clone> LabelMap<T> {
    /// Insert, returning any displaced value so it drops in the CALLER, lock-free.
    #[must_use = "the displaced value must drop outside the lock"]
    fn insert(&self, label: String, value: T) -> Option<T> {
        self.inner.lock().unwrap().insert(label, value)
    }

    /// Remove, returning the value so it drops in the CALLER, lock-free.
    #[must_use = "the removed value must drop outside the lock"]
    fn remove(&self, label: &str) -> Option<T> {
        self.inner.lock().unwrap().remove(label)
    }

    /// Clone out of the lock so the caller can use the value lock-free.
    fn get(&self, label: &str) -> Option<T> {
        self.inner.lock().unwrap().get(label).cloned()
    }
}

/// Managed state: sandbox window label (`plugin-<id>`) → its inbound channel.
#[derive(Default)]
pub struct SandboxChannels {
    connected: LabelMap<Channel<serde_json::Value>>,
}

impl SandboxChannels {
    pub fn new() -> Self {
        Self::default()
    }

    /// Record (or replace) the inbound channel a sandbox handed us at boot. A
    /// replaced channel (sandbox reload) drops here, after the lock is released.
    pub fn connect(&self, label: String, channel: Channel<serde_json::Value>) {
        drop(self.connected.insert(label, channel));
    }

    /// Drop a sandbox's channel — called when its capabilities are deregistered
    /// (plugin stopped/disabled), so a stale webview can no longer be messaged.
    pub fn disconnect(&self, label: &str) {
        drop(self.connected.remove(label));
    }

    /// Deliver one host→sandbox message. Fails closed when the sandbox has not
    /// connected yet (the host's activate retry covers that window) or is gone.
    pub fn send(&self, label: &str, msg: serde_json::Value) -> Result<(), String> {
        let channel = self
            .connected
            .get(label)
            .ok_or_else(|| format!("sandbox \"{label}\" is not connected"))?;
        // §260 3c-2a review (I3): a frame ≥ MAX_JSON_DIRECT_EXECUTE_THRESHOLD
        // (8 KiB) is staged in tauri's app-global `ChannelDataIpcQueue` and fetched
        // by the webview through `FETCH_CHANNEL_DATA_COMMAND`, which is ACL-EXEMPT
        // and takes only a guessable sequential id — so another sandbox could race
        // that fetch and steal (and wedge) this frame. Every frame we send today is
        // far under it; warn loudly in dev if that ever stops being true.
        #[cfg(debug_assertions)]
        {
            // tauri's direct-eval path is `len < MAX_JSON_DIRECT_EXECUTE_THRESHOLD`,
            // so the queue is taken at `>= 8192`; `serialized_len_capped` reports
            // None once the length passes its cap, hence `threshold - 1`.
            const CHANNEL_QUEUE_THRESHOLD: usize = 8192;
            if super::serialized_len_capped(&msg, CHANNEL_QUEUE_THRESHOLD - 1).is_none() {
                log::warn!(
                    "§260: h2s frame for {label} is ≥{CHANNEL_QUEUE_THRESHOLD} bytes — it takes \
                     tauri's shared channel-data queue, which is ACL-exempt and guessable; chunk \
                     it before this ships"
                );
            }
        }
        channel.send(msg).map_err(|e| e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};
    use tauri::ipc::{Channel, InvokeResponseBody};

    /// A channel whose delivered payloads are captured, standing in for a real
    /// webview's IPC callback.
    fn sink() -> (Channel<serde_json::Value>, Arc<Mutex<Vec<String>>>) {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let captured = seen.clone();
        let channel = Channel::new(move |body: InvokeResponseBody| {
            let text = match body {
                InvokeResponseBody::Json(json) => json,
                InvokeResponseBody::Raw(bytes) => String::from_utf8_lossy(&bytes).to_string(),
            };
            captured.lock().unwrap().push(text);
            Ok(())
        });
        (channel, seen)
    }

    /// §260 3c-2a review (I1) — the real `Channel`'s `Drop` evals into its webview,
    /// so a value must never drop while the map's lock is held. `Channel::new` cannot
    /// carry an `on_drop` (only the command-argument path does), so the property is
    /// pinned on `LabelMap` itself with a probe that observes lock state at drop.
    #[test]
    fn displaced_and_removed_values_drop_with_the_lock_released() {
        #[derive(Clone)]
        struct Probe {
            map: Arc<LabelMap<Probe>>,
            observations: Arc<Mutex<Vec<bool>>>,
        }
        impl Drop for Probe {
            fn drop(&mut self) {
                let unlocked = self.map.is_unlocked();
                if let Ok(mut o) = self.observations.lock() {
                    o.push(unlocked);
                }
            }
        }

        let map: Arc<LabelMap<Probe>> = Arc::new(LabelMap::default());
        let observations = Arc::new(Mutex::new(Vec::new()));
        let probe = |m: &Arc<LabelMap<Probe>>| Probe {
            map: m.clone(),
            observations: observations.clone(),
        };

        drop(map.insert("plugin-a".into(), probe(&map))); // first insert: nothing displaced
        drop(map.insert("plugin-a".into(), probe(&map))); // replace → old value drops
        drop(map.remove("plugin-a")); // remove → value drops
        drop(map.get("plugin-a")); // absent, no clone

        let seen = observations.lock().unwrap().clone();
        assert!(
            seen.len() >= 2,
            "expected the displaced + removed values to drop, saw {} drops",
            seen.len()
        );
        assert!(
            seen.iter().all(|&unlocked| unlocked),
            "a value dropped while the map lock was held: {seen:?}"
        );
    }

    #[test]
    fn send_delivers_to_the_connected_label() {
        let channels = SandboxChannels::default();
        let (channel, seen) = sink();
        channels.connect("plugin-alpha".into(), channel);
        channels
            .send("plugin-alpha", serde_json::json!({ "type": "activate" }))
            .unwrap();
        assert_eq!(seen.lock().unwrap().len(), 1);
        assert!(seen.lock().unwrap()[0].contains("activate"));
    }

    #[test]
    fn send_to_unknown_label_fails_closed() {
        let channels = SandboxChannels::default();
        assert!(channels
            .send("plugin-ghost", serde_json::json!({}))
            .is_err());
    }

    #[test]
    fn disconnect_makes_further_sends_fail() {
        let channels = SandboxChannels::default();
        let (channel, seen) = sink();
        channels.connect("plugin-alpha".into(), channel);
        channels.disconnect("plugin-alpha");
        assert!(channels
            .send("plugin-alpha", serde_json::json!({}))
            .is_err());
        assert!(seen.lock().unwrap().is_empty());
    }

    #[test]
    fn distinct_sandboxes_are_isolated() {
        // The isolation guarantee: a message addressed to plugin-a must never
        // surface in plugin-b's realm.
        let channels = SandboxChannels::default();
        let (a_channel, a_seen) = sink();
        let (b_channel, b_seen) = sink();
        channels.connect("plugin-a".into(), a_channel);
        channels.connect("plugin-b".into(), b_channel);
        channels
            .send("plugin-a", serde_json::json!({ "for": "a" }))
            .unwrap();
        assert_eq!(a_seen.lock().unwrap().len(), 1);
        assert!(b_seen.lock().unwrap().is_empty());
    }

    #[test]
    fn reconnect_replaces_the_previous_channel() {
        // A sandbox that reloads calls connect again; the stale channel must not
        // keep receiving (its webview callback is gone).
        let channels = SandboxChannels::default();
        let (first, first_seen) = sink();
        let (second, second_seen) = sink();
        channels.connect("plugin-alpha".into(), first);
        channels.connect("plugin-alpha".into(), second);
        channels
            .send("plugin-alpha", serde_json::json!({}))
            .unwrap();
        assert!(first_seen.lock().unwrap().is_empty());
        assert_eq!(second_seen.lock().unwrap().len(), 1);
    }
}
