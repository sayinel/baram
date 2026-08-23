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
  // §301 ruling (round 3): in PDF a local file is UNLINKED. Its href could only
  // be document-relative, and Chrome resolves that against the temp file
  // generate_pdf deletes on return — a click that silently does nothing, which
  // is what the user reported. With a caption present nothing stands in for the
  // video at all: the figcaption already prints that text.
  it("leaves a captioned local video as plain caption text in the PDF, with no link at all", async () => {
    const editor = await mountEditor(LOCAL_MD);
    const pdf = await capture(editor, true);

    expect(pdf).not.toContain("<video");
    expect(pdf).toContain(
      '<figcaption class="video-caption">Xenoscube Part1</figcaption>',
    );
    // No anchor, and no href — a dead link is worse than none.
    expect(pdf).not.toContain("<a ");
    expect(pdf).not.toContain("href=");
    // And the path is not printed alongside the caption it duplicates.
    expect(pdf).not.toContain("assets/Xenoscube_20260427_Part1.pptx.mp4");
  });

  // The other half: with no caption, something has to say a video was here, so
  // the path is printed — as text, still not as a link.
  it("prints the path as unlinked text when a local video has no caption", async () => {
    const editor = await mountEditor("![](assets/clip.mp4)");
    const pdf = await capture(editor, true);

    expect(pdf).not.toContain("<figcaption");
    expect(pdf).toContain(
      '<span class="video-export-path">assets/clip.mp4</span>',
    );
    expect(pdf).not.toContain("<a ");
  });

  // The boundary the ruling turns on, driven through the real view: a REMOTE
  // video file keeps its anchor, because an absolute URL resolves anywhere.
  // Without this, narrowing the plain-text branch to nothing — or widening it
  // to every video — would both go unnoticed here.
  it("keeps the anchor for a REMOTE video file in the PDF", async () => {
    const editor = await mountEditor("![clip](https://example.com/clip.mp4)");
    const pdf = await capture(editor, true);

    expect(pdf).toContain(
      '<a class="video-export-link" href="https://example.com/clip.mp4">clip</a>',
    );
    expect(pdf).not.toContain("video-export-path");
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
    // One link, not two: the local video is unlinked text in PDF now, so only
    // the provider embed still carries an anchor.
    const links = [...dom.querySelectorAll("a.video-export-link")];
    expect(links).toHaveLength(1);
    expect(dom.querySelector(".video-caption")?.textContent).toBe(
      "Xenoscube Part1",
    );
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
  // Two PROVIDER embeds, because only those still produce anchors in PDF — a
  // local video is unlinked text now, so it cannot carry the second caption
  // this check needs.
  it("gives each video its OWN caption, not the first one in the document", async () => {
    const editor = await mountEditor(
      `${EMBED_MD}\n\n![두 번째](https://youtu.be/dQw4w9WgXcQ)\n`,
    );
    const pdf = await capture(editor, true);

    const dom = document.createElement("div");
    dom.innerHTML = pdf;
    const links = [...dom.querySelectorAll("a.video-export-link")];
    expect(links.map((a) => a.textContent)).toEqual(["한로로 0+0", "두 번째"]);
  });

  // §301 round 3: the unlinked stand-in needs the same wrapping as the link (a
  // long path must not run off the page) and must NOT get link affordance, or
  // it would look clickable while being deliberately inert.
  it("wraps the unlinked path stand-in but gives it no link affordance", async () => {
    const doc = generateStandaloneHTML("", "t");
    const rule = doc.match(/\.video-export-path \{([^}]*)\}/)?.[1] ?? "";
    expect(rule).toMatch(/overflow-wrap:\s*anywhere/);
    expect(rule).not.toMatch(/color:/);
    expect(rule).not.toMatch(/text-decoration:/);
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
// ‼️ Corrected premise. This used to require a hard-coded hex, on the grounds
// that "the export carries no token stylesheet, and a standalone file has no
// app root to inherit from". It carries one now (export-editor-css.ts inlines
// the light theme), and the anchor rule is the editor's own — so the check is
// that the rule names a token AND that the token is defined, which is the pair
// that actually decides whether the link is painted. A `var()` with no
// definition takes the whole declaration down with it, so asserting only the
// first half would pass on an invisible link.
describe("the exported stylesheet gives anchors a visible affordance", () => {
  const CSS = generateStandaloneHTML("", "t");

  /** The scoped `a { … }` rule, excluding the @media print block. */
  function anchorRule(): string {
    const editorCss = CSS.slice(0, CSS.indexOf("@media print"));
    const m = editorCss.match(/\narticle\.baram-export a \{([^}]*)\}/);
    return m?.[1] ?? "";
  }

  it("found exactly one anchor rule, so the checks below are not vacuous", () => {
    const editorCss = CSS.slice(0, CSS.indexOf("@media print"));
    expect(
      editorCss.match(/\narticle\.baram-export a \{[^}]*\}/g),
    ).toHaveLength(1);
  });

  it("gives anchors a colour distinct from body text", () => {
    expect(anchorRule()).toMatch(/color:\s*var\(--color-accent-default\)/);
    expect(anchorRule()).not.toMatch(/color:\s*inherit/i);
  });

  it("defines the token that colour resolves through", () => {
    // Without this the declaration above is dropped at computed-value time and
    // the link paints as body text — visibly identical to having no rule.
    expect(CSS).toMatch(/--color-accent-default:\s*[^;]+;/);
  });

  it("gives anchors an underline", () => {
    expect(anchorRule()).toMatch(/text-decoration:\s*underline/i);
  });
});
