# Rust Backend — Baram (src-tauri)

## 이 디렉토리의 역할

Tauri 2.0 기반 Rust 백엔드. 파일 I/O, 검색 엔진, 링크 인덱싱, LLM 프록시, 내보내기 등
성능이 중요한 모든 로직을 처리한다. 프론트엔드와는 IPC(Tauri Commands + Events)로 통신한다.

## 아키텍처 (Part 3 §3.2)

```
commands/     ← IPC 핸들러 (thin layer, 로직은 각 모듈에 위임)
  ↓
fs/           ← 파일 읽기/쓰기/감시/이름변경 (notify crate)
search/       ← tantivy 기반 전문 검색 + 한글 2-gram 토크나이저
index/        ← SQLite 기반 링크 인덱스, 블록 인덱스, 태그 인덱스
git/          ← git2 crate 기반 Git 연동
snapshot/     ← 파일 스냅샷/버전 히스토리 (similar + sha2)
llm/          ← LLM API 프록시 (Claude, OpenAI, Ollama 지원, 스트리밍)
export/       ← PDF (wkhtmltopdf 또는 headless), HTML 내보내기
config/       ← 설정 파일 관리 (.baram/config.json)
```

## IPC 커맨드 규칙

### 커맨드 정의 패턴
```rust
use tauri::command;

#[command]
pub async fn read_file(path: String) -> Result<String, String> {
    crate::fs::read_file(&path)
        .await
        .map_err(|e| e.to_string())
}
```

### 에러 처리
- 내부 모듈: `thiserror` 기반 커스텀 에러 타입 사용
- IPC 경계: `Result<T, String>`으로 변환 (Tauri 직렬화 제약)
- 프론트엔드에서 에러 메시지를 사용자에게 표시 가능하도록 한국어/영어 메시지 포함

### 이벤트 발행 패턴
```rust
use tauri::Emitter;

app_handle.emit("file:changed", FileChangedPayload {
    path: path.to_string(),
    kind: "modified".to_string(),
}).unwrap();
```

## IPC 커맨드 목록 (Part 3 §3.2)

