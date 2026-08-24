// §306 아젠다 필터 — 순수 함수. React 없이 검증한다(task-buckets.ts와 같은 이유).
import type { TaskEntry } from "../../ipc/types";

export interface TaskFilters {
  priority: TaskPriorityFilter;
  state: TaskStateFilter;
  /** 정확 일치. "" = 전체 */
  tag: string;
  /** 대소문자 무시 부분 일치. "" = 전체 */
  text: string;
}
export type TaskPriorityFilter = "all" | "high" | "low" | "normal";

export type TaskStateFilter = "all" | "done" | "todo";

export const EMPTY_FILTERS: TaskFilters = {
  priority: "all",
  state: "all",
  tag: "",
  text: "",
};

/** 우선순위 값(-2..2) → 표시 이모지. 0(보통)은 마커 없음이 §303의 규약이다.
 * `Record<number, string>`은 5단계 밖의 값(예: 3)도 "string"이라고 속여
 * `PRIORITY_MARKER[3]`이 `undefined`인데도 타입 체크를 통과시켰다 — 키를
 * 실제 5단계로 좁혀 임의의 number로 인덱싱하면 컴파일 타임에 걸린다
 * (호출부는 [[priorityBadge]] 사용). */
export const PRIORITY_MARKER: Record<-2 | -1 | 0 | 1 | 2, string> = {
  "-2": "⏬",
  "-1": "🔽",
  0: "",
  1: "⏫",
  2: "🔺",
};

/** 마커가 있는 4단계의 스크린 리더용 단어 라벨. 0(보통)은 마커 자체가 없다. */
const PRIORITY_LABEL: Record<-2 | -1 | 1 | 2, string> = {
  "-2": "Lowest priority",
  "-1": "Low priority",
  1: "High priority",
  2: "Highest priority",
};

/** 설정된 필터를 전부 AND로 적용한다. 입력 배열은 변형하지 않는다. */
export function applyTaskFilters(
  tasks: TaskEntry[],
  f: TaskFilters,
): TaskEntry[] {
  const q = f.text.trim().toLowerCase();
  return tasks.filter((task) => {
    if (f.state !== "all" && task.state !== f.state) return false;
    if (!matchesPriority(task, f.priority)) return false;
    // 접두 일치가 아니라 정확 일치 — #work가 #workout을 끌고 오면 안 된다.
    if (f.tag && !task.tags.includes(f.tag)) return false;
    if (q && !task.text.toLowerCase().includes(q)) return false;
    return true;
  });
}

/** 주어진 태스크들에 등장하는 태그를 중복 없이 정렬해 돌려준다. */
export function collectTags(tasks: TaskEntry[]): string[] {
  const seen = new Set<string>();
  for (const task of tasks) for (const tag of task.tags) seen.add(tag);
  return [...seen].sort((a, b) => a.localeCompare(b));
}

/**
 * 임의의 `number` 우선순위를 안전하게 표시 정보로 바꾼다. 0이거나 알려진
 * 5단계 밖의 값이면 `null` — 호출부가 마커를 그리지 않아야 함을 뜻한다.
 */
export function priorityBadge(
  priority: number,
): null | { label: string; marker: string } {
  if (priority !== -2 && priority !== -1 && priority !== 1 && priority !== 2) {
    return null;
  }
  return { label: PRIORITY_LABEL[priority], marker: PRIORITY_MARKER[priority] };
}

function matchesPriority(task: TaskEntry, band: TaskPriorityFilter): boolean {
  if (band === "all") return true;
  if (band === "high") return task.priority >= 1;
  if (band === "low") return task.priority <= -1;
  return task.priority === 0;
}
