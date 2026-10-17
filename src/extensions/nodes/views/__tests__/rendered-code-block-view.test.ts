// §394 spec 0073 D6 · D7 · D17 · §7 — a code block whose language a plugin renderer is bound to.
// The schema does not change: the NodeView takes the branch, the registry's generation reaches
// every editor surface as a node decoration, and only the affected language's blocks are rebuilt.
// Counted, never timed (CLAUDE.md "성능 회귀 테스트는 … 카운트로").
import type {
  CodeBlockInfo,
  CodeBlockRenderer,
} from "../../../../plugins/types";
import type { RenderedCodeBlockView } from "../rendered-code-block-view";

import { Editor } from "@tiptap/core";
import { EditorState } from "@tiptap/pm/state";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createBaramExtensions } from "../../..";
import { markdownToProsemirror } from "../../../../pipeline/md-to-pm";
import { prosemirrorToMarkdown } from "../../../../pipeline/pm-to-md";
import {
  __resetEditorSurfaces,
  registerEditorSurface,
} from "../../../../plugins/editor-surfaces";
import {
  __resetCodeBlockRegistry,
  bindCodeBlockRenderer,
  claimCodeBlockLangs,
  codeBlockRendererFor,
} from "../../../../plugins/rendered/code-block-registry";
import {
  RENDERED_BLOCK_MAX_HEIGHT_PX,
  SOURCE_DEBOUNCE_MS,
} from "../../../../plugins/rendered/limits";
import {
  __resetRenderQueue,
  invalidateRenders,
  requestRender,
} from "../../../../plugins/rendered/render-queue";
import { __resetVisibility } from "../../../../plugins/rendered/visibility";
import { useEditorStore } from "../../../../stores/editor/editor";
import { markContentLoaded } from "../../../../utils/editor/programmatic-update";
import { flushPendingVisibility } from "../lazy-visible";

declare const MockIntersectionObserver: {
  instances: Array<{
    elements: Set<Element>;
    triggerIntersect: (v?: boolean) => void;
  }>;
};

const editors: Editor[] = [];

function bind(lang: string, render: CodeBlockRenderer, pluginId = "p") {
  claimCodeBlockLangs(
    { pluginId, pluginName: "Plug", tier: "trusted", version: "1.0.0" },
    [lang],
  );
  return bindCodeBlockRenderer(pluginId, lang, render);
}

function blockPos(editor: Editor, lang: string): number {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (
      found === -1 &&
      node.type.name === "codeBlock" &&
      node.attrs.language === lang
    )
      found = pos;
    return found === -1;
  });
  return found;
}

/**
 * A click as ProseMirror takes it: `mousedown` reaches `view.dom`'s listener and `mouseup` the
 * document's, which ends ProseMirror's click (`handleClickOn` · `handleClick` · `selectClickedLeaf`
 * run on `mouseup`). jsdom does no layout, so `posAtCoords` is stubbed to the block at `at`. Clicks
 * in one row take different `x`, or ProseMirror would read the second as a double click.
 */
function clickThrough(
  editor: Editor,
  target: Element,
  at: number,
  x: number,
): void {
  vi.spyOn(editor.view, "posAtCoords").mockReturnValue({ inside: at, pos: at });
  const init = {
    bubbles: true,
    button: 0,
    cancelable: true,
    clientX: x,
    clientY: 5,
    composed: true,
  };
  target.dispatchEvent(new MouseEvent("mousedown", init));
  target.dispatchEvent(new MouseEvent("mouseup", init));
}

/**
 * An editor holding `md`. `attached = false` mounts it on a `div` that is never put into `body`:
 * an editor mounted outside the document stands for an off-screen surface — a hidden keep-alive
 * editor is mounted and has NodeViews. (An editor given no element is not mounted at all — Tiptap
 * 3.31.4 makes no `EditorView` — so it would have no NodeView to rebuild.)
 */
function editorWith(md: string, attached = true): Editor {
  const element = document.createElement("div");
  const editor = new Editor({
    element: attached ? document.body.appendChild(element) : element,
    extensions: createBaramExtensions(),
    content: "",
  });
  editor.commands.setContent(markdownToProsemirror(md, editor.schema).toJSON());
  editors.push(editor);
  return editor;
}

/** The NodeView object ProseMirror holds for `dom` (`ViewDesc.spec`). */
function nodeViewOf(dom: HTMLElement): RenderedCodeBlockView {
  return (dom as unknown as { pmViewDesc: { spec: RenderedCodeBlockView } })
    .pmViewDesc.spec;
}

