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
import type { PluginManifest } from "../types";

import { beforeEach, describe, expect, it } from "vitest";

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

/** A handle that would answer happily if it were ever reached. */
function fakeEditor() {
  const calls: string[] = [];
  return {
    calls,
    handle: {
      commands: {
        insertContent: (t: string) => calls.push(`insertContent:${t}`),
        setContent: (c: { content: string }) =>
          calls.push(`setContent:${c.content}`),
      },
      getText: () => {
        calls.push("getText");
        return "THE DOCUMENT";
      },
      state: {
        doc: { textBetween: () => "" },
        selection: { from: 1, to: 1 },
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
  it("reads the document", () => {
    // Without this, "refuse everything" would satisfy every case below.
    expect(ctx().editor.getContent()).toBe("THE DOCUMENT");
  });

  it("accepts a write", () => {
    ctx().editor.setContent("replacement");
    expect(editor.calls).toEqual(["setContent:replacement"]);
  });
});

/** The two states the App reports, with the reasons it actually reports. */
describe.each([
  ["source mode", "source mode is open"],
  ["a non-markdown tab", "the active tab is not a markdown document"],
])("refuses in %s (App-reported)", (_label, reason) => {
  beforeEach(() => setEditorSurfaceBlocked(reason));

  it("refuses a read without touching the editor", () => {
    // A read that reaches `getText()` has already produced the stale string.
    expect(() => ctx().editor.getContent()).toThrow(reason);
    expect(editor.calls).toEqual([]);
  });

  it("refuses both writes without dispatching", () => {
    // A write that lands is the half that ate the user's edits: the transaction applies to a
    // document the next save or `updateState` is about to replace.
    expect(() => ctx().editor.setContent("x")).toThrow(reason);
    expect(() => ctx().editor.insertText("y")).toThrow(reason);
    expect(editor.calls).toEqual([]);
  });

  it("refuses getSelection", () => {
    expect(() => ctx().editor.getSelection()).toThrow(reason);
  });
});

describe("refuses in the three states computed live from the editor store", () => {
  it("no tabs open — closing the last tab leaves the handle alive", () => {
    // `setEditor` is never called with null (both `App.tsx` call sites fall back to the shared
    // editor), so without this the plugin gets the document the user just closed.
    useEditorStore.setState({ activeTabId: null });
    expect(() => ctx().editor.getContent()).toThrow(/no document is open/);
    expect(editor.calls).toEqual([]);
  });

  it("progressive load — the editor holds only the first chunk", () => {
    setTabLoading("tab-A", true);
    expect(() => ctx().editor.getContent()).toThrow(/still loading/);
    expect(editor.calls).toEqual([]);
  });

  it("a tab switch in flight — activeTabId has flipped, the editor has not", () => {
    useEditorStore.setState({ activeTabId: "tab-B" });
    markContentLoaded("tab-A"); // the editor still shows A
    expect(() => ctx().editor.getContent()).toThrow(
      /has not finished switching/,
    );
    expect(editor.calls).toEqual([]);

    // A window, not a ban: once the switch completes the same call works.
    markContentLoaded("tab-B");
    expect(ctx().editor.getContent()).toBe("THE DOCUMENT");
  });
});

describe("the refusals stay distinguishable", () => {
  it("no editor at all reads differently from a blocked surface", () => {
    // "no editor is open" and "source mode is open" are different situations for the author.
    setEditorInstance(null);
    expect(() => ctx().editor.getContent()).toThrow("no editor is open");
  });

  it("capability comes before surface for a readonly plugin", () => {
    // A readonly plugin should be told about the capability, not about a surface state it can
    // do nothing about.
    setEditorSurfaceBlocked("source mode is open");
    expect(() => ctx("editor:readonly").editor.setContent("x")).toThrow(
      /editor:readonly/,
    );
  });

  it("names the failing method, as the sandboxed tier does", () => {
    setEditorSurfaceBlocked("source mode is open");
    const api = ctx().editor;
    expect(() => api.getContent()).toThrow(/^editor\.getContent: /);
    expect(() => api.getSelection()).toThrow(/^editor\.getSelection: /);
    expect(() => api.insertText("x")).toThrow(/^editor\.insertText: /);
  });
});
