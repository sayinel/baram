// §69 Phase D — registry index fetch and revocation list fetch/verification.
//
// `fetch_registry` reads the marketplace index; `fetch_revocations` reads and (for the
// first-party registry) verifies the revocation list. `MAX_REVOCATION_BYTES` and the compiled
// `REVOCATION_PUBLIC_KEY` / `FIRST_PARTY_REVOCATION_PREFIX` this function reads stay in
// `plugin/mod.rs` rather than here — `scripts/rust-constants.ts` and two vitest tests
// (`revocation-client.test.ts`, `revocation-signature-verify.test.ts`) scrape those exact
// declarations out of that file's text by path, so moving them would silently break a publish
// gate this crate cannot see fail.
use std::time::Duration;

use super::origin::{validate_http_url, verify_revocation_signature};
use super::registry::RegistryIndex;
use super::PluginError;
use super::{FIRST_PARTY_REVOCATION_PREFIX, MAX_REVOCATION_BYTES, REVOCATION_PUBLIC_KEY};

/// Largest registry index we will read.
///
/// Four times the revocation cap, because this file grows with the registry itself:
/// Obsidian's community index is roughly 2,000 entries and about 1 MB, and an index that
/// outgrew its own cap would take the marketplace down for every user at once. Still a
/// bound — without one, a misconfigured or hostile host streams unbounded bytes into
/// memory.
const MAX_REGISTRY_BYTES: usize = 4 * 1024 * 1024;

/// Fetch registry index.json from a URL. Caching is handled at the frontend level.
///
/// Guarded the way `fetch_revocations` is: scheme, timeout, streamed size cap. It had
/// none of the three — `reqwest::get` honours whatever scheme the URL names, waits with
/// no deadline, and `text()` buffers a body of any length before anything can inspect it.
///
/// No UI sets the registry URL today; it is persisted store state with a default. That is
/// not the same as trusted input — it is read back from disk on every start, and a
/// trusted-tier plugin shares the realm that writes it. The guards therefore do not
/// depend on where the string came from.
pub async fn fetch_registry(url: &str) -> Result<RegistryIndex, PluginError> {
    let parsed = validate_http_url(url).map_err(PluginError::Refused)?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()?;
    let mut response = client.get(parsed).send().await?;
    let status = response.status();
    if !status.is_success() {
        // `Refused`, not `InvalidManifest`. A 404 reached the user as "Invalid manifest:
        // Registry returned HTTP 404" — blaming a document that had not been downloaded,
        // which is the exact miscue `Refused` was added to remove (§69 code review).
        return Err(PluginError::Refused(format!(
            "registry returned HTTP {status}"
        )));
    }
    let mut buf: Vec<u8> = Vec::new();
    while let Some(chunk) = response.chunk().await? {
        if buf.len() + chunk.len() > MAX_REGISTRY_BYTES {
            return Err(PluginError::Refused(format!(
                "registry index too large: exceeds {MAX_REGISTRY_BYTES} byte limit"
            )));
        }
        buf.extend_from_slice(&chunk);
    }
    let index: RegistryIndex = serde_json::from_slice(&buf)?;
    Ok(index)
}

/// Fetch the plugin revocation list as raw JSON text (§69).
///
/// Text, not a typed struct, on purpose. The TypeScript side already owns the
/// validator (`normalizeRevocationList`), and its rule is to drop malformed ENTRIES
/// while keeping the rest of the list. A serde struct here would reject the whole
/// document on one bad entry — silently disabling revocation, which is the exact
/// failure that validator was written to avoid. One validator, not two that can
/// disagree.
///
/// Enforces the scheme guard, a timeout and a size cap. It runs on a background path
/// during startup, so a hanging host must not be able to hold that open. `fetch_registry`
/// above lacked all three until it was brought to the same shape; the two now differ only
/// in their size cap and in returning text rather than a struct.
pub async fn fetch_revocations(url: &str) -> Result<FetchedRevocations, String> {
    // ‼️ Verification applies where we hold the key, which is the first-party registry and
    // nowhere else — see `FIRST_PARTY_REVOCATION_PREFIX`. And it is ARMED only once the key
    // constant is filled in, because demanding a signature before one is published rejects
    // the live list on every client. Both skips are logged: an unverified list must never be
    // mistaken for a verified one just because nothing was said.
    //
    // ‼️ THE DECISION IS MADE BEFORE ANY REQUEST, and it can be: both conditions are a prefix
    // test and a compile-time constant. That matters twice over — a third-party registry is
    // never asked for a `.sig` it does not have, and when a signature IS required both fetches
    // can start together.
    let needs_signature =
        url.starts_with(FIRST_PARTY_REVOCATION_PREFIX) && !REVOCATION_PUBLIC_KEY.is_empty();
    if !needs_signature {
        let body = fetch_capped_text(url, MAX_REVOCATION_BYTES, "revocation list").await?;
        if url.starts_with(FIRST_PARTY_REVOCATION_PREFIX) {
            log::warn!(
                "[Revocation] signature enforcement is NOT ARMED — no public key is compiled in"
            );
        } else {
            log::info!("[Revocation] third-party registry — list is not signature-verified");
        }
        return Ok(FetchedRevocations::unverified(body));
    }

    let (body, signature) = fetch_signed_pair(url).await?;
    verified_revocations(body, &signature, REVOCATION_PUBLIC_KEY)
}

