# Rust Backend — Baram (src-tauri)

## 이 디렉토리의 역할

Tauri 2.0 기반 Rust 백엔드. 파일 I/O, 검색 엔진, 링크 인덱싱, LLM 프록시, 내보내기 등
성능이 중요한 모든 로직을 처리한다. 프론트엔드와는 IPC(Tauri Commands + Events)로 통신한다.

## 아키텍처 (Part 3 §3.2)

```
commands/     ← IPC 핸들러 (thin layer, 로직은 각 모듈에 위임)
  ↓
fs/           ← 파일 읽기/쓰기/감시/이름변경 (notify crate)
search/       ← regex 기반 전문 검색 — 파일 워킹 (§5.11)
index/        ← 인메모리 링크/블록 인덱스 — HashMap (§29)
context/      ← 컨텍스트 관리자 — Vault 시스템 (§88)
embedding/    ← 임베딩 — Knowledge Q&A (§11.4)
plugin/       ← 플러그인 설치/레지스트리 (§69)
tag/          ← Vault 태그 인덱스 (§56m)
git/          ← git2 crate 기반 Git 연동 (vendored-openssl)
snapshot/     ← 파일 스냅샷/버전 히스토리 (similar + sha2)
llm/          ← LLM API 프록시 (Claude/OpenAI/Gemini/Ollama, 스트리밍)
export/       ← PDF (chromiumoxide headless Chrome), HTML 내보내기
config/       ← 설정 파일 관리
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

## IPC 커맨드 목록

**`ipc-registry.json`이 canonical이다** — 개별 커맨드의 시그니처/설명은 거기서 확인할 것.
이 문서에는 전체 목록을 중복 기재하지 않는다 (과거 이 표가 실제 커맨드 수의 절반 수준으로 낡은 전례가 있음).

모듈별 커맨드 패밀리 요약:

| 모듈 | 커맨드 패밀리 |
|------|--------------|
| fs | read/write/list/rename/delete/copy, watch_dir, extract_zip, write_binary_file(vault 제약), export_binary_file(제약 없음) |
| config | get/set/remove_config |
| search | search_files (regex 전문 검색) |
| index | 백링크/링크 그래프/인덱스 갱신, rename_file_with_links, unlinked mentions, block id |
| context | 컨텍스트(Vault) 관리 (§88) |
| embedding | Knowledge Q&A 임베딩 (§11.4) |
| llm | llm_complete(스트리밍) / list_models / cancel |
| export | HTML / PDF / Pandoc / 커스텀 내보내기 |
| git | status/stage/commit/diff/branch + 고급(§67: log, stash, remote, pull/push) |
| keyring | Keychain store/get/delete |
| plugin | 설치/제거/레지스트리 (§69) |
| snapshot | 생성/목록/diff/복원/삭제/히스토리 (§71) |
| tag | Vault 태그 조회/검색/rename (§56m) |

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

## Cargo.toml 의존성

**`Cargo.toml`이 canonical이다** — 이 문서에 버전 목록을 중복 기재하지 않는다 (과거 목록이 실제와 크게 어긋난 전례가 있음).

- tantivy / rusqlite는 **사용하지 않는다** — 검색은 regex 파일 워킹, 인덱스는 인메모리
- `git2`는 `vendored-openssl` feature 필수 — 아래 Universal Binary 참조

## macOS Universal Binary 릴리스

릴리스 macOS 빌드는 `--target universal-apple-darwin`(arm64 + x86_64 fat binary)이다 (이슈 198 / PR 200, 2026-07-12).
최소 지원 macOS는 **13.0** (`minimumSystemVersion`) — Vite 8 출력(Safari 16.4+ 기준)과 정합한다 (이슈 202).

- **git2 `vendored-openssl` 필수**: x86_64 슬라이스는 Apple Silicon 호스트에서 cross-compile되는데,
  Homebrew OpenSSL은 arm64뿐이라 openssl-sys(libgit2-sys + libssh2-sys 경유)가 빌드 실패한다.
  vendored feature가 타깃별로 OpenSSL을 소스 빌드하여 해결. 이 feature를 제거하면 릴리스 CI가 깨진다.
- 로컬 universal 빌드: `rustup target add x86_64-apple-darwin` 후
  `npm run tauri build -- --target universal-apple-darwin`
- 검증: `lipo -archs <바이너리>` → `x86_64 arm64` 두 아키텍처가 나와야 한다

## ipc-registry.json 유지 규칙

IPC 커맨드나 이벤트를 추가/수정할 때 반드시 `ipc-registry.json`도 업데이트할 것.
프론트엔드의 `src/ipc/types.ts`도 동기화 필요.