| Command | 모듈 | Phase | 설명 |
|---------|------|-------|------|
| `read_file` | fs | 1 (M2) | 파일 읽기 |
| `write_file` | fs | 1 (M2) | 파일 쓰기 (원자적) |
| `list_dir` | fs | 1 (M2) | 디렉토리 목록 |
| `rename_file` | fs | 1 (M4) | 파일 이름 변경 |
| `delete_file` | fs | 1 (M4) | 파일 삭제 |
| `create_dir` | fs | 1 (M4) | 디렉토리 생성 |
| `delete_dir` | fs | 1 (M4) | 디렉토리 삭제 |
| `copy_file` | fs | 1 (M4) | 파일 복사 |
| `extract_zip` | fs | 2 (M9) | ZIP 파일 추출 |
| `watch_dir` | fs | 1 (M2) | 디렉토리 감시 시작 |
| `get_config` | config | 1 (M2) | 설정 조회 |
| `set_config` | config | 1 (M2) | 설정 저장 |
| `remove_config` | config | 1 (M2) | 설정 삭제 |
| `search_files` | search | 2 (M9) | 전역 텍스트 검색 |
| `get_backlinks` | index | 2 (M7) | 백링크 조회 |
| `get_link_index` | index | 2 (M7) | 링크 그래프 조회 |
| `refresh_index` | index | 2 (M7) | 인덱스 재구축 |
| `update_file_index` | index | 2 (M7) | 단일 파일 인덱스 갱신 |
| `rename_file_with_links` | index | 2 (M7) | 파일 이름 변경 + 링크 갱신 |
| `get_unlinked_mentions` | index | 2 (M7) | 언링크드 멘션 검색 |
| `rename_block_id` | index | 2 (M7) | 블록 ID 이름 변경 |
| `llm_complete` | llm | 1 (M5) | LLM 호출 (스트리밍) |
| `llm_list_models` | llm | 2 (M8) | AI 모델 목록 조회 |
| `llm_cancel` | llm | 2 (M8) | LLM 스트리밍 취소 |
| `export_document` | export | 1 (M6) | HTML 내보내기 |
| `export_pdf` | export | 1 (M6) | PDF 내보내기 |
| `detect_pandoc` | export | 2 (M9) | Pandoc 감지 |
| `export_pandoc` | export | 2 (M9) | Pandoc 내보내기 |
| `run_custom_export` | export | 2 (M9) | 커스텀 내보내기 |
| `git_status` | git | 2 (M9) | Git 상태 |
| `git_commit` | git | 2 (M9) | Git 커밋 |
| `git_stage` | git | 2 (M9) | Git 스테이징 |
| `git_unstage` | git | 2 (M9) | Git 언스테이징 |
| `git_diff_file` | git | 2 (M9) | Git diff |
| `git_branches` | git | 2 (M9) | Git 브랜치 목록 |
| `git_switch_branch` | git | 2 (M9) | Git 브랜치 전환 |
| `git_discard` | git | 2 (M9) | Git 변경 되돌리기 |
| `git_create_branch` | git | 2 (M9) | Git 브랜치 생성 |
| `keyring_store` | keyring | 2 (M8) | Keychain 저장 |
| `keyring_get` | keyring | 2 (M8) | Keychain 조회 |
| `keyring_delete` | keyring | 2 (M8) | Keychain 삭제 |
| `get_opened_urls` | app | 1 (M6) | macOS 파일 연결 |
| `get_vault_tags` | tag | 2 (M9) | Vault 태그 목록 조회 |
| `get_files_by_tag` | tag | 2 (M9) | 태그별 파일 검색 |
| `rename_tag` | tag | 2 (M9) | 태그 이름 변경/병합 |
| `write_binary_file` | fs | 2 (M9) | 바이너리 파일 쓰기 |
| `create_snapshot` | snapshot | 3 (M10) | 스냅샷 생성 |
| `list_snapshots` | snapshot | 3 (M10) | 스냅샷 목록 조회 |
| `get_snapshot_diff` | snapshot | 3 (M10) | 스냅샷 vs 현재 파일 diff |
| `restore_snapshot` | snapshot | 3 (M10) | 스냅샷에서 파일 복원 |
| `delete_snapshot` | snapshot | 3 (M10) | 스냅샷 삭제 |
| `get_file_history` | snapshot | 3 (M10) | 파일별 스냅샷 히스토리 |

## 이벤트 목록

| Event | Payload | 모듈 | 설명 |
|-------|---------|------|------|
| `file:changed` | `{ path, kind }` | fs | 파일 변경 감지 |
| `file:created` | `{ path }` | fs | 파일 생성 감지 |
| `file:deleted` | `{ path }` | fs | 파일 삭제 감지 |
| `llm:token` | `{ requestId, token }` | llm | LLM 스트리밍 토큰 |
| `llm:done` | `{ requestId }` | llm | LLM 응답 완료 |
| `llm:error` | `{ requestId, error }` | llm | LLM 에러 |
| `index:updated` | `{ filesIndexed }` | index | 인덱스 갱신 완료 |
| `git:progress` | `{ operation, percent }` | git | Git 작업 진행률 |

## 파일 쓰기 규칙 (Part 3 §3.6)

항상 원자적 쓰기(atomic write)를 사용한다:
1. 같은 디렉토리에 임시 파일(`{name}.tmp`) 생성
2. 전체 내용을 임시 파일에 쓰기
3. `fs::rename()`으로 원본 파일을 교체 (OS 수준 원자적 보장)
4. 실패 시 임시 파일 삭제

## Cargo.toml 핵심 의존성

```toml
[dependencies]
tauri = { version = "2", features = ["tray-icon", "protocol-asset"] }
tauri-plugin-fs = "2"
tauri-plugin-dialog = "2"
tauri-plugin-updater = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tokio = { version = "1", features = ["full"] }
rusqlite = { version = "0.31", features = ["bundled"] }
tantivy = "0.22"
notify = "6"
git2 = "0.18"
reqwest = { version = "0.12", features = ["stream", "json"] }
thiserror = "1"
```

## ipc-registry.json 유지 규칙

IPC 커맨드나 이벤트를 추가/수정할 때 반드시 `ipc-registry.json`도 업데이트할 것.
프론트엔드의 `src/ipc/types.ts`도 동기화 필요.
