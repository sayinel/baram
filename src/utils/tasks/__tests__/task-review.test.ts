// §315 주간 리뷰의 세 묶음.
import type { TaskEntry } from "../../../ipc/types";

import { describe, expect, it } from "vitest";

import { groupForReview, REVIEW_GROUP_ORDER } from "../task-review";

/** 수요일 — 주 경계가 어느 쪽으로도 넉넉하다. */
const NOW = new Date(2026, 7, 26); // 2026-08-26 (수)

describe("groupForReview", () => {
  it("훑는 순서는 처리할 것 둘 다음에 회고다", () => {
    // 화면의 세로 순서이자 `j`가 지나가는 순서다. 회고가 가운데 끼면 훑던 손이 거기서
    // 멈춘다 — 처리할 것이 아직 아래에 남아 있는데.
    expect(REVIEW_GROUP_ORDER).toEqual(["overdue", "noDate", "doneThisWeek"]);
  });

  it("기한 초과와 예정 없음을 갈라 담는다", () => {
    const late = task({ due: "2026-08-01", text: "늦음" });
    const bare = task({ text: "날짜 없음" });
    const g = groupForReview([late, bare], NOW, "monday");
    expect(g.overdue.map((x) => x.text)).toEqual(["늦음"]);
    expect(g.noDate.map((x) => x.text)).toEqual(["날짜 없음"]);
  });

  it("오늘·이번 주·나중은 어느 묶음에도 넣지 않는다", () => {
    // 리뷰는 "밀린 것"과 "정하지 않은 것"을 처리하는 화면이다. 예정대로 가는 일까지
    // 끌어오면 훑을 것이 늘기만 하고 정리되는 것은 없다.
    const g = groupForReview(
      [
        task({ due: "2026-08-26", text: "오늘" }),
        task({ due: "2026-08-28", text: "이번 주" }),
        task({ due: "2026-12-01", text: "나중" }),
      ],
      NOW,
      "monday",
    );
    expect(g.overdue).toEqual([]);
    expect(g.noDate).toEqual([]);
    expect(g.doneThisWeek).toEqual([]);
  });

  it("예정 없음은 오래 방치된 것이 위다 — §315의 '30일+ 우선'", () => {
    const old = task({ created: "2026-01-01", text: "오래됨" });
    const fresh = task({ created: "2026-08-25", text: "어제" });
    const g = groupForReview([fresh, old], NOW, "monday");
    expect(g.noDate.map((x) => x.text)).toEqual(["오래됨", "어제"]);
  });

  it("기한 초과도 많이 지난 것이 위다", () => {
    const older = task({
      created: "2026-01-01",
      due: "2026-02-01",
      text: "훨씬",
    });
    const newer = task({
      created: "2026-08-20",
      due: "2026-08-24",
      text: "조금",
    });
    const g = groupForReview([newer, older], NOW, "monday");
    expect(g.overdue.map((x) => x.text)).toEqual(["훨씬", "조금"]);
  });

  it("이번 주 완료만 회고에 담고, 최근 완료가 위다", () => {
    const mon = done("2026-08-24", "월요일에 끝냄");
    const wed = done("2026-08-26", "오늘 끝냄");
    const lastWeek = done("2026-08-20", "지난주");
    const g = groupForReview([mon, wed, lastWeek], NOW, "monday");
    expect(g.doneThisWeek.map((x) => x.text)).toEqual([
      "오늘 끝냄",
      "월요일에 끝냄",
    ]);
  });

  it("주 시작 요일 설정을 따른다 — 아젠다와 같은 주를 본다", () => {
    // 2026-08-23은 일요일이다. 월요일 시작이면 지난주, 일요일 시작이면 이번 주다.
    // 두 화면이 각자 요일 계산을 하면 여기서 하루씩 어긋난 주를 보여 준다.
    const sunday = done("2026-08-23", "일요일");
    expect(groupForReview([sunday], NOW, "monday").doneThisWeek).toEqual([]);
    expect(
      groupForReview([sunday], NOW, "sunday").doneThisWeek.map((x) => x.text),
    ).toEqual(["일요일"]);
  });

  it("완료일이 없는 완료 태스크는 회고에 넣지 않는다", () => {
    // `tasksRecordDoneDate`가 꺼져 있으면 생기는 줄. 언제 끝냈는지 모르는 것을 이번 주에
    // 넣으면 몇 달 전에 끝낸 일이 **매주** 회고에 다시 나타난다.
    const g = groupForReview(
      [{ ...done("2026-08-26", "날짜 없음"), done: null }],
      NOW,
      "monday",
    );
    expect(g.doneThisWeek).toEqual([]);
  });

  it("달력에 없는 완료일도 넣지 않는다", () => {
    const g = groupForReview(
      [{ ...done("2026-08-26", "이상함"), done: "2026-02-31" }],
      NOW,
      "monday",
    );
    expect(g.doneThisWeek).toEqual([]);
  });
});

function done(doneDate: string, text: string): TaskEntry {
  return { ...task({ text }), done: doneDate, state: "done" };
}

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
