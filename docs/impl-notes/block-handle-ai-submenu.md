# BlockHandle AI Submenu — 구현 노트

## Requirements
- BlockHandle 드롭다운 메뉴에 "AI ▸" 서브메뉴 항목 추가
- 클릭 시 현재 블록 타입에 맞는 AI 액션 목록을 서브메뉴로 표시
- 기존 `content-type-detector.ts`의 `detectContentType()`으로 블록 타입 감지
- 기존 `contextual-ai-actions.ts`의 `getActionsForMode()`로 액션 목록 가져오기
- 블록 전체 텍스트를 AI에 전달 (선택 없이도 동작)
- `{language}`, `{tone}` 등 플레이스홀더가 있는 액션은 `showPrompt()`으로 입력 받기
- "Custom Instruction" 항목 추가 — 사용자가 직접 프롬프트 입력

## Dependencies
- `src/components/toolbar/BlockHandle.tsx` — 수정 대상
- `src/utils/content-type-detector.ts` — `detectContentType()`, `ContentMode`
- `src/utils/contextual-ai-actions.ts` — `getActionsForMode()`, `AIAction`
- `src/utils/ai-commands.ts` — `executeAICommand()`, `showPrompt()`
- `src/App.css` — 서브메뉴 스타일

## Technical Challenges
- 서브메뉴 위치: 메인 메뉴 오른쪽에 표시, 화면 밖으로 나가지 않도록 처리
- 블록 텍스트 추출: atom 노드(mathBlock, codeBlock 등)는 `textContent`가 비어있을 수 있음 → `node.textContent` 또는 attrs에서 content 추출 필요
- Privacy mode: AI 비활성 상태에서는 AI 메뉴 숨기거나 비활성화

## Edge Cases
- 빈 블록 (paragraph에 텍스트 없음) → AI 액션 비활성
- frontmatter 블록 → "text" 모드 fallback
- 중첩 블록 (callout 내부의 paragraph) → depth=1 블록 기준
- 메뉴가 화면 오른쪽 경계를 넘는 경우 → 왼쪽에 표시

## Files to Create/Modify
- `src/components/toolbar/BlockHandle.tsx` — AI 서브메뉴 로직 추가
- `src/utils/block-ai-utils.ts` — 블록 텍스트 추출 + 블록→ContentMode 변환 헬퍼 (새 파일)
- `src/App.css` — 서브메뉴 CSS 추가
- `src/__tests__/unit/block-ai-utils.test.ts` — 헬퍼 테스트 (새 파일)

## Implementation Order
1. `block-ai-utils.ts` — 블록 노드에서 텍스트 추출 + ContentMode 판별 헬퍼
2. 테스트 작성 (Red)
3. `BlockHandle.tsx` — AI 서브메뉴 UI + 이벤트 핸들링
4. `App.css` — 서브메뉴 스타일
5. 테스트 통과 확인 (Green)
