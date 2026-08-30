import type { TaskEntry } from "../../../ipc/types";

import { describe, expect, it } from "vitest";

import {
  applyTaskFilters,
  collectLinks,
  collectTags,
  EMPTY_FILTERS,
  priorityBadge,
  SOMEDAY_TAG,
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

  // 필터 객체를 통째로 적는다 — 새 필터를 더하면서 여기 한 줄을 잊으면 타입 검사가
  // 먼저 잡는다. 그것이 이 테스트가 `EMPTY_FILTERS`를 펴지 않는 이유다.
  it("combines every filter with AND", () => {
    const link = ["202607051530"];
    const all = [
      task({ links: link, priority: 2, tags: ["work"], text: "keep me" }),
      task({
        links: link,
        priority: 2,
        state: "done",
        tags: ["work"],
        text: "wrong state",
      }),
      task({
        links: link,
        priority: 0,
        tags: ["work"],
        text: "wrong priority",
      }),
      task({ links: link, priority: 2, tags: ["home"], text: "wrong tag" }),
      task({ links: link, priority: 2, tags: ["work"], text: "wrong text" }),
      task({ links: [], priority: 2, tags: ["work"], text: "keep no link" }),
    ];
    const got = applyTaskFilters(all, {
      link: "202607051530",
      priority: "high",
      showSomeday: false,
      state: "todo",
      tag: "work",
      text: "keep",
    });
    expect(got.map((t) => t.text)).toEqual(["keep me"]);
  });

  describe("§306 링크 대상 필터", () => {
    it("그 대상을 가리키는 태스크만 남긴다", () => {
      const all = [
        task({ links: ["202607051530"], text: "이 프로젝트" }),
        task({ links: ["202607051531"], text: "다른 프로젝트" }),
        task({ links: [], text: "링크 없음" }),
      ];
      expect(
        applyTaskFilters(all, {
          ...EMPTY_FILTERS,
          link: "202607051530",
        }).map((t) => t.text),
      ).toEqual(["이 프로젝트"]);
    });

    it("별칭·앵커가 붙어도 같은 대상으로 본다", () => {
      // 목록에 뜬 것을 골랐는데 걸리지 않으면 필터가 고장 난 것으로 읽힌다.
      const all = [
        task({ links: ["202607051530|원자성"], text: "별칭" }),
        task({ links: ["202607051530#정의"], text: "앵커" }),
      ];
      expect(
        applyTaskFilters(all, { ...EMPTY_FILTERS, link: "202607051530" }),
      ).toHaveLength(2);
    });

    it('""는 전체다', () => {
      const all = [task({ links: [] }), task({ links: ["202607051530"] })];
      expect(applyTaskFilters(all, EMPTY_FILTERS)).toHaveLength(2);
    });

    it("‼️ 링크를 고르면 #someday도 함께 보인다", () => {
      // 태그 필터와 같은 논거다: 프로젝트를 지목하는 것은 그 프로젝트의 **전부**를
      // 보겠다는 뜻이고, 미뤄 둔 것이야말로 프로젝트를 훑을 때 다시 보려는 것이다.
      const all = [
        task({
          links: ["202607051530"],
          tags: [SOMEDAY_TAG],
          text: "미뤄 둔 것",
        }),
      ];
      expect(applyTaskFilters(all, EMPTY_FILTERS)).toHaveLength(0);
      expect(
        applyTaskFilters(all, { ...EMPTY_FILTERS, link: "202607051530" }),
      ).toHaveLength(1);
    });
  });

  describe("collectLinks", () => {
    it("벗긴 대상을 중복 없이 정렬해 돌려준다", () => {
      const all = [
        task({ links: ["202607051530|원자성", "notes/프로젝트.md"] }),
        task({ links: ["202607051530"] }),
      ];
      expect(collectLinks(all)).toEqual(["202607051530", "프로젝트"]);
    });

    it("가리키는 것이 없는 링크는 목록에 넣지 않는다", () => {
      // `[[#제목]]`은 같은 파일 안 앵커다. 빈 항목이 옵션으로 뜨면 고를 수는 있는데
      // 아무것도 걸리지 않는 선택지가 된다.
      expect(collectLinks([task({ links: ["#정의"] })])).toEqual([]);
    });
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
  // §306: the agenda no longer draws a glyph. The row gets a level name that
  // CSS turns into a coloured rail in the left gutter, and the word label
  // stays for screen readers — the rail is a `::before`, invisible to them.
  //
  // ‼️ 이 네 글자는 `tasks.css`의 `[data-priority="…"]` 셀렉터와 **같은 글자**다.
  // 갈리면 그 단계만 레일이 그려지지 않고, 타입도 테스트도 아무 말을 하지 않는다.
  it("returns a rail level and a word label for each non-normal level", () => {
    expect(priorityBadge(2)).toEqual({
      label: "Urgent priority",
      level: "urgent",
    });
    expect(priorityBadge(1)).toEqual({ label: "High priority", level: "high" });
    expect(priorityBadge(-1)).toEqual({ label: "Low priority", level: "low" });
    expect(priorityBadge(-2)).toEqual({
      label: "Lowest priority",
      level: "lowest",
    });
  });

  it("returns null for normal priority (no marker)", () => {
    expect(priorityBadge(0)).toBeNull();
  });

  it("returns null for a priority value outside the known 5 levels (fix #6)", () => {
    // A `Record<number, string>` lookup table types [3] as `string` even
    // though it is `undefined` at runtime. priorityBadge is the safe accessor
    // callers use instead of indexing a table directly, and the tables it
    // reads narrow their keys to the four real levels.
    expect(priorityBadge(3)).toBeNull();
    expect(priorityBadge(-3)).toBeNull();
  });
});
