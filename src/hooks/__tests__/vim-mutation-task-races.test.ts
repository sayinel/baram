// §298 §12-9 (design §5c) — regression tests for the "register after the
// async gap" defect class found by adversarial review round 7.
//
// The shared failure mode: a flow captures document-bound state (tab, asset
// dir, insert position, prompt context), THEN awaits, and only registers its
// mutation task afterwards. A state install during that gap finds no task to
// invalidate, so the continuation registers into the NEW generation and
// isLive() answers true for work that belongs to the previous document.
//
// Every test below pairs a CONTROL run (no invalidation → the flow completes)
// with an INVALIDATED run. Without the control a mis-built fixture would make
// the invalidated assertion pass vacuously.

import { Editor } from "@tiptap/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createBaramExtensions } from "../../extensions";
import { invalidateEditorMutationTasks } from "../../utils/editor/mutation-tasks";

// ── deferred IPC doubles ───────────────────────────────────────────────────

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (v: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const createDirGate = { current: null as Deferred<void> | null };
const importedFiles: string[] = [];

vi.mock("../../ipc/invoke", () => ({
  createDir: vi.fn(() => createDirGate.current?.promise ?? Promise.resolve()),
  importFile: vi.fn((from: string) => {
    importedFiles.push(from);
    return Promise.resolve();
  }),
  getConfig: vi.fn(() => Promise.resolve(null)),
  listDir: vi.fn(() => Promise.resolve([])),
  llmCancel: vi.fn(() => Promise.resolve(true)),
  llmComplete: vi.fn(() => Promise.resolve()),
  setConfig: vi.fn(() => Promise.resolve()),
}));

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: () => Promise.resolve(vi.fn()),
  }),
}));

import { listen } from "@tauri-apps/api/event";

import { act, renderHook } from "@testing-library/react";

import { llmComplete } from "../../ipc/invoke";
import { useAIStore } from "../../stores/ai/ai";
import { handleEditorDrop } from "../use-external-drop";
import { useGhostText } from "../use-ghost-text";
import { useInlineAI } from "../use-inline-ai";

const editors: Editor[] = [];

/** Give queued microtasks (the awaited IPC continuations) a chance to run. */
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

function makeEditor(content = "<p>original</p>"): Editor {
  const editor = new Editor({
    content,
    extensions: createBaramExtensions(),
  });
  editors.push(editor);
  return editor;
}

beforeEach(async () => {
  createDirGate.current = null;
  importedFiles.length = 0;
  vi.mocked(llmComplete).mockClear();
  const { useEditorStore } = await import("../../stores/editor/editor");
  useEditorStore.setState({
    activeTabId: "tab-a",
    tabs: [
      {
        contextId: "ctx",
        filePath: "/vault/a.md",
        id: "tab-a",
        isDirty: false,
        isPinned: false,
        title: "a",
      },
    ],
  });
});

afterEach(() => {
  for (const e of editors.splice(0)) e.destroy();
});

describe("native image drop — invalidation during createDir (§12-9, R7 finding 2)", () => {
  it("CONTROL: with no invalidation the image lands in the document", async () => {
    const editor = makeEditor();
    const gate = deferred<void>();
    createDirGate.current = gate;

    const done = handleEditorDrop(["/outside/photo.png"], editor, 1);
    gate.resolve();
    await done;

    expect(importedFiles).toEqual(["/outside/photo.png"]);
    expect(editor.state.doc.toString()).toContain("image");
  });

  it("a state install while createDir is unresolved cancels the insert", async () => {
    const editor = makeEditor();
    const before = editor.state.doc.toString();
    const gate = deferred<void>();
    createDirGate.current = gate;

    const done = handleEditorDrop(["/outside/photo.png"], editor, 1);
    await flush(); // the flow is now parked inside createDir

    // What replaceEditorStateWithVim does synchronously before updateState.
    invalidateEditorMutationTasks(editor.view);

    gate.resolve();
    await done;

    // The copy may or may not have started, but nothing reaches the document:
    // the asset path and insert position belonged to the previous tab.
    expect(editor.state.doc.toString()).toBe(before);
    expect(editor.state.doc.toString()).not.toContain("image");
  });

  it("the task is registered before the first await, so invalidation has something to kill", async () => {
    // Direct expression of the contract: invalidating while parked in the
    // FIRST await must stop the flow. If registration moved back after the
    // IPC calls, the continuation would register into the new generation
    // and this assertion would fail.
    const editor = makeEditor();
    const gate = deferred<void>();
    createDirGate.current = gate;

    const done = handleEditorDrop(["/outside/photo.png"], editor, 1);
    await flush();
    invalidateEditorMutationTasks(editor.view);
    gate.resolve();
    await done;

    expect(importedFiles).toEqual([]); // never even copied the file
  });
});

