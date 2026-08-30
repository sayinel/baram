// §307 A "이 노트의 태스크" — 어느 태스크가 이 노트의 것인가. 순수 판정이다.
//
// 데이터는 `useTaskStore.tasks`에서 온다. `get_tasks_linking_to` IPC는 **쓰지 않는다** —
// 그 커맨드는 호출마다 `get_vault_tasks`로 vault 전체를 다시 걷고(실측 10k 파일 376ms)
// 그 결과를 `links`로 거를 뿐이라, 노트를 열 때마다 그 값을 물게 된다. 더 중요한 것은
// 비용이 아니라 자가 하나여야 한다는 것이다: IPC를 따로 부르면 이 섹션은 자기 exclude·
// 자기 루트로 걷고 아젠다는 스토어로 걷는다. 같은 노트에 대해 두 화면이 다른 개수를
// 말하는 날이 온다.
import type { TaskEntry } from "../../ipc/types";

import { basename, toPosixPath } from "../path-utils";
import { extractLeadingId } from "../zettelkasten/parse-note-title";
import { linkTarget } from "./task-links";

/** 이 노트를 가리키는 세 가지 방법 — 경로 · Zettel ID · 파일명. */
export interface NoteIdentity {
  /** 파일명 앞머리의 Zettel ID. Zettel 노트가 아니면 `null` */
  id: null | string;
  /** 절대 경로 — 노트 **안에** 적힌 태스크를 잡는 자 */
  path: string;
  /** 확장자를 뗀 파일명 — 일반 vault의 `[[파일명]]`을 잡는 자 */
  stem: string;
}

export function noteIdentity(path: string): NoteIdentity {
  // `basename`은 `/`만 안다. 태스크 경로는 Rust에서 오므로 Windows에서는 `\`가 섞인다 —
  // 먼저 눕히지 않으면 파일명 대신 경로 전체가 stem이 되어 어떤 링크와도 안 맞는다.
  const name = basename(toPosixPath(path));
  return {
    id: extractLeadingId(name),
    path,
    stem: name.replace(/\.(md|markdown)$/i, ""),
  };
}

/**
 * 이 노트의 태스크 — 링크로 걸린 것과 노트 안에 직접 적힌 것을 **한 목록**으로.
 *
 * 설계 §18.6 A: "사용자에게 '이 노트와 관련된 할 일'은 하나의 목록이다." 그래서 둘을
 * 나눠 보여 주지 않는다. 한 배열을 OR 술어로 거르므로 둘 다 해당하는 태스크(노트 안에서
 * 자기 자신을 링크한 줄)도 자연히 한 번만 나온다 — 두 목록을 이어 붙이는 구현으로
 * 바뀌면 그 줄이 두 번 뜬다.
 */
export function tasksForNote(
  tasks: TaskEntry[],
  note: NoteIdentity,
): TaskEntry[] {
  return tasks.filter((task) => belongsToNote(task, note)).sort(compare);
}

function belongsToNote(task: TaskEntry, note: NoteIdentity): boolean {
  if (task.path === note.path) return true;
  return task.links.some((raw) => targetsNote(raw, note));
}

/**
 * 미완료 먼저 → 기한 오름차순(없으면 뒤) → 우선순위 내림차순 → `path:line`.
 *
 * 아젠다의 `compare`와 다른 정렬인 것이 맞다. 아젠다는 이미 버킷이 날짜로 갈라 놓은
 * **안**을 정렬하므로 상태를 볼 필요가 없지만, 여기는 버킷이 없는 납작한 목록이라
 * 완료된 것이 위로 올라오면 남은 일이 안 보인다.
 */
function compare(a: TaskEntry, b: TaskEntry): number {
  const aDone = a.state === "done";
  if (aDone !== (b.state === "done")) return aDone ? 1 : -1;
  if (a.due !== b.due) {
    // 기한 없는 것이 뒤로 — 날짜 문자열은 ISO라 사전순이 곧 시간순이다.
    if (!a.due) return 1;
    if (!b.due) return -1;
    return a.due < b.due ? -1 : 1;
  }
  if (a.priority !== b.priority) return b.priority - a.priority;
  return a.path === b.path ? a.line - b.line : a.path.localeCompare(b.path);
}

/**
 * `[[대상]]` 원문 하나가 이 노트를 가리키는가.
 *
 * Zettel vault에서 대상은 ID이고 일반 vault에서는 파일명이므로 둘 다 본다(§18.18-5).
 * 벗기는 일은 `linkTarget`이 한다 — 아젠다의 링크 필터와 같은 자여야 한다.
 */
function targetsNote(raw: string, note: NoteIdentity): boolean {
  const target = linkTarget(raw);
  if (target === "") return false;
  if (note.id !== null && target === note.id) return true;
  // 파일명은 대소문자를 가리지 않는다 — macOS·Windows 파일 시스템이 그렇고, 링크를 적는
  // 사람도 그렇게 적는다.
  return target.toLowerCase() === note.stem.toLowerCase();
}
