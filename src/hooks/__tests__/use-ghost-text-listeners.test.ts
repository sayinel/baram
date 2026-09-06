// issue 265 — ghost text opens an LLM stream on nearly every keystroke, so its
// listener lifecycle has to be airtight: registration that fails half-way must
// roll back, an invalidation while a registration is awaited must tear the
// listeners down at once, done/error must release them, and the prefetch must
// release them on every path while still reporting what went wrong.
import { listen } from "@tauri-apps/api/event";
import type { Event } from "@tauri-apps/api/event";

import { act, renderHook } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createBaramExtensions } from "../../extensions";
import {
  LLM_CANCELLED_REJECTION,
  llmCancel,
  llmComplete,
} from "../../ipc/invoke";
import { useAIStore } from "../../stores/ai/ai";
import { useEditorStore } from "../../stores/editor/editor";
import { subscribeToAsyncErrors } from "../../utils/async-error-policy";
import {
  abortEditorMutationTasks,
  invalidateEditorMutationTasks,
} from "../../utils/editor/mutation-tasks";
import { createLLMStream } from "../../utils/llm-stream";
import { useGhostText } from "../use-ghost-text";

vi.mock("../../ipc/invoke", async (importOriginal) => {
  // The cancel-rejection contract is real; only the IPC calls are doubles.
  const { isLLMCancelledRejection, LLM_CANCELLED_REJECTION } =
    await importOriginal<typeof import("../../ipc/invoke")>();
  return {
    getConfig: vi.fn(() => Promise.resolve(null)),
    isLLMCancelledRejection,
    keyringDeleteProviderKey: vi.fn(() => Promise.resolve()),
    keyringProviderConfigured: vi.fn(() => Promise.resolve(false)),
    keyringSetProviderKey: vi.fn(() => Promise.resolve()),
    LLM_CANCELLED_REJECTION,
    llmCancel: vi.fn(() => Promise.resolve(true)),
    llmComplete: vi.fn(() => Promise.resolve()),
    setConfig: vi.fn(() => Promise.resolve()),
  };
});

const accepted = {
  current: null as ((text: string, pos: number) => void) | null,
};

// The real createLLMStream behind a mock, so one test can act in the gap
// between the registration settling and the hook's await continuation.
const streamModule = vi.hoisted(() => ({
  actual: null as
    null | typeof import("../../utils/llm-stream").createLLMStream,
}));
vi.mock("../../utils/llm-stream", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../utils/llm-stream")>();
  streamModule.actual = actual.createLLMStream;
  return { ...actual, createLLMStream: vi.fn(actual.createLLMStream) };
});
vi.mock("../../extensions/plugins/ghost-text", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../extensions/plugins/ghost-text")
    >();
  return {
    ...actual,
    registerGhostTextAcceptedCallback: vi.fn(
      (cb: ((text: string, pos: number) => void) | null) => {
        accepted.current = cb;
      },
    ),
  };
});

const mockListen = vi.mocked(listen);
const mockComplete = vi.mocked(llmComplete);
const mockCreateStream = vi.mocked(createLLMStream);

interface Gate {
  promise: Promise<void>;
  resolve: () => void;
}

type Handler = (event: Event<unknown>) => void;

/** A Tauri event envelope around `payload`, as listen() handlers receive it. */
function ev(payload: unknown): Event<unknown> {
  return { event: "llm", id: 0, payload };
}

function gate(): Gate {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

/** Sequential listen() double: optional gate or rejection at the Nth call. */
function arrangeListen(opts: { gateAt?: number; rejectAt?: number } = {}) {
  const unlistens: ReturnType<typeof vi.fn>[] = [];
  const handlers: Record<string, Handler[]> = {};
  const parked = gate();
  let call = 0;
  mockListen.mockImplementation(async (event: string, handler: Handler) => {
    call += 1;
    if (call === opts.gateAt) await parked.promise;
    if (call === opts.rejectAt) throw new Error(`listen ${call} failed`);
    (handlers[event] ??= []).push(handler);
    const un = vi.fn();
    unlistens.push(un);
    return un;
  });
  return { handlers, parked, unlistens };
}

const editors: Editor[] = [];

async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 3; i++) {
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 0));
    }
  });
}

