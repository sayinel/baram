// §294/§301 video export — driven through a REAL editor, not a hand-built DOM.
//
// Why this file exists (user-reported export defects, 2026-08-22): every video
// fixture in export-html.test.ts is a synthetic string handed to
// `mockEditor({ view: { dom } })`, so no test had ever seen the DOM
// video-view.tsx actually produces — the `react-renderer` wrapper, the
// `figure.video-figure`, the `figcaption`, the `#t=0.1` suffix, the
// percent-encoded `asset://` URL, or the card→iframe swap that happens when the
// reader clicks play. The two defects the user hit both live in that blind spot
// (cf. the repo's own "mocked integration hides total failure" lesson).
//
// React NodeViews only mount through an <EditorContent> portals host (a bare
// `new Editor` leaves every ReactNodeViewRenderer inert and falls back to
// renderHTML) and @tiptap/react ≥3.28 mounts the portal on the tick AFTER the
// transaction — so this renders via @testing-library/react and awaits flush()
// before reading, matching wikilink-view.test.tsx.
//
// ‼️ What this file does NOT prove: jsdom never loads an iframe and cannot
// render a PDF. Whether a provider's player refuses a `file://` parent origin,
// and what headless Chrome paints, are only observable in the real app.
import { act, render } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import { EditorContent } from "@tiptap/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Faithful to the native implementation (and to `@tauri-apps/api/mocks`'
// mockConvertFileSrc): the WHOLE absolute path is percent-encoded, slashes
// included, before the scheme wraps it. A hand-typed `asset://localhost/vault/…`
// would test a URL shape the app never produces.
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => `asset://localhost/${encodeURIComponent(p)}`,
  invoke: vi.fn(async () => undefined),
}));

const DOC_DIR = "/Users/dh/vault/notes";
vi.mock("../../stores/editor/editor", () => ({
  useEditorStore: {
    getState: () => ({
      activeTabId: "t1",
      tabs: [{ filePath: `${DOC_DIR}/today.md`, id: "t1" }],
    }),
  },
}));

import { createBaramExtensions } from "../../extensions";
import { markdownToProsemirror } from "../../pipeline";
import {
  captureEditorHTML,
  generateStandaloneHTML,
} from "../export/export-html";

const LOCAL_MD = "![Xenoscube Part1](assets/Xenoscube_20260427_Part1.pptx.mp4)";
const EMBED_MD =
  "![한로로 0+0](https://youtu.be/ILDol5yPM0Q?si=W0C0NW96VIGQY4Np)";
const EMBED_SRC = "https://youtu.be/ILDol5yPM0Q?si=W0C0NW96VIGQY4Np";

const editors: Editor[] = [];
afterEach(() => {
  for (const e of editors) e.destroy();
  editors.length = 0;
});

