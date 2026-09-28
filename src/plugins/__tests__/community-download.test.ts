// §380 gate 5 — a release asset comes from exactly one place (plan 0105 Task 6). Reading its
// body within the app's cap is `community-download-body.test.ts`.
import type { AssetFetch } from "../../../scripts/community-download";

import { describe, expect, it } from "vitest";

import {
  downloadReleaseAsset,
  RELEASE_ASSET_HOSTS,
  releaseAssetUrl,
} from "../../../scripts/community-download";
import { assetFetch, SUBMISSION } from "./community-gate-fixtures";

const START =
  "https://github.com/octocat/baram-hello-counter/releases/download/v1.2.0/hello-counter-1.2.0.zip";
const CDN =
  "https://release-assets.githubusercontent.com/github-production-release-asset/1/2";
const BYTES = new Uint8Array([80, 75, 5, 6]);

const download = (
  routes: Parameters<typeof assetFetch>[0],
  cap = 1024,
  seen: string[] = [],
  canceled: string[] = [],
) => downloadReleaseAsset(START, cap, assetFetch(routes, seen, canceled));

describe("releaseAssetUrl", () => {
  it("builds github.com/<repo>/releases/download/<tag>/<asset>", () => {
    expect(releaseAssetUrl(SUBMISSION)).toBe(START);
  });

  it("percent-encodes each repo segment for defence in depth", () => {
    const hostile = {
      ...SUBMISSION,
      repo: "octocat/repo with spaces",
    };
    expect(releaseAssetUrl(hostile)).toBe(
      "https://github.com/octocat/repo%20with%20spaces/releases/download/v1.2.0/hello-counter-1.2.0.zip",
    );
  });
});

