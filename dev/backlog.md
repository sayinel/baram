# Baram — 기술 부채 & 백로그

> 최종 업데이트: 2026-07-09 (보안 항목 트리아지 + 안전 4건 수정)
> 이 문서는 즉시 구현하지 않기로 결정한 항목들을 추적한다.
> 기능 로드맵은 `dev/next-steps.md`, 리팩토링 계획은 `.omc/plans/refactoring-plan.md` 참고.

---

## 보안 (Security)

> 2026-07-09 트리아지: 아래 8개 항목을 현재 코드 기준으로 재검증하고 모두 해소했다.
> 7건 수정(#8·#2·#7·#5·#1·#3·#6) + 1건 이미 수정됨(#4 Mermaid). 심각도는 실제(로컬 IPC/ XSS 선행조건 등)를 반영해 재평가.

### ✅ FIXED (`d09e5a1`, MEDIUM 실제) — API 키 IPC 전달 방식

- **위치**: `src-tauri/src/commands/llm_cmd.rs` (`llm_complete`), `src/ipc/llm.ts` + 호출처 7곳
- **원인**: `llm_complete`가 `api_key`를 IPC 파라미터로 수신 → AI 동작마다 키가 prompt/문서 내용과 함께 IPC 버스를 통과 (로컬 프로세스, 원격 악용 불가하나 방어심화 위반)
- **수정**: 키는 이미 OS keyring에 저장되므로 백엔드가 `keyring_cmd::get_provider_api_key(provider)`로 직접 조회(`baram-{provider}-api-key`, ollama는 keyless). `api_key`를 `llm_complete`·`ipc/llm.ts`·`LLMCompleteInput`·`ipc-registry.json`에서 제거하고 7개 호출처 인자 제거. 테스트 갱신
- **비고**: `llm_list_models`는 optional key 유지 — 설정에서 **저장 전 키 검증**이 정당한 용도이며 문서 내용을 싣지 않음

### ✅ FIXED (`cac04cc`, MEDIUM 실제) — Vault Root Bypass on Cold Start

- **위치**: `src-tauri/src/commands/fs_cmd.rs` (`check_vault`)
- **원인**: §88 이후 confinement는 `ContextManager.validate_path_any` + `VaultRootState` fallback 2단이나, **둘 다 미등록(콜드스타트)이면 `Ok(())`**로 빠져 임의 절대경로 허용
- **수정**: fallback 로직을 `vault_fallback_decision()`으로 추출, 컨텍스트/루트 둘 다 없으면 **deny-by-default**. 정상 오픈 흐름(`openFolder`→`setVaultRoot`, `ensureFileContext`→`add_context`)은 FS IPC 전에 등록하므로 무영향. 단위 테스트 추가

### ✅ FIXED (`5e042c1`, MEDIUM) — assetProtocol scope 과다

- **위치**: `src-tauri/tauri.conf.json`, `context_cmd.rs` (`add_context`), `fs_cmd.rs` (`set_vault_root`)
- **원인**: 정적 scope `["$APPDATA/**", "$DOCUMENT/**", "$DOWNLOAD/**"]` → XSS 시 Documents/Downloads 전체를 `asset://`로 읽기 가능
- **수정**: 정적 scope를 `$APPDATA/**`(플러그인)만으로 축소하고, **열린 컨텍스트 위치를 런타임 등록**(`add_context`/`set_vault_root` 초크포인트 → vault/folder는 `allow_directory`, 단일 파일은 `allow_file`). 보안 강화 + vault가 어디 있든 이미지 렌더 되도록 잠재 제약도 해소
- **비고**: 독립 외부 파일 컨텍스트는 파일 자체만 허용 → 그 옆 이미지는 asset:// 불가(폴더로 열면 렌더). 런타임 등록이라 단위 테스트 불가 → GUI 확인 필요

### ✅ ALREADY FIXED (조치 불요) — Mermaid SVG DOMPurify

- **위치**: `src/extensions/nodes/mermaid-block-view.tsx` → `sanitizeMermaidSvg()` → `sanitizeSvg()`(DOMPurify SVG 프로필)
- **현황**: 4개 `dangerouslySetInnerHTML` 모두 sanitize 경유 + `securityLevel: "antiscript"`. 전용 테스트 `src/extensions/__tests__/mermaid-sanitize.test.ts` 존재. backlog 작성 이후 수정됨

### ✅ FIXED (`a3b6ce7`, LOW) — resolveImageSrcs 정규식 파싱 취약

- **위치**: `src/components/journal/utils.ts`
- **수정**: double-quote 전용 정규식 → `DOMParser` + `setAttribute` 기반 재작성. 단일따옴표/속성순서 우회 불가. 단위 테스트 추가

### ✅ FIXED (`5e042c1`, LOW) — CSP connect-src localhost:\* 과다 허용

- **위치**: `src-tauri/tauri.conf.json` (CSP connect-src)
- **원인**: `http://localhost:*` / `https://localhost:*` 와일드카드 → XSS 시 로컬 임의 포트/서비스 접근 가능
- **수정**: Ollama 기본값 `http://localhost:11434` + `http://127.0.0.1:11434`로 제한
- **비고**: 커스텀 포트 Ollama 사용자는 CSP 위반됨(문서화 대상). 원격/LAN Ollama는 기존에도 미허용이었음

### ✅ FIXED (`970e3bb`, LOW, 방어심화) — validate_path traversal 미차단

- **위치**: `src-tauri/src/fs/mod.rs` (`validate_path`)
- **현황**: 실제 경계는 `check_vault`가 이미 canonicalize+범위검증. `validate_path`는 1차 sanity 체크
- **수정**: `validate_path`에 `..` 세그먼트 거부 추가(방어심화). vault 미제약 호출처(export 커맨드)까지 커버. 단위 테스트 추가

---

## AI 기능 (AI Features)

### 🟡 MEDIUM — block-ai-diff 동시 호출 시 waitForDecision hung promise

- **위치**: `src/utils/block-ai-diff.ts:192`, `createDiffPanel()`
- **문제**: 두 번째 `executeBlockAIWithDiff` 호출이 `document.querySelector(".block-ai-diff-overlay")?.remove()`로 기존 패널의 DOM을 직접 제거 → 첫 번째 `await panel.waitForDecision()`이 영원히 미해결 → `cleanupStream()` 미호출, `keydown` 이벤트 리스너 영구 누출
- **조건**: 동일 블록에 빠르게 두 번 AI 명령 실행하는 경우(드문 엣지케이스)
- **권장 수정**: `createDiffPanel` 진입 시 모듈 레벨에서 기존 패널의 `resolveDecision`을 `"reject"`로 먼저 resolve 후 DOM 제거
  ```typescript
  let activeResolve: ((d: "accept" | "reject") => void) | null = null;
  // 패널 생성 시: activeResolve?.("reject"); activeResolve = null;
  // waitForDecision 시: activeResolve = resolve;
  ```
- **재검토 조건**: 블록 AI 기능 UX 개선 시

### 🟠 HIGH (PM 결정 필요) — AgentPanel `acceptAll()` 파일 적용 미구현

- **위치**: `src/stores/agent-store.ts:133`, `src/components/ai/AgentPanel.tsx:40`
- **문제**: `acceptAll()` 호출 시 results에 `accepted: true` 마킹 후 idle로 리셋되지만, 실제 파일에 변경사항을 적용하는 코드가 없음. 수락 신호가 소비되지 않고 사라짐
- **현황**: `handleAcceptAll`의 원래 주석도 "future: apply changes to files"로 명시되어 있음
- **PM 결정 사항**: Agent Mode에서 diff를 수락하면 실제로 어떤 동작을 해야 하는지 정의 필요
  - 옵션 A: `applyBlockAIResult`를 재사용하여 accepted results를 즉시 에디터에 적용
  - 옵션 B: 별도 "Apply to Files" 워크플로우 (파일 쓰기 포함)
  - 옵션 C: Agent Mode 자체가 이미 실행 중 파일을 수정하므로 diff는 확인용(review-only)
- **재검토 조건**: Agent Mode 기능 완성 단계에서 PM 결정 후 구현

---

## UI/UX (UI/UX Bugs)

### 🟡 MEDIUM — CommandPalette `journal:open-today` 동작 불일치

- **위치**: `src/components/command/CommandPalette.tsx`, `src/hooks/use-keybinding-actions.ts`
- **문제**: 커맨드 레이블은 "오늘 저널 열기"이나 실제 동작은 `applyPreset("journal")` (레이아웃 프리셋만 적용). 저널이 설정되지 않거나 루트 폴더가 없으면 파일이 열리지 않고 레이아웃만 변경됨
- **권장 수정**: `applyPreset` 대신 저널 파일 서비스를 직접 호출하여 오늘 날짜의 저널 파일을 실제로 열도록 구현
- **기대 동작**: 커맨드 실행 시 `journal/YYYY-MM-DD.md` 파일을 생성 후 에디터에서 활성화
- **재검토 조건**: 저널 기능 개선 시

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

### ✅ FIXED (`78a40ff`, MEDIUM) — MarkdownRenderer URL scheme 미검증

- **위치**: `src/components/ai/MarkdownRenderer.tsx` (링크/이미지 mdast 노드)
- **문제**: AI 응답 마크다운의 링크/이미지 URL scheme 미검증 → `javascript:` 링크 클릭 시 Tauri 웹뷰에서 실행(IPC 브리지 접근 = RCE). raw HTML 노드는 이미 DOMPurify 처리되나 파싱된 link/image 노드는 우회
- **수정**: `markdown-url.ts`의 `safeLinkHref`/`safeImageSrc` 허용목록 헬퍼(http(s)/mailto/tel/앵커/상대경로, 이미지는 `data:image/*` 허용)를 link/image 렌더러에 적용. 단위 테스트 추가

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

### 🟡 MEDIUM — search\_cmd.rs max\_results 상한 없음

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

## 성능 (Performance)

### 🟡 MEDIUM — UIStore bare selector 최적화

- **위치**: `src/components/sidebar/ActivityBar.tsx`, `src/components/command/CommandPalette.tsx`, `src/components/journal/QuickCaptureDialog.tsx`
- **문제**: ActivityBar, CommandPalette, QuickCaptureDialog에서 `useUIStore()` 전체 구독 중. UIState 변경 시 불필요한 re-render 발생. UIState의 9개 필드 중 일부만 소비하나 전체 구독으로 인해 렌더링 성능 저하
- **권장 수정**: `useShallow` 셀렉터 또는 명시적 필드 선택으로 세분화. ActivityBar 우선 (persistent layout, 9개 필드 소비)
  ```typescript
  // Before
  const { sidebarOpen, activePanel, ... } = useUIStore();

  // After
  const { sidebarOpen, activePanel } = useUIStore(
    useShallow((state) => ({ sidebarOpen: state.sidebarOpen, activePanel: state.activePanel }))
  );
  ```
- **성능 영향**: UIState 변경(예: 패널 전환) 시 ActivityBar 불필요 리렌더 방지 → 타이핑 레이턴시 개선
- **재검토 조건**: UI 반응성 개선 시

### 🟡 MEDIUM — ReferenceAutocomplete 트리 워크 분리

- **위치**: `src/components/editor/ReferenceAutocomplete.tsx`
- **문제**: `flattenFiles()`/`flattenDirs()`가 query 변경마다 재실행. fileTree 의존 memo와 query 의존 memo로 분리 필요. n>2000 파일 워크스페이스에서 keystroke 레이턴시 영향 (1000ms+ 지연 관찰 가능)
- **권장 수정**: 두 단계로 분리
  ```typescript
  // Stage 1: fileTree → flatList (변경 시에만)
  const flatList = useMemo(() => flattenFiles(fileTree), [fileTree]);

  // Stage 2: flatList + query → filtered (query 변경 시에만)
  const filtered = useMemo(() => flatList.filter(f => f.name.includes(query)), [flatList, query]);
  ```
- **성능 영향**: 대규모 워크스페이스에서 keystroke 레이턴시 50-200ms 개선
- **재검토 조건**: autocomplete 성능 튜닝 시 또는 워크스페이스 크기 증가 시

---

## 추후 티켓 (리팩토링 범위 외)

> 리팩토링 계획(`.omc/plans/refactoring-plan.md`)과 연계된 항목들

| # | 항목                                      | 연관 Phase      |
| - | --------------------------------------- | ------------- |
| 1 | i18n 전체 적용 (74 컴포넌트 + Rust 메뉴)          | Phase D 이후 별도 |
| 2 | `as` 타입 단언 전체 검토 (695건)                 | 점진적 개선        |
| 3 | 키바인딩 Rust 메뉴 accelerator 동기화            | Phase D 이후 별도 |
| 4 | 인라인 `style={{}}` → CSS 클래스 전환 (183건)    | 점진적 개선        |
| 5 | 스토어 간 직접 import → subscribe/event 패턴 전환 | Phase D 이후 별도 |

---

## 수정 완료 이력

| 날짜         | 항목                                                                              | 커밋        |
| ---------- | ------------------------------------------------------------------------------- | --------- |
| 2026-03-14 | pandoc run\_custom\_export 커맨드 인젝션 (CRITICAL)                                   | `1622bd2` |
| 2026-03-14 | journal-search.ts highlightSearchMatch XSS (HIGH)                               | `1622bd2` |
| 2026-03-14 | journal-memories.ts renderSimpleMarkdown XSS (HIGH)                             | `1622bd2` |
| 2026-03-14 | use-app-startup.ts restoreLastFile 조건 오타 (HIGH)                                 | `1622bd2` |
| 2026-03-14 | use-tab-switching.ts setIsParsing(false) 누락 (HIGH)                              | `1622bd2` |
| 2026-03-14 | use-source-mode.ts double RAF race condition (HIGH)                             | `1622bd2` |
| 2026-03-14 | wikilink-view\.tsx CSS 클래스 공백 누락 (CSS)                                          | `1622bd2` |
| 2026-03-14 | settings-store.ts migration 순서 역전 (MEDIUM)                                      | `1622bd2` |
| 2026-03-14 | gemini.rs API 키 URL 쿼리 파라미터 노출 (HIGH) → x-goog-api-key 헤더로 전환                   | `7df7646` |
| 2026-03-14 | snapshot/io.rs restore\_files 경로 순회 취약점 (HIGH) → is\_safe\_relative\_path 검증 추가 | `7df7646` |
| 2026-03-14 | fs/mod.rs write\_file 동시 쓰기 tmp 파일 충돌 (ARCH) → 고유 uuid tmp 경로 사용                | `7df7646` |
| 2026-03-14 | fs\_cmd.rs write\_binary\_file 동일 tmp 충돌 (ARCH) → uuid tmp 경로 통일                | `92c0378` |
| 2026-03-14 | gemini.rs list\_models 헤더 삽입 패닉 가능성 + 에러 타입 불일치 (MEDIUM)                        | `4fac079` |
| 2026-03-14 | llm/mod.rs stale comment (query params → x-goog-api-key header)                 | `4fac079` |
| 2026-07-09 | MarkdownRenderer AI 채팅 링크/이미지 URL scheme 검증 (MEDIUM)                          | `78a40ff` |
| 2026-07-09 | 콜드스타트 vault 우회 — check_vault deny-by-default (MEDIUM)                          | `cac04cc` |
| 2026-07-09 | validate_path `..` traversal 거부 (LOW, 방어심화)                                    | `970e3bb` |
| 2026-07-09 | resolveImageSrcs 정규식 → DOMParser 파싱 (LOW)                                       | `a3b6ce7` |
| 2026-07-09 | LLM API 키 IPC 제거 — 백엔드 keyring 조회 (MEDIUM)                                     | `d09e5a1` |
| 2026-07-09 | assetProtocol scope 축소 + 런타임 동적 등록 (MEDIUM)                                   | `5e042c1` |
| 2026-07-09 | CSP connect-src localhost 와일드카드 → 기본 포트 제한 (LOW)                            | `5e042c1` |
