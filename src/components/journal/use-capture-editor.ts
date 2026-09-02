// §323 캡처 창의 편집기 — 문서창과 같은 엔진, 좁힌 Extension 세트.
//
// 메인 편집기를 재사용하지 않는 이유: 그것은 앱 전역 단일 인스턴스이고
// (`MarkdownSurface.tsx`) 열려 있는 탭의 문서를 들고 있다. keep-alive 편집기를 만드는
// `App.tsx`의 방식을 그대로 따른다.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { CaptureDropAccess } from "../../stores/editor/editor";
import type { PendingMedia } from "../../utils/media-data-url";
import type { Editor } from "@tiptap/react";

import { isNodeEmpty, Editor as TiptapEditor } from "@tiptap/core";

import { createBaramExtensions } from "../../extensions";
import { useEditorStore } from "../../stores/editor/editor";
import {
  canonicalDoc,
  serializeLiveDoc,
} from "../../utils/editor/serialize-live-doc";
import { collectPendingMedia } from "../../utils/media-data-url";

// ‼️ Finding 1 (§323 리뷰): `Editor.isEmpty`는 `isNodeEmpty(doc)`를
// `ignoreWhitespace` 기본값(false)으로 호출해, 공백만 있는 텍스트 노드를
// "비어 있지 않다"고 본다 — Save 활성화·이탈 가드가 뚫리고 `getMarkdown()`은
// `&#x20;` 같은 HTML 엔티티를 반환해 `.trim()`으로도 지워지지 않는다.
// `isEmpty`와 `getMarkdown()`이 항상 같은 결론(비어 있음)을 내리도록 이
// 판정 하나로 통일한다.
const isDocEmpty = (doc: Parameters<typeof isNodeEmpty>[0]) =>
  isNodeEmpty(doc, { ignoreWhitespace: true });

export interface CaptureEditor {
  editor: Editor | null;
  /** 지금 문서를 마크다운으로. 비어 있으면 빈 문자열. */
  getMarkdown: () => string;
  /**
   * §324-e 아직 디스크에 없는 미디어(data URL) — 저장이 파일로 꺼낼 목록.
   * 비어 있으면 저장 경로가 추출 단계를 통째로 건너뛴다.
   */
  getPendingMedia: () => PendingMedia[];
  isEmpty: boolean;
}

/**
 * §324-e round 2: 목적지 판단(zettel inbox vs 태스크 수집 파일 vs 목적지 없음)은
 * 호출부(`QuickCaptureDialog`)의 몫이다 — 다이얼로그는 태스크 모드 여부를 알고
 * 이 훅은 모른다. 이 훅이 직접 재계산하던 round 1 버전은 정확히 그래서 태스크
 * 모드를 못 봤다(태스크 모드는 zettel과 무관한 별도 설정 — `tasks-home.ts`).
 * `null`을 돌려주면 "지금은 목적지가 없다"는 뜻이고, `getJournalContext`는
 * (round 1과 달리) 그걸 활성 탭 폴백 신호로 읽지 않는다 — 셋 중 하나가 아니라
 * 함수 자체의 유무로 두 경우를 가른다: 문서 편집기는 옵션을 아예 안 넘겨서
 * "활성 탭을 봐도 된다"는 뜻이 되고, 캡처는 항상 함수를 넘겨서 "내가 목적지의
 * 유일한 권위자다, null이어도 활성 탭으로 새지 마라"는 뜻이 된다.
 */
