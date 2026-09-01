// §304 §305 Task IPC commands
import { invoke } from "@tauri-apps/api/core";

import type {
  ArchiveItem,
  ArchiveOutcome,
  TaskEntry,
  TaskState,
} from "./types";

/** §312 수집함 파일 끝에 한 줄 붙인다. 파일이 없으면 만든다. */
export async function appendTaskLine(
  path: string,
  line: string,
): Promise<string> {
  return invoke<string>("append_task_line", { path, line });
}

/**
 * §312 완료 태스크를 `{tasksHome}/tasks/archive/YYYY-MM.md`로 **옮긴다** — 붙이고 나서 지운다.
 *
 * 파일 여러 개를 한 번에 고치므로 자동 실행하지 않는다. 확인 관문은
 * `useArchiveDone`(src/components/tasks/use-archive-done.ts)이다.
 *
 * `tasksHome`은 §312.1의 태스크 홈이다 — 활성 컨텍스트 루트가 아니다. `items`에
 * `{tasksHome}/tasks/` 밖의 경로가 하나라도 있으면 파일을 하나도 건드리지 않고
 * reject된다(§312 불가침 규칙). 수집함도 그 서브트리 안에 살기 때문에 경로를 따로
 * 넘기지 않는다.
 */
export async function archiveTaskLines(
  tasksHome: string,
  items: ArchiveItem[],
  today: string,
  afterDays: number,
): Promise<ArchiveOutcome> {
  return invoke<ArchiveOutcome>("archive_task_lines", {
    tasksHome,
    items,
    today,
    afterDays,
  });
}

/**
 * §312 태스크 줄을 **지운다** — 종결자까지 함께. 되돌릴 수 없다(스냅샷 §71은 파일 단위이고
 * 이 경로를 타지 않는다). 부르기 전에 확인을 받을 것 — 그 관문은
 * `confirmAndDeleteTaskLine`(src/utils/tasks/task-delete.ts)이다.
 * 파일이 그 사이 바뀌었으면 "stale"로 reject된다.
 */
export async function deleteTaskLine(
  path: string,
  line: number,
  expectedRaw: string,
): Promise<void> {
  return invoke<void>("delete_task_line", { path, line, expectedRaw });
}

/**
 * `rootPath`/`exclude`가 주어지면 vault 전체 스캔과 같은 제외 규칙을 적용한다 —
 * 그러지 않으면 exclude 설정이 워처 기반 증분 갱신에서만 조용히 무시된다(I1).
 */
export async function getFileTasks(
  path: string,
  rootPath?: null | string,
  exclude: string[] = [],
): Promise<TaskEntry[]> {
  return invoke<TaskEntry[]>("get_file_tasks", {
    path,
    rootPath: rootPath ?? null,
    exclude,
  });
}

export async function getTasksLinkingTo(
  rootPath: string,
  target: string,
  exclude: string[] = [],
): Promise<TaskEntry[]> {
  return invoke<TaskEntry[]>("get_tasks_linking_to", {
    rootPath,
    target,
    exclude,
  });
}

export async function getVaultTasks(
  rootPath: string,
  exclude: string[] = [],
): Promise<TaskEntry[]> {
  return invoke<TaskEntry[]>("get_vault_tasks", { rootPath, exclude });
}

/** §305 필드 설정 결과 줄만 받아온다. 빈 `value`는 필드를 제거한다. */
export async function previewTaskFieldLine(
  raw: string,
  field: string,
  value: string,
): Promise<string> {
  return invoke<string>("preview_task_field_line", { raw, field, value });
}

/**
 * 한 상태 전이의 서술 — Rust `task::write::StateWrite`와 같은 모양이다.
 *
 * ‼️ `today`·`timer`·`dates`는 전부 **프런트가 계산해 온 값**이고 백엔드는 자리만
 * 정한다. 셋 다 달력이나 시계를 읽는데, 이 코드베이스는 Rust가 시간대를 추측하지
 * 않게 한다 — 그리고 에디터 경로(디스크를 타지 않는다)가 이미 같은 규칙 함수를
 * 쓰므로, 백엔드에 옮겨 적으면 같은 규칙이 두 벌이 되고 두 표면이 갈린다.
 *
 * 넷이 한 객체인 것은 인자 수 때문이 아니다: **한 전이 안에서 함께 일어나야** 한다.
 * 굴리기를 별도 쓰기로 내면 그 사이에 낀 stale이 "상태는 굴렀는데 날짜는 안 굴린"
 * 줄을 만든다.
 */
export interface TaskStateWrite {
  /**
   * §318 굴린 날짜. 빈 객체면 날짜를 건드리지 않는다. 계산은
   * `utils/tasks/task-recurrence.ts` 한 곳이다.
   */
  dates?: Partial<Record<"due" | "scheduled" | "start", string>>;
  newState: TaskState;
  recordDoneDate: boolean;
  /**
   * §18.18 M4 `⏱`의 다음 값. `undefined`/`null`은 "건드리지 말라"(기록 끔),
   * `""`는 제거, 그 밖은 그 값으로 맞춘다.
   */
  timer?: null | string;
  /** 호출자가 로컬 시간대로 계산한 오늘. */
  today: string;
}

/**
 * §305 파일을 건드리지 않고 상태 전이 결과 줄만 받아온다. 열린 문서를 고칠 때
 * 쓴다 — 변환 로직을 TS에 재구현하지 않기 위한 경로다.
 */
export async function previewTaskStateLine(
  raw: string,
  write: TaskStateWrite,
): Promise<string> {
  return invoke<string>("preview_task_state_line", { raw, write });
}

/**
 * §312 태그 토글 결과 줄만 받아온다 — 파일은 건드리지 않는다. `on=false`는 제거.
 * §303 순서상 태그는 이모지 필드 **앞**에 들어간다.
 */
export async function previewTaskTagLine(
  raw: string,
  tag: string,
  on: boolean,
): Promise<string> {
  return invoke<string>("preview_task_tag_line", { raw, tag, on });
}

/** 빈 `value`는 필드를 제거한다. 갱신된 줄 원문을 돌려준다. */
export async function setTaskField(
  path: string,
  line: number,
  expectedRaw: string,
  field: string,
  value: string,
): Promise<string> {
  return invoke<string>("set_task_field", {
    path,
    line,
    expectedRaw,
    field,
    value,
  });
}

/**
 * 파일이 그 사이 바뀌었으면 "stale"로 reject된다.
 */
export async function setTaskState(
  path: string,
  line: number,
  expectedRaw: string,
  write: TaskStateWrite,
): Promise<string> {
  return invoke<string>("set_task_state", { expectedRaw, line, path, write });
}

/**
 * §312 태스크 줄의 태그를 켜고 끈다. `on=false`는 제거. 갱신된 줄 원문을 돌려준다.
 * 파일이 그 사이 바뀌었으면 "stale"로 reject된다.
 */
export async function setTaskTag(
  path: string,
  line: number,
  expectedRaw: string,
  tag: string,
  on: boolean,
): Promise<string> {
  return invoke<string>("set_task_tag", {
    path,
    line,
    expectedRaw,
    tag,
    on,
  });
}
