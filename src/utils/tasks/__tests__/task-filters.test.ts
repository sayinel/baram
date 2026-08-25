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
      showSomeday: false,
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

describe("#someday 기본 제외", () => {
  it("예정 없음 버킷의 someday는 기본으로 감춘다", () => {
    const tasks = [task({ due: null, scheduled: null, tags: ["someday"] })];
    expect(applyTaskFilters(tasks, EMPTY_FILTERS)).toHaveLength(0);
  });

  it("기한이 있는 someday는 감추지 않는다 — 날짜를 준 순간 someday가 아니다", () => {
    const tasks = [task({ due: "2026-08-30", tags: ["someday"] })];
    expect(applyTaskFilters(tasks, EMPTY_FILTERS)).toHaveLength(1);
  });

  it("showSomeday를 켜면 보인다", () => {
    const tasks = [task({ due: null, scheduled: null, tags: ["someday"] })];
    expect(
      applyTaskFilters(tasks, { ...EMPTY_FILTERS, showSomeday: true }),
    ).toHaveLength(1);
  });

  it("태그 필터로 someday를 직접 고르면 기본 제외를 무시한다", () => {
    const tasks = [task({ due: null, scheduled: null, tags: ["someday"] })];
    expect(
      applyTaskFilters(tasks, { ...EMPTY_FILTERS, tag: "someday" }),
    ).toHaveLength(1);
  });

  it("someday가 아닌 예정 없음 태스크는 그대로 보인다", () => {
    const tasks = [task({ due: null, scheduled: null, tags: [] })];
    expect(applyTaskFilters(tasks, EMPTY_FILTERS)).toHaveLength(1);
  });

  it("완료된 someday는 감추지 않는다 — Done 버킷까지 지워지면 안 된다", () => {
    const tasks = [
      task({
        due: null,
        scheduled: null,
        state: "done",
        tags: ["someday"],
      }),
    ];
    expect(applyTaskFilters(tasks, EMPTY_FILTERS)).toHaveLength(1);
  });

  it("완료되지 않은 예정 없음 someday는 여전히 감춘다", () => {
    const tasks = [
      task({ due: null, scheduled: null, state: "todo", tags: ["someday"] }),
    ];
    expect(applyTaskFilters(tasks, EMPTY_FILTERS)).toHaveLength(0);
  });

  it("다른 태그로 필터해도 someday를 함께 가진 태스크는 보인다", () => {
    const tasks = [
      task({ due: null, scheduled: null, tags: ["someday", "work"] }),
    ];
    expect(
      applyTaskFilters(tasks, { ...EMPTY_FILTERS, tag: "work" }),
    ).toHaveLength(1);
  });

  it("태그 필터가 없으면 someday+work 태스크도 그대로 감춘다", () => {
    const tasks = [
      task({ due: null, scheduled: null, tags: ["someday", "work"] }),
    ];
    expect(applyTaskFilters(tasks, EMPTY_FILTERS)).toHaveLength(0);
  });
});

describe("priorityBadge", () => {
  // §308: the marker is a short text symbol, not the raw markdown emoji —
  // it draws the agenda badge in the same visual language as the editor's
  // .task-chip. aria-label keeps the word form for screen readers.
  it("returns a marker and a word label for each non-normal level", () => {
    expect(priorityBadge(2)).toEqual({
      label: "Highest priority",
      marker: "!!!",
    });
    expect(priorityBadge(1)).toEqual({ label: "High priority", marker: "!!" });
    expect(priorityBadge(-1)).toEqual({ label: "Low priority", marker: "↓" });
    expect(priorityBadge(-2)).toEqual({
      label: "Lowest priority",
      marker: "↓↓",
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
