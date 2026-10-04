// #322 — the TRUSTED tier refuses a stale editor surface, as the sandboxed tier already did.
//
// An editor instance being present does not mean it holds what the user is editing. Phase 4b
// enumerated five states where it does not, gave the sandboxed tier `editorSurfaceBlocked()`, and
// left `createEditorAPI` consulting only `editorInstance` — so in all five a trusted plugin's read
// was silently STALE and its write silently DISCARDED, by the next save, the next source-mode
// toggle, or the pending `updateState`. A plugin doing read-modify-write lost the user's edits and
// the API reported success.
//
// A correctness property, not a boundary one, so §259's "the trusted capability gate is not a
// trust boundary" does not excuse it: a cooperating trusted plugin cannot detect these states for
// itself.
//
// ‼️ THE THREE LIVE STATES ARE DRIVEN THROUGH THE REAL PREDICATE, not through a reason string
// passed to `setEditorSurfaceBlocked`. A first draft invented strings like "the document is still
// loading" and asserted against them, which tests nothing but my own fixture — and two of the five
// states are not reported by the App at all, they are computed per call from the editor store.
// `host-editor-bridge.test.ts` makes the same choice for the same reason.
import { beforeEach, describe, expect, it, vi } from "vitest";

// `real-editor.ts` pulls in `createBaramExtensions`, which reaches the opener plugin.
vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn().mockResolvedValue(undefined),
}));

import type { EditorAPI, PluginManifest } from "../types";

import { useEditorStore } from "../../stores/editor/editor";
import {
  markContentLoaded,
  setTabLoading,
} from "../../utils/editor/programmatic-update";
import {
  createExtensionContext,
  setEditorInstance,
  setEditorSurfaceBlocked,
} from "../extension-context";
import { realEditor } from "./real-editor";

const manifest = (capabilities: string[]): PluginManifest =>
  ({
    author: "t",
    capabilities,
    description: "d",
    engines: { baram: ">=0.5.0" },
    id: "surface-probe",
    license: "MIT",
    main: "index.mjs",
    name: "Surface Probe",
    trust: "trusted",
    version: "1.0.0",
  }) as unknown as PluginManifest;

/**
 * A handle that would answer happily if it were ever reached — except that every member
 * records its use and throws, because a blocked surface must refuse before touching it. Only
 * members the API reads are here.
 */
function fakeEditor() {
  const calls: string[] = [];
  const touched = (name: string) => () => {
    calls.push(name);
    throw new Error(`${name} was reached through a blocked surface`);
  };
  return {
    calls,
    handle: {
      commands: {},
      getText: touched("getText"),
      get schema(): never {
        return touched("schema")();
      },
      get state(): never {
        return touched("state")();
      },
      get view(): never {
        return touched("view")();
      },
    },
  };
}

let editor: ReturnType<typeof fakeEditor>;

/** Put the surface in the one state where the editor really is the tab's content. */
function clearSurface(): void {
  setEditorSurfaceBlocked(null);
  useEditorStore.setState({ activeTabId: "tab-A" });
  setTabLoading("tab-A", false);
  markContentLoaded("tab-A");
}

const ctx = (capability = "editor") =>
  createExtensionContext(manifest([capability]), "/p");

beforeEach(() => {
  editor = fakeEditor();
  setEditorInstance(editor.handle);
  clearSurface();
});

describe("a clear surface answers — the complement", () => {
  // Without this, "refuse everything" would satisfy every case below.
  it("reads the document and accepts a write", async () => {
    const real = realEditor("alpha @@ omega\n");
    setEditorInstance(real.editor);
    clearSurface();
    expect(await ctx().editor.getMarkdown()).toBe("alpha  omega\n");
    await ctx().editor.insertText("x");
    expect(real.editor.state.doc.textContent).toBe("alpha x omega");
    real.editor.destroy();
  });
});