function rootOf(editor: Editor): HTMLElement {
  return editor.view.dom.querySelector("[data-plugin-block]") as HTMLElement;
}

/** Every observed element intersects; the lazy queue then runs at once. */
function showAll(): void {
  for (const io of MockIntersectionObserver.instances)
    io.triggerIntersect(true);
  flushPendingVisibility();
}

afterEach(() => {
  for (const editor of editors.splice(0)) {
    if (!editor.isDestroyed) editor.destroy();
  }
  __resetEditorSurfaces();
  __resetCodeBlockRegistry();
  __resetRenderQueue();
  // The module-level IntersectionObserver of `watchVisibility` would otherwise carry one test's
  // watched roots into the next.
  __resetVisibility();
  useEditorStore.getState().registerDocumentSurfaceAccess(null);
  useEditorStore.setState({ activeTabId: null, tabs: [] } as never);
});

/** Tab `id` showing `filePath`, for the rows that publish which editor holds which tab (P29). */
function tab(id: string, filePath: string) {
  return {
    contextId: "",
    filePath,
    id,
    isDirty: false,
    isPinned: false,
    title: id,
  };
}

describe("the branch (D6)", () => {
  /** What fails this: the root carrying `.code-block-wrapper` (the tables stylesheet would lower its
   *  containment, D10), a missing vim marker (P17), a closed shadow root, a body whose height is
   *  not capped from `limits.ts` (D10), or a host outside `view.dom` (`ContextMenu.tsx` leaves a
   *  right-click whose target is outside `view.dom` to the browser's own menu, plan 0125 Task 5). */
  it("draws a bound language through the plugin, in a shadow root outside the code block wrapper", async () => {
    const render = vi.fn(async (source: string) => ({
      css: "p{color:red}",
      html: `<p>${source}</p>`,
    }));
    bind("chart", render);
    const editor = editorWith("intro\n\n```chart\nA\n```\n");
    const root = rootOf(editor);
    expect(root.classList.contains("code-block-wrapper")).toBe(false);
    expect(root.hasAttribute("data-vim-suspend")).toBe(true);
    expect(root.dataset.renderState).toBe("pending");
    showAll();
    await vi.waitFor(() => expect(root.dataset.renderState).toBe("done"));
    const host = root.querySelector(".plugin-block-host") as HTMLElement;
    expect(editor.view.dom.contains(host)).toBe(true);
    expect(
      (root.querySelector(".plugin-block-body") as HTMLElement).style.maxHeight,
    ).toBe(`${RENDERED_BLOCK_MAX_HEIGHT_PX}px`);
    const shadow = host.shadowRoot;
    expect(shadow?.querySelector("p")?.textContent).toBe("A");
    expect(shadow?.querySelector("style")?.textContent).toContain("color:red");
    expect(root.querySelector(".plugin-block-source")?.textContent).toBe(
      "Plugin · Plug",
    );
    expect(render).toHaveBeenCalledTimes(1);
  });

  /** D6 — rebuilding is per language. What fails this: decorating every code block, or a
   *  `CodeBlockNodeView.update` that keeps its view when its language gains a renderer. */
  it("rebuilds only the bound language's blocks when a renderer comes and goes", () => {
    const md = Array.from({ length: 50 }, (_, i) =>
      i % 2 ? "```js\nx\n```" : "```chart\nc\n```",
    ).join("\n\n");
    const editor = editorWith(`intro\n\n${md}\n`);
    registerEditorSurface(editor);
    const js = () => [
      ...editor.view.dom.querySelectorAll(
        '.code-block-wrapper[data-language="js"]',
      ),
    ];
    const before = js();
    expect(before).toHaveLength(25);
    const registration = bind("chart", async () => ({ html: "<p>c</p>" }));
    expect(
      editor.view.dom.querySelectorAll("[data-plugin-block]"),
    ).toHaveLength(25);
    expect(js().every((el, i) => el === before[i] && el.isConnected)).toBe(
      true,
    );
    registration.dispose();
    expect(
      editor.view.dom.querySelectorAll("[data-plugin-block]"),
    ).toHaveLength(0);
    expect(
      editor.view.dom.querySelectorAll(
        '.code-block-wrapper[data-language="chart"]',
      ),
    ).toHaveLength(25);
    expect(js().every((el, i) => el === before[i])).toBe(true);
  });

  /** D6 — the generation reaches EVERY surface, a hidden keep-alive editor included: an editor
   *  mounted outside `body` stands for the off-screen surface (`editorWith`). What fails this: a
   *  registry change delivered only to the editor on screen. */
  it("rebuilds the blocks of a surface that is not on screen", () => {
    const hidden = editorWith("intro\n\n```chart\nA\n```\n", false);
    registerEditorSurface(hidden);
    bind("chart", async () => ({ html: "<p>c</p>" }));
    expect(rootOf(hidden)).not.toBeNull();
  });

  /** D6 — picking the language in the dropdown takes the same road. */
  it("turns a CodeMirror block into a rendered one when its language becomes a bound one", () => {
    bind("chart", async () => ({ html: "<p>c</p>" }));
    const editor = editorWith("intro\n\n```js\nx\n```\n");
    const pos = blockPos(editor, "js");
    editor.view.dispatch(
      editor.state.tr.setNodeMarkup(pos, undefined, { language: "chart" }),
    );
    expect(rootOf(editor)).not.toBeNull();
  });
});

