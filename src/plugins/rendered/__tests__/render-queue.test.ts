// §394 spec 0073 D7 · §6 · §7 "렌더 수명" — counts, not timings: how often a renderer is called, and
// what an answer that arrives too late is worth.
import type { CodeBlockInfo, CodeBlockRenderer } from "../../types";
import type { RendererBinding } from "../code-block-registry";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MAX_RENDER_ERROR_CHARS, MAX_RENDERED_HTML_BYTES } from "../limits";
import {
  __configureRenderQueue,
  __resetRenderQueue,
  forgetPluginRenders,
  invalidateRenders,
  onRendersInvalidated,
  requestRender,
} from "../render-queue";

function binding(
  render: CodeBlockRenderer,
  over: Partial<RendererBinding> = {},
): RendererBinding {
  return {
    act: async () => {},
    lang: "x",
    pluginId: "p",
    pluginName: "P",
    render,
    tier: "trusted",
    version: "1.0.0",
    ...over,
  };
}

const info = (
  path: null | string = "a.md",
  context: null | string = "c1",
): CodeBlockInfo => ({
  context,
  lang: "x",
  path,
});

/** A renderer whose answers the test releases one by one. */
function deferred() {
  const calls: Array<{ resolve: (html: string) => void; source: string }> = [];
  const render: CodeBlockRenderer = (source) =>
    new Promise((resolve) => {
      calls.push({ resolve: (html) => resolve({ html }), source });
    });
  return { calls, render };
}

beforeEach(() => __resetRenderQueue());
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("requestRender — the cache", () => {
  /** What fails this: no in-flight sharing — the second request, made while the first renders,
   *  calls the renderer again — or no cache, for the third. The digest is replaced by one that
   *  settles in a microtask (the source's own bytes), so the second request meets the first while it
   *  is still pending; a real `crypto.subtle` digest settles on a later task, by which time the first
   *  answer is cached and the cache, not the sharing, answers the second (measured). */
  it("calls the renderer once per key", async () => {
    vi.spyOn(crypto.subtle, "digest").mockImplementation(
      async (_algorithm, data) => (data as Uint8Array).slice().buffer,
    );
    const { calls, render } = deferred();
    const b = binding(render);
    const pair = Promise.all([
      requestRender(b, "src", info()),
      requestRender(b, "src", info()),
    ]);
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    await Promise.resolve();
    expect(calls).toHaveLength(1);
    calls[0].resolve("<p>x</p>");
    const [one, two] = await pair;
    const three = await requestRender(b, "src", info());
    expect(calls).toHaveLength(1);
    for (const outcome of [one, two, three]) expect(outcome.kind).toBe("drawn");
  });

  /** D7 — the note path is in the key, and so is the context: the same relative path in two
   *  contexts is two notes. The pair of the row above. */
  it("calls again for another context with the same relative path, and for another source", async () => {
    const render = vi.fn(async () => ({ html: "<p>x</p>" }));
    const b = binding(render);
    await requestRender(b, "src", info("a.md", "c1"));
    await requestRender(b, "src", info("a.md", "c2"));
    await requestRender(b, "other", info("a.md", "c1"));
    expect(render).toHaveBeenCalledTimes(3);
  });

  /** D7 — a byte-bounded LRU: over the cap, the least recently used entry goes. */
  it("evicts the least recently used entry over the byte cap", async () => {
    __configureRenderQueue({ cacheBytes: 20 });
    const render = vi.fn(async (source: string) => ({
      html: `<p>${source}</p>`,
    })); // 10 bytes each
    const b = binding(render);
    await requestRender(b, "aaa", info());
    await requestRender(b, "bbb", info());
    await requestRender(b, "aaa", info()); // touch aaa
    await requestRender(b, "ccc", info()); // evicts bbb
    await requestRender(b, "aaa", info());
    expect(render).toHaveBeenCalledTimes(3);
    await requestRender(b, "bbb", info());
    expect(render).toHaveBeenCalledTimes(4);
  });
});

describe("requestRender — concurrency and the timeout", () => {
  /** D7 — two in flight per plugin; the third waits for a slot. The limit is pinned here, so a
   *  measured change to `RENDER_CONCURRENCY` (plan 0125 Task 14) does not move this row. */
  it("holds a third render until one of two finishes", async () => {
    __configureRenderQueue({ concurrency: 2 });
    const { calls, render } = deferred();
    const b = binding(render);
    const outcomes = ["1", "2", "3"].map((s) => requestRender(b, s, info()));
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    await Promise.resolve();
    expect(calls).toHaveLength(2);
    calls[0].resolve("<p>1</p>");
    await vi.waitFor(() => expect(calls).toHaveLength(3));
    calls[1].resolve("<p>2</p>");
    calls[2].resolve("<p>3</p>");
    expect((await Promise.all(outcomes)).map((o) => o.kind)).toEqual([
      "drawn",
      "drawn",
      "drawn",
    ]);
  });

  /** D7 — a timeout fails the render with a fixed sentence and frees its slot. Real timers with a
   *  short timeout: the cache key is a `crypto.subtle` digest, which fake timers cannot advance. The
   *  third source answers at once, so its own timeout never races the assertion. Two slots, pinned,
   *  so the third waits for a timed-out one. What fails this: a timeout that keeps its slot — the
   *  third never starts and the row hangs. */
  it("fails a render at the timeout and lets a waiting one start", async () => {
    __configureRenderQueue({ concurrency: 2, timeoutMs: 50 });
    const render = vi.fn((source: string) =>
      source === "3"
        ? { html: "<p>3</p>" }
        : new Promise<{ html: string }>(() => {}),
    );
    const b = binding(render as CodeBlockRenderer);
    const first = requestRender(b, "1", info());
    const second = requestRender(b, "2", info());
    const third = requestRender(b, "3", info());
    const timedOut = {
      kind: "failed",
      message: "the renderer did not answer in 0.05 s",
    };
    expect(await first).toEqual(timedOut);
    expect(await second).toEqual(timedOut);
    expect((await third).kind).toBe("drawn");
    expect(render).toHaveBeenCalledTimes(3);
  });
});