/// Fetch the list and its detached signature CONCURRENTLY, over one HTTP client.
///
/// ‼️ ARMING DOUBLED THE COST OF A STARTUP THAT HAS A BUDGET (security review MEDIUM-3). The two
/// fetches ran in sequence, each building its own `reqwest::Client` and therefore its own
/// connection pool, so a launch paid two round trips and two TLS handshakes inside
/// `REVOCATION_REFRESH_BUDGET_MS` — 1500 ms, after which `plugin-lifecycle.ts` stops waiting and
/// loads plugins with whatever list is stored. A fresh install has NO stored list, so losing that
/// race means that launch runs with **no revocations at all**, `malicious` entries included. An
/// attacker who can only slow the connection, and an ordinary user on a slow link, get the same
/// outcome. ‼️ MITIGATED, NOT CLOSED: any round trip over the budget still loses the race. What
/// changed is the probability, not the failure mode.
///
/// ‼️ WHAT THIS BUYS, STATED WITHOUT OVERCLAIMING: the two requests now overlap rather than
/// queueing, and they share one connection pool. Against an HTTP/2 origin they multiplex over a
/// single connection and there is one handshake; over HTTP/1.1 on a cold pool the second request
/// may open its own connection, in which case the handshakes are concurrent instead of serial.
/// Either way the wall clock is one round trip rather than two — the claim is "not serialised",
/// not "one handshake".
///
/// ‼️ `join!`, NOT `try_join!`, AND THE DIFFERENCE IS A DETECTION CONTROL (security re-review
/// MEDIUM-1, which also explains a CI failure this suite reproduced 19 times in 30 under load).
/// `try_join!` returns whichever future fails FIRST, and the signature's error is mapped to a
/// sentence the classifier in `revocation-client.ts` treats as structural. So when BOTH fail the
/// log level was decided by a timing race. The sequential code got this right by construction —
/// the body was fetched first, so its error always won — and that precedence is restored below.
///
/// ‼️ WHICH FAILURES THIS ACTUALLY RECLASSIFIES, because the first version of this comment claimed
/// three and delivers one (third-round code review MEDIUM). The classifier is nine alternatives,
/// not two — `not allowed|forbidden|denied|HTTP \d|signature|public key|unsigned|too large|not
/// UTF-8` — so precedence changes the level only where the BODY's own error matches none of them:
///
/// - transport failure (offline, DNS, connection refused, request timeout) → the body error is
///   "error sending request …", which matches nothing → QUIET. This is the case the fix buys.
/// - origin down (5xx) → "revocation list returned HTTP 500" matches `HTTP \d` → LOUD before and
///   after. The earlier comment listed this as rescued; it is not.
/// - body over the cap, or not UTF-8 → matches `too large` / `not UTF-8` → LOUD, unchanged.
///
/// It still matters: offline is the common case, `logger.warn` is suppressed outside dev while
/// `logger.error` is not, and that loud channel exists so a mangled `REVOCATION_PUBLIC_KEY` is
/// audible. Filling it with routine offline noise is a detection loss.
///
/// ‼️ Residual, symmetric and inherent: body-ok + signature-transport-failure still lands routine
/// network trouble in the loud channel, because "the signature is unreachable" and "the signature
/// is missing" are the same observation from here. Recorded in `dev/backlog.md` rather than fixed.
///
/// The cost of `join!` is that a failed body no longer cancels an in-flight signature fetch, so a
/// hanging `.sig` is waited out to the 15 s per-request timeout instead of returning early. That is
/// a background path with its own 1500 ms race in front of it; correctness of the one detection
/// channel is worth more than an early return on a path that already lost its race.
async fn fetch_signed_pair(url: &str) -> Result<(String, String), String> {
    let client = revocation_http_client()?;
    let signature_url = format!("{url}.sig");
    let (body, signature) = tokio::join!(
        fetch_capped_text_with(&client, url, MAX_REVOCATION_BYTES, "revocation list"),
        fetch_capped_text_with(
            &client,
            &signature_url,
            MAX_REVOCATION_SIGNATURE_BYTES,
            "revocation signature",
        ),
    );
    // The body's failure takes precedence — see above. Only a body that ARRIVED can leave the
    // signature as the thing that went wrong, which is the only case that deserves the loud
    // classification.
    let body = body?;
    let signature = signature
        .map_err(|e| format!("revocation list is unsigned or its signature is unreachable: {e}"))?;
    Ok((body, signature))
}

/// Check a body against its signature and label it `verified`, or refuse it.
///
/// ‼️ Split out of `fetch_revocations` because that function is unreachable from a test — two
/// network calls guard it — and the one line that turns a checked body into `verified: true` had
/// no coverage at all. Deleting the verification call was a mutation nothing caught, and what it
/// produces is a build where every body is labelled verified: the counter is then believed
/// unconditionally, which is the disarm the `verified` flag exists to prevent.
fn verified_revocations(
    body: String,
    signature_b64: &str,
    public_key_b64: &str,
) -> Result<FetchedRevocations, String> {
    verify_revocation_signature(body.as_bytes(), signature_b64, public_key_b64)?;
    Ok(FetchedRevocations {
        body,
        verified: true,
    })
}

