// 다이얼 id → 설정 검색 항목 id. 편집기 다이얼 넷(스펙 0060)은 기존 검색 항목 id 를 그대로 쓴다 — 검색
// 결과의 안정된 키다(계획 0107 Task 3(h)). 이 대응을 쓰는 테스트가 셋이 되어 여기로 뽑았다(계획 0109 P6):
// `settings-tabs.test.tsx` · `EditorTab.test.tsx` · `dial-labels.test.ts`.
import type { DialId } from "../../../../appearance/dials";

const REGISTRY_ID_OVERRIDE: Readonly<Partial<Record<DialId, string>>> = {
  editorCodeFontFamily: "codeFontFamily",
  editorFontFamily: "fontFamily",
  editorFontSize: "fontSize",
  editorLineHeight: "lineHeight",
};

export function registryIdOf(dialId: DialId): string {
  return REGISTRY_ID_OVERRIDE[dialId] ?? dialId;
}
