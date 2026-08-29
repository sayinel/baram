// §307D Quick Capture 태스크 모드 — 켜면 캡처가 fleeting note가 아니라
// 수집함 파일의 한 줄이 된다.
//
// 파일 생성 경로(`captureFleeting`)를 쓰지 않는 이유: 캡처마다 `inbox/{id}.md`가
// 하나씩 생기는데, 태스크는 노트로 승격하지 않기로 확정했으므로(§18.0) 그 한 줄짜리
// 파일들에는 출구가 없다.

import { useCallback, useState } from "react";

import type { CaptureErrorCode } from "../../services/task-capture";

import { useEditorContext } from "../../contexts/editor-context";
import { CaptureError, captureTask } from "../../services/task-capture";
import { useSettingsStore } from "../../stores/settings/store";
import { resolveTasksHome } from "../../utils/tasks/tasks-home";

interface CaptureTaskMode {
  enabled: boolean;
  /**
   * 다이얼로그가 열릴 때마다 **여는 쪽이 정한 상태**로 되돌린다(§307D 리뷰 Minor 6).
   * 인자가 없으면 꺼진 상태 — 지난 캡처의 모드가 넘어오지 않는다. §313 전역 캡처만
   * 켜진 상태로 연다.
   */
  reset: (initial?: boolean) => void;
  save: (body: string, tags: string[]) => Promise<void>;
  toggle: () => void;
}

/**
 * 실패 원인 → i18n 키.
 *
 * 모든 실패를 "수집함에 저장하지 못했습니다."로 뭉개면, 볼트를 열지 않은 사용자가
 * 수집함 얘기를 듣는다 — 원인과 다른 문구다(리뷰 Minor 5). 코드가 없는 예외
 * (권한·디스크)만 그 일반 문구로 떨어진다.
 */
const ERROR_KEY: Record<CaptureErrorCode, string> = {
  dirtyTab: "journal.capture.error.taskDirtyTab",
  emptyBody: "journal.capture.error.empty",
  noTasksHome: "journal.capture.error.taskNoHome",
  notMarkdown: "journal.capture.error.taskNotMarkdown",
  outsideHome: "journal.capture.error.taskOutsideHome",
};

export function captureErrorKey(err: unknown): string {
  return err instanceof CaptureError
    ? ERROR_KEY[err.code]
    : "journal.capture.error.taskSave";
}

export function useCaptureTaskMode(): CaptureTaskMode {
  const [enabled, setEnabled] = useState(false);
  const editor = useEditorContext();

  const reset = useCallback((initial = false) => setEnabled(initial), []);
  const toggle = useCallback(() => setEnabled((v) => !v), []);

  const save = useCallback(
    async (body: string, tags: string[]) => {
      // §312.1 착지점은 **태스크 홈**이지 활성 컨텍스트 루트가 아니다. ⌘⇧N의 정체성은
      // "아이디어를 Zettel에 모은다"인데 태스크 모드만 거기서 벗어나 컨텍스트를 따라
      // 떠다니고 있었다 — 같은 다이얼로그가 체크박스 하나로 목적지 *계열*을 바꿨다.
      const { tasksCaptureFile, tasksHome, zettelkastenDirectory } =
        useSettingsStore.getState();
      const home = resolveTasksHome(tasksHome, zettelkastenDirectory);
      if (!home) {
        // 열린 vault로 폴백하지 않는다 — 그것이 §312.1이 없애려던 결함 그 자체다.
        // 설정되지 않았다는 사실은 문구로 말한다(§312: 보이지 않는 곳에 쓰고 성공을
        // 보고하지 않는다).
        throw new CaptureError(
          "noTasksHome",
          "captureTask: no tasks home is configured",
        );
      }
      await captureTask({
        body,
        captureFile: tasksCaptureFile,
        editor,
        tags,
        tasksHome: home,
        today: todayIso(),
      });
    },
    [editor],
  );

  return { enabled, reset, save, toggle };
}

function todayIso(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
