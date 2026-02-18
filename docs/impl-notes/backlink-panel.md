# §29 백링크 패널 — 구현 노트

## Requirements (설계서에서 추출)

### Part 5 §5.6
- 현재 파일을 `[[wikilink]]`로 참조하는 다른 파일 목록 표시
- Linked Mentions: 명시적 `[[]]` 링크
- 각 항목에 소스 파일명, 줄번호, 주변 컨텍스트 텍스트 표시
- 클릭 시 해당 파일의 해당 위치로 이동

### Part 4 §4.3
- 좌 사이드바의 탭 중 하나 (Files, Outline, Search, **Backlinks**)
- 단축키: Cmd+Shift+B (Part 4 §4.8)

### Part 3 §3.5
- linkStore (Zustand): `backlinks`, `linkGraph`, `lastIndexed` 상태 관리
- BacklinkEntry: `{ sourcePath, targetPath, context, line }`

### 성능 목표 (Part 5 §5.6)
- 단일 파일 증분 업데이트: 50ms 이내
- 1000개 파일 Vault 전체 인덱스: 3초 이내

## Dependencies (의존하는 모듈/Extension)

- §28 Wikilink Extension (완료) — `[[]]` 구문 정의 및 파서
- `src/ipc/types.ts` — BacklinkEntry, LinkGraph, IndexStats 타입 (이미 정의됨)
- `src/ipc/invoke.ts` — getBacklinks(), getLinkIndex(), refreshIndex() (시그니처 이미 정의됨)
- `src/stores/ui-store.ts` — SidebarPanel 타입에 "backlinks" 이미 포함
- `src/components/layout/Sidebar.tsx` — 탭 추가 필요
- Rust `index/mod.rs` — 현재 빈 플레이스홀더, 구현 필요
- Rust `commands/` — index_cmd.rs 생성 필요

## Technical Approach

### Rust 백엔드: 인메모리 링크 인덱스 (SQLite 없이 시작)

SQLite는 M7 후반에 추가하고, 우선 **인메모리 HashMap 기반 인덱스**로 시작한다.
이유:
1. `rusqlite`가 아직 Cargo.toml에 없음
2. 핵심 기능(백링크 조회)은 인메모리로 충분
3. IPC 계약(BacklinkEntry)이 이미 정의되어 있어 나중에 교체 가능

```
LinkIndex (Arc<Mutex<...>>)
├── file_links: HashMap<String, Vec<LinkEntry>>  // source → outgoing links
├── backlinks: HashMap<String, Vec<BacklinkEntry>>  // target → incoming links
└── last_indexed: Instant
```

### 인덱싱 전략
1. **Vault 열기 시**: 모든 .md 파일을 비동기 스캔, wikilink 추출
2. **파일 저장 시**: 해당 파일만 재파싱 (증분 업데이트)
3. **파일 삭제/이름 변경 시**: 인덱스에서 해당 항목 제거/갱신

### Wikilink 추출
§28에서 사용한 것과 동일한 regex: `\[\[([^\]|#^]+)(?:#[^\]|^]+)?(?:\^[^\]|]+)?(?:\|[^\]]+)?\]\]`

### Frontend: Backlinks 컴포넌트
- Outline.tsx 패턴 따름
- 현재 활성 파일 경로로 `getBacklinks()` IPC 호출
- 파일별로 그룹핑하여 표시
- 클릭 시 파일 열기 + 줄 이동

## Edge Cases

- 현재 파일이 저장되지 않은 새 파일 (filePath 없음) → 빈 백링크
- 대상 파일이 파일명만으로 참조 (.md 확장자 없이) → 매칭 로직 필요
- Vault 루트가 설정되지 않은 경우 → 인덱싱 불가, 빈 상태
- 파일 삭제 후 백링크가 남아있는 경우 → "파일 없음" 표시
- 동시에 여러 파일 저장 시 인덱스 경쟁 → Mutex로 보호

## Files to Create/Modify

### 생성
1. `src-tauri/src/index/mod.rs` — Rust 인메모리 링크 인덱스
2. `src-tauri/src/commands/index_cmd.rs` — IPC 커맨드 (get_backlinks, refresh_index, get_link_index)
3. `src/components/sidebar/Backlinks.tsx` — 백링크 UI 컴포넌트
4. `src/stores/link-store.ts` — 링크 인덱스 프론트엔드 캐시
5. `src/stores/__tests__/link-store.test.ts` — 스토어 테스트
6. `src/__tests__/integration/backlink-panel.test.ts` — 통합 테스트

### 수정
1. `src-tauri/src/commands/mod.rs` — `pub mod index_cmd;` 추가
2. `src-tauri/src/lib.rs` — IPC 커맨드 등록
3. `src/components/layout/Sidebar.tsx` — Backlinks 탭 추가
4. `src/App.css` — 백링크 패널 스타일

## Implementation Order

1. Rust 인메모리 링크 인덱스 (`index/mod.rs`)
2. Rust IPC 커맨드 (`commands/index_cmd.rs`) + lib.rs 등록
3. link-store.ts (Zustand)
4. Backlinks.tsx 컴포넌트
5. Sidebar.tsx에 탭 추가
6. CSS 스타일
7. 전체 테스트 실행 + 검증
