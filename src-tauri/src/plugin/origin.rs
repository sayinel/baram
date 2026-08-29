// §69 Phase D / §260 — URL validation, minisign verification, and registry origin pinning.
//
// `validate_http_url` is the scheme guard every network path in this module tree runs
// through. `registry_base` / `is_within_registry` / `redirect_within_registry` are the pinning
// rule that keeps a plugin download on the registry that listed it, including across
// redirects. `verify_revocation_signature` is the minisign check for the revocation list —
// callers hold the key and pass it in; the compiled key itself stays in `plugin/mod.rs` (see
// the comment there) because `scripts/rust-constants.ts` and two vitest tests scrape its exact
// declaration out of that file by path.
use std::collections::HashMap;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use super::limits::MAX_FETCH_BYTES;

#[derive(Debug, Clone, Deserialize)]
pub struct PluginFetchInit {
    #[serde(default)]
    pub body: Option<String>,
    #[serde(default)]
    pub headers: Option<HashMap<String, String>>,
    #[serde(default)]
    pub method: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PluginFetchResponse {
    pub body: String,
    pub headers: HashMap<String, String>,
    pub status: u16,
}

/// USER DECISION: allow only http/https; do NOT block loopback/private IPs
/// (local LLMs / dev servers are legitimate plugin fetch targets).
pub fn validate_http_url(url: &str) -> Result<reqwest::Url, String> {
    let parsed = reqwest::Url::parse(url).map_err(|e| format!("invalid URL: {e}"))?;
    match parsed.scheme() {
        "http" | "https" => Ok(parsed),
        other => Err(format!(
            "blocked URL scheme '{other}': only http/https are allowed"
        )),
    }
}

/// Verify a detached minisign signature over the revocation list.
///
/// ‼️ WHY THIS EXISTS AT ALL, stated precisely because the obvious answer is incomplete.
/// `revoked.json` has no integrity beyond TLS, and a well-formed EMPTY list is accepted and
/// replaces the stored one — that is required (a false-positive revocation must be
/// withdrawable) and it means one empty file silently disarms every client. No client-side
/// check can tell "genuinely empty" from "emptied".
///
/// ‼️ AND A SIGNATURE ALONE DOES NOT CLOSE IT. `{"version":1,"revoked":[]}` was the live
/// document for 31 hours (registry `395b914` → `aa4a218`), so signing gives that empty
/// document a valid signature that stays valid forever — replaying it clears every revocation
/// without forging anything. The counter in `RevocationList.sequence` is the other half, and
/// neither half is worth anything without the other.
///
/// Same scheme, format and crate as the updater (§206), so this is the verification path
/// tauri already exercises in production; the recipe is lifted from its `verify_signature`.
/// Both the key and the signature arrive base64-wrapped around a minisign block, which is
/// what `tauri signer` emits.
pub fn verify_revocation_signature(
    body: &[u8],
    signature_b64: &str,
    public_key_b64: &str,
) -> Result<(), String> {
    let key_text = decode_b64_text(public_key_b64, "public key")?;
    let public_key = minisign_verify::PublicKey::decode(key_text.trim())
        .map_err(|e| format!("revocation public key is unusable: {e}"))?;
    let signature_text = decode_b64_text(signature_b64, "signature")?;
    let signature = minisign_verify::Signature::decode(&signature_text)
        .map_err(|e| format!("revocation signature is unreadable: {e}"))?;
    // ‼️ `allow_legacy: false`, unlike the updater's `true`, and the first version of this
    // comment got the reason backwards. The flag is consulted ONLY for a signature that is
    // not prehashed (`minisign-verify` hashes with BLAKE2b first and falls back to raw
    // Ed25519 otherwise). `tauri signer` emits the PREHASHED form, so for our signatures the
    // flag is never read at all — which a mutation proved by flipping it with every test
    // still green. `false` therefore costs nothing and refuses the older raw form outright.
    // The updater needs `true` for signatures made by older tooling; a key issued today has
    // no such history.
    //
    // Not pinned by a test: producing a legacy signature needs the `minisign` CLI, which is
    // not available here. Said plainly rather than left as a comment claiming a guard nothing
    // checks.
    public_key
        .verify(body, &signature, false)
        .map_err(|e| format!("revocation list signature does not verify: {e}"))
}

fn decode_b64_text(value: &str, what: &str) -> Result<String, String> {
    use base64::Engine as _;
    let raw = base64::engine::general_purpose::STANDARD
        .decode(value.trim())
        .map_err(|e| format!("revocation {what} is not base64: {e}"))?;
    String::from_utf8(raw).map_err(|e| format!("revocation {what} is not UTF-8: {e}"))
}

/// The prefix a registry's own files sit under: its origin plus the DIRECTORY of its index.
///
/// ‼️ ORIGIN ALONE IS NOT ENOUGH, and the hosting we ship is the counterexample. GitHub
/// Pages serves every repository of an account from one origin, so
/// `sayinel.github.io/baram-plugins/index.json` and `sayinel.github.io/anything/evil.zip`
/// are same-origin. A rule phrased as "same host" would therefore be close to vacuous for
/// our own registry, and worse, it would look like a control while being one.
///
/// So the rule is the one `scripts/validate-registry-assets.ts` already applies at publish
/// time — same origin AND under the index's directory. The same sentence at both ends is
/// deliberate: a URL the publish gate accepts is one the runtime accepts.
///
/// Traversal in its RAW form needs no separate check: `Url` resolves `..` while parsing, so
/// `…/baram-plugins/../evil/x.zip` arrives already normalised to `/evil/x.zip` and fails the
/// prefix test. ‼️ The ENCODED form does need one and originally had none — see
/// `is_within_registry`. "Traversal needs no separate check" was false as first written, and a
/// review reproduced it against production Pages.
///
/// ‼️ AN `http://` REGISTRY IS STILL ALLOWED, and pinning does not make it trustworthy
/// (security review LOW-1): plaintext offers no integrity, so an attacker on the wire rewrites
/// the index and the archives together and the pin holds against an origin they now control.
/// Restricting `http` to loopback was considered and NOT done here — it would break a
/// self-hosted LAN registry, which is a product decision rather than part of pinning the
/// download, and there is no UI that sets this URL at all (default https, store state only).
/// Recorded in `dev/backlog.md`. What pinning DOES guarantee either way is that the archive
/// shares the index's scheme, so an https registry can never be talked down to http.
pub fn registry_base(index_url: &str) -> Result<reqwest::Url, String> {
    let mut base = validate_http_url(index_url)?;
    // ‼️ THE ONE-SEGMENT CASE FAILS OPEN IF TAKEN LITERALLY (code review MEDIUM-3).
    // `https://h/baram-plugins` — the form a browser address bar leaves you with — pops to an
    // EMPTY path, so the base collapses to the origin root and the path half of the rule
    // silently disappears, leaving exactly the origin-only rule this function opens by calling
    // close to vacuous. Every repository on that account becomes installable.
    //
    // The two cases are structurally identical (`/index.json` pops to empty too), so the only
    // signal is whether the popped segment names a DOCUMENT. `fetch_registry` parses this URL's
    // body as the index, so a registry URL always names one; a bare directory name does not, and
    // would already fail the index fetch. Refusing is therefore free, and it fails CLOSED.
    // `next_back`, not `last`: the segments iterator is double-ended, so `last` would walk the
    // whole path to reach the end (clippy::double_ended_iterator_last, denied at pre-push).
    let popped = base
        .path_segments()
        .and_then(|mut s| s.next_back())
        .unwrap_or("")
        .to_string();
    // `index.json` is a file, not a directory: drop the last segment so the prefix is the
    // directory holding it. `pop` then `push("")` leaves the trailing slash, which matters —
    // without it `/baram-plugins` would also prefix `/baram-plugins-evil/`.
    base.path_segments_mut()
        // Unreachable for http/https — a special scheme always has a path — but an `expect`
        // here would be a panic reachable from store state if that ever stopped being true.
        .map_err(|_| "registry URL cannot be a base".to_string())?
        .pop()
        .push("");
    if base.path() == "/" && !popped.contains('.') {
        return Err(format!(
            "registry URL {} names a directory rather than an index document, so the archives \
             it may serve cannot be bounded — give the full URL of the index (…/index.json)",
            shown(&base)
        ));
    }
    base.set_query(None);
    base.set_fragment(None);
    Ok(base)
}

/// A URL as it should appear in a message: origin plus path, nothing else.
///
/// ‼️ `Display` on a `Url` serialises USERINFO, password included (code review LOW-3), and
/// these strings reach a toast. It also drops the query, which the archive rule ignores anyway
/// and which is attacker-controlled text from the index (LOW-4) — the sibling publish gate
/// treats printing that field raw as a defect, and this is the Rust-side equivalent.
pub(super) fn shown(url: &reqwest::Url) -> String {
    format!("{}{}", url.origin().ascii_serialization(), url.path())
}

/// Whether `candidate` is served by the registry `base` describes.
///
/// ‼️ AN ENCODED PATH SEPARATOR IS REFUSED, NOT INTERPRETED (security review LOW-2). `Url`
/// keeps `%2f` as a literal inside a segment, so `…/baram-plugins/%2f..%2f..%2fevil/x.zip`
/// still starts with the base path and would pass — while a server that decodes `%2f` to `/`
/// before normalising `..` resolves it outside the registry entirely. That is the same defect
/// class as the publish-time bypass this week, where GitHub Pages decoded `%2e` to `.` and the
/// validator hashed a different file than users downloaded: whenever this code and the server
/// can disagree about which path a URL names, the check is worse than no check because it
/// reports success.
///
/// Refusing the spelling rather than guessing the server is the same resolution
/// `validate-registry-assets.ts` reached. `%2f` and `%5c` are the whole structural set — every
/// other escape that could matter is already normalised by the parser (`%2e%2e` is resolved to
/// `..` and collapsed while parsing), and a legitimately encoded byte like `%20` is untouched
/// by this, so it is not a ban on percent-encoding.
pub(super) fn is_within_registry(candidate: &reqwest::Url, base: &reqwest::Url) -> bool {
    let path = candidate.path();
    let lowered = path.to_ascii_lowercase();
    if lowered.contains("%2f") || lowered.contains("%5c") {
        return false;
    }
    candidate.origin() == base.origin() && path.starts_with(base.path())
}

/// Everything a `reqwest::Error` knows, including the sources `to_string()` leaves out.
///
/// Needed because a custom redirect policy's refusal is a SOURCE of the error reqwest returns,
/// not its message, so `?` alone discards the reason (code review MEDIUM-1).
pub(super) fn error_chain(err: &reqwest::Error) -> String {
    let mut parts = vec![err.to_string()];
    let mut source = std::error::Error::source(err);
    while let Some(inner) = source {
        parts.push(inner.to_string());
        source = inner.source();
    }
    parts.join(": ")
}

/// A redirect policy that cannot leave the registry.
///
/// `stop()` is deliberately not used: it yields the 3xx itself, which downstream reports as
/// "plugin download returned HTTP 302" — a message that describes the symptom and hides the
/// refusal. An error carries the reason.
pub(super) fn redirect_within_registry(base: reqwest::Url) -> reqwest::redirect::Policy {
    reqwest::redirect::Policy::custom(move |attempt| {
        if attempt.previous().len() > 5 {
            attempt.error("plugin download redirected too many times")
        } else if is_within_registry(attempt.url(), &base) {
            attempt.follow()
        } else {
            // Formatted before the move: `error` takes `attempt` by value, so the borrow from
            // `url()` cannot still be alive inside the argument.
            let target = shown(attempt.url());
            let base = shown(&base);
            attempt.error(format!(
                "plugin download redirected to {target}, outside the registry that listed it ({base})"
            ))
        }
    })
}

/// Plugin network proxy — bypasses browser CORS via a Rust-side reqwest call.
/// Enforces the http/https scheme guard, a 30s timeout, and a 10 MiB response cap.
///
/// ‼️ NOT origin-pinned, and that is correct: this is the capability-gated proxy a plugin
/// uses for its OWN network calls, where an arbitrary host is the entire point. Pinning it
/// would break every plugin that talks to an API. The pinning belongs on `stage_plugin`,
/// which fetches CODE named by an index.
pub async fn http_fetch(
    url: String,
    init: Option<PluginFetchInit>,
) -> Result<PluginFetchResponse, String> {
    let parsed = validate_http_url(&url)?;
    let init = init.unwrap_or(PluginFetchInit {
        body: None,
        headers: None,
        method: None,
    });
    let method = match init.method {
        Some(m) => {
            reqwest::Method::from_bytes(m.as_bytes()).map_err(|e| format!("invalid method: {e}"))?
        }
        None => reqwest::Method::GET,
    };
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;
    let mut req = client.request(method, parsed);
    if let Some(headers) = init.headers {
        for (k, v) in headers {
            let name = reqwest::header::HeaderName::from_bytes(k.as_bytes())
                .map_err(|e| format!("invalid header name '{k}': {e}"))?;
            let value = reqwest::header::HeaderValue::from_str(&v)
                .map_err(|e| format!("invalid header value for '{k}': {e}"))?;
            req = req.header(name, value);
        }
    }
    if let Some(body) = init.body {
        req = req.body(body);
    }
    let mut resp = req.send().await.map_err(|e| e.to_string())?;
    let status = resp.status().as_u16();
    let headers = resp
        .headers()
        .iter()
        // Non-UTF8/opaque header values decode to "" (most HTTP headers are ASCII).
        .map(|(k, v)| (k.as_str().to_string(), v.to_str().unwrap_or("").to_string()))
        .collect();
    // Stream the body incrementally so an unbounded/hostile response can never
    // buffer past MAX_FETCH_BYTES in memory before we notice — reqwest has no
    // default response-size limit, and `resp.bytes()` would read the whole
    // body before any check ran.
    let mut buf: Vec<u8> = Vec::new();
    while let Some(chunk) = resp.chunk().await.map_err(|e| e.to_string())? {
        if buf.len() + chunk.len() > MAX_FETCH_BYTES {
            return Err(format!(
                "response too large: exceeds {MAX_FETCH_BYTES} byte limit"
            ));
        }
        buf.extend_from_slice(&chunk);
    }
    let body = String::from_utf8_lossy(&buf).to_string();
    Ok(PluginFetchResponse {
        body,
        headers,
        status,
    })
}

#[cfg(test)]
mod tests {
    use super::super::test_support::{LIVE_INDEX, SIGNED_BODY, TEST_PUBLIC_KEY, TEST_SIGNATURE};
    use super::super::*;
    use super::*;