/// A revocation list, and whether its signature was checked.
///
/// ‼️ `verified` EXISTS BECAUSE THE TWO HALVES LIVE IN DIFFERENT PROCESSES AND NOTHING BOUND
/// THEM (code review CRITICAL-1). Rust verifies the body; TypeScript compares the counter. A
/// `trusted` plugin that patches `window.__TAURI_INTERNALS__.invoke` — the transport this very
/// refresh uses, an attacker `plugin-lifecycle.ts` already models — bypasses this function
/// entirely and hands TypeScript a counter of its choosing. TypeScript had no way to tell a
/// verified body from a fabricated one, so it honoured the counter either way: one answer
/// carrying `MAX_SAFE_INTEGER` raised the floor above every counter the registry will ever
/// publish and refused every genuine list from then on.
///
/// So the counter is only believed when this says the body was checked. That is what makes
/// signature and counter a PAIR rather than two independent halves — and it means the
/// protection arms with the key, together, which is the honest behaviour.
#[derive(Debug, Clone, serde::Serialize)]
pub struct FetchedRevocations {
    pub body: String,
    pub verified: bool,
}

impl FetchedRevocations {
    fn unverified(body: String) -> Self {
        Self {
            body,
            verified: false,
        }
    }
}

/// A minisign block is a few hundred bytes; this is slack, not a budget.
const MAX_REVOCATION_SIGNATURE_BYTES: usize = 8 * 1024;

/// Fetch text with the scheme guard, a timeout and a streamed size cap.
///
/// Extracted when the signature became a second fetch needing all three: a hand-copied
/// second loop is how one of them ends up missing the cap.
async fn fetch_capped_text(url: &str, cap: usize, what: &str) -> Result<String, String> {
    fetch_capped_text_with(&revocation_http_client()?, url, cap, what).await
}

/// One client for the revocation path, so two fetches can share a connection pool.
fn revocation_http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())
}

