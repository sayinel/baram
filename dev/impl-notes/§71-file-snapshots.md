# §71 파일 스냅샷 / 버전 히스토리 UI — 구현 노트

## Requirements (설계서 §7.5 + §3.2 + §3.5)

### 백엔드 (Rust)
- `.baram/snapshots/index.json` + `data/{timestamp}/` 구조로 스냅샷 저장
- 스냅샷 타입: `auto` (주기적/파일저장/위험작업전) / `manual` (사용자 수동)
- 변경된 파일만 저장 (SHA-256 checksum 비교)
- `similar` crate로 Myers diff (줄 단위 + 인라인 단어 diff)
- 보관 정책: 계층적 축소 (24h 전체, 1-7d 시간당 1개, 7-30d 일당 1개, 30d+ 주당 1개)
- 개수 제한 (기본 50개), 용량 제한 (기본 500MB)
- 수동 스냅샷은 자동보다 우선 보관, 라벨 있으면 자동 삭제 안 함
- 복원 전 현재 상태를 자동 스냅샷으로 저장 (복원도 되돌리기 가능)

### IPC 커맨드
| Command | Input | Output | 설명 |
|---------|-------|--------|------|
| `create_snapshot` | vault_path, type, label? | snapshot_id | 스냅샷 생성 |
| `list_snapshots` | vault_path | Vec<SnapshotEntry> | 전체 목록 |
| `get_snapshot_diff` | vault_path, snapshot_id, file_path | DiffResult | 스냅샷 vs 현재 diff |
| `restore_snapshot` | vault_path, snapshot_id, files? | void | 파일 복원 |
| `delete_snapshot` | vault_path, snapshot_id | void | 스냅샷 삭제 |
| `get_file_history` | vault_path, file_path | Vec<SnapshotEntry> | 파일별 히스토리 |

### 프론트엔드 UI
- 사이드바 "Version History" 패널 (ActivityBar 아이콘 추가)
- 스냅샷 목록 (타임라인) → 클릭 → 변경 파일 목록 → diff 뷰 → 복원
- 수동 스냅샷 생성 (라벨 입력)
- 부분 복원 (체크박스로 파일 선택)
- 설정: snapshotInterval, snapshotMaxCount

## Dependencies
- `similar` crate (Rust) — diff 알고리즘
- `sha2` crate (Rust) — SHA-256 checksum
- 기존 `fs_cmd::read_file`, `fs_cmd::write_file` 패턴 참조
- Zustand store 패턴 (git-store.ts 참조)
- 사이드바 패널 패턴 (GitPanel.tsx 참조)

## Technical Challenges
1. 대량 파일 스냅샷 시 성능 — 변경분만 저장 + 백그라운드 처리
2. 보관 정책 계층적 축소 알고리즘
3. 복원 시 에디터 상태 동기화 (열린 파일이 복원된 경우 리로드)
4. Diff UI 렌더링 (줄 단위 + 인라인 단어 diff)

## Edge Cases
- Vault에 .baram/ 디렉토리 없는 경우 → 자동 생성
- 빈 파일 스냅샷 / 바이너리 파일 건너뛰기
- index.json 손상 시 복구 (graceful degradation)
- 스냅샷 도중 파일 변경 (일관성 보장)
- 동시 복원 요청 방지

## Files to Create
### Rust Backend
- `src-tauri/src/snapshot/mod.rs` — 모듈 루트
- `src-tauri/src/snapshot/index.rs` — 인덱스 관리
- `src-tauri/src/snapshot/io.rs` — 스냅샷 파일 I/O
- `src-tauri/src/snapshot/diff.rs` — diff 엔진
- `src-tauri/src/snapshot/policy.rs` — 보관 정책
- `src-tauri/src/commands/snapshot_cmd.rs` — IPC 커맨드

### Frontend
- `src/stores/snapshot-store.ts` — Zustand 스토어
- `src/components/sidebar/VersionHistoryPanel.tsx` — UI 패널

### Files to Modify
- `src-tauri/Cargo.toml` — similar, sha2 의존성 추가
- `src-tauri/src/lib.rs` — snapshot 모듈 등록 + invoke_handler
- `src-tauri/src/commands/mod.rs` — snapshot_cmd 추가
- `src/ipc/types.ts` — 스냅샷 타입 추가
- `src/ipc/invoke.ts` — IPC 래퍼 추가
- `src/stores/ui-store.ts` — SidebarPanel에 "snapshots" 추가
- `src/stores/settings-store.ts` — 스냅샷 설정 추가
- `src/components/layout/Sidebar.tsx` — 패널 라우팅
- `src/components/layout/ActivityBar.tsx` — 아이콘 추가

## Implementation Order
1. Rust: snapshot 모듈 (types + index + io + diff + policy)
2. Rust: snapshot_cmd IPC 커맨드
3. Frontend: types + IPC invoke 래퍼
4. Frontend: snapshot-store (Zustand)
5. Frontend: VersionHistoryPanel UI
6. Frontend: 사이드바/ActivityBar 통합
7. Frontend: 설정 통합