    #[test]
    fn test_validate_http_url_allows_http_and_https() {
        assert!(validate_http_url("http://localhost:11434/api").is_ok()); // loopback NOT blocked
        assert!(validate_http_url("https://api.example.com/x").is_ok());
        assert!(validate_http_url("HTTP://example.com").is_ok()); // scheme matching is case-insensitive
    }

    #[test]
    fn test_validate_http_url_rejects_non_http_schemes() {
        assert!(validate_http_url("file:///etc/passwd").is_err());
        assert!(validate_http_url("data:text/plain,hi").is_err());
        assert!(validate_http_url("ftp://host/x").is_err());
        assert!(validate_http_url("not a url").is_err());
        assert!(validate_http_url("javascript:alert(1)").is_err());
    }

    fn within(archive: &str) -> bool {
        is_within_registry(
            &validate_http_url(archive).unwrap(),
            &registry_base(LIVE_INDEX).unwrap(),
        )
    }

    #[test]
    fn the_registry_base_is_the_index_s_directory_not_the_index() {
        assert_eq!(
            registry_base(LIVE_INDEX).unwrap().as_str(),
            "https://sayinel.github.io/baram-plugins/"
        );
        // Idempotent for a URL already naming a directory, and for one at the root.
        assert_eq!(
            registry_base("https://h/dir/").unwrap().as_str(),
            "https://h/dir/"
        );
        assert_eq!(
            registry_base("https://h/index.json").unwrap().as_str(),
            "https://h/"
        );
        // A query or fragment on the index must not end up in the prefix.
        assert_eq!(
            registry_base("https://h/r/index.json?v=2#x")
                .unwrap()
                .as_str(),
            "https://h/r/"
        );
    }