/** Every method of the API, as a call a plugin would make. */
const ALL_CALLS: [string, (e: EditorAPI) => Promise<unknown>][] = [
  ["getMarkdown", (e) => e.getMarkdown()],
  ["getSelection", (e) => e.getSelection()],
  ["getText", (e) => e.getText()],
  ["insertMarkdown", (e) => e.insertMarkdown("x")],
  ["insertText", (e) => e.insertText("y")],
  ["setMarkdown", (e) => e.setMarkdown("z")],
];

/** The two states the App reports, with the reasons it actually reports. */
describe.each([
  ["source mode", "source mode is open"],
  ["a non-markdown tab", "the active tab is not a markdown document"],
])("refuses in %s (App-reported)", (_label, reason) => {
  beforeEach(() => setEditorSurfaceBlocked(reason));

  it.each(ALL_CALLS)(
    "refuses %s without touching the editor",
    async (_name, call) => {
      // A read that reaches the editor has already produced the stale document; a write that
      // lands is the half that ate the user's edits — the transaction applies to a document
      // the next save or `updateState` is about to replace.
      await expect(call(ctx().editor)).rejects.toMatchObject({
        code: "surface-blocked",
        message: expect.stringContaining(reason),
      });
      expect(editor.calls).toEqual([]);
    },
  );
});

describe("refuses in the three states computed live from the editor store", () => {
  it("no tabs open — closing the last tab leaves the handle alive", async () => {
    // `setEditor` is never called with null: the `?? editor` fallback in
    // `use-keepalive-editors.ts`'s `handleActiveEditorChange` falls back to the shared editor
    // explicitly, and the remaining `App.tsx` call site only calls `setEditor` when `editor` is
    // truthy — so without this the plugin gets the document the user just closed.
    useEditorStore.setState({ activeTabId: null });
    await expect(ctx().editor.getMarkdown()).rejects.toMatchObject({
      code: "surface-blocked",
      message: expect.stringMatching(/no document is open/),
    });
    expect(editor.calls).toEqual([]);
  });

  it("progressive load — the editor holds only the first chunk", async () => {
    setTabLoading("tab-A", true);
    await expect(ctx().editor.getMarkdown()).rejects.toMatchObject({
      code: "surface-blocked",
      message: expect.stringMatching(/still loading/),
    });
    expect(editor.calls).toEqual([]);
  });

  it("a tab switch in flight — activeTabId has flipped, the editor has not", async () => {
    useEditorStore.setState({ activeTabId: "tab-B" });
    markContentLoaded("tab-A"); // the editor still shows A
    await expect(ctx().editor.getMarkdown()).rejects.toMatchObject({
      code: "surface-blocked",
      message: expect.stringMatching(/has not finished switching/),
    });
    expect(editor.calls).toEqual([]);

    // A window, not a ban: once the switch completes the same call works.
    const real = realEditor("alpha\n");
    setEditorInstance(real.editor);
    markContentLoaded("tab-B");
    expect(await ctx().editor.getMarkdown()).toBe("alpha\n");
    real.editor.destroy();
  });
});

describe("the refusals stay distinguishable", () => {
  it("no editor at all reads differently from a blocked surface", async () => {
    // "no editor is open" and "source mode is open" are different situations for the author.
    setEditorInstance(null);
    await expect(ctx().editor.getMarkdown()).rejects.toMatchObject({
      code: "no-editor",
      message: expect.stringContaining("no editor is open"),
    });
  });

  it("capability comes before surface for a readonly plugin", async () => {
    // A readonly plugin should be told about the capability, not about a surface state it can
    // do nothing about.
    setEditorSurfaceBlocked("source mode is open");
    await expect(
      ctx("editor:readonly").editor.setMarkdown("x"),
    ).rejects.toMatchObject({ code: "not-permitted" });
  });

  it("names the failing method, as the sandboxed tier does", async () => {
    setEditorSurfaceBlocked("source mode is open");
    const api = ctx().editor;
    await expect(api.getMarkdown()).rejects.toThrow(/^editor\.getMarkdown: /);
    await expect(api.getSelection()).rejects.toThrow(/^editor\.getSelection: /);
    await expect(api.insertText("x")).rejects.toThrow(/^editor\.insertText: /);
  });
});
