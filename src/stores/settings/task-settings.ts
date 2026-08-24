import type { StateCreator } from "zustand";

export interface TaskSettingsSlice {
  setTasksEnabled: (v: boolean) => void;
  setTasksExcludePaths: (v: string[]) => void;
  setTasksRecordDoneDate: (v: boolean) => void;
  setTasksWeekStart: (v: TaskWeekStart) => void;
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

  // Setters
  setTasksEnabled: (tasksEnabled) => set({ tasksEnabled }),
  setTasksExcludePaths: (tasksExcludePaths) => set({ tasksExcludePaths }),
  setTasksWeekStart: (tasksWeekStart) => set({ tasksWeekStart }),
  setTasksRecordDoneDate: (tasksRecordDoneDate) => set({ tasksRecordDoneDate }),
});
