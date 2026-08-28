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

/** 레일의 단계 이름 — `.task-row[data-priority=…]`의 값과 **같은 글자**여야 한다. */
export type TaskPriorityLevel = "high" | "low" | "lowest" | "urgent";

export type TaskStateFilter = "all" | "done" | "todo";

/**
 * §312 GTD의 "언젠가/아마도" 목록을 여는 태그. 읽는 쪽(이 파일의 기본 제외)과 쓰는 쪽
 * (`task-triage.ts`의 토글)이 **같은 문자열**을 봐야 한다 — 한쪽만 바뀌면 메뉴가 붙인
 * 태그를 필터가 못 알아보고 "미뤘는데 큐에 그대로 있는" 상태가 된다.
 */
export const SOMEDAY_TAG = "someday";

export const EMPTY_FILTERS: TaskFilters = {
  priority: "all",
  showSomeday: false,
  state: "all",
  tag: "",
  text: "",
};

/** 마커가 있는 4단계의 스크린 리더용 단어 라벨. 0(보통)은 마커 자체가 없다. */
const PRIORITY_LABEL: Record<-2 | -1 | 1 | 2, string> = {
  "-2": "Lowest priority",
  "-1": "Low priority",
  1: "High priority",
  2: "Urgent priority",
};

/**
 * §306 아젠다 행의 우선순위 단계 — CSS가 그릴 레일의 이름이다.
 *
 * 종전에는 표시용 **기호**(`!!! !! ↓ ↓↓`)였다. 은유가 둘이었다: 위쪽 둘은 세기(느낌표),
 * 아래쪽 둘은 방향(화살표). 한 축의 다섯 단계를 두 언어로 적으면 어느 쪽도 한눈에 읽히지
 * 않고, 글리프가 행 폭을 먹어 제목이 밀린다. 지금은 기호를 그리지 않고 행 왼쪽 거터에
 * 세로 레일 하나를 세운다(tasks.css) — 색과 **높이**가 함께 단계를 나른다.
 *
 * 높이를 함께 쓰는 이유: 색만으로 네 단계를 가르면 색맹·저대비 환경에서 통째로 무너진다.
 * 레일은 글리프가 아니라 도형이라 높이를 공짜로 얻을 수 있으므로, 색을 못 보아도 단조
 * 증가하는 막대로 읽힌다. 낱말 라벨은 `.visually-hidden`으로 남아 스크린 리더가 읽는다.
 *
 * 원문 어휘(문서 모델과 직결되는 이모지)는 `task-field-tokens.ts`의 `PRIORITY_EMOJI`가
 * 유일한 출처이고 여기는 그것과 무관하다 — 바꿔도 라운드트립에 영향이 없다.
 *
 * 키를 `number`가 아니라 실제 4단계로 좁혀 둔다. `Record<number, …>`이면 5단계 밖의
 * 값(예: 3)도 타입 체크를 통과한 뒤 런타임에 `undefined`가 된다 — 호출부는
 * [[priorityBadge]]를 쓸 것.
 */
const PRIORITY_LEVEL: Record<-2 | -1 | 1 | 2, TaskPriorityLevel> = {
  "-2": "lowest",
  "-1": "low",
  1: "high",
  2: "urgent",
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
 * 임의의 `number` 우선순위를 안전하게 표시 정보로 바꾼다. 0이거나 알려진 5단계 밖의
 * 값이면 `null` — 호출부가 레일도 라벨도 그리지 않아야 함을 뜻한다.
 */
export function priorityBadge(
  priority: number,
): null | { label: string; level: TaskPriorityLevel } {
  if (priority !== -2 && priority !== -1 && priority !== 1 && priority !== 2) {
    return null;
  }
  return { label: PRIORITY_LABEL[priority], level: PRIORITY_LEVEL[priority] };
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
  if (!task.tags.includes(SOMEDAY_TAG)) return true;
  // 완료된 태스크는 날짜 유무와 무관하게 "예정 없음"이 아니라 Done 버킷으로
  // 간다(classifyTask가 state==="done"을 date 체크보다 먼저 본다) — 아래
  // "날짜 없음 = 예정 없음" 대리 판정이 done에는 적용되지 않는다. 여기서
  // 먼저 걸러내지 않으면 완료된 someday 캡처가 Done 버킷에서도 사라져,
  // §315의 "이번 주 완료" 회고에서도 빠지게 된다.
  if (task.state === "done") return true;
  // 태그 필터가 걸려 있으면 — `#someday`를 고른 경우만이 아니라 **어떤 태그든** —
  // 전부 보인다. 계획서 초안은 "`#someday`를 직접 고르면"이었고, 이쪽으로 넓힌 것이
  // 확정된 계약이다: someday만 특별 취급하면 `#work`와 `#someday`를 함께 단 태스크가
  // `#work` 필터 아래에서도 조용히 빠진다. 태그를 고르는 것은 "이 집합을 보여 달라"는
  // 명시적 요청이고, 그 집합의 일부를 말없이 빼는 쪽이 규칙의 불일치보다 나쁘다.
  //
  // ‼️ 텍스트·우선순위·상태 필터는 이 완화를 **공유하지 않는다** — `#work`를 고르면
  // someday가 보이지만 텍스트 칸에 "work"를 치면 여전히 숨는다. 의도된 비대칭이다:
  // 태그만이 태스크가 속한 집합을 직접 지목한다. 텍스트 검색은 본문을 훑는 것이지
  // 집합을 고르는 것이 아니므로, 우연히 someday 캡처와 겹쳤다고 해서 그것을 보겠다는
  // 요청으로 읽지 않는다.
  if (f.tag) return true;
  // 날짜를 준 순간 someday가 아니다 — 여기 도달했다면 열린 태스크이고 태그
  // 필터도 없으므로, "날짜 없음"이 "예정 없음 버킷"의 정확한 대리가 된다.
  return Boolean(task.due ?? task.scheduled);
}
