// §388 spec 0067 §1.2 · §11-10 — the trusted EditorAPI against a REAL Tiptap editor.
// The fake in trusted-editor-surface.test.ts took `setContent({ content })` in the shape of
// the bug, which is how an empty-the-document defect stayed green (spec §1.2).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { openUrl } = vi.hoisted(() => ({
  openUrl: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl }));

import type { PluginManifest } from "../types";

import {
  anchorCount,
  anchorMappingPasses,
  dropAnchors,
} from "../../extensions/plugins/selection-anchors";
import { useEditorStore } from "../../stores/editor/editor";
import { markContentLoaded } from "../../utils/editor/programmatic-update";
import { documentProseText } from "../../utils/word-count";
import {
  createExtensionContext,
  setEditorInstance,
  setEditorSurfaceBlocked,
  unregisterPluginUI,
} from "../extension-context";
import { realEditor } from "./real-editor";

const manifest = (capabilities: string[]): PluginManifest =>
  ({
    author: "t",
    capabilities,
    description: "d",
    engines: { baram: ">=0.5.0" },
    id: "real-probe",
    license: "MIT",
    main: "index.mjs",
    name: "Real Probe",
    trust: "trusted",
    version: "1.0.0",
  }) as unknown as PluginManifest;

beforeEach(() => {
  useEditorStore.setState({ activeTabId: "t1" } as never);
  markContentLoaded("t1");
  setEditorSurfaceBlocked(null);
});
afterEach(() => {
  setEditorInstance(null);
  dropAnchors("real-probe");
});

describe("trusted EditorAPI (spec 0067 D1)", () => {
  it("insertText puts the characters in literally — no HTML parsing", async () => {
    const { editor } = realEditor("alpha @@ omega\n");
    setEditorInstance(editor);
    const ctx = createExtensionContext(manifest(["editor"]), "/p");
    await ctx.editor.insertText("a <b>x</b> c");
    expect(editor.state.doc.textContent).toBe("alpha a <b>x</b> c omega");
    let marked = false;
    editor.state.doc.descendants((n) => {
      if (n.marks.length > 0) marked = true;
    });
    expect(marked).toBe(false);
    editor.destroy();
  });

  it("getText is the app's prose — not Tiptap's getText()", async () => {
    const { editor } = realEditor(
      "---\nt: 1\n---\n\nsee [[Note|label]]\n\n```\ncode\n```\n",
    );
    setEditorInstance(editor);
    const ctx = createExtensionContext(manifest(["editor:readonly"]), "/p");
    const text = await ctx.editor.getText();
    expect(text).toBe(documentProseText(editor.state.doc));
    expect(text).not.toBe(editor.getText());
    editor.destroy();
  });

  it("insertMarkdown and setMarkdown write markdown; setContent and getContent are gone", async () => {
    const { editor } = realEditor("alpha @@ omega\n");
    setEditorInstance(editor);
    const ctx = createExtensionContext(manifest(["editor"]), "/p");
    await ctx.editor.insertMarkdown("[T](https://e.x)");
    expect(await ctx.editor.getMarkdown()).toBe(
      "alpha [T](https://e.x) omega\n",
    );
    await ctx.editor.setMarkdown("# New\n");
    expect(await ctx.editor.getMarkdown()).toBe("# New\n");
    // The type half (spec §11-10): re-adding either member to `EditorAPI` makes these
    // directives unused, which `npm run typecheck` reports.
    // @ts-expect-error — removed from the public type
    expect(ctx.editor.setContent).toBeUndefined();
    // @ts-expect-error — removed from the public type
    expect(ctx.editor.getContent).toBeUndefined();
    editor.destroy();
  });

  it("readonly: getSelection hands out a ref but records nothing; writes refuse with not-permitted first", async () => {
    const { editor } = realEditor("alpha @@beta@@ gamma\n");
    setEditorInstance(editor);
    const ctx = createExtensionContext(manifest(["editor:readonly"]), "/p");
    const { ref } = await ctx.editor.getSelection();
    expect(ref).toMatch(/^[0-9a-f]{32}$/u);
    expect(anchorCount("real-probe")).toBe(0);
    await expect(
      ctx.editor.insertMarkdown("x", { replace: ref }),
    ).rejects.toMatchObject({
      code: "not-permitted",
    });
    editor.destroy();
  });

  it("a writer's getSelection records a ref, and the same plugin's insert replaces exactly that range", async () => {
    // The positive half of the readonly row above: with `editor` the ref IS recorded.
    const { editor } = realEditor("alpha @@beta@@ gamma\n");
    setEditorInstance(editor);
    const ctx = createExtensionContext(manifest(["editor"]), "/p");
    const { ref } = await ctx.editor.getSelection();
    expect(anchorCount("real-probe")).toBe(1);
    await ctx.editor.insertText("X", { replace: ref });
    expect(editor.state.doc.textContent).toBe("alpha X gamma");
    editor.destroy();
  });

  it("a malformed ref is ref-unknown in this tier", async () => {
    const { editor } = realEditor("alpha @@ omega\n");
    setEditorInstance(editor);
    const ctx = createExtensionContext(manifest(["editor"]), "/p");
    await expect(
      ctx.editor.insertMarkdown("x", { replace: "nope" }),
    ).rejects.toMatchObject({
      code: "ref-unknown",
    });
    editor.destroy();
  });
});

describe("unloading a plugin drops its refs (spec 0067 §7.4, P3)", () => {
  it("unregisterPluginUI releases every recorded anchor and the mapping pass stops", async () => {
    const { editor } = realEditor("alpha @@beta@@ gamma\n");
    setEditorInstance(editor);
    const ctx = createExtensionContext(manifest(["editor"]), "/p");
    await ctx.editor.getSelection();
    await ctx.editor.getSelection();
    expect(anchorCount("real-probe")).toBe(2);

    // Positive sibling: while anchors are held, a document change is mapped through them.
    const held = anchorMappingPasses();
    editor.view.dispatch(editor.state.tr.insertText("z", 1));
    expect(anchorMappingPasses()).toBeGreaterThan(held);

    unregisterPluginUI("real-probe");
    expect(anchorCount("real-probe")).toBe(0);

    // The registry is empty, so a transaction no longer maps anything. A leak would keep
    // the pass counting here.
    const passes = anchorMappingPasses();
    editor.view.dispatch(editor.state.tr.insertText("z", 1));
    expect(anchorMappingPasses()).toBe(passes);
    editor.destroy();
  });
});
