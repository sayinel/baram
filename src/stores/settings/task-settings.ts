import type { StateCreator } from "zustand";

export interface TaskSettingsSlice {
  setTasksArchiveAfterDays: (v: number) => void;
  setTasksCaptureFile: (v: string) => void;
  setTasksEnabled: (v: boolean) => void;
  setTasksExcludePaths: (v: string[]) => void;
  setTasksRecordDoneDate: (v: boolean) => void;
  setTasksWeekStart: (v: TaskWeekStart) => void;
  tasksArchiveAfterDays: number;
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
  // §312 "완료 항목 정리"가 대상으로 삼는 경과일. 자동 실행하지 않으므로 이 값이 커도
  // 아무 일도 일어나지 않는다 — 무엇을 옮길지 고르는 기준일 뿐이다.
  tasksArchiveAfterDays: 30,

  // Setters
  setTasksEnabled: (tasksEnabled) => set({ tasksEnabled }),
  setTasksExcludePaths: (tasksExcludePaths) => set({ tasksExcludePaths }),
  setTasksWeekStart: (tasksWeekStart) => set({ tasksWeekStart }),
  setTasksRecordDoneDate: (tasksRecordDoneDate) => set({ tasksRecordDoneDate }),
  setTasksCaptureFile: (tasksCaptureFile) => set({ tasksCaptureFile }),
  setTasksArchiveAfterDays: (tasksArchiveAfterDays) =>
    set({ tasksArchiveAfterDays }),
});
