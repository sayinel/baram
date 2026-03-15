# Baram — 기술 부채 & 백로그

> 최종 업데이트: 2026-03-14
> 이 문서는 즉시 구현하지 않기로 결정한 항목들을 추적한다.
> 기능 로드맵은 `docs/next-steps.md`, 리팩토링 계획은 `.omc/plans/refactoring-plan.md` 참고.

---

## 보안 (Security)

### 🟠 HIGH — API 키 IPC 전달 방식

- **위치**: `src-tauri/src/commands/llm_cmd.rs:9`
- **문제**: `llm_complete` 커맨드가 `api_key: String`을 IPC JSON 파라미터로 수신 → Tauri DevTools Network 탭에서 평문 노출, 에러 메시지에 키 포함 가능성
- **현황**: `keyring_cmd.rs`가 이미 구현되어 있음
- **권장 수정**: `api_key` 파라미터 제거 → 백엔드에서 `keyring::Entry::new("baram", &provider).get_password()` 직접 조회
- **재검토 조건**: LLM 기능 리팩토링 시

### 🟡 MEDIUM — assetProtocol scope 과다

- **위치**: `src-tauri/tauri.conf.json` (assetProtocol.scope)
- **문제**: `scope: ["$APPDATA/**", "$DOCUMENT/**", "$DOWNLOAD/**"]` → XSS 발생 시 Documents/Downloads 전체 파일을 `asset://`로 읽기 가능
- **권장 수정**:
  ```json
  "scope": ["$APPDATA/com.inel.baram/**", "$DOCUMENT/**/*.{md,png,jpg,jpeg,gif,webp,svg}"]
  ```
- **재검토 조건**: 보안 감사 / XSS 취약점 패치 후

### 🟡 MEDIUM — Mermaid SVG DOMPurify 레이어 없음

- **위치**: `src/extensions/nodes/mermaid-block-view.tsx:291,355,395,616`
- **문제**: Mermaid 생성 SVG를 DOMPurify 없이 `dangerouslySetInnerHTML` 삽입. 현재 버전(^11.12.2)은 안전하나, 라이브러리 업그레이드 시 방어 레이어 없음
- **권장 수정**:
  ```tsx
  import DOMPurify from "dompurify";
  dangerouslySetInnerHTML={{
    __html: DOMPurify.sanitize(svgHtml, { USE_PROFILES: { svg: true }, FORBID_TAGS: ["script"] })
  }}
  ```
- **재검토 조건**: mermaid 패키지 메이저 업그레이드 시

### 🟡 MEDIUM — resolveImageSrcs 정규식 파싱 취약

- **위치**: `src/components/journal/utils.ts:5-22`
- **문제**: HTML 문자열을 정규식으로 파싱해 `src` 교체 → `onerror` 등 기타 속성 통과, `convertFileSrc(absolutePath)` 결과 미검증
- **권장 수정**: DOM 파서 사용 또는 `DOMPurify.sanitize()` 호출 전후 적용
- **재검토 조건**: Journal 이미지 처리 리팩토링 시

### 🔵 LOW — CSP connect-src localhost:* 과다 허용

- **위치**: `src-tauri/tauri.conf.json` (CSP connect-src)
- **문제**: `http://localhost:*` 허용 → XSS 발생 시 로컬 임의 서비스 접근 가능
- **권장 수정**: Ollama 기본 포트로 제한 `http://localhost:11434`
- **재검토 조건**: 보안 감사 시

### 🔵 LOW — fs::validate_path canonicalize 미적용

- **위치**: `src-tauri/src/fs/mod.rs:51-65`
- **문제**: 절대 경로 체크만 하고 `../../etc/passwd` 같은 traverse 패턴 미차단. ZIP 추출은 canonicalize 적용 중이나 일반 읽기/쓰기는 미적용
- **권장 수정**: `Path::new(path).exists()` 시 `canonicalize` 후 vault root 범위 검증
- **재검토 조건**: 경로 traversal 취약점 보안 감사 시

---

## 아키텍처 (Architecture)

### 🟡 MEDIUM — useTabSwitching isSourceMode stale closure

- **위치**: `src/hooks/use-tab-switching.ts:307`
- **문제**: `useEffect` deps가 `[activeTabId]`만이고 `isSourceMode`는 stale closure로 소비됨. 소스 모드 중 탭 전환 후 복귀 시 `setIsSourceMode(false)` 호출 누락 가능
- **권장 수정**: `isSourceMode`를 `useRef`로 미러링하거나 store에서 직접 읽도록 변경
- **재검토 조건**: useTabSwitching 수정 시 반드시 검토

### 🟡 ARCH — math-block / mermaid-block 런타임 순환 의존성

- **위치**: `src/extensions/nodes/math-block-view.tsx:10`, `mermaid-block-view.tsx:16`
- **문제**: `import { mathBlockEntryKey }` / `import { mermaidBlockEntryKey }` 가 값(value) import로 런타임 순환 의존성 발생. 현재는 PluginKey 상수가 모듈 최상위에서 즉시 평가되어 동작하나, 모듈 로딩 순서에 취약한 구조
- **권장 수정**: `math-block-keys.ts`, `mermaid-block-keys.ts` 파일 분리 후 양쪽에서 import
- **재검토 조건**: Extension 추가/수정으로 번들러 경고 발생 시

