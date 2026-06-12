// §perf-large-file C3.4: tag-suggest cache isolation across two editor views
import type { Editor } from "@tiptap/core";

import { describe, expect, it } from "vitest";

import { _tagCacheByEditor } from "../tag-suggest";

// Minimal editor mock — only needs to be a unique object identity for WeakMap key
function makeEditor(): Editor {
  return { isDestroyed: false } as unknown as Editor;
}

describe("tag-suggest per-editor cache isolation", () => {
  it("different editors have independent caches", () => {
    const ed1 = makeEditor();
    const ed2 = makeEditor();

    const index1 = new Map([["tag1", 5]]);
    const index2 = new Map([["tag2", 10]]);

    _tagCacheByEditor.set(ed1, { index: index1, timestamp: Date.now() });
    _tagCacheByEditor.set(ed2, { index: index2, timestamp: Date.now() });

    expect(_tagCacheByEditor.get(ed1)?.index).toBe(index1);
    expect(_tagCacheByEditor.get(ed2)?.index).toBe(index2);
    expect(_tagCacheByEditor.get(ed1)?.index).not.toBe(index2);
  });

  it("cache for one editor does not affect another", () => {
    const ed1 = makeEditor();
    const ed2 = makeEditor();

    _tagCacheByEditor.set(ed1, {
      index: new Map([["a", 1]]),
      timestamp: Date.now(),
    });

    // ed2 has no cache
    expect(_tagCacheByEditor.get(ed2)).toBeUndefined();
  });

  it("WeakMap allows GC when editor is dereferenced", () => {
    // We can't directly test GC, but we can verify the WeakMap contract:
    // setting and getting works, and the key is the editor instance.
    const ed = makeEditor();
    _tagCacheByEditor.set(ed, {
      index: new Map([["x", 1]]),
      timestamp: Date.now(),
    });
    expect(_tagCacheByEditor.has(ed)).toBe(true);
    // WeakMap entries become eligible for GC when the key is dereferenced.
    // We verify the contract holds — actual GC is runtime-dependent.
  });
});
