// §57b Git 상태 관리 스토어
import { create } from "zustand";
import type {
  GitChange,
  GitStatusInfo,
  GitFileDiff,
  GitBranchInfo,
  GitLogEntry,
  GitStashEntry,
  GitRemoteInfo,
  GitAheadBehind,
} from "../ipc/types";
import {
  gitStatus,
  gitStage,
  gitUnstage,
  gitCommit,
  gitDiffFile,
  gitBranches,
  gitSwitchBranch,
  gitDiscard,
  gitCreateBranch,
  gitLog,
  gitStashSave,
  gitStashList,
  gitStashPop,
  gitStashDrop,
  gitRemotes,
  gitFetch,
  gitPull,
  gitPush,
  gitAheadBehind,
  gitDeleteBranch,
} from "../ipc/invoke";

interface GitState {
  // Status
  isRepo: boolean;
  branch: string;
  changes: GitChange[];
  loading: boolean;
  error: string | null;

  // Branches
  branchList: GitBranchInfo[];
  showBranchPicker: boolean;

  // Diff
  activeDiff: GitFileDiff | null;
  diffLoading: boolean;

  // Commit
  commitMessage: string;
  committing: boolean;

  // §67 Log
  logEntries: GitLogEntry[];
  logLoading: boolean;

  // §67 Stash
  stashEntries: GitStashEntry[];
  stashLoading: boolean;

  // §67 Remote
  remotes: GitRemoteInfo[];
  aheadBehind: GitAheadBehind | null;
  pushing: boolean;
  pulling: boolean;

  // §67 Tab
  activeTab: "changes" | "history" | "stash";

  // Actions
  refresh: (path: string) => Promise<void>;
  stageFiles: (path: string, files: string[]) => Promise<void>;
  unstageFiles: (path: string, files: string[]) => Promise<void>;
  commitChanges: (path: string) => Promise<string>;
  loadDiff: (path: string, filePath: string) => Promise<void>;
  closeDiff: () => void;
  loadBranches: (path: string) => Promise<void>;
  switchBranch: (path: string, branchName: string) => Promise<void>;
  createBranch: (path: string, branchName: string) => Promise<void>;
  discardFiles: (path: string, files: string[]) => Promise<void>;
  setCommitMessage: (msg: string) => void;
  setShowBranchPicker: (show: boolean) => void;
  stageAll: (path: string) => Promise<void>;
  unstageAll: (path: string) => Promise<void>;

  // §67 New actions
  loadLog: (path: string, maxCount?: number) => Promise<void>;
  loadStash: (path: string) => Promise<void>;
  saveStash: (
    path: string,
    message: string,
    includeUntracked?: boolean,
  ) => Promise<void>;
  popStash: (path: string, index?: number) => Promise<void>;
  dropStash: (path: string, index?: number) => Promise<void>;
  loadRemotes: (path: string) => Promise<void>;
  loadAheadBehind: (path: string) => Promise<void>;
  fetchRemote: (path: string, remote?: string) => Promise<void>;
  pullRemote: (
    path: string,
    remote?: string,
    branch?: string,
  ) => Promise<string>;
  pushRemote: (path: string, remote?: string, branch?: string) => Promise<void>;
  deleteBranch: (path: string, branchName: string) => Promise<void>;
  setActiveTab: (tab: "changes" | "history" | "stash") => void;
}

