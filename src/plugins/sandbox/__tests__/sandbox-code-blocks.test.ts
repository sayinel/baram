import type { ClaimedLang } from "../../rendered/code-blocks-api";
// §394 spec 0073 D3 · D13 · §7 — the sandboxed tier's `ctx.codeBlocks`, run through the real client
// and session over the in-memory channel pair: a small source rides the frame, a large one is
// pulled through staging (measured in UTF-8 bytes), a result over a cap never leaves the sandbox,
// late and unknown answers are dropped, an action's target is checked, and the two tiers draw the
// same output for the same renderer.
import type { CodeBlockRenderer, SandboxContext } from "../../types";
import type { PluginOp } from "../plugin-op";

import { afterEach, describe, expect, it, vi } from "vitest";

import { promptRefusal, resetPromptGate } from "../../prompt-gate";
import {
  __resetCodeBlockRegistry,
  codeBlockRendererFor,
} from "../../rendered/code-block-registry";
import {
  claimCodeBlocks,
  dispatchRenderedAction,
  wireSandboxCodeBlocks,
} from "../../rendered/code-blocks-api";
import {
  INLINE_SOURCE_MAX_FRAME_BYTES,
  MAX_RENDER_ERROR_CHARS,
  MAX_RENDERED_HTML_BYTES,
} from "../../rendered/limits";
import { __resetRenderQueue, requestRender } from "../../rendered/render-queue";
import { createHostRequestHandler } from "../host-request-router";
import { startSandboxClient } from "../sandbox-client";
import { SandboxSession } from "../sandbox-session";
import { createChannelPair } from "./channel-pair";

const MANIFEST = {
  author: "a",
  capabilities: ["codeblocks"] as const,
  contributions: { codeBlocks: [{ lang: "chart" }, { lang: "taken" }] },
  description: "d",
  engines: { baram: ">=0.7.7" },
  id: "sb",
  license: "MIT",
  main: "index.mjs",
  name: "SB",
  trust: "sandboxed" as const,
  version: "1.0.0",
};

const INFO = { context: "ctx-1", lang: "chart", path: "notes/a.md" };

/** The claim `plugin-loader.ts` makes before the sandbox starts. */
const claim = (): ClaimedLang[] =>
  claimCodeBlocks(
    { ...MANIFEST, capabilities: [...MANIFEST.capabilities] },
    "sandboxed",
  );

/**
 * Start a sandbox whose plugin runs `activate`, wired the way `plugin-loader.ts` wires one.
 * `langs: null` is a plugin without `codeblocks` — no table in `activate`, nothing wired.
 */
async function start(
  activate: (ctx: SandboxContext) => void,
  langs: ClaimedLang[] | null = claim(),
) {
  const staged: string[] = [];
  let slot = "";
  const invalidated: Array<string | undefined> = [];
  const broker = async (op: PluginOp) => {
    if (op.kind === "source_read") return "// injected";
    if (op.kind === "staged_read") return slot;
    throw new Error(`unexpected op ${op.kind}`);
  };
  const { host, sandbox } = createChannelPair();
  startSandboxClient(sandbox, async () => ({ activate }), broker);
  // `renderSource` reads `session` when a render asks, long after this initializer has run.
  const session: SandboxSession = new SandboxSession(
    host,
    createHostRequestHandler({
      capabilities: ["codeblocks"],
      declaredSettings: [],
      declaredStatusBarIds: [],
      invalidate: (lang) => void invalidated.push(lang),
      pluginId: MANIFEST.id,
      pluginName: MANIFEST.name,
      renderSource: (id) => session.renderSource(id),
      stage: async (_pluginId, payload) => {
        staged.push(payload);
        slot = payload;
      },
    }),
  );
  await session.activate(
    MANIFEST.id,
    MANIFEST.contributions,
    langs ?? undefined,
  );
  const disposables: Array<{ dispose(): void }> = [];
  if (langs !== null)
    wireSandboxCodeBlocks(MANIFEST.id, langs, session, disposables);
  return { disposables, invalidated, sandbox, session, staged };
}

