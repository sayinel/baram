// §57b Git 상태 관리 스토어
import { create } from "zustand";
import type { GitChange, GitStatusInfo, GitFileDiff, GitBranchInfo } from "../ipc/types";
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
    const unstaged = get().changes.filter((c) => !c.staged).map((c) => c.path);
    if (unstaged.length > 0) {
      await get().stageFiles(path, unstaged);
    }
  },

  unstageAll: async (path) => {
    const staged = get().changes.filter((c) => c.staged).map((c) => c.path);
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
    case "modified": return "M";
    case "added": return "A";
    case "deleted": return "D";
    case "renamed": return "R";
    case "untracked": return "U";
    default: return "?";
  }
}

// Helper: status color class
export function statusColorClass(status: string): string {
  switch (status) {
    case "modified": return "git-status-modified";
    case "added":
    case "untracked": return "git-status-added";
    case "deleted": return "git-status-deleted";
    case "renamed": return "git-status-renamed";
    default: return "";
  }
}