describe("downloadReleaseAsset — gate 5", () => {
  it("pins the measured host list (plan 0105 Task 1 M1)", () => {
    expect(RELEASE_ASSET_HOSTS).toEqual([
      "release-assets.githubusercontent.com",
    ]);
  });

  it("refuses a first URL whose origin is not https://github.com, and never requests it", async () => {
    // The twin: "follows github.com's one redirect" below starts at START, whose origin is
    // https://github.com, and requests it (its `seen` begins with START).
    const seen: string[] = [];
    const result = await downloadReleaseAsset(
      "https://evil.example/o/r/releases/download/v1.0.0/a.zip",
      1024,
      assetFetch({}, seen),
    );
    expect(result.ok ? "ok" : result.error).toBe(
      "the first URL's origin is https://evil.example, not https://github.com — build it with releaseAssetUrl",
    );
    expect(seen).toEqual([]);
  });

  it("refuses a timeoutMs that is not an integer from 1 to 2^31 − 1, without calling fetchImpl", async () => {
    const neverCalled: AssetFetch = () => {
      throw new Error("should not be called");
    };
    // 2^31 and 2^32 − 1 are integers `AbortSignal.timeout` accepts, and Node's timer would fire
    // after 1 ms; 2^32 is one it throws on.
    for (const bad of [
      Number.NaN,
      -1,
      0,
      1.5,
      Number.POSITIVE_INFINITY,
      2_147_483_648,
      4_294_967_295,
      4_294_967_296,
    ]) {
      const result = await downloadReleaseAsset(START, 1024, neverCalled, bad);
      expect(result.ok ? "ok" : result.error).toBe(
        `timeoutMs must be an integer from 1 to 2147483647, got ${bad}`,
      );
    }
    // The twin: the largest delay Node's timers hold.
    const fine = await downloadReleaseAsset(
      START,
      1024,
      assetFetch({ [START]: { bytes: BYTES, status: 200 } }),
      2_147_483_647,
    );
    expect(fine).toEqual({ bytes: BYTES, ok: true });
  });

  it("follows github.com's one redirect to the asset host — the twin of every refusal", async () => {
    const seen: string[] = [];
    const result = await download(
      {
        [CDN]: { bytes: BYTES, status: 200 },
        [START]: { location: CDN, status: 302 },
      },
      1024,
      seen,
    );
    expect(result).toEqual({ bytes: BYTES, ok: true });
    expect(seen).toEqual([START, CDN]);
  });

  it("refuses a redirect to any other host, and never requests it", async () => {
    const evil = "https://objects.evil.example/asset";
    const seen: string[] = [];
    const result = await download(
      {
        [START]: { location: evil, status: 302 },
        [evil]: { bytes: BYTES, status: 200 },
      },
      1024,
      seen,
    );
    expect(result).toEqual({
      error:
        "a redirect to https://objects.evil.example — only release-assets.githubusercontent.com over https is followed",
      ok: false,
    });
    expect(seen).toEqual([START]);
  });

  it("refuses a protocol-relative redirect off github.com, and never requests it", async () => {
    const seen: string[] = [];
    const result = await download(
      { [START]: { location: "//evil.example/x", status: 302 } },
      1024,
      seen,
    );
    expect(result.ok ? "ok" : result.error).toBe(
      "a redirect to https://evil.example — only release-assets.githubusercontent.com over https is followed",
    );
    expect(seen).toEqual([START]);
  });

  it("follows a relative Location on the asset host to another path on the same host", async () => {
    const other = "https://release-assets.githubusercontent.com/other";
    const result = await download({
      [CDN]: { location: "/other", status: 302 },
      [START]: { location: CDN, status: 302 },
      [other]: { bytes: BYTES, status: 200 },
    });
    expect(result).toEqual({ bytes: BYTES, ok: true });
  });

  it("refuses the right host over plain http, and never requests it", async () => {
    const plain = CDN.replace("https:", "http:");
    const seen: string[] = [];
    const result = await download(
      {
        [plain]: { bytes: BYTES, status: 200 },
        [START]: { location: plain, status: 302 },
      },
      1024,
      seen,
    );
    expect(result.ok ? "ok" : result.error).toBe(
      "a redirect to http://release-assets.githubusercontent.com — only release-assets.githubusercontent.com over https is followed",
    );
    expect(seen).toEqual([START]);
  });

  // The redirect authority check must read the WHOLE authority — URL.hostname alone drops the
  // port, and URL keeps userinfo out of hostname entirely — so a redirect naming the right host
  // but carrying a port or userinfo must still be refused, by name (spec 0058 §7.2 gate 5).
  it("refuses the right host carrying a port, and never requests it", async () => {
    const withPort =
      "https://release-assets.githubusercontent.com:8443/github-production-release-asset/1/2";
    const seen: string[] = [];
    const result = await download(
      {
        [START]: { location: withPort, status: 302 },
        [withPort]: { bytes: BYTES, status: 200 },
      },
      1024,
      seen,
    );
    expect(result.ok ? "ok" : result.error).toBe(
      "a redirect to release-assets.githubusercontent.com:8443 — a port is not accepted",
    );
    expect(seen).toEqual([START]);
  });

  it("refuses the right host carrying userinfo, and never requests it", async () => {
    const withUserinfo = CDN.replace("https://", "https://user:pw@");
    const seen: string[] = [];
    const result = await download(
      {
        [START]: { location: withUserinfo, status: 302 },
        [withUserinfo]: { bytes: BYTES, status: 200 },
      },
      1024,
      seen,
    );
    expect(result.ok ? "ok" : result.error).toBe(
      "a redirect to a URL carrying userinfo — not accepted",
    );
    expect(seen).toEqual([START]);
  });

  it("stops after three redirects, naming the count", async () => {
    const hop = (n: number) => `${CDN}?hop=${n}`;
    const routes = {
      [START]: { location: hop(1), status: 302 as const },
      [hop(1)]: { location: hop(2), status: 302 as const },
      [hop(2)]: { location: hop(3), status: 302 as const },
      [hop(3)]: { location: hop(4), status: 302 as const },
      [hop(4)]: { bytes: BYTES, status: 200 as const },
    };
    const refused = await download(routes);
    expect(refused.ok ? "ok" : refused.error).toBe("more than 3 redirects");
    // The twin: three redirects then the asset.
    expect(
      (await download({ ...routes, [hop(3)]: { bytes: BYTES, status: 200 } }))
        .ok,
    ).toBe(true);
  });

  it("refuses a redirect status with no Location header", async () => {
    const result = await download({ [START]: { status: 302 } });
    expect(result.ok ? "ok" : result.error).toBe(
      "HTTP 302 without a Location header",
    );
  });

  it("refuses a redirect to an unparseable Location", async () => {
    const result = await download({
      [START]: { location: "https://exa mple.com/", status: 302 },
    });
    expect(result.ok ? "ok" : result.error).toBe(
      "a redirect to an unparseable Location",
    );
  });

  it("refuses a missing release", async () => {
    const result = await download({});
    expect(result.ok ? "ok" : result.error).toBe(
      "HTTP 404 from github.com — the release must be public and the asset name exact",
    );
  });

  it("returns a refusal, not a throw, when fetchImpl rejects", async () => {
    const rejecting: AssetFetch = () => Promise.reject(new Error("boom"));
    const result = await downloadReleaseAsset(START, 1024, rejecting);
    expect(result.ok ? "ok" : result.error).toBe(
      "the request to github.com failed (Error: boom)",
    );
  });

  it("returns a refusal, not a hang, when the total download deadline fires", async () => {
    const hanging: AssetFetch = (_requestUrl, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => {
          reject(init.signal.reason);
        });
      });
    const result = await downloadReleaseAsset(START, 1024, hanging, 20);
    expect(result.ok ? "ok" : result.error).toBe(
      "the download timed out after 20ms",
    );
  });

  it("names the deadline, not a read failure, when it fires mid-read rather than mid-fetch", async () => {
    // Unlike the previous test, the fetch itself succeeds — the timeout fires while reading the
    // body, exercising the OTHER catch (the one around the read loop, not the one around
    // fetchImpl) to prove it also checks signal.aborted before blaming the read.
    const hangingBody: AssetFetch = (requestUrl, init) => {
      if (requestUrl === START) {
        return Promise.resolve({
          body: null,
          headers: { get: (name) => (name === "location" ? CDN : null) },
          status: 302,
        });
      }
      const body = new ReadableStream<Uint8Array>({
        pull() {
          return new Promise<void>((_resolve, reject) => {
            init.signal.addEventListener("abort", () => {
              reject(init.signal.reason);
            });
          });
        },
      });
      return Promise.resolve({
        body,
        headers: { get: () => null },
        status: 200,
      });
    };
    const result = await downloadReleaseAsset(START, 1024, hangingBody, 20);
    expect(result.ok ? "ok" : result.error).toBe(
      "the download timed out after 20ms",
    );
  });

  // What this pins, and what it does not: ONE signal object reaches every hop, so a signal
  // built fresh per hop fails it whatever the timing. It does not pin one shared BUDGET — code
  // that kept this signal but restarted a timer behind it at each hop would pass. No timing
  // test covers that: racing a partial delay against the deadline would itself be a race.
  it("passes the identical AbortSignal to every hop of a redirect chain, not a fresh one per hop", async () => {
    const signals: AbortSignal[] = [];
    const fetchImpl: AssetFetch = (requestUrl, init) => {
      signals.push(init.signal);
      if (requestUrl === START) {
        return Promise.resolve({
          body: null,
          headers: { get: (name) => (name === "location" ? CDN : null) },
          status: 302,
        });
      }
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(BYTES);
          controller.close();
        },
      });
      return Promise.resolve({
        body,
        headers: { get: () => null },
        status: 200,
      });
    };
    const result = await downloadReleaseAsset(START, 1024, fetchImpl, 20);
    expect(result.ok).toBe(true);
    expect(signals).toHaveLength(2);
    expect(signals[0]).toBe(signals[1]);
  });
});
