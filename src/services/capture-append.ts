// §322 캡처를 대상 노트의 `## Captures` 절에 붙인다 — 쓰기 경로 세 갈래.
//
// 쓰기 대상 판정은 §312 태스크 캡처가 이미 풀었다. 그 라우터(`resolveTaskWriteTarget`)를
// 그대로 재사용한다 — 규칙을 두 벌로 만들지 않는다. 이름에 "Task"가 붙어 있을 뿐 그
// 함수는 태스크에 대해 아무것도 모른다: 경로와 편집기만 받아 어디에 써야 하는지 답한다.
//
// 실패는 던진다. 캡처가 잃는 것은 다시 누르면 되는 토글이 아니라 **다른 어디에도 없는
// 사용자의 문장**이므로, 보이지 않는 곳에 쓰고 성공을 보고하느니 시끄럽게 실패한다.

import type { SourceBufferAccess } from "../stores/editor/editor";
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

/**
 * `dirtyTab` — 저장하지 않은 탭이 그 노트를 들고 있어 **쓰지 않기로** 한 것.
 * `writeFailed` — 쓰기를 시도하는 동안 실패한 것. 실제 write뿐 아니라 그 앞의 read와
 *   직렬화 실패도 포함한다 — 사용자에게는 결과가 같고(그 노트에 아무것도 안 붙었다),
 *   원인 메시지는 `messageOf`가 실어 나른다.
 *
 * 둘을 가르는 이유는 UI 문구가 아니라 **사실이 다르기 때문**이다. 앞은 사용자가 탭을
 * 저장하면 풀리고, 뒤는 그렇지 않다.
 */
export type CaptureAppendErrorCode = "dirtyTab" | "writeFailed";

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
 * 대상 하나가 **실제로** 쓰일 갈래. 판정에 쓴 store 값(`access`·`editor`)을 함께 싣는다 —
 * 쓰기 시점에 다시 읽으면 판정과 쓰기가 서로 다른 값을 볼 수 있다.
 */
type CaptureWriteRoute =
  | { access: SourceBufferAccess; kind: "source"; tabId: string }
  | { editor: Editor; kind: "document"; tabId: string }
  | { kind: "disk" };

/**
 * 대상 노트마다 항목 하나를 붙인다. 실패하면 **언제나** `CaptureAppendError`를 던지고,
 * 그때까지 쓰인 대상은 오류의 `appended`에 담아 보낸다.
 *
 * ‼️ "언제나"가 요점이다. 한때는 관문(`assertNoUnsavedTab`)만 그 타입을 던졌고 `writeFile`의
 * 거절(디스크 가득 참·권한·IPC)은 맨 `Error`로 빠져나갔다 — `appended` 없이. 대상이 둘이고
 * 둘째 쓰기가 실패하면 호출자는 "아무것도 저장되지 않았다"고 보고하고, 사용자는 다시 눌러
 * **이미 쓰인 첫째에 중복을 만든다.** `appended`가 존재하는 이유가 정확히 그 중복 방지다.
 *
 * ‼️ **잔여 위험, 솔직하게**: `appended`가 비어 있지 않게 되는 길은 이제 `writeFailed`
 * 하나뿐이다(디스크 가득 참·권한·IPC). 그 실패 뒤에 사용자가 다시 저장하면 이미 쓰인
 * 노트에는 같은 항목이 **한 번 더** 들어간다 — 블록 ID는 문서마다 다시 계산되므로 중복을
 * 막아 줄 것이 없다. 그대로 두는 이유는 대안이 더 나쁘기 때문이다: 눈에 보이는 중복 하나가
 * 다른 어디에도 없는 사용자의 문장을 잃는 것보다 낫고, 재시도 상태를 다이얼로그에 쌓으면
 * "본문이 얼마나 바뀌어야 새 캡처인가"라는 답하기 어려운 규칙이 필요해진다. 흔한 쪽인
 * 더티 탭은 아래 사전 점검이 아예 부분 상태를 만들지 않는다.
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

  // 갈래를 대상마다 한 번 판정해 두고, 그 위에서 관문을 **전부 먼저** 통과시킨다.
  const routed = targets.map((target) => ({
    route: resolveCaptureWriteRoute(target.path, editor),
    target,
  }));

  // ‼️ 관문이 **모든 쓰기보다 먼저**다. 대상마다 쓰기 직전에 돌던 시절에는 둘째가
  // 막히면 첫째가 이미 쓰인 뒤였고, 사용자가 그 탭을 저장하고 다시 누르면 첫째에
  // 중복이 생겼다. 이 관문은 I/O 없는 순수한 스토어 읽기라 앞당기는 데 드는 비용이
  // 없다 — 그래서 되돌릴 부분 상태가 애초에 생기지 않는다.
  for (const { route, target } of routed) {
    if (route.kind === "disk") assertNoUnsavedTab(target);
  }

  const appended: AppendedTarget[] = [];
  for (const { route, target } of routed) {
    try {
      await appendToOne(target, entry, stamp, editor, route);
    } catch (err) {
      // 관문이 던진 것은 이미 `appended`를 싣고 있다 — 그대로 올려보낸다.
      if (err instanceof CaptureAppendError) throw err;
      // 그 밖의 모든 실패. 원본 메시지를 문구에 담아 원인을 잃지 않는다.
      throw new CaptureAppendError(
        "writeFailed",
        target.title,
        [...appended],
        `appendCaptureToNotes: ${target.path}: ${messageOf(err)}`,
      );
    }
    appended.push({ path: target.path, title: target.title });
  }

  return appended;
}

/**
 * 이 대상이 **실제로** 어느 갈래로 쓰이는가.
 *
 * `resolveTaskWriteTarget`은 탭의 모양만 보고 답한다. 실행 시점의 갈래에는 조건이 두 개
 * 더 붙는다: 소스 버퍼 접근자가 등록돼 있는가(= 버퍼를 소유한 `useSourceMode`가 마운트돼
 * 있는가), 그리고 편집기가 있는가. 둘 중 하나가 없으면 그 갈래는 디스크로 떨어진다.
 *
 * ‼️ 사전 점검과 실제 쓰기가 **이 함수 하나로** 답한다. 규칙을 두 벌로 적으면 "쓰기 전에
 * 막았다"와 "실제로 어디에 썼다"가 서로 다른 근거를 따르게 되고, 그때 관문은 자기가 지키지
 * 않는 갈래를 지킨다고 믿는다.
 */
