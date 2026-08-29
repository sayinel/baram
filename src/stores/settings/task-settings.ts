import type { TaskScanScope } from "../../utils/tasks/task-scan-scope";
import type { StateCreator } from "zustand";

import { DEFAULT_CAPTURE_FILE } from "../../utils/tasks/tasks-home";

export interface TaskSettingsSlice {
  setTasksArchiveAfterDays: (v: number) => void;
  setTasksCaptureFile: (v: string) => void;
  setTasksEnabled: (v: boolean) => void;
  setTasksExcludePaths: (v: string[]) => void;
  setTasksGlobalCaptureShortcut: (v: null | string) => void;
  setTasksHome: (v: string) => void;
  setTasksRecordDoneDate: (v: boolean) => void;
  setTasksScanScope: (v: TaskScanScope) => void;
  setTasksWeekStart: (v: TaskWeekStart) => void;
  tasksArchiveAfterDays: number;
  tasksCaptureFile: string;
  tasksEnabled: boolean;
  tasksExcludePaths: string[];
  /** §313 전역 캡처 단축키. 앱 표기(`Mod+Shift+N`). `null` = 등록하지 않음 */
  tasksGlobalCaptureShortcut: null | string;
  tasksHome: string;
  tasksRecordDoneDate: boolean;
  tasksScanScope: TaskScanScope;
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
  // §312.1 태스크 홈 — 캡처와 배수구가 사는 자리. 빈 값이면 `resolveTasksHome`이
  // Zettel 디렉터리로 떨어진다. **활성 컨텍스트 루트로는 떨어지지 않는다** — 그것이
  // §312.1이 없애려던 "컨텍스트 따라 떠다니는 수집함" 그 자체다.
  tasksHome: "",
  // §312.1 수집함 파일 — **태스크 홈** 기준 상대 경로. `tasks/` 서브트리 안에 두는 것이
  // 기본값이라 §312 불가침 규칙의 화이트리스트가 한 줄로 성립한다.
  tasksCaptureFile: DEFAULT_CAPTURE_FILE,
  // §312.1 아젠다가 보는 범위. 기본이 "전체"인 이유는 §312 상황 1 때문이다 — 문서 안에
  // 그 자리에 친 `[ ] `는 정의상 태스크 홈 밖에 남는데, 그것이 가장 흔한 캡처 경로다.
  tasksScanScope: "allVaults",
  // §312 "완료 항목 정리"가 대상으로 삼는 경과일. 자동 실행하지 않으므로 이 값이 커도
  // 아무 일도 일어나지 않는다 — 무엇을 옮길지 고르는 기준일 뿐이다.
  tasksArchiveAfterDays: 30,
  // §313 전역 캡처 단축키. **기본값은 없음**이다 — 전역 단축키는 OS 전체에서 키를
  // 가로채므로, 우리가 고른 조합이 사용자가 이미 다른 앱에 쓰는 조합일 수 있다.
  // 등록은 사용자가 지정할 때만 일어난다.
  tasksGlobalCaptureShortcut: null,

  // Setters
  setTasksEnabled: (tasksEnabled) => set({ tasksEnabled }),
  setTasksExcludePaths: (tasksExcludePaths) => set({ tasksExcludePaths }),
  setTasksWeekStart: (tasksWeekStart) => set({ tasksWeekStart }),
  setTasksRecordDoneDate: (tasksRecordDoneDate) => set({ tasksRecordDoneDate }),
  setTasksHome: (tasksHome) => set({ tasksHome }),
  setTasksCaptureFile: (tasksCaptureFile) => set({ tasksCaptureFile }),
  setTasksScanScope: (tasksScanScope) => set({ tasksScanScope }),
  setTasksArchiveAfterDays: (tasksArchiveAfterDays) =>
    set({ tasksArchiveAfterDays }),
  setTasksGlobalCaptureShortcut: (tasksGlobalCaptureShortcut) =>
    set({ tasksGlobalCaptureShortcut }),
});
