// §322 캡처를 대상 노트의 `## Captures` 절에 붙인다 — 쓰기 경로 세 갈래.
//
// 쓰기 대상 판정은 §312 태스크 캡처가 이미 풀었다. 그 라우터(`resolveTaskWriteTarget`)를
// 그대로 재사용한다 — 규칙을 두 벌로 만들지 않는다. 이름에 "Task"가 붙어 있을 뿐 그
// 함수는 태스크에 대해 아무것도 모른다: 경로와 편집기만 받아 어디에 써야 하는지 답한다.
//
// 실패는 던진다. 캡처가 잃는 것은 다시 누르면 되는 토글이 아니라 **다른 어디에도 없는
// 사용자의 문장**이므로, 보이지 않는 곳에 쓰고 성공을 보고하느니 시끄럽게 실패한다.

import type { CaptureEntry } from "../utils/zettelkasten/capture-append";
import type { CaptureTarget } from "../utils/zettelkasten/capture-target";
import type { Editor } from "@tiptap/react";

import { readFile, writeFile } from "../ipc/invoke";
import { useEditorStore } from "../stores/editor/editor";
import { useFileStore } from "../stores/file/file";
import { serializeLiveDoc } from "../utils/editor/serialize-live-doc";
import {
  markSourceTabDirty,
  resolveTaskWriteTarget,
} from "../utils/tasks/apply-task-write";
import { syncOpenSurfacesAfterFileRewrite } from "../utils/tasks/sync-open-surfaces";
import {
  appendCapture,
  captureBlockIdStamp,
  captureHeadingText,
  nextCaptureBlockId,
} from "../utils/zettelkasten/capture-append";

export interface AppendedTarget {
  path: string;
  title: string;
}

export type CaptureAppendErrorCode = "dirtyTab";

interface CaptureAppendOptions {
  body: string;
  editor: Editor | null;
  now?: Date;
  source?: string;
  targets: CaptureTarget[];
}

export class CaptureAppendError extends Error {
  /** 이 오류가 나기 **전에** 이미 쓰인 대상들. 감추면 사용자가 다시 눌러 중복을 만든다. */
  readonly appended: AppendedTarget[];
  readonly code: CaptureAppendErrorCode;
  /** 어느 노트가 막았는지 — 문구가 그 이름을 말한다. */
  readonly title: string;

  constructor(
    code: CaptureAppendErrorCode,
    title: string,
    appended: AppendedTarget[],
    message: string,
  ) {
    super(message);
    this.name = "CaptureAppendError";
    this.appended = appended;
    this.code = code;
    this.title = title;
  }
}

/**
 * 대상 노트마다 항목 하나를 붙인다. 실패하면 `CaptureAppendError`를 던지고, 그때까지
 * 쓰인 대상은 오류의 `appended`에 담아 보낸다.
 *
 * 대상은 **순서대로 하나씩** 처리한다. 병렬로 하면 같은 문서를 두 대상이 가리키는
 * 경우(중복 제거는 §320이 하지만 그 계약이 깨질 수 있다) 나중 쓰기가 앞 쓰기를 덮는다.
 */
export async function appendCaptureToNotes(
  opts: CaptureAppendOptions,
): Promise<AppendedTarget[]> {
  const { body, editor, now = new Date(), source, targets } = opts;
  const entry = {
    body,
    heading: captureHeadingText(now),
    source,
  };
  const stamp = captureBlockIdStamp(now);
  const appended: AppendedTarget[] = [];

  for (const target of targets) {
    await appendToOne(target, entry, stamp, editor, appended);
    appended.push({ path: target.path, title: target.title });
  }

  return appended;
}