function resolveCaptureWriteRoute(
  path: string,
  editor: Editor | null,
): CaptureWriteRoute {
  const route = resolveTaskWriteTarget(path, editor);

  // §312 소스 모드 탭 — 화면에 보이고 저장이 실제로 쓰는 권위 있는 텍스트는
  // CodeMirror 버퍼다. 라이브 문서든 디스크든 다음 저장이 붙인 항목을 덮어 지운다.
  //
  // ‼️ 이 갈래가 **먼저**다. 소스 모드인 더티 활성 탭은 document 조건을 전부 만족하는
  // 부분집합이라, 뒤로 옮기면 영원히 도달하지 못한다. 그 순서를 실제로 정하는 것은
  // `resolveTaskWriteTarget` 안의 판정 순서다 — 아래 두 `if`는 `route.kind`로
  // 갈라지므로 서로 배타적이다.
  if (route.kind === "source") {
    const access = useEditorStore.getState().sourceBufferAccess;
    if (access) return { access, kind: "source", tabId: route.tabId };
    // 접근자 미등록 = 버퍼를 소유한 `useSourceMode`가 마운트돼 있지 않다는 뜻이다.
    // 나중에 디스크를 덮어쓸 버퍼가 존재하지 않으므로 디스크로 폴백한다.
  }

  // 라이브 문서 — 소스는 편집기다. `openFiles`는 사용자의 첫 타이핑 이후 영구히
  // 낡으므로 읽으면 안 된다(M2-a Critical 1).
  if (route.kind === "document" && editor) {
    return { editor, kind: "document", tabId: route.tabId };
  }

  return { kind: "disk" };
}

/** 대상 하나 — 사전 점검이 고른 갈래로 쓴다. 갈래 판정은 여기서 다시 하지 않는다. */
async function appendToOne(
  target: CaptureTarget,
  entry: CaptureEntry,
  stamp: string,
  editor: Editor | null,
  route: CaptureWriteRoute,
): Promise<void> {
  if (route.kind === "source") {
    const current = route.access.getSourceBuffer(route.tabId);
    route.access.setSourceBuffer(route.tabId, appendOne(current, entry, stamp));
    markSourceTabDirty(route.tabId);
    return;
  }

  if (route.kind === "document") {
    const next = appendOne(serializeLiveDoc(route.editor), entry, stamp);
    useFileStore.getState().setFileContent(target.path, next);
    useEditorStore.getState().markDirty(route.tabId, true);
    if (useEditorStore.getState().activeTabId === route.tabId) {
      useEditorStore.getState().requestContentRefresh();
    }
    return;
  }

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
 * 디스크 갈래로 가는 대상에 **저장하지 않은 탭**이 있으면 쓰지 않고 던진다.
 *
 * 라우터는 "활성 + 더티"가 아닌 모든 탭을 디스크로 보낸다. 사용자가 편집한 **배경** 탭도
 * 그렇다. 그 탭으로 돌아오면 `use-tab-switching`이 `openFiles`가 아니라 캐시된
 * `EditorState`를 복원하므로 방금 붙인 항목은 화면에 없고, 다음 저장이 캐시된 버퍼로
 * 파일을 통째로 덮어써 캡처가 사라진다 — 경고도 재시도도 없이.
 *
 * ‼️ 이 관문은 소스 모드 탭을 판정하지 못한다 — `isDirty`는 마크다운 소스 타이핑에
 * 세워지지 않으므로 그 탭에서는 거짓말이다. 소스 판정은 여기 오기 **전에** 갈라져 나갔다.
 *
 * `appended`를 받지 않는다: 이 관문은 **어떤 쓰기보다도 먼저** 전부 도므로 여기서 던질 때
 * 붙은 것은 언제나 하나도 없다. 파라미터로 남겨 두면 "일부는 이미 붙었을 수 있다"는 뜻이
 * 되어, 지금은 참이 아닌 것을 계속 참인 것처럼 말하게 된다.
 */
function assertNoUnsavedTab(target: CaptureTarget): void {
  const tab = useEditorStore
    .getState()
    .tabs.find((t) => t.filePath === target.path);
  if (!tab?.isDirty) return;
  throw new CaptureAppendError(
    "dirtyTab",
    target.title,
    [],
    `appendCaptureToNotes: ${target.path} has unsaved changes in a tab`,
  );
}

/** 무엇이 던져졌든 사람이 읽을 한 줄로. `throw "문자열"`도 원인을 말해야 한다. */
function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