describe("the document does not change (§7 왕복)", () => {
  /** What fails this: any write of the plugin's output into the document. The pair: with the
   *  plugin gone the same block is an ordinary code block with the same bytes. */
  it("serializes a rendered block byte for byte, and the same with the plugin gone", () => {
    const md = "```chart\nA\n```\n";
    const registration = bind("chart", async () => ({ html: "<p>c</p>" }));
    const editor = editorWith(md);
    registerEditorSurface(editor);
    expect(prosemirrorToMarkdown(editor.state.doc)).toBe(md);
    registration.dispose();
    expect(rootOf(editor)).toBeNull();
    expect(prosemirrorToMarkdown(editor.state.doc)).toBe(md);
  });

  /** D5 — the fence input rule types `[a-z0-9-]`. The pair: a `+` still does not. */
  it("types a language with digits and a hyphen", () => {
    const type = (text: string) => {
      const editor = editorWith("");
      editor.commands.insertContent(text);
      const end = editor.state.selection.from;
      editor.view.someProp("handleTextInput", (f) =>
        f(editor.view, end, end, " ", () => editor.state.tr),
      );
      return editor.state.doc.firstChild;
    };
    const block = type("```backlinks-v2");
    expect(block?.type.name).toBe("codeBlock");
    expect(block?.attrs.language).toBe("backlinks-v2");
    expect(type("```c++")?.type.name).toBe("paragraph");
  });
});

