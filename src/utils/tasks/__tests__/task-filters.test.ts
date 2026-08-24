import type { TaskEntry } from "../../../ipc/types";

import { describe, expect, it } from "vitest";

import {
  applyTaskFilters,
  collectTags,
  EMPTY_FILTERS,
  PRIORITY_MARKER,
  priorityBadge,
} from "../task-filters";

function task(over: Partial<TaskEntry> = {}): TaskEntry {
  return {
    cancelled: null,
    created: null,
    done: null,
    due: null,
    indent: 0,
    line: 0,
    links: [],
    path: "a.md",
    priority: 0,
    raw: "- [ ] x",
    recurrence: null,
    scheduled: null,
    start: null,
    state: "todo",
    tags: [],
    text: "x",
    ...over,
  };
}

describe("applyTaskFilters", () => {
  it("returns everything when no filter is set", () => {
    const all = [task({ text: "a" }), task({ state: "done", text: "b" })];
    expect(applyTaskFilters(all, EMPTY_FILTERS)).toHaveLength(2);
  });

  it("filters by state", () => {
    const all = [task({ text: "a" }), task({ state: "done", text: "b" })];
    expect(
      applyTaskFilters(all, { ...EMPTY_FILTERS, state: "todo" }).map(
        (t) => t.text,
      ),
    ).toEqual(["a"]);
    expect(
      applyTaskFilters(all, { ...EMPTY_FILTERS, state: "done" }).map(
        (t) => t.text,
      ),
    ).toEqual(["b"]);
  });

  it("filters by priority band, not by exact level", () => {
    const all = [
      task({ priority: 2, text: "highest" }),
      task({ priority: 1, text: "high" }),
      task({ priority: 0, text: "normal" }),
      task({ priority: -1, text: "low" }),
      task({ priority: -2, text: "lowest" }),
    ];
    expect(
      applyTaskFilters(all, { ...EMPTY_FILTERS, priority: "high" }).map(
        (t) => t.text,
      ),
    ).toEqual(["highest", "high"]);
    expect(
      applyTaskFilters(all, { ...EMPTY_FILTERS, priority: "normal" }).map(
        (t) => t.text,
      ),
    ).toEqual(["normal"]);
    expect(
      applyTaskFilters(all, { ...EMPTY_FILTERS, priority: "low" }).map(
        (t) => t.text,
      ),
    ).toEqual(["low", "lowest"]);
  });

  it("filters by tag exactly, not by prefix", () => {
    const all = [
      task({ tags: ["work"], text: "a" }),
      task({ tags: ["workout"], text: "b" }),
      task({ tags: ["home", "work"], text: "c" }),
    ];
    expect(
      applyTaskFilters(all, { ...EMPTY_FILTERS, tag: "work" }).map(
        (t) => t.text,
      ),
    ).toEqual(["a", "c"]);
  });

  it("matches text case-insensitively", () => {
    const all = [task({ text: "Write REPORT" })];
    expect(
      applyTaskFilters(all, { ...EMPTY_FILTERS, text: "report" }),
    ).toHaveLength(1);
  });

  it("combines every filter with AND", () => {
    const all = [
      task({ priority: 2, tags: ["work"], text: "keep me" }),
      task({ priority: 2, tags: ["work"], state: "done", text: "wrong state" }),
      task({ priority: 0, tags: ["work"], text: "wrong priority" }),
      task({ priority: 2, tags: ["home"], text: "wrong tag" }),
      task({ priority: 2, tags: ["work"], text: "wrong text" }),
    ];
    const got = applyTaskFilters(all, {
      priority: "high",
      state: "todo",
      tag: "work",
      text: "keep",
    });
    expect(got.map((t) => t.text)).toEqual(["keep me"]);
  });

  it("does not mutate the input array", () => {
    const all = [task({ text: "a" }), task({ state: "done", text: "b" })];
    applyTaskFilters(all, { ...EMPTY_FILTERS, state: "todo" });
    expect(all).toHaveLength(2);
  });
});

describe("collectTags", () => {
  it("returns each tag once, sorted", () => {
    const all = [
      task({ tags: ["work", "urgent"] }),
      task({ tags: ["home", "work"] }),
      task({ tags: [] }),
    ];
    expect(collectTags(all)).toEqual(["home", "urgent", "work"]);
  });

  it("returns an empty array when nothing is tagged", () => {
    expect(collectTags([task(), task()])).toEqual([]);
  });
});

describe("PRIORITY_MARKER", () => {
  it("maps every non-normal level and leaves normal blank", () => {
    expect(PRIORITY_MARKER[2]).toBe("🔺");
    expect(PRIORITY_MARKER[1]).toBe("⏫");
    expect(PRIORITY_MARKER[0]).toBe("");
    expect(PRIORITY_MARKER[-1]).toBe("🔽");
    expect(PRIORITY_MARKER[-2]).toBe("⏬");
  });
});

describe("priorityBadge", () => {
  it("returns a marker and a word label for each non-normal level", () => {
    expect(priorityBadge(2)).toEqual({
      label: "Highest priority",
      marker: "🔺",
    });
    expect(priorityBadge(1)).toEqual({ label: "High priority", marker: "⏫" });
    expect(priorityBadge(-1)).toEqual({ label: "Low priority", marker: "🔽" });
    expect(priorityBadge(-2)).toEqual({
      label: "Lowest priority",
      marker: "⏬",
    });
  });

  it("returns null for normal priority (no marker)", () => {
    expect(priorityBadge(0)).toBeNull();
  });

  it("returns null for a priority value outside the known 5 levels (fix #6)", () => {
    // The old `Record<number, string>` typed PRIORITY_MARKER[3] as `string`
    // even though it is `undefined` at runtime. priorityBadge is the safe
    // accessor callers now use instead of indexing PRIORITY_MARKER directly.
    expect(priorityBadge(3)).toBeNull();
    expect(priorityBadge(-3)).toBeNull();
  });
});