afterEach(() => {
  __resetCodeBlockRegistry();
  __resetRenderQueue();
  resetPromptGate();
  vi.useRealTimers();
});

describe("register and invalidate in the sandbox (§4 · §6 · D17)", () => {
  /** What fails this: a sandbox that registers what the host refused to claim, or a host that
   *  binds a language the sandbox never registered. The messages are the trusted tier's. */
  it("binds what activate registered, and refuses an undeclared or lost language by the same sentences", async () => {
    const errors: string[] = [];
    // `taken` was claimed by another plugin before this one loaded.
    claimCodeBlocks(
      {
        ...MANIFEST,
        capabilities: ["codeblocks"],
        contributions: { codeBlocks: [{ lang: "taken" }] },
        id: "first",
        name: "First",
      },
      "trusted",
    );
    await start((ctx) => {
      ctx.codeBlocks.register("chart", (s) => ({ html: `<p>${s}</p>` }));
      for (const lang of ["taken", "nope"]) {
        try {
          ctx.codeBlocks.register(lang, () => ({ html: "" }));
        } catch (e) {
          errors.push((e as Error).message);
        }
      }
    });
    expect(errors).toEqual([
      "codeBlocks.register: ```taken is drawn by First",
      'codeBlocks.register: "nope" is not declared in contributions.codeBlocks',
    ]);
    expect(codeBlockRendererFor("chart")?.pluginId).toBe("sb");
    expect(codeBlockRendererFor("taken")?.pluginId).not.toBe("sb");
  });

  /** P11 — `invalidate` crosses as `render_invalidate`; a lost language never leaves the sandbox. */
  it("sends invalidate for its own language and not for a lost one", async () => {
    claimCodeBlocks(
      {
        ...MANIFEST,
        capabilities: ["codeblocks"],
        contributions: { codeBlocks: [{ lang: "taken" }] },
        id: "first",
        name: "First",
      },
      "trusted",
    );
    let api!: SandboxContext["codeBlocks"];
    const { invalidated } = await start((ctx) => {
      api = ctx.codeBlocks;
    });
    api.invalidate("taken");
    api.invalidate("chart");
    api.invalidate();
    await vi.waitFor(() => expect(invalidated).toEqual(["chart", undefined]));
    expect(() => api.invalidate("nope")).toThrow(
      'codeBlocks.invalidate: "nope" is not declared',
    );
  });

  /** §4 — without `codeblocks` the sandbox's `codeBlocks` refuses like the trusted denied proxy. */
  it("refuses every call without the capability", async () => {
    let failure = "";
    await start((ctx) => {
      try {
        ctx.codeBlocks.register("chart", () => ({ html: "" }));
      } catch (e) {
        failure = (e as Error).message;
      }
    }, null);
    expect(failure).toMatch(
      /requires "codeblocks" capability to access codeBlocks\.register/,
    );
  });
});

describe("the source (D13)", () => {
  /** What fails this: always staging (two renders would fight over the one slot), or measuring
   *  `.length` — 2,500 Hangul syllables are 2,500 UTF-16 units and 7,500 UTF-8 bytes. */
  it("rides the frame when small and is pulled through staging when its bytes are large", async () => {
    const seen: string[] = [];
    const { session, staged } = await start((ctx) => {
      ctx.codeBlocks.register("chart", (source) => {
        seen.push(source);
        return { html: "<p>ok</p>" };
      });
    });
    await session.renderCodeBlock("chart", "small", INFO);
    expect(staged).toEqual([]);
    const korean = "한".repeat(2_500);
    expect(korean.length).toBeLessThan(4_096);
    expect(new TextEncoder().encode(korean).length).toBeGreaterThan(
      INLINE_SOURCE_MAX_FRAME_BYTES,
    );
    await session.renderCodeBlock("chart", korean, INFO);
    expect(staged).toEqual([korean]);
    expect(seen).toEqual(["small", korean]);
  });
});

