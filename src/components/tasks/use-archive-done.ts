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
import type { Editor } from "@tiptap/react";

import { useTranslation } from "../../i18n/useTranslation";
import { archiveTaskLines, readFile } from "../../ipc/invoke";
import { resolveCapturePath } from "../../services/task-capture";
import { useEditorStore } from "../../stores/editor/editor";
import { refreshFileTasks } from "../../stores/tasks/task-store";
import { showAlert, showConfirm } from "../../utils/confirm-dialog";
import { logger } from "../../utils/logger";
import { basename, isUnderRoot, toPosixPath } from "../../utils/path-utils";
import { syncOpenSurfacesAfterFileRewrite } from "../../utils/tasks/sync-open-surfaces";
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
  /** 설정 `tasksCaptureFile` — 태스크 홈 기준 상대 경로일 수 있다 */
  captureFile: string;
  /**
   * 활성 탭의 라이브 Tiptap Editor(없으면 `null`).
   *
   * 아카이브는 **디스크에만** 쓴다 — 이 에디터로 문서를 고치지 않는다. 쓰기가 끝난 뒤
   * 화면을 디스크에 맞추는 데만 쓴다(`syncOpenSurfacesAfterFileRewrite`).
   */
  editor: Editor | null;
  /**
   * 배수구를 켤 수 있는가 — §312.1은 스캔 범위가 "태스크 홈"일 때만 켠다.
   *
   * 배수구는 단일 루트 조작이다. 화면에 세 vault의 태스크가 보이는데 버튼이 그중 하나만
   * 건드리면 숨은 규칙이 된다. 범위를 좁혔을 때만 켜면 **보이는 것과 건드리는 것이 항상
   * 일치**하고, 그 규칙이 UI에 드러난다.
   */
  enabled: boolean;
  exclude: string[];
  /**
   * 자격 판정의 기준일. 패널이 보고 있는 그 날이어야 한다 — 라이브 `new Date()`를 쓰면
   * 밤새 열어 둔 패널에서 확인 다이얼로그가 약속한 개수와 실제 대상이 어긋난다(I4).
   */
  now: Date;
  tasks: TaskEntry[];
  /** §312.1 해석된 태스크 홈. `null`이면 옮길 자리를 모르므로 대상이 0이다 */
  tasksHome: null | string;
}

export function useArchiveDone({
  afterDays,
  captureFile,
  editor,
  enabled,
  exclude,
  now,
  tasks,
  tasksHome,
}: ArchiveDoneOptions): ArchiveDone {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);

  // 수집함 파일 설정이 태스크 홈 밖이거나 마크다운이 아니면 `resolveCapturePath`가 던진다.
  // 그때는 옮길 자리를 알 수 없으므로 대상이 0이고 호출자가 버튼을 감춘다 — 설정이
  // 잘못됐다는 사실은 캡처 다이얼로그가 이미 원인별 문구로 알린다.
  const scope = useMemo(() => {
    if (!enabled || !tasksHome) return null;
    try {
      return archiveScope(
        tasksHome,
        resolveCapturePath(tasksHome, captureFile),
      );
    } catch (err) {
      logger.warn("[tasks] archive: unusable capture file setting:", err);
      return null;
    }
  }, [captureFile, enabled, tasksHome]);

  const candidates = useMemo(
    () => (scope ? selectArchivable(tasks, scope, now, afterDays) : []),
    [afterDays, now, scope, tasks],
  );

  const run = useCallback(async () => {
    // 실행 중 재클릭을 버튼의 `disabled`에만 맡기지 않는다 — 두 배치가 같은 줄 번호로
    // 겹쳐 돌면 뒤엣것이 이미 옮겨진 자리를 가리킨다. 낙관적 잠금이 막아 주지만
    // (`stale`) 사용자에게는 "절반만 옮겨졌다"로 보인다.
    if (!tasksHome || !scope || candidates.length === 0 || busy) return;

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
      //
      // ‼️ 확인 버튼 문구를 반드시 준다. `showConfirm`의 기본값은 **"Delete"**이고
      // (파일 삭제용으로 태어난 헬퍼다) 위험색까지 입는다 — "옮길까요?"라고 묻고
      // Delete 버튼을 내밀면 사용자가 취소를 누른다. 실제로 그렇게 아카이브가
      // 아무것도 하지 못했고, 파일이 손대지지 않으니 로그에도 흔적이 없었다.
      const ok = await showConfirm(
        t("tasks.archive.confirm", {
          count: String(candidates.length),
          days: String(afterDays),
        }),
        { confirmLabel: t("tasks.archive.confirmButton"), danger: false },
      );
      if (!ok) return;

      let outcome: ArchiveOutcome;
      try {
        outcome = await archiveTaskLines(
          tasksHome,
          scope.capturePath,
          toArchiveItems(candidates),
          isoDate(now),
          afterDays,
        );
      } catch (err) {
        // 화이트리스트 위반은 여기로 온다 — 파일을 하나도 건드리지 않았다는 뜻이므로
        // 그렇게 말한다. 프런트가 같은 화이트리스트로 걸렀으니 도달하면 두 표가 갈렸다는
        // 신호다.
        //
        // ‼️ 원인을 **문구에 담는다**. "로그를 확인하세요"만 두었더니 실패를 진단할 방법이
        // 없었다 — `logger.error`는 브라우저 콘솔로만 가고 앱 로그 파일(§3.3)에는 닿지
        // 않으므로, DevTools를 열어 두지 않은 사용자에게 그 문장은 막다른 길이다. 백엔드가
        // 내는 메시지는 거절한 경로를 이름으로 담고 있어 그대로 보여 줄 값어치가 있다.
        logger.error("[tasks] archive refused:", err);
        await showAlert(`${t("tasks.archive.error")}\n\n${errorText(err)}`);
        return;
      }

      // 바이트가 바뀐 파일만 다시 읽는다 — 원본과 대상 양쪽이다. 대상 파일은 이번에
      // 처음 생겼을 수도 있으므로 인덱스에 새로 들어간다.
      for (const path of outcome.paths) {
        await reloadOpenSurfaces(path, editor);
        await refreshFileTasks(path, exclude);
      }
      await report(outcome, t);
    } finally {
      setBusy(false);
    }
  }, [afterDays, busy, candidates, editor, exclude, now, scope, t, tasksHome]);

  return { busy, count: candidates.length, run };
}

