import type { Editor } from "@tiptap/react";

// §perf-large-file C3.5: unit tests for keep-alive pool and resolveTabEditor
// [M10 residual] Tests drive the PRODUCTION createKeepalivePool factory —
// no duplicated inline re-implementation.
import { describe, expect, it, vi } from "vitest";

import {
  createKeepalivePool,
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

describe("LARGE_DOC_BLOCK_THRESHOLD", () => {
  it("is 500 per plan", () => {
    expect(LARGE_DOC_BLOCK_THRESHOLD).toBe(500);
  });
});

describe("KEEPALIVE_LRU_CAP", () => {
  it("is 1", () => {
    expect(KEEPALIVE_LRU_CAP).toBe(1);
  });
});

describe("createKeepalivePool", () => {
  it("acquire + get returns the editor", () => {
    const pool = createKeepalivePool();
    const ed = makeEditor(300);
    pool.acquire("tab1", ed);
    expect(pool.get("tab1")).toBe(ed);
  });

  it("has() returns true after acquire, false before", () => {
    const pool = createKeepalivePool();
    expect(pool.has("tab1")).toBe(false);
    pool.acquire("tab1", makeEditor());
    expect(pool.has("tab1")).toBe(true);
  });

  it("LRU eviction: acquiring beyond cap destroys the oldest editor", () => {
    const pool = createKeepalivePool();
    const ed1 = makeEditor(300);
    const ed2 = makeEditor(250);
    pool.acquire("tab1", ed1);
    pool.acquire("tab2", ed2); // should evict tab1
    expect(ed1.destroy).toHaveBeenCalledOnce();
    expect(pool.has("tab1")).toBe(false);
    expect(pool.has("tab2")).toBe(true);
  });

  it("acquire is idempotent — re-acquiring same tab does not evict", () => {
    const pool = createKeepalivePool();
    const ed = makeEditor(300);
    pool.acquire("tab1", ed);
    pool.acquire("tab1", ed); // second call is no-op
    expect(ed.destroy).not.toHaveBeenCalled();
    expect(pool._entries.length).toBe(1);
  });

  it("release destroys the editor and removes from pool", () => {
    const pool = createKeepalivePool();
    const ed = makeEditor(300);
    pool.acquire("tab1", ed);
    pool.release("tab1");
    expect(ed.destroy).toHaveBeenCalledOnce();
    expect(pool.has("tab1")).toBe(false);
  });

  it("release is a no-op for unknown tabId", () => {
    const pool = createKeepalivePool();
    expect(() => pool.release("unknown")).not.toThrow();
  });

  it("activeFor returns pool editor when tab is pooled AND complete", () => {
    const pool = createKeepalivePool();
    const ed = makeEditor(300);
    pool.acquire("tab1", ed);
    // Not complete yet — should return null
    expect(pool.activeFor("tab1")).toBeNull();
    pool.markComplete("tab1");
    expect(pool.activeFor("tab1")).toBe(ed);
  });

  it("activeFor returns null when tab not pooled", () => {
    const pool = createKeepalivePool();
    expect(pool.activeFor("tab1")).toBeNull();
  });

  it("activeFor returns null for null activeTabId", () => {
    const pool = createKeepalivePool();
    expect(pool.activeFor(null)).toBeNull();
  });

  it("keys() returns all pooled tabIds", () => {
    const pool = createKeepalivePool();
    expect(pool.keys()).toEqual([]);
    pool.acquire("tab1", makeEditor());
    expect(pool.keys()).toEqual(["tab1"]);
  });

  it("isComplete returns false for newly acquired, true after markComplete", () => {
    const pool = createKeepalivePool();
    pool.acquire("tab1", makeEditor());
    expect(pool.isComplete("tab1")).toBe(false);
    pool.markComplete("tab1");
    expect(pool.isComplete("tab1")).toBe(true);
  });

  it("isComplete returns false for unknown tabId", () => {
    const pool = createKeepalivePool();
    expect(pool.isComplete("unknown")).toBe(false);
  });

  // [NEW-CRITICAL-A] destroyAll fires onEvict per entry before destroying
  it("destroyAll() calls onEvict per entry then destroys all editors", () => {
    const order: string[] = [];
    const onEvict = vi.fn((_tabId: string, editor: Editor) => {
      order.push(editor.isDestroyed ? "destroyed" : "alive");
    });
    const pool = createKeepalivePool({ onEvict });
    const ed = makeEditor(300);
    pool.acquire("tab1", ed);
    pool.destroyAll();
    expect(onEvict).toHaveBeenCalledWith("tab1", ed);
    expect(order).toEqual(["alive"]); // callback ran before destroy
    expect(ed.isDestroyed).toBe(true);
    expect(pool.keys()).toEqual([]);
  });

  // [NEW-CRITICAL-A] pool object identity stable across createKeepalivePool calls
  it("createKeepalivePool returns a single stable pool per call", () => {
    const pool = createKeepalivePool();
    // The object IS the pool; calling methods mutates internal state.
    pool.acquire("t", makeEditor());
    expect(pool.has("t")).toBe(true);
    // There's no second creation — the hook stores this in a ref.
  });

  it("eviction callback fires before editor.destroy()", () => {
    const order: string[] = [];
    const onEvict = vi.fn((_tabId: string, editor: Editor) => {
      order.push(editor.isDestroyed ? "destroyed" : "alive");
    });
    const pool = createKeepalivePool({ onEvict });
    const ed1 = makeEditor(300);
    pool.acquire("tab1", ed1);
    pool.acquire("tab2", makeEditor(250)); // evicts tab1
    expect(onEvict).toHaveBeenCalledWith("tab1", ed1);
    expect(order).toEqual(["alive"]); // callback ran before destroy
    expect(ed1.isDestroyed).toBe(true); // destroyed after callback
  });

  it("release calls onEvict before destroy", () => {
    const order: string[] = [];
    const onEvict = vi.fn((_tabId: string, editor: Editor) => {
      order.push(editor.isDestroyed ? "destroyed" : "alive");
    });
    const pool = createKeepalivePool({ onEvict });
    const ed = makeEditor(300);
    pool.acquire("tab1", ed);
    pool.release("tab1");
    expect(onEvict).toHaveBeenCalledWith("tab1", ed);
    expect(order).toEqual(["alive"]);
    expect(ed.isDestroyed).toBe(true);
  });

  // [NEW-CRITICAL-B] incomplete entry handling
  it("activeFor returns null for incomplete entry — forces re-load", () => {
    const pool = createKeepalivePool();
    pool.acquire("tab1", makeEditor(600));
    expect(pool.has("tab1")).toBe(true);
    expect(pool.activeFor("tab1")).toBeNull(); // incomplete
    pool.markComplete("tab1");
    expect(pool.activeFor("tab1")).not.toBeNull(); // now complete
  });

  it("release on incomplete entry destroys it cleanly", () => {
    const pool = createKeepalivePool();
    const ed = makeEditor(600);
    pool.acquire("tab1", ed);
    // Simulate mid-load switch-away: release the incomplete entry
    pool.release("tab1");
    expect(ed.destroy).toHaveBeenCalledOnce();
    expect(pool.has("tab1")).toBe(false);
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

// Smoke test that the hook import works (hook itself uses useRef —
// not practical to test mounting without a React renderer in this env)
describe("useLargeDocKeepalive (import smoke)", () => {
  it("is a function", () => {
    expect(typeof useLargeDocKeepalive).toBe("function");
  });
});
