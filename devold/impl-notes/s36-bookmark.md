# §36 북마크 시스템 — 구현 노트

## Requirements (설계서에서 추출)

- 파일, 헤딩을 북마크로 저장 (블록/검색 쿼리는 Phase 3)
- 북마크 추가: 커맨드 팔레트 or Cmd+D 단축키
- 사이드바에 "Bookmarks" 탭 추가
- 그룹별 표시 (기본 그룹: "Default")
- 클릭 시 해당 파일/위치로 네비게이션
- 북마크 삭제 가능
- 데이터: localStorage에 저장 (rootPath 키), 추후 `.baram/bookmarks.json`으로 이전 가능

## Dependencies

- `src/stores/ui-store.ts` — `SidebarPanel` 타입에 `"bookmarks"` 추가
- `src/components/layout/Sidebar.tsx` — 탭 등록
- `src/stores/editor-store.ts` — 활성 탭 filePath 참조
- `src/stores/file-store.ts` — rootPath, fileContent 참조
- `src/ipc/invoke.ts` — `readFile` (파일 열기 네비게이션)

## Technical Challenges

1. **Heading 북마크 안정성**: ProseMirror `pos` 기반으로 저장하면 문서 편집 시 위치가 변한다
   → 해결: headingText + level을 저장하고, 네비게이션 시 실시간으로 doc.descendants()로 pos 재탐색
2. **rootPath별 격리**: 다른 vault를 열면 다른 북마크 세트를 표시해야 함
   → localStorage key: `baram:bookmarks:<rootPath>`
3. **사이드바 탭 개수**: 4개 탭이 되면 공간이 좁아질 수 있음
   → 기존 3탭(Files/Outline/Backlinks) + 1탭(Bookmarks) = 4탭, flex:1이므로 자동 분배

## Edge Cases

- rootPath가 없을 때 (vault 미선택) → 빈 상태 표시
- 같은 파일 + 같은 헤딩 중복 북마크 방지
- 북마크된 파일이 삭제/이름 변경된 경우 → "missing" 표시 (graceful degradation)
- 헤딩 텍스트가 변경된 경우 → 가장 가까운 매칭 headings로 fallback

## Files to Create/Modify

### Create
- `src/stores/bookmark-store.ts` — Zustand 스토어 + localStorage 영속화
- `src/components/sidebar/BookmarkPanel.tsx` — 사이드바 북마크 패널
- `src/__tests__/integration/bookmark.test.ts` — 통합 테스트

### Modify
- `src/stores/ui-store.ts` — `SidebarPanel` 타입 확장
- `src/components/layout/Sidebar.tsx` — 탭 + 패널 등록
- `src/App.tsx` — Cmd+D 단축키 등록
- `src/App.css` — 북마크 스타일

## Implementation Order

1. 타입 정의 (BookmarkItem in bookmark-store.ts)
2. Zustand 스토어 (CRUD + localStorage)
3. 테스트 작성 (스토어 단위 + 통합)
4. UI Store 타입 확장
5. Sidebar 탭 등록
6. BookmarkPanel 컴포넌트
7. Cmd+D 단축키
8. CSS 스타일
