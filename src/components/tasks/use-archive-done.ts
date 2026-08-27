// §312 "완료 항목 정리" 액션 — 확인 관문, 저장 전 탭 방어, 실행, 회계 보고.
//
// `use-reschedule-overdue.ts`와 같은 자리에 있고 같은 모양이지만, 이쪽은 **줄을 파일
// 사이로 옮긴다**. 그래서 저 배치에 없는 관문이 하나 더 있다: 손댈 파일이 저장되지 않은
// 탭에 열려 있으면 **아예 시작하지 않는다.**
//
// 이유는 캡처의 `assertNoUnsavedTab`과 같다. 아카이브는 디스크에 쓰는데, 그 파일의 저장
// 전 사본을 든 탭이 있으면 다음 저장이 파일을 통째로 덮어써 방금 옮긴 줄이 되살아난다 —
// 대상 파일에는 이미 붙어 있으므로 결과는 **중복**이다. §309 배치는 라우터로 그 상황을
// 처리하지만, 여기서 같은 일을 하려면 "여러 줄을 빼서 다른 파일에 붙이는" 이동 전체를
// TypeScript에 한 벌 더 구현해야 한다 — 이 프로젝트가 반복해서 대가를 치른 바로 그 종류의
// 중복이다. 이동은 Rust 한 곳에만 둔다.

import { useCallback, useMemo, useState } from "react";

import type { Translate } from "../../i18n/useTranslation";
import type { ArchiveOutcome, TaskEntry } from "../../ipc/types";

import { useTranslation } from "../../i18n/useTranslation";
import { archiveTaskLines, readFile } from "../../ipc/invoke";
import { resolveCapturePath } from "../../services/task-capture";
import { useEditorStore } from "../../stores/editor/editor";
import { useFileStore } from "../../stores/file/file";
import { refreshFileTasks } from "../../stores/tasks/task-store";
import { showAlert, showConfirm } from "../../utils/confirm-dialog";
import { logger } from "../../utils/logger";
import { basename, isUnderRoot, normalizePath } from "../../utils/path-utils";
import {
  archiveScope,
  selectArchivable,
  toArchiveItems,
} from "../../utils/tasks/task-archive";

export interface ArchiveDone {
  /** 실행 중 — 호출자가 버튼을 잠근다 */
  busy: boolean;
  /** 지금 옮길 수 있는 태스크 수. 0이면 호출자가 버튼을 감춘다 */
  count: number;
  run: () => Promise<void>;
}

export interface ArchiveDoneOptions {
  /** 설정 `tasksArchiveAfterDays` */
  afterDays: number;
  /** 설정 `tasksCaptureFile` — 루트 기준 상대 경로일 수 있다 */
  captureFile: string;
  exclude: string[];
  /**
   * 자격 판정의 기준일. 패널이 보고 있는 그 날이어야 한다 — 라이브 `new Date()`를 쓰면
   * 밤새 열어 둔 패널에서 확인 다이얼로그가 약속한 개수와 실제 대상이 어긋난다(I4).
   */
  now: Date;
  rootPath: null | string;
  tasks: TaskEntry[];
}

export function useArchiveDone({
  afterDays,
  captureFile,
  exclude,
  now,
  rootPath,
  tasks,
}: ArchiveDoneOptions): ArchiveDone {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);

  // 수집함 파일 설정이 볼트 밖이거나 마크다운이 아니면 `resolveCapturePath`가 던진다.
  // 그때는 옮길 자리를 알 수 없으므로 대상이 0이고 호출자가 버튼을 감춘다 — 설정이
  // 잘못됐다는 사실은 캡처 다이얼로그가 이미 원인별 문구로 알린다.
  const scope = useMemo(() => {
    if (!rootPath) return null;
    try {
      return archiveScope(rootPath, resolveCapturePath(rootPath, captureFile));
    } catch (err) {
      logger.warn("[tasks] archive: unusable capture file setting:", err);
      return null;
    }
  }, [captureFile, rootPath]);

  const candidates = useMemo(
    () => (scope ? selectArchivable(tasks, scope, now, afterDays) : []),
    [afterDays, now, scope, tasks],
  );

  const run = useCallback(async () => {
    // 실행 중 재클릭을 버튼의 `disabled`에만 맡기지 않는다 — 두 배치가 같은 줄 번호로
    // 겹쳐 돌면 뒤엣것이 이미 옮겨진 자리를 가리킨다. 낙관적 잠금이 막아 주지만
    // (`stale`) 사용자에게는 "절반만 옮겨졌다"로 보인다.
    if (!rootPath || !scope || candidates.length === 0 || busy) return;

    setBusy(true);
    try {
      const blocked = findBlockingTab(candidates, scope.archiveRoot);
      if (blocked) {
        await showAlert(
          t("tasks.archive.unsavedTab", { file: basename(blocked) }),
        );
        return;
      }

      // §312 파일을 대량 수정하는 동작이므로 자동 실행하지 않는다.
      const ok = await showConfirm(
        t("tasks.archive.confirm", {
          count: String(candidates.length),
          days: String(afterDays),
        }),
      );
      if (!ok) return;

      let outcome: ArchiveOutcome;
      try {
        outcome = await archiveTaskLines(
          rootPath,
          scope.capturePath,
          toArchiveItems(candidates),
          isoDate(now),
          afterDays,
        );
      } catch (err) {
        // 화이트리스트 위반은 여기로 온다 — 파일을 하나도 건드리지 않았다는 뜻이므로
        // 그렇게 말한다. 프런트가 같은 화이트리스트로 걸렀으니 도달하면 두 표가 갈렸다는
        // 신호이고, 그 사실이 로그에 남아야 한다.
        logger.error("[tasks] archive refused:", err);
        await showAlert(t("tasks.archive.error"));
        return;
      }

      // 바이트가 바뀐 파일만 다시 읽는다 — 원본과 대상 양쪽이다. 대상 파일은 이번에
      // 처음 생겼을 수도 있으므로 인덱스에 새로 들어간다.
      for (const path of outcome.paths) {
        await reloadOpenSurfaces(path);
        await refreshFileTasks(path, rootPath, exclude);
      }
      await report(outcome, t);
    } finally {
      setBusy(false);
    }
  }, [afterDays, busy, candidates, exclude, now, rootPath, scope, t]);

  return { busy, count: candidates.length, run };
}

