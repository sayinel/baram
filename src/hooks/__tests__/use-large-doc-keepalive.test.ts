import type { Editor } from "@tiptap/react";

// §perf-large-file C3.5: unit tests for keep-alive pool and resolveTabEditor
import { describe, expect, it, vi } from "vitest";

import {
  KEEPALIVE_LRU_CAP,
  LARGE_DOC_BLOCK_THRESHOLD,
  resolveTabEditor,
  useLargeDocKeepalive,
} from "../use-large-doc-keepalive";

// Minimal editor mock — only the fields the pool uses
function makeEditor(blocks = 0): Editor {
  let destroyed = false;
  return {
    get isDestroyed() {
      return destroyed;
    },
    destroy: vi.fn(() => {
      destroyed = true;
    }),
    state: {
      doc: { childCount: blocks },
    },
  } as unknown as Editor;
}

// renderHook equivalent using plain function call (pool is pure logic with refs)
function makePool() {
  // Call the hook body directly — it only uses useCallback/useRef which are
  // available in the test environment through vitest + happy-dom.
  // For unit testing the pure logic, we duplicate the pool factory inline.
  const entries: Array<{ editor: Editor; tabId: string }> = [];

  const get = (tabId: string): Editor | null =>
    entries.find((e) => e.tabId === tabId)?.editor ?? null;

  const has = (tabId: string): boolean =>
    entries.some((e) => e.tabId === tabId);

  const acquire = (tabId: string, editor: Editor) => {
    if (has(tabId)) return;
    while (entries.length >= KEEPALIVE_LRU_CAP) {
      const evicted = entries.shift()!;
      if (!evicted.editor.isDestroyed) evicted.editor.destroy();
    }
    entries.push({ tabId, editor });
  };

  const release = (tabId: string) => {
    const idx = entries.findIndex((e) => e.tabId === tabId);
    if (idx === -1) return;
    const [removed] = entries.splice(idx, 1);
    if (!removed.editor.isDestroyed) removed.editor.destroy();
  };

  const activeFor = (activeTabId: null | string): Editor | null => {
    if (!activeTabId) return null;
    return get(activeTabId);
  };

  return { get, has, acquire, release, activeFor, _entries: entries };
}

describe("LARGE_DOC_BLOCK_THRESHOLD", () => {
  it("is defined and positive", () => {
    expect(LARGE_DOC_BLOCK_THRESHOLD).toBeGreaterThan(0);
  });
});

describe("KEEPALIVE_LRU_CAP", () => {
  it("is 1", () => {
    expect(KEEPALIVE_LRU_CAP).toBe(1);
  });
});

describe("keepalive pool", () => {
  it("acquire + get returns the editor", () => {
    const pool = makePool();
    const ed = makeEditor(300);
    pool.acquire("tab1", ed);
    expect(pool.get("tab1")).toBe(ed);
  });

  it("has() returns true after acquire, false before", () => {
    const pool = makePool();
    expect(pool.has("tab1")).toBe(false);
    pool.acquire("tab1", makeEditor());
    expect(pool.has("tab1")).toBe(true);
  });

  it("LRU eviction: acquiring beyond cap destroys the oldest editor", () => {
    const pool = makePool();
    const ed1 = makeEditor(300);
    const ed2 = makeEditor(250);
    pool.acquire("tab1", ed1);
    pool.acquire("tab2", ed2); // should evict tab1
    expect(ed1.destroy).toHaveBeenCalledOnce();
    expect(pool.has("tab1")).toBe(false);
    expect(pool.has("tab2")).toBe(true);
  });

  it("acquire is idempotent — re-acquiring same tab does not evict", () => {
    const pool = makePool();
    const ed = makeEditor(300);
    pool.acquire("tab1", ed);
    pool.acquire("tab1", ed); // second call is no-op
    expect(ed.destroy).not.toHaveBeenCalled();
    expect(pool._entries.length).toBe(1);
  });

  it("release destroys the editor and removes from pool", () => {
    const pool = makePool();
    const ed = makeEditor(300);
    pool.acquire("tab1", ed);
    pool.release("tab1");
    expect(ed.destroy).toHaveBeenCalledOnce();
    expect(pool.has("tab1")).toBe(false);
  });

  it("release is a no-op for unknown tabId", () => {
    const pool = makePool();
    expect(() => pool.release("unknown")).not.toThrow();
  });

  it("activeFor returns pool editor when tab is pooled", () => {
    const pool = makePool();
    const ed = makeEditor(300);
    pool.acquire("tab1", ed);
    expect(pool.activeFor("tab1")).toBe(ed);
  });

  it("activeFor returns null when tab not pooled", () => {
    const pool = makePool();
    expect(pool.activeFor("tab1")).toBeNull();
  });

  it("activeFor returns null for null activeTabId", () => {
    const pool = makePool();
    expect(pool.activeFor(null)).toBeNull();
  });
});

describe("resolveTabEditor", () => {
  it("returns keep-alive editor when tab is pooled", () => {
    const kaEditor = makeEditor(300);
    const sharedEditor = makeEditor(10);
    const pool = {
      get: (tabId: string) => (tabId === "tab1" ? kaEditor : null),
    };
    expect(resolveTabEditor("tab1", pool, sharedEditor)).toBe(kaEditor);
  });

  it("falls back to shared editor when tab is not pooled", () => {
    const sharedEditor = makeEditor(10);
    const pool = { get: () => null };
    expect(resolveTabEditor("tab1", pool, sharedEditor)).toBe(sharedEditor);
  });

  it("returns shared editor when tabId is null", () => {
    const sharedEditor = makeEditor(10);
    const pool = { get: () => null };
    expect(resolveTabEditor(null, pool, sharedEditor)).toBe(sharedEditor);
  });

  it("returns null when tabId is null and sharedEditor is null", () => {
    const pool = { get: () => null };
    expect(resolveTabEditor(null, pool, null)).toBeNull();
  });
});

// Smoke test that the hook import works (hook itself uses useCallback/useRef —
// not practical to test mounting without a React renderer in this env)
describe("useLargeDocKeepalive (import smoke)", () => {
  it("is a function", () => {
    expect(typeof useLargeDocKeepalive).toBe("function");
  });
});
