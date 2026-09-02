// §323 캡처 창의 편집기 — 문서창과 같은 엔진, 좁힌 Extension 세트.
//
// 메인 편집기를 재사용하지 않는 이유: 그것은 앱 전역 단일 인스턴스이고
// (`MarkdownSurface.tsx`) 열려 있는 탭의 문서를 들고 있다. keep-alive 편집기를 만드는
// `App.tsx`의 방식을 그대로 따른다.
import { useCallback, useEffect, useMemo, useState } from "react";

import type { Editor } from "@tiptap/react";

import { Editor as TiptapEditor } from "@tiptap/core";

import { createBaramExtensions } from "../../extensions";
import { prosemirrorToMarkdown } from "../../pipeline/pm-to-md";

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
  const extensions = useMemo(
    () => createBaramExtensions({ profile: "capture" }),
    [],
  );

  useEffect(() => {
    if (!open) return;
    const instance = new TiptapEditor({ extensions }) as unknown as Editor;
    const sync = () => setIsEmpty(instance.isEmpty);
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
    if (!editor || editor.isDestroyed || editor.isEmpty) return "";
    return prosemirrorToMarkdown(editor.state.doc).trim();
  }, [editor]);

  const reset = useCallback(() => {
    editor?.commands.clearContent(true);
    setIsEmpty(true);
  }, [editor]);

  return { editor, getMarkdown, isEmpty, reset };
}
