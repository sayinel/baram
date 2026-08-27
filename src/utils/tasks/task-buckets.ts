// §306 §309 아젠다 버킷 분류 — 순수 함수. Date만 주입받는다.
import type { TaskEntry } from "../../ipc/types";

export type TaskBucket =
  "done" | "later" | "noDate" | "overdue" | "thisWeek" | "today";

/** 패널에 그리는 순서 */
export const BUCKET_ORDER: TaskBucket[] = [
  "overdue",
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

  const date = effectiveDate(task);
  if (!date) return "noDate";

  const today = startOfDay(now);
  if (date.getTime() < today.getTime()) return "overdue";
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

/** 기한이 며칠 지났는지. 지나지 않았거나 날짜가 없으면 0. */
export function overdueDays(task: TaskEntry, now: Date): number {
  const date = effectiveDate(task);
  if (!date) return 0;
  const diff = startOfDay(now).getTime() - date.getTime();
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

/** 기한이 없으면 예정일로 대체한다. */
function effectiveDate(task: TaskEntry): Date | null {
  return parseLocalDate(task.due) ?? parseLocalDate(task.scheduled);
}

/** `now`가 속한 주의 마지막 날(자정). */
function endOfWeek(now: Date, weekStart: "monday" | "sunday"): Date {
  const today = startOfDay(now);
  const dow = today.getDay(); // 0=일
  const offsetFromStart = weekStart === "monday" ? (dow + 6) % 7 : dow;
  const end = new Date(today);
  end.setDate(end.getDate() + (6 - offsetFromStart));
  return end;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