### 🟡 ARCH — EditorContext prop drilling (D3 계획 항목)

- **위치**: `src/App.tsx:445-591`, editor prop 16개소 전달
- **문제**: `editor` prop이 11개 이상 컴포넌트에 직접 전달됨 (prop drilling)
- **권장 수정**: `React.createContext` 기반 `EditorContext` 도입
- **재검토 조건**: Phase D3 작업 시 (리팩토링 계획 포함)

### 🔵 LOW — use-app-startup.ts Strict Mode onLaunchDone ref 초기화 누락

- **위치**: `src/hooks/use-app-startup.ts:32-61`
- **문제**: `onLaunchDone` ref가 cleanup에서 초기화되지 않아 React Strict Mode(개발 환경)에서 마운트→언마운트→재마운트 시 복원 로직이 실행되지 않는 것처럼 보임
- **권장 수정**: cleanup 함수에서 `onLaunchDone.current = false` 초기화 또는 module-level 변수 승격
- **재검토 조건**: 개발 환경 디버깅 불편 발생 시

### 🔵 LOW — App.tsx detectPeriodicType 이중 호출

- **위치**: `src/App.tsx:518-523`
- **문제**: 조건 평가와 props 전달에서 `detectPeriodicType(activeTabFilePath)` 두 번 호출
- **권장 수정**: `const periodicType = detectPeriodicType(activeTabFilePath)` 변수 추출
- **재검토 조건**: App.tsx 정리 시 (D3 EditorContext 작업 때)

### 🔵 LOW — use-tab-switching.ts non-MD 조기 반환 후 editorStateCache 누적

- **위치**: `src/hooks/use-tab-switching.ts:296-301`
- **문제**: non-markdown 파일 조기 return 시 editorStateCache 정리 코드가 실행되지 않아 닫힌 탭의 EditorState가 메모리에 누적
- **권장 수정**: non-MD 조기 return 경로에도 캐시 정리 로직 포함
- **재검토 조건**: non-MD 파일이 많은 워크스페이스에서 메모리 증가 관찰 시

### 🟡 MEDIUM — formatError 유틸 소비처 미연결

- **위치**: `src/utils/format-error.ts:44`
- **문제**: `formatError(error: unknown): string` 함수가 export되어 있으나 임포트하는 파일이 없음 (5개 파일이 `formatAIError`만 사용)
- **권장 수정**: `catch(e) { ... e.toString() }` 패턴을 `formatError(e)`로 교체
- **재검토 조건**: 에러 핸들링 리팩토링 시

### 🟡 MEDIUM — GraphView cytoscape.use() 중복 호출 경고 가능성

- **위치**: `src/components/sidebar/GraphView.tsx:79`
- **문제**: `GraphView` 언마운트/재마운트 시 `cytoscape.use(fcose)` 재호출 — 버전에 따라 console 경고 발생 가능
- **권장 수정**: module-level `fcoseRegistered` 플래그로 guard
  ```typescript
  let fcoseRegistered = false;
  if (!fcoseRegistered) { cytoscape.use(fcose); fcoseRegistered = true; }
  ```
- **재검토 조건**: cytoscape 버전 업그레이드 시 또는 경고 실제 발생 시

### 🟡 MEDIUM — MarkdownRenderer URL scheme 미검증

- **위치**: AI 채팅 패널 (MarkdownRenderer, AIPanel)
- **문제**: AI 응답 마크다운에서 링크/이미지 URL scheme을 검증하지 않아 `javascript:`, `data:` 등 위험 scheme이 렌더링될 수 있음
- **권장 수정**: `href`/`src` 속성에 `javascript:`, `data:`, `vbscript:` scheme 필터링 또는 DOMPurify `ALLOWED_URI_REGEXP` 설정
- **재검토 조건**: AI 응답 렌더링 리팩토링 시

### 🟡 MEDIUM — use-file-watcher.ts shouldSkip 과도한 dotfile 필터

- **위치**: `src/hooks/use-file-watcher.ts:146-149`
- **문제**: `.`으로 시작하는 모든 파일/디렉토리를 무시 → 사용자가 `.env.md`, `.notes.md` 같은 점으로 시작하는 MD 파일을 Vault에 두면 감시 대상에서 제외됨
- **권장 수정**: `.baram/`, `.git/` 등 알려진 시스템 디렉토리만 명시적 제외
- **재검토 조건**: 점으로 시작하는 파일 지원 요청 시

### 🟡 MEDIUM — updateFileIndex 실패 시 silent swallow

- **위치**: `src/hooks/use-auto-save.ts:36`, `src/hooks/use-file-operations.ts:108,128,175`
- **문제**: `updateFileIndex(...).catch(() => {})` — 인덱스 갱신 실패가 완전히 무시되어 백링크/그래프가 stale 상태로 유지됨을 사용자가 알 수 없음
- **권장 수정**: `.catch((e) => logger.warn("index update failed", e))` 로 교체
- **재검토 조건**: 링크 인덱스 오류 디버깅 필요 시

