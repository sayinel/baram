// §323 캡처 창의 편집기 — 문서창과 같은 엔진, 좁힌 Extension 세트.
//
// 메인 편집기를 재사용하지 않는 이유: 그것은 앱 전역 단일 인스턴스이고
// (`MarkdownSurface.tsx`) 열려 있는 탭의 문서를 들고 있다. keep-alive 편집기를 만드는
// `App.tsx`의 방식을 그대로 따른다.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Editor } from "@tiptap/react";

import { isNodeEmpty, Editor as TiptapEditor } from "@tiptap/core";

import { createBaramExtensions } from "../../extensions";
import { serializeLiveDoc } from "../../utils/editor/serialize-live-doc";

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
  isEmpty: boolean;
  reset: () => void;
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

  // 매 렌더 최신값을 담아 두는 ref — 아래 `extensions`가 이 ref를 통해서만
  // 호출부의 리졸버에 닿아야, 다이얼로그가 리렌더될 때마다(태스크 모드 토글 등)
  // 새 함수 참조가 와도 `extensions`의 identity가 바뀌지 않는다. 참조가
  // 바뀌면 아래 effect가 다시 돌아 편집기 인스턴스를 통째로 파기·재생성해
  // 타이핑 중이던 내용이 날아간다 — deps를 비워 두는 이유와 같은 사고.
  const resolveDropDestinationRef = useRef(resolveDropDestination);
  useEffect(() => {
    resolveDropDestinationRef.current = resolveDropDestination;
  }, [resolveDropDestination]);

  // ‼️ 배열은 인스턴스마다 한 번만 만든다. 렌더마다 새로 만들면 Tiptap이 옵션을
  // 원소 단위로 비교하다 매번 달라졌다고 보고 재구성한다(§298 vim의 교훈).
  // `resolveDropDestination`은 위 ref를 통해서만 참조하므로 이 deps는 계속
  // 비워 둘 수 있다.
  const extensions = useMemo(
    () =>
      createBaramExtensions({
        profile: "capture",
        resolveDropDestination: () =>
          resolveDropDestinationRef.current?.() ?? null,
      }),
    [],
  );

  useEffect(() => {
    if (!open) return;
    const instance = new TiptapEditor({ extensions }) as unknown as Editor;
    const sync = () => setIsEmpty(isDocEmpty(instance.state.doc));
    instance.on("update", sync);
    setEditor(instance);
    setIsEmpty(true);
    return () => {
      instance.off("update", sync);
      instance.destroy();
      setEditor(null);
      setIsEmpty(true);
    };
  }, [open, extensions]);

  const getMarkdown = useCallback(() => {
    if (!editor || editor.isDestroyed || isDocEmpty(editor.state.doc))
      return "";
    return serializeLiveDoc(editor).trim();
  }, [editor]);

  const reset = useCallback(() => {
    editor?.commands.clearContent(true);
    setIsEmpty(true);
  }, [editor]);

  return { editor, getMarkdown, isEmpty, reset };
}
