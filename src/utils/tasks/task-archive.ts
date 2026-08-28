// §312 아카이브 자격 판정 — Rust `src-tauri/src/task/archive.rs`와 **같은 표**의 프런트 절반.
//
// 왜 두 벌인가: 확인 다이얼로그가 "N개를 옮길까요?"라고 물으려면 프런트가 개수를 셀 수
// 있어야 하고, 이동을 실제로 하는 것은 Rust다. 언어 경계라 한 벌로 만들 수 없으므로
// `task-field-order.ts` ↔ `fields.rs`와 같은 방식을 쓴다: 양쪽 테스트가 **같은 줄**을
// 단정해, 어느 쪽 표를 고쳐도 다른 쪽이 빨간불이 된다.
//
// 두 벌의 성격이 다르다는 것이 중요하다. 프런트의 판정은 **개수를 세기 위한 것**이고,
// Rust의 판정은 **강제**다. 프런트가 틀려도 파일은 안전하다 — Rust가 자격 미달 항목을
// `skipped`로 돌려보내고 화이트리스트 위반은 파일을 건드리기 전에 거절한다. 그래서 여기
// 판정이 느슨해질 때 생기는 최악은 "물어본 개수와 옮긴 개수가 다르다"이지 손상이 아니다.

import type { ArchiveItem, TaskEntry } from "../../ipc/types";

import { isUnderRoot, toPosixPath } from "../path-utils";
import { parseLocalDate } from "./task-buckets";
import { archiveRootOf, tasksRootOf } from "./tasks-home";

/** 한 번의 아카이브가 손댈 수 있는 경로의 범위 — §312 불가침 규칙의 화이트리스트. */
export interface ArchiveScope {
  /** `{tasksHome}/tasks/archive` — 대상 파일이 사는 곳. 원본이기도 하다(잘못 든 달의 정리) */
  archiveRoot: string;
  /** 수집함 파일의 **절대** 경로 (`resolveCapturePath`가 만든 값) */
  capturePath: string;
  /** `{tasksHome}/tasks` — §312.1 이후 화이트리스트는 이 서브트리 전체다 */
  tasksRoot: string;
}

/**
 * 이번 실행이 손댈 수 있는 경로의 범위. 경로 조립을 한 곳에 모아 둔 이유는, 호출부가
 * 손으로 이어 붙이면 홈의 트레일링 슬래시가 `//`를 만들어 문자열 비교가 조용히 어긋나기
 * 때문이다(§260 Phase 4a LOW-4와 같은 종류).
 *
 * `home`은 §312.1의 **태스크 홈**이다 — 활성 컨텍스트 루트가 아니다. `capturePath`는 이미
 * 해석된 **절대** 경로여야 한다(`resolveCapturePath`가 그 일을 하고 홈 밖·비마크다운을
 * 거기서 거절한다).
 */
export function archiveScope(home: string, capturePath: string): ArchiveScope {
  return {
    archiveRoot: toPosixPath(archiveRootOf(home)),
    capturePath: toPosixPath(capturePath),
    tasksRoot: toPosixPath(tasksRootOf(home)),
  };
}

/**
 * 지금 옮길 수 있는 태스크 — 확인 다이얼로그의 개수이자 `archiveTaskLines`의 인자.
 *
 * `now`는 패널이 보고 있는 그 날이다. 라이브 `new Date()`가 아니라 고정값을 받는 이유는
 * §309 일괄 조정과 같다(I4) — 밤새 열어 둔 패널에서 화면의 버킷 경계와 하루 어긋난
 * 판정을 하지 않기 위해서다.
 */
export function selectArchivable(
  tasks: TaskEntry[],
  scope: ArchiveScope,
  now: Date,
  afterDays: number,
): TaskEntry[] {
  const nested = nestedLines(tasks);
  return tasks.filter(
    (task) =>
      isArchivable(task, scope, now, afterDays) &&
      !nested.has(`${task.path}:${task.line + 1}`),
  );
}

/**
 * 옮길 태스크를 `ArchiveItem`으로. 인덱스가 든 `raw`가 그대로 낙관적 잠금의 기준이 된다.
 */
export function toArchiveItems(tasks: TaskEntry[]): ArchiveItem[] {
  return tasks.map((task) => ({
    expectedRaw: task.raw,
    line: task.line,
    path: task.path,
  }));
}

/** `archive/YYYY-MM.md`의 `YYYY-MM` — 완료일에서 온다. 오늘이 아니다. */
function archiveMonth(done: string): string {
  return done.slice(0, 7);
}

/** 두 날 사이의 일수. `to`가 뒤면 양수. */
function daysBetween(from: Date, to: Date): number {
  return Math.round((startOfDay(to).getTime() - from.getTime()) / MS_PER_DAY);
}

