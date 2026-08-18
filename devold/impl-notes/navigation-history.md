# §37 뒤로/앞으로 네비게이션 — 구현 노트

## Requirements (설계서에서 추출)
- 문서 이동 히스토리를 스택으로 관리
- 단축키: Alt+← / Ctrl+- (뒤로), Alt+→ / Ctrl+Shift+- (앞으로)
- 기록 대상: 파일 열기, 링크 클릭 이동, Quick Switcher 이동, 검색 결과 이동
- 같은 파일 내 스크롤은 기록하지 않음

## Dependencies
- `editor-store.ts` — activeTabId, setActiveTab, openTab
- 브라우저 스타일 스택 (back/forward)

## Technical Challenges
1. 탭 전환 시 히스토리 push와 setActiveTab을 구분해야 함 (뒤로/앞으로는 push하면 안 됨)
2. 닫힌 탭의 히스토리 항목 처리 (skip하거나 제거)
3. 새 탭 열기 시 forward 스택 클리어 (브라우저와 동일)

## Design
- Zustand store: `useNavigationStore`
- backStack: string[] (tabId 배열)
- forwardStack: string[] (tabId 배열)
- pushHistory(tabId): 현재 탭을 backStack에 push, forwardStack 클리어
- goBack(): backStack에서 pop → 현재를 forwardStack에 push → setActiveTab
- goForward(): forwardStack에서 pop → 현재를 backStack에 push → setActiveTab
- navigating 플래그로 뒤로/앞으로 동작 시 pushHistory 억제

## Edge Cases
- backStack 비어있을 때 goBack → no-op
- forwardStack 비어있을 때 goForward → no-op
- 닫힌 탭 ID가 스택에 있을 때 → skip하고 다음 항목

## Files to Create/Modify
1. CREATE `src/stores/navigation-store.ts` — 히스토리 스토어
2. CREATE `src/stores/__tests__/navigation-store.test.ts` — 테스트
3. MODIFY `src/App.tsx` — 탭 전환 시 pushHistory 호출 + 키보드 단축키 등록

## Implementation Order
1. navigation-store.ts (스토어 + 로직)
2. 테스트 작성
3. App.tsx 통합