### 🟡 MEDIUM — search_cmd.rs max_results 상한 없음

- **위치**: `src-tauri/src/commands/search_cmd.rs`
- **문제**: 프론트엔드가 전달하는 `max_results` 값에 상한이 없어 매우 큰 값 전달 시 메모리/CPU 과다 사용
- **권장 수정**: `let capped = max_results.min(500);` 형태로 서버 측 상한 적용
- **재검토 조건**: 전문 검색 성능 튜닝 시

### 🟡 MEDIUM — settings-store.ts migration path 필드 타입 가드 없음

- **위치**: `src/stores/settings-store.ts` (migration 함수들)
- **문제**: 마이그레이션 시 `state.vaultPath` 등 path 필드를 `string`으로 가정하나 실제로는 `null | undefined`일 수 있음 — `null.split(...)` TypeError 위험
- **권장 수정**: `typeof state.vaultPath === "string"` 체크 추가
- **재검토 조건**: 설정 마이그레이션 추가 시

---

## 파이프라인 설계 결정 보류 (C6 Backlog)

### 🟡 MEDIUM — pm-to-md convertPmNode 특수 케이스 통일

- **위치**: `src/pipeline/pm-to-md.ts:267-375`
- **문제**: `convertPmNode()` 함수 내 4개의 특수 케이스가 `NodeTransformer` 표준 경로 밖에 존재:
  1. **paragraph/heading** (line 275-291): `convertPmInlineChildren` + blockId append 필요
  2. **definitionList** (line 294-339): 수동 직렬화 (`convertPmInlineChildren` + `mdastToMarkdown` 조합)
  3. **image** (line 343-358): paragraph 래핑 + html fallback 분기
- **현황**: 의도 주석 추가됨 (line 267-270). 기존 코드 안정적으로 동작 중
- **권장 수정 방향**: `NodeTransformerEntry` 인터페이스에 메타데이터 필드 추가
  - `converterType: "standard" | "inlineChildren" | "manual"`
  - `wrapInParagraph?: boolean`
  - `appendBlockId?: boolean`
- **재검토 조건**: 새로운 특수 직렬화 노드 타입 추가 시

---

## 추후 티켓 (리팩토링 범위 외)

> 리팩토링 계획(`.omc/plans/refactoring-plan.md`)과 연계된 항목들

| # | 항목 | 연관 Phase |
|---|------|-----------|
| 1 | i18n 전체 적용 (74 컴포넌트 + Rust 메뉴) | Phase D 이후 별도 |
| 2 | `as` 타입 단언 전체 검토 (695건) | 점진적 개선 |
| 3 | 키바인딩 Rust 메뉴 accelerator 동기화 | Phase D 이후 별도 |
| 4 | 인라인 `style={{}}` → CSS 클래스 전환 (183건) | 점진적 개선 |
| 5 | 스토어 간 직접 import → subscribe/event 패턴 전환 | Phase D 이후 별도 |

---

## 수정 완료 이력

| 날짜 | 항목 | 커밋 |
|------|------|------|
| 2026-03-14 | pandoc run_custom_export 커맨드 인젝션 (CRITICAL) | `1622bd2` |
| 2026-03-14 | journal-search.ts highlightSearchMatch XSS (HIGH) | `1622bd2` |
| 2026-03-14 | journal-memories.ts renderSimpleMarkdown XSS (HIGH) | `1622bd2` |
| 2026-03-14 | use-app-startup.ts restoreLastFile 조건 오타 (HIGH) | `1622bd2` |
| 2026-03-14 | use-tab-switching.ts setIsParsing(false) 누락 (HIGH) | `1622bd2` |
| 2026-03-14 | use-source-mode.ts double RAF race condition (HIGH) | `1622bd2` |
| 2026-03-14 | wikilink-view.tsx CSS 클래스 공백 누락 (CSS) | `1622bd2` |
| 2026-03-14 | settings-store.ts migration 순서 역전 (MEDIUM) | `1622bd2` |
| 2026-03-14 | gemini.rs API 키 URL 쿼리 파라미터 노출 (HIGH) → x-goog-api-key 헤더로 전환 | `7df7646` |
| 2026-03-14 | snapshot/io.rs restore_files 경로 순회 취약점 (HIGH) → is_safe_relative_path 검증 추가 | `7df7646` |
| 2026-03-14 | fs/mod.rs write_file 동시 쓰기 tmp 파일 충돌 (ARCH) → 고유 uuid tmp 경로 사용 | `7df7646` |
| 2026-03-14 | fs_cmd.rs write_binary_file 동일 tmp 충돌 (ARCH) → uuid tmp 경로 통일 | `92c0378` |
| 2026-03-14 | gemini.rs list_models 헤더 삽입 패닉 가능성 + 에러 타입 불일치 (MEDIUM) | `4fac079` |
| 2026-03-14 | llm/mod.rs stale comment (query params → x-goog-api-key header) | `4fac079` |
