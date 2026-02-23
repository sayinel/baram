// §6.3 LLM request cancellation registry
// Uses tokio::sync::oneshot channels to signal stream cancellation to providers.

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{oneshot, Mutex};

/// Registry of active LLM requests that can be cancelled.
/// Thread-safe via Arc<Mutex<>> — Clone is derived automatically.
#[derive(Clone)]
pub struct CancelRegistry {
    inner: Arc<Mutex<HashMap<String, oneshot::Sender<()>>>>,
}

impl CancelRegistry {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Register a new request. Returns a Receiver that resolves when cancelled.
    pub async fn register(&self, request_id: &str) -> oneshot::Receiver<()> {
        let (tx, rx) = oneshot::channel();
        let mut map = self.inner.lock().await;
        map.insert(request_id.to_string(), tx);
        rx
    }

    /// Cancel a request by ID. Returns true if the request was found and cancelled.
    pub async fn cancel(&self, request_id: &str) -> bool {
        let mut map = self.inner.lock().await;
        if let Some(tx) = map.remove(request_id) {
            let _ = tx.send(());
            true
        } else {
            false
        }
    }

    /// Remove a request from the registry (called when stream completes normally).
    pub async fn remove(&self, request_id: &str) {
        let mut map = self.inner.lock().await;
        map.remove(request_id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_register_and_cancel() {
        let registry = CancelRegistry::new();
        let rx = registry.register("req_1").await;
        assert!(registry.cancel("req_1").await);
        // Receiver should resolve
        assert!(rx.await.is_ok());
    }

    #[tokio::test]
    async fn test_cancel_nonexistent() {
        let registry = CancelRegistry::new();
        assert!(!registry.cancel("nonexistent").await);
    }

    #[tokio::test]
    async fn test_remove() {
        let registry = CancelRegistry::new();
        let _rx = registry.register("req_1").await;
        registry.remove("req_1").await;
        // After remove, cancel should return false
        assert!(!registry.cancel("req_1").await);
    }

    #[tokio::test]
    async fn test_clone_shares_state() {
        let registry = CancelRegistry::new();
        let clone = registry.clone();
        let rx = registry.register("req_1").await;
        // Cancel via clone should work
        assert!(clone.cancel("req_1").await);
        assert!(rx.await.is_ok());
    }
}