    #[test]
    fn an_archive_served_by_the_registry_is_accepted() {
        assert!(within(
            "https://sayinel.github.io/baram-plugins/plugins/baram-word-count-2.0.0.zip"
        ));
    }

    #[test]
    fn a_sibling_pages_site_on_the_same_origin_is_refused() {
        // ‼️ THE CASE THAT MAKES THIS RULE NON-VACUOUS, and the reason an origin check would
        // not have been one. GitHub Pages serves every repo of an account from one origin, so
        // this URL is SAME-ORIGIN with the live index — and it is a repository anyone can
        // create under their own account.
        assert!(!within(
            "https://sayinel.github.io/evil/plugins/x-1.0.0.zip"
        ));
        // The trailing slash in the base is what stops a prefix-sibling too.
        assert!(!within(
            "https://sayinel.github.io/baram-plugins-evil/x-1.0.0.zip"
        ));
        // ‼️ The base must appear at the START of the path, not anywhere in it (code review
        // HIGH-3). Every other input in this module is refused by `starts_with` AND by
        // `contains`, so mutating the predicate to `contains` survived all ten of them — while
        // admitting exactly this: someone else's repo with our registry's name buried inside.
        assert!(!within(
            "https://sayinel.github.io/evil/baram-plugins/x-1.0.0.zip"
        ));
    }