export const useGitStore = create<GitState>((set, get) => ({
  isRepo: false,
  branch: "",
  changes: [],
  loading: false,
  error: null,
  branchList: [],
  showBranchPicker: false,
  activeDiff: null,
  diffLoading: false,
  commitMessage: "",
  committing: false,
  logEntries: [],
  logLoading: false,
  stashEntries: [],
  stashLoading: false,
  remotes: [],
  aheadBehind: null,
  pushing: false,
  pulling: false,
  activeTab: "changes",

  refresh: async (path) => {
    set({ loading: true, error: null });
    try {
      const info: GitStatusInfo = await gitStatus(path);
      set({
        isRepo: info.is_repo,
        branch: info.branch,
        changes: info.changes,
        loading: false,
      });
      // Also refresh ahead/behind after status
      if (info.is_repo) {
        await get().loadAheadBehind(path);
      }
    } catch (e) {
      set({ loading: false, error: String(e) });
    }
  },

  stageFiles: async (path, files) => {
    try {
      await gitStage(path, files);
      await get().refresh(path);
    } catch (e) {
      set({ error: String(e) });
    }
  },

  unstageFiles: async (path, files) => {
    try {
      await gitUnstage(path, files);
      await get().refresh(path);
    } catch (e) {
      set({ error: String(e) });
    }
  },

  stageAll: async (path) => {
    const unstaged = get()
      .changes.filter((c) => !c.staged)
      .map((c) => c.path);
    if (unstaged.length > 0) {
      await get().stageFiles(path, unstaged);
    }
  },

  unstageAll: async (path) => {
    const staged = get()
      .changes.filter((c) => c.staged)
      .map((c) => c.path);
    if (staged.length > 0) {
      await get().unstageFiles(path, staged);
    }
  },

  commitChanges: async (path) => {
    const msg = get().commitMessage.trim();
    if (!msg) {
      set({ error: "Commit message is required" });
      return "";
    }
    set({ committing: true, error: null });
    try {
      const oid = await gitCommit(path, msg);
      set({ commitMessage: "", committing: false });
      await get().refresh(path);
      return oid;
    } catch (e) {
      set({ committing: false, error: String(e) });
      return "";
    }
  },

  loadDiff: async (path, filePath) => {
    set({ diffLoading: true });
    try {
      const diff = await gitDiffFile(path, filePath);
      set({ activeDiff: diff, diffLoading: false });
    } catch (e) {
      set({ diffLoading: false, error: String(e) });
    }
  },

  closeDiff: () => set({ activeDiff: null }),

  loadBranches: async (path) => {
    try {
      const branches = await gitBranches(path);
      set({ branchList: branches });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  switchBranch: async (path, branchName) => {
    try {
      await gitSwitchBranch(path, branchName);
      set({ showBranchPicker: false });
      await get().refresh(path);
    } catch (e) {
      set({ error: String(e) });
    }
  },

  createBranch: async (path, branchName) => {
    try {
      await gitCreateBranch(path, branchName);
      await get().loadBranches(path);
    } catch (e) {
      set({ error: String(e) });
    }
  },

  discardFiles: async (path, files) => {
    try {
      await gitDiscard(path, files);
      await get().refresh(path);
    } catch (e) {
      set({ error: String(e) });
    }
  },

  setCommitMessage: (msg) => set({ commitMessage: msg }),
  setShowBranchPicker: (show) => set({ showBranchPicker: show }),

  // §67 New actions
  loadLog: async (path, maxCount) => {
    set({ logLoading: true });
    try {
      const entries = await gitLog(path, maxCount);
      set({ logEntries: entries, logLoading: false });
    } catch (e) {
      set({ logLoading: false, error: String(e) });
    }
  },

  loadStash: async (path) => {
    set({ stashLoading: true });
    try {
      const entries = await gitStashList(path);
      set({ stashEntries: entries, stashLoading: false });
    } catch (e) {
      set({ stashLoading: false, error: String(e) });
    }
  },

  saveStash: async (path, message, includeUntracked) => {
    try {
      await gitStashSave(path, message, includeUntracked);
      await get().loadStash(path);
      await get().refresh(path);
    } catch (e) {
      set({ error: String(e) });
    }
  },

  popStash: async (path, index) => {
    try {
      await gitStashPop(path, index);
      await get().loadStash(path);
      await get().refresh(path);
    } catch (e) {
      set({ error: String(e) });
    }
  },

  dropStash: async (path, index) => {
    try {
      await gitStashDrop(path, index);
      await get().loadStash(path);
    } catch (e) {
      set({ error: String(e) });
    }
  },

  loadRemotes: async (path) => {
    try {
      const remotes = await gitRemotes(path);
      set({ remotes });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  loadAheadBehind: async (path) => {
    try {
      const ab = await gitAheadBehind(path);
      set({ aheadBehind: ab });
    } catch {
      // Silently ignore — remote may not exist
    }
  },

  fetchRemote: async (path, remote) => {
    try {
      await gitFetch(path, remote);
      await get().loadAheadBehind(path);
    } catch (e) {
      set({ error: String(e) });
    }
  },

  pullRemote: async (path, remote, branch) => {
    set({ pulling: true, error: null });
    try {
      const result = await gitPull(path, remote, branch);
      set({ pulling: false });
      await get().refresh(path);
      return result;
    } catch (e) {
      set({ pulling: false, error: String(e) });
      return "";
    }
  },

  pushRemote: async (path, remote, branch) => {
    set({ pushing: true, error: null });
    try {
      await gitPush(path, remote, branch);
      set({ pushing: false });
      await get().loadAheadBehind(path);
    } catch (e) {
      set({ pushing: false, error: String(e) });
    }
  },

  deleteBranch: async (path, branchName) => {
    try {
      await gitDeleteBranch(path, branchName);
      await get().loadBranches(path);
    } catch (e) {
      set({ error: String(e) });
    }
  },

  setActiveTab: (tab) => set({ activeTab: tab }),
}));

// Helper: get unique file paths with merged staged/unstaged status
export function groupChanges(changes: GitChange[]): {
  staged: GitChange[];
  unstaged: GitChange[];
} {
  return {
    staged: changes.filter((c) => c.staged),
    unstaged: changes.filter((c) => !c.staged),
  };
}

// Helper: status icon
export function statusIcon(status: string): string {
  switch (status) {
    case "modified":
      return "M";
    case "added":
      return "A";
    case "deleted":
      return "D";
    case "renamed":
      return "R";
    case "untracked":
      return "U";
    default:
      return "?";
  }
}

// Helper: status color class
export function statusColorClass(status: string): string {
  switch (status) {
    case "modified":
      return "git-status-modified";
    case "added":
    case "untracked":
      return "git-status-added";
    case "deleted":
      return "git-status-deleted";
    case "renamed":
      return "git-status-renamed";
    default:
      return "";
  }
}