describe("pointer and source editing (D17)", () => {
  /** What fails this: a `stopEvent` that lets ProseMirror take a press on a link (the selection
   *  would move and source editing open instead of the link), or one that keeps a plain press
   *  (ProseMirror would never see it, so the click road below could not open source editing).
   *  This row asks `stopEvent` only; the two rows after it click through ProseMirror. */
  it("keeps a press on a link or an action for the host and gives the rest to ProseMirror", async () => {
    bind("chart", async () => ({
      html: '<a data-note="n.md">n</a><button data-action="go">g</button><p>plain</p>',
    }));
    const editor = editorWith("intro\n\n```chart\nA\n```\n");
    showAll();
    const root = rootOf(editor);
    await vi.waitFor(() => expect(root.dataset.renderState).toBe("done"));
    const view = nodeViewOf(root);
    const shadow = root.querySelector(".plugin-block-host")!.shadowRoot!;
    const stops = (target: Element): boolean => {
      let answer = false;
      root.addEventListener(
        "mousedown",
        (event) => {
          answer = view.stopEvent(event);
        },
        { once: true },
      );
      target.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, composed: true }),
      );
      return answer;
    };
    const before = editor.state.selection.toJSON();
    expect(stops(shadow.querySelector("a")!)).toBe(true);
    expect(stops(shadow.querySelector("button")!)).toBe(true);
    expect(editor.state.selection.toJSON()).toEqual(before);
    expect(stops(shadow.querySelector("p")!)).toBe(false);
  });

  /** D17 · §7 — a plain click on the output selects the block, which opens source editing. The
   *  click goes through ProseMirror's own mouse handling, which on a plain click selects a node
   *  only when it is an atom (`selectClickedLeaf`; a code block is not one) — so the road is the
   *  generation plugin's `handleClickOn`. What fails this: no such road (the block stays rendered and the selection
   *  stays in the paragraph above), or a `stopEvent` that keeps a plain press from ProseMirror. */
  it("opens source editing on a plain click on the output", async () => {
    bind("chart", async () => ({ html: "<p>plain</p>" }));
    const editor = editorWith("intro\n\n```chart\nA\n```\n");
    showAll();
    const root = rootOf(editor);
    await vi.waitFor(() => expect(root.dataset.renderState).toBe("done"));
    editor.commands.setTextSelection(1);
    const at = blockPos(editor, "chart");
    const shadow = root.querySelector(".plugin-block-host")!.shadowRoot!;
    clickThrough(editor, shadow.querySelector("p")!, at, 5);
    expect(editor.state.selection.toJSON()).toEqual({
      anchor: at,
      type: "node",
    });
    expect(root.dataset.mode).toBe("source");
  });

  /** The pair of the row above: a click on a link or an action is the host's — `stopEvent` keeps
   *  its `mousedown` from ProseMirror, so ProseMirror starts no click and `handleClickOn` never
   *  runs. What fails this: a `stopEvent` that gives such a press to ProseMirror (the click would
   *  select the block and open source editing instead of the link). */
  it("keeps a click on a link or an action from selecting the block", async () => {
    bind("chart", async () => ({
      html: '<a data-note="n.md">n</a><button data-action="go">g</button>',
    }));
    const editor = editorWith("intro\n\n```chart\nA\n```\n");
    showAll();
    const root = rootOf(editor);
    await vi.waitFor(() => expect(root.dataset.renderState).toBe("done"));
    editor.commands.setTextSelection(1);
    const at = blockPos(editor, "chart");
    const shadow = root.querySelector(".plugin-block-host")!.shadowRoot!;
    const before = editor.state.selection.toJSON();
    clickThrough(editor, shadow.querySelector("a")!, at, 5);
    clickThrough(editor, shadow.querySelector("button")!, at, 50);
    expect(editor.state.selection.toJSON()).toEqual(before);
    expect(root.dataset.mode).toBe("rendered");
  });

  /** D17 · plan 0125 P28 — the keyboard is the island's; clicks follow the pointer model. What fails
   *  this: a `stopEvent` that judges a key by the pointer rule — an Enter on a plain `<button>` of
   *  the output (no `data-action`) would reach ProseMirror's keymap and change the document at the
   *  selection, which sits in the paragraph above. The toggle is the chrome's own button. The pair
   *  is the row above: a press on plain content still goes to ProseMirror. */
  it("keeps a key pressed inside the block, on the output or the toggle, from ProseMirror", async () => {
    bind("chart", async () => ({ html: "<button>plain</button><p>text</p>" }));
    const editor = editorWith("intro\n\n```chart\nA\n```\n");
    showAll();
    const root = rootOf(editor);
    await vi.waitFor(() => expect(root.dataset.renderState).toBe("done"));
    editor.commands.setTextSelection(1);
    expect(root.dataset.mode).toBe("rendered");
    const view = nodeViewOf(root);
    const shadow = root.querySelector(".plugin-block-host")!.shadowRoot!;
    const before = editor.state.doc;
    const toggle = root.querySelector(
      ".plugin-block-toggle",
    ) as HTMLButtonElement;
    for (const target of [shadow.querySelector("button")!, toggle]) {
      let answer = false;
      root.addEventListener(
        "keydown",
        (event) => {
          answer = view.stopEvent(event);
        },
        { once: true },
      );
      target.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          composed: true,
          key: "Enter",
        }),
      );
      expect(answer).toBe(true);
    }
    expect(editor.state.doc.eq(before)).toBe(true);
  });

  /** D17 — a selected block opens source editing (the wrapped CodeMirror view); the selection
   *  leaving closes it. "Show source" keeps it open until pressed again (not saved). */
  it("opens source editing while the block is selected, and on the toggle", () => {
    bind("chart", async () => ({ html: "<p>c</p>" }));
    const editor = editorWith("intro\n\n```chart\nA\n```\n\nafter\n");
    const root = rootOf(editor);
    const wrapper = root.querySelector(".code-block-wrapper") as HTMLElement;
    expect(root.dataset.mode).toBe("rendered");
    expect(wrapper.hidden).toBe(true);
    editor.commands.setNodeSelection(blockPos(editor, "chart"));
    expect(root.dataset.mode).toBe("source");
    expect(wrapper.hidden).toBe(false);
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    expect(root.dataset.mode).toBe("rendered");
    (root.querySelector(".plugin-block-toggle") as HTMLButtonElement).click();
    expect(root.dataset.mode).toBe("source");
  });

  /** D17 — the toggle is shown only while pressing it changes what is shown, and it names what it
   *  would show. While the selection is in the block source editing is open whatever the toggle
   *  says, so the toggle is hidden; "Show source" keeps the source open after the selection leaves,
   *  until "Show rendered" is pressed. What fails this: a toggle shown while the block is selected —
   *  named from the "Show source" state alone it read "Show source" over the source and a press
   *  changed nothing on screen; named from the mode it would offer "Show rendered" and a press
   *  could not keep the block rendered (`applyMode`). Whenever the toggle is shown the two namings
   *  agree, so the row cannot tell them apart and does not try to. */
  it("offers the toggle only when it changes the view, named after what it would show", () => {
    bind("chart", async () => ({ html: "<p>c</p>" }));
    const editor = editorWith("intro\n\n```chart\nA\n```\n\nafter\n");
    const root = rootOf(editor);
    const toggle = root.querySelector(
      ".plugin-block-toggle",
    ) as HTMLButtonElement;
    const select = () =>
      editor.commands.setNodeSelection(blockPos(editor, "chart"));
    const leave = () =>
      editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    const seen = () => [
      root.dataset.mode,
      toggle.hidden ? null : toggle.textContent,
    ];
    expect(seen()).toEqual(["rendered", "Show source"]);
    select();
    expect(seen()).toEqual(["source", null]);
    leave();
    expect(seen()).toEqual(["rendered", "Show source"]);
    toggle.click();
    expect(seen()).toEqual(["source", "Show rendered"]);
    select();
    expect(seen()).toEqual(["source", null]);
    leave();
    expect(seen()).toEqual(["source", "Show rendered"]);
    toggle.click();
    expect(seen()).toEqual(["rendered", "Show source"]);
  });
});