    #[test]
    fn another_host_is_refused_however_plausible() {
        assert!(!within("https://evil.example/plugins/x-1.0.0.zip"));
        // Same path, different host: the path is not what is being trusted.
        assert!(!within(
            "https://evil.example/baram-plugins/plugins/x-1.0.0.zip"
        ));
        // A host that merely ENDS with ours — the classic suffix mistake.
        assert!(!within(
            "https://sayinel.github.io.evil.example/baram-plugins/x.zip"
        ));
    }

    #[test]
    fn traversal_is_refused_because_the_url_parser_normalises_it_first() {
        // No `..` check anywhere: `Url` resolves it while parsing, so this arrives as
        // `/evil/x-1.0.0.zip` and fails the prefix test. Same property the TypeScript
        // validator leans on.
        assert!(!within(
            "https://sayinel.github.io/baram-plugins/../evil/x-1.0.0.zip"
        ));
    }

    #[test]
    fn an_encoded_path_separator_is_refused_rather_than_interpreted() {
        // ‼️ `Url` keeps `%2f` literal inside a segment, so this DOES start with the base path
        // and would pass a plain prefix test — while a server that decodes it before resolving
        // `..` lands outside the registry. Same class as the publish-time `%2e` bypass: refuse
        // the spelling instead of predicting the server.
        assert!(!within(
            "https://sayinel.github.io/baram-plugins/%2f..%2f..%2fevil/x-1.0.0.zip"
        ));
        assert!(!within(
            "https://sayinel.github.io/baram-plugins/%2F..%2Fevil/x-1.0.0.zip"
        ));
        // Backslash too — WHATWG treats a raw `\` as `/`, so its encoded form is the same trick.
        assert!(!within(
            "https://sayinel.github.io/baram-plugins/%5c..%5cevil/x-1.0.0.zip"
        ));
        // ‼️ And NOT a ban on percent-encoding: an encoded byte that cannot change the path
        // structure is still fine, or a registry could not serve a file with a space in it.
        assert!(within(
            "https://sayinel.github.io/baram-plugins/plugins/my%20plugin-1.0.0.zip"
        ));
    }

