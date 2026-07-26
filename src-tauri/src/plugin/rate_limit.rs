// §260 Phase 3c-2c — per-plugin, per-op-class rate limiting for `plugin_call`.
//
// WHY, and why now: 3c-2a's `MAX_SANDBOX_REPORT_BYTES` bounds ONE frame and says in
// its own comment that a cap alone does not stop a flood. With `files` landing, a
// loop can hammer the filesystem, and `http_fetch` was always a network-abuse
// primitive. A per-call size cap says nothing about calls per second.
//
// A token bucket, not a fixed window: bursty-but-reasonable usage (a plugin walking
// a directory it just listed) should pass, while a runaway loop settles to the
// refill rate instead of pinning a core. Buckets are keyed by (window label, class),
// so one plugin can never spend another's budget — the same caller-identity rule the
// authorizer uses.
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Instant;

use thiserror::Error;

/// Ops with materially different abuse profiles get different budgets.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum RateClass {
    /// Storage, files, source: local, cheap, and legitimately called in batches.
    Default,
    /// The CORS-free HTTP proxy: an exfiltration and abuse primitive, and the one
    /// op whose cost lands on someone else's server. Deliberately much tighter.
    Network,
    /// §260 3c-2c review (F3) — sandbox→host FRAMES (`plugin_sandbox_report`), not
    /// broker ops. A separate bucket because it is a different pipe with a different
    /// cost: each frame is re-serialized into the main window's event loop, and
    /// `MAX_SANDBOX_REPORT_BYTES` bounds one frame at 8 MiB while saying in its own
    /// comment that a cap does not stop a flood. It also carries `hostRequest`, so
    /// without this the host-mediated `ai` path had no Rust-side limit at all.
    Transport,
}

impl RateClass {
    /// (burst capacity, refill per second).
    const fn budget(self) -> (f64, f64) {
        match self {
            // A vault scan of a few hundred files still runs; an unbounded loop is
            // throttled to 100/s instead of as fast as the disk answers.
            RateClass::Default => (200.0, 100.0),
            RateClass::Network => (20.0, 5.0),
            // Generous: a plugin legitimately emits events and command results in
            // bursts, and this is the only channel it has for ALL of them, so
            // throttling here stalls correctness-bearing traffic, not just abuse.
            // Finite is the point.
            RateClass::Transport => (300.0, 150.0),
        }
    }
}

#[derive(Debug, Error)]
#[error("rate limit exceeded for this plugin ({limit} requests/second, burst {burst}); slow down")]
pub struct RateLimitError {
    burst: u32,
    limit: u32,
}

struct Bucket {
    /// Fractional on purpose: integer tokens would round a legitimate steady rate
    /// down to zero refill between closely-spaced calls.
    tokens: f64,
    updated: Instant,
}

/// Managed state: (label, class) → bucket.
#[derive(Default)]
pub struct PluginRateLimiter {
    buckets: Mutex<HashMap<(String, RateClass), Bucket>>,
}

impl PluginRateLimiter {
    pub fn new() -> Self {
        Self::default()
    }

    /// Spend one token for `label`'s `class` bucket, or refuse.
    pub fn check(&self, label: &str, class: RateClass) -> Result<(), RateLimitError> {
        self.check_at(label, class, Instant::now())
    }

    /// `check` with an injected clock, so the refill behaviour is unit-testable
    /// without sleeping (a sleeping test is a slow test and a flaky one).
    pub fn check_at(
        &self,
        label: &str,
        class: RateClass,
        now: Instant,
    ) -> Result<(), RateLimitError> {
        let (burst, per_second) = class.budget();
        let mut buckets = self.buckets.lock().unwrap();
        let bucket = buckets
            .entry((label.to_string(), class))
            .or_insert_with(|| Bucket {
                tokens: burst,
                updated: now,
            });
        // `saturating_duration_since`: a non-monotonic `now` (a caller passing an
        // earlier instant) must not panic or mint tokens.
        let elapsed = now.saturating_duration_since(bucket.updated).as_secs_f64();
        bucket.tokens = (bucket.tokens + elapsed * per_second).min(burst);
        bucket.updated = now;
        if bucket.tokens < 1.0 {
            return Err(RateLimitError {
                burst: burst as u32,
                limit: per_second as u32,
            });
        }
        bucket.tokens -= 1.0;
        Ok(())
    }

