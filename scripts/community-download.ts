/**
 * §380 gate 5 / §381 publish step 1 — fetch a release asset from exactly one place
 * (spec 0058 §7.2): `https://github.com/<repo>/releases/download/<tag>/<asset>`, following
 * redirects only to GitHub's release-asset hosts, never past the app's own download cap.
 */
import type { Submission } from "./community-submission";

import { createHash } from "node:crypto";

/**
 * Where github.com sends a release-asset download — MEASURED, not assumed (spec 0058 §14):
 * `curl -sS -o /dev/null -D - https://github.com/sayinel/baram/releases/download/v0.7.4/…`
 * answered one 302 to this host on 2026-09-24, and plan 0105 Task 1 (M1) re-measured it
 * against a second owner's release.
 *
 * ‼️ A host missing here is REFUSED, not followed. If GitHub moves assets, submissions fail
 * closed at gate 5 until someone measures the new host the same way and adds it. The
 * alternative — follow any redirect — is a gate that downloads from wherever it is told.
 */
export const RELEASE_ASSET_HOSTS: readonly string[] = ["release-assets.githubusercontent.com"];

/**
 * §380 gate 5 — the total download deadline, matching the Rust install path's total timeout
 * (`stage_install` in `src-tauri/src/plugin/install.rs`, whose `reqwest::Client::builder()` chain
 * sets `.timeout(Duration::from_secs(600))`; the same chain's `.connect_timeout` (15 s) and
 * `.read_timeout` (30 s per read) are not mirrored here). One `AbortSignal` built from this is
 * shared across every hop of one download, so a chain of redirects cannot each get a fresh
 * budget.
 */
const DOWNLOAD_TIMEOUT_MS = 600_000;

/** The longest delay Node's timers hold: 2^31 − 1 ms. */
const MAX_TIMER_MS = 2_147_483_647;
const MAX_REDIRECTS = 3;
const REDIRECT_STATUSES = [301, 302, 303, 307, 308];

/**
 * A `fetch`-shaped function this module calls once per hop, always with `redirect: "manual"` —
 * a redirect is a value this loop reads and re-issues itself, never something `fetch` follows
 * on its own. That also means fetch's own cross-origin `Authorization`-stripping never runs
 * here: that stripping is part of `fetch`'s automatic `redirect: "follow"` handling, which this
 * loop opts out of. So it is this loop's own host allowlist, not `fetch`, standing between a
 * credential and a redirect target — an `AssetFetch` implementation must attach no credentials
 * of its own.
 */
export type AssetFetch = (
  url: string,
  init: { redirect: "manual"; signal: AbortSignal },
) => Promise<AssetResponse>;

export interface AssetResponse {
  body: null | {
    getReader(): {
      cancel(): Promise<void>;
      read(): Promise<{ done: boolean; value?: Uint8Array }>;
    };
  };
  headers: { get(name: string): null | string };
  status: number;
}

