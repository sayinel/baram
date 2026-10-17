// §394 spec 0073 D12 · §7 — a plugin-rendered block in an HTML · PDF export: declarative shadow DOM
// read from the LIVE host (a clone carries no shadow root), links scrubbed inside the template, no
// `<style>` that would close itself, containment restated in the export stylesheet, settle waiting
// for it, the code-block pairing unshaken by it, and none of its chrome.
import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => `asset://localhost/${encodeURIComponent(p)}`,
  invoke: vi.fn(async () => undefined),
}));

import { createBaramExtensions } from "../../../extensions";
import {
  _resetForTest,
  flushPendingVisibility,
} from "../../../extensions/nodes/views/lazy-visible";
import { markdownToProsemirror } from "../../../pipeline/md-to-pm";
import {
  __resetCodeBlockRegistry,
  bindCodeBlockRenderer,
  claimCodeBlockLangs,
} from "../../../plugins/rendered/code-block-registry";
import { __resetRenderQueue } from "../../../plugins/rendered/render-queue";
import { __resetVisibility } from "../../../plugins/rendered/visibility";
import { isAuthoredMarkup } from "../export-authored-markup";
import { pendingHeavyBlocks } from "../export-heavy-blocks";
import { captureEditorHTML } from "../export-html";
import { stripEditingChrome } from "../export-html-chrome";
import { embedPluginBlocks } from "../export-html-plugin-blocks";
import { buildExportStylesheet } from "../export-html-styles";

declare const MockIntersectionObserver: {
  instances: Array<{ triggerIntersect: (v?: boolean) => void }>;
};

const editors: Editor[] = [];

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  __resetCodeBlockRegistry();
  __resetRenderQueue();
  __resetVisibility();
  _resetForTest();
});

function bindChart(): void {
  claimCodeBlockLangs(
    { pluginId: "p", pluginName: "Plug", tier: "trusted", version: "1" },
    ["chart"],
  );
  bindCodeBlockRenderer("p", "chart", async (source) => {
    if (source === "never") throw new Error("cannot");
    return { css: "p{color:red}", html: `<p>${source}</p>` };
  });
}

/** The LIVE shadow root of the editor's first rendered block, once its first render ended. */
async function drawnShadow(editor: Editor): Promise<ShadowRoot> {
  showAll();
  const root = editor.view.dom.querySelector(
    "[data-plugin-block]",
  ) as HTMLElement;
  await vi.waitFor(() => expect(root.dataset.renderState).toBe("done"));
  return root.querySelector(".plugin-block-host")!.shadowRoot!;
}

function editorWith(md: string): Editor {
  const editor = new Editor({
    element: document.body.appendChild(document.createElement("div")),
    extensions: createBaramExtensions(),
    content: "",
  });
  editor.commands.setContent(markdownToProsemirror(md, editor.schema).toJSON());
  editors.push(editor);
  return editor;
}

async function exported(editor: Editor): Promise<Document> {
  const html = await captureEditorHTML(editor);
  return new DOMParser().parseFromString(
    `<article>${html}</article>`,
    "text/html",
  );
}

/** Every observed element intersects; the lazy queue then runs at once. */
function showAll(): void {
  for (const io of MockIntersectionObserver.instances)
    io.triggerIntersect(true);
  flushPendingVisibility();
}