    #[test]
    fn a_scheme_downgrade_is_refused_even_on_the_same_host() {
        // `origin()` includes the scheme, so http is not https. Worth pinning: the archive is
        // executable code, and the checksum comes from the same index an attacker on the wire
        // would be rewriting.
        assert!(!within(
            "http://sayinel.github.io/baram-plugins/plugins/x-1.0.0.zip"
        ));
    }

    /// The raw bytes inside a base64-wrapped minisign public key: 2 alg + 8 key id + 32 key.
    ///
    /// ‼️ THE GUARDS BELOW USED TO COMPARE THE WRAPPER (security review MEDIUM-4). Two base64
    /// strings that differ only in whitespace — a trailing newline inside the wrapped text, say —
    /// decode to the SAME key, so `assert_ne!` on the wrapper passed for a re-encoding of a
    /// known-bad key. Reviewer demonstrated it: the updater key re-wrapped with an extra newline
    /// slipped both guards, 106/106 green. Comparing what minisign would actually load removes
    /// the whole class rather than the one encoding.
    fn key_material(wrapped: &str) -> Vec<u8> {
        use base64::Engine as _;
        let text = decode_b64_text(wrapped, "public key").expect("wrapped key must be base64");
        let line = text
            .trim()
            .lines()
            .nth(1)
            .expect("a minisign public key has a comment line and a key line");
        base64::engine::general_purpose::STANDARD
            .decode(line.trim())
            .expect("the key line must be base64")
    }

    fn updater_public_key() -> String {
        const CONF: &str = include_str!("../../tauri.conf.json");
        serde_json::from_str::<serde_json::Value>(CONF).expect("tauri.conf.json must parse")
            ["plugins"]["updater"]["pubkey"]
            .as_str()
            .expect("the updater pubkey must be a string")
            .to_string()
    }

    #[test]
    fn the_shipped_key_is_never_another_key_this_repo_already_holds() {
        // ‼️ The failure this exists for is a paste, not an algorithm. The test private key
        // sits in a scratch directory and in this file's git history; shipping its public half
        // would mean anyone holding it can sign a revocation list for every user. Cheap guard
        // against the one mistake that turns this whole feature inside out.
        assert_ne!(
            key_material(REVOCATION_PUBLIC_KEY),
            key_material(TEST_PUBLIC_KEY),
            "the test key must never be the shipped key"
        );
        // ‼️ And never the UPDATER's key either. Two base64 minisign keys of identical shape
        // live in this repo, the workflow that signs revocations reads tauri's own
        // `TAURI_SIGNING_PRIVATE_KEY` variable names, and the arming step is a one-line paste
        // into the constant below — every condition for grabbing the wrong one. The cost is not
        // symmetric with the other paste: the updater key signs installers, so trading it for a
        // forged revocation list would buy arbitrary code on every user's machine.
        assert_ne!(
            key_material(REVOCATION_PUBLIC_KEY),
            key_material(&updater_public_key()),
            "the revocation key must never be the updater key"
        );
    }