export async function downloadReleaseAsset(
  url: string,
  cap: number,
  fetchImpl: AssetFetch,
  timeoutMs: number = DOWNLOAD_TIMEOUT_MS,
): Promise<{ bytes: Uint8Array; ok: true } | { error: string; ok: false }> {
  // Refuses anything but the entry point gate 5 is defined over — build the first URL with
  // `releaseAssetUrl`, never by hand. Redirect targets are checked separately, below.
  let origin: string;
  try {
    origin = new URL(url).origin;
  } catch {
    return { error: "the first URL is not a valid URL — build it with releaseAssetUrl", ok: false };
  }
  if (origin !== "https://github.com") {
    return {
      error: `the first URL's origin is ${origin}, not https://github.com — build it with releaseAssetUrl`,
      ok: false,
    };
  }
  // `AbortSignal.timeout` throws a RangeError for anything but an integer from 0 to 2^32−1, and
  // Node's timers hold at most 2^31−1 ms: a longer delay prints a TimeoutOverflowWarning and
  // fires after 1 ms, which would read below as a timeout (Node 24.21, measured). So anything but
  // an integer from 1 to 2^31−1 is refused as a `{ ok: false }` verdict, like every other refusal
  // here, rather than thrown or misreported. Both callers (`runGate`, `publishOne`) leave it at
  // the default; only tests pass another value.
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMER_MS) {
    return { error: `timeoutMs must be an integer from 1 to ${MAX_TIMER_MS}, got ${timeoutMs}`, ok: false };
  }
  const signal = AbortSignal.timeout(timeoutMs);
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    let response: AssetResponse;
    try {
      response = await fetchImpl(current, { redirect: "manual", signal });
    } catch (err) {
      if (signal.aborted) return { error: `the download timed out after ${timeoutMs}ms`, ok: false };
      return { error: `the request to ${new URL(current).hostname} failed (${String(err)})`, ok: false };
    }
    if (REDIRECT_STATUSES.includes(response.status)) {
      // Never followed further, so its body — if it has one — is discarded here rather than
      // left open (undici README, "Garbage Collection": "it is important to always either
      // consume or cancel the response body anyway").
      await discardBody(response);
      const location = response.headers.get("location");
      if (location === null) return { error: `HTTP ${response.status} without a Location header`, ok: false };
      let next: URL;
      try {
        next = new URL(location, current);
      } catch {
        return { error: "a redirect to an unparseable Location", ok: false };
      }
      /**
       * The authority is checked in full, not just `hostname`: `URL.hostname` drops the port,
       * and `URL` keeps userinfo (`username`/`password`) out of `hostname` entirely, so a
       * redirect to `release-assets.githubusercontent.com:8443` or to
       * `user:pw@release-assets.githubusercontent.com` would pass a check that reads only
       * `protocol` and `hostname` (spec 0058 §7.2 gate 5). The redirects Task 1 M1 measured
       * carried neither; the refusal holds regardless.
       */
      if (next.port !== "") {
        return { error: `a redirect to ${next.hostname}:${next.port} — a port is not accepted`, ok: false };
      }
      if (next.username !== "" || next.password !== "") {
        return { error: "a redirect to a URL carrying userinfo — not accepted", ok: false };
      }
      if (next.protocol !== "https:" || !RELEASE_ASSET_HOSTS.includes(next.hostname)) {
        return {
          error: `a redirect to ${next.protocol}//${next.hostname} — only ${RELEASE_ASSET_HOSTS.join(", ")} over https is followed`,
          ok: false,
        };
      }
      current = next.href;
      continue;
    }
    if (response.status !== 200) {
      await discardBody(response);
      return {
        error: `HTTP ${response.status} from ${new URL(current).hostname} — the release must be public and the asset name exact`,
        ok: false,
      };
    }
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > cap) {
      await discardBody(response);
      return { error: `the asset is ${declared} bytes, over the app's ${cap}-byte download limit`, ok: false };
    }
    if (response.body === null) return { error: "the response has no body", ok: false };
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value === undefined) continue;
        total += value.length;
        if (total > cap) {
          await reader.cancel();
          return { error: `the asset exceeds the app's ${cap}-byte download limit`, ok: false };
        }
        chunks.push(value);
      }
    } catch (err) {
      try {
        await reader.cancel();
      } catch {
        // Best-effort — a refusal is already being returned below.
      }
      if (signal.aborted) return { error: `the download timed out after ${timeoutMs}ms`, ok: false };
      return { error: `reading the asset from ${new URL(current).hostname} failed (${String(err)})`, ok: false };
    }
    const bytes = new Uint8Array(total);
    let at = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, at);
      at += chunk.length;
    }
    return { bytes, ok: true };
  }
  return { error: `more than ${MAX_REDIRECTS} redirects`, ok: false };
}

/**
 * `submission.repo`'s two segments are percent-encoded defensively, even though it is a no-op on
 * a `Submission` that came from `parseSubmission`: `GITHUB_LOGIN` restricts `publisher` to
 * alphanumerics and hyphens and `REPO_NAME_RE` restricts the repo name to alphanumerics, dots,
 * underscores and hyphens (`src/plugins/community-registry.ts`, `scripts/community-submission.ts`
 * — read at the time this was written), and every character either allows is one
 * `encodeURIComponent` leaves unescaped. It is not a no-op on a `Submission` built by hand
 * outside that gate.
 */
export function releaseAssetUrl(submission: Submission): string {
  const repoPath = submission.repo.split("/").map(encodeURIComponent).join("/");
  return (
    `https://github.com/${repoPath}/releases/download/` +
    `${encodeURIComponent(submission.release.tag)}/${encodeURIComponent(submission.release.asset)}`
  );
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Consumes nothing and releases the connection, for a response this loop is not going to read:
 * a redirect (whether followed or refused), any non-200 non-redirect status, and a 200 whose
 * declared Content-Length already refuses it before the body is ever opened. Undici's README
 * ("Garbage Collection"): Node's garbage collection is "less aggressive and deterministic" than
 * a browser's, so leaving a response body neither consumed nor cancelled "can lead to excessive
 * connection usage, reduced performance ..., and even stalls or deadlocks when running out of
 * connections" — not relied on here. Best-effort: the caller already has its own verdict to
 * return regardless of whether this succeeds.
 */
async function discardBody(response: AssetResponse): Promise<void> {
  if (response.body === null) return;
  try {
    await response.body.getReader().cancel();
  } catch {
    // Best-effort — see above.
  }
}
