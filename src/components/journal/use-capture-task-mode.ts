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
import { useFileStore } from "../../stores/file/file";
import { useSettingsStore } from "../../stores/settings/store";

interface CaptureTaskMode {
  enabled: boolean;
  /** 다이얼로그가 열릴 때마다 꺼진 상태로 되돌린다(§307D 리뷰 Minor 6). */
  reset: () => void;
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
  notMarkdown: "journal.capture.error.taskNotMarkdown",
  noVault: "journal.capture.error.taskNoVault",
  outsideVault: "journal.capture.error.taskOutsideVault",
};

export function captureErrorKey(err: unknown): string {
  return err instanceof CaptureError
    ? ERROR_KEY[err.code]
    : "journal.capture.error.taskSave";
}

export function useCaptureTaskMode(): CaptureTaskMode {
  const [enabled, setEnabled] = useState(false);
  const editor = useEditorContext();

  const reset = useCallback(() => setEnabled(false), []);
  const toggle = useCallback(() => setEnabled((v) => !v), []);

  const save = useCallback(
    async (body: string, tags: string[]) => {
      const { rootPath } = useFileStore.getState();
      if (!rootPath) {
        throw new CaptureError("noVault", "captureTask: no vault is open");
      }
      const { tasksCaptureFile } = useSettingsStore.getState();
      await captureTask({
        body,
        captureFile: tasksCaptureFile,
        editor,
        rootPath,
        tags,
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
