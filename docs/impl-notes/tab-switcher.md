# §39 Ctrl+Tab 문서 전환 — 구현 노트

## Requirements (설계서에서 추출)
- Ctrl+Tab: MRU 순서로 다음 문서 전환
- Ctrl+Shift+Tab: MRU 순서로 이전 문서 전환
- MRU(Most Recently Used) 순서 관리
- macOS: ⌃Tab / ⌃⇧Tab

## Dependencies
- `editor-store.ts` — tabs, activeTabId, setActiveTab

## Technical Challenges
1. MRU 순서 유지: 탭 활성화 시마다 순서 업데이트
2. 닫힌 탭 제거: MRU 리스트에서 닫힌 탭 자동 제거
3. Ctrl+Tab은 브라우저/OS 기본 단축키와 충돌 가능 → Tauri 데스크탑에서는 OK

## Design
- editor-store에 `mruOrder: string[]` (tabId 배열, 0번이 가장 최근) 추가
- `touchMru(tabId)`: 해당 탭을 MRU 최상단으로 이동
- `getNextMruTab(currentId, direction)`: 다음/이전 MRU 탭 반환
- App.tsx에서 Ctrl+Tab / Ctrl+Shift+Tab 키보드 이벤트 처리

## Edge Cases
- 탭이 1개일 때 → no-op
- 탭이 0개일 때 → no-op
- MRU에 없는 탭 → 끝에 추가

## Files to Create/Modify
1. MODIFY `src/stores/editor-store.ts` — mruOrder + touchMru + getNextMruTab
2. CREATE `src/stores/__tests__/editor-store-mru.test.ts` — MRU 테스트
3. MODIFY `src/App.tsx` — Ctrl+Tab 단축키 + activeTabId 변경 시 touchMru

## Implementation Order
1. editor-store MRU 로직
2. 테스트
3. App.tsx 단축키 통합
