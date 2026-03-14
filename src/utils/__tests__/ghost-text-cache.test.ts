import { beforeEach, describe, expect, it, vi } from "vitest";

import { GhostTextCache } from "../ghost-text-cache";

describe("GhostTextCache", () => {
  let cache: GhostTextCache;

  beforeEach(() => {
    cache = new GhostTextCache({ maxSize: 5, ttlMs: 5000 });
  });

  it("stores and retrieves a suggestion by prefix hash", () => {
    cache.set("hello world", "continuation text");
    expect(cache.get("hello world")).toBe("continuation text");
  });

  it("returns undefined for cache miss", () => {
    expect(cache.get("unknown")).toBeUndefined();
  });

  it("evicts oldest entry when maxSize exceeded", () => {
    for (let i = 0; i < 6; i++) {
      cache.set(`prefix-${i}`, `suggestion-${i}`);
    }
    expect(cache.get("prefix-0")).toBeUndefined();
    expect(cache.get("prefix-5")).toBe("suggestion-5");
  });

  it("expires entries after TTL", () => {
    vi.useFakeTimers();
    cache.set("prefix", "suggestion");
    vi.advanceTimersByTime(5001);
    expect(cache.get("prefix")).toBeUndefined();
    vi.useRealTimers();
  });

  it("invalidates all entries for a given filePath", () => {
    cache.set("prefix-a", "sug-a", "file1.md");
    cache.set("prefix-b", "sug-b", "file1.md");
    cache.set("prefix-c", "sug-c", "file2.md");
    cache.invalidateFile("file1.md");
    expect(cache.get("prefix-a")).toBeUndefined();
    expect(cache.get("prefix-b")).toBeUndefined();
    expect(cache.get("prefix-c")).toBe("sug-c");
  });

  it("tracks hitCount on successful get", () => {
    cache.set("prefix", "suggestion");
    cache.get("prefix");
    cache.get("prefix");
    expect(cache.getStats().hits).toBe(2);
  });

  it("clear() empties the cache", () => {
    cache.set("a", "b");
    cache.clear();
    expect(cache.get("a")).toBeUndefined();
    expect(cache.getStats().size).toBe(0);
  });
});
