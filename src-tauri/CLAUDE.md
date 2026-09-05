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
approval/     ← vault 경계 승인 저장소 — 웹뷰가 못 건드리는 인가 기록 (§331)
task/         ← 태스크 인덱스/필드 파싱 (§302~§318)
embedding/    ← 임베딩 — Knowledge Q&A (§11.4)
plugin/       ← 플러그인 설치/레지스트리 (§69)
tag/          ← Vault 태그 인덱스 (§56m)
git/          ← git2 crate 기반 Git 연동 (vendored-openssl)
snapshot/     ← 파일 스냅샷/버전 히스토리 (similar + sha2)
llm/          ← LLM API 프록시 (Claude/OpenAI/Gemini/Ollama, 스트리밍)
export/       ← PDF (chromiumoxide headless Chrome), HTML 내보내기
config/       ← 설정 파일 관리
thumbnail/    ← 미리보기 썸네일 생성
protocol/     ← 커스텀 프로토콜 핸들러      md/       ← 마크다운 유틸
logging/      ← 파일 로깅 (회전·상한)       menu.rs   ← 네이티브 메뉴/accelerator
```

## 로컬 명령

`cd src-tauri && cargo test` · `cargo clippy --all-targets`(pre-push hook과 동일) · `cargo fmt --check` — 셋 다 CI 게이트. PR이 Rust 경로를 건드리지 않으면 rust 잡 skip이 정상이고, 그 외 skip은 빨간불(`.claude/docs/ci-contract.md`).

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
| approval | 피커 경유 승인, 승인 목록 조회/회수, 경로 승인 여부 질의 (§331~§335) |
| task | 태스크 스캔/조회/갱신 (§302~§318) |
| thumbnail | 미리보기 썸네일 |

## 이벤트 목록

**`ipc-registry.json`의 `events`가 canonical이다** — 커맨드와 같은 이유로 이 문서에 목록을 중복 기재하지 않는다
(실제로 이 표는 3건 누락 + 유령 1건 상태로 낡았던 전례가 있다).

계열 요약: `file:*`(변경·생성·삭제·열기 요청) · `llm:*`(토큰·완료·에러) · `index:updated` · `app://close-requested` · `plugin:*`

## 파일 쓰기 규칙 (Part 3 §3.6)

항상 원자적 쓰기(atomic write)를 사용한다:
1. 같은 디렉토리에 임시 파일(`{name}.tmp`) 생성
2. 전체 내용을 임시 파일에 쓰기
3. `fs::rename()`으로 원본 파일을 교체 (OS 수준 원자적 보장)
4. 실패 시 임시 파일 삭제

## vault 경계 인가 규칙 (§329–§336)

경계가 **자기를 인가하면 경계가 아니다**. `check_vault`는 등록된 컨텍스트를 신뢰하는데
그 컨텍스트를 등록하는 커맨드가 웹뷰 경로를 받았던 것이 §329의 결함이다.

- 웹뷰가 준 경로로 asset scope를 부여하는 커맨드는 부여 **전에**
  `commands::approval_cmd::ensure_approved`를 통과해야 한다 (`add_context` · `set_vault_root` ·
  `plugin_add_dev_folder`). 게이트는 부작용보다 **먼저** — `dev_info()`처럼 매니페스트를 읽으면서
  scope까지 부여하는 함수 뒤에 달면 존재 오라클이 새고 동의 전에 부여된다.
- 승인 기록은 Rust 소유 `{app_data_dir}/approved-roots.json`. **`config.json`에 두지 말 것** —
  `set_config`가 임의 키를 받으므로 웹뷰가 스스로를 승인하게 된다.
- 판정은 fail-closed: 파일 없음·파싱 실패·canonicalize 실패는 전부 "미승인".
  포함 판정은 `Path::starts_with`(컴포넌트 단위) — 문자열 접두사면 `/x/Vault`가 `/x/Vault-secret`을 먹는다.
- **`Scope::forbid_*` 호출 금지**: 영구적이고 allow보다 우선하며 해제 API가 없다.
  회수에서 부르면 그 세션의 재승인까지 죽는다.
- 두 전수 스캔 테스트가 `approval/mod.rs`에 있다 —
  `no_new_scope_forbid_call_anywhere_in_the_crate`, `no_new_asset_scope_grant_outside_the_allowlist`.
  새 `allow_directory`/`allow_file` 호출부는 allowlist에 **의도적으로** 넣기 전까지 빌드를 깨뜨린다.
  입구 열거는 이 작업에서 다섯 번 틀렸고, 매번 심볼 grep이 아니라 효과 grep·전수 스캔이 잡았다.

## zip 추출 규칙

- 모든 zip 추출은 `fs/archive.rs`의 `ExtractBounds` 공용 코어 경유 (6종 폭탄 방어; 경로 봉쇄는 호출자가 `enclosed_name` 기반으로).
- `fs::extract_zip`은 스테이징 2단계: 출력 폴더 내 tempdir에 전량 추출 → 읽기 전용 PREFLIGHT 전수 검사 → 통과 시에만 COMMIT(rename). 거부는 출력 폴더 무손상 — 계약 상세는 `commit_staged_extraction` doc.
- **`plugin/mod.rs`의 REVOCATION 상수 3개는 이동 금지** — 프론트 테스트 2개와 `scripts/rust-constants.ts`가 그 파일을 리터럴 경로로 스캔한다 (옮기면 컴파일은 통과, 검증은 무음 사망).

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
