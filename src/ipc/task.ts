// §304 §305 Task IPC commands
import { invoke } from "@tauri-apps/api/core";

import type { TaskEntry, TaskState } from "./types";

/** §312 수집함 파일 끝에 한 줄 붙인다. 파일이 없으면 만든다. */
export async function appendTaskLine(
  path: string,
  line: string,
): Promise<string> {
  return invoke<string>("append_task_line", { path, line });
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
 * §305 파일을 건드리지 않고 상태 전이 결과 줄만 받아온다. 열린 문서를 고칠 때
 * 쓴다 — 변환 로직을 TS에 재구현하지 않기 위한 경로다.
 */
export async function previewTaskStateLine(
  raw: string,
  newState: TaskState,
  recordDoneDate: boolean,
  today: string,
): Promise<string> {
  return invoke<string>("preview_task_state_line", {
    raw,
    newState,
    recordDoneDate,
    today,
  });
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
 * `today`는 호출자가 로컬 시간대로 계산해 넘긴다 — 백엔드가 시간대를 추측하지
 * 않게 하기 위해서다. 파일이 그 사이 바뀌었으면 "stale"로 reject된다.
 */
export async function setTaskState(
  path: string,
  line: number,
  expectedRaw: string,
  newState: TaskState,
  recordDoneDate: boolean,
  today: string,
): Promise<string> {
  return invoke<string>("set_task_state", {
    path,
    line,
    expectedRaw,
    newState,
    recordDoneDate,
    today,
  });
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
