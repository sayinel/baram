// §307D Quick Capture 태스크 모드 — 켜면 캡처가 fleeting note가 아니라
// 수집함 파일의 한 줄이 된다.
//
// 파일 생성 경로(`captureFleeting`)를 쓰지 않는 이유: 캡처마다 `inbox/{id}.md`가
// 하나씩 생기는데, 태스크는 노트로 승격하지 않기로 확정했으므로(§18.0) 그 한 줄짜리
// 파일들에는 출구가 없다.

import { useCallback, useState } from "react";

import { useEditorContext } from "../../contexts/editor-context";
import { captureTask } from "../../services/task-capture";
import { useFileStore } from "../../stores/file/file";
import { useSettingsStore } from "../../stores/settings/store";

interface CaptureTaskMode {
  enabled: boolean;
  save: (body: string) => Promise<void>;
  toggle: () => void;
}

export function useCaptureTaskMode(): CaptureTaskMode {
  const [enabled, setEnabled] = useState(false);
  const editor = useEditorContext();

  const toggle = useCallback(() => setEnabled((v) => !v), []);

  const save = useCallback(
    async (body: string) => {
      const { rootPath } = useFileStore.getState();
      if (!rootPath) throw new Error("no vault");
      const { tasksCaptureFile } = useSettingsStore.getState();
      await captureTask({
        body,
        captureFile: tasksCaptureFile,
        editor,
        rootPath,
        today: todayIso(),
      });
    },
    [editor],
  );

  return { enabled, save, toggle };
}

function todayIso(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