describe("captureEditorHTML with plugin blocks", () => {
  /** What fails this: reading the CLONE's host (no shadow root — the block exports as code), a
   *  code block pairing that counts a rendered block's wrapped CodeMirror (B prints another
   *  block's text), or a root left in place with its chrome. The never-drawn block falls back to
   *  an ordinary code block. (A settle without the plugin branch passes HERE — the code blocks
   *  keep the loop polling until the render lands; the next test is the one it fails.) */
  it("writes each drawn block as declarative shadow DOM and a never-drawn one as a code block", async () => {
    bindChart();
    const editor = editorWith(
      "```js\nA\n```\n\n```chart\nC\n```\n\n```js\nB\n```\n\n```chart\nnever\n```\n",
    );
    const doc = await exported(editor);
    const templates = doc.querySelectorAll(
      '.plugin-block-export > .plugin-block-export-host > template[shadowrootmode="open"]',
    );
    expect(templates).toHaveLength(1);
    const content = (templates[0] as HTMLTemplateElement).content;
    expect(content.querySelector("style")?.textContent).toBe("p{color:red}");
    expect(content.querySelector("p")?.textContent).toBe("C");
    const codes = [...doc.querySelectorAll(".code-block-export")].map(
      (el) => el.textContent ?? "",
    );
    expect(codes).toHaveLength(3);
    expect(codes[0]).toContain("A");
    expect(codes[1]).toContain("B");
    expect(codes[2]).toContain("never");
    expect(
      doc.querySelector(
        ".plugin-block-chrome, .plugin-block-error, [data-plugin-block]",
      ),
    ).toBeNull();
    expect(doc.body.textContent).not.toMatch(/Plugin · Plug|Show source/);
  });

  /** D12 — settle wakes and waits for a rendered block the reader never scrolled to, in a document
   *  with nothing else to wait for. What fails this: a settle without the `[data-plugin-block]`
   *  branch — it finds nothing pending, returns without waking anything, and the block exports as
   *  its source. */
  it("waits for a rendered block that was never on screen", async () => {
    bindChart();
    const editor = editorWith("```chart\nC\n```\n");
    expect(
      (editor.view.dom.querySelector("[data-plugin-block]") as HTMLElement)
        .dataset.renderState,
    ).toBe("pending");
    const doc = await exported(editor);
    const template = doc.querySelector(
      'template[shadowrootmode="open"]',
    ) as HTMLTemplateElement | null;
    expect(template?.content.querySelector("p")?.textContent).toBe("C");
    expect(doc.querySelector(".code-block-export")).toBeNull();
  });

  /** D12 — the trailing link scrub cannot see into a `<template>`; the pass scrubs each one. A
   *  refused href is put into the LIVE shadow root by hand here, past the sanitizer, so only the
   *  export's own pass can remove it. The pair: an allowed href stays. */
  it("scrubs a refused href inside the template and keeps an allowed one", async () => {
    bindChart();
    const editor = editorWith("```chart\nC\n```\n");
    const shadow = await drawnShadow(editor);
    // A `ShadowRoot` has no `insertAdjacentHTML`; the markup is parsed by a template instead.
    const markup = document.createElement("template");
    markup.innerHTML =
      '<a href="javascript:alert(1)">bad</a><a href="https://e.com/x">ok</a>';
    shadow.append(markup.content);
    const doc = await exported(editor);
    const content = (doc.querySelector("template") as HTMLTemplateElement)
      .content;
    const [bad, ok] = [...content.querySelectorAll("a")];
    expect(bad.textContent).toBe("bad");
    expect(bad.hasAttribute("href")).toBe(false);
    expect(ok.getAttribute("href")).toBe("https://e.com/x");
  });

  /** D12 · plan 0125 P27 ② — a `<style>` is written as raw text, so one whose text holds `</` would
   *  close itself in the exported file and let what follows parse as markup. A `<style>` carrying
   *  `</style><img src=…>` is put into the LIVE shadow root by hand, past `sanitizePluginCss`, so
   *  only the export's own check can stop it — one at the top of the root and one inside an
   *  element. What fails this: `exportOf` copying every shadow child, or checking only the top
   *  level — the reparsed template then holds an `<img>`. The pair: the renderer's own `<style>`
   *  in the same root is kept, and so is the element that held the nested one. */
  it("leaves out a style whose text would close it, and keeps the block's own style", async () => {
    bindChart();
    const editor = editorWith("```chart\nC\n```\n");
    const shadow = await drawnShadow(editor);
    const breakout = document.createElement("style");
    breakout.textContent = "</style><img src=https://e.com/top>";
    const holder = document.createElement("div");
    holder.className = "holder";
    const nested = document.createElement("style");
    nested.textContent = "</style><img src=https://e.com/nested>";
    holder.append(nested);
    shadow.append(breakout, holder);
    const doc = await exported(editor);
    const content = (doc.querySelector("template") as HTMLTemplateElement)
      .content;
    expect(content.querySelector("img")).toBeNull();
    expect(
      [...content.querySelectorAll("style")].map((s) => s.textContent),
    ).toEqual(["p{color:red}"]);
    expect(content.querySelector("p")?.textContent).toBe("C");
    expect(content.querySelector(".holder")).not.toBeNull();
  });

  /** D12 — a block in source mode (its CodeMirror wrapper inside the rendered root) does not shift
   *  the code block pairing: every ordinary block still prints its own text. What fails this: a
   *  pairing that counts the wrapped CodeMirror — B then prints the wrong text. */
  it("keeps the code block pairing when a rendered block is in source mode", async () => {
    bindChart();
    const editor = editorWith(
      "```js\nA\n```\n\n```chart\nC\n```\n\n```js\nB\n```\n",
    );
    let pos = -1;
    editor.state.doc.descendants((node, p) => {
      if (pos === -1 && node.attrs.language === "chart") pos = p;
      return pos === -1;
    });
    editor.commands.setNodeSelection(pos);
    expect(
      (editor.view.dom.querySelector("[data-plugin-block]") as HTMLElement)
        .dataset.mode,
    ).toBe("source");
    const doc = await exported(editor);
    const codes = [...doc.querySelectorAll(".code-block-export")].map(
      (el) => el.textContent ?? "",
    );
    expect(codes).toHaveLength(2);
    expect(codes[0]).toContain("A");
    expect(codes[1]).toContain("B");
  });
});