    #[test]
    fn the_first_party_prefix_is_a_directory_under_the_registry_we_ship() {
        // A prefix without the trailing slash would match `…/baram-plugins-evil/` too — the
        // same defect the archive rule was fixed for, and worth pinning separately because
        // this constant decides WHICH registry gets verified at all.
        assert!(FIRST_PARTY_REVOCATION_PREFIX.ends_with('/'));
        assert!(registry_base(LIVE_INDEX)
            .unwrap()
            .as_str()
            .starts_with(FIRST_PARTY_REVOCATION_PREFIX));
    }

    #[test]
    fn the_signature_our_own_tooling_produces_verifies() {
        // ‼️ The point of using a REAL signature from `tauri signer` rather than a hand-built
        // fixture: it pins the format and the `allow_legacy` flag against the tool that will
        // actually sign the published list. A hand-rolled vector would pin my assumptions.
        verify_revocation_signature(SIGNED_BODY, TEST_SIGNATURE, TEST_PUBLIC_KEY)
            .expect("a signature from `tauri signer` must verify");
    }

    #[test]
    fn a_tampered_body_does_not_verify() {
        // One byte. This is the whole feature: the empty list and a list with entries differ
        // by bytes, and the signature is what makes them distinguishable.
        let tampered = br#"{"version":1,"sequence":9,"revoked":[]}"#;
        assert!(
            verify_revocation_signature(tampered, TEST_SIGNATURE, TEST_PUBLIC_KEY).is_err(),
            "a modified body must not verify"
        );
    }

    #[test]
    fn an_armed_key_must_actually_be_a_minisign_public_key() {
        // ‼️ THE PASTE FAILURES THE `assert_ne!` GUARDS DO NOT COVER (code review HIGH-2).
        // Arming is one line, and the likely slips are not "the wrong key" but a truncated
        // paste, the PRIVATE half, or newline mangling. Any of those makes every fetch fail
        // once armed — every client stops receiving revocations, permanently — so this catches
        // it in CI at the moment the constant is filled in rather than on user machines.
        //
        // ‼️ NO LONGER CONDITIONAL (security review LOW-1). While the constant was empty this
        // test was vacuous by design, and the comment here said so — but that comment outlived
        // its truth the moment this build shipped ARMED. Wrapped in `is_empty()`, a revert or a
        // bad merge that emptied the constant was caught by nothing: the fetch path just logs
        // "NOT ARMED" and accepts whatever it is handed. Users would eventually see the
        // unverified notice; CI should not need them as its detector.
        assert!(
            !REVOCATION_PUBLIC_KEY.is_empty(),
            "this build must stay ARMED — an empty key silently accepts any list"
        );
        let text = decode_b64_text(REVOCATION_PUBLIC_KEY, "public key")
            .expect("the armed key must be base64");
        minisign_verify::PublicKey::decode(text.trim())
            .expect("the armed key must be a minisign PUBLIC key");
    }

    #[test]
    fn the_shipped_key_verifies_what_our_signing_secret_actually_produced() {
        // ‼️ THE PROPERTY ARMING RESTS ON, AND UNTIL NOW ITS ONLY CHECK WAS A HUMAN (security and
        // code review MEDIUM-4). Every other guard asks whether the constant PARSES or whether it
        // differs from a known-bad key. None can catch a well-formed but WRONG key — another valid
        // minisign key, or the right key after a rotation whose private half is not the CI secret.
        // That paste compiles, passes everything, and makes every client fail verification on
        // every fetch, forever, recoverable only by another release.
        //
        // The fixtures are the pair published at arming time, FROZEN. Deliberately not
        // `registry/revoked.json`: pointing at the live file would make every future revocation
        // publish break this test until someone regenerated the signature, and the property worth
        // pinning is not "the current list verifies" but "the compiled public half matches the
        // private half our workflow signs with".
        const BODY: &[u8] = include_bytes!("testdata/revoked-at-arming.json");
        const SIG: &str = include_str!("testdata/revoked-at-arming.json.sig");
        verify_revocation_signature(BODY, SIG, REVOCATION_PUBLIC_KEY)
            .expect("the shipped key must verify the list our signing secret produced");
        // And prove the check is not vacuous — the same discipline the live verification used.
        let mut tampered = BODY.to_vec();
        tampered.push(b' ');
        assert!(
            verify_revocation_signature(&tampered, SIG, REVOCATION_PUBLIC_KEY).is_err(),
            "a tampered body must not verify, or the assertion above proves nothing"
        );
    }