/**
 * 사용자에게 보여 줄 실패 원인 한 줄.
 *
 * Tauri IPC의 거절은 `Error`가 아니라 **문자열**로 도착한다(커맨드가 `Result<_, String>`을
 * 돌려주므로). `err.message`만 읽으면 백엔드가 보낸 이유가 통째로 `undefined`가 된다.
 */
function errorText(err: unknown): string {
  if (typeof err === "string") return err;
  return err instanceof Error ? err.message : String(err);
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
  // `toPosixPath`는 자격 판정이 쓰는 것과 같은 정규화다 — 여기만 다른 규칙을 쓰면
  // Windows에서 원본 집합과 탭 경로가 만나지 못해 이 관문이 통째로 새어 나간다.
  const sources = new Set(candidates.map((task) => toPosixPath(task.path)));
  const { sourceModeTabs, tabs } = useEditorStore.getState();

  for (const tab of tabs) {
    if (!tab.filePath) continue;
    const path = toPosixPath(tab.filePath);
    if (!sources.has(path) && !isUnderRoot(path, archiveRoot)) continue;
    // `basename`도 `/`만 보므로 정규화한 경로를 넘긴다.
    if (tab.isDirty || sourceModeTabs.includes(tab.id)) return path;
  }
  return null;
}

/** 패널이 보고 있는 날의 `YYYY-MM-DD` — Rust가 시간대를 추측하지 않도록 프런트가 준다. */
function isoDate(now: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/**
 * 디스크가 바뀐 파일을 열어 둔 표면들에 반영한다.
 *
 * 동기화 자체는 §313의 공용 경로(`syncOpenSurfacesAfterFileRewrite`)가 한다 — 그쪽이
 * `CONTENT_SYNC_META`를 달아 보내므로 자동 저장이 이 변경을 사용자 편집으로 오해하지
 * 않는다. 여기서 하는 일은 디스크를 다시 읽어 그 함수에 넘기는 것뿐이다.
 */
async function reloadOpenSurfaces(
  path: string,
  editor: Editor | null,
): Promise<void> {
  const open = useEditorStore
    .getState()
    .tabs.some((tab) => tab.filePath === path);
  if (!open) return;

  try {
    syncOpenSurfacesAfterFileRewrite(path, await readFile(path), editor);
  } catch (err) {
    // 다시 읽지 못해도 이동 자체는 끝났다. 워처가 뒤따라 갱신한다.
    logger.warn("[tasks] archive: could not reload", path, err);
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
  // `skipped`는 말하지 않는다. 대부분의 조건은 프런트도 같은 표로 걸렀으므로 보통 0이다.
  // 0이 아닌 정당한 경우가 하나 있다: 자식을 거느린 부모는 파일을 봐야 알 수 있어 Rust만
  // 막는다(`has_indented_child`). 나머지 경우라면 두 표가 갈렸다는 뜻이고, 어느 쪽이든
  // 사용자가 아니라 로그가 받을 사실이다.
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