/** 대상 하나 — 라우터가 고른 갈래로 쓴다. 순서가 §312와 같아야 한다. */
async function appendToOne(
  target: CaptureTarget,
  entry: CaptureEntry,
  stamp: string,
  editor: Editor | null,
  appended: AppendedTarget[],
): Promise<void> {
  const route = resolveTaskWriteTarget(target.path, editor);

  // §312 소스 모드 탭 — 화면에 보이고 저장이 실제로 쓰는 권위 있는 텍스트는
  // CodeMirror 버퍼다. 라이브 문서든 디스크든 다음 저장이 붙인 항목을 덮어 지운다.
  //
  // ‼️ 이 갈래가 **먼저**다. 소스 모드인 더티 활성 탭은 document 조건을 전부 만족하는
  // 부분집합이라, 뒤로 옮기면 영원히 도달하지 못한다. 그 순서를 실제로 정하는 것은
  // `resolveTaskWriteTarget` 안의 판정 순서다 — 여기의 두 `if`는 `route.kind`로
  // 갈라지므로 서로 배타적이다.
  if (route.kind === "source") {
    const access = useEditorStore.getState().sourceBufferAccess;
    if (access) {
      const current = access.getSourceBuffer(route.tabId);
      access.setSourceBuffer(route.tabId, appendOne(current, entry, stamp));
      markSourceTabDirty(route.tabId);
      return;
    }
    // 접근자 미등록 = 버퍼를 소유한 `useSourceMode`가 마운트돼 있지 않다는 뜻이다.
    // 나중에 디스크를 덮어쓸 버퍼가 존재하지 않으므로 디스크로 폴백한다.
  }

  // 라이브 문서 — 소스는 편집기다. `openFiles`는 사용자의 첫 타이핑 이후 영구히
  // 낡으므로 읽으면 안 된다(M2-a Critical 1).
  if (route.kind === "document" && editor) {
    const next = appendOne(serializeLiveDoc(editor), entry, stamp);
    useFileStore.getState().setFileContent(target.path, next);
    useEditorStore.getState().markDirty(route.tabId, true);
    if (useEditorStore.getState().activeTabId === route.tabId) {
      useEditorStore.getState().requestContentRefresh();
    }
    return;
  }

  // 디스크 — 관문을 먼저 통과한다.
  assertNoUnsavedTab(target, appended);
  const next = appendOne(await readFile(target.path), entry, stamp);
  await writeFile(target.path, next);
  // 모든 저장 경로가 하는 일이다(`use-auto-save.ts:115`). 빠뜨리면 워처가 우리 쓰기를
  // 외부 변경으로 읽어 토스트를 띄우고 실행 취소 스택을 버린다.
  useFileStore.getState().updateLastSaveMtime(target.path, Date.now());
  // ‼️ `requestContentRefresh`가 아니다 — 그것은 `CONTENT_SYNC_META` 보호가 없어
  // 자동 저장이 방금 디스크에 쓴 내용을 덮어쓴다(§313에서 아카이브가 그렇게 깨졌다).
  syncOpenSurfacesAfterFileRewrite(target.path, next, editor);
}

/**
 * 항목 하나를 붙인 새 문서.
 *
 * ‼️ 블록 ID는 **그 문서 안에서** 다시 계산한다. 유일성은 문서의 속성이므로 세 갈래가
 * 각자 자기 텍스트(버퍼·라이브 문서·디스크)를 근거로 삼아야 한다.
 */
function appendOne(
  content: string,
  entry: CaptureEntry,
  stamp: string,
): string {
  return appendCapture(content, entry, nextCaptureBlockId(content, stamp));
}

/**
 * 디스크로 쓰기 직전의 마지막 확인 — 그 파일에 **저장하지 않은 탭**이 있으면 쓰지 않고
 * 던진다.
 *
 * 라우터는 "활성 + 더티"가 아닌 모든 탭을 디스크로 보낸다. 사용자가 편집한 **배경** 탭도
 * 그렇다. 그 탭으로 돌아오면 `use-tab-switching`이 `openFiles`가 아니라 캐시된
 * `EditorState`를 복원하므로 방금 붙인 항목은 화면에 없고, 다음 저장이 캐시된 버퍼로
 * 파일을 통째로 덮어써 캡처가 사라진다 — 경고도 재시도도 없이.
 *
 * ‼️ 이 관문은 소스 모드 탭을 판정하지 못한다 — `isDirty`는 마크다운 소스 타이핑에
 * 세워지지 않으므로 그 탭에서는 거짓말이다. 소스 판정은 여기 오기 **전에** 갈라져 나갔다.
 */
function assertNoUnsavedTab(
  target: CaptureTarget,
  appended: AppendedTarget[],
): void {
  const tab = useEditorStore
    .getState()
    .tabs.find((t) => t.filePath === target.path);
  if (!tab?.isDirty) return;
  throw new CaptureAppendError(
    "dirtyTab",
    target.title,
    [...appended],
    `appendCaptureToNotes: ${target.path} has unsaved changes in a tab`,
  );
}