    #[test]
    fn the_fetch_cap_is_the_number_the_publish_gate_scrapes() {
        // ‼️ A CROSS-LANGUAGE ANCHOR, and without it the publish gate can be lied to (security
        // re-review NEW-2). `scripts/rust-constants.ts` reads this constant out of THIS FILE'S TEXT
        // so `validate-revocations.ts` can refuse a list larger than any client will fetch. Its scan
        // asserts exactly one match, which stops a declaration being ADDED — and does nothing about
        // the real one being respelled past the pattern while a decoy keeps the count at 1:
        //
        //     /// Historically `MAX_REVOCATION_BYTES: usize = 1024 * 1024`  ← a decoy in this form
        //     const ONE_MIB: usize = 4096;
        //     const MAX_REVOCATION_BYTES: usize = ONE_MIB;                  ← letters are not [0-9_ *]
        //
        // ‼️ The decoy above is written WITHOUT its semicolon on purpose: with one, this comment is
        // itself a second match and the scrape refuses to guess. That is not a footnote — it is the
        // mechanism, and writing this test demonstrated it by accident.
        //
        // The gate would then keep publishing lists up to 1 MiB while every client refused anything
        // over 4 KiB at fetch — no revocation ever landing again, and nothing red. The key scrape
        // was already anchored this way (the frozen at-arming pair binds the compiled key and the
        // scraped one to the same signature). ‼️ THIS ANCHOR IS WEAKER THAN THAT ONE, and saying
        // otherwise flattens the difference: a signature cannot be forged, whereas this is a number,
        // and defeating it costs the decoy plus ONE literal edit right here. What it buys is a diff
        // no reviewer reads past, which is enough for a drift guard and is the honest claim. The
        // literal is
        // duplicated in `revocation-signature-verify.test.ts` deliberately: two assertions on the
        // same number in two languages is what makes a respelling contradictory rather than silent.
        assert_eq!(
            MAX_REVOCATION_BYTES,
            1024 * 1024,
            "the publish gate scrapes this literal; changing it needs the TypeScript assertion changed too"
        );
    }

    #[test]
    fn a_signature_from_another_key_does_not_verify() {
        // The updater's own public key — a real, valid minisign key that simply is not ours.
        // Verifying against it must fail, or "signed" would mean "signed by anyone". Read from
        // the config, so this is the key the app actually ships rather than a stale paste.
        assert!(
            verify_revocation_signature(SIGNED_BODY, TEST_SIGNATURE, &updater_public_key())
                .is_err(),
            "a signature must not verify under a different key"
        );
    }

    #[test]
    fn a_malformed_signature_or_key_is_an_error_rather_than_a_pass() {
        // Every failure path must be an Err. A verifier that returns Ok on garbage is worse
        // than no verifier, because everything downstream then reports success.
        for (sig, key, what) in [
            ("not base64!!", TEST_PUBLIC_KEY, "signature not base64"),
            (TEST_SIGNATURE, "not base64!!", "key not base64"),
            ("", TEST_PUBLIC_KEY, "empty signature"),
            (TEST_SIGNATURE, "", "empty key"),
            // Valid base64, but of something that is not a minisign block.
            (
                "aGVsbG8gd29ybGQK",
                TEST_PUBLIC_KEY,
                "signature is not minisign",
            ),
            (TEST_SIGNATURE, "aGVsbG8gd29ybGQK", "key is not minisign"),
        ] {
            assert!(
                verify_revocation_signature(SIGNED_BODY, sig, key).is_err(),
                "{what} must be refused"
            );
        }
        // ‼️ And the refusal has to SAY which layer rejected it. Dropping the base64 error
        // and defaulting to an empty string still ends in Err — the minisign decoder refuses
        // it one step later — so the accept/reject behaviour cannot tell the two apart, and a
        // mutation that swallowed it survived. What it destroys is the operator's ability to
        // tell "the file is not base64" from "the file is not a signature".
        let err = verify_revocation_signature(SIGNED_BODY, "not base64!!", TEST_PUBLIC_KEY)
            .expect_err("must refuse");
        assert!(err.contains("not base64"), "unhelpful refusal: {err}");
    }