describe("the export's building blocks", () => {
  /** D12 — settle waits for a pending plugin block and not for one an HTML block wrote, nor for
   *  the CodeMirror a rendered block wraps (it is never exported). What fails this: no
   *  `[data-plugin-block]` branch (nothing is waited for), one without the authored filter (the
   *  authored block is waited for), or a code branch that counts the wrapped `.code-block-wrapper`
   *  (a "code" entry, which never settles without a CodeMirror). */
  it("waits for a pending plugin block and never for an authored one or its wrapped code", () => {
    const root = document.createElement("div");
    root.innerHTML =
      '<div data-plugin-block data-render-state="pending"><div class="code-block-wrapper"></div></div>' +
      '<div class="html-block-render"><div data-plugin-block data-render-state="pending"></div></div>';
    expect(pendingHeavyBlocks(root).map((b) => b.kind)).toEqual(["plugin"]);
    (root.firstElementChild as HTMLElement).dataset.renderState = "done";
    expect(pendingHeavyBlocks(root)).toEqual([]);
  });

  /** D12 — an authored `data-plugin-block` (an HTML block keeps `data-*`) is left exactly as
   *  written and takes no live block: the one live block goes to the real root after it. What
   *  fails this: pairing without the authored filter — the live block then replaces the authored
   *  root and the real one is left in place. */
  it("leaves an authored data-plugin-block alone and gives the live block to the real root", () => {
    const clone = document.createElement("div");
    clone.innerHTML =
      '<div class="html-block-render"><div data-plugin-block>mine</div></div>' +
      '<div data-plugin-block data-lang="chart">clone</div>';
    const live = document.createElement("div");
    live.setAttribute("data-plugin-block", "");
    live.dataset.lang = "chart";
    embedPluginBlocks(clone, [{ live, text: "source" }], isAuthoredMarkup);
    const authored = clone.querySelector(".html-block-render")!;
    expect(authored.innerHTML).toBe('<div data-plugin-block="">mine</div>');
    expect(clone.querySelectorAll("[data-plugin-block]")).toHaveLength(1);
    expect(clone.querySelector(".code-block-export")?.textContent).toContain(
      "source",
    );
  });

  /** D12 — `stripEditingChrome` removes the chrome by class (the pass above already drops it; this
   *  is the rule for a root the pass could not pair). The pair: the same class an HTML block's
   *  author wrote is content, and stays. */
  it("strips the chrome classes and keeps an authored one", () => {
    const clone = document.createElement("div");
    clone.innerHTML =
      '<div class="plugin-block-chrome">Plugin · X</div><div class="plugin-block-error">e</div><p>keep</p>' +
      '<div class="html-block-render"><div class="plugin-block-chrome">mine</div></div>';
    stripEditingChrome(clone, isAuthoredMarkup);
    expect(clone.innerHTML).toBe(
      '<p>keep</p><div class="html-block-render"><div class="plugin-block-chrome">mine</div></div>',
    );
  });

  /** D12 — the editor rules the export copies drop `contain`; the export restates it. */
  it("restates the containment in the export stylesheet", () => {
    const css = buildExportStylesheet();
    expect(css).toMatch(
      /\.plugin-block-export\s*\{[^}]*contain:\s*layout paint/,
    );
    expect(css).toMatch(/\.plugin-block-export-host\s*\{[^}]*contain:\s*paint/);
  });
});
