// §5.12 export — the heavy blocks (code / math / mermaid) and the editing
// chrome that rides along with them.
//
// Why this file exists (user-reported export defects, 2026-08-23): every heavy
// block in this app mounts LAZILY — code-block-node-view.ts, math-block-view,
// math-inline-view and mermaid-block-view all gate their real content behind
// `onFirstVisible` (views/lazy-visible.ts). `captureEditorHTML` cloned the live
// DOM as-is, so any block the reader had not scrolled past exported as the
// placeholder it was showing: raw un-highlighted text with a `<select>` and an
// AI button above it, an empty `.math-block-katex`, an empty `.mermaid-block`.
// The user's PDF had every one of those.
//
// ‼️ The defect is only reachable because src/test-setup.ts installs a
// MockIntersectionObserver that never fires on its own — matching the app,
// where a block below the fold never intersects. `onFirstVisible` falls back to
// invoking its callback IMMEDIATELY when `IntersectionObserver` is undefined,
// so in an environment without the mock every test here would pass without the
// fix. Do not "simplify" the setup by deleting the mock.
import { act, render } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import { EditorContent } from "@tiptap/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => `asset://localhost/${encodeURIComponent(p)}`,
  invoke: vi.fn(async () => undefined),
}));

// Mermaid itself is not under test — its bundle needs real layout, which jsdom
// does not have. What IS under test is whether the export ever gives the block
// a chance to render. The real diagram is verified by printing an export
// through headless Chrome (dev/impl-notes/2026-08-23-pdf-export-defects.md).
vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async (id: string) => ({
      svg: `<svg id="${id}" viewBox="0 0 200 100" width="200" height="100"><g><text>Start</text></g></svg>`,
    })),
  },
}));

import { createBaramExtensions } from "../../../extensions";
import { _resetForTest } from "../../../extensions/nodes/views/lazy-visible";
import { markdownToProsemirror } from "../../../pipeline";
import { useSettingsStore } from "../../../stores/settings/store";
import { captureEditorHTML } from "../export-html";

// jsdom does not implement window.matchMedia, and code-block-highlight.ts's
// getHighlightStyle() reads it to pick a light/dark theme. Without this the
// CodeMirror mount rejects, so the code block would look "still lazy" for a
// reason that has nothing to do with the export. Same polyfill as
// views/__tests__/code-block-lazy.test.ts.
if (typeof window.matchMedia !== "function") {
  window.matchMedia = ((query: string) => ({
    addEventListener: () => {},
    addListener: () => {},
    dispatchEvent: () => false,
    matches: false,
    media: query,
    onchange: null,
    removeEventListener: () => {},
    removeListener: () => {},
  })) as unknown as typeof window.matchMedia;
}

const editors: Editor[] = [];

const lineNumbersDefault = useSettingsStore.getState().codeBlockLineNumbers;

beforeEach(() => {
  _resetForTest();
  useSettingsStore.setState({ codeBlockLineNumbers: lineNumbersDefault });
});

afterEach(() => {
  for (const e of editors) e.destroy();
  editors.length = 0;
});

/**
 * ‼️ NOT wrapped in `act()`, unlike every other helper here, and that is the
 * whole point.
 *
 * `captureEditorHTML` wakes the lazy blocks and then POLLS the live DOM until
 * their renders land. Inside `act`, React holds its commits until the act scope
 * exits — so the poll loop would watch a DOM that cannot change, stall for its
 * full budget and fall back, while the same code finishes in ~50ms in the app,
 * which has no act. Wrapping this would test React's test scheduler rather than
 * the export. (Measured: 4049ms/1 pending inside act, 53ms/0 pending outside.)
 *
 * The cost is React's "not wrapped in act(...)" warning on stderr. That is the
 * honest trade.
 */
async function capture(editor: Editor): Promise<Document> {
  const html = await captureEditorHTML(editor, { forPdf: true });
  // Let any render the capture kicked off settle before the editor is torn
  // down, so teardown does not race a pending commit.
  await flush();
  return new DOMParser().parseFromString(
    `<article>${html}</article>`,
    "text/html",
  );
}

/** Flush React passive effects + the deferred NodeView portal mount. */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  });
}

async function mountEditor(markdown: string): Promise<Editor> {
  const editor = new Editor({
    content: "<p>seed</p>",
    extensions: createBaramExtensions(),
  });
  editors.push(editor);
  render(<EditorContent editor={editor} />);
  act(() => {
    editor.commands.setContent(
      markdownToProsemirror(markdown, editor.schema).toJSON(),
    );
  });
  await flush();
  return editor;
}

