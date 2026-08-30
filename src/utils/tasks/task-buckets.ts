// §306 §309 아젠다 버킷 분류 — 순수 함수. Date만 주입받는다.
import type { TaskEntry } from "../../ipc/types";

export type TaskBucket =
  "done" | "later" | "noDate" | "overdue" | "slipped" | "thisWeek" | "today";

/** 패널에 그리는 순서 */
export const BUCKET_ORDER: TaskBucket[] = [
  "overdue",
  "slipped",
  "today",
  "thisWeek",
  "later",
  "noDate",
  "done",
];

const MS_PER_DAY = 86_400_000;

export function classifyTask(
  task: TaskEntry,
  now: Date,
  weekStart: "monday" | "sunday",
): TaskBucket {
  if (task.state === "done") return "done";

  const today = startOfDay(now);
  // ‼️ **지난 날짜가 먼저 말한다.** 기한(📅)과 예정일(⏳)은 지난 뒤에 뜻이 갈린다 —
  // 기한은 약속을 어긴 것이고, 예정일은 내가 하려던 날을 넘긴 것이다. 둘을 한 버킷에
  // 담으면 기한을 건 적도 없는 캡처가 전부 빨간 "기한 초과"로 떠서 이 화면의 빨강이
  // 뜻을 잃는다(사용자 보고). 에디터 칩이 `due`만 붉히는 것과 같은 자다
  // (`extensions/plugins/task-field-chips.ts`의 `isOverdue`).
  //
  // ‼️ 예정일이 지났으면 **기한이 남았어도** 밀린 것이다. 한때 "기한이 있으면 기한이
  // 정한다"로 두었더니 `⏳어제 📅다음주`인 줄이 "나중"에 앉아, "예정 밀림"이라는 이름이
  // 약속한 것과 화면이 어긋났다(사용자 보고). 하려던 날을 넘긴 것은 마감이 남았다고
  // 없던 일이 되지 않는다.
  const past = pastDate(task, today);
  if (past) return past.kind === "due" ? "overdue" : "slipped";

  // 지나기 **전**에는 가르지 않는다: 둘 다 "그날 볼 것"이라 버킷이 같아야 한다.
  const date = effectiveDate(task);
  if (!date) return "noDate";
  if (date.getTime() === today.getTime()) return "today";
  return date.getTime() <= endOfWeek(now, weekStart).getTime()
    ? "thisWeek"
    : "later";
}

export function groupIntoBuckets(
  tasks: TaskEntry[],
  now: Date,
  weekStart: "monday" | "sunday",
): Record<TaskBucket, TaskEntry[]> {
  const groups = Object.fromEntries(
    BUCKET_ORDER.map((b) => [b, [] as TaskEntry[]]),
  ) as Record<TaskBucket, TaskEntry[]>;

  for (const task of tasks) {
    groups[classifyTask(task, now, weekStart)].push(task);
  }
  for (const bucket of BUCKET_ORDER) {
    groups[bucket].sort(compare);
  }
  return groups;
}

/**
 * 밀린 날짜가 며칠 지났는지. 밀리지 않았으면 0.
 *
 * **버킷 이름을 정한 그 날짜**를 센다 — `pastDate`가 둘의 유일한 출처다. 여기서 따로
 * 고르면 "기한 초과" 행에 예정일 기준 일수가 뜨거나, 기한이 남은 "예정 밀림" 행의
 * 배지가 통째로 0이 되어 사라진다(며칠 밀렸는지가 그 버킷을 훑는 유일한 단서인데도).
 */
export function lateDays(task: TaskEntry, now: Date): number {
  const today = startOfDay(now);
  const past = pastDate(task, today);
  if (!past) return 0;
  return Math.round((today.getTime() - past.date.getTime()) / MS_PER_DAY);
}

/**
 * "YYYY-MM-DD" → 로컬 자정. 형식이 틀리거나 달력에 없는 날이면 null.
 *
 * 아카이브(`task-archive.ts`)도 이 함수를 쓴다. 사본을 두면 아젠다가 날짜를 읽는 방식과
 * 배수구가 읽는 방식이 갈릴 수 있고, 그러면 화면의 완료 버킷과 옮길 목록이 어긋난다.
 */
export function parseLocalDate(s: null | string): Date | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  // 2026-02-31 같은 값은 롤오버되므로 되돌려 확인한다
  if (d.getMonth() !== Number(m[2]) - 1 || d.getDate() !== Number(m[3])) {
    return null;
  }
  return d;
}