function makeEditor(content: string): Editor {
  const editor = new Editor({ content, extensions: createBaramExtensions() });
  editors.push(editor);
  return editor;
}

/** Type into the doc so useGhostText's "update" handler runs, then let the
 *  debounce fire. */
async function typeAndWait(editor: Editor): Promise<void> {
  act(() => {
    editor.commands.insertContentAt(editor.state.doc.content.size - 1, "xyz");
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 80));
  });
  await flush();
}

beforeEach(() => {
  mockListen.mockReset();
  mockComplete.mockReset();
  mockComplete.mockImplementation(() => Promise.resolve());
  // restoreAllMocks in afterEach leaves the factory mocks without an
  // implementation; the hook's cleanup calls llmCancel(...).catch(...).
  vi.mocked(llmCancel).mockClear();
  vi.mocked(llmCancel).mockImplementation(() => Promise.resolve(true));
  mockCreateStream.mockImplementation(streamModule.actual!);
  accepted.current = null;
  useEditorStore.setState({ activeTabId: null, tabs: [] });
  useAIStore.setState({
    ghostTextDebounceMs: 30,
    ghostTextEnabled: true,
    privacyMode: false,
  });
});

afterEach(() => {
  for (const e of editors.splice(0)) e.destroy();
  vi.restoreAllMocks();
});

