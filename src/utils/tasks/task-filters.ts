// §306 아젠다 필터 — 순수 함수. React 없이 검증한다(task-buckets.ts와 같은 이유).
import type { TaskEntry } from "../../ipc/types";

export interface TaskFilters {
  priority: TaskPriorityFilter;
  /** §312 "예정 없음"의 someday를 보일지. 기본 false — 그래야 그 버킷이 0이 될 수 있는 큐가 된다. */
  showSomeday: boolean;
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
  showSomeday: false,
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
    if (!matchesSomeday(task, f)) return false;
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

/**
 * §312 `#someday`는 새 문법이 아니다 — 태그는 이미 인덱싱되므로 "예정 없음"에서
 * 기본 제외하기만 하면 GTD의 someday/maybe 리스트가 생긴다. 이 제외가 있어야
 * "예정 없음"이 실제로 0이 될 수 있는 큐가 된다.
 *
 * 이 필터는 버킷 분류(task-buckets.ts) 이전에 돌아가므로 "예정 없음 버킷에
 * 있다"를 직접 볼 수 없다 — 아래 각 early return은 그 결여를 메우는 대리
 * 판정이며, 대리가 실제와 어긋나는 지점을 주석으로 남긴다.
 */
function matchesSomeday(task: TaskEntry, f: TaskFilters): boolean {
  // 토글이 켜지면 모두 보인다 — 정리 중 보류한 것들을 훑는 경로.
  if (f.showSomeday) return true;
  // someday 태그가 없으면 애초에 이 규칙과 무관하다.
  if (!task.tags.includes("someday")) return true;
  // 완료된 태스크는 날짜 유무와 무관하게 "예정 없음"이 아니라 Done 버킷으로
  // 간다(classifyTask가 state==="done"을 date 체크보다 먼저 본다) — 아래
  // "날짜 없음 = 예정 없음" 대리 판정이 done에는 적용되지 않는다. 여기서
  // 먼저 걸러내지 않으면 완료된 someday 캡처가 Done 버킷에서도 사라져,
  // §315의 "이번 주 완료" 회고에서도 빠지게 된다.
  if (task.state === "done") return true;
  // 태그 필터를 걸었다면 사용자가 명시적으로 그 집합을 보겠다고 한 것이다
  // — someday만 특별 취급하면 다른 태그(#work 등)와 someday를 함께 단
  // 태스크가 그 필터 아래에서도 조용히 빠진다. "필터 없음"의 기본 제외를
  // 지키는 게 목적이므로, 필터가 있으면(어떤 태그든) 전부 보인다.
  if (f.tag) return true;
  // 날짜를 준 순간 someday가 아니다 — 여기 도달했다면 열린 태스크이고 태그
  // 필터도 없으므로, "날짜 없음"이 "예정 없음 버킷"의 정확한 대리가 된다.
  return Boolean(task.due ?? task.scheduled);
}
