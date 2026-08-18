# §57b Git Basic — 구현 노트

## Requirements (설계서에서 추출)

M9 범위 (§5.15 + §8.2 M9):
1. **git_status**: 현재 브랜치, 변경/스테이지/추적 안 됨 파일 목록
2. **git_commit**: 메시지와 함께 커밋 생성
3. **git_diff**: 파일별 diff (working tree vs HEAD)
4. **git_branches**: 로컬 브랜치 목록
5. **git_switch_branch**: 브랜치 전환
6. **git_stage / git_unstage**: 파일 스테이징/언스테이징
7. **git_discard**: 변경 취소 (working tree 복원)
8. **Source Control 사이드바 패널**: 변경 파일 목록 + 커밋 메시지 + 커밋 버튼
9. **상태바 Git 표시**: 현재 브랜치명 + 상태 아이콘
10. **브랜치 전환 드롭다운**: 상태바 클릭 또는 사이드바에서 브랜치 선택
11. **기본 Diff 뷰**: side-by-side 또는 unified (모달)
12. **커맨드 팔레트 통합**: Git: Commit, Git: Switch Branch 등

Phase 3 (M10)로 이관:
- Clone, Push, Pull, Fetch, Sync, Auto-sync
- Authentication (OAuth, PAT, SSH)
- PR/MR 생성, Conflict resolution, Commit history, Stash
- Git Settings 탭

## Dependencies (의존하는 모듈)

### Rust
- `git2` crate — libgit2 바인딩 (status, commit, diff, branch)
- `src-tauri/src/git/mod.rs` — 빈 모듈 존재, 구현 필요
- `src-tauri/src/commands/mod.rs` — git_cmd 등록 필요
- `src-tauri/src/lib.rs` — invoke_handler에 git 커맨드 추가

### Frontend
- `src/ipc/types.ts` — GitStatus 타입 존재 (확장 필요)
- `src/ipc/invoke.ts` — stub 구현 존재 (실제 invoke로 교체)
- `src/stores/ui-store.ts` — 사이드바 탭 상태
- `src/components/sidebar/` — 사이드바 패널 컴포넌트
- `src/components/toolbar/StatusBar.tsx` — 상태바

## Technical Challenges

1. **git2 crate 빌드**: libgit2 네이티브 빌드, Tauri 호환 확인 필요
2. **파일 경로 매핑**: vault path 기준 상대 경로 ↔ 절대 경로
3. **비동기 Git 작업**: commit/diff 등 파일 I/O 포함 → Rust tokio async 또는 blocking task
4. **상태 갱신 타이밍**: 파일 저장 후 git status 자동 갱신
5. **diff 파싱**: git2의 diff를 프론트엔드 렌더링 가능한 구조로 변환

## Edge Cases

- Git 초기화되지 않은 폴더 (non-repo) → 에러 대신 빈 상태 반환
- 빈 저장소 (커밋 없음) → HEAD 없음 처리
- 바이너리 파일 diff → "Binary file" 표시
- 대량 변경 파일 (100+) → 성능 고려
- 브랜치 전환 시 미저장 변경 → 경고 다이얼로그

## Files to Create/Modify

### 신규
| 파일 | 설명 |
|------|------|
| `src-tauri/src/commands/git_cmd.rs` | Git IPC 커맨드 핸들러 |
| `src/stores/git-store.ts` | Zustand Git 상태 관리 |
| `src/components/sidebar/GitPanel.tsx` | Source Control 사이드바 패널 |
| `src/components/sidebar/DiffViewer.tsx` | Diff 뷰 모달 |
| `src/components/sidebar/__tests__/git-panel.test.ts` | Git 패널 유틸 테스트 |

### 수정
| 파일 | 변경 |
|------|------|
| `src-tauri/Cargo.toml` | git2 의존성 추가 |
| `src-tauri/src/git/mod.rs` | Git 핵심 로직 구현 |
| `src-tauri/src/commands/mod.rs` | git_cmd 모듈 등록 |
| `src-tauri/src/lib.rs` | invoke_handler에 git 커맨드 추가 |
| `src/ipc/types.ts` | Git 타입 확장 (GitChange, GitDiff, GitBranch) |
| `src/ipc/invoke.ts` | stub → 실제 Tauri invoke 호출 |
| `src/components/toolbar/StatusBar.tsx` | Git 브랜치 표시 추가 |
| `src/components/sidebar/Sidebar.tsx` | Source Control 탭 추가 |
| `src/App.css` | Git 패널 + Diff 뷰 스타일 |

## Implementation Order

1. Rust: git2 의존성 + git/mod.rs 핵심 함수
2. Rust: commands/git_cmd.rs IPC 핸들러
3. Rust: lib.rs 커맨드 등록
4. Frontend: IPC 타입 + invoke 함수
5. Frontend: git-store.ts (Zustand)
6. Frontend: GitPanel.tsx (사이드바)
7. Frontend: StatusBar.tsx Git 브랜치 표시
8. Frontend: DiffViewer.tsx (diff 모달)
9. Frontend: 커맨드 팔레트 통합
10. CSS 스타일링