async function capture(editor: Editor, forPdf: boolean): Promise<string> {
  let html = "";
  await act(async () => {
    html = await captureEditorHTML(editor, { forPdf });
  });
  return html;
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

describe("captureEditorHTML over a real editor — local video node", () => {
  it("rewrites the live percent-encoded asset URL back to the document-relative path the markdown carried", async () => {
    const editor = await mountEditor(LOCAL_MD);

    // Vacuity guard: prove the NodeView really mounted, i.e. that the src
    // under test is video-view.tsx's resolved+fragmented one and not the
    // renderHTML fallback's verbatim `assets/…` attribute (which would make
    // the assertion below pass without exercising the rewrite at all).
    const live = editor.view.dom.querySelector("video") as HTMLVideoElement;
    expect(live.getAttribute("src")).toBe(
      `asset://localhost/${encodeURIComponent(
        `${DOC_DIR}/assets/Xenoscube_20260427_Part1.pptx.mp4`,
      )}#t=0.1`,
    );

    const html = await capture(editor, false);
    expect(html).toContain(
      '<video controls="" src="assets/Xenoscube_20260427_Part1.pptx.mp4">',
    );
  });

  // §301 ruling: the caption becomes the link and the standalone URL line is
  // dropped. The URL line was the thing the user read as "only source code" —
  // it is character-for-character the inside of the markdown's parentheses,
  // printed directly above a caption that says the same thing in words.
  it("makes the caption the link and drops the redundant URL line, for PDF", async () => {
    const editor = await mountEditor(LOCAL_MD);
    const pdf = await capture(editor, true);

    expect(pdf).not.toContain("<video");
    expect(pdf).toContain(
      '<figcaption class="video-caption"><a class="video-export-link" href="assets/Xenoscube_20260427_Part1.pptx.mp4">Xenoscube Part1</a></figcaption>',
    );
    // The URL must not survive as VISIBLE text anywhere — only as the href.
    // Without this the assertion above would still pass with the old URL line
    // sitting above the caption, which is the whole defect.
    expect(pdf).not.toContain(">assets/Xenoscube_20260427_Part1.pptx.mp4</a>");
  });

  // The other half of the ruling: with no caption there is nothing else left
  // to say a video was here, so the URL stays as the visible text.
  it("keeps the URL as visible text when the node has no caption", async () => {
    const editor = await mountEditor("![](assets/clip.mp4)");
    const pdf = await capture(editor, true);

    expect(pdf).not.toContain("<figcaption");
    expect(pdf).toContain(
      '<a class="video-export-link" href="assets/clip.mp4">assets/clip.mp4</a>',
    );
  });
});

// The narrowing is per-destination, so both halves need pinning or a future
// change could quietly swap them.
describe("caption-as-link is PDF only", () => {
  it("uses the caption in the PDF and the URL in the HTML, for the same node", async () => {
    const pdfEditor = await mountEditor(EMBED_MD);
    const pdf = await capture(pdfEditor, true);
    const htmlEditor = await mountEditor(EMBED_MD);
    const html = await capture(htmlEditor, false);

    expect(pdf).toContain(`>한로로 0+0</a>`);
    expect(pdf).not.toContain(`>${EMBED_SRC}</a>`);

    expect(html).toContain(`>${EMBED_SRC}</a>`);
    expect(html).not.toContain(`>한로로 0+0</a>`);
  });
});

describe("captureEditorHTML over a real editor — provider embed", () => {
  /** Click the idle card so the NodeView swaps in the playing iframe. */
  async function play(editor: Editor): Promise<void> {
    const card = editor.view.dom.querySelector(".video-embed-card");
    expect(card).not.toBeNull();
    await act(async () => {
      (card as HTMLElement).click();
    });
    await flush();
    // Vacuity guard: without this, a regression that never mounts the iframe
    // would leave the idle card in place and every assertion below would pass
    // through the OTHER shape's (already ungated) conversion.
    expect(editor.view.dom.querySelector(".video-embed-frame")).not.toBeNull();
  }

  it("exports a PLAYED embed as a link for HTML, not as the surviving iframe (the black-box defect)", async () => {
    const editor = await mountEditor(EMBED_MD);
    await play(editor);

    const html = await capture(editor, false);
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain("youtube-nocookie.com");
    // HTML keeps the URL as the visible text. The caption-as-link rule is PDF
    // only: the user read a caption-only line as "the embed vanished
    // entirely", because nothing on the page said where it pointed.
    expect(html).toContain(
      `<a class="video-export-link" href="${EMBED_SRC}">${EMBED_SRC}</a>`,
    );
    expect(html).toContain(
      '<figcaption class="video-caption">한로로 0+0</figcaption>',
    );
  });

  it("exports a PLAYED embed as a link for PDF too", async () => {
    const editor = await mountEditor(EMBED_MD);
    await play(editor);

    const pdf = await capture(editor, true);
    expect(pdf).not.toContain("<iframe");
    expect(pdf).toContain(
      `<figcaption class="video-caption"><a class="video-export-link" href="${EMBED_SRC}">한로로 0+0</a></figcaption>`,
    );
  });

  it("exports an UNPLAYED embed to the identical link, so the file does not depend on what the reader clicked", async () => {
    const idle = await mountEditor(EMBED_MD);
    expect(idle.view.dom.querySelector(".video-embed-card")).not.toBeNull();
    const idleHtml = await capture(idle, false);

    const played = await mountEditor(EMBED_MD);
    await play(played);
    const playedHtml = await capture(played, false);

    expect(idleHtml).toContain(
      `<a class="video-export-link" href="${EMBED_SRC}">${EMBED_SRC}</a>`,
    );
    expect(playedHtml).toBe(idleHtml);
  });

  it("prints the caption text exactly once in the PDF — the link replaces it, it is not added above it", async () => {
    const editor = await mountEditor(EMBED_MD);
    await play(editor);
    const pdf = await capture(editor, true);

    expect(pdf.split("한로로 0+0")).toHaveLength(2);
    // And the caption is still inside its figcaption, not hoisted out of it.
    expect(pdf).toContain('<figcaption class="video-caption"><a ');
  });
});

// Decisive question: could the exported link be invisible — no text, or no
// styling? Both halves are checked, because either alone would look to a
// reader exactly like the video silently vanishing.
describe("the exported video link is actually visible", () => {
  it("gives every video-export-link non-empty text", async () => {
    const editor = await mountEditor(`${LOCAL_MD}\n\n${EMBED_MD}\n`);
    const pdf = await capture(editor, true);

    const dom = document.createElement("div");
    dom.innerHTML = pdf;
    const links = [...dom.querySelectorAll("a.video-export-link")];
    expect(links).toHaveLength(2);
    for (const a of links) {
      // Text, or the reader sees nothing at all where a video was.
      expect(a.textContent?.trim()).not.toBe("");
      // href, or the link is text pretending to be a link.
      expect(a.getAttribute("href")).not.toBe("");
    }
  });

  // Guards the `closest("figure.video-figure")` scoping in
  // replaceWithExportLink. A document-wide caption lookup would hand BOTH
  // links the first figcaption's text, and every single-video test in this
  // file would still pass, because in a one-video document the first
  // figcaption is the right one.
  it("gives each video its OWN caption, not the first one in the document", async () => {
    const editor = await mountEditor(`${LOCAL_MD}\n\n${EMBED_MD}\n`);
    const pdf = await capture(editor, true);

    const dom = document.createElement("div");
    dom.innerHTML = pdf;
    const links = [...dom.querySelectorAll("a.video-export-link")];
    expect(links.map((a) => a.textContent)).toEqual([
      "Xenoscube Part1",
      "한로로 0+0",
    ]);
  });

  it("ships a .video-export-link rule in the exported stylesheet", async () => {
    // Empty body on purpose: the class name must be found in the CSS, not
    // echoed back out of the markup under test.
    const doc = generateStandaloneHTML("", "t");
    expect(doc).toContain(".video-export-link {");
  });
});

// The exported document is standalone, so its own stylesheet is the only thing
// that makes a link legible as a link. This asserts the DECLARATION, not a
// comment, in the spirit of media-toolbar-colors.test.ts — and it is the reason
// `.video-export-link` deliberately does not restate colour or decoration:
// `a` already carries them, so a video link looks like every other link in the
// same document instead of a new species.
//
// Hard-coded hex on purpose. A theme token (`var(--color-…)`) would resolve to
// nothing here: the export carries no token stylesheet, and a canvas-free
// standalone file has no app root to inherit from.
describe("the exported stylesheet gives anchors a visible affordance", () => {
  const CSS = generateStandaloneHTML("", "t");

  /** The top-level `a { … }` rule, excluding the @media print block. */
  function anchorRule(): string {
    const editorCss = CSS.slice(0, CSS.indexOf("@media print"));
    const m = editorCss.match(/\na \{([^}]*)\}/);
    return m?.[1] ?? "";
  }

  it("found exactly one top-level anchor rule, so the checks below are not vacuous", () => {
    const editorCss = CSS.slice(0, CSS.indexOf("@media print"));
    expect(editorCss.match(/\na \{[^}]*\}/g)).toHaveLength(1);
  });

  it("gives anchors a colour distinct from body text", () => {
    expect(anchorRule()).toMatch(/color:\s*#[0-9a-f]{3,6}/i);
    // Body text is #1f2937/#374151-ish; the link must not be painted the same.
    expect(anchorRule()).not.toMatch(/color:\s*inherit/i);
  });

  it("gives anchors an underline", () => {
    expect(anchorRule()).toMatch(/text-decoration:\s*underline/i);
  });
});
