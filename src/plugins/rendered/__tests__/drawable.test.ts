// §394 spec 0073 D8 · D9 · §7 "계획 B" · plan 0126 P3 — the one sanitizing step a code block's render
// takes. Its behaviour was `toDrawable`'s in `render-queue.ts`, and the
// render queue's own suite still judges it through `requestRender`; these rows pin the shared function
// and that the code block path goes through it. `prepareDrawable` is wrapped in a `vi.fn` that calls
// the real one, so a call can be counted wherever it is made.
import type { RendererBinding } from "../code-block-registry";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../drawable", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../drawable")>();
  return { ...actual, prepareDrawable: vi.fn(actual.prepareDrawable) };
});

import { usePluginStore } from "../../../stores/system/plugin";
import { prepareDrawable, refusedCssMessage } from "../drawable";
import { MAX_RENDERED_HTML_BYTES } from "../limits";
import { __resetRenderQueue, requestRender } from "../render-queue";
import { PluginCssError } from "../sanitize-css";

const bytes = (text: string) => new TextEncoder().encode(text).length;

beforeEach(() => {
  __resetRenderQueue();
  vi.mocked(prepareDrawable).mockClear();
});
afterEach(() => {
  usePluginStore.setState({
    devMode: { active: false, devBuild: false, enabled: false },
  });
});

describe("prepareDrawable", () => {
  /** D8 · D9 — sanitized markup and CSS, sized by what the plugin SENT (the cache's measure). What
   *  fails this: a sanitizer left out (the script or the `!important` survives), or the size taken
   *  after sanitizing. */
  it("returns sanitized markup and CSS with the size of what was sent", () => {
    const html = "<p>x</p><script>y()</script>";
    const css = "p { color: red !important }";
    const prepared = prepareDrawable("[T]", { css, html });
    if (typeof prepared === "string") throw new Error(prepared);
    expect(prepared.bytes).toBe(bytes(html) + bytes(css));
    const holder = document.createElement("div");
    holder.append(prepared.content.fragment.cloneNode(true));
    expect(holder.innerHTML).toBe("<p>x</p>");
    expect(prepared.content.css).not.toContain("!important");
  });

  /** §6 — a malformed or over-cap result comes back as the fixed sentence, not a throw. */
  it("gives the fixed sentence for a malformed or over-cap result", () => {
    expect(prepareDrawable("[T]", 7)).toBe(
      "a renderer must return { html: string, css?: string }",
    );
    expect(
      prepareDrawable("[T]", { html: "x".repeat(MAX_RENDERED_HTML_BYTES + 1) }),
    ).toBe(`rendered output exceeds ${MAX_RENDERED_HTML_BYTES} bytes of HTML`);
  });

  /** plan 0125 P9 — refused CSS throws its own error, and the error line's sentence names the rule.
   *  What fails this: CSS dropped silently (no throw), or the sentence losing the code. */
  it("throws a PluginCssError for refused CSS, whose sentence names the rule", () => {
    let thrown: unknown;
    try {
      prepareDrawable("[T]", { css: ":host { color: red }", html: "" });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(PluginCssError);
    expect(refusedCssMessage(thrown as PluginCssError)).toBe(
      "rendered CSS was refused (selectorNotAllowed)",
    );
  });

  /** §6 — the developer-mode line starts with the owner, so a block's line names its plugin and language. */
  it("starts its developer-mode console line with the owner", () => {
    const printed = vi.spyOn(console, "info").mockImplementation(() => {});
    usePluginStore.setState({
      devMode: { active: true, devBuild: false, enabled: true },
    });
    prepareDrawable("[PluginPanel] sb:live", {
      html: "<p>x</p><script></script>",
    });
    expect(printed).toHaveBeenCalledWith(
      "[PluginPanel] sb:live: the sanitizer removed at least 1",
    );
    printed.mockRestore();
  });
});

describe("the code block path", () => {
  /** §7 B — a code block's render takes this step, once per render, named as the block's line was
   *  before the move. What fails this: the render queue keeping a copy of its own (the count stays
   *  0). */
  it("takes prepareDrawable once per render", async () => {
    const binding: RendererBinding = {
      act: async () => {},
      lang: "x",
      pluginId: "p",
      pluginName: "P",
      render: async () => ({ html: "<p>x</p>" }),
      tier: "trusted",
      version: "1.0.0",
    };
    const outcome = await requestRender(binding, "src", {
      context: null,
      lang: "x",
      path: null,
    });
    expect(outcome.kind).toBe("drawn");
    expect(vi.mocked(prepareDrawable)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(prepareDrawable)).toHaveBeenCalledWith(
      "[PluginBlock] p x",
      { html: "<p>x</p>" },
    );
  });
});