describe("render lifetime (D7)", () => {
  /** What fails this: drawing before the block is near the viewport (a hidden tab would render),
   *  an invalidate that does not reach a visible block, or one that draws an off-screen block at
   *  once instead of when it comes into view. */
  it("draws when visible, again on invalidate, and an off-screen block when it returns", async () => {
    const render = vi.fn(async (source: string) => ({
      html: `<p>${source}</p>`,
    }));
    bind("chart", render);
    const editor = editorWith("intro\n\n```chart\nA\n```\n");
    const root = rootOf(editor);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(render).not.toHaveBeenCalled();
    showAll();
    await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(1));
    invalidateRenders("p", "chart");
    await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(2), {
      timeout: 2_000,
    });
    const observer = MockIntersectionObserver.instances.find((io) =>
      io.elements.has(root),
    )!;
    observer.triggerIntersect(false);
    invalidateRenders("p", "chart");
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(render).toHaveBeenCalledTimes(2);
    observer.triggerIntersect(true);
    await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(3));
  });

  /** D7 — source edits settle for `SOURCE_DEBOUNCE_MS` and become one redraw of the last text. */
  it("redraws once after a burst of source edits", async () => {
    const render = vi.fn(async (source: string) => ({
      html: `<p>${source}</p>`,
    }));
    bind("chart", render);
    const editor = editorWith("intro\n\n```chart\nA\n```\n");
    showAll();
    await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(1));
    const start = blockPos(editor, "chart") + 1;
    editor.view.dispatch(editor.state.tr.insertText("B", start + 1));
    editor.view.dispatch(editor.state.tr.insertText("C", start + 2));
    await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(2), {
      timeout: 2_000,
    });
    await new Promise((resolve) =>
      setTimeout(resolve, SOURCE_DEBOUNCE_MS + 100),
    );
    expect(render).toHaveBeenCalledTimes(2);
    expect(render.mock.lastCall?.[0]).toBe("ABC");
  });

  /** §6 — a failure keeps the last good result, faded, under a one-line error. */
  it("keeps the last good result faded when a redraw fails", async () => {
    let fail = false;
    bind("chart", async (source) => {
      if (fail) throw new Error("nope");
      return { html: `<p>${source}</p>` };
    });
    const editor = editorWith("intro\n\n```chart\nA\n```\n");
    showAll();
    const root = rootOf(editor);
    await vi.waitFor(() => expect(root.dataset.renderState).toBe("done"));
    fail = true;
    invalidateRenders("p", "chart");
    await vi.waitFor(
      () =>
        expect(
          root.querySelector(".plugin-block-error")?.textContent,
        ).toContain("nope"),
      { timeout: 2_000 },
    );
    expect(root.classList.contains("plugin-block-stale")).toBe(true);
    expect(
      root.querySelector(".plugin-block-host")?.shadowRoot?.querySelector("p")
        ?.textContent,
    ).toBe("A");
  });

  /** §7 "늦은 답이 버려진다" — an answer that arrives after the view is gone draws nothing. What
   *  fails this: a `draw` whose answer handler lacks the `destroyed` guard — the late result would
   *  land in the dead view's shadow root. Counted, not timed: the renderer is held open by hand,
   *  and a second request for the same key settles only after the first render's chain has. */
  it("draws nothing when the answer comes after the view was destroyed", async () => {
    let answer: (content: { html: string }) => void = () => {};
    const render = vi.fn(
      () => new Promise<{ html: string }>((resolve) => (answer = resolve)),
    );
    bind("chart", render);
    const editor = editorWith("intro\n\n```chart\nA\n```\n");
    const root = rootOf(editor);
    const shadow = root.querySelector(".plugin-block-host")!.shadowRoot!;
    showAll();
    await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(1));
    editor.destroy();
    answer({ html: "<p>late</p>" });
    await requestRender(codeBlockRendererFor("chart")!, "A", {
      context: null,
      lang: "chart",
      path: null,
    });
    expect(render).toHaveBeenCalledTimes(1);
    expect(shadow.childNodes).toHaveLength(0);
    expect(root.dataset.renderState).toBe("pending");
  });

  /** D7 "늦게 온 답(… 원문이 바뀐 뒤)은 버린다" — an answer for a source the block no longer holds is
   *  not drawn, even before a newer draw has started: an edit waits out `SOURCE_DEBOUNCE_MS` before
   *  it asks again. What fails this: an answer handler that checks only the draw's number — the
   *  older source's result would be drawn, and recorded as drawn, until the debounced redraw.
   *  Counted, not timed, as in the row above. */
  it("does not draw an answer for a source edited while it was being drawn", async () => {
    let answer: (content: { html: string }) => void = () => {};
    let calls = 0;
    const render = vi.fn((source: string) =>
      ++calls === 1
        ? new Promise<{ html: string }>((resolve) => (answer = resolve))
        : Promise.resolve({ html: `<p>${source}</p>` }),
    );
    bind("chart", render);
    const editor = editorWith("intro\n\n```chart\nA\n```\n");
    const root = rootOf(editor);
    const shadow = root.querySelector(".plugin-block-host")!.shadowRoot!;
    showAll();
    await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(1));
    editor.view.dispatch(
      editor.state.tr.insertText("B", blockPos(editor, "chart") + 2),
    );
    answer({ html: "<p>A</p>" });
    await requestRender(codeBlockRendererFor("chart")!, "A", {
      context: null,
      lang: "chart",
      path: null,
    });
    expect(shadow.querySelector("p")).toBeNull();
    expect(root.dataset.renderState).toBe("pending");
    await vi.waitFor(
      () => expect(shadow.querySelector("p")?.textContent).toBe("AB"),
      { timeout: 2_000 },
    );
    expect(render).toHaveBeenCalledTimes(2);
  });

  /** The row above with source editing open, where the late answer is the block's FIRST: the
   *  debounced redraw finds the block in source mode and only marks it stale, so leaving source
   *  editing must draw it — though it was never drawn (`renderState` still `pending`). The common
   *  way here: typing a new fence leaves the caret in the block, and the next keystroke lands
   *  before a slow renderer answers. What fails this: an `applyMode` that redraws only a block
   *  already drawn — the block stays pending and blank on screen. */
  it("draws the edited source on leaving source editing when its first answer was dropped", async () => {
    let answer: (content: { html: string }) => void = () => {};
    let calls = 0;
    const render = vi.fn((source: string) =>
      ++calls === 1
        ? new Promise<{ html: string }>((resolve) => (answer = resolve))
        : Promise.resolve({ html: `<p>${source}</p>` }),
    );
    bind("chart", render);
    const editor = editorWith("intro\n\n```chart\nA\n```\n\nafter\n");
    const root = rootOf(editor);
    const shadow = root.querySelector(".plugin-block-host")!.shadowRoot!;
    editor.commands.setNodeSelection(blockPos(editor, "chart"));
    expect(root.dataset.mode).toBe("source");
    showAll();
    await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(1));
    editor.view.dispatch(
      editor.state.tr.insertText("B", blockPos(editor, "chart") + 2),
    );
    answer({ html: "<p>A</p>" });
    await requestRender(codeBlockRendererFor("chart")!, "A", {
      context: null,
      lang: "chart",
      path: null,
    });
    expect(root.dataset.renderState).toBe("pending");
    await new Promise((resolve) =>
      setTimeout(resolve, SOURCE_DEBOUNCE_MS + 100),
    );
    // The debounced redraw ran while source editing was open: it asked for nothing.
    expect(render).toHaveBeenCalledTimes(1);
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    expect(root.dataset.mode).toBe("rendered");
    await vi.waitFor(() =>
      expect(shadow.querySelector("p")?.textContent).toBe("AB"),
    );
    expect(root.dataset.renderState).toBe("done");
    expect(render).toHaveBeenCalledTimes(2);
  });

  /** The pair of the row above: leaving source editing draws a stale block only when it is on
   *  screen (`drawWhenShown`); an off-screen one stays stale and draws when it comes into view
   *  (D7). The status line is the synchronous witness — `draw` sets it before it asks. What fails
   *  this: leaving source editing that draws at once (`draw` instead of `drawWhenShown`). */
  it("keeps an off-screen block stale on leaving source editing, and draws it in view", async () => {
    const render = vi.fn(async (source: string) => ({
      html: `<p>${source}</p>`,
    }));
    bind("chart", render);
    const editor = editorWith("intro\n\n```chart\nA\n```\n\nafter\n");
    const root = rootOf(editor);
    const status = root.querySelector(".plugin-block-status") as HTMLElement;
    showAll();
    await vi.waitFor(() => expect(root.dataset.renderState).toBe("done"));
    const observer = MockIntersectionObserver.instances.find((io) =>
      io.elements.has(root),
    )!;
    observer.triggerIntersect(false);
    editor.commands.setNodeSelection(blockPos(editor, "chart"));
    editor.view.dispatch(
      editor.state.tr.insertText("B", blockPos(editor, "chart") + 2),
    );
    await new Promise((resolve) =>
      setTimeout(resolve, SOURCE_DEBOUNCE_MS + 100),
    );
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    expect(root.dataset.mode).toBe("rendered");
    expect(status.textContent).toBe("");
    expect(render).toHaveBeenCalledTimes(1);
    observer.triggerIntersect(true);
    await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(2));
    expect(render.mock.lastCall?.[0]).toBe("AB");
  });

  /** D6 — a view in an editor outside the surface registry (the journal capture editor's) is not
   *  rebuilt when its binding goes, so it must not draw through that binding. The queue cannot
   *  tell: a request made after the dispose reads the epoch the dispose already moved. What fails
   *  this: a `draw` without the binding check — the disposed renderer is called again. The
   *  control: the same notice draws the plugin's other language, still bound, through the same
   *  queue. The chart view comes first in the notice's listeners, so its request, had it been
   *  made, starts first on the same path; the row waits 50 ms more after the control's call. */
  it("does not draw through a binding that is gone, in an editor no registry change reaches", async () => {
    const gone = vi.fn(async () => ({ html: "<p>gone</p>" }));
    const kept = vi.fn(async () => ({ html: "<p>kept</p>" }));
    const registration = bind("chart", gone);
    bind("graph", kept);
    const editor = editorWith(
      "intro\n\n```chart\nA\n```\n\n```graph\nG\n```\n",
    );
    showAll();
    await vi.waitFor(() => {
      expect(gone).toHaveBeenCalledTimes(1);
      expect(kept).toHaveBeenCalledTimes(1);
    });
    const chart = editor.view.dom.querySelector('[data-lang="chart"]');
    registration.dispose();
    // The premise: no surface, so the view was not rebuilt and still holds the disposed binding.
    expect(editor.view.dom.querySelector('[data-lang="chart"]')).toBe(chart);
    invalidateRenders("p");
    await vi.waitFor(() => expect(kept).toHaveBeenCalledTimes(2), {
      timeout: 2_000,
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(gone).toHaveBeenCalledTimes(1);
  });
});