export function useCaptureEditor(
  open: boolean,
  resolveDropDestination?: () => null | string,
): CaptureEditor {
  const [editor, setEditor] = useState<Editor | null>(null);
  const [isEmpty, setIsEmpty] = useState(true);

  // 매 렌더 최신값을 담아 두는 ref — 아래 effect가 게시하는 `access`가 이 ref를
  // 통해서만 호출부의 리졸버에 닿아야, 다이얼로그가 리렌더될 때마다(태스크 모드
  // 토글 등) 새 함수 참조가 와도 effect의 deps가 흔들리지 않는다. 흔들리면
  // effect가 다시 돌아 편집기 인스턴스를 통째로 파기·재생성해 타이핑 중이던
  // 내용이 날아간다 — deps를 좁게 두는 이유와 같은 사고.
  const resolveDropDestinationRef = useRef(resolveDropDestination);
  useEffect(() => {
    resolveDropDestinationRef.current = resolveDropDestination;
  }, [resolveDropDestination]);

  // ‼️ 배열은 인스턴스마다 한 번만 만든다. 렌더마다 새로 만들면 Tiptap이 옵션을
  // 원소 단위로 비교하다 매번 달라졌다고 보고 재구성한다(§298 vim의 교훈).
  //
  // §324-e 목적지를 여기로 넘기지 않는다. 캡처 편집기는 삽입 시점에 목적지를
  // 알 필요가 없다 — `profile: "capture"`가 `DropHandler`에 `deferMediaToHost`를
  // 세우고, 미디어는 data URL로 들어가 저장 때 비로소 파일이 된다.
  const extensions = useMemo(
    () => createBaramExtensions({ profile: "capture" }),
    [],
  );

  useEffect(() => {
    if (!open) return;
    // 캐스트 없음. `@tiptap/react`의 `Editor`는 `@tiptap/core`의 그것을 그대로
    // 재export한 같은 클래스라(`@tiptap/react/dist/index.js`가 통째로
    // `export * from "@tiptap/core"`) 타입이 이미 맞는다 — `App.tsx`의
    // keep-alive 편집기도 캐스트 없이 이렇게 만든다. 여기 있던
    // `as unknown as Editor`는 그 사실을 확인하지 않은 계획에서 왔고, 두 타입이
    // 언젠가 정말로 갈라지면 그 불일치를 조용히 삼켰을 것이다.
    const instance = new TiptapEditor({ extensions });
    const sync = () => setIsEmpty(isDocEmpty(instance.state.doc));
    instance.on("update", sync);
    setEditor(instance);
    setIsEmpty(true);

    // §324-e OS 파일 드래그(Finder에서 끌어다 놓기)는 위 `extensions`의
    // ProseMirror `handleDrop`에 **도달하지 않는다** — Tauri 네이티브가 먼저
    // 가로채고 `use-external-drop.ts`가 처리한다. 그 훅은 App 수준에서 메인
    // 편집기만 들고 도므로, 이 인스턴스와 목적지 리졸버를 스토어에 게시해야
    // 캡처 창 위로 끌어다 놓은 이미지가 갈 곳을 안다. 리졸버는 위 `extensions`가
    // 쓰는 것과 **같은 ref**를 통과하므로, 붙여넣기와 드랍이 하나의 판단을
    // 공유한다(재계산 없음 — §324-e round 1의 결함).
    //
    // ‼️ 등록은 인스턴스와 수명이 같다: 아래 cleanup에서 지운다. 남겨 두면
    // 다음 **문서** 드랍이 파기된 이 편집기로 흘러들어 조용히 사라진다
    // (`CaptureDropAccess` 주석). 스토어 액션은 `getState()`로 집는다 —
    // 셀렉터로 받아 deps에 넣으면 이 effect의 재실행 조건이 늘어나고, 그
    // 재실행은 타이핑 중인 편집기를 통째로 재생성한다(위 deps 주석).
    const access: CaptureDropAccess = {
      editor: instance,
      resolveDestinationPath: () =>
        resolveDropDestinationRef.current?.() ?? null,
    };
    useEditorStore.getState().registerCaptureDropAccess(access);

    return () => {
      instance.off("update", sync);
      instance.destroy();
      setEditor(null);
      setIsEmpty(true);
      // 자기가 등록한 것일 때만 지운다 — StrictMode의 이중 마운트에서는 새
      // 인스턴스의 등록이 옛 인스턴스의 cleanup보다 먼저 일어날 수 있고,
      // 무조건 null을 쓰면 방금 살아난 접근자를 도로 지운다
      // (`use-source-mode.ts`의 같은 가드).
      if (useEditorStore.getState().captureDropAccess === access) {
        useEditorStore.getState().registerCaptureDropAccess(null);
      }
    };
  }, [open, extensions]);

  const getMarkdown = useCallback(() => {
    if (!editor || editor.isDestroyed || isDocEmpty(editor.state.doc))
      return "";
    return serializeLiveDoc(editor).trim();
  }, [editor]);

  // ‼️ `state.doc`이 아니라 `canonicalDoc(state).doc`이다 — `getMarkdown` 위가
  // `serializeLiveDoc`을 통해 직렬화하는 것과 **같은 doc**이어야 한다. 커서가
  // 이미지 위에 있으면 SyntaxReveal이 그것을 리터럴 `![alt](src)` 텍스트로 펼쳐
  // 두므로 그 순간의 `state.doc`에는 미디어 노드가 없다. 거기서 세면 추출 목록이
  // 비고, 직렬화된 마크다운에는 data URL이 그대로 남아 노트에 실린다.
  const getPendingMedia = useCallback(() => {
    if (!editor || editor.isDestroyed) return [];
    return collectPendingMedia(canonicalDoc(editor.state).doc);
  }, [editor]);

  // §323 리뷰 Minor 8: 여기 `reset()`이 있었지만 부르는 곳이 자기 테스트뿐이었다.
  // 다이얼로그는 본문을 비울 일이 없다 — `open` 전환마다 위 effect가 편집기
  // 인스턴스를 통째로 새로 만들고, 그것이 곧 빈 문서다. 산 것처럼 보이는 죽은
  // API는 다음 사람에게 "본문 초기화는 이걸 부르면 된다"고 잘못 알려 준다.
  // (`knip`은 객체 속성의 미사용을 못 본다 — 이 종류는 사람이 지워야 한다.)
  return { editor, getMarkdown, getPendingMedia, isEmpty };
}
