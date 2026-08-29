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

  const eff = effectiveDate(task);
  if (!eff) return "noDate";

  const today = startOfDay(now);
  // ‼️ 기한(📅)과 예정일(⏳)은 **지난 뒤에** 뜻이 갈린다. 기한은 약속을 어긴 것이고,
  // 예정일은 내가 하려던 날을 넘긴 것이다 — 뒤는 아직 아무것도 어기지 않았다.
  // 둘을 한 버킷에 담으면 예정일만 적은 캡처가 전부 빨간 "기한 초과"로 떠서, 이 화면의
  // 빨강이 뜻을 잃는다(사용자 보고). 에디터 칩이 `due`만 붉히는 것과 같은 자다
  // (`extensions/plugins/task-field-chips.ts`의 `isOverdue`).
  //
  // 지나기 **전**에는 가르지 않는다: 둘 다 "그날 볼 것"이라 버킷이 같아야 한다.
  if (eff.date.getTime() < today.getTime()) {
    return eff.kind === "due" ? "overdue" : "slipped";
  }
  if (eff.date.getTime() === today.getTime()) return "today";
  return eff.date.getTime() <= endOfWeek(now, weekStart).getTime()
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
 * 날짜가 며칠 지났는지. 지나지 않았거나 날짜가 없으면 0.
 *
 * 어느 날짜인지는 `effectiveDate`가 정한다 — "기한 초과"에서는 기한, "예정 밀림"에서는
 * 예정일이고, 이 값을 보여 주는 쪽은 자기가 어느 버킷인지 이미 안다. 그래서 한 함수로
 * 족하다: 두 개로 나누면 같은 뺄셈을 두 곳에서 하게 되고, 그중 하나만 자정을 놓친다.
 */
export function lateDays(task: TaskEntry, now: Date): number {
  const eff = effectiveDate(task);
  if (!eff) return 0;
  const diff = startOfDay(now).getTime() - eff.date.getTime();
  return diff > 0 ? Math.round(diff / MS_PER_DAY) : 0;
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

/** 이 태스크의 버킷을 정하는 날짜와, 그것을 정한 필드. */
interface EffectiveDate {
  date: Date;
  kind: "due" | "scheduled";
}

function compare(a: TaskEntry, b: TaskEntry): number {
  const da = effectiveDate(a)?.date;
  const db = effectiveDate(b)?.date;
  if (da && db && da.getTime() !== db.getTime()) {
    return da.getTime() - db.getTime();
  }
  if (da && !db) return -1;
  if (!da && db) return 1;
  if (a.priority !== b.priority) return b.priority - a.priority;
  return a.text.localeCompare(b.text);
}

/**
 * 기한이 없으면 예정일로 대체한다.
 *
 * `kind`를 함께 돌려주는 이유는 "지난 날짜"의 이름이 그것으로 갈리기 때문이다
 * (기한 초과 / 예정 밀림). 호출부가 `task.due`를 한 번 더 읽어 판정하면 그 순간
 * "어느 날짜가 이 태스크를 지배하는가"를 두 곳이 각자 답하게 된다.
 */
function effectiveDate(task: TaskEntry): EffectiveDate | null {
  const due = parseLocalDate(task.due);
  if (due) return { date: due, kind: "due" };
  const scheduled = parseLocalDate(task.scheduled);
  if (scheduled) return { date: scheduled, kind: "scheduled" };
  return null;
}

/** `now`가 속한 주의 마지막 날(자정). */
function endOfWeek(now: Date, weekStart: "monday" | "sunday"): Date {
  return weekRange(now, weekStart).end;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
