// issue 499 — the export never ships a live link to a refused destination.
//
// Two layers stand behind that. The first is the link mark's own renderer:
// export clones the editor DOM, so an `<a>` the editor already rendered
// without `href` exports without `href` (that layer is pinned on its own in
// extensions/__tests__/link.test.ts). The second is the export's own final
// pass, and its POSITION is the point: `resolveVideoSources` builds a brand-new
// `<a href>` for a remote/data video AFTER the clone, so a scrub that ran
// right after cloning would never see it. The `data:` video case below is the
// one that isolates that ordering — the markdown-link cases are end-to-end
// checks that pass while either layer stands. The scrub also strips the
// editor's inert `data-href` carrier, so an export holds the refused string
// in no attribute at all.
//
// Driven through a real editor with the React portal host, like
// export-html-real-editor.test.tsx — the video NodeView is React, and a bare
// `new Editor` would fall back to renderHTML and never produce the `<video>`
// the export code path actually sees.
//
// ‼️ What this file cannot prove: jsdom parses the CSP <meta> and does not
// enforce it. Whether the browser refuses the navigation, and whether headless
// Chrome writes a /URI annotation for a surviving anchor, are device checks.
import { act, render } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import { EditorContent } from "@tiptap/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => `asset://localhost/${encodeURIComponent(p)}`,
  invoke: vi.fn(async () => undefined),
}));

vi.mock("../../../stores/editor/editor", () => ({
  useEditorStore: {
    getState: () => ({
      activeTabId: "t1",
      tabs: [{ filePath: "/Users/dh/vault/notes/today.md", id: "t1" }],
    }),
  },
}));

import { createBaramExtensions } from "../../../extensions";
import { markdownToProsemirror } from "../../../pipeline";
import { captureEditorHTML, generateStandaloneHTML } from "../export-html";

const editors: Editor[] = [];

afterEach(() => {
  for (const e of editors) e.destroy();
  editors.length = 0;
});

async function exportOf(markdown: string, forPdf: boolean): Promise<Document> {
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
  let html = "";
  await act(async () => {
    html = await captureEditorHTML(editor, { forPdf });
  });
  return new DOMParser().parseFromString(
    `<article>${html}</article>`,
    "text/html",
  );
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  });
}

function hrefsOf(doc: Document): (null | string)[] {
  return [...doc.querySelectorAll("a")].map((a) => a.getAttribute("href"));
}

describe("a markdown link with a refused destination", () => {
  it("exports as an anchor without href, next to an https link that keeps its own", async () => {
    const doc = await exportOf(
      "[bad](javascript:alert(1)) and [good](https://example.com/a)\n",
      false,
    );
    const anchors = [...doc.querySelectorAll("a")];
    expect(anchors.map((a) => a.textContent)).toEqual(["bad", "good"]);
    expect(anchors[0].hasAttribute("href")).toBe(false);
    // The editor's `data-href` carrier is an in-app convenience; the export
    // must not ship the refused string under any attribute name.
    expect(anchors[0].hasAttribute("data-href")).toBe(false);
    expect(anchors[1].getAttribute("href")).toBe("https://example.com/a");
  });

  it("does not leak through the model: the exported text stays a plain label", async () => {
    const doc = await exportOf("[bad](vbscript:msgbox(1))\n", false);
    expect(doc.body.textContent).toContain("bad");
    expect(doc.body.innerHTML).not.toContain("vbscript:");
  });
});

describe("anchors the export creates AFTER cloning are scrubbed too", () => {
  // A remote/data video becomes `<a class="video-export-link" href=src>` in
  // the PDF capture (export-html-media.ts). `data:` is refused by the link
  // policy, so this anchor must lose its href — which only happens if the
  // scrub runs after resolveVideoSources, not right after the clone.
  it("drops a data: href that resolveVideoSources produced for the PDF", async () => {
    const doc = await exportOf(
      "![clip](data:video/mp4;base64,AAAA.mp4)\n\n![ok](https://example.com/clip.mp4)\n",
      true,
    );
    const links = [...doc.querySelectorAll("a.video-export-link")];
    expect(links.length).toBe(2);
    expect(hrefsOf(doc).some((h) => h?.startsWith("data:"))).toBe(false);
    // The safe late emitter survives the final pass untouched.
    expect(hrefsOf(doc)).toContain("https://example.com/clip.mp4");
  });
});

describe("the standalone document carries a script-blocking CSP", () => {
  it("puts the policy first in <head>, before any stylesheet", () => {
    const html = generateStandaloneHTML("<p>x</p>", "t");
    const csp =
      "<meta http-equiv=\"Content-Security-Policy\" content=\"script-src 'none'; object-src 'none'; base-uri 'none'\">";
    expect(html).toContain(csp);
    expect(html.indexOf(csp)).toBeLessThan(html.indexOf("<style>"));
    expect(html.indexOf(csp)).toBeLessThan(html.indexOf("<title>"));
  });

  it("does not restrict anything the export actually uses (styles, images, fonts)", () => {
    const html = generateStandaloneHTML("<p>x</p>", "t");
    const policy = /content="([^"]*)"/.exec(
      html.slice(html.indexOf("Content-Security-Policy")),
    )?.[1];
    expect(policy).toBeDefined();
    for (const directive of [
      "default-src",
      "style-src",
      "img-src",
      "font-src",
      "media-src",
    ]) {
      expect(policy).not.toContain(directive);
    }
  });
});
