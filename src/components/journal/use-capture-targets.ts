// §320 Quick Capture 대상 로딩 훅 — 다이얼로그가 열릴 때 `notes/`를 한 번 읽고,
// 태그가 바뀔 때마다 그 결과 위에서 대상을 다시 푼다.
//
// 미리보기(§324-c, Task 7)와 저장(§320, Task 5)이 **같은 값**을 써야 하므로 훅
// 하나로 묶는다. 각각 따로 계산하면 미리보기가 "영감노트에 갑니다"라고 말한 뒤
// 저장이 다른 곳에 붙이는 날이 온다 — `imagesToLinks`가 세는 것과 바꾸는 것을
// 같은 함수로 하는 이유와 같다(`QuickCaptureDialog.tsx:184-185`).

import { useEffect, useMemo, useState } from "react";

import type {
  CaptureTarget,
  NoteCandidate,
} from "../../utils/zettelkasten/capture-target";

import { listDir, readFile } from "../../ipc/invoke";
import { useFileStore } from "../../stores/file/file";
import { useSettingsStore } from "../../stores/settings/store";
import { logger } from "../../utils/logger";
import { countCaptures } from "../../utils/zettelkasten/capture-append";
import { resolveCaptureTargets } from "../../utils/zettelkasten/capture-target";
import { resolveZettelDir } from "../../utils/zettelkasten/zettelkasten";

export interface CaptureTargets {
  /** 아직 노트를 읽는 중 — 미리보기가 아무 말도 하지 않아야 하는 상태 */
  loading: boolean;
  /** 현재 태그 목록이 지목하는 노트들. 빈 배열 = inbox 폴백 */
  targets: (CaptureTarget & { captureCount: number })[];
}

/**
 * `notes/`(허브 후보) 아래를 열릴 때마다 한 번 읽는다. **주의**: `open`에만
 * 의존한다 — `tags`를 의존성에 넣으면 한 글자 칠 때마다 Zettel 공간 전체를
 * 다시 훑어 IPC 폭풍을 만든다(`use-capture-tags.ts:43-84`가 같은 형태의
 * 선례). 태그 목록은 아래 `useMemo`의 입력일 뿐이다.
 *
 * `SCAN_LIMIT` 같은 상한을 두지 않는다 — 태그가 주소인 설계에서 목록에서 빠진
 * 허브는 오타를 유발하고 `inbox/` 낙오로 이어진다(§324-b).
 */
export function useCaptureTargets(
  open: boolean,
  tags: string[],
): CaptureTargets {
  const [notes, setNotes] = useState<NoteCandidate[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setNotes([]);
    let cancelled = false;

    (async () => {
      try {
        const { rootPath } = useFileStore.getState();
        const { zettelkastenDirectory } = useSettingsStore.getState();
        const zettelDir = resolveZettelDir(rootPath, zettelkastenDirectory);
        if (!zettelDir) return;

        const entries = await listDir(`${zettelDir}/notes`, true).catch(
          () => [],
        );
        const mdFiles = entries.filter(
          (e) => !e.isDir && e.name.endsWith(".md"),
        );

        const loaded = await Promise.all(
          mdFiles.map(async (e): Promise<NoteCandidate | null> => {
            try {
              return {
                content: await readFile(e.path),
                filename: e.name,
                path: e.path,
              };
            } catch {
              return null;
            }
          }),
        );
        if (!cancelled) {
          setNotes(loaded.filter((n): n is NoteCandidate => n !== null));
        }
      } catch (err) {
        logger.error("[QuickCapture] Target note scan failed:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open]);

  const targets = useMemo(
    () =>
      resolveCaptureTargets(tags, notes).map((t) => ({
        ...t,
        captureCount: countCaptures(
          notes.find((n) => n.path === t.path)?.content ?? "",
        ),
      })),
    [tags, notes],
  );

  return { loading, targets };
}
