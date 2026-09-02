// §323 캡처 창의 편집기 — 문서창과 같은 엔진, 좁힌 Extension 세트.
//
// 메인 편집기를 재사용하지 않는 이유: 그것은 앱 전역 단일 인스턴스이고
// (`MarkdownSurface.tsx`) 열려 있는 탭의 문서를 들고 있다. keep-alive 편집기를 만드는
// `App.tsx`의 방식을 그대로 따른다.
import { useCallback, useEffect, useMemo, useState } from "react";

import type { Editor } from "@tiptap/react";

import { isNodeEmpty, Editor as TiptapEditor } from "@tiptap/core";

import { createBaramExtensions } from "../../extensions";
import { useFileStore } from "../../stores/file/file";
import { useSettingsStore } from "../../stores/settings/store";
import { serializeLiveDoc } from "../../utils/editor/serialize-live-doc";
import { resolveZettelDir } from "../../utils/zettelkasten/zettelkasten";

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

export function useCaptureEditor(open: boolean): CaptureEditor {
  const [editor, setEditor] = useState<Editor | null>(null);
  const [isEmpty, setIsEmpty] = useState(true);

  // ‼️ 배열은 인스턴스마다 한 번만 만든다. 렌더마다 새로 만들면 Tiptap이 옵션을
  // 원소 단위로 비교하다 매번 달라졌다고 보고 재구성한다(§298 vim의 교훈).
  //
  // §324-e: `resolveDropDestination`는 store를 구독하지 않고 매 붙여넣기 시점에
  // `.getState()`로 직접 읽는다 — `getJournalContext()` 자신의 기존 관례와
  // 같다. 그래서 이 콜백은 아무 것도 closure에 담지 않아 위 `useMemo`의 빈
  // deps를 그대로 둘 수 있다(zettelDir이 바뀌어도 배열을 다시 만들 필요 없음).
  // 캡처 노트는 항상 `{zettelDir}/inbox/{id}.md`에 저장되지만 id는 저장
  // 시점에야 생성된다(`captureFleeting` → `generateZettelId`) — DropHandler는
  // 파일명이 아니라 디렉터리(`{dir}/assets`)만 쓰므로, 같은 디렉터리를 가리키는
  // 아무 자리표시자 이름이면 충분하고 실제로 그 이름의 파일이 생기지도 않는다.
  const extensions = useMemo(
    () =>
      createBaramExtensions({
        profile: "capture",
        resolveDropDestination: () => {
          const rootPath = useFileStore.getState().rootPath;
          const zettelkastenDirectory =
            useSettingsStore.getState().zettelkastenDirectory;
          const zettelDir = resolveZettelDir(rootPath, zettelkastenDirectory);
          return zettelDir ? `${zettelDir}/inbox/__capture__.md` : null;
        },
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
