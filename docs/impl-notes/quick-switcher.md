# §35 Quick Switcher — 구현 노트

## Requirements (설계서에서 추출)
- Cmd+P로 Quick Switcher 열기
- 파일명 fuzzy 검색 (fileTree에서 .md/.markdown/.mdx/.txt 파일 추출)
- 특수 구문: `#heading` → 현재 파일의 헤딩 검색
- 특수 구문: `filename#heading` → 특정 파일의 헤딩으로 점프
- 결과 없으면 "새 파일 생성" 옵션 표시
- 상대 경로 표시 (rootPath 기준)
- 키보드: ArrowUp/Down 선택, Enter 실행, Escape 닫기

## Dependencies
- `file-store.ts` — fileTree (이미 존재, 재귀 FileEntry 구조)
- `editor-store.ts` — openTab, setActiveTab, tabs
- `ui-store.ts` — quickSwitcherOpen 상태 추가 필요
- `ipc/invoke.ts` — readFile (파일 내용 읽기)

## Technical Challenges
1. fileTree에서 모든 파일을 flat 리스트로 추출하는 유틸리티
2. Fuzzy matching 성능 (수천 파일 가능)
3. 헤딩 파싱 — 마크다운에서 `# heading` 추출 (regex로 충분)
4. 파일 열기 → 기존 탭이면 활성화, 새 파일이면 openTab

## Edge Cases
- 폴더가 열리지 않은 상태 → 열린 탭 목록만 표시
- 빈 검색어 → 최근 파일/열린 탭 표시
- 같은 이름 다른 경로 파일 → 상대 경로로 구분
- 숨김 파일/디렉토리 (.git, node_modules) 필터링

## Design
- CommandPalette 패턴 재활용 (overlay + input + list)
- 별도 컴포넌트: `QuickSwitcher.tsx`
- ui-store에 `quickSwitcherOpen` + `toggleQuickSwitcher` 추가
- 유틸 함수: `flattenFileTree(tree) → {name, path, relativePath}[]`
- 유틸 함수: `extractHeadings(markdown) → {level, text, line}[]`

## Files to Create/Modify
1. CREATE `src/components/command/QuickSwitcher.tsx` — Quick Switcher UI
2. CREATE `src/utils/file-search.ts` — flattenFileTree, fuzzyMatch, extractHeadings
3. CREATE `src/utils/__tests__/file-search.test.ts` — 유틸 테스트
4. MODIFY `src/stores/ui-store.ts` — quickSwitcherOpen 상태 추가
5. MODIFY `src/App.tsx` — Cmd+P 단축키 + QuickSwitcher 렌더
6. MODIFY `src/App.css` — Quick Switcher 스타일 (CommandPalette 유사)

## Implementation Order
1. ui-store 상태 추가
2. file-search 유틸리티 함수
3. 테스트
4. QuickSwitcher 컴포넌트
5. App.tsx 통합
6. CSS 스타일
