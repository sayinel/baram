// §57b / §67 Git IPC commands
import { invoke } from "@tauri-apps/api/core";

import type {
  GitAheadBehind,
  GitBranchInfo,
  GitFileDiff,
  GitLogEntry,
  GitRemoteInfo,
  GitStashEntry,
  GitStatusInfo,
} from "./types";

export async function gitAheadBehind(
  path: string,
  branch?: string,
  remote?: string,
): Promise<GitAheadBehind> {
  return invoke<GitAheadBehind>("git_ahead_behind", { path, branch, remote });
}

export async function gitBranches(path: string): Promise<GitBranchInfo[]> {
  return invoke<GitBranchInfo[]>("git_branches", { path });
}

export async function gitCommit(
  path: string,
  message: string,
): Promise<string> {
  return invoke<string>("git_commit", { path, message });
}

export async function gitCreateBranch(
  path: string,
  branchName: string,
): Promise<void> {
  return invoke<void>("git_create_branch", { path, branchName });
}

export async function gitDeleteBranch(
  path: string,
  branchName: string,
): Promise<void> {
  return invoke<void>("git_delete_branch", { path, branchName });
}

export async function gitDiffFile(
  path: string,
  filePath: string,
): Promise<GitFileDiff> {
  return invoke<GitFileDiff>("git_diff_file", { path, filePath });
}

export async function gitDiscard(path: string, files: string[]): Promise<void> {
  return invoke<void>("git_discard", { path, files });
}

export async function gitFetch(path: string, remote?: string): Promise<void> {
  return invoke<void>("git_fetch", { path, remote });
}

// §67 Git Advanced commands
export async function gitLog(
  path: string,
  maxCount?: number,
): Promise<GitLogEntry[]> {
  return invoke<GitLogEntry[]>("git_log", { path, maxCount });
}

export async function gitPull(
  path: string,
  remote?: string,
  branch?: string,
): Promise<string> {
  return invoke<string>("git_pull", { path, remote, branch });
}

export async function gitPush(
  path: string,
  remote?: string,
  branch?: string,
): Promise<void> {
  return invoke<void>("git_push", { path, remote, branch });
}

export async function gitRemotes(path: string): Promise<GitRemoteInfo[]> {
  return invoke<GitRemoteInfo[]>("git_remotes", { path });
}

export async function gitStage(path: string, files: string[]): Promise<void> {
  return invoke<void>("git_stage", { path, files });
}

export async function gitStashDrop(
  path: string,
  index?: number,
): Promise<void> {
  return invoke<void>("git_stash_drop", { path, index });
}

export async function gitStashList(path: string): Promise<GitStashEntry[]> {
  return invoke<GitStashEntry[]>("git_stash_list", { path });
}

export async function gitStashPop(path: string, index?: number): Promise<void> {
  return invoke<void>("git_stash_pop", { path, index });
}

export async function gitStashSave(
  path: string,
  message: string,
  includeUntracked?: boolean,
): Promise<string> {
  return invoke<string>("git_stash_save", { path, message, includeUntracked });
}

// §57b Git commands
export async function gitStatus(path: string): Promise<GitStatusInfo> {
  return invoke<GitStatusInfo>("git_status", { path });
}

export async function gitSwitchBranch(
  path: string,
  branchName: string,
): Promise<void> {
  return invoke<void>("git_switch_branch", { path, branchName });
}

export async function gitUnstage(path: string, files: string[]): Promise<void> {
  return invoke<void>("git_unstage", { path, files });
}