const CODE_MD = [
  "```python",
  'print("Hello, World!")',
  "return True",
  "```",
].join("\n");

describe("a code block the reader never scrolled to", () => {
  it("is still off-screen when the export starts — the premise of every check below", async () => {
    const editor = await mountEditor(CODE_MD);
    expect(
      editor.view.dom.querySelector(".code-block-placeholder"),
    ).not.toBeNull();
    expect(editor.view.dom.querySelector(".cm-editor")).toBeNull();
  });

  it("exports as a rendered code block, not as the lazy placeholder", async () => {
    const doc = await capture(await mountEditor(CODE_MD));
    expect(doc.querySelector(".code-block-placeholder")).toBeNull();
    expect(doc.querySelector(".code-block-export")).not.toBeNull();
  });

  it("keeps its line-number gutter when the editor shows one", async () => {
    useSettingsStore.setState({ codeBlockLineNumbers: true });
    const doc = await capture(await mountEditor(CODE_MD));
    expect(doc.querySelector(".code-block-gutter")?.textContent).toBe("1\n2");
  });

  it("omits the gutter when the editor does not show one", async () => {
    useSettingsStore.setState({ codeBlockLineNumbers: false });
    const doc = await capture(await mountEditor(CODE_MD));
    expect(doc.querySelector(".code-block-gutter")).toBeNull();
  });

  it("labels the language", async () => {
    const doc = await capture(await mountEditor(CODE_MD));
    expect(doc.querySelector(".code-block-export-lang")?.textContent).toBe(
      "python",
    );
  });

  it("exports every line of a long block, not just the ones CodeMirror drew", async () => {
    // ‼️ CodeMirror 6 virtualizes its own viewport. Force-mounting a block that
    // is off-screen makes CM render for an off-screen viewport, so
    // `.cm-content .cm-line` holds a FRACTION of the document — measured here:
    // 38 of 500. Reading the export's text from that DOM silently truncates the
    // code. The block's text has to come from the ProseMirror node, which is
    // the only complete copy.
    const n = 500;
    const body = Array.from({ length: n }, (_, i) => `const x${i} = ${i};`);
    const doc = await capture(
      await mountEditor(
        `lead\n\n\`\`\`javascript\n${body.join("\n")}\n\`\`\`\n\ntrail`,
      ),
    );

    const code = doc.querySelector(".code-block-code")?.textContent ?? "";
    expect(code.split("\n")).toHaveLength(n);
    // Both ends, so a truncation at either edge is caught.
    expect(code).toContain("const x0 = 0;");
    expect(code).toContain(`const x${n - 1} = ${n - 1};`);
  }, 30_000);

  it("prints the LIGHT palette even when the editor is dark", async () => {
    // User report (2026-08-23), reported together with Mermaid's baked-in
    // palette: an export must not carry the editor's theme. Syntax colours used
    // to be read with `getComputedStyle`, i.e. from the style the editor is
    // wearing, so a dark-theme export put light-grey code onto the white page
    // an export always is.
    //
    // ‼️ `data-theme` is set BEFORE the editor mounts, because
    // getHighlightStyle() is read once when CodeMirror is constructed.
    document.documentElement.dataset.theme = "dark";
    try {
      const doc = await capture(await mountEditor(CODE_MD));
      const styles = [...doc.querySelectorAll(".code-block-code span")].map(
        (el) => el.getAttribute("style") ?? "",
      );
      expect(styles.length).toBeGreaterThan(0);
      // #708 is the LIGHT style's keyword colour; #c678dd is the dark one.
      expect(styles.join(" ")).toContain("#708");
      expect(styles.join(" ")).not.toContain("#c678dd");
    } finally {
      delete document.documentElement.dataset.theme;
    }
  });

  it("drops the language <select> and the AI button", async () => {
    const doc = await capture(await mountEditor(CODE_MD));
    expect(doc.querySelector("select")).toBeNull();
    expect(doc.querySelector(".nodeview-ai-btn")).toBeNull();
  });
});

// ‼️ The TRAILING paragraph is load-bearing. `setContent` replaces the whole doc
// and the selection maps to the END of what it inserted — so a math block in
// last position is SELECTED, and selection is the one state that bypasses the
// lazy gate ("find/nav into an unrendered block still shows it",
// math-block-view.tsx). Without a block after it the formula renders for a
// reason that has nothing to do with the export, and the test passes against
// the unfixed code.
const MATH_BLOCK_MD = "lead\n\n$$\nE = mc^2\n$$\n\ntrail";