describe("ghost text listener lifecycle (issue 265)", () => {
  it("CONTROL: a keystroke registers three listeners and fires the request", async () => {
    const { unlistens } = arrangeListen();
    const editor = makeEditor("<p>control document</p>");
    renderHook(() => useGhostText(editor));
    await typeAndWait(editor);
    expect(unlistens).toHaveLength(3);
    for (const un of unlistens) expect(un).not.toHaveBeenCalled();
    expect(mockComplete).toHaveBeenCalledTimes(1);
  });

  it("an invalidation while the second listen() is awaited releases every listener at once", async () => {
    const { parked, unlistens } = arrangeListen({ gateAt: 2 });
    const editor = makeEditor("<p>invalidated during listen</p>");
    renderHook(() => useGhostText(editor));
    await typeAndWait(editor);
    expect(unlistens).toHaveLength(1); // the first registered, the second is parked

    // The document is replaced under the pending registration: the task's
    // abort reaches the half-registered stream and releases the first handle
    // NOW, without waiting for the stalled listen() to answer.
    act(() => {
      invalidateEditorMutationTasks(editor.view);
      abortEditorMutationTasks(editor.view);
    });
    await flush();
    expect(unlistens[0]).toHaveBeenCalledTimes(1);

    // When the stalled listen() finally answers, its handle is released on
    // arrival; the third is never requested.
    parked.resolve();
    await flush();
    expect(unlistens).toHaveLength(2);
    for (const un of unlistens) expect(un).toHaveBeenCalledTimes(1);
    expect(mockComplete).not.toHaveBeenCalled();
  });

  it("an invalidation while the second listen() never settles releases the first at once", async () => {
    // The stalled registration never resolves, so there is no cleanup handle;
    // the abort signal joined to the task is the only way to reach it.
    const unlistens: ReturnType<typeof vi.fn>[] = [];
    let call = 0;
    mockListen.mockImplementation(async () => {
      call += 1;
      if (call === 2) await new Promise(() => {});
      const un = vi.fn();
      unlistens.push(un);
      return un;
    });
    const editor = makeEditor("<p>stalled registration</p>");
    renderHook(() => useGhostText(editor));
    await typeAndWait(editor);
    expect(unlistens).toHaveLength(1);
    expect(unlistens[0]).not.toHaveBeenCalled();

    act(() => {
      invalidateEditorMutationTasks(editor.view);
      abortEditorMutationTasks(editor.view);
    });
    await flush();
    expect(unlistens[0]).toHaveBeenCalledTimes(1);
    expect(mockComplete).not.toHaveBeenCalled();
  });

  it("the next keystroke aborts a registration that is still in flight", async () => {
    const unlistens: ReturnType<typeof vi.fn>[] = [];
    let call = 0;
    mockListen.mockImplementation(async () => {
      call += 1;
      if (call === 2) await new Promise(() => {}); // first request stalls here
      const un = vi.fn();
      unlistens.push(un);
      return un;
    });
    const editor = makeEditor("<p>keystroke aborts</p>");
    renderHook(() => useGhostText(editor));
    await typeAndWait(editor);
    expect(unlistens).toHaveLength(1);
    await typeAndWait(editor); // second request: aborts the first, registers three
    expect(unlistens).toHaveLength(4);
    expect(unlistens[0]).toHaveBeenCalledTimes(1);
    for (const un of unlistens.slice(1)) expect(un).not.toHaveBeenCalled();
    expect(mockComplete).toHaveBeenCalledTimes(1);
  });

  it("a listen() that rejects rolls the earlier one back, sends nothing, and is reported", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const reports = vi.fn();
    const off = subscribeToAsyncErrors(reports);
    const { unlistens } = arrangeListen({ rejectAt: 2 });
    const editor = makeEditor("<p>registration fails</p>");
    renderHook(() => useGhostText(editor));
    await typeAndWait(editor);

    expect(unlistens).toHaveLength(1);
    expect(unlistens[0]).toHaveBeenCalledTimes(1);
    expect(mockComplete).not.toHaveBeenCalled();
    expect(reports.mock.calls.map((c) => c[0].scope)).toEqual(["ghost-text"]);
    off();
  });

  it("llm:done releases the listeners without waiting for the next keystroke", async () => {
    const { handlers, unlistens } = arrangeListen();
    let finish!: () => void;
    mockComplete.mockImplementation(
      () => new Promise<void>((r) => (finish = r)),
    );
    const editor = makeEditor("<p>done releases</p>");
    renderHook(() => useGhostText(editor));
    await typeAndWait(editor);
    const requestId = mockComplete.mock.calls[0]![2] as string;

    act(() => {
      handlers["llm:token"]![0]!(ev({ requestId, token: " next" }));
      handlers["llm:done"]![0]!(ev({ requestId, totalTokens: 1 }));
    });
    for (const un of unlistens) expect(un).toHaveBeenCalledTimes(1);
    act(() => finish());
    await flush();
  });

  it("a superseded request's late done does not cache the current request's text", async () => {
    const { handlers } = arrangeListen();
    const pending: (() => void)[] = [];
    mockComplete.mockImplementation(
      () => new Promise<void>((r) => pending.push(r)),
    );
    const editor = makeEditor("<p>superseded request</p>");
    renderHook(() => useGhostText(editor));
    await typeAndWait(editor);
    const first = mockComplete.mock.calls[0]![2] as string;
    // A second keystroke replaces the request; the first's listeners are
    // torn down, but its done event may already be in flight.
    await typeAndWait(editor);
    const second = mockComplete.mock.calls[1]![2] as string;
    expect(second).not.toBe(first);
    act(() => {
      handlers["llm:token"]![1]!(ev({ requestId: second, token: "current" }));
      handlers["llm:done"]![0]!(ev({ requestId: first, totalTokens: 1 }));
    });
    for (const r of pending) r();
    await flush();

    // Had the old request's done cached "current" under ITS key (the text
    // after the first keystroke), a fresh editor typing that same text would
    // be served from cache and never reach the backend.
    const again = makeEditor("<p>superseded request</p>");
    renderHook(() => useGhostText(again));
    await typeAndWait(again);
    expect(mockComplete).toHaveBeenCalledTimes(3);
  });

  it("a stale registration that resolves late does not steal the current request's cleanup", async () => {
    // Request A parks on its third listen(); a keystroke starts request B,
    // which registers fully; then A's listen resolves. A's handle must not
    // replace B's, or the next keystroke would cancel B while unlistening A —
    // and a cancelled request emits no terminal event, so B's three
    // listeners would live for the rest of the window.
    const unlistens: ReturnType<typeof vi.fn>[] = [];
    const parked = gate();
    let call = 0;
    mockListen.mockImplementation(async () => {
      call += 1;
      if (call === 3) await parked.promise; // A's third registration
      const un = vi.fn();
      unlistens.push(un);
      return un;
    });
    const editor = makeEditor("<p>stale registration</p>");
    renderHook(() => useGhostText(editor));
    await typeAndWait(editor); // A: two listeners registered, third parked
    expect(unlistens).toHaveLength(2);
    // B's keystroke aborts A's in-flight registration — A's two handles are
    // released at once — and B registers three of its own.
    await typeAndWait(editor);
    expect(unlistens).toHaveLength(5);
    for (const un of unlistens.slice(0, 2)) expect(un).toHaveBeenCalledTimes(1);
    for (const un of unlistens.slice(2)) expect(un).not.toHaveBeenCalled();

    // A's stalled third listen() answers now: released on arrival, and A must
    // not have replaced B's handle in the shared ref.
    parked.resolve();
    await flush();
    expect(unlistens).toHaveLength(6);
    expect(unlistens[5]).toHaveBeenCalledTimes(1);
    for (const un of unlistens.slice(2, 5)) expect(un).not.toHaveBeenCalled();

    // C replaces B: B's three are released through the shared ref.
    await typeAndWait(editor);
    for (const un of unlistens.slice(2, 5)) expect(un).toHaveBeenCalledTimes(1);
  });

  it("unmount reaches a prefetch whose second listen() never settles", async () => {
    // Without a hook-owned registry the finally block is never entered and
    // listener 1 outlives the hook; a late listen 2 would even let the dead
    // hook register listener 3 and fire a request.
    const unlistens: ReturnType<typeof vi.fn>[] = [];
    let release!: () => void;
    let call = 0;
    mockListen.mockImplementation(async () => {
      call += 1;
      if (call === 2) await new Promise<void>((r) => (release = r));
      const un = vi.fn();
      unlistens.push(un);
      return un;
    });
    const editor = makeEditor("<p>One sentence. Two</p>");
    const { unmount } = renderHook(() => useGhostText(editor));
    act(() => {
      accepted.current!(" sentence.", editor.state.doc.content.size - 1);
    });
    await flush();
    expect(unlistens).toHaveLength(1);
    expect(mockComplete).not.toHaveBeenCalled();

    unmount();
    await flush();
    expect(unlistens[0]).toHaveBeenCalledTimes(1);

    release(); // the stalled listen answers after the hook is gone
    await flush();
    expect(unlistens).toHaveLength(2);
    expect(unlistens[1]).toHaveBeenCalledTimes(1); // released on arrival
    expect(mockComplete).not.toHaveBeenCalled(); // no request for a dead hook
  });

  it("unmount releases and cancels a prefetch whose request is still running", async () => {
    const { unlistens } = arrangeListen();
    const pending: (() => void)[] = [];
    mockComplete.mockImplementation(
      () => new Promise<void>((r) => pending.push(r)),
    );
    const editor = makeEditor("<p>One sentence. Two</p>");
    const { unmount } = renderHook(() => useGhostText(editor));
    act(() => {
      accepted.current!(" sentence.", editor.state.doc.content.size - 1);
    });
    await flush();
    expect(mockComplete).toHaveBeenCalledTimes(1);
    const requestId = mockComplete.mock.calls[0]![2] as string;
    expect(unlistens).toHaveLength(3);
    for (const un of unlistens) expect(un).not.toHaveBeenCalled();

    unmount();
    await flush();
    for (const un of unlistens) expect(un).toHaveBeenCalledTimes(1);
    expect(vi.mocked(llmCancel)).toHaveBeenCalledWith(requestId);
    for (const r of pending) r();
    await flush();
  });

  it("a cancel the hook asked for is not reported as a failure (main path)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const reports = vi.fn();
    const off = subscribeToAsyncErrors(reports);
    arrangeListen();
    // The backend answers llmCancel by rejecting the pending llm_complete
    // with its Cancelled error — a plain string over IPC, not a DOMException.
    const pending = new Map<string, (e: unknown) => void>();
    mockComplete.mockImplementation(
      (_p, _m, requestId) =>
        new Promise<void>((_r, rej) => pending.set(requestId as string, rej)),
    );
    vi.mocked(llmCancel).mockImplementation(async (requestId: string) => {
      pending.get(requestId)?.(LLM_CANCELLED_REJECTION);
      return true;
    });
    const editor = makeEditor("<p>cancel is routine</p>");
    renderHook(() => useGhostText(editor));
    await typeAndWait(editor);
    await typeAndWait(editor); // cancels the first request
    expect(mockComplete).toHaveBeenCalledTimes(2);
    expect(vi.mocked(llmCancel)).toHaveBeenCalledTimes(1);
    expect(reports).not.toHaveBeenCalled();
    off();
  });

  it("a torn-down prefetch neither reports its cancel nor writes the cache from queued events", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const reports = vi.fn();
    const off = subscribeToAsyncErrors(reports);
    const { handlers } = arrangeListen();
    const pending = new Map<string, (e: unknown) => void>();
    mockComplete.mockImplementation(
      (_p, _m, requestId) =>
        new Promise<void>((_r, rej) => pending.set(requestId as string, rej)),
    );
    vi.mocked(llmCancel).mockImplementation(async (requestId: string) => {
      pending.get(requestId)?.(LLM_CANCELLED_REJECTION);
      return true;
    });
    const editor = makeEditor("<p>Queued after teardown. Two</p>");
    const { unmount } = renderHook(() => useGhostText(editor));
    act(() => {
      accepted.current!(" sentence.", editor.state.doc.content.size - 1);
    });
    await flush();
    const requestId = mockComplete.mock.calls[0]![2] as string;

    unmount();
    await flush();
    // Events that were already queued when the hook went away.
    act(() => {
      handlers["llm:token"]![0]!(ev({ requestId, token: "stale" }));
      handlers["llm:done"]![0]!(ev({ requestId, totalTokens: 1 }));
    });
    await flush();
    expect(reports).not.toHaveBeenCalled();

    // Had "stale" been cached under the prefetch's key, a fresh hook typing
    // that same text would be served from cache instead of asking the backend.
    mockComplete.mockImplementation(() => Promise.resolve());
    const again = makeEditor("<p>Queued after teardown. Two sentence.</p>");
    renderHook(() => useGhostText(again));
    await typeAndWait(again);
    expect(mockComplete).toHaveBeenCalledTimes(2);
    off();
  });

  it("an unmount that lands after the last listen() settles but before the hook resumes starts no request", async () => {
    // All three handles are in, so the abort is too late for the registration,
    // and the effect cleanup finds no entry.cleanup yet and nothing to cancel.
    // Only the recheck before llmComplete keeps a dead hook from spending
    // provider tokens — and from leaking the three listeners it just got.
    const { unlistens } = arrangeListen();
    const editor = makeEditor("<p>Late unmount. Two</p>");
    const { unmount } = renderHook(() => useGhostText(editor));
    let unmountedInGap = false;
    mockCreateStream.mockImplementationOnce(async (...args) => {
      const cleanup = await streamModule.actual!(...args);
      // Registration settled; the hook's continuation has not run yet.
      unmount();
      unmountedInGap = true;
      return cleanup;
    });
    act(() => {
      accepted.current!(" sentence.", editor.state.doc.content.size - 1);
    });
    await flush();

    expect(unmountedInGap).toBe(true);
    expect(unlistens).toHaveLength(3);
    for (const un of unlistens) expect(un).toHaveBeenCalledTimes(1);
    expect(mockComplete).not.toHaveBeenCalled();
  });

  it("switching files tears down a prefetch that was warming the old file's cache", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const reports = vi.fn();
    const off = subscribeToAsyncErrors(reports);
    const { unlistens } = arrangeListen();
    const pending = new Map<string, (e: unknown) => void>();
    mockComplete.mockImplementation(
      (_p, _m, requestId) =>
        new Promise<void>((_r, rej) => pending.set(requestId as string, rej)),
    );
    vi.mocked(llmCancel).mockImplementation(async (requestId: string) => {
      pending.get(requestId)?.(LLM_CANCELLED_REJECTION);
      return true;
    });
    const tab = (id: string, filePath: string) => ({
      contextId: "ctx",
      filePath,
      id,
      isDirty: false,
      isPinned: false,
      title: id,
    });
    useEditorStore.setState({
      activeTabId: "a",
      tabs: [tab("a", "/vault/a.md"), tab("b", "/vault/b.md")],
    });
    const editor = makeEditor("<p>File a. Two</p>");
    renderHook(() => useGhostText(editor));
    await typeAndWait(editor); // the hook learns which file it is in
    act(() => {
      accepted.current!(" sentence.", editor.state.doc.content.size - 1);
    });
    await flush();
    const prefetchId = [...pending.keys()].find((id) =>
      id.startsWith("prefetch_"),
    );
    expect(prefetchId).toBeDefined();
    expect(unlistens).toHaveLength(6); // keystroke 3 + prefetch 3

    // The user switches to file b; its first update reaches the hook.
    act(() => {
      useEditorStore.setState({ activeTabId: "b" });
    });
    await typeAndWait(editor);

    expect(vi.mocked(llmCancel)).toHaveBeenCalledWith(prefetchId);
    // The prefetch's three handles are released (so are keystroke 1's, by
    // keystroke 2 as always); keystroke 2's own three are live.
    expect(unlistens).toHaveLength(9);
    for (const un of unlistens.slice(0, 6)) expect(un).toHaveBeenCalledTimes(1);
    for (const un of unlistens.slice(6)) expect(un).not.toHaveBeenCalled();
    expect(reports).not.toHaveBeenCalled();
    off();
  });

  it("a cancel that found nothing to cancel does not hide a later real failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const reports = vi.fn();
    const off = subscribeToAsyncErrors(reports);
    arrangeListen();
    const pending = new Map<string, (e: unknown) => void>();
    mockComplete.mockImplementation(
      (_p, _m, requestId) =>
        new Promise<void>((_r, rej) => pending.set(requestId as string, rej)),
    );
    // The backend had nothing under that id (already finished, or not yet
    // started): nothing was cancelled, so no routine rejection is coming.
    vi.mocked(llmCancel).mockImplementation(() => Promise.resolve(false));
    const editor = makeEditor("<p>cancel found nothing</p>");
    renderHook(() => useGhostText(editor));
    await typeAndWait(editor);
    const first = [...pending.keys()][0]!;
    await typeAndWait(editor); // asks to cancel the first request — in vain
    expect(vi.mocked(llmCancel)).toHaveBeenCalledWith(first);

    pending.get(first)!("transport broke");
    await flush();
    expect(reports.mock.calls.map((c) => c[0].scope)).toEqual(["ghost-text"]);
    off();
  });

  it("switching into a file where ghost text may not run still tears down the old file's prefetch", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const reports = vi.fn();
    const off = subscribeToAsyncErrors(reports);
    const { unlistens } = arrangeListen();
    const pending = new Map<string, (e: unknown) => void>();
    mockComplete.mockImplementation(
      (_p, _m, requestId) =>
        new Promise<void>((_r, rej) => pending.set(requestId as string, rej)),
    );
    vi.mocked(llmCancel).mockImplementation(async (requestId: string) => {
      pending.get(requestId)?.(LLM_CANCELLED_REJECTION);
      return true;
    });
    const tab = (id: string, filePath: string) => ({
      contextId: "ctx",
      filePath,
      id,
      isDirty: false,
      isPinned: false,
      title: id,
    });
    useEditorStore.setState({
      activeTabId: "a",
      tabs: [tab("a", "/vault/a.md"), tab("b", "/vault/b.md")],
    });
    const editor = makeEditor("<p>File a again. Two</p>");
    renderHook(() => useGhostText(editor));
    await typeAndWait(editor);
    act(() => {
      accepted.current!(" sentence.", editor.state.doc.content.size - 1);
    });
    await flush();
    const prefetchId = [...pending.keys()].find((id) =>
      id.startsWith("prefetch_"),
    );
    expect(prefetchId).toBeDefined();
    expect(unlistens).toHaveLength(6);

    // Ghost text is switched off, then the user moves to file b: the update
    // handler returns before it would start anything — but not before it
    // reconciles the file.
    act(() => {
      useAIStore.setState({ ghostTextEnabled: false });
      useEditorStore.setState({ activeTabId: "b" });
    });
    await typeAndWait(editor);

    expect(vi.mocked(llmCancel)).toHaveBeenCalledWith(prefetchId);
    expect(unlistens).toHaveLength(6); // nothing new was started
    for (const un of unlistens.slice(3)) expect(un).toHaveBeenCalledTimes(1);
    expect(reports).not.toHaveBeenCalled();
    off();
  });

  it("a real failure that races a successful cancel is still reported (main path)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const reports = vi.fn();
    const off = subscribeToAsyncErrors(reports);
    arrangeListen();
    const pending = new Map<string, (e: unknown) => void>();
    mockComplete.mockImplementation(
      (_p, _m, requestId) =>
        new Promise<void>((_r, rej) => pending.set(requestId as string, rej)),
    );
    // The registry found the request (true) — but the request had already
    // failed on its own; the backend rejects with THAT error, not Cancelled.
    vi.mocked(llmCancel).mockImplementation(() => Promise.resolve(true));
    const editor = makeEditor("<p>cancel raced a failure</p>");
    renderHook(() => useGhostText(editor));
    await typeAndWait(editor);
    const first = [...pending.keys()][0]!;
    await typeAndWait(editor); // cancels `first`: found, says the backend
    expect(vi.mocked(llmCancel)).toHaveBeenCalledWith(first);

    pending.get(first)!("transport broke");
    await flush();
    expect(reports.mock.calls.map((c) => c[0].scope)).toEqual(["ghost-text"]);
    off();
  });

  it("a real failure that races a successful cancel is still reported (prefetch)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const reports = vi.fn();
    const off = subscribeToAsyncErrors(reports);
    arrangeListen();
    const pending = new Map<string, (e: unknown) => void>();
    mockComplete.mockImplementation(
      (_p, _m, requestId) =>
        new Promise<void>((_r, rej) => pending.set(requestId as string, rej)),
    );
    vi.mocked(llmCancel).mockImplementation(() => Promise.resolve(true));
    const editor = makeEditor("<p>Prefetch raced a failure. Two</p>");
    const { unmount } = renderHook(() => useGhostText(editor));
    act(() => {
      accepted.current!(" sentence.", editor.state.doc.content.size - 1);
    });
    await flush();
    const prefetchId = [...pending.keys()][0]!;
    expect(prefetchId.startsWith("prefetch_")).toBe(true);

    unmount(); // cancels the prefetch: found, says the backend
    pending.get(prefetchId)!("transport broke");
    await flush();
    expect(reports.mock.calls.map((c) => c[0].scope)).toEqual([
      "ghost-text prefetch",
    ]);

    // And the routine outcome, for contrast: the cancel's own rejection.
    reports.mockClear();
    const again = makeEditor("<p>Prefetch cancelled for real. Two</p>");
    const second = renderHook(() => useGhostText(again));
    act(() => {
      accepted.current!(" sentence.", again.state.doc.content.size - 1);
    });
    await flush();
    const secondId = [...pending.keys()][1]!;
    second.unmount();
    pending.get(secondId)!(LLM_CANCELLED_REJECTION);
    await flush();
    expect(reports).not.toHaveBeenCalled();
    off();
  });

  it("prefetch releases its listeners when the request rejects, and reports it", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const reports = vi.fn();
    const off = subscribeToAsyncErrors(reports);
    const { unlistens } = arrangeListen();
    mockComplete.mockImplementation(() =>
      Promise.reject(new Error("ipc down")),
    );
    const editor = makeEditor("<p>One sentence. Two</p>");
    renderHook(() => useGhostText(editor));
    expect(accepted.current).not.toBeNull();

    // Tab-acceptance of " sentence." → text before the cursor ends a second
    // sentence, which is what schedules a prefetch.
    act(() => {
      accepted.current!(" sentence.", editor.state.doc.content.size - 1);
    });
    await flush();

    expect(mockComplete).toHaveBeenCalledTimes(1);
    expect(unlistens).toHaveLength(3);
    for (const un of unlistens) expect(un).toHaveBeenCalledTimes(1);
    expect(reports.mock.calls.map((c) => c[0].scope)).toEqual([
      "ghost-text prefetch",
    ]);
    off();
  });
});