/**
 * 이번 이동이 손댈 파일 중 **저장되지 않은 탭**에 열려 있는 것의 경로. 없으면 `null`.
 *
 * 원본은 목록에서 알 수 있지만 대상은 완료일의 달마다 갈리고, 그 달을 정하는 것은
 * Rust다(`archive_verdict`). 여기서 달을 다시 계산하면 같은 사실의 진실원이 둘이 되므로,
 * 대상은 **폴더 단위로** 본다: `Archive/` 아래 저장 전 탭이 하나라도 있으면 막는다.
 * 이번에 쓰지 않을 달의 파일까지 막을 수 있지만, 그 대가는 "저장하고 다시 누르세요"이고
 * 반대쪽 대가는 중복이다.
 *
 * ‼️ `isDirty`만으로는 부족하다. 마크다운 소스 모드 타이핑은 일부러 dirty를 세우지
 * 않으므로(`tab-surface-renderers.tsx`) 저장 전 글을 든 탭이 clean으로 보인다 — 캡처의
 * `assertNoUnsavedTab`이 그대로 통과당한 것과 같은 구멍이다. 소스 모드 탭은 버퍼에
 * 무엇이 들었는지 알 수 없으므로 dirty 여부와 무관하게 막는다.
 */
function findBlockingTab(
  candidates: TaskEntry[],
  archiveRoot: string,
): null | string {
  const sources = new Set(candidates.map((task) => normalizePath(task.path)));
  const { sourceModeTabs, tabs } = useEditorStore.getState();

  for (const tab of tabs) {
    if (!tab.filePath) continue;
    const path = normalizePath(tab.filePath);
    if (!sources.has(path) && !isUnderRoot(path, archiveRoot)) continue;
    if (tab.isDirty || sourceModeTabs.includes(tab.id)) return tab.filePath;
  }
  return null;
}

/** 패널이 보고 있는 날의 `YYYY-MM-DD` — Rust가 시간대를 추측하지 않도록 프런트가 준다. */
function isoDate(now: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/**
 * 디스크가 바뀐 파일을 열어 둔 탭들에 반영한다.
 *
 * 여기 도달한 파일에는 저장 전 탭이 없다(`findBlockingTab`이 막았다). 그러니 캐시를
 * 버려도 잃을 편집이 없다 — 디스크를 다시 읽어 `openFiles`에 넣고, 활성 탭은 그것을 다시
 * 읽게 하고, 배경 탭은 낡음 표시를 달아 돌아왔을 때 캐시가 아니라 새 내용을 읽게 한다.
 *
 * 워처의 `file:changed`도 결국 도착하지만 그것은 안전망이지 통로가 아니다 —
 * `sync-open-surfaces.ts` 머리말이 그 대가를 적어 두었다.
 */
async function reloadOpenSurfaces(path: string): Promise<void> {
  const { activeTabId, markContentStale, requestContentRefresh, tabs } =
    useEditorStore.getState();
  const open = tabs.filter((tab) => tab.filePath === path);
  if (open.length === 0) return;

  try {
    useFileStore.getState().setFileContent(path, await readFile(path));
  } catch (err) {
    // 다시 읽지 못해도 이동 자체는 끝났다. 워처가 뒤따라 갱신한다.
    logger.warn("[tasks] archive: could not reload", path, err);
    return;
  }
  for (const tab of open) {
    // 이 파일은 줄이 통째로 빠졌다 — 패치가 아니라 다시 읽어야 한다.
    if (tab.id === activeTabId) requestContentRefresh("fresh", path);
    else markContentStale(tab.id);
  }
}

/**
 * 넷을 한 문장으로 뭉뚱그리지 않는다 — `stale`은 정상 경합이고 `failed`는 사고다
 * (§309 `report`와 같은 이유). 아무 말 없이 끝나면 사용자에게는 버튼이 죽은 것으로
 * 보이므로, 옮긴 것이 없어도 반드시 무언가 말한다.
 */
async function report(r: ArchiveOutcome, t: Translate): Promise<void> {
  const lines: string[] = [];
  if (r.archived > 0) {
    lines.push(t("tasks.archive.result", { count: String(r.archived) }));
  }
  if (r.stale > 0) {
    lines.push(t("tasks.archive.stale", { count: String(r.stale) }));
  }
  if (r.failed > 0) {
    lines.push(t("tasks.archive.failed", { count: String(r.failed) }));
  }
  // `skipped`는 말하지 않는다. 프런트가 같은 표로 고른 목록이라 정상 실행에서는 0이고,
  // 0이 아니면 두 표가 갈렸다는 뜻이라 사용자가 아니라 로그가 받을 사실이다.
  if (r.skipped > 0) {
    logger.warn(
      `[tasks] archive: backend skipped ${r.skipped} task(s) the panel had counted`,
    );
  }
  await showAlert(
    lines.length > 0
      ? lines.join(" ")
      : t("tasks.archive.result", { count: "0" }),
  );
}