describe("math the reader never scrolled to", () => {
  it("is still unrendered when the export starts — the premise of the checks below", async () => {
    const editor = await mountEditor(MATH_BLOCK_MD);
    const katex = editor.view.dom.querySelector(".math-block-katex");
    expect(katex).not.toBeNull();
    expect(katex?.querySelector(".katex")).toBeNull();
  });

  it("renders the inline formula rather than an empty span", async () => {
    const doc = await capture(await mountEditor("inline: $E=mc^2$"));
    const inline = doc.querySelector(".math-inline");
    expect(inline).not.toBeNull();
    expect(inline?.querySelector(".katex")).not.toBeNull();
  });

  it("renders the block formula rather than a lone equation number", async () => {
    const doc = await capture(await mountEditor(MATH_BLOCK_MD));
    const katex = doc.querySelector(".math-block-katex");
    expect(katex).not.toBeNull();
    expect(katex?.querySelector(".katex")).not.toBeNull();
  });

  it("drops the math block's AI button", async () => {
    const doc = await capture(await mountEditor(MATH_BLOCK_MD));
    expect(doc.querySelector(".nodeview-ai-btn")).toBeNull();
  });
});

describe("a mermaid diagram the reader never scrolled to", () => {
  it("exports the rendered SVG rather than an empty block", async () => {
    const doc = await capture(
      await mountEditor("```mermaid\nflowchart LR\n  A --> B\n```"),
    );
    const block = doc.querySelector(".mermaid-block");
    expect(block).not.toBeNull();
    expect(block?.querySelector("svg")).not.toBeNull();
  });
});

describe("editing chrome never reaches the export", () => {
  const CHROME_MD = [
    "> [!info]",
    "> body text",
    "",
    CODE_MD,
    "",
    "$$",
    "E = mc^2",
    "$$",
    "",
    "text with a footnote[^a]",
    "",
    "[^a]: the note",
  ].join("\n");

  it("leaves no button, select or textarea anywhere", async () => {
    const doc = await capture(await mountEditor(CHROME_MD));
    expect(doc.querySelectorAll("button")).toHaveLength(0);
    expect(doc.querySelectorAll("select")).toHaveLength(0);
    expect(doc.querySelectorAll("textarea")).toHaveLength(0);
  });

  it("keeps the callout's icon and title, which are content", async () => {
    const doc = await capture(await mountEditor(CHROME_MD));
    const header = doc.querySelector(".callout-header");
    expect(header).not.toBeNull();
    expect(header?.querySelector("svg")).not.toBeNull();
    expect(header?.querySelector(".callout-title")?.textContent).toBe("Info");
  });

  it("keeps the task checkbox, which is content, not chrome", async () => {
    // §18.18 M4: the control is a `<button data-state>`, so the blanket
    // "remove every pressable thing" rule would delete it. It is retagged to a
    // `<span>` instead — and the retag has to carry `data-state` across, since
    // that attribute is the whole content: the stylesheet paints the tick, the
    // slash and the cross from it. A span that arrived without it would export
    // four identical empty boxes and nobody would see an error.
    const doc = await capture(
      await mountEditor("- [x] done\n- [ ] todo\n- [/] doing\n- [-] dropped"),
    );
    expect(doc.querySelectorAll("button.task-checkbox")).toHaveLength(0);
    const boxes = [...doc.querySelectorAll("span.task-checkbox")];
    expect(boxes.map((b) => b.getAttribute("data-state"))).toEqual([
      "done",
      "todo",
      "doing",
      "cancelled",
    ]);
  });

  it("keeps a button the AUTHOR wrote inside an HTML block", async () => {
    // ‼️ Discriminating. "Remove every pressable thing" is the right rule for
    // chrome the EDITOR added, and the wrong one for markup the document
    // itself contains: an HTML block renders the author's own sanitized HTML
    // (html-block-view.tsx), and dropping part of it is the same silent
    // content loss this whole change exists to stop.
    const doc = await capture(
      await mountEditor(
        '<div>\n<button type="button">Author button</button>\n</div>',
      ),
    );
    const render = doc.querySelector(".html-block-render");
    expect(render).not.toBeNull();
    expect(render?.querySelector("button")?.textContent).toBe("Author button");
  });

  it("leaves no ProseMirror widget decoration behind", async () => {
    const doc = await capture(
      await mountEditor("- parent\n  - child\n- sibling"),
    );
    expect(doc.querySelectorAll(".ProseMirror-widget")).toHaveLength(0);
    expect(doc.querySelectorAll(".fold-arrow")).toHaveLength(0);
  });
});
