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
import {
  abortEditorMutationTasks,
  awaitBoundToEditor,
  invalidateEditorMutationTasks,
} from "../../utils/editor/mutation-tasks";

// ── deferred IPC doubles ───────────────────────────────────────────────────

interface Deferred<T> {
  promise: Promise<T>;
  reject: (e: unknown) => void;
  resolve: (v: T) => void;
}

function deferred<T>(): Deferred<T> {
  let reject!: (e: unknown) => void;
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  // Nothing awaits a rejection until the test wires it up.
  promise.catch(() => {});
  return { promise, reject, resolve };
}

const createDirGate = { current: null as Deferred<void> | null };
const importedFiles: string[] = [];
/** Per-path gates so a test can park the flow inside importFile. */
const importGates = new Map<string, Deferred<void>>();

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(() => dialogGate.current?.promise ?? Promise.resolve(null)),
}));

const dialogGate = { current: null as Deferred<null | string[]> | null };

vi.mock("../../ipc/invoke", () => ({
  createDir: vi.fn(() => createDirGate.current?.promise ?? Promise.resolve()),
  importFile: vi.fn((from: string) => {
    importedFiles.push(from);
    return importGates.get(from)?.promise ?? Promise.resolve();
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

import { buildSlashItems } from "../../extensions/plugins/slash-command-items";
import { llmCancel, llmComplete } from "../../ipc/invoke";
import { useAIStore } from "../../stores/ai/ai";
import { dispatchCustomInstruction } from "../../utils/ai-action-dispatcher";
import * as aiCommands from "../../utils/ai-commands";
import { executeAICommand } from "../../utils/ai-commands";
import { executeBlockAIWithDiff } from "../../utils/block-ai-diff";
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

/**
 * The exact pair replaceEditorStateWithVim performs around an install.
 * Flows parked on a promise that only a cleanup can settle (the block-AI
 * decision) need the abort half, not just the invalidate half.
 */
function simulateStateInstall(view: Editor["view"]): void {
  invalidateEditorMutationTasks(view);
  abortEditorMutationTasks(view);
}

beforeEach(async () => {
  createDirGate.current = null;
  dialogGate.current = null;
  importedFiles.length = 0;
  importGates.clear();
  vi.mocked(llmComplete).mockClear();
  vi.mocked(llmCancel).mockClear();
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

  it("the abort-induced llmComplete rejection does not reset UI on the new document", async () => {
    // llmCancel makes the Rust side return Err("Request cancelled"), so the
    // catch block ALSO runs on the abort path — after the document has been
    // replaced. It must not touch the replacing tab's UI or AI diff.
    const editor = makeEditor("<p>hello</p>");
    const pending = deferred<void>();
    vi.mocked(llmComplete).mockReturnValueOnce(pending.promise);

    const result = renderSubmit(editor);
    await act(async () => {
      result.current.submitPrompt("rewrite");
      await flush();
    });
    expect(result.current.phase).toBe("streaming");

    invalidateEditorMutationTasks(editor.view);
    await act(async () => {
      pending.reject(new Error("Request cancelled"));
      await flush();
    });

    expect(result.current.phase).toBe("streaming");
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

describe("R8 follow-ups — stale work on the failure and dialog paths (§12-9c)", () => {
  it("slash photo import bound before the picker does not land in the replacing document", async () => {
    const editor = makeEditor("<p>doc A</p>");
    const gate = deferred<null | string[]>();
    dialogGate.current = gate;

    const photo = buildSlashItems(editor).find((i) => i.id === "photo");
    expect(photo).toBeDefined();

    const running = photo!.action();
    await flush(); // parked inside the native picker

    invalidateEditorMutationTasks(editor.view);

    gate.resolve(["/outside/photo.png"]);
    await running;
    await flush();

    // Registering only AFTER open() would have re-bound the photo to the
    // new generation and inserted it here.
    expect(importedFiles).toEqual([]);
    expect(editor.state.doc.toString()).not.toContain("image");
  });

  it("CONTROL: an uninterrupted slash photo import does insert", async () => {
    const editor = makeEditor("<p>doc A</p>");
    const gate = deferred<null | string[]>();
    dialogGate.current = gate;

    const photo = buildSlashItems(editor).find((i) => i.id === "photo");
    const running = photo!.action();
    await flush();
    gate.resolve(["/outside/photo.png"]);
    await running;
    await flush();

    expect(editor.state.doc.toString()).toContain("image");
  });

  it("a rejected import does not let the dead drop flow copy the next file", async () => {
    const editor = makeEditor();
    const firstImport = deferred<void>();
    importGates.set("/outside/one.png", firstImport);

    const done = handleEditorDrop(
      ["/outside/one.png", "/outside/two.png"],
      editor,
      1,
    );
    await flush();
    // Parked inside the first importFile; the second has not started.
    expect(importedFiles).toEqual(["/outside/one.png"]);

    invalidateEditorMutationTasks(editor.view);
    firstImport.reject(new Error("copy failed")); // I/O failure, not a cancel
    await done;

    // The per-iteration liveness gate must stop the loop: a check placed only
    // after a SUCCESSFUL import would let the catch fall through and copy
    // the second file into the previous tab's assets dir.
    expect(importedFiles).not.toContain("/outside/two.png");
    expect(editor.state.doc.toString()).not.toContain("image");
  });
});

describe("block AI — invalidation during stream setup (§12-9c, R8 finding 3)", () => {
  /** Park `listen` on its first call so the task can die mid-setup. */
  function gateFirstListen() {
    const gate = deferred<void>();
    let n = 0;
    vi.mocked(listen).mockImplementation(async () => {
      if (n++ === 0) await gate.promise;
      return () => {};
    });
    return gate;
  }

  beforeEach(() => {
    // Local provider needs no API key, so the configured-gate lets us through.
    useAIStore.setState({ autoModelEnabled: false, provider: "ollama" });
  });

  it("CONTROL: an uninterrupted block AI run fires the request", async () => {
    const editor = makeEditor("<p>target text</p>");
    void executeBlockAIWithDiff(editor, 0, "target text", "p", "sys");
    await flush();

    expect(vi.mocked(llmComplete)).toHaveBeenCalledTimes(1);
    document.querySelector(".block-ai-diff-overlay")?.remove();
  });

  it("a task that dies during createLLMStream neither requests nor leaves a panel", async () => {
    const editor = makeEditor("<p>target text</p>");
    const gate = gateFirstListen();

    void executeBlockAIWithDiff(editor, 0, "target text", "p", "sys");
    await flush(); // parked inside createLLMStream

    invalidateEditorMutationTasks(editor.view);
    gate.resolve();
    await flush();

    // Without the post-setup gate the request would fire with its listeners
    // already removed, stranding a "Streaming…" panel over the new tab.
    expect(vi.mocked(llmComplete)).not.toHaveBeenCalled();
    expect(document.querySelector(".block-ai-diff-overlay")).toBeNull();
  });
});

describe("R9 follow-ups — ownership and late invalidation (§12-9d)", () => {
  it("awaitBoundToEditor returns null when the document was replaced while waiting", async () => {
    const editor = makeEditor();
    const dialog = deferred<string>();

    const pending = awaitBoundToEditor(editor.view, dialog.promise);
    invalidateEditorMutationTasks(editor.view);
    dialog.resolve("English");

    expect(await pending).toBeNull();
  });

  it("awaitBoundToEditor passes the value through when nothing invalidates", async () => {
    const editor = makeEditor();
    const dialog = deferred<string>();

    const pending = awaitBoundToEditor(editor.view, dialog.promise);
    dialog.resolve("English");

    expect(await pending).toBe("English");
  });

  it("a late rejection from an aborted inline-AI request leaves the NEXT submit alone", async () => {
    // The catch runs on the abort path, and cleanupListeners works on shared
    // refs — so without request ownership it would cancel submit B.
    const editor = makeEditor("<p>hello</p>");
    const first = deferred<void>();
    vi.mocked(llmComplete).mockReturnValueOnce(first.promise);

    const { result } = renderHook(() => useInlineAI(editor));
    act(() => result.current.activate());

    await act(async () => {
      result.current.submitPrompt("A");
      await flush();
    });
    invalidateEditorMutationTasks(editor.view); // request A dies

    await act(async () => {
      result.current.submitPrompt("B"); // user resubmits
      await flush();
    });
    expect(result.current.phase).toBe("streaming");

    // cleanupListeners reads the SHARED activeRequestRef, so an unguarded
    // catch would cancel B here. Count cancels across the rejection instead
    // of asserting on phase: the dead-task branch returns before setPhase,
    // so the damage is invisible in the UI state.
    const cancelsBefore = vi.mocked(llmCancel).mock.calls.length;
    await act(async () => {
      first.reject(new Error("Request cancelled")); // A's late rejection
      await flush();
    });

    expect(vi.mocked(llmCancel).mock.calls.length).toBe(cancelsBefore);
    expect(result.current.phase).toBe("streaming");
  });

  it("an explicit cancel then resubmit: the old rejection cannot reset the new run", async () => {
    // cancel() does NOT invalidate the mutation task, so task A stays live —
    // an unguarded catch would take the full UI-reset branch and knock B's
    // phase back to "input" while it is still streaming.
    const editor = makeEditor("<p>hello</p>");
    const first = deferred<void>();
    vi.mocked(llmComplete).mockReturnValueOnce(first.promise);

    const { result } = renderHook(() => useInlineAI(editor));
    act(() => result.current.activate());
    await act(async () => {
      result.current.submitPrompt("A");
      await flush();
    });

    act(() => result.current.cancel());
    act(() => result.current.activate());
    await act(async () => {
      result.current.submitPrompt("B");
      await flush();
    });
    expect(result.current.phase).toBe("streaming");

    const cancelsBefore = vi.mocked(llmCancel).mock.calls.length;
    await act(async () => {
      first.reject(new Error("Request cancelled"));
      await flush();
    });

    expect(vi.mocked(llmCancel).mock.calls.length).toBe(cancelsBefore);
    expect(result.current.phase).toBe("streaming");
  });

  it("block AI invalidated while awaiting the decision settles and removes the panel", async () => {
    useAIStore.setState({ autoModelEnabled: false, provider: "ollama" });
    const editor = makeEditor("<p>target text</p>");

    let settled = false;
    const running = executeBlockAIWithDiff(
      editor,
      0,
      "target text",
      "p",
      "sys",
    ).then(() => {
      settled = true;
    });
    await flush();
    expect(document.querySelector(".block-ai-diff-overlay")).not.toBeNull();

    // Late invalidation: we are parked on waitForDecision.
    simulateStateInstall(editor.view);
    await flush();
    await running;

    expect(settled).toBe(true);
    expect(document.querySelector(".block-ai-diff-overlay")).toBeNull();
  });

  it("executeAICommand does not fire the request when its stream setup was invalidated", async () => {
    useAIStore.setState({ autoModelEnabled: false, provider: "ollama" });
    const editor = makeEditor("<p>hello</p>");
    const gate = deferred<void>();
    let n = 0;
    vi.mocked(listen).mockImplementation(async () => {
      if (n++ === 0) await gate.promise;
      return () => {};
    });

    const running = executeAICommand(editor, "prompt", "sys");
    await flush(); // parked inside createLLMStream

    invalidateEditorMutationTasks(editor.view);
    gate.resolve();
    await running;

    expect(vi.mocked(llmComplete)).not.toHaveBeenCalled();
  });
});

describe("R10 follow-ups — call sites and lifecycle safety (§12-9g)", () => {
  /** Park the Nth `listen` call, optionally rejecting it. */
  function gateListen(callIndex: number, mode: "park" | "reject" = "park") {
    const gate = deferred<void>();
    let n = 0;
    vi.mocked(listen).mockImplementation(async () => {
      if (n++ === callIndex) {
        await gate.promise;
        if (mode === "reject") throw new Error("listen failed");
      }
      return () => {};
    });
    return gate;
  }

  it("block AI survives a stream-setup rejection without stranding the overlay", async () => {
    // Every dismissal affordance (buttons, Escape, backdrop) is wired inside
    // waitForDecision, so a throw before it used to leave a full-screen
    // overlay the user could not close.
    useAIStore.setState({ autoModelEnabled: false, provider: "ollama" });
    const editor = makeEditor("<p>target text</p>");
    const gate = gateListen(1, "reject");

    const running = executeBlockAIWithDiff(editor, 0, "target text", "p", "s");
    await flush();
    gate.resolve();
    await running; // must settle, not throw

    expect(document.querySelector(".block-ai-diff-overlay")).toBeNull();
  });

  it("a same-document edit before the stream anchor does not misplace later tokens", async () => {
    // Mutation generation only advances on a whole-state install, so an
    // ordinary edit above the insertion point leaves the task live — the
    // position itself has to be mapped through the transaction.
    useAIStore.setState({ autoModelEnabled: false, provider: "ollama" });
    const editor = makeEditor("<p>hello</p>");
    const handlers: Record<string, (e: unknown) => void> = {};
    vi.mocked(listen).mockImplementation(async (event, handler) => {
      handlers[event as string] = handler as (e: unknown) => void;
      return () => {};
    });
    const pending = deferred<void>();
    vi.mocked(llmComplete).mockReturnValueOnce(pending.promise);

    const running = executeAICommand(editor, "p", "s");
    await flush();

    // The stream filters by requestId, so read the id the command generated.
    const requestId = vi.mocked(llmComplete).mock.calls[0][2];
    const send = (token: string) =>
      handlers["llm:token"]?.({ payload: { requestId, token } });

    send("AAA");
    await flush();

    // A concurrent edit ABOVE the anchor shifts every later position.
    editor.view.dispatch(editor.state.tr.insertText("XX", 1));
    await flush();

    send("BBB");
    await flush();

    expect(editor.state.doc.textContent).toContain("AAABBB");

    pending.resolve();
    await running;
  });

  it("an invalidated AI command detaches its transaction listener even if the request never settles", async () => {
    // The finally cannot save us here: the request stays pending forever, so
    // detach has to hang off the mutation task. A leaked handler would keep
    // mapping a stale position across the NEW document's transactions.
    useAIStore.setState({ autoModelEnabled: false, provider: "ollama" });
    const editor = makeEditor("<p>hello</p>");
    const never = deferred<void>();
    vi.mocked(llmComplete).mockReturnValueOnce(never.promise);

    const offSpy = vi.spyOn(editor, "off");

    void executeAICommand(editor, "p", "s");
    await flush();
    // Sanity: the command attached its position tracker.
    expect(offSpy).not.toHaveBeenCalledWith(
      "transaction",
      expect.any(Function),
    );

    simulateStateInstall(editor.view);
    await flush();

    expect(offSpy).toHaveBeenCalledWith("transaction", expect.any(Function));

    never.resolve();
    offSpy.mockRestore();
  });

  it("dispatchCustomInstruction abandons its prompt when the document is replaced", async () => {
    // targetPos/blockText below are bound to THIS document — applying them
    // after a state install would write at a stale position.
    const editor = makeEditor("<p>block text</p>");
    const gate = deferred<null | string>();
    const promptSpy = vi
      .spyOn(aiCommands, "showPrompt")
      .mockReturnValue(gate.promise);

    dispatchCustomInstruction(editor, 0);
    await flush();
    invalidateEditorMutationTasks(editor.view);
    gate.resolve("make it shorter");
    await flush();

    expect(vi.mocked(llmComplete)).not.toHaveBeenCalled();
    promptSpy.mockRestore();
  });

  it("CONTROL: dispatchCustomInstruction runs when nothing invalidates", async () => {
    useAIStore.setState({ autoModelEnabled: false, provider: "ollama" });
    const editor = makeEditor("<p>block text</p>");
    const gate = deferred<null | string>();
    const promptSpy = vi
      .spyOn(aiCommands, "showPrompt")
      .mockReturnValue(gate.promise);

    dispatchCustomInstruction(editor, 0);
    await flush();
    gate.resolve("make it shorter");
    await flush();

    expect(vi.mocked(llmComplete)).toHaveBeenCalledTimes(1);
    promptSpy.mockRestore();
  });

  it("CONTROL: the slash ai-write action runs when nothing invalidates", async () => {
    useAIStore.setState({ autoModelEnabled: false, provider: "ollama" });
    const editor = makeEditor("<p>doc</p>");
    const gate = deferred<null | string>();
    const promptSpy = vi
      .spyOn(aiCommands, "showPrompt")
      .mockReturnValue(gate.promise);

    const item = buildSlashItems(editor).find((i) => i.id === "ai-write");
    const running = item!.action();
    await flush();
    gate.resolve("a topic");
    await running;
    await flush();

    expect(vi.mocked(llmComplete)).toHaveBeenCalledTimes(1);
    promptSpy.mockRestore();
  });

  it("the slash ai-write action abandons its prompt when the document is replaced", async () => {
    const editor = makeEditor("<p>doc</p>");
    const gate = deferred<null | string>();
    const promptSpy = vi
      .spyOn(aiCommands, "showPrompt")
      .mockReturnValue(gate.promise);

    const item = buildSlashItems(editor).find((i) => i.id === "ai-write");
    expect(item).toBeDefined();
    const running = item!.action();
    await flush();
    invalidateEditorMutationTasks(editor.view);
    gate.resolve("a topic");
    await running;
    await flush();

    expect(vi.mocked(llmComplete)).not.toHaveBeenCalled();
    promptSpy.mockRestore();
  });
});