describe("results and answers (D13 · §6)", () => {
  /** What fails this: no pre-send check — an over-cap frame would be dropped by Rust and the host
   *  would see only a timeout. The sandbox sends the fixed failure instead. */
  it("fails an over-cap result in the sandbox with the fixed sentence", async () => {
    const { session } = await start((ctx) => {
      ctx.codeBlocks.register("chart", () => ({
        html: "a".repeat(MAX_RENDERED_HTML_BYTES + 1),
      }));
    });
    await expect(session.renderCodeBlock("chart", "s", INFO)).rejects.toThrow(
      `rendered output exceeds ${MAX_RENDERED_HTML_BYTES} bytes of HTML`,
    );
  });

  /** plan 0125 P30 — the error text crosses Rust's `serde_json::Value`, which refuses a lone
   *  surrogate: a frame holding one would vanish and the host would see a timeout instead of the
   *  error. What fails this: `failure()` cutting by UTF-16 units — the first message would end on
   *  `\uD83D`, the first half of the emoji at the cut — or passing a half the renderer wrote itself.
   *  A JSON round trip in JS keeps a lone half, so the regex is the check that can fail. The pair
   *  is the row above: a short error crosses whole. */
  it("cuts a long error at a whole character and never sends a lone surrogate", async () => {
    const { session } = await start((ctx) => {
      ctx.codeBlocks.register("chart", (source) => {
        throw new Error(
          source === "cut"
            ? `${"x".repeat(MAX_RENDER_ERROR_CHARS - 1)}😀tail`
            : "half \uD83D",
        );
      });
    });
    const crossed = (source: string) =>
      session.renderCodeBlock("chart", source, INFO).then(
        () => "(drawn)",
        (err: Error) => err.message,
      );
    const cut = await crossed("cut");
    const half = await crossed("half");
    expect(cut).toBe("x".repeat(MAX_RENDER_ERROR_CHARS - 1));
    expect(half).toBe("half �");
    for (const message of [cut, half]) {
      expect(JSON.parse(JSON.stringify({ error: message })).error).toBe(
        message,
      );
      expect(message).not.toMatch(/[\uD800-\uDFFF]/u);
    }
  });

  /** What fails this: `failure()` reading `message` unguarded — the getter's throw escapes the
   *  `catch`, no frame goes and the block waits out the timeout — or `String(err)`, which shows
   *  "42" where a trusted renderer throwing 42 shows the fixed sentence. */
  it("answers a thrown value without a message as the trusted tier does", async () => {
    const getter = new Error("x");
    Object.defineProperty(getter, "message", {
      get() {
        throw new Error("getter");
      },
    });
    const renderer: CodeBlockRenderer = (source) => {
      throw source === "getter" ? getter : 42;
    };
    await start((ctx) => {
      ctx.codeBlocks.register("chart", renderer);
    });
    const failed = { kind: "failed", message: "the renderer failed" };
    for (const source of ["number", "getter"]) {
      await expect(
        requestRender(codeBlockRendererFor("chart")!, source, INFO),
      ).resolves.toEqual(failed);
    }
    await expect(
      requestRender(
        { lang: "chart", pluginId: "t", render: renderer, version: "1.0.0" },
        "number",
        INFO,
      ),
    ).resolves.toEqual(failed);
  });

  /** Unknown and late ids are dropped; the real answer still settles its own render. */
  it("ignores a renderResult or actionResult for an id it does not wait for", async () => {
    const { sandbox, session } = await start((ctx) => {
      ctx.codeBlocks.register("chart", () => ({ html: "<p>real</p>" }));
    });
    sandbox.send({
      html: "<p>forged</p>",
      id: "render-999",
      ok: true,
      type: "renderResult",
    });
    sandbox.send({ id: "action-999", ok: true, type: "actionResult" });
    await expect(session.renderCodeBlock("chart", "s", INFO)).resolves.toEqual({
      html: "<p>real</p>",
    });
  });

  /** D3 — one string API for both tiers: the same renderer draws the same sanitized markup. */
  it("draws the same output as the trusted tier for the same renderer", async () => {
    const renderer: CodeBlockRenderer = (source) => ({
      css: "p{color:red}",
      html: `<p data-note="n.md">${source}</p><script>x()</script><img src="https://e.com/p.png">`,
    });
    await start((ctx) => {
      ctx.codeBlocks.register("chart", renderer);
    });
    const sandboxed = await requestRender(
      codeBlockRendererFor("chart")!,
      "src",
      INFO,
    );
    const trusted = await requestRender(
      { lang: "chart", pluginId: "t", render: renderer, version: "1.0.0" },
      "src",
      INFO,
    );
    const html = (o: typeof trusted) => {
      if (o.kind !== "drawn") return `(${o.kind})`;
      const div = document.createElement("div");
      div.append(o.content.fragment.cloneNode(true));
      return `${o.content.css}|${div.innerHTML}`;
    };
    expect(html(sandboxed)).toBe(html(trusted));
    expect(html(trusted)).not.toMatch(/script|https:/);
  });
});

