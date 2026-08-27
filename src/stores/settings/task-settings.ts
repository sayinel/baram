import type { StateCreator } from "zustand";

export interface TaskSettingsSlice {
  setTasksCaptureFile: (v: string) => void;
  setTasksEnabled: (v: boolean) => void;
  setTasksExcludePaths: (v: string[]) => void;
  setTasksRecordDoneDate: (v: boolean) => void;
  setTasksWeekStart: (v: TaskWeekStart) => void;
  tasksCaptureFile: string;
  tasksEnabled: boolean;
  tasksExcludePaths: string[];
  tasksRecordDoneDate: boolean;
  tasksWeekStart: TaskWeekStart;
}
type TaskWeekStart = "monday" | "sunday";

export const createTaskSettingsSlice: StateCreator<
  TaskSettingsSlice,
  [],
  [],
  TaskSettingsSlice
> = (set) => ({
  // §311 Task management
  tasksEnabled: true,
  tasksExcludePaths: [],
  tasksWeekStart: "monday",
  tasksRecordDoneDate: true,
  // §312 수집함 파일 — 활성 컨텍스트 루트 기준 상대 경로
  tasksCaptureFile: "Inbox.md",

  // Setters
  setTasksEnabled: (tasksEnabled) => set({ tasksEnabled }),
  setTasksExcludePaths: (tasksExcludePaths) => set({ tasksExcludePaths }),
  setTasksWeekStart: (tasksWeekStart) => set({ tasksWeekStart }),
  setTasksRecordDoneDate: (tasksRecordDoneDate) => set({ tasksRecordDoneDate }),
  setTasksCaptureFile: (tasksCaptureFile) => set({ tasksCaptureFile }),
});