describe("epochs — an answer from before an invalidate, an unload or a disable", () => {
  /** What fails this: no epoch check — the old answer would be drawn and cached, and the
   *  re-render after `invalidate` would hit the stale cache entry. */
  it("drops and does not cache an answer that lands after invalidate", async () => {
    const { calls, render } = deferred();
    const b = binding(render);
    const before = requestRender(b, "s", info());
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    invalidateRenders("p", "x");
    calls[0].resolve("<p>old</p>");
    expect(await before).toEqual({ kind: "stale" });
    const after = requestRender(b, "s", info());
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    calls[1].resolve("<p>new</p>");
    const drawn = await after;
    expect(drawn.kind === "drawn" && drawn.content.fragment.textContent).toBe(
      "new",
    );
  });

  /** Reload and disable both forget the plugin: the same version is called again, and an answer
   *  from before is dropped. */
  it("forgets the cache and drops late answers when the plugin is unloaded", async () => {
    const render = vi.fn(async () => ({ html: "<p>x</p>" }));
    const b = binding(render);
    await requestRender(b, "s", info());
    forgetPluginRenders("p");
    await requestRender(b, "s", info());
    expect(render).toHaveBeenCalledTimes(2);
    const { calls, render: slow } = deferred();
    const pending = requestRender(binding(slow), "t", info());
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    forgetPluginRenders("p");
    calls[0].resolve("<p>late</p>");
    expect(await pending).toEqual({ kind: "stale" });
  });

  /** D7 — `invalidate` calls within the window become one notice; per-language and whole-plugin
   *  notices say which. The pair: a notice still comes, once. */
  it("coalesces invalidate notices", async () => {
    vi.useFakeTimers();
    __configureRenderQueue({ coalesceMs: 250 });
    const notices: Array<[string, null | string[]]> = [];
    onRendersInvalidated((pluginId, langs) =>
      notices.push([pluginId, langs && [...langs].sort()]),
    );
    invalidateRenders("p", "x");
    invalidateRenders("p", "y");
    await vi.advanceTimersByTimeAsync(249);
    expect(notices).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(notices).toEqual([["p", ["x", "y"]]]);
    invalidateRenders("p", "x");
    invalidateRenders("p");
    await vi.advanceTimersByTimeAsync(250);
    expect(notices[1]).toEqual(["p", null]);
  });
});

describe("what a result may be (§6)", () => {
  /** The sanitizers run on every result; a refusal is a fixed failure, not a partial draw. */
  it("sanitizes markup, fails refused CSS, over-cap HTML and a non-result, and caps a thrown message", async () => {
    const drawn = await requestRender(
      binding(async () => ({ html: "<p>ok</p><script>x()</script>" })),
      "a",
      info(),
    );
    expect(
      drawn.kind === "drawn" && drawn.content.fragment.querySelector("script"),
    ).toBeNull();
    expect(
      await requestRender(
        binding(async () => ({ css: "a{background:url(x.png)}", html: "" })),
        "b",
        info(),
      ),
    ).toEqual({
      kind: "failed",
      message: "rendered CSS was refused (resourceNotAllowed)",
    });
    expect(
      await requestRender(
        binding(async () => ({
          html: "a".repeat(MAX_RENDERED_HTML_BYTES + 1),
        })),
        "c",
        info(),
      ),
    ).toEqual({
      kind: "failed",
      message: `rendered output exceeds ${MAX_RENDERED_HTML_BYTES} bytes of HTML`,
    });
    expect(
      await requestRender(
        binding((async () => "nope") as unknown as CodeBlockRenderer),
        "d",
        info(),
      ),
    ).toEqual({
      kind: "failed",
      message: "a renderer must return { html: string, css?: string }",
    });
    const thrown = await requestRender(
      binding(() => {
        throw new Error(`bad\n${"x".repeat(500)}`);
      }),
      "e",
      info(),
    );
    expect(
      thrown.kind === "failed" && thrown.message.length,
    ).toBeLessThanOrEqual(MAX_RENDER_ERROR_CHARS);
    expect(thrown.kind === "failed" && thrown.message.includes("\n")).toBe(
      false,
    );
    // The pair of the two above: it is the renderer's own text, flattened — not a fixed sentence.
    expect(thrown.kind === "failed" && thrown.message.startsWith("bad x")).toBe(
      true,
    );
  });
});