describe("actions (D11 ③ · D13 · §6)", () => {
  /** The second entrance across the boundary: rights hold while the sandbox's handler runs and end
   *  when its `actionResult` arrives — `ok: false` included, with no toast (logged). */
  it("holds prompt rights while the sandbox handles the action, and ends them on failure too", async () => {
    const during: Array<null | string> = [];
    await start((ctx) => {
      ctx.codeBlocks.register("chart", () => ({ html: "" }));
      ctx.codeBlocks.onAction((action) => {
        during.push(promptRefusal("sb"));
        if (action.action === "fail") throw new Error("handler failed");
      });
    });
    const binding = codeBlockRendererFor("chart")!;
    await dispatchRenderedAction(binding, { action: "go", ...INFO });
    await dispatchRenderedAction(binding, { action: "fail", ...INFO });
    expect(during).toEqual([null, null]);
    expect(promptRefusal("sb")).toMatch(/commands is running/);
  });

  /** D11 ③ — the trusted dispatch's rule across the boundary. What fails this: `Promise.all` in
   *  the sandbox's `act`, which answers on the first rejection and ends the rights while the slow
   *  handler still runs. The pair is the row above: rights end once everything has settled. */
  it("keeps the rights until every handler settles when one rejects first", async () => {
    let release!: () => void;
    const slow = new Promise<void>((resolve) => {
      release = resolve;
    });
    let slowStarted = false;
    await start((ctx) => {
      ctx.codeBlocks.register("chart", () => ({ html: "" }));
      ctx.codeBlocks.onAction(() => {
        throw new Error("fast");
      });
      ctx.codeBlocks.onAction(async () => {
        slowStarted = true;
        await slow;
      });
    });
    const running = dispatchRenderedAction(codeBlockRendererFor("chart")!, {
      action: "go",
      ...INFO,
    });
    await vi.waitFor(() => expect(slowStarted).toBe(true));
    // Room for a premature answer to cross the pair and settle the dispatch.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(promptRefusal("sb")).toBeNull();
    release();
    await running;
    expect(promptRefusal("sb")).toMatch(/commands is running/);
  });

  /** D13 — a target outside the two kinds is refused by the sandbox's check. */
  it("refuses an action whose target is neither a code block nor a panel", async () => {
    const { session } = await start(() => {});
    await expect(
      session.invokeAction({ kind: "nope" } as never, "x"),
    ).rejects.toThrow(/malformed action target/);
  });

  /** D13 — the action ends at `CALL_TIMEOUT_MS`, and the rights with it. */
  it("ends rights when the sandbox never answers", async () => {
    let started = false;
    await start((ctx) => {
      ctx.codeBlocks.register("chart", () => ({ html: "" }));
      ctx.codeBlocks.onAction(() => {
        started = true;
        return new Promise<void>(() => {});
      });
    });
    vi.useFakeTimers();
    const running = dispatchRenderedAction(codeBlockRendererFor("chart")!, {
      action: "go",
      ...INFO,
    });
    await vi.waitFor(() => expect(started).toBe(true));
    expect(promptRefusal("sb")).toBeNull();
    await vi.advanceTimersByTimeAsync(30_000);
    await running;
    expect(promptRefusal("sb")).toMatch(/commands is running/);
  });
});