describe("inline AI — invalidation during listener setup (§12-9, R7 finding 3)", () => {
  /** Make `listen` park on the Nth call so we can invalidate mid-setup. */
  function gateListenAt(callIndex: number) {
    const gate = deferred<void>();
    const unlistens: ReturnType<typeof vi.fn>[] = [];
    let n = 0;
    vi.mocked(listen).mockImplementation(async () => {
      const un = vi.fn();
      unlistens.push(un);
      if (n++ === callIndex) await gate.promise;
      return un;
    });
    return { gate, unlistens };
  }

  function renderSubmit(editor: Editor) {
    const { result } = renderHook(() => useInlineAI(editor));
    act(() => result.current.activate());
    return result;
  }

  it("CONTROL: an uninterrupted submit reaches llmComplete", async () => {
    const editor = makeEditor("<p>hello</p>");
    const result = renderSubmit(editor);

    await act(async () => {
      result.current.submitPrompt("rewrite");
      await flush();
    });

    expect(vi.mocked(llmComplete)).toHaveBeenCalledTimes(1);
  });

  it("a state install during listener setup never fires the request", async () => {
    const editor = makeEditor("<p>hello</p>");
    const { gate } = gateListenAt(0);
    const result = renderSubmit(editor);

    await act(async () => {
      result.current.submitPrompt("rewrite");
      await flush(); // parked inside the first listen()
    });

    invalidateEditorMutationTasks(editor.view);

    await act(async () => {
      gate.resolve();
      await flush();
    });

    // llmCancel cannot stop a request the backend never registered, so the
    // request must not be sent at all.
    expect(vi.mocked(llmComplete)).not.toHaveBeenCalled();
  });

  it("listeners installed before the invalidation are torn down", async () => {
    const editor = makeEditor("<p>hello</p>");
    const { gate, unlistens } = gateListenAt(1); // park on the SECOND listen

    const result = renderSubmit(editor);
    await act(async () => {
      result.current.submitPrompt("rewrite");
      await flush();
    });

    invalidateEditorMutationTasks(editor.view);
    await act(async () => {
      gate.resolve();
      await flush();
    });

    // The first listener already existed when the task died; storing handles
    // one-by-one (not as a batch at the end) is what lets cleanup reach it.
    expect(unlistens.length).toBeGreaterThan(0);
    expect(unlistens[0]).toHaveBeenCalled();
    expect(vi.mocked(llmComplete)).not.toHaveBeenCalled();
  });
});

describe("ghost text — invalidation during the debounce (§12-9, R7 finding 1)", () => {
  beforeEach(() => {
    useAIStore.setState({
      ghostTextDebounceMs: 50,
      ghostTextEnabled: true,
      privacyMode: false,
    });
  });

  /** Type into the doc so useGhostText's "update" handler runs. */
  function typeSomething(editor: Editor) {
    act(() => {
      editor.commands.insertContentAt(editor.state.doc.content.size - 1, "xyz");
    });
  }

  it("CONTROL: the debounced request fires when nothing invalidates it", async () => {
    const editor = makeEditor("<p>some prose here</p>");
    renderHook(() => useGhostText(editor));

    typeSomething(editor);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 120));
      await flush();
    });

    expect(vi.mocked(llmComplete)).toHaveBeenCalledTimes(1);
  });

  it("a state install during the debounce cancels the pending request", async () => {
    const editor = makeEditor("<p>some prose here</p>");
    renderHook(() => useGhostText(editor));

    typeSomething(editor);
    // Synchronously after the keystroke — the timer has not fired yet. The
    // task must already exist here, otherwise there is nothing to invalidate
    // and the callback would later register into the new generation and
    // paint this document's suggestion into the next one.
    invalidateEditorMutationTasks(editor.view);

    await act(async () => {
      await new Promise((r) => setTimeout(r, 120));
      await flush();
    });

    expect(vi.mocked(llmComplete)).not.toHaveBeenCalled();
  });
});
