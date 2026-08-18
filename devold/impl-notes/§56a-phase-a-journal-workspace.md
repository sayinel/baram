# §56a Phase A: Journal Workspace 기반 — 구현 노트

## Requirements (설계서에서 추출)

### A1: 폴더 구조 재설계 + 마이그레이션
- 기존 flat 구조 (`journals/YYYY-MM-DD.md`) → 계층적 `daily/YYYY/MM/YYYY-MM-DD.md`
- `notes/`, `weekly/`, `monthly/`, `yearly/`, `templates/`, `assets/`, `prompts/` 서브폴더
- 마이그레이션 다이얼로그: flat 파일 감지 → "폴더 구조로 정리하시겠습니까?" → 자동 이동 또는 그대로 유지
- 자동 디렉토리 생성: 일기 생성 시 중간 디렉토리 자동 생성 (recursive)

### A1.5: notes/ 폴더 생성 + FileTree 표시
- `notes/` 폴더가 daily, weekly 등과 함께 FileTree에 표시
- 플랫 구조 기본, 사용자 서브폴더 자유 생성

### A2: FileTree 스코핑
- `file-store.ts`에 `originalRootPath`, `isJournalScoped` 추가
- `enterJournalScope(journalDir)`: rootPath를 journalDirectory로 전환
- `exitJournalScope()`: 원래 rootPath 복원
- 저널 폴더만 표시: daily, weekly, monthly, yearly, notes, templates
- `.journal.json`, `assets/` 등은 숨김 처리

### A3: 워크스페이스 레이아웃 전환
- `ui-store.ts`의 `rightPanelMode`에 `"memories"` 추가
- `workspace-store.ts` 저널 프리셋 확장: rightPanelOpen=true, rightPanelMode="memories"
- `JournalWorkspaceState` 타입: memoriesTab, memoriesMode 포함
- Memories View 플레이스홀더 컴포넌트 생성

## Dependencies

- `src/stores/file-store.ts` — rootPath, fileTree, buildFileTree
- `src/stores/settings-store.ts` — journalDirectory, journalEnabled, journalUseHierarchy (신규)
- `src/stores/workspace-store.ts` — 저널 프리셋
- `src/stores/ui-store.ts` — sidebarPanel, rightPanelMode
- `src/utils/journal.ts` — getJournalFilePath, resolveJournalDir
- `src/ipc/invoke.ts` — listDir, createDir
- `src/components/sidebar/FileTree.tsx` — 트리 렌더링
- `src/components/layout/AppLayout.tsx` — 3컬럼 레이아웃
- `src/components/layout/Sidebar.tsx` — 패널 라우팅

## Technical Challenges

1. **마이그레이션 안전성**: flat → hierarchical 이동 시 데이터 손실 방지, 위키링크 참조 업데이트
2. **FileTree 숨김 필터**: `.journal.json`, `assets/` 등 특정 항목 필터링 로직 (isJournalScoped일 때만)
3. **하위 호환**: journalUseHierarchy=false면 기존 flat 구조 유지, 경로 해석이 달라짐
4. **프리셋 전환 시 상태 복원**: 저널 워크스페이스 진입/퇴장 시 UI 상태 클린하게 전환

## Edge Cases

- journalDirectory가 설정되지 않은 상태에서 저널 프리셋 적용 시 → 경고 표시
- flat 파일 중 날짜 형식이 아닌 파일이 있을 때 마이그레이션 → 무시
- weekly/monthly/yearly 폴더가 설정에서 비활성인데 이미 존재할 때 → 그대로 표시
- 저널 디렉토리가 vault 외부에 있을 때 → 절대 경로로 처리 (기존 동작 유지)

## Files to Create/Modify

### 수정
- `src/stores/file-store.ts` — enterJournalScope/exitJournalScope, 숨김 필터
- `src/stores/settings-store.ts` — journalUseHierarchy 설정 추가
- `src/stores/workspace-store.ts` — 저널 프리셋 확장 (우측 패널, memoriesTab 등)
- `src/stores/ui-store.ts` — rightPanelMode에 "memories" 추가
- `src/utils/journal.ts` — 계층적 경로 해석, 마이그레이션 유틸
- `src/components/layout/AppLayout.tsx` — RightPanel에 MemoriesView 렌더링 추가
- `src/components/layout/Sidebar.tsx` — (변경 없을 수 있음)
- `src/components/sidebar/FileTree.tsx` — 저널 스코프 숨김 필터

### 생성
- `src/utils/journal-migration.ts` — flat → hierarchical 마이그레이션 로직
- `src/components/journal/MemoriesView.tsx` — Memories View 플레이스홀더
- `src/components/journal/MigrationDialog.tsx` — 마이그레이션 확인 다이얼로그

## Implementation Order

1. **settings-store 확장** — `journalUseHierarchy` 추가 (스토어 마이그레이션 v5)
2. **journal.ts 경로 해석 업데이트** — 계층적 경로 지원 (`daily/YYYY/MM/YYYY-MM-DD.md`)
3. **journal-migration.ts** — flat → hierarchical 변환 유틸
4. **file-store.ts 스코핑** — enterJournalScope/exitJournalScope + 숨김 필터
5. **ui-store.ts** — rightPanelMode "memories" 추가
6. **workspace-store.ts** — 저널 프리셋 확장
7. **MemoriesView.tsx** — 플레이스홀더 컴포넌트
8. **MigrationDialog.tsx** — 마이그레이션 다이얼로그
9. **AppLayout/FileTree 통합** — MemoriesView 렌더링, FileTree 필터
10. **CalendarPanel 업데이트** — 계층적 경로 지원