describe("the note a block is told (P29)", () => {
  /** What fails this: `info` read from the ACTIVE tab — the background keep-alive editor's block
   *  would be told `/v/a.md` and its result cached under that key. */
  it("tells each editor's block its own note", async () => {
    const render = vi.fn(async (_source: string, _info: CodeBlockInfo) => ({
      html: "<p>c</p>",
    }));
    bind("chart", render);
    const shared = editorWith("intro\n\n```chart\nA\n```\n");
    const pooled = editorWith("intro\n\n```chart\nB\n```\n", false);
    useEditorStore.setState({
      activeTabId: "t1",
      tabs: [tab("t1", "/v/a.md"), tab("t2", "/v/b.md")],
    } as never);
    useEditorStore.getState().registerDocumentSurfaceAccess({
      editor: shared,
      editorStateCache: new Map(),
      isKeepaliveComplete: () => true,
      keepaliveEditor: (id) => (id === "t2" ? pooled : null),
    });
    markContentLoaded("t1");
    showAll();
    await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(2));
    const told = Object.fromEntries(
      render.mock.calls.map(([source, info]) => [source, info.path]),
    );
    expect(told).toEqual({ A: "/v/a.md", B: "/v/b.md" });
  });

  /** A tab switch in the shared editor is `updateState`, and prosemirror-view 1.42.3 may keep a
   *  block's view for the next note's block at the same place — `ViewTreeUpdater.findNodeMatch` when
   *  the two blocks are equal, as here, `updateNextNode` (the view's `update`) when they differ.
   *  With the same source nothing else would redraw it — the content-loaded notice does. What fails
   *  this: no `subscribeContentLoaded` in the view (the second note keeps the first's drawing). The
   *  `toBe(root)` pins the reuse this row is about.
   *
   *  Only a CACHED state is installed that way (`restore-cached-state.ts`). A state made by
   *  `EditorState.create` redraws the whole document: prosemirror-tables 1.8.5's `columnResizing`
   *  replaces its `table` node view in every state's `init`, and prosemirror-view rebuilds every
   *  view when a node view changed (`changedNodeViews`). So t2's state is made first, as a cached
   *  one was, and t1's fresh state is installed after it — the redraw that installs t1 is the last
   *  node view change, and t2's state then comes back without one. */
  it("draws again when its editor's note changes under it", async () => {
    const render = vi.fn(async (_source: string, _info: CodeBlockInfo) => ({
      html: "<p>c</p>",
    }));
    bind("chart", render);
    const shared = editorWith("intro\n\n```chart\nA\n```\n");
    const stateOf = () =>
      EditorState.create({
        doc: markdownToProsemirror(
          "intro\n\n```chart\nA\n```\n",
          shared.schema,
        ),
        plugins: shared.state.plugins,
      });
    const cached = stateOf();
    shared.view.updateState(stateOf());
    useEditorStore.setState({
      activeTabId: "t1",
      tabs: [tab("t1", "/v/a.md"), tab("t2", "/v/b.md")],
    } as never);
    useEditorStore.getState().registerDocumentSurfaceAccess({
      editor: shared,
      editorStateCache: new Map(),
      isKeepaliveComplete: () => true,
      keepaliveEditor: () => null,
    });
    markContentLoaded("t1");
    showAll();
    const root = rootOf(shared);
    await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(1));
    shared.view.updateState(cached);
    useEditorStore.setState({ activeTabId: "t2" } as never);
    markContentLoaded("t2");
    expect(rootOf(shared)).toBe(root);
    await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(2));
    expect(render.mock.calls.map(([, info]) => info.path)).toEqual([
      "/v/a.md",
      "/v/b.md",
    ]);
  });

  /** While a keep-alive tab is the loaded one, the shared editor names no note (`null`) and its
   *  block waits, stale. The shared editor's own tab arriving must draw it — by the content-loaded
   *  notice, not by a later visibility change. What fails this: the notice ignoring a view that has
   *  never drawn (`if (this.drawnNote === null) return;` — the block stays blank while on screen). */
  it("draws a waiting block when its editor's note arrives", async () => {
    const render = vi.fn(async (_source: string, _info: CodeBlockInfo) => ({
      html: "<p>c</p>",
    }));
    bind("chart", render);
    const shared = editorWith("intro\n\n```chart\nA\n```\n");
    const pooled = editorWith("plain\n", false);
    useEditorStore.setState({
      activeTabId: "t2",
      tabs: [tab("t1", "/v/a.md"), tab("t2", "/v/b.md")],
    } as never);
    useEditorStore.getState().registerDocumentSurfaceAccess({
      editor: shared,
      editorStateCache: new Map(),
      isKeepaliveComplete: () => true,
      keepaliveEditor: (id) => (id === "t2" ? pooled : null),
    });
    markContentLoaded("t2");
    showAll();
    expect(render).toHaveBeenCalledTimes(0);
    expect(rootOf(shared).dataset.renderState).toBe("pending");
    useEditorStore.setState({ activeTabId: "t1" } as never);
    markContentLoaded("t1");
    await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(1));
    expect(render.mock.calls[0][1].path).toBe("/v/a.md");
  });
});
