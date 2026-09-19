// §260 스펙 0050 §5 — 이 에디터를 플러그인 기여 대상으로 등록한다.
// 문서 편집 표면에만 건다. 퀵 캡처(profile: "capture")는 대상이 아니다.
import { useEffect } from "react";

import type { Editor } from "@tiptap/core";

import { registerEditorSurface } from "../plugins/editor-surfaces";

export function useEditorSurface(editor: Editor | null): void {
  useEffect(() => {
    if (!editor) return;
    return registerEditorSurface(editor);
  }, [editor]);
}
