// §315 주간 리뷰의 세 묶음 — 순수 함수. React 없이 검증한다(task-buckets.ts와 같은 이유).
//
// 새 분류가 아니다. 아젠다의 버킷 분류를 그대로 쓰고, 그중 **훑어서 처리할 것 둘**과
// **돌아볼 것 하나**만 골라 리뷰가 원하는 순서로 세운다. 분류 규칙을 여기서 다시 쓰면
// 같은 태스크가 두 화면에서 다른 묶음에 들어가는 순간 사용자는 어느 쪽을 믿을지 알 수 없다.

import type { TaskEntry } from "../../ipc/types";

import {
  classifyTask,
  parseLocalDate,
  taskAgeDays,
  weekRange,
} from "./task-buckets";

export interface ReviewGroups {
  /** 이번 주에 끝낸 것 — 회고용이라 처리 대상이 아니다. 최근 완료가 위 */
  doneThisWeek: TaskEntry[];
  /** 예정 없음 — **오래 방치된 것이 위**. 이 화면이 존재하는 이유의 절반이다 */
  noDate: TaskEntry[];
  /** 기한 초과 — 많이 지난 것이 위 */
  overdue: TaskEntry[];
}

/** 리뷰가 훑는 순서 — 화면의 세로 순서이자 `j`가 지나가는 순서다. */
export const REVIEW_GROUP_ORDER = [
  "overdue",
  "noDate",
  "doneThisWeek",
] as const;

export type ReviewGroup = (typeof REVIEW_GROUP_ORDER)[number];

/**
 * 지금 화면에 있는 태스크를 리뷰의 세 묶음으로 나눈다.
 *
 * `now`는 패널이 보고 있는 그 날이다 — 라이브 `new Date()`가 아니라 고정값을 받는 이유는
 * 아젠다와 같다(I4): 밤새 열어 둔 화면에서 묶음 경계가 하루 어긋나면, 사용자가 방금 처리한
 * 항목이 다시 나타나거나 처리하지 않은 항목이 사라진다.
 */
export function groupForReview(
  tasks: TaskEntry[],
  now: Date,
  weekStart: "monday" | "sunday",
): ReviewGroups {
  const groups: ReviewGroups = { doneThisWeek: [], noDate: [], overdue: [] };
  const week = weekRange(now, weekStart);

  for (const task of tasks) {
    const bucket = classifyTask(task, now, weekStart);
    if (bucket === "overdue") groups.overdue.push(task);
    else if (bucket === "noDate") groups.noDate.push(task);
    else if (bucket === "done" && finishedIn(task, week)) {
      groups.doneThisWeek.push(task);
    }
  }

  // 처리할 둘은 **오래된 것이 위**다. 리뷰는 위에서 아래로 훑으므로, 가장 오래 방치된
  // 항목이 사용자가 가장 먼저 보는 것이 된다 — §315가 "30일+ 우선"이라고 적은 순서다.
  groups.overdue.sort((a, b) => taskAgeDays(b, now) - taskAgeDays(a, now));
  groups.noDate.sort((a, b) => taskAgeDays(b, now) - taskAgeDays(a, now));
  // 회고는 반대다. 방금 끝낸 것이 위에 있어야 "이번 주에 무엇을 했나"로 읽힌다.
  groups.doneThisWeek.sort((a, b) =>
    (a.done ?? "") < (b.done ?? "") ? 1 : -1,
  );

  return groups;
}

/** 이번 주에 끝났는가 — `✅` 날짜가 주 범위 안에 있는가. */
function finishedIn(
  task: TaskEntry,
  week: { end: Date; start: Date },
): boolean {
  const done = parseLocalDate(task.done);
  // ‼️ 완료일이 없으면 **넣지 않는다.** `tasksRecordDoneDate`가 꺼져 있으면 언제 끝냈는지
  // 알 방법이 없고(`TaskEntry`에 mtime이 없다 — §18.7), 그때 "이번 주"에 넣으면 몇 달 전에
  // 끝낸 일이 매주 회고에 다시 나타난다.
  if (!done) return false;
  return done >= week.start && done <= week.end;
}
