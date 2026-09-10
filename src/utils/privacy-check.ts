// §49 Privacy Mode — restrict LLM to local-only providers
// E1: Per-file privacy via frontmatter `privacy: true`

import type { Editor } from "@tiptap/core";

/** Detect per-file privacy from frontmatter `privacy: true` in the editor doc. */
export function getFilePrivacy(editor: Editor | null): boolean {
  if (!editor) return false;
  let isPrivate = false;
  editor.state.doc.descendants((node) => {
    if (node.type.name === "frontmatter") {
      const text = node.textContent;
      if (/privacy:\s*true/i.test(text)) {
        isPrivate = true;
      }
      return false;
    }
    return !isPrivate;
  });
  return isPrivate;
}

/**
 * LLM 요청이 허용되는가. 두 술어를 함께 본다:
 *
 * 1. `aiEnabled` — §339 의 kill switch. 사용자가 AI 를 껐으면 무엇도 허용되지 않는다.
 * 2. 프라이버시 — privacy mode 나 파일별 `privacy: true` 면 로컬 프로바이더만 허용된다.
 *
 * ‼️ `aiEnabled` 를 **필수** 파라미터로 둔 것은 의도다. 새 호출부가 생기면 tsc 가
 * 인자 부족으로 잡는다 — 손으로 열거한 가드 목록은 다음 호출부를 놓친다(이 저장소에서
 * 입구 열거가 다섯 번 틀렸다). 스토어를 여기서 읽지 않는 것도 의도다: 순수 함수라
 * 인자만으로 전수 테스트가 된다.
 *
 * @param aiEnabled - §339 AI kill switch (`useAIStore.getState().aiEnabled`)
 * @param privacyMode - Global privacy mode setting
 * @param provider - LLM provider name
 * @param filePrivacy - Per-file privacy flag (from frontmatter `privacy: true`)
 */
export function isLLMAllowed(
  aiEnabled: boolean,
  privacyMode: boolean,
  provider: string,
  filePrivacy?: boolean,
): boolean {
  if (!aiEnabled) return false;
  const effectivePrivacy = privacyMode || filePrivacy === true;
  if (!effectivePrivacy) return true;
  // Only local providers are allowed in privacy mode
  return provider === "ollama";
}