/**
 * 이 태스크를 옮겨도 되는가. Rust `archive_verdict`와 같은 표다:
 *
 * | 조건 | 이유 |
 * |---|---|
 * | `{tasksHome}/tasks/` 아래 또는 수집함일 것 | §312 불가침 규칙 — 일반 문서는 태스크가 문맥의 일부다 |
 * | 들여쓰지 않았을 것 | 부모를 뽑으면 자식이 고아가 되고, 자식을 뽑으면 부모 목록이 끊긴다 |
 * | 완료 상태일 것 | 미완료는 주간 리뷰(§315)의 몫이지 배수구의 몫이 아니다 |
 * | `✅` 날짜가 있을 것 | 없으면 며칠 지났는지 알 방법이 없다(`TaskEntry`에 mtime이 없다 — §18.7) |
 * | 그 날짜가 `afterDays` 이상 지났을 것 | 문턱은 **포함**이다 — 딱 30일이면 옮긴다 |
 * | 이미 제 달 파일에 있지 않을 것 | 자기 자신으로 옮기면 실행할 때마다 줄이 파일 끝으로 이사한다 |
 *
 * ‼️ Rust에만 있는 조건이 하나 더 있다: **자기보다 더 들여쓴 줄을 거느리지 않을 것**
 * (`has_indented_child`). 들여쓴 항목을 빼는 위 조건은 자식이 끌려 나가는 것만 막고,
 * 자식을 거느린 부모가 나가는 것은 막지 못한다. 여기서 같은 판정을 할 수 없는 이유는
 * 인덱스에 **태스크 줄만** 있기 때문이다 — 자식이 평범한 중첩 불릿이면 프런트에는 보이지
 * 않는다. 그래서 이 경우 프런트가 세는 개수가 실제보다 많을 수 있고, 그 차이는
 * `ArchiveOutcome.skipped`로 돌아와 `useArchiveDone`이 로그에 남긴다.
 */
function isArchivable(
  task: TaskEntry,
  scope: ArchiveScope,
  now: Date,
  afterDays: number,
): boolean {
  if (!isArchiveSource(task.path, scope)) return false;
  if (task.indent !== 0 || task.state !== "done") return false;

  const done = parseLocalDate(task.done);
  if (!done || daysBetween(done, now) < afterDays) return false;

  // `task.done`은 위에서 파싱에 성공했으므로 `YYYY-MM-DD` 그 자체다.
  const dest = `${scope.archiveRoot}/${archiveMonth(task.done ?? "")}.md`;
  return toPosixPath(task.path) !== dest;
}

/**
 * 이 경로에서 줄을 뽑아도 되는가 — Rust `is_archive_source`와 같은 판정.
 *
 * §312.1 이후 이것은 **`{tasksHome}/tasks/` 아래 전부**다. 종전의 "수집함 파일 +
 * `Archive/*`" 두 갈래보다 단순하다. `capturePath`가 따로 남아 있는 이유는 사용자가
 * `tasksCaptureFile`을 그 서브트리 밖으로 옮겨 둘 수 있기 때문이다.
 */
function isArchiveSource(path: string, scope: ArchiveScope): boolean {
  const p = toPosixPath(path);
  return p === scope.capturePath || isUnderRoot(p, scope.tasksRoot);
}

/**
 * 자식이 있어 보이는 줄을 찾기 위한 색인 — `{경로}:{줄}` 중 **들여쓴 태스크**인 것.
 *
 * ‼️ 이것은 Rust `has_indented_child`의 **부분집합**이다. 목적은 강제가 아니라 개수
 * 정확도다: 자식을 거느린 부모는 Rust가 막는데 여기서 세면 "4개를 옮길까요?"라고 묻고
 * 3개만 옮기게 된다. 부모-자식은 수집함에서 드문 모양이 아니라 그 어긋남이 자주 보인다.
 *
 * 여기서 못 보는 경우가 둘 있고, 둘 다 Rust가 막아 `skipped`로 돌아온다:
 * - 자식이 태스크가 아닌 평범한 중첩 불릿 — 인덱스에는 태스크 줄만 있다.
 * - 부모와 자식 사이에 빈 줄이 있는 경우 — 인덱스는 줄 번호만 알고 그 사이가 비었는지
 *   모른다(마크다운에서 빈 줄 하나는 자식을 끊지 않는다).
 *
 * 강제를 여기로 옮기지 않는 이유가 그 둘이다. 파일을 봐야만 정확해지고, 절반만 흉내 낸
 * 규칙을 **권위**로 쓰면 두 표가 갈리는 순간 파일이 위험해진다. 개수를 세는 데만 쓴다.
 */
function nestedLines(tasks: TaskEntry[]): Set<string> {
  const out = new Set<string>();
  for (const task of tasks) {
    if (task.indent > 0) out.add(`${task.path}:${task.line}`);
  }
  return out;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

const MS_PER_DAY = 86_400_000;