    #[test]
    fn a_registry_url_the_scheme_guard_rejects_never_yields_a_base() {
        // ‼️ Renamed: this does NOT reach the cannot-be-a-base arm (code review LOW-1). Both
        // inputs die in `validate_http_url`, and for http/https `path_segments_mut()` never
        // returns Err at all — a special scheme always has a path — so that arm is unreachable
        // today and kept only so a future scheme cannot turn it into a panic. What IS worth
        // pinning is that a rejected URL produces an Err rather than a base matching everything.
        assert!(registry_base("data:text/plain,hi").is_err());
        assert!(registry_base("not a url").is_err());
    }

    #[test]
    fn a_registry_url_naming_a_directory_is_refused_rather_than_collapsing_to_the_origin() {
        // ‼️ FAILS OPEN IF ACCEPTED (code review MEDIUM-3). `https://h/baram-plugins` — what a
        // browser address bar leaves you — pops to an empty path, so the base becomes the ORIGIN
        // ROOT and the path half of the rule silently disappears. On Pages that makes every
        // repository of the account installable, which is the whole thing this rule exists to
        // stop.
        let err = registry_base("https://sayinel.github.io/baram-plugins")
            .expect_err("a directory-shaped registry URL must be refused");
        assert!(err.contains("names a directory"), "{err}");
        assert!(registry_base("https://sayinel.github.io").is_err());

        // ...but an index genuinely AT the root is legitimate: then the whole origin is the
        // registry, and `/` is the correct base rather than a collapse.
        assert_eq!(
            registry_base("https://registry.example/index.json")
                .unwrap()
                .as_str(),
            "https://registry.example/"
        );
        // And a subdirectory URL is untouched by any of this.
        assert_eq!(
            registry_base("https://h/r/index.json").unwrap().as_str(),
            "https://h/r/"
        );
    }

    #[test]
    fn a_message_never_carries_the_registry_url_s_credentials() {
        // `Display` on a `Url` serialises userinfo, password included (code review LOW-3), and
        // these strings reach a toast.
        let err = registry_base("https://user:hunter2@h/notadoc")
            .expect_err("directory-shaped, so it refuses and formats the base");
        assert!(!err.contains("hunter2"), "credentials leaked: {err}");
        assert!(!err.contains("user:"), "credentials leaked: {err}");
    }

    #[tokio::test]
    async fn stage_plugin_refuses_an_encoded_separator_before_it_downloads_anything() {
        // ‼️ WIRING for the `%2f` guard: its other test drives the predicate directly, which
        // says nothing about whether the download path consults it. Nothing here reaches the
        // network — the refusal precedes the request.
        let err = stage_plugin(
            "https://sayinel.github.io/baram-plugins/%2f..%2f..%2fevil/x-1.0.0.zip",
            LIVE_INDEX,
            None,
            None,
        )
        .await
        .expect_err("an encoded separator must be refused");
        assert!(
            err.to_string()
                .contains("is not under the registry that listed it"),
            "{err}"
        );
    }

    /// §69 — the same guard on the path that downloads third-party CODE.
    ///
    /// Asserted on the guard's own words for the reason given below: reqwest refuses a
    /// `file:` URL by itself, so `is_err()` holds with or without the guard. Nothing here
    /// reaches the network.
    #[tokio::test]
    async fn test_stage_plugin_refuses_non_http_schemes() {
        let err = stage_plugin("file:///etc/passwd", LIVE_INDEX, None, None)
            .await
            .expect_err("a file:// download URL must be refused");
        assert!(
            err.to_string().contains("blocked URL scheme 'file'"),
            "expected the scheme guard's refusal, got: {err}"
        );
    }

    /// §69 — the scheme guard is WIRED INTO `fetch_registry`, not merely available.
    ///
    /// Asserting `is_err()` here would prove nothing: reqwest rejects a `file:` URL on its
    /// own, so a `fetch_registry` with the guard deleted still fails this input — with a
    /// builder error, after constructing a client. The assertion is therefore on the
    /// guard's OWN words, which is what breaks when the call goes away. Nothing here
    /// touches the network: both paths refuse before any request is sent.
    #[tokio::test]
    async fn test_fetch_registry_refuses_non_http_schemes() {
        let err = fetch_registry("file:///etc/passwd")
            .await
            .expect_err("a file:// registry URL must be refused");
        assert!(
            err.to_string().contains("blocked URL scheme 'file'"),
            "expected the scheme guard's refusal, got: {err}"
        );
    }
}