/// The body of the fetch, over a client the caller owns.
///
/// Split from `fetch_capped_text` so `fetch_signed_pair` can hand both of its requests the SAME
/// client.
///
/// ‼️ THE SHARED CLIENT IS NOT WHAT MAKES THEM CONCURRENT, and saying it was is a false causal
/// claim the earlier version of this line made (third-round code review MEDIUM). What made the
/// pair serial was awaiting the second fetch after the first; two separate clients under `join!`
/// overlap exactly as one shared client does. What the shared client buys is a pool shared by
/// THIS pair: against an h2 origin both requests go over one connection, and over h1 the second
/// may open its own — concurrently, not after.
///
/// ‼️ AND NOTHING BEYOND THIS PAIR. The correction above claimed "the next refresh can reuse it",
/// and that is false too: `revocation_http_client` builds a client per call (`fetch_signed_pair`
/// and `fetch_capped_text`), so the pool is dropped with it. It would buy little anyway — the only
/// other caller of `refreshRevocations` is the marketplace panel opening, minutes later, past any
/// idle keep-alive.
///
/// ‼️ THE FIRST CLIENT BUILD IN A PROCESS IS EXPENSIVE IN DEBUG ONLY — and the version of this
/// note that claimed otherwise was wrong for a third time in a row. Measured in this crate:
///
/// | build | 1st client | 2nd client | loopback request |
/// |-------|-----------|------------|------------------|
/// | debug   | 1.079 s   | 0.53 ms    | 1-5 ms |
/// | release | 10.5 ms   | 0.14 ms    | <1 ms  |
///
/// So it is a one-time process-global initialisation (certificate store parsing, unoptimised),
/// not a per-client cost — and it is a **test** problem, not a product one. Test binaries are
/// debug builds, and that 1.08 s landed inside a wall-clock assertion in the concurrency test,
/// which is why that assertion is gone: it measured process start-up and could not catch what it
/// claimed to. Shipping builds are release, where 10.5 ms against
/// `REVOCATION_REFRESH_BUDGET_MS = 1500` is noise. The retracted claim was that this cost eats
/// the startup budget; it does not, and no eager-warm-up work is needed.
///
/// ‼️ The pool sharing has NO test: reverting to a client per request leaves all four tests green,
/// because the concurrency they measure comes from `join!`. Pinning it needs an h2 test fixture
/// this suite does not have.
async fn fetch_capped_text_with(
    client: &reqwest::Client,
    url: &str,
    cap: usize,
    what: &str,
) -> Result<String, String> {
    let parsed = validate_http_url(url)?;
    let mut resp = client.get(parsed).send().await.map_err(|e| e.to_string())?;
    let status = resp.status();
    if !status.is_success() {
        return Err(format!("{what} returned HTTP {status}"));
    }
    // Streamed for the same reason as `http_fetch`: reqwest imposes no response-size
    // limit, and reading the body whole would buffer it before any check could run.
    let mut buf: Vec<u8> = Vec::new();
    while let Some(chunk) = resp.chunk().await.map_err(|e| e.to_string())? {
        if buf.len() + chunk.len() > cap {
            return Err(format!("{what} too large: exceeds {cap} byte limit"));
        }
        buf.extend_from_slice(&chunk);
    }
    String::from_utf8(buf).map_err(|e| format!("{what} is not UTF-8: {e}"))
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};
    use std::time::Instant;

    use super::super::limits::MAX_PLUGIN_ARCHIVE_BYTES;
    use super::super::test_support::{
        zip_of, LIVE_INDEX, SIGNED_BODY, TEST_PUBLIC_KEY, TEST_SIGNATURE,
    };
    use super::super::*;
    use super::*;

    /// ‼️ THE CALL SITE HAD NO TEST. `verify_revocation_signature` was well covered, but the
    /// one place that turns a checked body into `verified: true` sat inside `fetch_revocations`
    /// behind two network calls — so deleting the verification line was a mutation nothing
    /// caught, and it would have shipped a build that labelled ANY body verified. Extracting
    /// the decision is what makes it reachable from a test.
    #[test]
    fn a_body_is_labelled_verified_only_after_its_signature_checks_out() {
        let ok = verified_revocations(
            String::from_utf8(SIGNED_BODY.to_vec()).unwrap(),
            TEST_SIGNATURE,
            TEST_PUBLIC_KEY,
        )
        .expect("a signature from `tauri signer` must verify");
        assert!(ok.verified, "a checked body must be labelled verified");
        assert_eq!(
            ok.body.as_bytes(),
            SIGNED_BODY,
            "the body must be handed on unaltered"
        );
        // The half that kills the mutation: without the verification call this returns Ok.
        assert!(
            verified_revocations(
                r#"{"version":1,"sequence":9,"revoked":[]}"#.to_string(),
                TEST_SIGNATURE,
                TEST_PUBLIC_KEY,
            )
            .is_err(),
            "a body the signature does not cover must never be labelled verified"
        );
        // And the skip paths must label the opposite. `verified` is a bool the TypeScript side
        // trusts a counter on, so a constructor that got it backwards would be a silent disarm.
        assert!(!FetchedRevocations::unverified("anything".to_string()).verified);
    }

    // ── Network caps, over a real socket ─────────────────────────────────────────────
    //
    // Four streaming caps and three timeouts shipped with no test of any kind, because the
    // scheme guard refuses before a request is made and everything past it needs a real
    // response. One loopback server covers THREE of the four caps — `MAX_FETCH_BYTES` is on
    // the plugin `http_fetch` path, reached through `ExtensionContext` rather than a bare
    // function, so it needs its own wiring. The SIX timeouts in this module remain untested
    // and are recorded in the backlog: the shortest is 30s, and a suite nobody will wait for
    // is worse than an honest gap.

    /// A one-shot HTTP server on loopback that will send more than it should.
    ///
    /// Hand-rolled on `std::net::TcpListener` rather than pulling in a test HTTP crate:
    /// what these caps need is a server that OVERSHOOTS, which well-behaved libraries make
    /// awkward, and a dev-dependency would have to earn its place in the `deny` job for a
    /// handful of assertions.
    fn serve_once(status: &str, body: Vec<u8>) -> String {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let header = format!(
            "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        );
        std::thread::spawn(move || {
            let Ok((mut stream, _)) = listener.accept() else {
                return;
            };
            use std::io::{Read, Write};
            // Drain the request line and headers first; writing a response to a peer that is
            // still sending can deadlock on a full socket buffer.
            let mut scratch = [0u8; 2048];
            let _ = stream.read(&mut scratch);
            // Errors ignored throughout: the client ABORTING mid-body is the pass condition
            // for the cap tests, and it reaches this thread as EPIPE.
            let _ = stream.write_all(header.as_bytes());
            let _ = stream.write_all(&body);
            let _ = stream.flush();
        });
        format!("http://{addr}/doc.json")
    }

    /// A server on ONE port that answers two requests, stalling each and recording when it was
    /// accepted.
    ///
    /// ‼️ ONE PORT, BECAUSE THE PRODUCTION ENTRY POINT DERIVES THE SIGNATURE URL. `fetch_signed_pair`
    /// appends `.sig` to the list URL, so two separate servers cannot be reached by it — and a test
    /// that instead calls `try_join!` itself proves that tokio works, not that our code is
    /// concurrent. The first version of this test did exactly that and would have passed against a
    /// fully sequential implementation.
    ///
    /// ‼️ THE ACCEPT INSTANTS ARE THE EVIDENCE, not the total elapsed time. Two requests that overlap
    /// are accepted at almost the same moment; two that queue are accepted `delay` apart. Each
    /// connection is handled on its own thread so the stall cannot serialise the accepts.
    fn serve_pair_slow(
        body: (&'static str, Vec<u8>, Duration),
        signature: (&'static str, Vec<u8>, Duration),
    ) -> (String, Arc<Mutex<Vec<Instant>>>) {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let accepted: Arc<Mutex<Vec<Instant>>> = Arc::new(Mutex::new(Vec::new()));
        let slots = Arc::clone(&accepted);
        std::thread::spawn(move || {
            for _ in 0..2 {
                let Ok((mut stream, _)) = listener.accept() else {
                    return;
                };
                slots.lock().unwrap().push(Instant::now());
                let body = body.clone();
                let signature = signature.clone();
                std::thread::spawn(move || {
                    use std::io::{Read, Write};
                    let mut scratch = [0u8; 2048];
                    let read = stream.read(&mut scratch).unwrap_or(0);
                    let request = String::from_utf8_lossy(&scratch[..read]).to_string();
                    // Which document was asked for decides the body; the `.sig` suffix is what
                    // `fetch_signed_pair` appends.
                    // ‼️ A STATUS PER PATH, so a case can make EXACTLY ONE side fail. Pointing both
                    // at a closed port made both futures fail and left the assertion to a race.
                    let (status, payload, delay) = if request.contains(".sig") {
                        signature
                    } else {
                        body
                    };
                    let header = format!(
                        "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                        payload.len()
                    );
                    std::thread::sleep(delay);
                    let _ = stream.write_all(header.as_bytes());
                    let _ = stream.write_all(&payload);
                    let _ = stream.flush();
                });
            }
        });
        (format!("http://{addr}/doc.json"), accepted)
    }

    /// A one-shot 302 to `location`, for the redirect policy.
    ///
    /// Its own helper because `serve_once` sends no headers beyond `Content-Length`, and a
    /// redirect is exactly a header. Without this the origin check would be untestable at the
    /// hop that matters: reqwest follows up to 10 redirects by default, so a compliant URL
    /// could hand the download to any host and the check would look enforced while not being.
    fn serve_redirect(location: &str) -> String {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let header =
        format!("HTTP/1.1 302 Found\r\nLocation: {location}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
        std::thread::spawn(move || {
            let Ok((mut stream, _)) = listener.accept() else {
                return;
            };
            use std::io::{Read, Write};
            let mut scratch = [0u8; 2048];
            let _ = stream.read(&mut scratch);
            let _ = stream.write_all(header.as_bytes());
            let _ = stream.flush();
        });
        format!("http://{addr}/doc.json")
    }

    #[tokio::test]
    async fn stage_plugin_refuses_an_archive_outside_the_registry_that_listed_it() {
        // ‼️ WIRED IN, not merely available. `is_within_registry` having the right answer is
        // worth nothing if the download path never asks it — the same reason the scheme guard
        // has its own wiring test next door. Nothing here reaches the network: the refusal
        // happens before the request.
        let err = stage_plugin(
            "https://evil.example/plugins/x-1.0.0.zip",
            LIVE_INDEX,
            None,
            None,
        )
        .await
        .expect_err("an off-registry archive must be refused");
        assert!(
            err.to_string()
                .contains("is not under the registry that listed it"),
            "expected the containment refusal, got: {err}"
        );
    }

    #[tokio::test]
    async fn stage_plugin_refuses_a_redirect_that_leaves_the_registry() {
        // The first hop is in-registry and compliant; the redirect is where it leaves. Served
        // over loopback so the policy really runs, rather than being reasoned about.
        let url = serve_redirect("https://evil.example/x-1.0.0.zip");
        let err = stage_plugin(&url, &url, None, None)
            .await
            .expect_err("a redirect off the registry must be refused");
        let msg = err.to_string();
        // ‼️ No `|| contains("redirect")` (code review MEDIUM-2). That disjunct matched
        // reqwest's own wrapper text for ANY custom-policy error, so the test pinned "reqwest
        // raised a redirect error" rather than "the policy refused this hop" — and it was the
        // reason the follow-half mutant above could survive. The policy's own words, or nothing.
        assert!(
            msg.contains("outside the registry that listed it"),
            "expected the policy's own refusal, got: {msg}"
        );
        // The hop it refused, not the URL we started from — `to_string()` on the reqwest error
        // names the original, which reads like connectivity.
        assert!(
            msg.contains("evil.example"),
            "the refusal must name the hop it refused: {msg}"
        );
        // ‼️ And NOT the symptom message: `Policy::stop()` would have yielded the 302 itself,
        // reported downstream as "plugin download returned HTTP 302", which describes what
        // happened and hides why it was refused.
        assert!(
            !msg.contains("returned HTTP 302"),
            "the refusal must carry its reason, not surface as a bare 302: {msg}"
        );
    }

    /// One server, two connections: a 302 to another PATH on itself, then a real body.
    ///
    /// ‼️ Needed because two `serve_once` servers get different loopback PORTS, so a redirect
    /// between them is never same-origin — a test built that way could only ever show the
    /// refusal, never the follow. Self-redirect is the only shape that exercises the
    /// permissive half on one origin.
    fn serve_self_redirect(body: Vec<u8>) -> String {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            use std::io::{Read, Write};
            let responses = [
            format!("HTTP/1.1 302 Found\r\nLocation: http://{addr}/plugins/real.zip\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").into_bytes(),
            {
                let mut r = format!(
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    body.len()
                )
                .into_bytes();
                r.extend_from_slice(&body);
                r
            },
        ];
            for response in responses {
                let Ok((mut stream, _)) = listener.accept() else {
                    return;
                };
                let mut scratch = [0u8; 2048];
                let _ = stream.read(&mut scratch);
                let _ = stream.write_all(&response);
                let _ = stream.flush();
            }
        });
        format!("http://{addr}/plugins/start.zip")
    }

    /// A server that answers every connection with a 302 to a path on itself.
    ///
    /// For the hop cap: `Policy::custom` REPLACES reqwest's default `limited(10)`, so the
    /// `> 5` bound is the only thing standing between an in-registry redirect loop and the
    /// 600-second total timeout (code review LOW-2).
    fn serve_redirect_loop() -> String {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            use std::io::{Read, Write};
            let response = format!(
            "HTTP/1.1 302 Found\r\nLocation: http://{addr}/plugins/again.zip\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
        );
            while let Ok((mut stream, _)) = listener.accept() {
                let mut scratch = [0u8; 2048];
                let _ = stream.read(&mut scratch);
                let _ = stream.write_all(response.as_bytes());
                let _ = stream.flush();
            }
        });
        format!("http://{addr}/plugins/start.zip")
    }

    #[tokio::test]
    async fn stage_plugin_gives_up_on_an_in_registry_redirect_loop() {
        // Every hop is same-origin and under the base, so containment never refuses it — the hop
        // COUNT is the only bound, and without it this spins until the total timeout.
        let url = serve_redirect_loop();
        let err = stage_plugin(&url, &url, None, None)
            .await
            .expect_err("a redirect loop must be given up on");
        assert!(
            err.to_string().contains("redirected too many times"),
            "expected the hop cap, got: {err}"
        );
    }

    #[tokio::test]
    async fn stage_plugin_follows_a_redirect_that_stays_inside_the_registry() {
        // The permissive half: pinning must not break a registry that redirects internally,
        // or the rule stops being "same registry" and becomes "no redirects", which would
        // refuse legitimate hosting without saying so.
        //
        // The proof that the hop was FOLLOWED is which error comes back: the second response
        // is not a ZIP, so it fails in extraction. A refused redirect could not reach that.
        let url = serve_self_redirect(b"not a zip".to_vec());
        let err = stage_plugin(&url, &url, None, None)
            .await
            .expect_err("a non-zip body cannot install");
        let msg = err.to_string();
        // ‼️ A POSITIVE assertion (code review HIGH-2). The three `!contains` checks this
        // replaces were all satisfied by "error following redirect", so mutating
        // `attempt.follow()` into a refusal — deleting the permissive half of the policy
        // outright — left every test in this module passing. Naming the error that can ONLY be
        // reached by taking the hop is what makes the test about following.
        assert!(
            msg.contains("ZIP extraction"),
            "the second response must have been reached, i.e. the hop taken: {msg}"
        );
        assert!(
            !msg.contains("outside the registry") && !msg.contains("returned HTTP 302"),
            "an in-registry redirect must be followed, not refused: {msg}"
        );
    }

    #[tokio::test]
    async fn fetch_registry_refuses_a_body_over_its_cap() {
        let url = serve_once("200 OK", vec![b' '; MAX_REGISTRY_BYTES + 1]);
        let err = fetch_registry(&url).await.expect_err("over the cap");
        assert!(
            err.to_string().contains("registry index too large"),
            "{err}"
        );
    }

    #[tokio::test]
    async fn the_signed_pair_is_fetched_concurrently_not_in_sequence() {
        // ‼️ THE PROPERTY IS A STARTUP BUDGET, NOT AN OPTIMISATION (security review MEDIUM-3).
        // `plugin-lifecycle.ts` waits `REVOCATION_REFRESH_BUDGET_MS` = 1500 ms and then loads plugins
        // with whatever is STORED — and a fresh install has nothing stored, so a launch that loses
        // that race runs with no revocations at all, `malicious` entries included. Two serial round
        // trips against a slow link is how it gets lost, and that cost is what arming added.
        //
        // Driven through `fetch_signed_pair`, which is the function the armed path uses.
        let delay = Duration::from_millis(600);
        let (url, accepted) = serve_pair_slow(
            ("200 OK", br#"{"version":1,"revoked":[]}"#.to_vec(), delay),
            ("200 OK", b"not a real signature".to_vec(), delay),
        );
        // ‼️ NO STOPWATCH. There was a second assertion here — `elapsed < delay * 2` — introduced as
        // a guard against "a future change that starts both requests and then serialises the
        // bodies". It cannot catch that, measured rather than argued: with `fetch_signed_pair`
        // mutated to `join!` the two `send()`s and then await the two bodies one after the other,
        // this test PASSED. `serve_pair_slow` sleeps per connection on its own thread and before
        // writing anything, so both stalls overlap no matter when the client reads, and the payload
        // is already buffered by the time a serial reader gets to it. Total elapsed is ~one stall
        // either way. Catching serialised reads would need a server that withholds the body until
        // the client reads it — this fixture cannot, so do not re-add a wall-clock assertion
        // believing that it covers the case.
        //
        // What it did catch was a fully sequential implementation, which the accept gap below
        // already kills ("602.218ms apart", verified). And it cost real breakage: in a DEBUG build
        // the first HTTP client in a process takes ~1.08 s (10.5 ms in release — see
        // `fetch_capped_text_with`), test binaries are debug, and that landed inside the timing
        // window. The test therefore failed 3/3 when run alone and passed only when a sibling
        // network test warmed the process first — red under `cargo test --exact` and under any
        // runner that gives each test its own process (nextest). The accept gap is immune to that
        // by construction: both accepts happen after the client exists.
        let (body, signature) = fetch_signed_pair(&url).await.expect("both fetches succeed");
        assert!(body.contains("revoked"), "{body}");
        assert_eq!(signature, "not a real signature");
        let instants = accepted.lock().unwrap().clone();
        assert_eq!(instants.len(), 2, "both requests must have been accepted");
        let gap = instants[1] - instants[0];
        assert!(
            gap < delay,
            "the two requests were {gap:?} apart with a {delay:?} stall each — that is serial, \
         not concurrent"
        );
    }

    #[tokio::test]
    async fn a_failing_signature_fetch_still_says_it_was_the_signature() {
        // ‼️ THE MESSAGE IS LOAD-BEARING. `revocation-client.ts` matches /signature|unsigned/ to log a
        // refresh failure LOUDLY as structural rather than quietly as offline — the distinction that
        // hid a missing ACL grant for a whole review cycle.
        //
        // ‼️ EXACTLY ONE SIDE FAILS. The first version of this pair pointed BOTH urls at a closed
        // port, so both futures failed and the assertion depended on which lost the race: it passed
        // locally and failed on CI, which is the definition of a test that proves nothing.
        let (url, _) = serve_pair_slow(
            (
                "200 OK",
                br#"{"version":1,"revoked":[]}"#.to_vec(),
                Duration::ZERO,
            ),
            (
                "404 Not Found",
                b"no signature here".to_vec(),
                Duration::ZERO,
            ),
        );
        let err = fetch_signed_pair(&url)
            .await
            .expect_err("the signature is a 404");
        assert!(
            err.contains("unsigned or its signature is unreachable"),
            "{err}"
        );
    }

    #[tokio::test]
    async fn a_failing_body_fetch_is_not_reported_as_a_signature_problem() {
        // The mirror: the list's own failure must be named, or an operator is sent to look at a
        // signature that was never the problem.
        let (url, _) = serve_pair_slow(
            (
                "500 Internal Server Error",
                b"broken".to_vec(),
                Duration::ZERO,
            ),
            ("200 OK", b"not a real signature".to_vec(), Duration::ZERO),
        );
        let err = fetch_signed_pair(&url)
            .await
            .expect_err("the list is a 500");
        assert!(
            err.contains("revocation list returned HTTP 500"),
            "the list's own failure must be named: {err}"
        );
        assert!(
            !err.contains("unsigned or its signature is unreachable"),
            "a body failure must not be labelled a signature failure: {err}"
        );
    }

    #[tokio::test]
    async fn when_both_fetches_fail_the_body_error_wins() {
        // ‼️ PRECEDENCE, AND ONLY PRECEDENCE — see the sibling case below for the classification
        // itself (third-round code review MEDIUM). Both candidate messages here contain "HTTP 500",
        // which the classifier matches either way, so this case cannot fail if the offline
        // classification breaks. It pins that the BODY's error is the one returned, which is what
        // kills the implementation that shipped in `053b75d1`.
        //
        // `logger.warn` is suppressed outside dev by a runtime `if (isDev)` in `utils/logger.ts` —
        // not compiled out, as an earlier version of this comment said; the user-visible effect is
        // the same and the mechanism was misstated.
        //
        // ‼️ THE SIGNATURE FAILS FIRST, ON PURPOSE. Pointing both at a closed port makes both fail
        // "at once" and leaves the winner to the executor — which is how the FIRST version of this
        // suite passed locally and failed on CI. Stalling the body's failure by 400 ms means
        // `try_join!` would deterministically return the signature's error, so this case kills that
        // implementation instead of merely disagreeing with it sometimes.
        let (url, _) = serve_pair_slow(
            (
                "500 Internal Server Error",
                b"broken".to_vec(),
                Duration::from_millis(400),
            ),
            (
                "500 Internal Server Error",
                b"also broken".to_vec(),
                Duration::ZERO,
            ),
        );
        let err = fetch_signed_pair(&url).await.expect_err("both fail");
        assert!(
            !err.contains("unsigned or its signature is unreachable"),
            "the body's failure must win, or offline reads as a structural signature break: {err}"
        );
        assert!(err.contains("revocation list returned HTTP 500"), "{err}");
    }

    #[tokio::test]
    async fn offline_stays_quiet_across_the_ipc_boundary() {
        // ‼️ THE PROPERTY THE PRECEDENCE EXISTS FOR, ASSERTED AGAINST THE REAL CONSUMER (third-round
        // code review MEDIUM). The sibling case above pins that the BODY's error is returned, but it
        // uses HTTP 500 on both sides — and BOTH candidate messages contain "HTTP 500", which the
        // classifier matches either way. So it cannot fail if the classification breaks. This one
        // makes both fetches fail at the TRANSPORT level, which is what offline is, and then checks
        // the message against the pattern that actually decides the log level.
        //
        // ‼️ THE PATTERN IS READ OUT OF THE TYPESCRIPT, not paraphrased. The classifier is nine
        // alternatives and the earlier comments in this file described two of them; a copy here would
        // drift the same way. Asserting the literal appears exactly once in the consumer makes a
        // change over there fail HERE, which is the only way a cross-boundary property stays true.
        const CLIENT_TS: &str = include_str!("../../../src/plugins/revocation-client.ts");
        const LOUD: &str = "not allowed|forbidden|denied|HTTP \\d|signature|public key|unsigned|too large|not UTF-8";
        assert_eq!(
            CLIENT_TS.matches(LOUD).count(),
            1,
            "the structural-failure classifier moved or changed — update this test with it"
        );

        // Bind, take the address, drop the listener: both requests are refused at connect, which is
        // deterministic under `join!` because it waits for both and returns the body's error.
        let addr = {
            let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            listener.local_addr().unwrap()
        };
        let err = fetch_signed_pair(&format!("http://{addr}/doc.json"))
            .await
            .expect_err("nothing is listening");

        let lowered = err.to_lowercase();
        for alternative in LOUD.split('|') {
            if alternative == "HTTP \\d" {
                assert!(
                    !lowered
                        .split("http ")
                        .skip(1)
                        .any(|rest| rest.starts_with(|c: char| c.is_ascii_digit())),
                    "offline must not look like an HTTP status failure: {err}"
                );
            } else {
                assert!(
                    !lowered.contains(&alternative.to_lowercase()),
                    "offline must not match the structural alternative `{alternative}`: {err}"
                );
            }
        }
    }

    #[tokio::test]
    async fn fetch_registry_admits_a_body_at_the_cap() {
        // The other side of the boundary. Without this the cap could be off by a whole
        // document and every "refuses" test above would still pass.
        let mut body = vec![b' '; MAX_REGISTRY_BYTES];
        body[..14].copy_from_slice(br#"{"plugins":[]}"#);
        let url = serve_once("200 OK", body);
        let index = fetch_registry(&url)
            .await
            .expect("exactly at the cap is legal");
        assert!(index.plugins.is_empty());
    }

    #[tokio::test]
    async fn fetch_registry_refuses_a_non_success_status() {
        let url = serve_once("404 Not Found", b"nope".to_vec());
        let err = fetch_registry(&url).await.expect_err("404 is not an index");
        // `Refused`, not `InvalidManifest` — a 404 must not be reported as a broken document,
        // because no document was received.
        assert!(
            err.to_string().contains("registry returned HTTP 404"),
            "{err}"
        );
    }

    #[tokio::test]
    async fn fetch_revocations_refuses_a_body_over_its_cap() {
        let url = serve_once("200 OK", vec![b' '; MAX_REVOCATION_BYTES + 1]);
        let err = fetch_revocations(&url).await.expect_err("over the cap");
        assert!(err.contains("revocation list too large"), "{err}");
    }

    #[tokio::test]
    async fn stage_plugin_refuses_an_archive_over_its_cap() {
        // 32 MiB over loopback, which is the whole point: this cap is reached before the
        // checksum, the manifest or the tier can say anything, so nothing downstream would
        // ever catch an unbounded download.
        let url = serve_once("200 OK", vec![0u8; MAX_PLUGIN_ARCHIVE_BYTES + 1]);
        let err = stage_plugin(&url, &url, None, None)
            .await
            .expect_err("over the cap");
        assert!(
            err.to_string().contains("plugin archive too large"),
            "{err}"
        );
    }

    #[tokio::test]
    async fn stage_plugin_refuses_a_non_success_status() {
        let url = serve_once("503 Service Unavailable", b"down".to_vec());
        let err = stage_plugin(&url, &url, None, None)
            .await
            .expect_err("503 is not an archive");
        assert!(
            err.to_string()
                .contains("plugin download returned HTTP 503"),
            "{err}"
        );
    }

    /// M5 — something has to execute the `spawn_blocking` closure.
    ///
    /// Both install tests above refuse during the DOWNLOAD, so nothing reached the relocated
    /// steps 3–6 at all: not the extraction, not the manifest checks, not the `JoinError`
    /// mapping. This serves a real, well-formed ZIP that simply has no `baram-plugin.json`,
    /// which gets past the download and the checksum and stops inside the closure — before
    /// anything writes to the user's real plugin directory, which a fully successful install
    /// would do.
    #[tokio::test]
    async fn stage_plugin_reaches_the_blocking_stage_and_reports_from_inside_it() {
        let archive = zip_of(&[("not-a-manifest.txt", b"hello")]);
        let url = serve_once("200 OK", archive);

        let err = stage_plugin(&url, &url, None, None)
            .await
            .expect_err("an archive with no manifest cannot install");

        assert!(
            err.to_string().contains("baram-plugin.json not found"),
            "expected the refusal raised inside the blocking closure, got: {err}"
        );
    }
}