    /// Drop every bucket for a label. Called on deregister so a stopped plugin
    /// leaves nothing behind — and so a reinstalled plugin starts fresh rather
    /// than inheriting a drained bucket.
    pub fn forget(&self, label: &str) {
        self.buckets.lock().unwrap().retain(|(l, _), _| l != label);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    const T0: fn() -> Instant = Instant::now;

    #[test]
    fn admits_the_burst_then_refuses() {
        let limiter = PluginRateLimiter::new();
        let now = T0();
        let (burst, _) = RateClass::Default.budget();
        for i in 0..burst as u32 {
            assert!(
                limiter
                    .check_at("plugin-a", RateClass::Default, now)
                    .is_ok(),
                "call {i} within the burst must be admitted"
            );
        }
        let err = limiter
            .check_at("plugin-a", RateClass::Default, now)
            .expect_err("one past the burst must be refused");
        // The message has to tell a plugin author what happened; a bare "denied"
        // is indistinguishable from a capability problem.
        let msg = err.to_string();
        assert!(msg.contains("rate limit"), "unexpected message: {msg}");
        assert!(msg.contains("100"), "the limit must be stated: {msg}");
    }

    #[test]
    fn refills_over_time() {
        let limiter = PluginRateLimiter::new();
        let now = T0();
        let (burst, per_second) = RateClass::Default.budget();
        for _ in 0..burst as u32 {
            limiter
                .check_at("plugin-a", RateClass::Default, now)
                .unwrap();
        }
        assert!(limiter
            .check_at("plugin-a", RateClass::Default, now)
            .is_err());

        // One token's worth of time is enough for exactly one more call.
        let later = now + Duration::from_secs_f64(1.0 / per_second);
        assert!(limiter
            .check_at("plugin-a", RateClass::Default, later)
            .is_ok());
        assert!(limiter
            .check_at("plugin-a", RateClass::Default, later)
            .is_err());
    }

    #[test]
    fn refill_never_exceeds_the_burst() {
        // Otherwise an idle plugin would accumulate an unbounded credit and could
        // spend a day's budget in one instant — the flood this exists to prevent.
        let limiter = PluginRateLimiter::new();
        let now = T0();
        let (burst, _) = RateClass::Default.budget();
        limiter
            .check_at("plugin-a", RateClass::Default, now)
            .unwrap();
        let much_later = now + Duration::from_secs(3600);
        for _ in 0..burst as u32 {
            limiter
                .check_at("plugin-a", RateClass::Default, much_later)
                .unwrap();
        }
        assert!(limiter
            .check_at("plugin-a", RateClass::Default, much_later)
            .is_err());
    }

    #[test]
    fn network_is_bounded_tighter_than_the_default_class() {
        let (default_burst, default_rate) = RateClass::Default.budget();
        let (net_burst, net_rate) = RateClass::Network.budget();
        assert!(net_burst < default_burst);
        assert!(net_rate < default_rate);

        // And the classes are separate buckets: draining the network budget must not
        // stop a plugin from reading its own storage.
        let limiter = PluginRateLimiter::new();
        let now = T0();
        for _ in 0..net_burst as u32 {
            limiter
                .check_at("plugin-a", RateClass::Network, now)
                .unwrap();
        }
        assert!(limiter
            .check_at("plugin-a", RateClass::Network, now)
            .is_err());
        assert!(limiter
            .check_at("plugin-a", RateClass::Default, now)
            .is_ok());
    }

    /// §260 3c-2c review (F3) — the frame pipe is bounded, and separately from the
    /// broker: a plugin doing legitimate `ai` work over the transport must not lose
    /// its ability to read its own storage, and vice versa.
    #[test]
    fn the_transport_class_is_bounded_and_independent() {
        let limiter = PluginRateLimiter::new();
        let now = T0();
        let (burst, rate) = RateClass::Transport.budget();
        assert!(burst.is_finite() && rate.is_finite());

        for _ in 0..burst as u32 {
            limiter
                .check_at("plugin-a", RateClass::Transport, now)
                .unwrap();
        }
        assert!(limiter
            .check_at("plugin-a", RateClass::Transport, now)
            .is_err());
        // Its own bucket: the broker classes are untouched.
        assert!(limiter
            .check_at("plugin-a", RateClass::Default, now)
            .is_ok());
        assert!(limiter
            .check_at("plugin-a", RateClass::Network, now)
            .is_ok());
    }

    #[test]
    fn one_plugin_cannot_spend_anothers_budget() {
        let limiter = PluginRateLimiter::new();
        let now = T0();
        let (burst, _) = RateClass::Network.budget();
        for _ in 0..burst as u32 {
            limiter
                .check_at("plugin-noisy", RateClass::Network, now)
                .unwrap();
        }
        assert!(limiter
            .check_at("plugin-noisy", RateClass::Network, now)
            .is_err());
        assert!(
            limiter
                .check_at("plugin-quiet", RateClass::Network, now)
                .is_ok(),
            "a noisy plugin must not be able to throttle another"
        );
    }

    #[test]
    fn forget_drops_every_class_for_that_label_only() {
        let limiter = PluginRateLimiter::new();
        let now = T0();
        let (net_burst, _) = RateClass::Network.budget();
        for _ in 0..net_burst as u32 {
            limiter
                .check_at("plugin-a", RateClass::Network, now)
                .unwrap();
        }
        limiter
            .check_at("plugin-b", RateClass::Network, now)
            .unwrap();
        assert!(limiter
            .check_at("plugin-a", RateClass::Network, now)
            .is_err());

        limiter.forget("plugin-a");
        assert!(
            limiter
                .check_at("plugin-a", RateClass::Network, now)
                .is_ok(),
            "a reinstalled plugin must not inherit a drained bucket"
        );
        assert_eq!(
            limiter.buckets.lock().unwrap().len(),
            2,
            "forget must not touch another label's buckets"
        );
    }

    #[test]
    fn an_earlier_instant_neither_panics_nor_mints_tokens() {
        let limiter = PluginRateLimiter::new();
        let now = T0() + Duration::from_secs(10);
        let (burst, _) = RateClass::Network.budget();
        for _ in 0..burst as u32 {
            limiter
                .check_at("plugin-a", RateClass::Network, now)
                .unwrap();
        }
        let earlier = now - Duration::from_secs(5);
        assert!(limiter
            .check_at("plugin-a", RateClass::Network, earlier)
            .is_err());
    }
}
