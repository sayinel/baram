// §380 gate 5 — reading the release asset's body (plan 0105 Task 6): never past the app's
// download cap, whatever the response declares, and never leaving a body it will not read open.
// Where the asset may come from is `community-download.test.ts`.
import type { AssetFetch } from "../../../scripts/community-download";

import { describe, expect, it } from "vitest";

import { downloadReleaseAsset } from "../../../scripts/community-download";
import { assetFetch } from "./community-gate-fixtures";

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

describe("downloadReleaseAsset — gate 5, the body", () => {
  it("cancels a redirect response's body instead of leaving it open", async () => {
    const canceled: string[] = [];
    const result = await download(
      {
        [CDN]: { bytes: BYTES, status: 200 },
        [START]: {
          body: new Uint8Array([1, 2, 3]),
          location: CDN,
          status: 302,
        },
      },
      1024,
      [],
      canceled,
    );
    expect(result.ok).toBe(true);
    expect(canceled).toEqual([START]);
  });

  it("cancels a non-200, non-redirect response's body instead of leaving it open", async () => {
    const canceled: string[] = [];
    const result = await download(
      { [START]: { body: new Uint8Array([1, 2, 3]), status: 404 } },
      1024,
      [],
      canceled,
    );
    expect(result.ok).toBe(false);
    expect(canceled).toEqual([START]);
  });

  it("cancels a 200 response's body when the declared Content-Length already refuses it", async () => {
    const canceled: string[] = [];
    const result = await download(
      {
        [CDN]: { bytes: BYTES, contentLength: 2048, status: 200 },
        [START]: { location: CDN, status: 302 },
      },
      1024,
      [],
      canceled,
    );
    expect(result.ok).toBe(false);
    expect(canceled).toEqual([CDN]);
  });

  it("refuses a 200 response with no body", async () => {
    const result = await download({
      [CDN]: { status: 200 },
      [START]: { location: CDN, status: 302 },
    });
    expect(result.ok ? "ok" : result.error).toBe("the response has no body");
  });

  it("returns a refusal, not a throw, when the body errors mid-read", async () => {
    const erroring: AssetFetch = async (requestUrl) => {
      if (requestUrl === START) {
        return {
          body: null,
          headers: { get: (name) => (name === "location" ? CDN : null) },
          status: 302,
        };
      }
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.error(new TypeError("terminated"));
        },
      });
      return { body, headers: { get: () => null }, status: 200 };
    };
    const result = await downloadReleaseAsset(START, 1024, erroring);
    expect(result.ok ? "ok" : result.error).toBe(
      "reading the asset from release-assets.githubusercontent.com failed (TypeError: terminated)",
    );
  });

  it("refuses an asset that declares more than the app downloads", async () => {
    const result = await download(
      {
        [CDN]: { bytes: BYTES, contentLength: 2048, status: 200 },
        [START]: { location: CDN, status: 302 },
      },
      1024,
    );
    expect(result.ok ? "ok" : result.error).toBe(
      "the asset is 2048 bytes, over the app's 1024-byte download limit",
    );
  });

  it("does not trust a declared Content-Length shorter than the real body", async () => {
    const result = await download(
      {
        [CDN]: { bytes: new Uint8Array(1025), contentLength: 4, status: 200 },
        [START]: { location: CDN, status: 302 },
      },
      1024,
    );
    expect(result.ok ? "ok" : result.error).toBe(
      "the asset exceeds the app's 1024-byte download limit",
    );
  });

  it("accepts a declared Content-Length exactly at the cap", async () => {
    const result = await download(
      {
        [CDN]: {
          bytes: new Uint8Array(1024),
          contentLength: 1024,
          status: 200,
        },
        [START]: { location: CDN, status: 302 },
      },
      1024,
    );
    expect(result.ok).toBe(true);
  });

  it("sums bytes across chunks rather than trusting a single one", async () => {
    // `contentLength: null` throughout: this test is about the streaming accumulation, not the
    // declared-length shortcut a real Content-Length header would take instead.
    const over = await download({
      [CDN]: {
        chunks: [new Uint8Array(400), new Uint8Array(400), new Uint8Array(400)],
        contentLength: null,
        status: 200,
      },
      [START]: { location: CDN, status: 302 },
    });
    expect(over.ok ? "ok" : over.error).toBe(
      "the asset exceeds the app's 1024-byte download limit",
    );

    // The twin: the same three-chunk shape, summing to exactly the cap, is not refused.
    const ok = await download({
      [CDN]: {
        chunks: [new Uint8Array(400), new Uint8Array(400), new Uint8Array(224)],
        contentLength: null,
        status: 200,
      },
      [START]: { location: CDN, status: 302 },
    });
    expect(ok.ok).toBe(true);
  });

  // Eight chunks, not three: the fixture's stream is Node's own `stream/web` `ReadableStream`
  // (jsdom, which backs this test environment, implements no `ReadableStream` at all), and its
  // default highWaterMark of 1 keeps `pull()` exactly one part ahead of what the reader has
  // consumed. The source's `cancel()` is reached only while a pulled-but-unread part remains —
  // once parts run out, the next `pull()` closes the stream first, and cancelling an
  // already-closed stream is a no-op. 200-byte chunks cross the 1024-byte cap on the 6th read;
  // measured with a `pull`/`cancel` trace that 6 chunks closes the stream before `cancel()` runs
  // and 7 does not, so 8 leaves a two-part margin.
  it("cancels the stream when a chunk pushes the total over the cap", async () => {
    // `contentLength: null`: a declared length over the cap is refused before any body is read
    // (and its own test covers that path) — this test wants the per-chunk streaming path, the
    // one that has to open the body to find out.
    const chunks = Array.from({ length: 8 }, () => new Uint8Array(200));
    const canceledOver: string[] = [];
    const over = await download(
      {
        [CDN]: { chunks, contentLength: null, status: 200 },
        [START]: { location: CDN, status: 302 },
      },
      1024,
      [],
      canceledOver,
    );
    expect(over.ok ? "ok" : over.error).toBe(
      "the asset exceeds the app's 1024-byte download limit",
    );
    expect(canceledOver).toEqual([CDN]);

    // The twin: the same eight-chunk shape, summing to exactly the cap, is not refused and
    // nothing is canceled.
    const okChunks = [
      ...Array.from({ length: 5 }, () => new Uint8Array(200)),
      new Uint8Array(24),
    ];
    const canceledOk: string[] = [];
    const ok = await download(
      {
        [CDN]: { chunks: okChunks, contentLength: null, status: 200 },
        [START]: { location: CDN, status: 302 },
      },
      1024,
      [],
      canceledOk,
    );
    expect(ok.ok).toBe(true);
    expect(canceledOk).toEqual([]);
  });

  it("stops reading at the cap when no length is declared, and not a byte before it", async () => {
    const routes = (size: number) => ({
      [CDN]: {
        bytes: new Uint8Array(size),
        contentLength: null,
        status: 200 as const,
      },
      [START]: { location: CDN, status: 302 as const },
    });
    const over = await download(routes(1025), 1024);
    expect(over.ok ? "ok" : over.error).toBe(
      "the asset exceeds the app's 1024-byte download limit",
    );
    expect((await download(routes(1024), 1024)).ok).toBe(true);
  });
});
