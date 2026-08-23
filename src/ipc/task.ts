// §304 §305 Task IPC commands
import { invoke } from "@tauri-apps/api/core";

import type { TaskEntry, TaskState } from "./types";

export async function getFileTasks(path: string): Promise<TaskEntry[]> {
  return invoke<TaskEntry[]>("get_file_tasks", { path });
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
