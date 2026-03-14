# P1 NodeView Inline AI Buttons — 구현 노트

## Requirements
- mathBlock, codeBlock, table NodeView에 ✨ AI 버튼 추가
- 각 블록 타입에 맞는 AI 액션 드롭다운 표시
- 기존 block-ai-utils.ts + contextual-ai-actions.ts 재사용

## Technical Approach

### 1. MathBlock (React NodeView)
- `math-block-view.tsx` 수정
- 비편집 모드(preview)에서 hover 시 ✨ 버튼 표시 (우상단)
- 클릭 시 MATH_ACTIONS 드롭다운
- formula를 AI에 전달

### 2. CodeBlock (Plain ProseMirror NodeView)
- `code-block-node-view.ts` 수정
- header에 AI 버튼 DOM 추가 (lang select 옆)
- 순수 DOM 조작 (React 사용 불가)
- 코드 전체를 AI에 전달

### 3. Table (TableToolbar React 컴포넌트)
- `TableToolbar.tsx` 수정
- 기존 툴바 끝에 AI 버튼 추가
- 테이블 전체 마크다운을 AI에 전달

## Shared Component: NodeViewAIMenu
- React 컴포넌트로 만들어 math/table에서 재사용
- codeBlock은 plain DOM이므로 별도 DOM 기반 메뉴 필요
- 대안: 공통 DOM 유틸 함수로 메뉴 생성 → React/plain 모두 사용 가능

## Files to Create/Modify
- `src/components/toolbar/NodeViewAIMenu.tsx` — 공통 AI 드롭다운 (새 파일)
- `src/extensions/nodes/math-block-view.tsx` — AI 버튼 추가
- `src/extensions/nodes/views/code-block-node-view.ts` — header에 AI 버튼
- `src/components/toolbar/TableToolbar.tsx` — AI 버튼 추가
- `src/App.css` — NodeView AI 버튼 스타일

## Implementation Order
1. NodeViewAIMenu 공통 컴포넌트
2. MathBlock AI 버튼
3. CodeBlock AI 버튼 (DOM 방식)
4. TableToolbar AI 버튼
5. CSS 스타일
