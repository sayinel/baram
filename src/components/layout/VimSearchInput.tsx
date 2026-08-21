// §298 vim `/` 검색 — StatusBar의 실제 검색 입력 (IME 정공법).
//
// 모달 surface는 non-editable이라 IME 조합이 일어나지 않는다. 이 input이
// 조합의 실 목적지다: `/`가 core의 searchLine을 열면 StatusBar가 이 입력을
// 렌더·포커스하고, IME가 네이티브로 조합한 문자열이 change로 core에
// 흐른다(vim-search-line 배선). Enter=점프+기록+닫기, Escape=닫기+포커스
// 반환, blur=닫기만(사용자가 이미 다른 곳에 포커스를 뒀다).

import { useEffect, useRef } from "react";

import type { Editor } from "@tiptap/core";

import {
  closeSearchLine,
  submitSearchLine,
  updateSearchLineText,
} from "../../extensions/plugins/vim/vim-search-line";

interface VimSearchInputProps {
  editor: Editor;
  /** "/" or "?" — rendered as the vim prompt, not part of the value. */
  prefix: string;
  text: string;
}

export function VimSearchInput({ editor, prefix, text }: VimSearchInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus once on mount — the line just opened and the IME needs a target.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <span className="status-vim-search">
      {prefix}
      <input
        aria-label="vim search"
        autoCapitalize="off"
        autoCorrect="off"
        className="status-vim-search-input"
        onBlur={() => closeSearchLine(editor, false)}
        onChange={(e) => updateSearchLineText(editor, e.target.value)}
        onKeyDown={(e) => {
          // A composing Enter/Escape belongs to the IME: Korean IMEs commit
          // or cancel the active composition with a keydown that arrives
          // BEFORE the change event — submitting there would search a
          // pattern missing its final syllable and unmount the input
          // mid-composition (adversarial review).
          if (e.nativeEvent.isComposing) return;
          if (e.key === "Enter") {
            e.preventDefault();
            submitSearchLine(editor);
          } else if (e.key === "Escape") {
            e.preventDefault();
            closeSearchLine(editor, true);
          }
        }}
        ref={inputRef}
        spellCheck={false}
        value={text}
      />
    </span>
  );
}