/**
 * §312 방치 감지 — `created`(➕)로부터 지난 일수. 없거나 형식이 틀리면 0.
 *
 * 파일 mtime을 쓰지 않는 이유: Rust `TaskEntry`에 없고, 넣으면 스캔마다 파일당
 * `metadata()` 호출이 늘어 10k 파일 예산(376ms)을 갉아먹는다. 캡처 경로가
 * `➕`를 붙이므로 이 배지가 겨냥하는 수집함 항목에는 정확히 생긴다.
 */
export function taskAgeDays(task: TaskEntry, now: Date): number {
  const created = parseLocalDate(task.created);
  if (!created) return 0;
  const diff = startOfDay(now).getTime() - created.getTime();
  return diff > 0 ? Math.round(diff / MS_PER_DAY) : 0;
}

/**
 * `now`가 속한 주의 첫날과 마지막 날(둘 다 자정).
 *
 * 버킷 분류("이번 주"의 경계)와 §315 주간 리뷰의 "이번 주 완료"가 **같은 주**를 봐야 한다.
 * 두 곳이 각자 요일 계산을 하면 `tasksWeekStart`를 일요일로 바꾼 사용자에게 목록과 회고가
 * 하루씩 어긋난 주를 보여 준다.
 */
export function weekRange(
  now: Date,
  weekStart: "monday" | "sunday",
): { end: Date; start: Date } {
  const today = startOfDay(now);
  const dow = today.getDay(); // 0=일
  const offsetFromStart = weekStart === "monday" ? (dow + 6) % 7 : dow;
  const start = new Date(today);
  start.setDate(start.getDate() - offsetFromStart);
  const end = new Date(today);
  end.setDate(end.getDate() + (6 - offsetFromStart));
  return { end, start };
}

/** 지난 날짜 하나와, 그것을 적어 둔 필드 — 버킷 이름이 이 `kind`로 갈린다. */
interface PastDate {
  date: Date;
  kind: "due" | "scheduled";
}

function compare(a: TaskEntry, b: TaskEntry): number {
  const da = effectiveDate(a);
  const db = effectiveDate(b);
  if (da && db && da.getTime() !== db.getTime()) {
    return da.getTime() - db.getTime();
  }
  if (da && !db) return -1;
  if (!da && db) return 1;
  if (a.priority !== b.priority) return b.priority - a.priority;
  return a.text.localeCompare(b.text);
}

/**
 * 아직 오지 않은 날을 볼 때 쓰는 날짜 — 기한이 없으면 예정일로 대체한다.
 *
 * 여기서는 기한이 이긴다: `⏳내일 📅모레`라면 "언제 볼 것인가"는 결국 마감이 정한다.
 * 지난 날짜의 규칙은 정반대이므로(`pastDate`) 두 함수를 따로 둔다 — 하나로 합치면
 * "기한 우선"과 "밀린 것 우선"이 한 몸에 들어가 어느 쪽도 읽히지 않는다.
 */
function effectiveDate(task: TaskEntry): Date | null {
  return parseLocalDate(task.due) ?? parseLocalDate(task.scheduled);
}

/** `now`가 속한 주의 마지막 날(자정). */
function endOfWeek(now: Date, weekStart: "monday" | "sunday"): Date {
  return weekRange(now, weekStart).end;
}

/**
 * 오늘보다 이른 날짜 중 이 태스크의 버킷 이름을 정하는 것. 밀린 것이 없으면 null.
 *
 * 기한이 예정일을 이긴다 — 둘 다 지났으면 어긴 쪽이 하려던 날보다 나쁘다. 그러나
 * **하나만** 지났으면 지난 쪽이 말한다: 기한이 남았다고 넘긴 예정일이 없던 일이 되지
 * 않는다. 버킷 분류와 지남 일수 배지가 이 한 함수를 공유해야 같은 날짜를 센다.
 */
function pastDate(task: TaskEntry, today: Date): null | PastDate {
  const due = parseLocalDate(task.due);
  if (due && due.getTime() < today.getTime()) return { date: due, kind: "due" };
  const scheduled = parseLocalDate(task.scheduled);
  if (scheduled && scheduled.getTime() < today.getTime()) {
    return { date: scheduled, kind: "scheduled" };
  }
  return null;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
