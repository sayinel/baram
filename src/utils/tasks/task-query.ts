// §310 `source: tasks` — 쿼리 블록이 태스크를 질의할 때의 실행기.
//
// `query-executor.ts`가 파일에 대해 하는 일을 태스크에 대해 한다. 두 실행기가 갈리면
// 안 되는 것은 **결과 모양이 아니라 문법의 뜻**이다: 같은 `AND`/`OR` 묶음이 두 소스에서
// 다르게 동작하면 사용자는 필터 문법을 소스마다 새로 배워야 한다. 그래서 묶음 규칙은
// 저쪽과 같은 모양으로 쓰고, 대조 테스트로 고정한다.
//
// 알 수 없는 필드·연산자는 **던지지 않고 아무것도 통과시키지 않는다**. 문서 안에서 도는
// 코드라 예외는 블록 하나가 아니라 노트 렌더 전체를 앗아갈 수 있고, "결과 0"은 사용자가
// 오타를 찾아볼 수 있는 상태다.
import type { TaskEntry } from "../../ipc/types";
import type { QueryDef, QueryFilter, QuerySort } from "../query-parser";

import { resolveDateInput } from "./task-date-input";
import { linkTarget } from "./task-links";

/** §310 태스크 소스에서 쓸 수 있는 필드 — 빌더의 목록과 이 실행기의 유일한 출처. */
export const TASK_QUERY_FIELDS = [
  "state",
  "due",
  "scheduled",
  "start",
  "created",
  "done",
  "priority",
  "text",
  "tags",
  "links",
  "path",
  "recurrence",
] as const;

/** 다섯 날짜 필드가 공유하는 연산자 — 표에 다섯 번 적지 않는다. */
const DATE_OPS = ["before", "after", "=", "empty"];

/** 필드마다 뜻이 있는 연산자. 표에 없는 조합은 아무것도 통과시키지 않는다. */
export const TASK_QUERY_OPERATORS: Record<string, string[]> = {
  created: DATE_OPS,
  done: DATE_OPS,
  due: DATE_OPS,
  links: ["contains"],
  path: ["starts", "contains", "regex"],
  priority: ["=", "!=", ">", "<"],
  recurrence: ["empty", "contains"],
  scheduled: DATE_OPS,
  start: DATE_OPS,
  state: ["=", "!="],
  tags: ["contains", "not_contains"],
  text: ["contains"],
};

export function executeTaskQuery(
  tasks: TaskEntry[],
  query: QueryDef,
  now: Date,
): TaskEntry[] {
  const filtered = applyTaskFilters(tasks, query.filters, now);
  return sortTasks(filtered, query.sort).slice(0, query.limit);
}

/**
 * OR로 끊어진 묶음들 — 한 묶음 안은 전부 AND, 묶음 하나라도 통과하면 통과.
 * `query-executor.ts`의 `applyFilters`와 **같은 모양**이다.
 */
export function applyTaskFilters(
  tasks: TaskEntry[],
  filters: QueryFilter[],
  now: Date,
): TaskEntry[] {
  if (filters.length === 0) return tasks;

  const groups: QueryFilter[][] = [];
  let current: QueryFilter[] = [];
  for (const filter of filters) {
    if (filter.combinator === "OR" && current.length > 0) {
      groups.push(current);
      current = [filter];
    } else {
      current.push(filter);
    }
  }
  groups.push(current);

  return tasks.filter((task) =>
    groups.some((group) => group.every((f) => matchesTaskFilter(task, f, now))),
  );
}

export function matchesTaskFilter(
  task: TaskEntry,
  filter: QueryFilter,
  now: Date,
): boolean {
  const { field, operator, value } = filter;
  if (!TASK_QUERY_OPERATORS[field]?.includes(operator)) return false;

  switch (field) {
    case "created":
    case "done":
    case "due":
    case "scheduled":
    case "start":
      return matchesDate(task[field], operator, value, now);
    case "links":
      return task.links.some((raw) => linkTarget(raw) === value);
    case "path":
      return matchesPath(task.path, operator, value);
    case "priority":
      return matchesPriority(task.priority, operator, value);
    case "recurrence":
      return operator === "empty"
        ? task.recurrence === null
        : (task.recurrence ?? "").includes(value);
    case "state":
      return operator === "=" ? task.state === value : task.state !== value;
    case "tags":
      return operator === "contains"
        ? task.tags.includes(value)
        : !task.tags.includes(value);
    case "text":
      return task.text.toLowerCase().includes(value.toLowerCase());
    default:
      return false;
  }
}

export function sortTasks(
  tasks: TaskEntry[],
  sort: null | QuerySort,
): TaskEntry[] {
  const result = [...tasks];
  if (!sort) return result;

  const sign = sort.direction === "asc" ? 1 : -1;
  result.sort((a, b) => {
    const av = sortKey(a, sort.field);
    const bv = sortKey(b, sort.field);
    // ‼️ 값이 없는 것은 **방향과 무관하게** 뒤로 간다. 정렬은 있는 것들의 순서를 정하는
    // 일이고, 기한 없는 항목을 `due asc`의 맨 앞에 세우면 목록의 머리가 빈 칸이 된다.
    if (av === null) return bv === null ? 0 : 1;
    if (bv === null) return -1;
    if (typeof av === "number" && typeof bv === "number") {
      return (av - bv) * sign;
    }
    return String(av).localeCompare(String(bv)) * sign;
  });
  return result;
}

function matchesDate(
  raw: null | string,
  operator: string,
  value: string,
  now: Date,
): boolean {
  if (operator === "empty") return raw === null || raw === "";
  if (!raw) return false;
  // 상대 날짜(`today` `+7d` `-3d`)를 에디터 입력 규칙과 **같은 자**로 푼다.
  const target = resolveDateInput(value, now);
  if (target === null) return false;
  if (operator === "before") return raw < target;
  if (operator === "after") return raw > target;
  return raw === target;
}

function matchesPath(path: string, operator: string, value: string): boolean {
  if (operator === "starts") return path.startsWith(value);
  if (operator === "contains") return path.includes(value);
  try {
    return new RegExp(value).test(path);
  } catch {
    // 사용자가 타이핑하는 중의 정규식은 대개 깨져 있다. 던지면 노트가 통째로 안 그려진다.
    return false;
  }
}

function matchesPriority(
  priority: number,
  operator: string,
  value: string,
): boolean {
  const n = Number(value);
  if (!Number.isFinite(n)) return false;
  if (operator === "=") return priority === n;
  if (operator === "!=") return priority !== n;
  if (operator === ">") return priority > n;
  return priority < n;
}

function sortKey(task: TaskEntry, field: string): null | number | string {
  switch (field) {
    case "created":
    case "done":
    case "due":
    case "scheduled":
    case "start":
      return task[field];
    case "path":
      return task.path;
    case "priority":
      return task.priority;
    case "state":
      return task.state;
    case "text":
      return task.text;
    default:
      return null;
  }
}
