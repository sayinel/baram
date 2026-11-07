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
use tauri::ipc::Channel;

use super::label_map::LabelMap;

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
        // §260 3c-2a review (I3) · §395 spec 0074 §10 — a frame whose JSON is 8,192 bytes or more
        // (`MAX_JSON_DIRECT_EXECUTE_THRESHOLD`) is not delivered by the one `eval` a smaller frame
        // gets: tauri parks it in `ChannelDataIpcQueue` and the webview fetches it through
        // `FETCH_CHANNEL_DATA_COMMAND`, one more round trip. At the locked tauri 2.12.2
        // (`ipc/channel.rs`) that queue is per webview — "Scoped per webview"; a frame goes in with
        // `insert_if(webview.label(), …)` and the fetch takes `cache.remove(webview.label(), id)`, the
        // calling webview's own entry — so no other sandbox can read or take it. (Written at tauri
        // 2.11.5, this comment used to say another sandbox could.) Size does not change the order a
        // sandbox sees either: `channel_on` numbers every frame as `channel.send` takes it, and the
        // sandbox's `Channel` (@tauri-apps/api 2.12.4, `core.js`) hands frames to `onmessage` in that
        // order, holding a later frame until an earlier fetched one has arrived. The host sends a
        // sandbox's frames one at a time for that reason (`send-chain.ts`, spec 0074 D12). So a
        // frame over the threshold costs one more round trip and nothing else, and frames that
        // size are ordinary: a file tree menu command with many targets (spec 0074 D16), or a
        // streamed token piece of Hangul text (`splitForFrame` cuts at 4,096 UTF-16 units, about
        // 12 KB of UTF-8). The line below says so at debug level (plan 0128 R11).
        #[cfg(debug_assertions)]
        {
            // tauri's direct-eval path is `len < MAX_JSON_DIRECT_EXECUTE_THRESHOLD`,
            // so the queue is taken at `>= 8192`; `serialized_len_capped` reports
            // None once the length passes its cap, hence `threshold - 1`.
            const CHANNEL_QUEUE_THRESHOLD: usize = 8192;
            if super::serialized_len_capped(&msg, CHANNEL_QUEUE_THRESHOLD - 1).is_none() {
                log::debug!(
                    "§260 · §395: h2s frame for {label} is ≥{CHANNEL_QUEUE_THRESHOLD} bytes — tauri \
                     hands it to this webview through its own channel-data queue, one more fetch \
                     round trip; order and isolation are unchanged"
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
    use tauri::ipc::InvokeResponseBody;

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
