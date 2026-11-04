// The editor the plugin-block export tests share: one bound `chart` renderer, editors mounted in
// the document, the lazy and visibility observers driven by hand, and the export read back as a
// parsed document. Each test file still declares its own `vi.mock` of the Tauri core (vitest hoists
// a mock per file).
import type { CodeBlockRenderer, Disposable } from "../../../../plugins/types";

import { Editor } from "@tiptap/core";

import { createBaramExtensions } from "../../../../extensions";
import {
  _resetForTest,
  flushPendingVisibility,
} from "../../../../extensions/nodes/views/lazy-visible";
import { markdownToProsemirror } from "../../../../pipeline/md-to-pm";
import {
  __resetCodeBlockRegistry,
  bindCodeBlockRenderer,
  claimCodeBlockLangs,
} from "../../../../plugins/rendered/code-block-registry";
import { __resetRenderQueue } from "../../../../plugins/rendered/render-queue";
import { __resetVisibility } from "../../../../plugins/rendered/visibility";
import { captureEditorHTML } from "../../export-html";

declare const MockIntersectionObserver: {
  instances: Array<{ triggerIntersect: (v?: boolean) => void }>;
};

const editors: Editor[] = [];

/** Bind `render` to the `chart` language for plugin `p` ("Plug"); the binding's disposable. */
export function bindChart(render: CodeBlockRenderer): Disposable {
  claimCodeBlockLangs(
    { pluginId: "p", pluginName: "Plug", tier: "trusted", version: "1" },
    ["chart"],
  );
  return bindCodeBlockRenderer("p", "chart", render);
}

/** The position of the document's first code block of `lang`. */
export function blockPos(editor: Editor, lang: string): number {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (found === -1 && node.attrs.language === lang) found = pos;
    return found === -1;
  });
  return found;
}

/** Destroy every editor `editorWith` made and reset the registry, the queue and the observers. */
export function cleanUp(): void {
  for (const editor of editors.splice(0)) editor.destroy();
  __resetCodeBlockRegistry();
  __resetRenderQueue();
  __resetVisibility();
  _resetForTest();
}

/** An editor holding `md`, mounted in the document. */
export function editorWith(md: string): Editor {
  const editor = new Editor({
    element: document.body.appendChild(document.createElement("div")),
    extensions: createBaramExtensions(),
    content: "",
  });
  editor.commands.setContent(markdownToProsemirror(md, editor.schema).toJSON());
  editors.push(editor);
  return editor;
}

/** `captureEditorHTML`'s output, parsed as a document. */
export async function exported(editor: Editor): Promise<Document> {
  const html = await captureEditorHTML(editor);
  return new DOMParser().parseFromString(
    `<article>${html}</article>`,
    "text/html",
  );
}

/** Every observed element leaves the view — a rendered block scrolled away. */
export function hideAll(): void {
  for (const io of MockIntersectionObserver.instances)
    io.triggerIntersect(false);
}

/** The editor's first rendered block's root. */
export function rootOf(editor: Editor): HTMLElement {
  return editor.view.dom.querySelector("[data-plugin-block]") as HTMLElement;
}

/** The LIVE shadow root of `root`'s host. */
export function shadowOf(root: HTMLElement): ShadowRoot {
  return root.querySelector(".plugin-block-host")!.shadowRoot!;
}

/** Every observed element intersects; the lazy queue then runs at once. */
export function showAll(): void {
  for (const io of MockIntersectionObserver.instances)
    io.triggerIntersect(true);
  flushPendingVisibility();
}

/** The `<template>` content of the export's first rendered block. */
export function templateOf(doc: Document): DocumentFragment | undefined {
  return (
    doc.querySelector(
      'template[shadowrootmode="open"]',
    ) as HTMLTemplateElement | null
  )?.content;
}
