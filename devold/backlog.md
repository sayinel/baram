# Baram — 기술 부채 & 백로그

> 최종 업데이트: 2026-08-09 (백엔드 로거 설치 — `log::*` no-op 해소. 그 전날 전체 트리아지는 아래 "2026-08-08 검증 결과" 참조)
> 이 문서는 즉시 구현하지 않기로 결정한 항목들을 추적한다.
> 기능 로드맵은 `dev/next-steps.md`, 리팩토링 계획은 `.omc/plans/refactoring-plan.md` 참고.

---

## 2026-08-08 전체 트리아지 — 코드로 검증한 결과

> 553줄 전체를 읽고 상단에 P0/P1로 남아 있던 항목들을 **코드로 확인**했다. **6건이 이미 해소돼 있었다** — 이 문서가 "다음 후보"로 가리키던 최상위 P1이 그중 하나였다. 표시만 보고 작업을 고르면 헛일한다는 뜻이라 검증 결과를 여기 남긴다.
>
> **표시가 틀렸던 것 (해당 항목에 각각 반영함)**:
>
> | 항목 | 옛 표시 | 코드 실제 |
> | - | - | - |
> | 플러그인 다운로드 origin 미강제 | 🔴 P1 "다음 후보" | ✅ `registry_base`+`is_within_registry`+`redirect_within_registry` 배선 (`plugin/mod.rs:816-834`) |
> | floor가 live에 뒤처지면 아무것도 실패 안 함 | 🔴 무장 전 필수 | ✅ `revocation-publish.yml:374,391` 양방향 게이트 + MAX_LAG |
> | `formatError` 소비처 미연결 | 🟡 MEDIUM | ✅ 함수 자체가 삭제됨 — 항목 소멸 |
> | `use-file-watcher` dotfile 과필터 | 🟡 MEDIUM | ✅ 디렉터리 세그먼트에만 적용 (`shouldSkip`, `.notes.md` 정상 감시) |
> | UIStore bare selector 3곳 | 🟡 MEDIUM | 부분 — ActivityBar는 `useUIStore` 미사용, CommandPalette는 셀렉터 사용. **`QuickCaptureDialog` 1곳만 남음** |
> | accent 텍스트 193곳 | 193 | 실측 **176** |
>
> **미검증으로 남긴 구역** (우선순위가 낮아 코드 확인을 하지 않았다 — 아래 항목들의 상태는 작성 시점 그대로): §71 retention thinning, 파일 트리 PR1~PR5 이월분, 파이프라인 C6.

---

## 보안 (Security)

> 2026-07-09 트리아지: 아래 8개 항목을 현재 코드 기준으로 재검증하고 모두 해소했다.
> 7건 수정(#8·#2·#7·#5·#1·#3·#6) + 1건 이미 수정됨(#4 Mermaid). 심각도는 실제(로컬 IPC/ XSS 선행조건 등)를 반영해 재평가.

### ⏸️ DISMISSED (transitive, 비도달) — Dependabot rand 0.7.3 / glib 0.18.5

> 2026-07-15: 두 open Dependabot alert를 `tolerable_risk`로 dismiss. 로컬 패치가 **불가능**(패치 버전이 Tauri가 고정한 상위 의존성의 semver 요구와 충돌)하고 둘 다 **런타임 비도달**임을 증거 기반으로 확인. 향후 Tauri/wry 업스트림 bump 시 자연 해소.

- **#42 rand 0.7.3** (GHSA-cq8v-f236-94qc, low): 빌드타임 전용 — `rand 0.7.3 ← phf_generator 0.8 ← phf_codegen [build-dependencies] ← selectors ← kuchikiki ← tauri-utils`. 런타임 바이너리 미포함(런타임 `rand`은 0.9.4로 이미 fixed). `phf_generator 0.8`이 `rand ^0.7`를 강제 → cargo resolver가 0.8.6 거부.
- **#11 glib 0.18.5** (GHSA-wrw7-89jp-8q8g, medium): Linux GTK/WebKit 스택 전용 — macOS 호스트 `cargo tree`엔 부재, `--target all`에서만 `gtk 0.18 → webkit2gtk/wry 0.55 → tauri-runtime-wry`. `VariantStrIter` 비건전성은 앱에서 GVariant 문자열 배열을 직접 순회하지 않아 도달 경로 없음. `gtk 0.18.2`가 `glib ^0.18`을 강제 → 0.20.0 거부.
- **재확인 명령**: `cargo tree -i rand@0.7.3 -e no-dev` · `cargo tree -i glib@0.18.5 --target all` · `cargo update -p <pkg> --precise <patched> --dry-run` (둘 다 resolver 에러로 실패)

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

## 테스트 인프라 (Test infra)

### 🔴 P1 (CI 간헐 빨간불, 2026-08-09 발견) — `ThemeEditor.test.tsx`가 teardown 후 도착하는 동적 import를 남긴다

- **증상**: vitest가 **4,407개 전부 통과**하고도 잡이 exit 1. `Errors 1 error` — `EnvironmentTeardownError: Cannot load '/src/utils/recent-open.ts' imported from src/ipc/recent-menu.ts after the environment was torn down`. PR #387의 `test` 잡에서 처음 관측(재실행 시 통과 = **경합**)
- **체인은 추측이 아니라 에러가 직접 적어준다**: `ThemeEditor.test.tsx` → `hooks/use-settings-effects.ts` → `ipc/recent-menu.ts:14` → `utils/recent-open.ts`
- **원인**: `use-settings-effects.ts:102,111`이 **fire-and-forget 동적 import** 두 개를 이펙트에서 쏜다 — `import("../ipc/menu-locale").then(...)`, `import("../ipc/recent-menu").then(...)`. await도 cleanup도 없다. 테스트가 모듈 그래프 해석보다 먼저 끝나면 로드가 teardown 뒤에 도착한다
- **누가 들여왔나**: 동적 import 자체는 `ceba4b0d feat(§82)`(네이티브 Open Recent 동기화). 이 테스트가 그 경로를 타게 된 것은 **`5d22d484` = PR #383**(theme editor cascade-only restore)이 `useSettingsEffects`를 컴포넌트 테스트에 물린 시점부터. 즉 main에 잠복 중이고 **어느 PR이든 CI가 경합에서 지면 터진다** — #387은 지나가던 사람이었다
- ‼️**[[replacing-a-call-check-what-else-it-did]]의 세 번째 사례**: 같은 PR에서 "이 훅을 부르면 이름 그대로의 일 외에 무엇이 더 일어나는가"를 안 본 결과가 또 나왔다. 여기서 더 일어난 것은 **동적 import 두 개**다
- **후보 수정 2개**:
  - (a) 테스트에서 `vi.mock("../../../ipc/recent-menu")` + `menu-locale` — 동적 import가 mock 레지스트리에서 해소되어 로더에 닿지 않는다. ThemeEditor 테스트의 대상은 네이티브 메뉴가 아니므로 범위상 옳다. ‼️단 로컬에서 재현되지 않으므로(경합을 이긴다) 수정 검증은 "구조적으로 불가능해졌다"는 논증이지 실측이 아니다
  - (b) `use-settings-effects.ts`에 unmount 가드 — 이건 **제품 쪽 진짜 결함**(언마운트 후 `syncRecentMenu()`가 도는 것)을 고치지만 **이 CI 오류는 못 고친다**: 이미 출발한 `import()`를 취소할 수는 없다. 즉 (b)만으로는 빨간불이 남는다
  - 정적 import로 바꾸는 방안은 초기 번들에 Tauri IPC를 끌어들이는 제품 결정이라 별개
- **왜 P1인가**: 테스트가 전부 초록인데 잡이 빨간불이면 원인 파악에 시간이 들고, 무엇보다 **"재실행하면 통과"가 습관이 되면 진짜 실패도 재실행으로 넘긴다**
- **✅ FIXED (2026-08-09, `fix/settings-effects-menu-sync-after-unmount`)** — (a)+(b) 둘 다. (a) `ThemeEditor.test.tsx`가 두 ipc 모듈을 `vi.mock`해서 동적 import가 로더에 닿지 않는다 + **mock이 실제로 도달했음을 단정하는 테스트**를 함께 넣었다(경로 드리프트 가드 — 훅이 import 경로를 바꾸면 `vi.mock`이 조용히 아무것도 안 덮게 되고 flake가 돌아온다). (b) 두 이펙트에 `active` 플래그 + cleanup — 언마운트 후 `syncRecentMenu()`가 도는 제품 결함을 닫고, 덤으로 dep 변경보다 늦게 도착한 오래된 resolution이 새 동기화를 덮어쓰는 것도 막는다. 새 테스트 `use-settings-effects-menu-sync.test.tsx`는 **쌍으로** 단정한다(mounted면 호출됨 / unmount 후면 호출 안 됨) — 음성만 단정하면 "기능을 아예 끈" 구현도 통과하기 때문이고, 실제로 `if (true) return` 뮤테이션이 mounted 쪽을 죽인다. 뮤테이션 **6/6 kill**(가드 2곳 제거·cleanup 제거·기능 비활성화·mock 2개 제거). ‼️**정직한 한계**: 로컬에서 flake가 재현되지 않으므로(경합을 이긴다) 검증은 "구조적으로 불가능해졌다 + mock 도달 실측"이고 flake 자체의 before/after 실측이 아니다. 전체 스위트 4,410 passed, `Errors` 줄 소멸
- **⬜ 같은 모양이 3곳 더 있다 (P2, 이번 범위 밖 — 열거만)**: fire-and-forget `import(...).then(...)`은 고친 2곳 외에도 `stores/settings/appearance-settings.ts:90`(‼️**같은 `menu-locale` 모듈**), `stores/editor/editor.ts:101`·`:157`에 있다. 셋 다 스토어 액션이라 언마운트 개념이 없어 (b)식 가드가 그대로 맞지는 않지만, **그 액션을 부르고 끝나는 테스트는 같은 teardown 오류를 낼 수 있다**. 지금 CI를 깨뜨리고 있다는 증거는 없어 손대지 않았다. `await import(...)`형(`stores/file/file.ts`, `JournalTab.tsx`, `ContextTabBar.tsx`, `wikilink-suggest.ts`)은 호출자가 await하므로 완료 시점이 통제된다 — 단 호출자 자신이 await되지 않으면 같은 문제. `Sidebar`를 렌더하는 테스트가 6개 있고 `React.lazy` 체인을 물고 있으므로 다음 후보는 그쪽

## UI/UX (UI/UX Bugs)

### ❌ 항목 자체가 STALE (2026-08-08) — CommandPalette `journal:open-today`는 이미 오늘 파일을 연다

> **이 항목을 근거로 고쳤다가 회귀를 만들었고, 코드 리뷰가 잡아 되돌렸다.** 기록을 남기는 이유: 백로그의 전제가 틀렸다는 것을 발견하는 데 리뷰 한 번이 필요했다는 사실이 이 문서에 대한 정보다.
>
> **전제 오류**: `applyPreset("journal")`은 레이아웃만 적용하지 않는다. `stores/file/workspace.ts:180-198`이 `ensureJournalContext(resolvedDir)`를 호출한 뒤 `getSpace("journal").newFileFlow()` → `spaces/journal-space.ts:33`의 `ensureJournalFile` + `openFileInTab`을 실행한다 — 즉 **오늘 파일을 열고, 그 전에 저널 디렉터리를 Rust ContextManager에 등록한다**(§85 M2b에서 추가됨. 항목 작성 시점 이후로 보인다)
>
> **시도한 수정이 왜 회귀였나**: `getAction("journal.openToday")`로 바꾸면 등록 단계가 사라진다. `resolveJournalDir`은 **절대경로만** 받으므로(`journal.ts:363`) 저널 디렉터리가 열린 vault 밖일 수 있고, 그때 `check_vault`가 `readFile`을 거부 → `ensureJournalFile`이 그 오류를 "파일 없음"으로 오독(`journal-file-service.ts:64`) → `createDir`도 거부 → 액션 자신의 `catch`가 삼킨다 = **조용한 무동작**. 덤으로 잃는 것: 저널 컨텍스트 활성화(→ 탭이 `editor.ts:122-124`에서 **쓰던 vault의 contextId**를 물려받아, 그 vault를 닫으면 저널 탭이 같이 닫힌다)와 캘린더/Memories 레이아웃
>
> **가드 추가** `CommandPalette.journal.test.tsx`: 커맨드가 프리셋으로 라우팅됨을 단정하고(뮤테이션 = 액션으로 재배선 → 빨간불), `journal.openToday`를 등록해 둔 채 **호출되지 않음**까지 단정. 코드 쪽에도 "‼️ Do NOT simplify" 주석 + 이유

**여기서 새로 발견한 진짜 결함 → ✅ 둘 다 FIXED (2026-08-08, `290cc039` + `43f516e2`)**:

- **✅ FIXED (`290cc039`) — 컨텍스트 등록을 서비스로 끌어올림**: `ensureJournalFile`이 FS 호출 **전에** `ensureJournalContext(resolved)`를 호출한다. 호출처별로 고치지 않은 이유가 요점 — 한 곳만 고치면 나머지 3곳이 보호받는 것처럼 보인다. 등록 실패는 로그만 남기고 진행해서, FS 호출이 **진짜 오류**를 내도록 둔다(컨텍스트 오류로 가리지 않음). 테스트는 **순서**를 단정한다(첫 FS 호출 뒤 등록은 고친 게 아니므로) — 뮤테이션 2종 kill: 호출 삭제, 그리고 read 뒤로 이동. ‼️의도적으로 수용한 부작용: `ensureSpaceContext`가 활성화까지 하므로 캘린더·일자 이동·단축키에서 저널 파일을 열면 **활성 컨텍스트와 파일트리가 저널로 전환**된다. 프리셋이 이미 그렇게 동작했고 탭 contextId 오귀속(위 항목)도 이걸로 해소된다
- **✅ FIXED (`43f516e2`) — 미설정 저널 피드백**: `space.journal.disabled`/`.noDirectory`(en·ko) 추가하고 **두 경로**(프리셋 가드 + `journal.openToday`)에서 같은 문구로 보고. 단축키의 catch도 토스트로 표면화(‼️`logger.error`만 있었고 **백엔드 로거가 no-op**이라 사용자도 개발자도 못 봤다). 동작 변경: 미설정 프리셋이 더는 레이아웃을 바꾸지 않는다(zettel과 동일). `journal-scope.test.ts`가 async 자동열기를 피하려고 저널을 껐던 것을 설정 갖춘 상태로 교체
- **‼️ 위 등록 수정의 리뷰가 HIGH 4건을 잡았고 전부 코드로 검증해 `97d8ccac`로 수정**: (1) `ensureJournalContext`는 **활성화까지** 하는데 `file.ts`의 구독은 `rootPath`만 동기화한다("no listDir" — zettel은 그래서 `switchContext`로 보정한다) → wikilink로 저널을 열면 rootPath는 저널, 트리는 이전 vault가 되어 트리의 "새 파일"이 **저널 디렉터리에 파일을 만든다**. `{ activate: false }` 옵션을 추가하고 서비스는 등록만 한다. (2) Rust `add`는 canonical path로 dedup해 **기존 항목을 반환**하는데 스토어가 그걸 무조건 append했다 → 같은 id 중복 + 영속 배열이 열 때마다 증가(이전엔 스페이스 진입당 1회, 등록 이동으로 캘린더 클릭·Alt화살표당 1회로 확대). `addContext`가 dedup 응답을 감지해 기존 항목을 반환. (3) `CalendarPanel.openPeriodicNote`는 서비스를 안 거치고 직접 FS를 호출해 **주간/월간/연간 노트는 여전히 조용히 실패**했고(`openWeeklyNote`가 promise를 버려 unhandled rejection), 고친 호출처와 같은 파일에 있어 보호받는 것처럼 보였다 — 정확히 이전 커밋이 막겠다던 실패 양상. 등록 + `.catch` 추가. (4) 단축키 오류 토스트 `String(err)`가 **미번역 절대경로를 화면에 노출** → `space.journal.openFailed` 키 + raw는 로그로. 뮤테이션 4/4 kill
- **🟡 P2 남음 — "vault 밖 + 아직 없는 디렉터리" 조합만 조용한 무동작**: Rust `ContextManager::add`가 `!canonical.exists()`면 거부하므로(`manager.rs:57-60`) 등록이 실패하고, 등록 없이는 만들 수 없고 만들려면 등록이 필요한 닫힌 고리가 된다. ‼️**범위는 그 조합 하나뿐이다**(2026-08-08 코드 확인): `validate_path_any`는 Vault/Folder 컨텍스트에 대해 `canonical_path.starts_with(root)`로 판정하고(`manager.rs:239`), `resolve_canonical`은 **존재하지 않는 경로도 최근접 기존 상위까지 올라가 해석**한다(`manager.rs:327-356`) → 저널 디렉터리가 열린 vault **안**이면 등록이 실패해도 `createDir`가 vault 루트로 허용되어 정상 생성되고, 다음 열기에서는 디렉터리가 존재하므로 등록까지 성공한다(자기치유). 삭제·이름변경·미마운트 볼륨도 vault 안이면 같은 이유로 무해. 푸는 방법(최근접 기존 상위를 컨텍스트로 등록 / Rust에 create+register 커맨드)은 **어느 쪽이든 등록된 vault 밖에 디렉터리를 만들 권한을 새로 주는 것**이라 FS 신뢰 경계를 넓힌다 — **제품·보안 결정이 필요해 미착수**. 폴더 피커로 고른 정상 경로는 영향 없음
- **‼️ 2차 리뷰(97d8ccac 이전 상태를 봄)에서 살아남은 3건 → `8379ee00`로 수정**: (1) `logger.warn`이 `import.meta.env.DEV` 게이트라 서비스의 "logged and does not abort"가 **release에서 완전한 무음** — 이 브랜치가 백엔드 로거에 대해 편 논거를 두 커밋 뒤에 스스로 재현했다. `logger.error`로 교체 + `warn` 미사용까지 단정. (2) 저널 프리셋의 주석 "File tree switch handled by contextStore subscription"이 **거짓** — 구독은 `rootPath`만 맞추고(zettel은 그래서 `switchContext`로 보정) 트리는 이전 vault에 남아 Files 패널·신규 파일 경로·QuickSwitcher 상대경로·링크 인덱스가 서로 어긋난 상태가 컨텍스트 탭을 누를 때까지 지속. `newFileFlow` 뒤에 `switchContext(ctx.id)` 호출(오늘 항목이 로드되는 트리에 포함되도록). 레이아웃이 사이드바를 캘린더로 바꿔서 가려져 있었다. (3) 내부 `if (journalEnabled && resolvedDir)` 재검사는 죽은 코드 → 제거. 뮤테이션 3/3 kill
- **‼️ 테스트 정직성 지적도 함께 수정 (`8379ee00`)**: 토스트 테스트가 `t(key)`를 `t(key)`와 비교했는데 `t`는 키로 폴백하므로 **i18n 항목을 지워도 green**이었다(사용자에겐 `space.journal.disabled`가 그대로 보이는 상태) → 카탈로그 텍스트까지 단정. `journal-scope.test.ts`는 자동열기 체인이 자기 catch에서 죽는 동안 레이아웃만 검증하고 에러 로그 노이즈만 남겼다 → `ipc/context` 로컬 목 + `set_vault_root` 호출로 전환 자체를 단정 + 바꾼 저널 설정 복원(다음 테스트로 누출 중이었음). `ipc/context` 목이 6개 export 중 2개만 제공해 나머지가 `undefined`였고 새 try/catch가 TypeError를 삼킬 구조 → 6개 전부 제공
- **🔵 P3 남음 — Alt+←/→ 가드가 저널 밖 날짜 파일에서도 발동**: `use-keybinding-actions.ts:173`의 조건은 basename이 날짜면 되고 저널 하위인지 안 본다 — `/vault/meetings/2026-08-08.md`를 열어둔 채 Alt+←를 누르면 저널의 전날로 이동한다(기존 동작). 이제 저널 컨텍스트 생성까지 딸려오므로(활성화는 안 함) 저널 하위 판정을 추가할 가치가 생겼다
- **🔵 P3 남음 — startup 훅의 등록은 구조적으로 불필요**: `use-journal.ts:40`이 `if (!journalCtx) return`이고 `use-app-startup.ts:63-77`이 영속 컨텍스트를 재등록하므로, 이 경로가 서비스에 도달할 때 저널 디렉터리는 항상 이미 등록돼 있다. 지금은 무해한 no-op(활성화가 사라졌으므로)이지만, "5-of-6이 등록을 건너뛰었다"는 서술에서 이 한 곳은 원래 필요하지 않았다는 사실을 기록
- **🔵 P3 남음 — Alt+←/→ 와 캘린더 클릭은 아직 말이 없다**: 토스트는 프리셋과 단축키에만 들어갔다. 같은 침묵이 남은 두 경로에도 있으니 공용 저널 가드로 묶는 것이 자연스럽다(`use-keybinding-actions.ts`가 614줄로 규약 초과라, 저널 액션 추출과 함께 하면 그 가드의 집이 생긴다)
- **🔵 P3 남음 — `journal-scope.test.ts`가 stub 상대로 실제 async 체인을 돌린다**: 저널을 켜서 프리셋을 적용하면 자동 열기 체인이 `undefined`를 반환하는 mockInvoke를 상대로 돌아가고, 그 실패가 자기 catch에 삼켜진 상태로 초록불이다 — 단정 대상(레이아웃)과 무관한 이유로 통과한다는 지적. 자동 열기를 mock하거나 단정을 좁힐 것
- **🔵 P3 남음 — 두 팔레트 커맨드가 여전히 같은 프리셋으로 간다**: 이제 공유 등록이 서비스에 있으므로 "파일만 열고 레이아웃은 안 바꾸는" 커맨드를 만들 수 있다. 다만 그건 제품 결정(레이블이 레이아웃 전환을 함의하는가)이라 미착수
- **원문 (P2, 이력용) — `ensureJournalFile` 호출처 5곳 중 4곳이 컨텍스트를 등록하지 않는다**: `journal-space.ts`만 `ensureJournalContext`를 갖고, `use-keybinding-actions.ts:383`(**키보드 단축키**)·`CalendarPanel.tsx:202`·`use-journal.ts:51`·`use-navigation.ts:73`은 없다. vault 안 저널이면 vault root fallback이 덮어서 동작하므로 지금까지 안 드러났다 — vault **밖** 저널 디렉터리에서는 위와 같은 조용한 무동작. 한 곳만 고치면 나머지가 보호받는 것처럼 보이는 `emit_filter` 패턴(이 문서 §"레지스트리 검증 스크립트 입력 상한" 항목과 같은 이유)이 되므로 **공유 헬퍼로 4곳 일괄** 처리할 것. 자리: `journal-file-service.ts`(`ensureJournalFile` 진입부에서 등록)
- **🟡 P2 — 저널 미설정 시 피드백이 없다**: `journal.openToday`의 `if (!journalEnabled || !journalDirectory) return;`은 토스트도 로그도 없고, `executeCommand`가 액션 실행 **전에** 팔레트를 닫으므로 사용자가 보는 것은 "팔레트가 닫힘"뿐이다. zettel 프리셋은 같은 상황에서 `space.zettel.disabled`/`.noDirectory`를 토스트한다(`workspace.ts:123-142`) — 같은 패턴을 저널에 추가(`space.journal.*` 키 2개)
- **🔵 P3 — 두 팔레트 커맨드가 같은 프리셋으로 간다**: "Open Today's Journal"과 "화면구성: 저널"이 지금 동일 동작이다. 분리하려면 위 공유 헬퍼가 먼저 들어와야 한다(그러면 파일만 열고 레이아웃은 안 바꾸는 커맨드가 성립)

- **원문 (틀린 전제, 이력용)**: 레이블은 "오늘 저널 열기"이나 동작은 레이아웃 프리셋뿐 — 저널 미설정/루트 폴더 없음이면 아무 파일도 안 열림

---

## 아키텍처 (Architecture)

### 🔵 LOW — Plugin dev-loop follow-ups (Phase A 리뷰 이월)

- **배경**: 플러그인 개발 환경 Phase A (branch `feature/plugin-dev-environment`) 최종 리뷰에서 병합-비차단으로 이월된 항목. 설계: `dev/superpowers/specs/2026-07-13-plugin-dev-environment-design.md`
- **항목**:
  - `plugin_remove_dev_folder`가 asset-scope grant를 앱 재시작 전까지 회수하지 않음 (Tauri asset scope에 ergonomic revoke 부재; 목록 제거로 다음 시작 시 로드 안 됨 → 무해)
  - `normalize_dev_list`/멤버십 비교가 정확 문자열 일치 (경로 정규화 없음; OS 디렉토리 피커가 canonical 경로 제공하므로 현재 안전)
  - `initializePlugins()` 라이프사이클 테스트 부재 (dev-load reachability 회귀 가드용)
  - `devPlugins`의 `partialize` 제외를 보장하는 회귀 테스트 부재 (현재 구조적으로 보장됨)
  - `plugin-lifecycle.ts` docstring "200ms budget"이 dev-load 경로 미포함
- **재검토 조건**: Phase B~F 진행 중 해당 파일 수정 시 함께 처리

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

### ✅ RESOLVED (2026-08-08 확인) — formatError 유틸 소비처 미연결

- **현황**: 함수 자체가 삭제됐다 — `src/utils/format-error.ts`는 이제 `FormattedError` 타입과 `formatAIError`만 export하고, 코드베이스 전체에 `formatError` 식별자가 0건이다. 쓰이지 않는 export를 배선할 것인가라는 질문 자체가 소멸
- **원문**: `formatError(error: unknown): string`가 export되어 있으나 임포트하는 파일이 없음 (5개 파일이 `formatAIError`만 사용)

### ✅ RESOLVED (2026-07-17, MEDIUM) — GraphView cytoscape.use() 중복 호출 경고 가능성

- **위치**: `src/components/sidebar/GraphView.tsx` (구 :79)
- **문제**: `GraphView` 언마운트/재마운트 시 `cytoscape.use(fcose)` 재호출 — 버전에 따라 console 경고 발생 가능
- **해소**: §30.2 Graph View 개선(`feature/graph-view-improvements`)에서 fcose를 d3-force 연속 시뮬레이션으로 교체하며 `cytoscape-fcose` 의존성 자체를 제거 — `cytoscape.use()` 호출이 더 이상 존재하지 않음

### ✅ FIXED (`78a40ff`, MEDIUM) — MarkdownRenderer URL scheme 미검증

- **위치**: `src/components/ai/MarkdownRenderer.tsx` (링크/이미지 mdast 노드)
- **문제**: AI 응답 마크다운의 링크/이미지 URL scheme 미검증 → `javascript:` 링크 클릭 시 Tauri 웹뷰에서 실행(IPC 브리지 접근 = RCE). raw HTML 노드는 이미 DOMPurify 처리되나 파싱된 link/image 노드는 우회
- **수정**: `markdown-url.ts`의 `safeLinkHref`/`safeImageSrc` 허용목록 헬퍼(http(s)/mailto/tel/앵커/상대경로, 이미지는 `data:image/*` 허용)를 link/image 렌더러에 적용. 단위 테스트 추가

### ✅ RESOLVED (2026-08-08 확인) — use-file-watcher.ts shouldSkip 과도한 dotfile 필터

- **현황**: `shouldSkip`(`use-file-watcher.ts:250`)이 dotfile 필터를 **디렉터리 세그먼트에만** 적용한다 — `dirs.some(p => p.startsWith("."))` + `SKIP_DIRS`, 그리고 마지막 세그먼트는 `isDir=true`일 때만 필터. 즉 `.notes.md`·`.env.md`는 정상 감시되고 `.git/`·`.baram/`는 계속 제외된다. 주석이 세 경우를 명시
- **원문**: `.`으로 시작하는 모든 파일/디렉토리를 무시 → `.env.md`, `.notes.md`가 감시 대상에서 제외됨

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

### 🔵 LOW (대부분 해소, 2026-08-08 확인) — UIStore bare selector 최적화

- **남은 곳은 1개**: `src/components/journal/QuickCaptureDialog.tsx:24`가 `const { quickCaptureOpen, toggleQuickCapture } = useUIStore()`로 전체 구독 중. 2필드 소비이고 다이얼로그라 영향이 작다 — 규약(`CLAUDE.md`: bare call 금지) 준수 목적의 3줄 수정
- **해소된 곳**: **ActivityBar는 `useUIStore`를 아예 쓰지 않고**(PR #382 개편), CommandPalette(`:54`)는 이미 셀렉터를 쓴다. 원래 이 항목의 우선 대상이던 ActivityBar가 사라졌으므로 성능 근거도 함께 사라짐
- **원문 (성능 논거, 이력용)**: ActivityBar가 UIState 9개 필드를 전체 구독해 패널 전환마다 불필요 리렌더 → 타이핑 레이턴시 영향
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

## 2026-07-18 파일 트리 멀티 셀렉트 PR1 최종 리뷰 이월 항목

- **rename_file no-overwrite 시맨틱** (P1): `tokio::fs::rename`은 목적지가 존재하면 조용히 덮어씀. 배치 내 충돌은 PR1에서 skip 가드로 차단했으나, "타깃 폴더에 이미 같은 이름 존재" 케이스(단일 드래그 포함, pre-existing)는 여전히 덮어씀. Rust에서 destination-exists 시 실패하도록 변경 검토 — 공유 IPC 시맨틱 변경이므로 호출자 전수 감사 필요
- 멀티 이동 skipped 항목이 조용히 무시됨 — 충돌/무효 사유를 showAlert로 표면화하는 UX 검토
- 검색 결과 행의 Cmd/Shift 클릭 반쪽 배선: 접힌 폴더 내 결과는 visiblePaths에 없어 보이지 않는 선택 발생 + setSearchQuery("")로 결과가 닫힘 — plain-select 전용으로 제한하거나 결과 목록 자체 순서로 range 매핑
- `updateChildren` 재귀가 moveFileEntry/renameFileEntry에 중복 — 공유 `rewriteChildPaths(children, oldPath, newPath)` 헬퍼로 추출 (store 다음 수정 시)
- FileTree.tsx 527줄 (>500 가이드) — PR2(컨텍스트 메뉴 분리) 때 자연 분리 예정
- 파일 트리 다이얼로그 문자열 i18n 미적용 (pre-existing, showAlert 포함) — Rust 에러 메시지(한국어)와 영어 UI 혼재
- 일괄 삭제/이동 키보드 게이트가 e.metaKey 전용 (macOS-ism) — Win/Linux Ctrl 지원은 PR3 키보드 내비와 함께
- trash crate 5.2.6이 Windows 전용 windows 0.56 의존 트리 추가 — Windows 빌드 바이너리 크기(<15MB 목표) 모니터링
- 폴더 단독 선택은 드래그 시작 불가 (dir 행에 data-file-path 없음, pre-existing) — PR2/PR3에서 자연 해소 검토

## 2026-07-18 파일 트리 컨텍스트 메뉴 PR2 최종 리뷰 이월 항목

- 컨텍스트 메뉴 viewport 클램핑 (P2): 메뉴가 4→12행으로 3배 커져 사이드바 하단 우클릭 시 Delete 등 항목이 화면 밖. `top`을 `window.innerHeight - menuHeight`로 클램프하거나 커서 위로 flip
- MoveToFolderModal 무효 타겟 silent no-op: 소스 자신/자손/현재 부모 선택 시 planMultiMove가 skipped 처리하나 모달은 피드백 없이 닫힘 — PR1 백로그 "skipped 항목 UX 표면화"와 동일 클래스, 함께 해결 (skipped 표면화 + 모달에서 무효 타겟 비활성)
- 컨텍스트 메뉴/이동 다이얼로그 테스트 follow-up 번들: T1 폴더-케이스 4항목 assert, T4 nested collectSiblingNames, T6 exportFile outcome-check, T7 renameTab descendant-parity — 컴포넌트 레벨 gating 테스트로 통합
- `stripExt`가 상대 경로의 디렉토리 이름 내 dot에서 절단 가능 (예: `docs.v2/README` → `docs`): 마지막 `/` 뒤의 `.`만 확장자로 처리하도록 가드 (희귀 엣지)
- FileTree.tsx 565줄 (>500 가이드): handleContextMenuAction dispatch switch(~70줄)가 자연 추출 후보 — 별도 리팩토링 PR
- reveal `navigator.platform` deprecated: 다음 수정 시 UA/Tauri-os 체크로 교체
- 스펙 §4.3 텍스트 동기화: 복제 네이밍 `name copy.ext`→실제 `name-N.ext`(resolveNameConflict 재사용, plan 승인), 단축키 힌트 미렌더, PR 표 "12 actions"→11+버전히스토리 별도 PR

## 2026-07-19 파일 트리 git 뱃지 PR5 최종 리뷰 이월 항목

- **git refresh 매번 새 changes 배열 → 트리 재렌더 (P2, perf)**: `useGitStore.refresh`가 status 무변경이어도 항상 새 `changes` 배열을 set → `useGitBadges`의 useShallow가 매번 변경 판정 → hook 호스트 FileTree 전체 재렌더(FileTreeNode는 memo 아님). 자동저장 타이핑 중 ~1회/s, GitPanel 열림 시 5s 폴마다. 행 DOM이 가벼워 실측 영향은 작으나, `refresh`에서 deep-equal 시 이전 배열 참조 유지하면 저렴하게 제거 가능(공유 스토어라 GitPanel/CommandPalette도 수혜)
- **symlink 경유 vault → 뱃지 무동작 (P3, silent)**: libgit2가 `repo.workdir()`를 canonicalize → vault를 symlink(예: `/tmp/notes`→`/private/tmp`)로 열면 repoRoot=realpath ≠ rootPath → `buildGitBadgeIndex`의 startsWith 가드가 전부 필터 → 뱃지 0개. basic.rs 테스트 주석에 이미 인지됨. list_dir/rootPath도 realpath로 정규화하거나 repoRoot를 rootPath 기준으로 역산 검토
- **Unicode NFC/NFD 파일명 mismatch (P3, silent)**: 앱 외부(터미널/Finder)에서 만든 한글/악센트 파일명이 git index에는 NFC, readdir에는 NFD로 남으면 경로 키 불일치로 miss. toBadgeKey 정규화에 NFC normalize 추가 검토 (Windows 구분자 정규화와 동일 계열, 그건 PR5에서 해결됨 @997dd55)
- **뱃지 aria-label이 bare `<span>` (P3, a11y)**: role=generic span은 author-supplied accessible name을 AT에 안정적으로 노출 못함. `role="img"` 추가(한 줄) 또는 `title`로 hover 패리티 — 다음 PR 동승
- **dir-row 뱃지 자동 테스트 부재 (P3)**: `file-tree-git-badge.test.tsx`가 파일 행만 커버(isDir:false ×3), 폴더 중립 dot 분기는 GUI 체크리스트만. rollup 로직은 builder 유닛으로 커버되나 렌더 분기 테스트 1개(5줄) 추가 권장
- **플랫 검색 결과 리스트 뱃지 없음 (P3, 일관성)**: `FileTree.tsx`의 검색 결과 행은 FileTreeNode/FileTreeContext를 안 거쳐 렌더 → 뱃지 없음. 동일 `gitBadges.files.get(toBadgeKey(path))` lookup 재사용으로 배선 가능
- **git status in-flight de-dup 없음 (pre-existing, P3)**: GitPanel 5s 폴 + useGitBadges 훅이 동일 vaultPath로 `refresh` 동시 호출 가능, 스토어에 in-flight 가드 없어 out-of-order 해소 시 최근 status로 수렴(최악 1프레임 stale). 외부 터미널 git 작업(commit/checkout)은 file:* 이벤트 미발생이라 다음 파일 이벤트까지 stale

## 2026-07-19 파일 버전 히스토리 (§71) 최종 리뷰 이월 항목

- **retention thinning이 file data orphan 가능 (P2, pre-existing Rust)**: policy.rs가 thinned 스냅샷의 data dir 전체를 삭제하는데, 그 파일이 더 최신 manifest에서 (미변경으로) 여전히 참조될 수 있음 → FileHistoryView에 나열된 옛 버전이 restore 실패("파일을 복원할 수 없습니다") 또는 빈 diff. 새 UI가 표면화했을 뿐 이번 브랜치 무변경. thinning 시 참조 파일 마이그레이션 필요
- **FileHistoryView back 버튼이 restore in-flight 중 미disabled (P3)**: FIX3의 performRestore-내부 loadFileHistory 진행 중 clearFileHistory 호출 가능 → stale set이 늦게 착지(현재는 fileHistoryPath null 게이트로 inert). restore 중 back도 disabled 권장
- **VersionHistoryPanel/FileHistoryView 렌더 테스트 부재 (P3)**: 패널 파일-모드 게이트(fileHistoryVault===rootPath)와 FIX1 저장경로가 CI 미검증. 컴포넌트 렌더 테스트 추가
- **components.css 1575줄 (>1500 가이드, P3)**: 스냅샷 스타일을 snapshot.css로 분리 검토
- **VersionHistoryPanel bare useSnapshotStore() (P3)**: useShallow 셀렉터로 마이그레이션(pre-existing)
- **performRestore/performCreate in-flight 재진입 가드 없음 (P3)**: DOM disable에 의존. 스토어 레벨 `if (get().restoring) return` 가드 검토
- **자동 스냅샷 §7.5 미구현 트리거 (P3)**: on-save-즉시, before-risky-op(Agent Mode/global replace). 현재는 주기(interval)만. 커맨드 팔레트 "Snapshot: Create/Browse History"도 미등록

## 2026-07-31 접근성 대비 (#330, PR #336) 이월 항목

> PR #336에서 accent fill 위 흰 글씨 80곳 + 인라인 3곳을 파생 토큰 짝(`--color-accent-solid` / `--color-accent-on-solid`)으로 고쳤다. 아래는 같은 뿌리에서 나왔으나 **별도 디자인 결정이 필요해** 범위 밖으로 남긴 것들. `src/utils/color-contrast.ts`의 `onSolidForeground()`가 이미 계산을 갖고 있어 기계적 작업량은 작다.

- **✅ RESOLVED (PR #341, 2026-07-31) — status 토큰 위 흰 글씨**: (원문 유지, 이력용)  accent가 아닌 `--color-status-*` 위 흰 글씨 14곳. `--color-status-warning` `#f59e0b` = **2.15:1**, `--color-status-success` `#10b981` = **2.54:1**, `.find-match-active` `#f97316` = **2.80:1** — 셋 다 3:1 비텍스트 하한 미달. `--color-status-danger` `#ef4444` = 3.76:1 (AA 실패, 3:1 통과). **#330(2.54:1)보다 나쁘고 테마 무관이라 모든 사용자가 본다** — accent는 테마별로 갈렸지만 이건 안 갈린다. 사이트: `ai.css`(`.ai-diff-action-btn-accept` success / `.ai-diff-action-btn-reject`·`.ai-chat-stop-btn` danger), `skills.css`(`.skill-lint-badge--warning`·`--error`), `panels.css`·`toolbar.css`·`components.css`·`settings/theme.css` danger 버튼 5곳, `dialogs.css` `.find-match-active`(+ dark variant는 `rgb(249 115 22 / 70%)` 알파라 실제 배경 위에서 재측정 필요). **결정 필요**: 초록 Accept / 빨간 Delete 버튼 글씨가 검게 바뀜 — accent 버튼 때와 같은 종류의 결정. status 3개는 모두 사용자 편집 가능 키(`THEME_COLOR_KEYS` "Status")라 정적 짝은 커스텀 테마에서 다시 깨진다
- **warning fill 자체가 흰 배경에서 2.15:1 (P2, WCAG 1.4.11)**: PR #341은 fill **위의 글씨**를 고쳤지만 fill 자체와 페이지의 대비는 별개다. `--color-status-warning` `#f59e0b`는 흰 페이지 대비 **2.15:1**, `--color-status-success` `#10b981`는 **2.54:1** — 배지·버튼의 경계가 3:1 하한 미달. 고치려면 warning/success 색 자체를 바꿔야 하므로 디자인 결정 필요. 다크 배경에서는 8.10 / 6.86으로 문제 없음
- **`.find-match` (비활성 검색 하이라이트) 토큰화 미완 (P3)**: `dialogs.css`의 `#fde68a` + 다크 `rgb(253 230 138 / 30%)`에 `TODO: tokenize --color-find-match` 주석이 남아 있다. 명시 전경색이 없어 에디터 텍스트를 상속하므로 대비 문제는 아니지만, PR #341이 `.find-match-active`의 alpha를 없앤 이유(반투명 fill은 대비가 확정되지 않음)가 여기에도 적용된다 — 토큰화 시 함께 검토
- **accent를 텍스트 색으로 (P2, 규모 큼)**: `color: var(--color-accent-default)` **176곳**(2026-08-08 실측 — 원래 적힌 193은 오래된 수치). 페이지 배경 대비 **3/8 테마 AA 실패** — default-light 3.68:1, solarized-light 3.41:1, solarized-dark 4.08:1. #330과 반대로 **라이트 테마가 실패**한다(같은 값 하나가 fill과 텍스트 둘 다를 맡은 결과). 다행히 `--color-accent-hover`가 실패 3개 테마 전부에서 통과한다(5.17 / 4.89 / 5.21) → 배포된 테마엔 팔레트 기존 색을 쓰는 정적 매핑으로 충분. 사용자 커스텀 accent까지 보장하려면 파생 필요. 토큰+파생 / 스윕 2개 PR로 쪼갤 것. 193곳 중 장식용(아이콘 stroke, 텍스트색처럼 보이는 border)을 구조적으로 걸러야 함 — 단순 치환 금지
- **toggle knob이 accent 트랙 위 흰색 (P2, WCAG 1.4.11)**: `settings/modal.css` `.settings-toggle-thumb`, `graph.css` `.graph-settings-toggle-knob`. knob 위치가 on/off 상태를 전달하므로 트랙 대비 3:1 필요 — default-dark 2.54:1, tokyo-night 2.52:1, nord 2.00:1, garden-dark 1.72:1 실패. 전 규칙 스캔으로 **accent fill 위 흰 자식은 정확히 이 2곳뿐**임을 확인(나머지 14개 비텍스트 accent 표면엔 밝은 자식 없음). **결정 필요**: (a) knob = `on-solid` → 다크에서 검은 knob(관례 이탈), (b) 흰 knob 유지 + 테두리/섀도 → 테두리 색이 knob·트랙 양쪽에 3:1 필요, (c) 트랙 어둡게 → #330에서 버튼에 대해 기각된 이유(자체 배경 대비 하락)와 동일. **off 상태가 더 나쁘다**: 흰 knob on `--color-border-default`(modal) / `--color-bg-elevated`(graph) → 라이트에서 ~1.1:1. 기존 문제지만 같은 컴포넌트라 함께 결정
- **정적 토큰과 런타임 파생이 서로 다른 hover fill을 만든다 (P3, 일관성)**: 생성 토큰은 팔레트를 밟고(`blue-700` 라이트 / `blue-300` 다크), `accentSolidHoverFill`은 12% 수치 이동이라 같은 accent에서 `#2157cf` / `#73b0fb`가 나온다. 시나리오: Default Dark 사용자가 테마 편집기를 열어 **아무것도 안 바꾸고** 저장→활성화하면 모든 색이 바이트 단위로 같은데 hover만 눈에 띄게 탁해진다. 두 경로 다 AA는 통과하므로 안전성 문제는 아니고 일관성 문제. `generated-token-contrast.test.ts`가 solid·on-solid는 일치를 단정하면서 solid-hover만 면제하고 있어 지적됨 — 해소하려면 팔레트 스텝을 버리고 정적 토큰도 수치 이동값을 쓰거나, 그 반대
- **`accentSolidHoverFill`이 테마가 명시한 accent-hover를 버린다 (P3, 트레이드오프)**: solid 표면의 hover는 이제 항상 `accent-solid`의 수치 이동이고 테마 자신의 `--color-accent-hover`가 아니다(그 토큰은 tint·border에는 계속 쓰임). **Baram Garden Light**가 극단 사례: accent 네이비 `#123d96` + hover 오렌지 `#f6b26b`라는 보색 의도였는데, 네이비가 이미 AA를 통과하므로 fill로 유지되고 hover는 `#103684`(거의 구분 안 되는 더 어두운 네이비)가 된다. 다만 **원래 오렌지 hover는 흰 글씨 1.83:1로 접근성 실패**였으므로 그대로 살릴 수는 없다. 근본 해결은 상태별로 전경색을 따로 두는 것인데, 그러면 "전경 토큰 하나가 두 상태를 모두 커버한다"는 보장이 깨진다 — 의도적 트레이드오프로 남김. 어두운 fill에서 hover 변화량이 너무 작은 문제(가시성)는 별도로 개선 여지 있음
- **✅ RESOLVED (PR #341)** — TSX에 하드코딩된 `#f59e0b` 앰버 버튼 3곳: `PluginCard`·`PluginMarketplace`·`PluginDetail`의 업데이트 버튼을 `--color-status-warning` + `-on-solid` 토큰 짝으로 전환
- **✅ RESOLVED (PR #343)** — capability 배지: 틴트·잉크를 base별 불투명 `color-mix()`로 파생. 실제 WKWebView 계산값으로 라이트 min **5.292** / 다크 min **4.995**, 0/13 실패 (모델 예측 5.29/5.00과 소수점 3자리 일치). `system`+OS 다크가 명시적 다크와 색상 단위 동일함까지 확인. 곁가지 2건 동시 수정: (a) `CAPABILITY_COLORS`가 `Record<string,string>` 12개 vs 13멤버 union이라 v0.5.0의 `viewer`가 `settings`와 같은 회색 폴백을 타고 있었음 → `Record<PluginCapability,string>`으로 컴파일러가 잡게 함, (b) description 스팬의 `opacity: 0.8`이 파생 대비를 다시 AA 아래로(라이트 5/13, 다크 7/13, 최악 3.54) 끌어내리므로 제거. 아래 원 항목은 측정치 기록용으로 남김
- ~~**capability 배지 12색이 자기 색의 9% 틴트 위 텍스트 — 라이트에서 12/12 AA 실패 (P1)**~~ — **✅ 해소 (PR #343 머지 2026-08-01, 이슈 #330)**: base별 틴트 페어링 파생으로 13색 전부 AA 통과. 남은 것은 아래 P3(두 base를 토큰 파이프라인으로) 하나뿐. 아래 원문은 이력용:
- **✅ RESOLVED (2026-08-01, `e01ee506` + 리뷰 2라운드 `919d684e`·`723432ed`) — capability 배지 대비**: 발견과 수정이 **같은 날**이었고 이 줄만 갱신되지 않아, 2026-08-05에 "미해결 P1"로 잘못 보고됐다. 수정 방식: 컴포넌트는 `--capability-badge-hue` 하나만 넘기고, 텍스트·fill을 CSS가 **페이지가 아니라 확정된 #fff/#000 기준으로** 혼합한다(light: ink 52%/#000 + fill 10%/#fff, dark: ink 88%/#fff + fill 14%/#000). 재측정(2026-08-05): **AA 미달 0/13, 양쪽 기준 모두** — light 최악 `files:readonly` **5.31:1**(구 1.59), 최고 `settings` 9.90 / dark 최악 `settings` **5.00**, 최고 `files:readonly` 10.84. border만 의도적으로 페이지 쪽으로 혼합(pill을 배경에서 분리하는 것이 목적)하고, 8테마 × 2표면 × 13색 가시성 측정이 `plugins.css` 주석에 있다. 가드: `src/styles/__tests__/capability-badge-contrast.test.tsx` 22개 — `MIN_RATIO > 4.5`(반올림 여지 차단), 13색 전수, ink/fill 분리 소실·opacity 재도입·다른 스타일시트의 레시피 재선언·클래스명 드리프트까지 단정. ‼️교훈: 백로그의 미해결 표시를 코드 확인 없이 보고하지 말 것. 원문: `PluginCapabilityBadge.tsx:7-19`의 `CAPABILITY_COLORS` 11개 값(+fallback)이 하드코딩 hex이고, `backgroundColor: ${color}18` (알파 0x18 ≈ 9%) 위에 `color` 자신을 텍스트로 쓴다. 알파라 실제 대비는 **페이지 배경에 의존**한다(→ #341의 `.find-match-active`와 같은 부류). 측정: 라이트 배경(#ffffff) `files:readonly` **1.59:1** · `files` 2.00 · `storage` 2.28 · `events` 2.32 · `editor:readonly` 2.36 … **12색 전부 4.5 미달**, 최고가 `settings` 4.31. 다크(#1a1a2e)는 7/12 실패(`sidebar`/`statusbar` 3.47, `commands` 3.64). **1.59:1은 이번 세션 최악치**(Garden Dark 1.72보다 낮음)이고, 이 배지는 모든 플러그인 카드·상세 뷰에 뜨며 "이 플러그인이 무엇을 할 수 있는지"를 알려주는 요소다. 수정 방향: (a) 12색을 토큰화하고 (b) 텍스트를 틴트가 아니라 확정된 표면 위에 올리거나 `onSolidForeground`로 파생. 알파 틴트를 유지하면 배경 의존성이 남으므로 불투명 표면 권장 — #341에서 `.find-match-active`에 적용한 판단과 동일
- **capability 배지 레시피의 두 base를 토큰 파이프라인으로 이전 (P3, PR #343 후속)**: `plugins.css`가 `--capability-badge-fill-base`/`-ink-base`(#fff·#000)와 `-fill-hue`/`-ink-hue`(10%/14%, 52%/88%)를 세 스코프에 손으로 선언한다. 그 결과 **`prefers-color-scheme: dark` 블록을 손으로 쓴 유일한 CSS 파일**이 됐고(`grep 'html:not([data-theme'` → plugins.css와 generated/system-dark.css 둘뿐), 다크 값이 두 곳에 중복돼 동일성 가드가 필요해졌다. 리뷰 지적대로 "퍼센트는 토큰이 아니다"는 근거는 **틀렸다** — 파이프라인은 이미 `--radius-*`·`--font-size-*`를 내보내고 `graph` 같은 per-view 컬러 패밀리도 담고 있다. **다만 퍼센트는 그대로 두는 것이 맞다**: 52%/88%는 13색 전부가 여유를 두고 AA를 통과하는 지점이지 디자인 취향이 아니라서, Tokens Studio에 노출하면 디자이너의 미세 조정 한 번이 보증을 조용히 깬다. 이전 대상은 **두 base뿐**이며(`{color.white}`/`{color.black}`), 옮기면 생성기가 세 스코프를 소유하게 되어 중복과 그 가드가 사라진다. 주의: 테스트가 CSS에서 base를 읽어 `color-mix`를 재현하므로 `var(--color-white)` 간접 참조가 되면 파서가 한 단계 더 해석해야 함
- **콜아웃 아이콘 13색이 자기 색의 8% 틴트 위 — 라이트에서 7/13이 3:1 미달 (P3, 새로 발견 2026-08-01)**: `callout-view.tsx:35-47`의 `CALLOUT_TYPES` 13개 하드코딩 hex를 `blocks.css`가 `color-mix(in srgb, #xxx 8%, transparent)` 배경 + `style={{ color: def.color }}`(l.226) 아이콘으로 쓴다 — **capability 배지(PR #343)와 구조가 동일한 패턴**. 다만 hue가 텍스트가 아니라 아이콘·`border-left`에만 쓰이므로 AA 4.5가 아니라 WCAG 1.4.11의 3:1 기준. 측정(8% 틴트 위 아이콘): 흰 배경 min **1.82**(`question`), Solarized Light min **1.70**, `warning`·`success`·`todo`·`example` 포함 **7/13 미달**; 다크는 0/13(min 3.26). **심각도를 낮춘 요소**: 콜아웃 종류는 라벨 텍스트("Tip"/"Warning")로도 전달되므로 아이콘이 중복 정보 — 1.4.11 적용 여부 자체가 논쟁적. `blocks.css:250·274·278`에 이미 `TODO: tokenize --color-callout-*`가 달려 있어 토큰화 작업과 함께 처리하는 것이 자연스럽다. PR #343의 파생 레시피(base별 불투명 `color-mix`)를 그대로 재사용 가능
- **✅ FIXED (2026-08-08) — 테마 편집기 취소가 cascade-only 테마에 값을 고정**: `theme-vars.ts`에 `appliesInlineVars(themeId)` 술어를 두고(cascade-only = `system`·`default-light`·`default-dark`) `use-settings-effects`의 `isDefault` 문자열 비교를 대체 + `ThemeEditor`의 두 복원 지점(취소 버튼·unmount)이 같은 술어로 분기해 **cascade-only면 `clearThemeVars`**를 쓴다. 예상대로 "어느 테마가 cascade-only인가"를 두 곳이 따로 알고 있던 것이 새어나온 경로였다. ‼️실측 정정: 고정되던 변수는 **28개가 아니라 34개**(ThemeColors 25 + 파생 9) — RED 테스트가 `34`를 보고했다. 또한 `activeThemeId`가 아무 테마로도 해석되지 않는 경우(삭제된 커스텀 테마가 활성)도 인라인 변수가 없는 상태이므로 복원 조건에 `resolvedTheme !== undefined`를 함께 요구 — 이 경로도 같은 성질의 고정을 만들 수 있었다. 테스트 `ThemeEditor.test.tsx` + `theme-vars.test.ts`(술어 전수).
  **코드 리뷰가 추가로 잡은 2건도 함께 닫음**: (1) **save 경로가 React 효과 순서에 의존**했다 — `handleSave`는 복원하지 않고 unmount cleanup에 맡기는데, 그게 옳은 이유는 save+close가 한 커밋에 묶여 passive destroy가 create보다 먼저 돌기 때문뿐이었다. 닫기가 지연되면(transition/Suspense) cleanup이 **방금 저장된 팔레트를 지운다** = 이번에 고친 버그의 거울상. `savedRef`를 세워 cleanup을 no-op으로 만들어 의존 자체를 제거했고, "나중 커밋에서 닫기" 테스트가 이걸 고정한다(뮤테이션: `savedRef` 미설정 → 빨간불, 실측 `expected '' to be '#123456'`). (2) 복원 술어를 **mount 스냅샷에서 호출 시점 `getState()` 읽기로** 변경 — 편집 중 테마 전환 경로가 생기면 스냅샷은 *이전* 테마 색을 현재 테마 위에 덮는다(같은 결함 클래스).
  ‼️**테스트 민감도 실측**: "복원이 원본이 아니라 편집값을 쓴다"는 결함은 `handleCancel`을 `restorePreview(colors, base)`로 바꾸기만 해선 **등가 뮤턴트**다 — `useCallback` deps가 `[onClose]`이라 stale closure가 첫 렌더 색을 그대로 들고 있다. deps까지 따라가야 빨간불이 된다(M4b kill). 그 경계를 테스트 주석에 남겼다.
  아래 원문은 이력용:
- ~~**테마 편집기 취소가 cascade-only 테마에 값을 고정 (P2, 기존 버그)**~~: `ThemeEditor.tsx` 취소/unmount 복원이 `applyThemeVars`로 **set**하지만 `system`·`default-light`·`default-dark`는 인라인 변수를 애초에 쓰지 않는다(`src/styles/generated/` cascade가 담당, `use-settings-effects.ts`의 `isDefault` 분기가 의도적으로 skip). **`system` + OS 다크에서 눈에 보이게 깨진다**: `sourceTheme`이 `default-light`로 폴백(`ThemeEditor.tsx:28-31`) → 편집기 열고 취소 → 라이트 값 28개가 인라인 고정 → `data-theme`은 여전히 없어 시스템 다크인데 인라인 라이트가 미디어쿼리를 이김 → UI가 라이트로 뒤집힌 채 남는다. 테마 효과는 `[activeThemeId, customThemes]` 의존이고 취소는 둘 다 안 바꾸므로 **테마를 바꿔야 복구된다**. 구 코드도 25개를 같은 방식으로 set했으므로 PR #336이 성질을 바꾼 건 아니고 28개로 넓혔을 뿐. 수정: `theme-vars.ts`에 `appliesInlineVars(themeId)` 술어를 두고 편집기·`use-settings-effects` 양쪽이 공유 → 해당 테마면 `clearThemeVars`로 복원. 두 곳이 "어느 테마가 cascade-only인가"를 따로 알고 있는 게 이 버그가 새어나온 경로

## 2026-08-02 레지스트리 인덱스 항목 단위 관대화 (§69) 범위 밖으로 남긴 것

> `tolerant_entries` + `engines` optional + `scripts/validate-index.ts` PR에서 남긴 항목.
> ✅ **해소됨**: 아래 "회수 뒷정리" 절의 `RegistryEntry.engines`가 Rust에서 필수 필드 (P2, 가용성) 항목 — 이번 PR이 그 원인의 상위 집합(모든 필수 필드)을 처리했다.

- **발행 후 라이브 재확인이 없다 (P2)**: `revocation-publish.yml`은 push 후 Pages가 실제로 파일을 서빙하는지 최대 20회 재시도로 검증하고, 안 뜨면 실패한다. `plugin-release.yml`은 인덱스에 대해 그 단계를 **한 번도 가진 적이 없다** — push 성공은 서빙되는 파일이 아니다. 이번에 넣은 검증은 push **전**이라 "우리가 올린 것이 맞는가"만 답하고 "사용자가 받는 것이 맞는가"는 답하지 않는다. 회수 쪽 재시도 루프 15줄을 그대로 옮기면 되지만 별도 변경
- **앱은 드롭된 항목을 사용자에게 알리지 않는다 (의도)**: `log::warn!`만 남긴다. 이쪽에 사용자가 취할 수 있는 행동이 없다 — 레지스트리 운영자만 문서를 고칠 수 있다. 큰 목소리는 발행 시점(`validate-index.ts`)이 담당한다. 회수 목록과 동일한 분업. 다만 **마켓플레이스가 "N개 항목을 읽지 못했습니다"를 조용히 한 줄 보여주는 것**은 검토 가치가 있다 — 사용자가 저자에게 제보할 수 있는 유일한 경로
- **중복 id는 발행에서만 거부한다 (P3)**: 앱의 `checkForUpdates`·설치 경로는 `.find(p => p.id === id)`라 first-match-wins. 뒤 항목은 도달 불가. 런타임에서 굳이 바꿀 이유는 약하지만, 게이트를 안 거친 레지스트리(커뮤니티 포크)를 가리키는 사용자에게는 남는 문제
- **`knip.json`이 `src/ipc/**` 전체를 ignore (P2, 새로 발견)**: 이번에 `src/ipc/types.ts`에서 아무도 import하지 않는 `RegistryEntry`/`RegistryIndex`를 발견했는데, knip이 잡지 못한 이유가 이 ignore 규칙이다. 즉 **IPC 레이어 전체가 죽은 코드 탐지 사각지대**다. 규칙을 걷으면 다수의 신규 발견이 나올 가능성이 높아 이번 범위에서 제외 — 별도 작업으로 한 번 걷어보고 실제 건수를 확인할 것
- **✅ RESOLVED (2026-08-02, `chore/zip-minimal-features`)** — `default-features = false, features = ["deflate"]`로 전환. 6개 디코더 크레이트(bzip2·lzma-rust2·ppmd-rust·zstd·deflate64·aes)가 빌드에서 사라졌고 Cargo.lock이 218줄 줄었다. `fs::extract_zip`(§53)도 함께 닫혔고, 우아하게 실패하는지 테스트로 고정. ‼️남은 것: **deflate64 미지원** — Windows 탐색기가 만든 일부 대용량 아카이브가 이 방식을 쓴다. Notion 익스포트는 아니지만, §53 임포트 실패 제보가 오면 이걸 먼저 의심할 것. 아래 원문은 이력용:
- **`zip = "8"`이 default features 전체를 켠다 (P2, 보안리뷰 HIGH의 뿌리)**: aes-crypto·bzip2·deflate64·lzma·ppmd·zstd·xz 디코더가 전부 컴파일된다. #261 PR1은 **플러그인 경로에 압축 방식 allowlist**(Stored/Deflated)를 넣어 공격자 통제 입력에서는 닫았지만, 디코더 자체는 바이너리에 남아 있고 **`fs::extract_zip`(§53 Notion 임포트)에서 여전히 도달 가능**하다. `default-features = false, features = ["deflate"]`로 바꾸면 (a) 그 디코더들이 바이너리에서 사라지고 (b) 바이너리 크기도 준다(<15 MB 목표에 유리). 리스크: 사용자가 bzip2/lzma 압축 아카이브를 임포트하면 새로 실패한다 — Notion 익스포트는 deflate라 실질 위험은 낮지만 사용자 향 기능의 동작 변경이라 제품 판단 필요. ‼️`legacy-zip` feature는 declared-size `reserve()` 사이트를 3개 더 추가한다 — 지금은 미컴파일, `--features` 한 번이면 활성
- **`fs::extract_zip`(§53)에는 경계가 하나도 없다 (P2)**: `zip_slip` 방어와 `__MACOSX` 스킵만 있고 엔트리 수·해제 크기·압축비·경로 깊이·압축 방식 제한이 전무하다. 플러그인 경로에 넣은 `extract_zip_bounded`와 같은 처리를 받아야 한다. 위협 모델은 다르다(사용자가 자기 파일을 고른다 = 자해) — 그래서 P2이지 P0이 아니지만, 악의적 .zip을 "Notion 익스포트"라고 받은 사용자는 프로세스 abort를 겪는다(alloc 실패는 unwind가 아니라 abort라 `spawn_blocking`이 오류로 바꾸지도 못함)
- **중앙 디렉터리가 엔트리 한도보다 먼저 상주한다 (P3, #261 PR1 리뷰 M3)**: `ZipArchive::new`가 모든 CD 레코드를 `Vec<ZipFileData>`로 **미리 파싱한 뒤에야** `archive.len()`이 존재한다(zip 8.6.0). 와이어 46 B/레코드가 상주 ~251 B/레코드가 되므로 **32 MiB 다운로드가 엔트리 한도 실행 전에 ~175 MiB(고유 짧은 이름이면 ~227 MiB)를 점유**한다. 다운로드 캡으로 유계이고 일시적이지만 내 모든 한도의 상류다. ‼️꼬리 하나: 이름이 중복이면 `archive.len()`이 1로 접혀(IndexMap 키가 이름) 엔트리 한도를 **통과**한다 — 사용자는 거부가 아니라 느린 설치를 본다. 근본 해결은 스트리밍 CD 리더인데 `zip` 크레이트가 노출하지 않음
- ~~**`copy_dir_recursive`가 rename이 아니라 copy (P3, 리뷰 L5)**~~ — **✅ 해소 (2026-08-02, #261 PR3)**: staging→rename 전환으로 함수 자체를 삭제. 최대 디스크 점유가 전체 한도의 1배로 복귀
- **`spawn_blocking`은 취소되지 않는다 (P3, 리뷰 L2/detachment)** — **파괴성은 해소, 분리 실행 자체는 남음 (2026-08-02, #261 PR3)**: 스테이징 단계를 드롭하면 이제 `.staging/stage-*` 트리 하나가 분리된 채 완성될 뿐이고(24시간 후 sweep이 회수), 커밋 단계는 rename 두 번이라 중간 상태가 없다. 설치된 것을 파괴하는 경로는 사라졌다. 남은 것은 취소 불가라는 성질 자체
- **활성화 실패는 롤백하지 않는다 → 후속 작업 (P2, #261 PR3 리뷰 HIGH-1)**: 커밋은 단방향이다. 백업이 즉시 해제되므로, 스왑은 성공했는데 `loadPlugin`이 실패하면 사용자는 죽은 새 버전만 남고 작동하던 버전으로 되돌아갈 수 없다(레지스트리는 최신 버전만 제공). 이번 PR은 **평가 가능한 floor를 양쪽 다 선언하지 않은 업데이트를 거부**해 최악의 진입점만 막았다 — `parseBaramFloor`는 `>=X.Y.Z`만 파싱하므로 absent·`*`·`^0.6.0`·`~0.5`가 전부 "의견 없음"이고, 스테이징이 이 부류를 해결한다는 내 주장은 **틀렸다**(다운로드 후 재검사도 같은 술어). 근본 해법: 커밋이 백업 핸들을 반환하고, 활성화 성공 시 `release`·실패 시 `rollback`. 그게 들어오면 이 거부 자체를 삭제할 수 있다. 비용: IPC 2개 + 프론트 분기 + 백업 수명 관리
- **`.staging` 고아는 다음 설치 때만 회수된다 (P3, #261 PR3)**: sweep은 `stage_archive_in` 안에서만 돈다. 앱을 하드킬해 스테이지가 남으면 **다음 설치를 할 때까지** 최대 256 MiB가 `~/.baram/plugins/.staging/`에 남는다(플러그인을 다시 설치하지 않는 사용자에게는 영구). 앱 시작 시 한 번 더 도는 것이 자연스럽지만 시작 경로에 파일시스템 작업을 추가하는 일이라 분리. 연령 기준(24h)이라 동시 설치를 잡아먹지 않는 점은 테스트로 고정됨
- **`swap_into_place`의 "두 rename 모두 실패" 가지는 미검증 (P3, #261 PR3)**: 복구 rename은 첫 rename이 방금 비운 이름으로 되돌리는 것이라 파일시스템 결함 없이는 실패시킬 수 없고, 이식성 있게 위조하면 위조물을 테스트하게 된다. 메시지 전용 경로로 남김 — 그 메시지가 backup 디렉터리 경로를 알려주므로 데이터는 회수 가능
- **floor 미달 업데이트 뱃지의 해악이 줄었다 (P3, 아래 `checkForUpdates` 항목의 갱신)**: #261 PR3 이전에는 뱃지를 눌러 실패하면 **작동하던 플러그인이 사라졌다**. 이제는 아무것도 잃지 않으므로 "성공할 수 없는 동작을 약속한다"는 비용만 남는다 — 우선순위를 낮출 근거
- **32 MiB 캡 테스트가 매 CI 실행마다 루프백으로 32 MiB를 옮긴다 (P3, 리뷰 L3)**: 단정 하나에 피크 ~70~100 MiB. 캡을 주입 가능하게 만들면(`ExtractBounds`와 같은 수법) 없앨 수 있지만 async 배선이 더 필요
- **drop-both가 append-only 공격자에게 "조용한 업데이트 차단"을 준다 (P3, 의도된 트레이드오프)**: 중복 id를 **양쪽 다 버리는** 수정 이후, 항목 하나만 추가할 수 있는 공격자가 플러그인 X의 id를 참칭하면 X가 모든 사용자의 마켓플레이스에서 사라진다. `checkForUpdates`는 `.find` 후 `if (!registryEntry?.trust) continue`라 **X 사용자는 보안 업데이트를 포함해 업데이트 제안을 조용히 못 받는다**. `logger.warn`은 devtools 전용이고 플러그인은 디스크에서 계속 돌아 증상이 없다. ‼️그래도 이 트레이드오프가 옳다 — 패치 안 된 플러그인 > 공격자가 공급한 플러그인, 가용성 손실 > 조용한 교체. 싸게 줄이려면 `checkForUpdates`가 "레지스트리에 없음"과 "레지스트리에서 모호함"을 구분해 후자를 설치된 플러그인에 표시하면 된다(지금은 둘 다 같은 `continue`). `droppedCount` 노출과 같은 성격의 변경
- **✅ RESOLVED (PR #364, 2026-08-08 코드 재확인)** — 다운로드 origin 핀이 실제로 배선돼 있다: `stage_plugin`이 `registry_base(registry_url)`로 인덱스 origin을 구하고(`plugin/mod.rs:816`) `is_within_registry`로 URL을 검사한 뒤(`:818`) 클라이언트에 `redirect_within_registry(base)` 정책을 건다(`:834`) — 리다이렉트 우회까지 닫혔고 `registry_url`이 **필수 인자**(`Option` 아님)라 호출자가 생략할 수 없다. **이 항목이 2026-08-08까지 "다음 후보 P1"로 남아 있어 트리아지를 오염시켰다.** 아래 원문은 이력용:
- ~~**‼️ 플러그인 다운로드 origin이 런타임에 강제되지 않는다 (P1, #352 보안리뷰 HIGH-2)**~~: `validate_http_url`(`plugin/mod.rs`)은 **스킴만** 검사하고 **모든 호스트를 허용**한다. 체크섬은 같은 인덱스에서 오므로 origin에 대해 아무것도 보증하지 않는다. 게다가 다운로드 클라이언트에 redirect 정책이 없어 reqwest 기본값(최대 10회 추적)이 적용되므로, origin 검사를 넣어도 리다이렉트로 우회된다. 즉 **"플러그인이 어디서 올 수 있는가"를 말하는 유일한 코드가 `validate-registry-assets.ts`(CI)** 이고, CI 층은 우회 가능하다는 것이 같은 리뷰의 CRITICAL-1이 보여준 바다. ‼️단순히 `sayinel.github.io/baram-plugins`를 하드코딩하면 **커뮤니티 포크를 가리키는 사용자가 깨진다** — `store.registryUrl`이 설정 가능하기 때문. 올바른 규칙은 **"다운로드는 그 인덱스를 받아온 origin과 같아야 한다"**이고, 그러려면 registry origin을 `stage_plugin`까지 배선해야 해서 IPC 시그니처가 바뀐다. 함께: `.redirect(Policy::none())`
- **레지스트리 리포 자체에 PR CI가 없다 (P2, 보안리뷰 MEDIUM-2 후반부)**: `validate-index.ts`가 도는 곳은 (a) `lint:frontend` — 사용자가 절대 fetch하지 않는 **씨드**, (b) `plugin-release.yml` — **first-party 릴리스가 돌 때만**. `sayinel/baram-plugins`에 직접 머지된 악성/오류 항목은 **다음 first-party 릴리스까지 라이브로 남는다**. 앱 쪽 방어(`dropAmbiguousIds`)는 이번에 넣었지만 그건 중복 id 하나만 막는다. 레지스트리 리포에 PR CI를 두고 같은 스크립트를 돌리는 것이 근본. `update-registry-index.mjs:166-168`도 first-match-wins라 워크플로가 공격자 항목을 갱신하고 진짜를 남길 수 있음
- **`Vec<serde_json::Value>` 중간 표현 (P3, 보안리뷰 LOW-3)**: 관대한 역직렬화가 전체 `plugins` 배열을 `Value` 트리로 먼저 물질화한다. 4 MiB 문서 → 약 64 MiB `Value` + Vec doubling ≈ 96~128 MiB 일시적(16~30배 증폭, 리뷰어 추정치·미측정). `with_capacity(total)` 제거로 더 큰 쪽(`RegistryEntry` 368 B × N ≈ 735 MiB 예약)은 이미 해소. 레시피: `Vec<&serde_json::value::RawValue>`로 바꾸면 슬라이스만 빌려 트리를 안 만든다 — 단 `serde_json`에 `features = ["raw_value"]` 추가가 필요해 lockfile·`deny` 잡에 영향. 4 MiB 스트리밍 캡이 먼저 걸리고 레지스트리 호스트 통제를 전제하므로 우선순위 낮음
- **✅ RESOLVED (2026-08-09, `feat/backend-logger`)** — `src/logging/mod.rs`가 `tauri-plugin-log`를 정책과 함께 설치한다. 배선은 **우리 소유의 얇은 플러그인**(`logging::plugin`, 이름 `baram-logging`)이 builder 체인 **첫 번째**로 등록되고 그 setup이 `install`을 부른 뒤 **항상 `Ok`를 반환**하는 모양이다 — 두 제약을 동시에 만족시키는 유일한 자리다: (1) tauri는 `App::setup`에서 **윈도우를 먼저 만들고** 앱 setup 클로저를 나중에 부르는데, 윈도우 생성 실패(`tauri-runtime-wry`가 error로 찍는다)가 가장 값진 기록이므로 앱 setup에 두면 그 세션 로그가 텅 빈다. (2) `tauri-plugin-log`의 플러그인을 그대로 쓰면 `create_dir_all` 실패가 `Builder::build()`로 전파돼 `run()`의 `.expect()`가 **앱을 못 뜨게 한다** — 로그가 앱을 죽이면 안 된다. 실앱 스모크로 `~/Library/Logs/com.inel.baram/baram.log` 생성 + 시작 배너 확인. 정책 요지: **기본 Warn, 우리 코드만 Info로 올림**(denylist가 아니라 allowlist 모양 — 내일 추가되는 의존성이 기본적으로 조용하다). ‼️이건 프라이버시 규칙이다: `tungstenite`가 trace에서 프레임 페이로드를 찍고 PDF 내보내기가 headless Chrome을 websocket으로 몰기 때문에, 전역 레벨을 Debug로 올리면 **사용자 문서 본문이 "로그 첨부해 주세요"라고 부탁할 파일에 쓰인다**. 로그 라인은 제어문자·bidi/zero-width 문자를 이스케이프하고 한 줄을 8 KiB로 자른다(위조 라인·로그 축출 방지 — 노트의 `![a](x&#10;y.png)` 하나가 asset protocol 경유로 도달한다). 함정 하나: fern의 `level_for`는 문자열 prefix가 아니라 `::` 세그먼트로 매칭(`find_module`)해서 `"baram"` 하나로는 `baram_lib::*`(=전부)를 못 잡는다 — 테스트가 이걸 고정한다. 아래 원문은 이력용:
- ~~**백엔드 `log::*` 7곳이 전부 no-op (P2, 보안리뷰 LOW-2에서 파생)**~~: `src-tauri`에 로거 구현체가 없다 — `tauri-plugin-log`도, `env_logger`도, `set_logger` 호출도 없음(`lib.rs`는 opener/dialog/clipboard/updater/process만 등록). `log` facade만 있으면 `warn!`은 파일·stderr·devtools 어디에도 안 간다. **사용자 제보를 디버깅하는 개발자에게도 안 보인다**는 뜻. 이번 PR은 드롭 개수를 `droppedCount`로 IPC를 넘겨 우회했지만, 나머지 6곳은 여전히 죽어 있음. 로거 하나 설치하면 전부 살아남

## 2026-08-11 HTML 뷰어 `baramhtml:` 스킴 (§5.1) — 알려진 한계

> 줌·외부링크·상대경로 3건을 고치면서 **의도적으로** 남긴 것. 프리뷰 프레임은 `allow-same-origin` 없는 opaque origin이라 호스트가 문서를 못 읽는다 — 주입한 bridge(`html-preview-shim.js`)가 유일한 채널이고, 그 채널의 성질이 아래 한계를 만든다.

- **`document.write`로 문서를 통째로 다시 쓰는 페이지는 bridge를 잃는다 (P3, 설계상)**: 주입은 `<html>`/`<head>` 직후 1회뿐이라, 파싱 도중 `document.open()`이 도는 문서에서는 리스너째 날아간다 → 그 페이지에서만 외부 링크와 **프레임 안 포커스에서의** 줌 입력이 죽는다. 재주입할 지점이 없다(호스트가 자식 DOM에 접근할 수 없는 것이 이 설계의 전제). ‼️줌 **페인트**는 영향 없다 — 호스트가 프레임을 스케일하므로 bridge에 의존하지 않는다. 실측 빈도 미확인
- **줌 UI가 없다 (P3)**: 프레임 안에 포커스가 있을 때 `Cmd+=/-/0`·핀치가 도는 것은 bridge가 부모로 포워딩하기 때문이고, bridge를 잃은 문서(위 항목)에는 해당하지 않는다. 프리뷰 크롬에 +/− 버튼을 두면 채널과 무관하게 항상 동작한다 — `menu.rs`가 줌 3키에 액셀러레이터를 **일부러 안 붙였으므로**(Back/Zoom 동시 발화, `menu.rs:588-602`) 네이티브 메뉴 폴백도 없다는 점과 함께 판단할 것
- **줌 아웃 시 문서가 되흐른다 (P3, 의도)**: 프레임 스케일 방식이라 확대(z>1)는 리플로우 없는 순수 확대지만, 축소(z<1)는 프레임을 `100%/z`로 넓혀 팬 전체를 채우므로 **뷰포트가 넓어져 줄바꿈이 달라진다**. 대안(폭도 100% 고정)은 축소할수록 오른쪽에 빈 띠가 남는다 — 빈 띠보다 리플로우가 낫다는 판단. 브라우저 축소도 같은 동작이다
- **`<meta charset>`을 신뢰한다 (P3)**: 핸들러는 `text/html`을 charset 없이 보내고 bridge를 **바이트로** 끼워 넣는다(그래서 shim은 ASCII 전용이다). 문서가 charset을 선언하지 않으면 브라우저 추측에 맡겨지는데, 이는 파일을 직접 열었을 때와 동일한 동작이라 회귀가 아니다
- **멀티 range 요청은 200으로 답한다 (P2 아님, 의도)**: `MAX_RANGE_LEN`까지의 단일 range만 206을 준다. 스펙이 허용하는 축약이고 우리가 서빙하는 media element는 멀티 range를 안 쓴다 — tauri asset 프로토콜의 multipart/byteranges 경로를 포팅하지 않은 이유
- **`//host/path`를 https로 읽는다 (기록용)**: 프로토콜 상대 URL을 페이지 스킴(`baramhtml:`)으로 해석하면 핸들러가 403밖에 못 준다. 저자 의도가 네트워크인 것이 명확해 https로 승격했다 — 스킴 승격이므로 http 다운그레이드는 일어나지 않는다

## 2026-08-09 백엔드 로거(`feat/backend-logger`) 범위 밖으로 남긴 것

> 로거 설치 PR에서 **의도적으로** 뺀 것. 각각 별개의 표면이고, 로거가 없으면 셋 다 애초에 불가능했다.

- **프론트엔드 로그는 여전히 파일에 안 남는다 (P2, 가장 값어치 큰 후속)**: `src/utils/logger.ts`의 `warn`/`info`/`debug`는 `import.meta.env.DEV` 게이트라 release에서 완전 무음이고, `error`는 게이트가 없지만 `console.error`라서 **release 사용자가 열 수 없는 devtools 콘솔**로 간다. 즉 프론트 실패는 기록이 0이다(PR #383이 이 사실을 두 번 밟았다). 이제 파일이 있으니 라우팅만 하면 된다 — 단 **두 단계**다: (a) `logging::install`이 `split()`이 돌려주는 `TauriPlugin`을 **버리고 있으므로** 그 커맨드는 아예 존재하지 않는다(의도된 축소). 권한만 주고 프론트에서 부르면 "plugin log not found"가 난다 — 먼저 그 플러그인을 등록하도록 `install`을 고쳐야 한다. (b) 그 다음 `log:default`를 **host 윈도우에만** 준다(‼️`plugin-*`에는 절대 — `sandbox_tier_grants_exactly_its_allowlist`가 정확히 3개만 허용하고, `no_capability_grants_the_log_plugin_command`가 host 쪽도 지금은 0을 강제한다. 후자는 이 작업의 **결정 지점**이니 의도적으로 교체할 것). 그리고 `logger.error`/`warn`을 async invoke로 tee. 비용: 동기 함수를 fire-and-forget async로 바꾸는 것 + 순서 보장 없음([[async-conversion-loses-ordering]] 부류) + 로거가 IPC를 부르면 IPC 실패 로그가 재귀할 수 있어 가드 필요
- **패닉이 로그에 안 남는다 (P2, 10줄짜리)**: release 프로필이 `panic = "abort"`라 패닉은 아무도 안 읽는 stderr로 한 줄 쓰고 프로세스가 죽는다. `run()` 안에서 `std::panic::set_hook`으로 payload + `Location`을 `log::error!`한 뒤 **이전 훅을 체인**(기본 stderr 출력을 잃지 않게)하면 로그 파일이 담을 수 있는 가장 값진 한 줄이 생긴다. 테스트는 `PanicHookInfo`를 만들 수 없으니 `fn panic_line(payload: &dyn Any, loc: Option<&Location>) -> String`을 분리해 그걸 단정
- **앱 안에 "로그 폴더 열기"가 없다 (P3)**: `docs/faq.md`에 3개 OS 경로를 적어 절반은 해결했다(앱 Help에 `?raw`로 번들되니 앱 안에서 읽을 수는 있다). 버튼까지 가려면 `opener:allow-reveal-item-in-dir`가 이미 host에 있으니 Settings에 한 줄이면 되지만, 경로를 프론트가 알아야 해서 `app_log_dir`을 노출하는 커맨드 1개 추가(=`generate_handler!`+build.rs+capabilities 3곳, [[rust-gates-cargo-test-not-just-clippy]])가 따라온다
- **로테이션(2 MiB / 3파일)은 우리 테스트가 아니라 라이브러리 테스트가 덮는다 (P3, 의도)**: 우리 정책 테스트는 레벨·모듈 필터·파일 도달을 실제 파일로 단정하지만, 로테이션을 우리가 확인하려면 2 MiB를 매 CI마다 쓰거나 프로덕션과 다른 크기를 주입해야 한다 — 32 MiB 캡 테스트를 P3로 남긴 것과 같은 판단
- **Linux에서 로그 파일이 world-readable (P3, 보안리뷰 F4)**: 플러그인이 `OpenOptions::new().create(true).append(true)`로만 열고 모드를 안 준다 → umask 022에서 `0644`. macOS는 상위 `~/Library/Logs`가 `0700`이라 실질 노출이 없지만, Linux 경로(`~/.local/share/com.inel.baram/logs/`)의 상위는 관례상 `0755`라 **멀티유저 머신의 다른 로컬 사용자가 vault 경로·노트 파일명을 읽을 수 있다**. ‼️반쪽 수정 금지: 설치 직후 `set_permissions(0o600)`을 걸어도 **로테이션이 만드는 새 파일은 다시 0644**라, 보호되는 것처럼 보이면서 안 되는 `emit_filter` 패턴이 된다(§260 3c-2b에서 rate limiting을 같은 이유로 뺐다). 제대로 하려면 upstream에 모드 옵션이 필요하거나 `TargetKind::Dispatch`로 파일 열기를 우리가 소유해야 함
- **✅ 해소 (2026-08-09, 2차 리뷰 R2-3)** — `install()`은 이제 `tests/logging_install.rs`(정상 경로)와 `tests/logging_install_unwritable.rs`(디렉터리 생성 실패)가 덮는다. 통합 테스트는 **프로세스가 따로**라 전역 로거를 소유해도 되고 `HOME`을 tempdir로 돌릴 수 있다 — 단위 테스트로는 불가능했던 것이 파일 하나 옮기니 가능했다. 리뷰가 지적한 3종 뮤테이션(타깃을 stdout만으로, `attach` 미호출, Err에서 panic) 전부 kill. ‼️남은 미커버: "stdout 폴백**까지** 실패"하는 3번째 분기(실제로 도달 불가 — `TargetKind::Stdout` arm에 실패 가지가 없다)
- ~~**`install()`의 폴백 경로는 테스트가 아니라 스모크가 덮는다 (P3, 의도)**~~: 단위 테스트는 `build()`까지만 간다 — `attach()`는 `set_boxed_logger`가 프로세스 전역 1회라 테스트가 부르면 같은 바이너리의 다른 테스트 동작을 결정하고 개발자의 실제 로그 디렉터리에 쓴다
- **‼️ 로그 라인 개수에 전역 제한이 없다 → 노트 하나가 로그를 축출할 수 있다 (P2, 보안리뷰 2차 R2-F1)**: 크기는 `MAX_LINE_BYTES`(8 KiB)로, 레지스트리 사이트의 **개수**는 `MAX_NAMED_DROPS`(10)로 묶었지만 **전역 개수 제한은 없다**. tauri의 asset protocol이 요청당 한 줄을 **error**로 찍고(`protocol/asset.rs:47,62` — `DEPENDENCY_LEVEL` 통과) 문서가 만드는 요청 수에는 상한이 없다 → 깨진 이미지 경로가 수천 개인 노트(≈5 MB) 하나를 여는 것만으로 파일 + 아카이브 2개가 전부 밀려난다. 대용량 windowing도 막지 못함(`display:none`은 `<img>`의 fetch를 막지 않는다). ‼️**의도적으로 이번 PR 범위에서 뺐다** — 올바른 수정은 타깃 단위 rate limit/coalesce(예: "1초에 같은 prefix N개 초과 → 요약 한 줄")인데, 진단을 보호하려고 진단을 버리는 제품 결정이라 별도로 판단해야 하고 "필요했던 그 한 줄이 드롭됨"이라는 새 실패 모드를 만든다. 피해도 한정적이다: 밀려나는 것은 **오래된** 기록이고 현재 세션의 tail은 남는다. 리뷰어 추정치(초당 ~500 요청)는 실측이 아니라 상수에서 계산한 값
- **이스케이프 대상이 열거(enumeration)다 (P3, 2차 리뷰 R2-9의 잔여)**: `needs_escape`는 `char::is_control`(카테고리 Cc)에 **범위를 손으로 더한다** — bidi 제어(`U+202A`~`U+202E`, `U+2066`~`U+2069`), zero-width(`U+200B`~`U+200F`), 구분자(`U+2028`/`U+2029`), BOM. std로는 Cf/Zl/Zp를 판정할 수 없어서(테이블 crate 필요) 이 모양이 됐는데, 이 저장소가 싫어하는 [[enumerated-denylist-over-open-set]] 그 자체다. 4차 리뷰가 실제 누락을 찾아 **15개까지 늘렸다**(U+061C·U+00AD·U+2060~2064·U+FFF9~FFFB·TAG 블록·Hangul filler 추가) — 그전 주석이 "실질적으로 닫힌 집합"이라고 주장했는데 U+061C(2013년 추가, 보이지 않음, U+200F의 형제)가 두 주장을 동시에 반증했다. Cf 약 170개 중 15개만 이름이 있으므로 **좁아졌을 뿐 닫히지 않았다**. 남은 것들은 줄을 쪼갤 수는 없고(그게 중요한 성질) 경로의 일부를 숨겨 읽는 사람이 어떤 파일인지 오독하게 만들 수 있다. 제대로 하려면 `unicode-general-category` 같은 crate 하나(=`deny` 잡 + 공급망 표면)
- **`…[N more bytes not logged]` 마커는 위조 가능하다 (P3, 보안리뷰 2차)**: 메시지가 그 문자열을 그대로 담고 있으면 온전한 라인이 잘린 것처럼 읽힌다. 이스케이프가 제어문자를 막으므로 줄을 쪼개지는 못하고 오독만 유발. 구분 가능하게 만들려면 콘텐츠에 나타날 수 없는 표식이 필요한데 인쇄 가능 문자에는 그런 것이 없다
- **✅ RESOLVED (2026-08-09, `test/acl-lockdown-capability-discovery`)** — 테스트를 **파일명이 아니라 타깃 글롭 기준**으로 다시 짰다. 발견 로직 하나(`live_capabilities`)가 tauri가 보는 곳 전부를 보고, 각 테스트는 tier(host/sandbox)별 **합집합**에 대해 단정한다. ‼️먼저 구멍을 실증했다 — `capabilities/zz-leak.json`에 `windows:["plugin-*"]` + `core:window:allow-close`(샌드박스 플러그인이 메인 윈도우를 닫을 수 있음)를 넣고 돌리니 **7개 전부 초록**이었고, 그중 `host_tier_can_close_the_webviews_it_creates`는 "샌드박스는 window 권한을 하나도 가져선 안 된다"를 말 그대로 단정하면서 통과했다. 크레이트 소스를 읽어 확인한 것 3가지: (1) **`webviews`가 독립된 두 번째 축**이다 — `authority.rs:459`가 `webviews.any() || windows.any()`이므로 `"webviews":["plugin-*"]`만으로 샌드박스에 닿는다(§260의 per-plugin WebviewWindow는 webview 라벨 = window 라벨). 옛 테스트는 `windows`만 읽어 같은 부류의 **두 번째 구멍**이었다. (2) **`toml`은 feature 게이트가 없다** — `CAPABILITY_FILE_EXTENSIONS = ["json", "toml"]` + json5는 `config-json5` 게이트. 즉 아래 원문의 "`config-json5`/`config-toml`이 꺼져 있어서만 완전하다"는 **틀린 진술**이고 `.toml` capability는 오늘 당장 라이브다. 파서를 하나 더 두는 대신 `.toml`/`.json5`를 **거부**한다(포맷은 한 개면 족하고, 정책이 파서보다 싸다). (3) `security.capabilities`가 **비어 있을 때만** 모든 파일이 라이브다(`acl/mod.rs:353`) — 목록이 생기면 명시되지 않은 파일은 조용히 무효가 되고 인라인 capability는 설정에만 존재한다. 둘 다 처리하고 `capability_discovery_sees_both_known_tiers`가 비공허성 앵커로 잡는다. 뮤테이션 **9/9 kill**: 하위 디렉터리 파일 · `windows:["*"]` · `webviews`만 · `.toml` · bare-array 파일 형태 · `{"identifier":"log:default"}` 객체 항목 · 설정이 목록으로 `plugin-sandbox`를 침묵시킴 · 설정 인라인 capability · 타깃 없는 capability. `platforms`는 의도적으로 무시한다(`["linux"]`로 제한된 grant도 Linux에서는 grant이고, 호스트 타깃으로 필터하면 macOS 개발자에게 안 보인다). 안 만든 가드 2개: 중복 identifier와 미등록 커맨드 권한은 **tauri가 이미 하드 에러**로 만든다(`CapabilityAlreadyExists`, `validate_capabilities`). 아래 원문은 이력용:
- ~~**§260 ACL 락다운의 형제 테스트들은 아직 파일명을 하드코딩한다 (P2, 보안리뷰 2차 R2-F3 후반부, 이 브랜치 이전부터)**~~: `no_capability_grants_the_log_plugin_command`만 `capabilities/`를 재귀 순회하도록 고쳤고, `sandbox_tier_grants_exactly_its_allowlist`·`capability_allowed_commands`·`the_two_tiers_apply_to_disjoint_window_sets`는 `default.json`/`plugin-sandbox.json` 두 개만 읽는다. ‼️따라서 **`windows: ["plugin-*"]`를 가진 새 capability 파일을 추가하면 샌드박스 윈도우에 임의 권한이 생기고 §260 락다운의 어떤 테스트도 보지 못한다.** 이번 브랜치가 한 테스트에서 올바른 패턴을 세우고 형제들을 옛 방식에 남겨둔 셈이라, 방치하면 그 불일치가 영구화된다. 함께: `app.security.capabilities`의 **인라인** capability도 아무 테스트가 안 읽는다(현재 미사용), 확장자 필터는 `config-json5`/`config-toml`이 꺼져 있어서만 완전하다
- **로테이션 `.log.bak` 잔재는 회수되지 않는다 (P3, upstream)**: 같은 초에 두 번 로테이션하면 `rename_file_to_dated`가 기존 아카이브를 `baram_<date>.log.bak`으로 밀어내는데, `remove_old_files`의 필터가 `strip_suffix(".log")`라 `.bak`은 **영원히 안 지워진다** → 문서화한 ≈6 MiB 상한을 넘길 수 있다. 초당 ~4 MiB가 필요해 일반 사용으로는 도달 불가이고, 도달 가능했던 유일한 경로(레지스트리 항목당 warn)는 `MAX_NAMED_DROPS`로 막았다. `KEEP_ROTATED` 주석에 정직하게 적어둠
- **"노트 본문은 안 적힌다"를 강제하는 것은 없다 (P3, 보안리뷰 F3)**: FAQ 문구를 사실에 맞게 고쳤다(경로·플러그인 id·**로드 실패한 문서 조각**은 적힐 수 있다 — 깨진 이미지 경로가 그 예). 구조적 보장은 `DEPENDENCY_LEVEL` 하나뿐이고, 모듈 문서가 "디버깅할 때 `OUR_LEVEL`을 올려라"라고 권하는데 그게 바로 미래의 `log::debug!("doc: {content}")`를 파일에 흘리는 변경이다. 테스트로 잡을 수 없는 부류(어떤 단정도 "이 문자열은 문서 본문이 아니다"를 판정할 수 없다) → 리뷰 체크리스트 항목으로 남김
- **플러그인 순서 가드는 소스 스캔이다 (P3, 알려진 한계)**: `the_logger_is_the_first_plugin_registered`는 `lib.rs` 텍스트에서 첫 `.plugin(` 위치를 본다(주석 줄은 제거 후 — 1차 draft가 자기 주석의 `.setup(`을 세서 3을 읽었다). 소스가 아니라 런타임 등록 순서를 보는 것이 근본이지만 tauri가 그걸 노출하지 않는다. 함께 들어간 `the_builder_registers_exactly_one_setup_hook`은 로깅과 무관하게 값어치가 있다 — tauri의 `Builder::setup`은 **덮어쓰기**라 두 번째 `.setup()`이 조용히 첫 번째(=메뉴 설치까지)를 무력화한다
- **부수 이득 (기록용)**: tauri의 `protocol/asset.rs`가 **error 레벨**로 요청 경로를 찍고 우리는 `protocol-asset`를 켜므로, 이제 그 기록이 로그 파일에 남는다 → §backlog#3 asset-scope 부류를 사용자 제보에서 처음으로 진단할 수 있다
- **`REQUIRED_FIELDS`가 Rust 구조체의 손복사 (P3, 완화됨)**: `scripts/validate-index.ts`가 Rust `RegistryEntry`의 non-default 필드 목록을 복제한다. 위험한 방향(구조체가 더 엄격해지는데 스크립트가 뒤처짐 → 게이트를 통과한 항목이 런타임에 pruning)은 `registry_entry_minimal_required_fields_deserializes`가 잡는다. 반대 방향은 스크립트가 앱보다 엄격해질 뿐이라 무해. 단일 소스로 합치려면 필드 목록을 JSON으로 빼고 build.rs가 읽게 해야 하는데 비례하지 않음

## 2026-08-09 ACL 락다운 발견 로직 (§260) — 리뷰가 찾은 것 + 범위 밖으로 남긴 것

> `tests/acl_lockdown.rs`를 파일명이 아니라 타깃 글롭 기준으로 다시 짠 작업. **리뷰(code-reviewer opus + security-reviewer 병렬)가 HIGH 2건을 포함해 실제 구멍 4개를 더 찾았고 전부 같은 브랜치에서 닫았다.** 첫 판이 "발견 로직을 tauri와 맞췄다"고 주장했는데, 맞춘 것은 **파일 포맷과 디렉터리**였고 tauri의 **입력 목록**은 아니었다.
>
> **리뷰가 찾은 것 (전부 수정됨)**:
>
> | 구멍 | 왜 첫 판이 놓쳤나 | 킬 뮤테이션 |
> | - | - | - |
> | 🔴 `permissions/**`의 손으로 쓴 `[[set]]`이 이미 승인된 권한 id의 의미를 갈아치운다 | 앱 ACL 매니페스트가 **네 번째 입력**인 걸 몰랐다. `get_permissions`가 set을 permission보다 **먼저** 본다(`resolved.rs:358` vs `:360`) → `[[set]] identifier="allow-plugin-sandbox-report"`에 `allow-read-file`을 넣으면 capability 파일은 바이트 동일한데 샌드박스가 `read_file`을 얻는다. **뮤테이션 11개를 전부 통과했다** | N3·N4·N5 |
> | 🔴 다른 설정 파일이 capability 선택자를 재선언 | `tauri.conf.json` 하나만 읽었다. 플랫폼 설정은 RFC-7396으로 머지되고, CLI `--config`도 머지된다 — ‼️**릴리스 워크플로가 `tauri.release.conf.json`을 넘긴다**. 이 파일의 존재를 **테스트가 첫 실행에서 실패하며 알려줬다** | N6·N7·N8 |
> | 🟡 `generate_context!(capabilities = […])` 주입 | 첫 판이 "무엇이 그 필드를 채우는지 추적하지 않았다"고 스스로 적어놓고 넘어갔다. tauri-macros `context.rs:66`이 `Meta::NameValue`로 받는다 → 임의 경로의 capability를 선택자 **이후에** 무조건 추가하고 `validate_capabilities`가 못 본다 | N9 |
> | 🟡 `capabilities/schemas/<subdir>/` 하위는 tauri가 **적용한다** | 제 주석이 방향을 거꾸로 적었다 — "subtree 전체를 건너뛰는 게 더 엄격해서 안전하다"고 썼지만 tauri 필터는 **직속 부모만** 본다(`acl/build.rs:217`). 발견 로직에서 **더 많이 잘라내는 것은 더 적게 감사하는 것**이다. 커밋 메시지가 고쳤다고 주장한 바로 그 유출이 한 디렉터리 깊이에서 그대로 통했다 | N1 (+N2는 초록 유지=과잉엄격 아님 확인) |
>
> 추가로 닫은 것: `deny-*` 맹점(‼️tauri의 `denied_commands.get(c).map(..).is_some()`는 `any()` 결과를 **버려서** deny 하나가 `main`까지 전역으로 커맨드를 죽인다 — `authority.rs:446`), `remote`/`local` 미검사(실행 컨텍스트 축), 도달 불가 `is_disjoint` 단정 삭제, `trim_start_matches`→`strip_prefix`, 블록 주석·문자열 리터럴까지 처리하는 소스 스캔(`code_only`).
>
> 뮤테이션 **21/21** 요구대로 동작(19 kill + 2는 초록 유지=오탐 없음 확인). 두 리뷰가 `schemas` 건에서 **정반대 결론**을 냈고(보안 리뷰는 "더 엄격해서 안전" = 제 오류를 그대로 복창), 크레이트 소스를 직접 읽어 코드 리뷰가 맞다고 판정했다.

- **✅ RESOLVED (2026-08-09, `test/acl-permission-set-expansion`)** — set을 **커맨드까지 펼쳐서 동결**한다. tauri의 `get_permissions`/`get_permission_set_permissions`를 이식해 tier별 확장을 계산: 호스트 124 선언 → **220 커맨드**(앱 113 + 플러그인/코어 107), 샌드박스 3 선언 → **정확히 3개, 플러그인/코어 0개**. 앱 쪽은 `generate_handler!`에서 **파생**(추가할 때마다 churn이라 동결 안 함), 플러그인/코어 107개는 **동결 목록**(`HOST_PLUGIN_COMMANDS`) — 업스트림이 `core:default`를 넓히면 양방향 diff와 함께 실패하고, 사람이 새 커맨드를 보고 **의도적으로** 재동결한다. 부수 효과 3개: (1) **F6(호스트 colon 권한 열린 집합)이 사실상 닫혔다** — `process:allow-exit` 추가가 이제 실패한다(E1), (2) `permissions/**` `[[set]]` 섀도잉을 **resolve된 쪽에서 독립적으로** 한 번 더 잡는다(E2 — 디렉터리 감시 가드와 증거가 다르다), (3) 확장에 도달하는 `deny`와 플랫폼 제한 권한도 단정. ‼️이식에서 두 가지가 결정적이었고 둘 다 크레이트 소스를 읽어야 알 수 있었다: **식별자 분해**는 `core:`로 시작하면 마지막 콜론, 그 외엔 첫 콜론(`separator.is_none() || is_core_identifier`, `identifier.rs:186`)이고, **우선순위가 호출처마다 반대**다(진입점은 set 먼저 `resolved.rs:358`, set 내부는 permission 먼저 `:407`) — 후자가 바로 F1 섀도잉이 무한 재귀 없이 조용히 통하는 이유다. 오늘의 매니페스트에는 이름 충돌이 없어 그 비대칭이 **관측 불가**였고(뮤테이션이 살아남았다), 그래서 `shared`가 set이자 permission인 **합성 매니페스트**를 주입해 세 순서를 구분되게 만들었다. 그 픽스처가 제 **순환 가드 버그**도 잡았다 — `key:name`으로만 키를 잡아서 set 방문이 같은 이름 permission의 방문을 막고 있었다(tauri에는 가드가 아예 없다). 뮤테이션 **10/10 kill**(동결 목록에서 항목 삭제·중복, 분해 규칙 변경, 우선순위 2종, 순환 가드 되돌리기 포함) + 기존 21개 회귀 통과. 아래 원문은 이력용:
- ~~**‼️ 권한 **집합**의 확장은 감사하지 않는다 (P2, 가장 값어치 큰 잔여)**~~: `default.json`은 set 형태 권한 4개를 갖는다 — `core:default`·`dialog:default`·`opener:default`·`updater:default`. 테스트는 그 **문자열**만 보고, 그것이 실제로 어떤 커맨드를 허용하는지는 tauri/플러그인 자신의 매니페스트가 정한다. 즉 업스트림 업데이트가 `dialog:default`에 커맨드를 추가하면 **우리 파일에는 diff가 없고 이 락다운도 침묵한다**. 샌드박스 tier에는 이 부류가 없다(명시 `allow-*` 3개뿐) → 경계 자체는 안전하고 위험은 호스트 표면의 조용한 확대다. 제대로 덮으려면 파일이 아니라 resolve된 ACL(`$OUT_DIR`의 생성물)을 읽어야 하는데, 그러면 빌드 산출물에 의존하는 테스트가 되고 "소스가 진실"이라는 이 파일의 성질을 잃는다. 대안: dependabot이 tauri를 올릴 때 `core:default` 확장을 사람이 보게 하는 체크리스트 항목
- **✅ 사실상 해소 (2026-08-09) — 호스트 tier colon 권한 열린 집합 (코드 리뷰 F6)**: 확장 동결이 **커맨드 수준에서** 호스트의 플러그인/코어 표면을 고정한다. `opener:allow-open-path`·`process:allow-exit` 추가는 이제 `the_host_tier_plugin_command_surface_is_frozen`에서 실패한다(E1로 실증). ‼️**남은 좁은 구멍**: 이미 목록에 있는 커맨드만 허용하는 **다른** 권한을 추가하면 확장 결과가 같아서 통과한다(예: `core:window:close`를 주는 또 다른 권한). 권한 *식별자* 집합까지 동결하면 닫히지만, 호스트 권한을 추가할 때마다 두 목록을 고쳐야 해서 비례하지 않는다고 판단. 원문: 샌드박스는 `assert_eq!`로 전체 집합이 고정됐지만 호스트는 (a) bare `allow_*`만 `generate_handler!`와 정확 비교되고 (b) colon 권한은 `log:` **하나만** 거부된다
- **🟡 확장 동결의 유지 비용 (P3, 새 잔여)**: `HOST_PLUGIN_COMMANDS`는 107개다. tauri나 플러그인 업그레이드가 `*:default` 집합을 넓히면 **dependabot PR이 빨간불이 되고** 사람이 새 커맨드를 판단한 뒤 재동결해야 한다. 그게 이 작업의 목적이지만, 릴리스 런북/의존성 업데이트 절차에 "확장 목록 재동결" 단계가 아직 없다 — 처음 발동할 때 당황하지 않도록 적어둘 것
- **🟡 이 파일이 빌드 산출물을 읽는다 (P3, 의도, 기록용)**: `gen/schemas/acl-manifests.json`은 확장이 존재하는 **유일한** 장소이고 gitignored + build.rs가 재생성한다(`cargo test`가 build.rs를 먼저 돌리므로 항상 신선하다). 대안인 "tauri의 permission set을 손으로 복사"는 드리프트할 두 번째 사본을 만든다. 다만 이 파일 나머지가 갖는 "소스가 진실" 성질은 이 부분에서 성립하지 않는다
- **🔵 `tests/acl_lockdown.rs`가 1,530줄 (P3, 새 잔여)**: 그중 107줄이 동결 목록, 테스트 22개. 프로젝트 규약(~300줄, ~500줄 초과 시 분리) 대비 초과. 쪼개려면 발견 로직(`live_capabilities`/`tier_of`)을 `tests/common/mod.rs`로 빼서 `acl_lockdown.rs`(선언 감사)와 `acl_expansion.rs`(확장 감사)가 공유해야 한다. **이번에 일부러 안 했다** — 두 가드가 "무엇이 live인가"에 대해 반드시 같은 답을 써야 하고, 방금 검증을 마친 파일을 재구성하는 위험이 파일 크기보다 크다고 봤다. 공유 모듈은 각 테스트 바이너리에 컴파일되므로 `#![allow(dead_code)]`가 따라온다
- **`.toml`/`.json5`는 거부하고 감사하지 않는다 (P3, 의도)**: capability도 설정도 마찬가지. tauri의 `CAPABILITY_FILE_EXTENSIONS`는 `["json", "toml"]`(+`config-json5`면 json5)이고 **`toml`은 feature 게이트가 없다**. 파서를 하나 더 두는 대신 발견 단계에서 panic시킨다. 포맷을 늘리려면 dev-dependency(`toml`) 추가 + 이 파일 확장이 함께 필요
- **🟡 `--config` 경로가 `src-tauri/` 밖이면 못 본다 (P3, 새 잔여)**: `only_the_canonical_config_declares_the_capability_selector`는 `src-tauri/` 루트만 스캔한다. 지금 릴리스 워크플로가 넘기는 경로는 그 안이지만, 워크플로가 다른 위치를 가리키면 조용히 커버 밖이다. 제대로 하려면 워크플로 YAML에서 `--config` 인자를 파싱해 그 파일이 스캔 대상이었는지 단정 — [[logic-in-a-run-block-has-no-test]] 부류의 작업
- **⬜ `TAURI_CONFIG` 환경변수는 미확인 (P3)**: 보안 리뷰가 "설정이 그 위로 머지된다"고 했으나 **직접 확인하지 않았다** — `config/parse.rs`에 grep 히트가 없었다. 사실이면 선택자의 다섯 번째 소스이고, 빌드 시점 env라 테스트에서 단정할 수 있는지도 별도 확인이 필요하다
- **tier 상수는 여전히 손으로 적은 열거다 (P3)**: `HOST_TARGETS = ["main", "file-*"]` / `SANDBOX_TARGETS = ["plugin-*"]`. 새 윈도우 종류가 생기면 상수를 **의도적으로** 늘려야 하고, 그때 tier 모델을 다시 판단하게 되는 것이 설계 의도다(모르는 글롭은 통과가 아니라 실패). 다만 윈도우 라벨의 진짜 출처는 Rust/TS 생성 코드이므로, 상수와 실제 생성 라벨을 묶는 것은 없다
- **‼️ 뮤테이션 러너 자체의 교훈 (기록용)**: 첫 배터리가 2건을 "SURVIVED"로 오보했다. 원인 둘 — (1) `run()`이 `could not compile`만 찾아서 **build.rs 실패**(`failed to run custom build command`)를 "아무것도 안 깨짐"으로 읽었다, (2) `.toml` 픽스처에 `permissions`가 빠져 있어 가드가 아니라 **빌드**가 먼저 죽었다. 뮤테이션은 `returncode`를 먼저 보고 "어느 이름의 테스트가 죽였는가"를 따로 확인해야 한다. 그리고 픽스처는 **유효해야** 한다 — 무효 픽스처는 가드를 통과하는지 시험하지 못한다

## 2026-08-02 회수 뒷정리 (§69) 범위 밖으로 남긴 것

> `engines.baram` 게이트 + `fetch_registry` 가드 + 로더 거부 메시지 번역 PR에서 **의도적으로** 남긴 항목. 각각 이유가 있어서 안 한 것이지 빠뜨린 것이 아니다.

- **로드 시점에는 floor를 검사하지 않는다 (의도)**: 설치·업데이트만 막는다. 이미 설치된 플러그인을 로드 때 거부하면, 저자가 floor를 과하게 높여 적은 경우(자기 선언이고 검증 수단이 없다) **실제로 잘 돌던 플러그인을 빼앗는다**. 설치 거부는 아무것도 잃지 않지만 로드 거부는 잃는다. 앱을 다운그레이드한 사용자는 여전히 activate에서 죽을 수 있는데, 그 경로는 앱 버전이 내려간 사실 자체가 원인이라 플러그인 쪽 게이트로 다룰 문제가 아니다
- **Install 버튼을 비활성화하지 않는다 (일관성)**: floor 미달을 클릭 후 오류로 알린다. 회수(revocation)도 같은 방식이고, 두 게이트가 서로 다르게 보이는 것보다 낫다고 판단. 더 나은 UX는 카드에서 미리 "Baram 0.6.0 필요"를 보여주는 것 — `PluginCard`에 prop 하나 추가하는 일이라 UI 개편 때 함께
- **회수 안내가 두 번 보인다 (P3, 미해결)**: Installed 행은 `⚠ pluginErrors[id]`와 `PluginRevokedNotice`를 **둘 다** 그린다. 이번에 로더 거부 메시지를 번역했으므로 이제 같은 사실이 같은 언어로 두 줄이다(전에는 영어+한국어라 더 나빴다). 오류 줄을 억제하는 쪽이 깔끔하지만, `pluginErrors`가 없으면 **토글로 켰을 때 아무 반응이 없는** 경로가 생긴다(스토어의 `enabled`는 켜지고 로드는 거부됨). 억제하려면 토글 쪽에 별도 피드백이 먼저 필요하다
- **✅ RESOLVED (2026-08-02, `fix/registry-index-entry-tolerance`)** — 원인의 상위 집합으로 해소: `engines`만이 아니라 **모든** 필수 필드가 같은 문제였고(`license` 하나만 빠져도 동일), `tolerant_entries`로 항목 단위 관대화 + `engines` optional + 발행 게이트를 함께 넣었다. 아래 원문은 이력용:
- **`RegistryEntry.engines`가 Rust에서 필수 필드 (P2, 가용성)**: `#[serde(default)]`가 없어 `engines` 없는 항목 하나가 **인덱스 전체 역직렬화를 실패**시킨다 → 모든 사용자의 마켓플레이스가 죽는다. 같은 파일 `trust: Option<String>` 주석이 이 부류를 이미 설명한다("unknown tier를 여기서 거부하면 미래의 레지스트리 추가가 인덱스 전체의 hard fetch failure가 된다"). 고치려면 TS 타입(`engines: {baram:string}` → optional)까지 파급되므로 분리. 앱 쪽 게이트는 이미 floor 없음을 허용하도록 써서 optional 전환과 호환됨
- **로더 거부 메시지가 시작 경로에서는 영어로 폴백 (P3, 문서화됨)**: 설정 스토어가 `tauriStorage`(비동기)로 persist하고 `initializePlugins`는 App effect에서 돌기 때문에, **rehydration보다 먼저 도달한 시작 시점 로드**는 초기값 `locale:"en"`을 읽어 한국어 사용자에게 영어를 보여준다. 크래시가 아니라 폴백이고 시작 경로에 한정된다(마켓플레이스 경유 로드는 전부 hydration 이후). 옆의 `PluginRevokedNotice`는 `useTranslation` 컴포넌트라 hydration이 착지하면 올바른 언어로 리렌더된다 → **회수 표면을 notice 하나로 모으는 쪽이 근본 해법**이고, 위의 "회수 안내가 두 번 보인다" 항목과 같은 작업이다. 시작 순서를 문자열 하나 때문에 바꾸는 것은 비례하지 않아 `tr()`에 한계를 주석으로 남겼다
- **✅ 대부분 해소 (2026-08-02, #261 PR1)** — `serve_once` 루프백 하네스(의존성 추가 없이 `std::net::TcpListener`)를 넣어 `MAX_REGISTRY_BYTES`·`MAX_REVOCATION_BYTES`·`MAX_PLUGIN_ARCHIVE_BYTES` 3개와 비정상 status 거부를 덮었다. 경계 테스트(정확히 cap이면 통과)도 추가 — `>=` off-by-one 뮤테이션이 그 테스트만 빨갛게 만든다. **남은 것**: (a) `MAX_FETCH_BYTES`(10 MiB, 플러그인 `http_fetch` 경로)는 `ExtensionContext` 경유라 하네스만으로는 안 되고 별도 배선 필요, (b) **타임아웃 3종은 여전히 미검증** — 최단이 30초라 CI가 기다릴 수 없다. 타임아웃까지 덮으려면 `Duration`을 주입 가능하게 만들어야 하는데(캡을 `ExtractBounds`로 뺀 것과 같은 수법), 그 자체가 별도 작업. 아래 원문은 이력용:
- **미검증 캡이 이제 4개다 (P3)**: `MAX_REGISTRY_BYTES`(4 MiB) · `MAX_REVOCATION_BYTES`(1 MiB) · `MAX_FETCH_BYTES`(10 MiB) · `MAX_PLUGIN_ARCHIVE_BYTES`(32 MiB), 그리고 함께 들어간 타임아웃 3종(`connect`/`read`/총 10분). Rust 스위트에 **로컬 HTTP 서버 하네스가 없어** 스트리밍 캡과 타임아웃을 단정할 방법이 아예 없다 — scheme 가드는 요청 전에 거부되므로 hermetic하게 테스트되지만 캡은 실제 응답이 필요하다. 하네스 하나가 4개 전부를 커버하고, 그것 말고는 커버할 방법이 없다
- **`checkForUpdates`가 게이트가 거부할 업데이트를 뱃지로 알린다 (P2, 리뷰 지적)**: `registry-client.ts:19-29`가 tier 없는 항목만 필터한다. floor 미달 대상은 이제 회수 대상과 함께 필터되지 않는 부류다. Phase 6 L1 주석("뱃지 + 활성 버튼은 성공할 수 없는 동작을 약속한다")이 이 코드베이스 자신의 논거. 회수와 일관되지만 **회수는 인덱스에서 항목이 사라져 자연 해소되는 반면 floor 미달은 주기적 체크마다 계속 돌아오고 dismissal도 없다**. ‼️다만 단순 필터는 "업데이트가 있다"는 사실 자체를 숨기므로 더 나쁠 수 있다 — 올바른 해법은 숨기기가 아니라 **"Baram 0.6.0 필요"로 다르게 라벨된 뱃지**이고, 그건 위의 "Install 버튼 비활성화" 항목과 같은 UI 작업이다. `checkForUpdates`에 `getVersion()` 한 번이면 판정은 가능
- **`engines.baram` 문법을 레지스트리 CI가 검사하지 않음 (P3)**: 발행 워크플로는 first-party 태그에서만 `>=X.Y.Z`를 강제한다. 커뮤니티 항목이 `^0.6.0`으로 들어오면 앱은 "floor 없음"으로 읽어 조용히 보호를 멈춘다(거부가 아니라 무시 — 사용자를 저자 실수로 벌주지 않기 위한 방향). `validate-revocations.ts`의 형제로 인덱스 검증기를 두는 것이 자연스러움

## 2026-08-02 회수 목록 항목 추가 (§69) — 보안 리뷰가 짚은 인프라 선결 과제

> `baram-ai-summary` 회수 기록 PR(#353)의 보안 리뷰에서 나온 항목. **셋 다 이 커밋이 만든 것이 아니라 회수 인프라의 기존 성질**이고, 이번 항목이 `unlisted`라 실질 영향은 없다. 다만 언젠가 `malicious` 항목을 발행하는 순간 셋 다 즉시 실효성 문제가 된다.

- **✅ RESOLVED (2026-08-03, PR #365 `feat/revocation-list-signing`)** — minisign 서명(Rust `verify_revocation_signature`) **+ 단조 증가 카운터**(`sequence`) 두 짝이 함께 들어갔다. 서명만으로는 부족하다는 것이 레지스트리 자기 이력으로 증명된다: 빈 목록 `{"version":1,"revoked":[]}`이 31시간 라이브였으므로(`395b914`→`aa4a218`) 서명 후 그 문서는 **영구히 유효한 서명**을 갖고, 리플레이하면 위조 없이 모든 회수가 사라진다. ‼️이 PR은 **아직 무장 안 됨** — `REVOCATION_PUBLIC_KEY`가 빈 문자열이다. 서명된 목록이 발행되기 **전에** 무장하면 모든 클라이언트가 라이브 목록을 거부하고 신규 설치는 회수를 하나도 못 받는다. 순서 강제: 발행 먼저, 무장 나중. 아래 원문은 이력용:
- **회수 목록에 서명이 없다 (P2)**: 무결성 보장이 TLS뿐이다. 그리고 **잘 형성된 빈 목록**(`{"version":1,"revoked":[]}`)은 정상 수용되어 저장된 목록을 **대체**한다 — 오탐 회수를 되돌릴 수 있어야 하므로 의도된 동작이지만, 뒤집으면 Pages 배포 탈취나 악의적 호스트가 빈 목록 하나로 **모든 회수를 조용히 해제**할 수 있다는 뜻이다. 클라이언트 측 검사로는 "진짜 빈 목록"과 "비워진 목록"을 구분할 방법이 원리적으로 없다. 코드가 이미 인정하고 있다 — `revocation-client.ts`의 `safeParse` 주석: *"signing the list is what closes that, and it is the next step in the spec"*. 앱은 이미 updater(§206)에서 minisign 키를 운용하므로 키 관리 패턴을 재사용할 수 있지만, 발행 키 보관·회전과 앱 측 검증 경로가 함께 필요해 별도 작업
- **첫 실행에 회수가 적용되지 않을 수 있다 (P3)**: 초기 상태는 `revocations: null`이고 `revocationFor`는 null 목록에 대해 null을 반환한다. 플러그인 로드 전에 `REVOCATION_REFRESH_BUDGET_MS`(1500ms, `revocation-client.ts:24`) 예산으로 fetch를 시도하지만, 느린 네트워크에서 타임아웃하면 그 세션은 **회수 목록 없이** 플러그인을 로드한다. `unlisted`는 애초에 로드를 막지 않으므로 지금은 무관하고, `malicious` 항목이 생기면 첫 실행이 유일한 구멍이 된다
- **✅ RESOLVED (2026-08-02, PR #354 `feat/orphan-archive-defers-to-revocations`)** — 경고가 `revoked.json`을 참조해 기록된 회수는 notice로 낮춘다. 구멍이 되지 않도록 두 가지 거부: (1) 엔트리가 아카이브의 **버전**을 실제로 커버해야 함(앱의 `revocationFor` 재사용 — `lt: 2.0.0`짜리 엔트리가 `-3.0.0.zip`을 침묵시키면 안 됨), (2) 두 revoked id가 같은 파일을 주장하면 **아무것도** 인정하지 않음(`a`/`a-1` 모호성). 읽기 실패 = 인정 0건(전부 경고, 시끄러운 방향). `archiveBelongsTo`를 공유 술어로 추출해 prefix-hiding 규칙이 한 벌만 존재. 뮤테이션 5종 각각 정확히 named test 1개가 사망시킴. 아래 원문은 이력용:
- **고아 아카이브 경고가 회수 목록을 참조하지 않는다 (P3, 첫 실전 런에서 관찰)**: `validate-registry-assets.ts`의 "belongs to no listed plugin" 경고는 **결정을 강제하기 위해** 존재하는데, 이제 그 결정이 한 디렉터리 옆에 기계가 읽을 수 있는 형태로 있다(`revoked.json`의 `baram-ai-summary`). 그런데 검증기는 그걸 안 읽어서 **이미 명시적으로 결정된 건에 대해 매 런마다 영구히 경고**한다. 회수 스펙 자신의 논거가 그대로 적용된다 — "전부에 대해 뜨는 알림은 정작 하나가 중요해질 때쯤 무시할 가치가 된다"(`revocation.ts:9-13`가 `unlisted`를 사용자에게 안 보여주는 이유). 고아 아카이브의 id가 `revoked.json`에 있으면 notice로 낮추고, **없을 때만** 경고로 남기면 경고가 "인지되지 않은 회수"라는 실제 신호를 되찾는다. 검증기가 `revoked.json`을 읽게 되므로 인자 하나 추가(현재는 레지스트리 루트만 받음)
- **`http://` 레지스트리에 loopback 제한이 없다 (P3, PR #364 보안 리뷰 LOW-1)**: origin 핀은 http에서도 정상 동작하지만 **평문은 무결성이 없다** — 중간자가 인덱스와 아카이브를 함께 고쳐쓰면 핀은 이제 공격자가 통제하는 origin에 대해 성립한다. `http`를 loopback(`127.0.0.1`/`localhost`/`[::1]`)으로 제한하는 방안을 검토했으나 **하지 않았다**: 자체 호스팅 LAN 레지스트리(`http://registry.internal/`)를 깨뜨리는 제품 결정이고, 다운로드 핀의 범위가 아니다. 현재 이 URL을 설정하는 UI 자체가 없고(기본값 https, 스토어 상태뿐) 도달하려면 스토어 손편집 또는 realm 장악이 필요하다. ‼️핀이 http에서도 보장하는 것: 아카이브는 인덱스와 **같은 스킴**이어야 하므로 https 레지스트리가 http로 끌어내려지는 일은 없다. 제한을 넣기로 결정한다면 `validate_http_url`(플러그인 `http_fetch`도 공유 — 평문 API를 호출하는 플러그인을 깨뜨림)이 아니라 `registry_base` 쪽에 넣어야 한다
- **레지스트리 검증 스크립트에 입력 크기 상한이 없다 (P3, PR #354 보안 리뷰 LOW)**: `validate-registry-assets.ts`가 `revoked.json`을, `validate-index.ts`가 `index.json`을 상한 없이 `readFileSync`+`JSON.parse`로 읽는다. 레지스트리 `validate.yml`은 `pull_request_target`이라 이 파일들은 **PR이 통제**한다. 실질 위험은 낮다 — GitHub 파일 크기 제한·PR diff 제한·CI 타임아웃(10분)이 외부에서 묶고, 스크립트는 어차피 모든 ZIP을 해시하려 읽는다. ‼️**한 스크립트에만 넣으면 안 된다** — 나머지가 갖지 않은 보호를 가진 것처럼 보이게 만드는 `emit_filter` 패턴(§260 3c-2b에서 rate limiting을 같은 이유로 뺐다). 넣는다면 세 검증기 일괄로, 파일 크기 + 엔트리 수 둘 다. 수치는 앱 런타임의 `MAX_REGISTRY_BYTES`(4 MiB)/`MAX_REVOCATION_BYTES`(1 MiB)를 그대로 쓰면 CI와 런타임이 같은 말을 하게 된다
- **⬜ 오늘은 도달 불가 — 미래 기능의 제약으로 재분류 (2026-08-06 확인)**: 이 공백은 `setRegistryUrl` 호출을 전제하는데 **프로덕션 호출자가 0개**이고 URL이 영속되지 않는다(위 HIGH-1 RESOLVED 참조). in-realm 공격자에게는 목록을 비우는 것이 **목적**이지 부작용이 아니므로, 지금 고칠 버그가 아니라 **레지스트리 URL 설정 기능을 만들 때 함께 정해야 하는 항목**이다. 그때의 선택지: (i) 첫 성공 fetch까지 플러그인 로드 보류(fail-closed), (ii) 비우고 눈에 띄는 배너(fail-open이지만 가시적), (iii) 새 레지스트리가 답할 때까지 이전 목록 유지 — (iii)은 **틀렸다**(우리 목록이 남의 플러그인을 지배). ‼️자체 호스팅은 보통 `revoked.json`을 404하므로 "다음 성공 fetch까지"가 실질적으로 **영구**가 된다(코드 주석이 그렇게 적고 있다). 원문: `setRegistryUrl`이 `revocations: null, revocationsFetchedAt: 0`으로 리셋한다(`stores/.../plugin.ts:287`). 레지스트리마다 자기 목록을 갖는다는 설계상 옳지만, 다른 레지스트리로 갔다가 **돌아오는** 동안 다음 fetch까지 아무 회수도 적용되지 않는 창이 열린다. 마켓플레이스 UI가 stale 경고를 그리는 것과 같은 부류의 사실이므로, 표시로 해결할지 fetch를 기다릴지가 결정 사항

## 2026-08-06 결정 — 레지스트리 URL은 설정하지 않는다 (A안)

> **사용자 결정 2026-08-06: A안(현행 유지).** 4번(registryUrl UI)과 5번(URL 변경 시 회수 공백)은 **하나의 제품 결정**이었고, 답은 "설정 기능을 만들지 않는다"다. 따라서 5번은 구현 대상이 아니라 **미래 기능의 제약**으로만 남는다.

- **왜 A안인가**: 보안 절반은 이미 `5cba3e2d`로 닫혀 있었고(영속 제거 → 세션 범위로 축소 + self-heal 복원), 남은 것은 "대체 레지스트리를 지원할 것인가"라는 범위 질문이었다. 현재 공개 레지스트리 1개·발행 플러그인 1개 규모에서 C안(완전 설정)이 되살리는 위험 대비 얻는 사용자가 없다. 레지스트리 자체가 first-party 전용이므로 잃는 것도 없다
- **기록 위치 3곳**: `DEFAULT_REGISTRY_URL` docstring(되살릴 때 함께 답해야 하는 3가지 명시) · 이 항목 · `docs/plugin-development.md`
- **가드 추가** `src/plugins/__tests__/registry-url-stays-fixed.test.ts`: 프로덕션 `setRegistryUrl(` 호출 0건 · `settings-registry.ts`에 `registryUrl` 없음 · 결정 문구가 스토어에 남아 있음 · 스캐너가 200개 이상 파일을 본다(공허 방지). ‼️이유: 기존 주석이 "호출자가 없다"고만 말했고 **아무것도 단정하지 않았다** — A안이 바로 그 전제 위에 서 있다. mutation 3개 kill(컴포넌트가 호출 시작 / 설정 필드 추가 / 결정 문구 삭제). 알려진 구멍: `store["setRegistryUrl"](…)` 형태의 동적 호출은 회피 가능(코드베이스에 그런 패턴은 없음)
- **‼️ 공개 문서가 틀려 있었다 (이번에 발견)**: `docs/plugin-development.md`가 개발자에게 "앱을 닫고 `config.json`의 `state.registryUrl`을 고쳐라"라고 안내했는데, 2026-08-04부터 그 값은 rehydrate에서 폐기된다 — **조용히 무시되고 에러도 없이 라이브 레지스트리를 계속 가져온다**. 3곳 수정: (1) "persisted field" → 고정값 + 비설정 이유, (2) 로컬 테스트 절차를 "dev 체크아웃에서 `DEFAULT_REGISTRY_URL` 상수를 바꿔라"로 교체(+ non-first-party는 서명 검증이 꺼진다는 사실 명시), (3) "typically your own self-hosted index.json" → 지금은 도달하는 사용자가 없다는 경고 + Developer 섹션 폴더 로드 안내
- **부수 확인**: `PluginDeveloperSection`은 dev 게이팅이 없어(`PluginMarketplace.tsx:1257`) release에서도 폴더 로드가 가능하다 — 서드파티 배포의 현실적 경로이며 문서에 그렇게 적었다

## 2026-08-05 무장 startup 경로 (§69, PR B) — 리뷰가 남긴 것

- **🟡 회수 fetch에 origin-pinned 리다이렉트 정책이 없다 (보안 리뷰 LOW-2, 기존 문제)**: `revocation_http_client`는 reqwest 기본 `Policy::limited(10)`이고 `validate_http_url`은 **최초 URL의 스킴만** 검사한다 → 임의 호스트(루프백·사설 IP 포함, 이건 의도된 허용)로 최대 10홉 따라간다. 즉 status oracle이 로그로 새는 **blind SSRF GET**. ‼️무결성은 위험하지 않다 — `needs_signature`가 원래 URL로 결정되고 본문은 컴파일된 키로 검증되므로 리다이렉트로 위조 목록을 통과시킬 수 없다. 고칠 자리는 이번 PR이 만든 `revocation_http_client` 한 곳이고, 재사용할 정책도 이미 있다(`redirect_within_registry` + `is_within_registry`, `mod.rs:834`가 다운로드에 쓴다). **PR B 범위 밖으로 뺀 이유**: 서드파티(자체 호스팅) 레지스트리가 정당하게 리다이렉트하면 깨지는 동작 변경이고, 이 프로젝트는 그 종류의 결정을 따로 다뤄왔다(`http://` LAN 레지스트리 허용 결정과 같은 부류). 메시지 문구도 `redirect_within_registry`가 "plugin download"로 하드코딩돼 있어 파라미터화가 함께 필요
- **⬜ 철회 (2026-08-05) — "첫 클라이언트 생성 1.08초가 예산을 잡아먹는다"는 debug 전용 인공물이었다**: 측정치는 실재하지만 프로파일 의존이다 — **debug: 1st=1.079s / 2nd=0.53ms**, **release: 1st=10.5ms / 2nd=0.14ms**(약 100배 차이, 최적화 없는 인증서 파싱). 출시 빌드는 release이므로 `REVOCATION_REFRESH_BUDGET_MS = 1500` 대비 10.5ms는 노이즈고, **제품 문제가 아니다**. 제가 debug 수치만 보고 🔴로 올렸다가 release를 재보고 철회. ‼️남는 진짜 항목은 **테스트 쪽**뿐: 테스트 바이너리는 debug이므로 그 1.08초가 wall-clock 단정 안에 들어갔고, 그래서 `the_signed_pair_is_fetched_concurrently_not_in_sequence`가 단독 실행 시 3/3 실패했다(`69eb0d3f`에서 warm-up으로 수정). eager warm-up 같은 제품 변경은 **불필요**. 교훈: 시작 지연 주장을 debug 프로파일에서 측정하지 말 것
- **🟡 신규 설치의 fail-open은 완화됐을 뿐 닫히지 않았다**: 왕복 2회 → 1회로 확률을 줄였지만, RTT가 1500ms를 넘기면 여전히 `plugin-lifecycle.ts`가 저장된 목록(신규 설치 = 없음)으로 로드한다. 레버는 클라이언트가 아니라 **예산이나 순서**다 — 예: 첫 실행에서만 예산을 늘리거나(저장 목록이 없을 때), 회수 목록이 없으면 플러그인 로드를 미루는 선택
- **🟢 rehydrate 경로에는 항목 수 상한이 없다 (보안 리뷰)**: 1MB 캡은 fetch 전용. trusted 티어가 이미 가진 권한에 비하면 사소하지만 기록
- **🟢 `revoked` 전체를 지우는 denial은 (d)에게 여전히 가능**: 플러그인 id마다 항목 하나가 필요하고(`revocationFor`가 정확 일치 요구) 다음 성공 refresh에서 자기치유되며 `registryUrl`이 비영속이라 치유 fetch를 리다이렉트할 수도 없다. 기존 성질, 경계 있음
- **🟡 공유 클라이언트의 이득에는 테스트가 없다 (3차 코드 리뷰 MEDIUM)**: 이 PR이 `revocation_http_client`를 도입한 근거의 절반(h2 origin에서 한 연결로 두 요청, 다음 refresh의 풀 재사용)은 **되돌려도 4개 테스트가 모두 초록**이다 — 테스트가 측정하는 동시성은 `join!`에서 나오기 때문. 고정하려면 h2 픽스처가 필요하고 이 스위트에는 없다. ‼️동시성 자체는 accept 시각으로 고정돼 있으니 위험은 "성능 이득이 조용히 사라짐"뿐
- **🟡 "읽을 수 없는 목록"은 분류기를 타지 않고 조용히 warn된다 (기존 동작, 2026-08-05 확인)**: `refreshRevocations`는 `normalizeRevocationList`가 null이면 loud/quiet 분류기 **이전에** `logger.warn("unreadable list, keeping the stored one")`으로 빠진다. 주석의 근거("botched deploy가 모든 클라이언트를 조용히 무장해제하지 않게 저장 목록을 유지")는 **저장 목록 유지**를 정당화하지만 **조용함**을 정당화하지 않는다 — 서명은 통과했는데 문서가 깨진 상태는 정의상 구조적 실패이고, loud 채널이 존재하는 이유가 바로 그것이다. 즉 잘못된 배포가 `logger.warn`(dev 외 억제)에만 남는다. ‼️PR B가 만든 것이 아니고 fetch 오류 경로도 아니어서 docstring 열거에서 빠진 것은 맞다. 고칠 때는 "목록 유지 + `logger.error`"로 두 결정을 분리
- **🟡 body-ok + 서명 전송 실패는 여전히 loud (대칭·내재)**: 분류기가 `signature|unsigned`를 구조적 실패로 읽는데, "서명에 도달 못 함"과 "서명이 없음"은 클라이언트 관점에서 같은 관측이다. 즉 `.sig`만 닿지 않는 평범한 네트워크 상황이 `logger.error`로 간다. 정확히 구분하려면 전송 실패와 HTTP 응답을 서명 쪽에서도 나눠 전달해야 함 (메시지 계약 확장)
- **🟢 프로세스 1회 초기화 ~1.4초를 wall-clock 단정이 재던 문제 (자체 발견, `69eb0d3f`에서 수정)**: `the_signed_pair_is_fetched_concurrently_not_in_sequence`가 **단독 실행 시 3/3 실패**했다 — 프로세스 첫 HTTP fetch가 ~1.4초 1회성 비용을 내고 `elapsed < delay*2`가 그걸 포함해 재고 있었다. 형제 네트워크 테스트가 프로세스를 먼저 데워주기 때문에 모듈 전체 실행에서만 초록. 즉 `cargo test --exact`와 **테스트별 프로세스 러너(nextest)에서는 항상 빨강**. warm-up fetch를 시계 앞에 넣어 수정하고, 113개 전부 **1테스트 1프로세스**로 돌려 순서 의존 0을 확인. ‼️교훈: 이 스위트는 nextest로 돌리면 이런 종류가 더 나올 수 있다 — 도입 시 일괄 점검 필요

## 2026-08-05 발행 파이프라인 무결성 (§69, PR A) — 새로 발견 / 남긴 것

- **🔴 `.gitignore`의 파이썬 템플릿 규칙이 새 소스 디렉터리를 통째로 삼킨다 (새로 발견)**: `scripts/lib/`에 모듈을 만들었더니 `git status`에 **아무것도 안 나왔다** — `.gitignore:362`의 `lib/`(Python 템플릿 잔재)가 매치한다. 그대로 커밋하면 import가 깨진 채 push되고 CI만 빨개진다. 이번엔 `scripts/`로 평평하게 옮겨 회피했지만, **디렉터리를 새로 만들 때마다 `git check-ignore -v <path>`를 확인해야 하는 상태**가 남아 있다. `lib64/`·`lib-cov`·`dist/` 등 다른 템플릿 규칙도 같은 성질. 정리하려면 규칙별로 프로젝트에 실제로 필요한지 확인 후 삭제 또는 `!scripts/**` 형태의 negation
- **🟡 시크릿 스캔 테스트는 드리프트 가드이고 공격자 통제가 아니다 (보안 재리뷰 M-3)**: allowlist로 바꿔 bracket 인덱싱·대소문자 변형·`toJSON(secrets)` 전체 덤프까지 잡지만, **이 파일 하나만 읽는다** — 머지 권한이 있으면 `.github/workflows/새파일.yml`을 추가하면 된다. 즉 "이 워크플로의 우발적 확대"를 막는 것이 전부이고, 그것이 원래 목적. 실제 통제는 필수 리뷰어가 붙은 `environment:` 하나뿐(위 항목)
- **🟢 CLI 동결쌍 self-check는 HIGH-2의 종결이 아니다 (보안 재리뷰 정정)**: 종결은 **두 앵커**다 — vitest가 스크레이프한 키를, `mod.rs` 테스트가 컴파일된 키를 같은 동결 쌍에 묶으므로 divergence가 자기모순이 된다(어느 방향이든 한쪽이 빨간불). CLI의 검사는 발행 시점 defence-in-depth이고, **동시에 fixture 문제를 전면 발행 중단으로 바꾸는 유일한 지점**. 정상 키 로테이션은 같은 커밋에서 fixture를 재동결해야 하는데(Rust 테스트도 이미 요구) **로테이션 런북이 없다**
- **🟡 Pages 재시도 루프의 로직은 여전히 실행되지 않는다 (3차 코드 리뷰 MEDIUM-4)**: 네트워크 IO + 최대 300초라 게이트·floor 스텝처럼 추출해 돌릴 수 없다. `exit 1` → `exit 0` 뮤테이션이 생존했고("Pages가 이 런의 바이트를 서빙하지 않음"이 초록불이 되고, 뒤따르는 무조건 검증 스텝이 **낡은 쌍**을 검증해 통과) 지금은 **텍스트 가드**로만 잡는다 — 스텝 마지막 문장이 non-zero exit인지 단정. 삭제는 잡고 로직은 못 잡는다. 제대로 하려면 재시도 횟수·sleep을 env로 빼야 하는데(테스트 전용 시임) 그 자체가 드리프트 원인
- **🟢 카운터 정수 검증 루프 2개는 도달 불가 (3차 코드 리뷰 MEDIUM-5)**: `revocation-sequence.ts`가 항상 숫자만 출력하므로 belt-and-braces이지만, 주석은 특정 fail-open(`[ x -le 1 ]`이 exit 2 → `if`가 false → `set -e` 면제)을 **막았다고** 읽힌다. 막는 것은 리더 쪽이고 이 루프가 아니다
- **🟢 등가 뮤턴트로 확인된 것들 (3차 코드 리뷰 LOW-5)**: trusted comment 접두사 `startsWith`→`includes`, 주석 슬라이스를 고정 17 대신 `indexOf`, 알고리즘 마커를 `latin1` 대신 `utf8`로 읽기 — 원리상 Rust와 다르지만 구분되는 모든 입력이 다른 이유로 이미 거부된다. **수정에 시간 쓸 곳이 아님**을 기록
- **🟢 커버리지 밖으로 명시된 두 곳**: `.github/actions/setup-node`(composite action이라 시크릿 allowlist가 볼 수 없음 — 그 테스트 주석도 인정), 레지스트리 저장소의 `validate.yml`
- **🟡 `minisign-verify = "0.2"` 세미버 범위가 두 구현을 묶어두지 않는다 (양쪽 리뷰가 각자 지적)**: 패치 범프가 Rust 쪽 디코더 엄격성을 바꿀 수 있고, 이 저장소에는 둘을 함께 고정하는 것이 없다. 동결 픽스처는 **하나의 정상 쌍에 대한 합의**만 앵커할 뿐 거부 동작의 합의는 아니다. 대안: `Cargo.toml`에서 `=0.2.5`로 핀(디펜다봇이 올릴 때 Node 쪽도 함께 보게 됨) 또는 CI에 "두 구현이 같은 입력을 같게 거부한다"를 확인하는 잡(= Rust 빌드 필요)
- **🟢 CLI의 동결쌍 self-check는 테스트가 없다**: `verify-revocation-signature.ts`가 스크레이프한 키로 동결 쌍을 먼저 검증하는데(HIGH-2 대응), Rust 소스 경로가 설계상 고정이라 **주입 지점이 없어** 이 검사의 삭제를 잡는 테스트가 없다. 경로를 인자로 열면 워크플로가 쓰지 않는 인자가 생겨(테스트 전용 훅) 그 자체가 드리프트 원인 — 그래서 의식적으로 미고정. 매 실행이 정상 경로로 이 검사를 통과하므로 "깨져 있는데 초록불"은 불가능하고, 위험은 조용한 **삭제**뿐
- **🟡 `scripts/`가 `lint:ts` 사각지대 (코드 리뷰 LOW-11)**: `lint:ts`는 `eslint src/`, knip의 `project`도 `src/**`+`site/**`. `npx eslint scripts/`는 **29건** 보고(이번 PR의 신규 2파일 5건은 수정했고, 남은 24건은 기존 파일 — `update-registry-index.mjs`의 `no-undef` 4건은 env 설정 필요, 나머지는 perfectionist 정렬). 확장하려면 24건 선처리 필요. ‼️`perfectionist/sort-modules` 자동수정은 선행 주석을 함께 옮기므로 `check-doc-comments.mjs`와 함께 돌릴 것
- **🟢 job `timeout-minutes: 10` vs verify 루프 최대 300초 (보안 리뷰 LOW-1)**: job 타임아웃으로 죽으면 `always()` 스텝도 실행되지 않을 수 있어 deploy 키가 런너에 남는다. 런너가 일회용이라 잔존 위험은 작지만, `always()`가 "모든 실패 경로"를 덮는다는 주장에는 예외가 있다
- **🟢 bootstrap 분기는 게이트의 유일한 무검증 경로 (코드 리뷰 LOW-6)**: 레지스트리의 `revoked.json`을 지우면 어떤 카운터든(라이브보다 낮아도) 통과한다. 회귀는 아니고(이전 `curl -fsS` 실패 스킵도 동일하게 관대) floor 스텝이 사후에 항의하지만, 기록해 둠
- **🟢 `expect(served.condition).toBeNull()`은 조용히 통과할 수 있다 (코드 리뷰 LOW-10)**: 미래에 `if:`를 `/^if:/`가 놓치는 형태로 쓰면 실패 방향이 조용하다
- **🟡 클론/서명/푸시 스텝의 셸은 여전히 테스트가 없다**: 게이트·floor·검증 스텝은 추출해 실제 셸로 돌리지만, `git clone --config core.sshCommand=…` / `cp` / `git push`는 push된 main만 실행한다. `--config`가 클론에 **영속**하는 성질(다음 스텝의 push가 이걸 쓴다)은 로컬 bare 저장소로 수동 확인함. 남은 미검증: SSH가 `~` 경로를 실제로 해석하는지(기존 워크플로가 `GIT_SSH_COMMAND`로 같은 문자열을 이미 쓰고 있어 동일하다고 판단)
- **🟢 floor 게이트의 정수 검증 루프와 마찬가지로, 새 검증 스텝의 인자 개수·경로 오타는 커버 밖**: `verify-revocation-signature.ts`의 usage 분기(exit 2)와 미무장(빈 키, exit 1) 분기는 CLI 테스트가 없다. 전자는 즉시 빨간불이라 무해하고, 후자는 무장 이후 도달 불가 — 다만 **누군가 키를 비우면 발행이 막힌다**는 것이 의도임을 기록(관대한 스킵을 일부러 택하지 않았다)

## 2026-08-04 무장 (§69, PR #367) 리뷰 — 범위 밖으로 남긴 것

> 코드/보안 리뷰 모두 "arming should proceed". CRITICAL 없음. HIGH-1(새 필드 `revocationsVerified`의 read-side 무테스트)·MEDIUM-1(`always()`→`success()`)·MEDIUM-2(MAX_LAG 5→1)·MEDIUM-4(래퍼 비교 우회 + 키↔서명 결합 테스트)·LOW 3건은 PR 안에서 닫고 각각 뮤테이션으로 고정했다. 아래는 의식적으로 남긴 것.

- **🔴 런북 §5의 3분의 1이 미구현 — 실효 registry URL을 표시하지 않음 (코드 리뷰 MEDIUM-3)**: 새 notice는 "서명이 검증되지 않았다"고만 말하고 **어느 레지스트리에서 온 목록인지 말하지 않는다.** MEDIUM-4가 애초에 제기된 공격이 **리다이렉트된 레지스트리**이므로, 사용자는 "내가 설정한 커스텀 레지스트리(예상됨)"와 "누가 나를 리다이렉트했다"를 구분할 수 없다. ‼️완화 요인: `registryUrl`이 더 이상 영속되지 않으므로(#365) 리다이렉트는 세션 범위이고 재시작이 치유한다. 넣는다면 placeholder를 가진 i18n 키 하나 + 첫 파티 여부 판정. **커밋 메시지가 항목 4를 완료로 표현했는데 이 부분은 빠져 있었다 — PR 본문에서 정정함**
- **🟢 무장 이후 unverified 목록에도 타임스탬프를 계속 찍는다 (런북 §5의 나머지, 코드 리뷰 MEDIUM-3)**: `plugin.ts`의 `setRevocations`가 `revocationsFetchedAt`을 무조건 갱신한다. 원래 의도는 "armed 이후 unverified에는 찍지 않기"였으나, 새 notice가 그 상태를 **더 직접적으로** 알리므로 타임스탬프를 왜곡하는 것보다 낫다고 판단해 하지 않았다(왜곡하면 서드파티 레지스트리 사용자의 stale 기능이 영구히 깨진다). 결정으로 기록
- **🟡 refresh가 현재 동작하는지와 목록의 출처를 구분하지 못함 (보안 리뷰 residual)**: `revocationsVerified`는 **저장된 목록의 출처**를 말하고 refresh가 지금 되는지는 말하지 않는다. 공격자가 정품 쌍을 영구히 서빙하거나 `.sig`만 404하면 클라이언트는 마지막 정상 목록에 머물고 notice는 조용하며 stale 배너는 30일 뒤에 뜬다. fail-open에 내재된 성질이지만, **"notice 없음 = 보호가 지금 작동 중"으로 읽혀서는 안 된다**
- **🟢 `revocationsVerified`가 결정 입력이 되는 순간 mark와 같은 클래스가 된다 (보안 리뷰 권고)**: 현재는 UI 전용이고 어떤 로드/카운터 판단에도 들어가지 않으므로 영속이 안전하다(심어진 `true`는 진짜 목록을 거부할 수 없고, 다음 startup refresh가 목록과 플래그를 함께 덮어쓴다). 이걸 읽어 작업을 건너뛰거나 카운터를 신뢰하기 시작하면 durable-denial primitive가 된다 — docstring에 한 줄 경고 필요
- **✅ RESOLVED (2026-08-05, PR A 리뷰 2라운드) — `~/.ssh/plugins_deploy`가 런너에 남는다**: 1차 수정은 `if: always()` 삭제 스텝만 추가했고, **키의 디스크 수명은 그대로**였다(클론~cleanup 사이 4스텝, 그중 3개가 `npx` 실행 — 이번 PR이 게이트에 `npx tsx`를 하나 더 추가). ‼️그때 제가 백로그에 적은 정당화("신뢰 수준은 `npx tauri signer sign`과 동일")는 **틀렸다** — 서명 키는 의도적으로 한 스텝 env로 좁혔으니 비대칭이고, **머지 커밋 없이도** 악성 전이 의존성이 레지스트리 push 권한을 가져갈 수 있다(= 회수 메커니즘이 공격자에게 없다고 가정하는 바로 그 권한). 최종: 클론 스텝이 쓰고 **즉시 삭제**, push 스텝이 다시 씀, `always()` cleanup은 백스톱으로 유지. 두 write 사이트를 테스트가 파생해 단정(뮤테이션 S12). 원문: sync 스텝이 키 파일을 쓰고 지우지 않는다. 이후 스텝(`npx tsx`)이 저장소 TypeScript를 실행하므로 악성 main 커밋이 읽을 수 있다 — main push가 전제라 신뢰 수준은 `npx tauri signer sign`과 동일. sync 스텝 끝에 `rm -f`
- **🟢 floor 게이트의 정수 검증 루프는 실제로 도달 불가 (코드 리뷰)**: 두 피연산자가 정수만 출력하는 스크립트에서 오므로 어떤 테스트도 그 제거를 잡을 수 없다. defence-in-depth로는 타당하지만 **커버된 것으로 착각하지 말 것**

## 2026-08-04 회수 목록 서명 (§69, PR #365) 리뷰 3라운드 — 무장 전 필수 + 이월

> 코드/보안 리뷰가 각각 독립적으로 같은 결론에 도달: **PR이 제거했다고 주장한 "영구 disarm"은 다른 경로로 그대로 남아 있다.** CRITICAL(zustand `merge`)은 PR 안에서 닫았고 뮤테이션 2종으로 고정. 아래는 남은 것.

- **✅ RESOLVED (2026-08-04, 사용자 결정 (a))** — `registryUrl`을 영속에서 제외. ‼️핵심: 제거는 `partialize`가 아니라 **`merge`** 에서 이뤄진다 — `partialize`에만 넣고 뮤테이션을 돌려보면 전 테스트가 green이다(읽기 측이 강제 리셋하므로). 즉 `partialize` 쪽은 defence-in-depth(더 이상 복원하지 않는 값을 계속 쓰지 않기 + `config.json`에 권위 있어 보이는 낡은 값을 남기지 않기)이고, 구멍을 닫는 것은 `merge`다. 양쪽 각각 이름이 맞는 테스트로 고정되고 각자의 뮤테이션에서 사망. 읽기 측 테스트는 필드가 아니라 **fetch 대상**을 단정한다(리다이렉트가 공격의 전부이므로). 부수: v1→v2 `registryUrl` 마이그레이션이 스토어에 도달하지 않게 됨 — 영속하지 않는 것이 더 강하게 같은 목적을 달성하므로 subsumed. 함수와 테스트는 유지하되 describe 블록에 "live 동작 커버리지가 아님"을 명시. 수용한 비용: 커스텀 레지스트리가 재시작 후 초기화(설정 UI가 없어 해당 사용자가 존재하지 않음). 아래 원문은 이력용:
- **✅ RESOLVED (2026-08-04, `5cba3e2d` "stop restoring a persisted registryUrl — it outranked the counter entirely")**: 선택지 (a)를 채택 — `partialize`에서 제외 + `merge`가 `registryUrl: current.registryUrl`로 덮음. 2026-08-06 코드로 재확인: 프로덕션 `setRegistryUrl` 호출자 **0개**(테스트만), Settings 필드 없음, 손으로 편집한 `config.json` 값도 rehydrate에서 **폐기**. 남은 표면은 in-realm(trusted 플러그인)이 **세션 내에서** 호출하는 것뿐이고, 재시작하면 사라지며 startup refresh가 first-party로 복귀 = **self-heal 회복**. `revocationSequenceSeen: {}`도 merge에서 리셋되어 durable denial도 제거. ‼️대가: 대체·자체 호스팅 레지스트리를 **설정할 방법이 아예 없다**(제품 범위 결정으로 이월, 아래 §"레지스트리 URL 설정 여부"). 원문: `setRegistryUrl`은 **앱 전체에 호출자가 없고**(grep: 정의 자신뿐) Settings UI에도 필드가 없다 — 즉 사용자가 값을 보거나 되돌릴 수단이 없는데 `partialize`로 **영속**된다. trusted 플러그인이 한 줄로 `setRegistryUrl("https://evil.test/r/index.json")`을 호출하면: (1) 같은 호출이 `revocations: null`로 초기화해 즉시 fail-open, (2) 재시작 후 `registryUrl` 복원, (3) startup refresh(플러그인 로드 **이전**에 await되는 경로)가 공격자 origin을 fetch, (4) Rust가 `!starts_with(FIRST_PARTY_REVOCATION_PREFIX)`로 서명을 **가져오지도 않고** `verified:false` 반환, (5) TS가 공격자의 빈 목록을 저장하고 gate를 지배. 플러그인 제거 후에도, 서명 무장 후에도 유효하며 **self-heal 하지 않는다** — 치유해 줄 fetch가 공격자를 향하기 때문. 리뷰어가 PoC로 재현. mark와 달리 arming이 무력화하지 못함. ‼️**이건 이 PR이 만든 것이 아니라 기존 성질**이지만, "durable primitive를 거부했다"는 PR의 논증을 반박한다. 선택지: (a) `registryUrl`을 영속에서 제외, (b) 영속값이 first-party prefix가 아니면 거부/경고, (c) 사용자가 보고 되돌릴 수 있는 UI를 먼저 만들기. **결정 필요**
> **라우팅 결정 (2026-08-04)**: 아래 "무장 전 필수" 2건(floor bump 게이트, disarm 가시성)은 **무장 PR 범위**로 확정. 절차는 `dev/impl-notes/§69-revocation-arming-runbook.md`. 이유: floor 게이트는 실제로 올릴 값이 정해지는 시점이라야 쓸 수 있고, 가시성은 UI 변경이라 #365(백엔드+CI)와 성격이 다르다.

- **✅ RESOLVED (PR #367 무장, 2026-08-08 코드 재확인)** — `revocation-publish.yml`이 **양방향** 게이트를 갖는다: floor가 published counter보다 높으면 실패(`:374`, 클라이언트 브릭 방향)하고, `MAX_LAG`를 넘게 **뒤처지면도** 실패한다(`:391`, "Ship a release that raises it"). 기준선은 PR A에서 Pages가 아니라 레지스트리 클론으로 옮겨졌다. 아래 원문은 이력용:
- ~~**🔴 floor가 live에 뒤처지는 방향은 아무것도 실패시키지 않음 (코드 HIGH-1 후반)**~~: `MINIMUM_REVOCATION_SEQUENCE`는 이제 유일한 재시작 간 방어인데, 릴리스가 bump를 잊어도 실패하는 게이트가 없다. 기존 테스트는 floor를 **너무 높게** 잡은 경우만 잡는다(클라이언트 브릭 방향). 산술은 `revocationFloorFor` 테스트로 고정했으나 "release마다 올린다"는 여전히 의도일 뿐. 발행 워크플로에서 publish된 sequence와 저장소의 상수를 비교해 격차가 N을 넘으면 실패시키는 게이트가 verify-tag와 동형
- **🟡 무장이 startup fetch 비용을 2배로 (보안 MEDIUM-3)**: armed `fetch_revocations`가 `fetch_capped_text`를 **순차 2회** 호출하고 매번 `reqwest::Client`를 새로 만든다 — TLS 핸드셰이크 2회가 `REVOCATION_REFRESH_BUDGET_MS = 1500` race 안에 들어가야 한다. 신규 설치는 저장 목록이 없어 race를 놓치면 그 실행은 **보호 0**. 회선만 느리게 만들 수 있는 공격자가 첫 실행을 무방비로 만들 수 있고 느린 회선의 정상 사용자도 같다. 수정: body와 signature를 `tokio::try_join!`로 병렬 fetch + client 공유 → 무장이 지연 무회귀
- **🔴 disarm된 상태가 정상 상태와 구별 불가 (보안 MEDIUM-4, → 무장 PR)**: `setRevocations`가 **unverified 목록에도** `revocationsFetchedAt: Date.now()`를 찍어 UI상 완벽히 신선해 보인다. `verified` 여부나 실효 registry URL을 표시하는 UI가 **어디에도 없고**, `revocationsAreStale`의 유일한 소비자는 사용자가 직접 열어야 하는 마켓플레이스 패널. 이것이 위 HIGH-1을 탐지 불가로 만든다. 대응: `revocationsVerified` 영속 + first-party가 아니면 배너 + armed 이후 unverified에는 타임스탬프 미기록. (잘 된 부분: rollback 거부 분기는 타임스탬프를 갱신하지 않아 지속 공격 하 클라이언트는 30일 후 stale 표시를 받는다)
- **🟡 rehydrate된 `revocations`가 validator를 우회 (보안 MEDIUM-4 부수)**: `migratePluginPersistedState`가 `revocations`를 전혀 검증하지 않는다 — 설계 전체가 의존하는 단일 validator(`normalizeRevocationList`)를 거치지 않고 목록이 신뢰되는 유일한 지점
- **✅ RESOLVED (2026-08-05, PR A) — 발행 게이트가 Pages와 비교해 advisory에 그침 (코드 MEDIUM-1)**: 기준선을 **레지스트리 클론**으로 이동. 부수 효과 3개: (1) "live 도달 불가 → 게이트 스킵" 관대 분기 소멸, (2) 하드코딩 curl URL 1개 소멸(= 커버 안 되던 레지스트리 위치 사본 3→2), (3) 스텝에 IO가 없어져 테스트가 **치환 없이 원문 그대로** 실행. 원문: 권위 있는 이전 목록은 **레지스트리 저장소의 커밋된 `revoked.json`**인데(바로 다음 스텝이 clone한다) 게이트는 Pages를 읽는다. push는 성공했지만 verify 루프가 타임아웃한 뒤 다음 실행은 stale live를 읽고, **변경된** 목록을 같은 counter로 통과시킬 수 있다. 수정: counter 비교를 sync 스텝 안으로 옮겨 `$RUNNER_TEMP/registry/revoked.json`과 비교. 관련: 레지스트리 위치가 이 워크플로에 **커버되지 않은 3개 사본**으로 존재(`env.REGISTRY_REPO`, 게이트의 하드코딩 curl URL, verify의 `$URL`)하고 게이트 테스트는 curl 줄을 치환해 없애므로 그 URL은 명시적으로 커버리지 밖 — 레지스트리 이전 시 게이트가 조용히 permissive("unreachable" → `exit 0`)
- **🟡 부분 해소 (2026-08-05, PR A) — seed-vs-MIN 테스트가 live가 아니라 저장소와 비교 (코드 MEDIUM-2)**: 전제(repo == live)를 게이트가 두 고리로 강제하게 됨 — 카운터 게이트가 repo↔레지스트리를, verify 스텝이 레지스트리↔Pages를 확인하므로 green 런 뒤에는 셋이 한 목록. 테스트 주석에 전제와 강제 주체를 명시. **남은 구멍**: 빨간 publish와 그 수정 사이의 구간. 원문: publish가 실패해 live가 저장소보다 뒤처진 상태에서 MIN을 저장소 값으로 올리면 이 테스트는 통과하고 모든 클라이언트가 진짜 목록을 거부한다. 주장이 성립하는 전제(repo == live)가 바로 워크플로 게이트가 확인하려는 것이고 MEDIUM-1 때문에 정확히 확인하지 못한다
- **🟡 축소됐으나 미해소 (2026-08-05, PR A) — 서명 키의 blast radius가 "머지된 PR 1개" (보안 LOW)**: 서명 스텝을 `cp` + `tauri signer sign`만 남기고 분리해 키가 **정확히 한 스텝**의 env에만 존재(뮤테이션 M7로 고정 — 두 번째 스텝에 키를 넣으면 빨간불). **잔존**: `npx tauri`가 이 저장소의 `package-lock.json`을 경유하므로 악성 의존성을 함께 실은 main 커밋은 여전히 키 범위 안. 남은 답은 필수 리뷰어가 붙은 `environment:` = **저장소 설정 변경이라 코드로 닫을 수 없음**. 원문: `registry/revoked.json`을 건드리는 **어떤 머지든** `BARAM_REVOCATION_SIGNING_KEY`를 환경에 두고 돌고, 같은 머지가 `setup-node`나 `package-lock.json`(= `npx tauri`가 해석하는 모든 것)을 함께 실을 수 있다. job에 `environment:` 보호가 없다. 필수 리뷰어가 붙은 `environment:` 또는 서명 전용 job 분리 권고
- **🟢 게이트 테스트의 견고성 (보안 LOW-2)**: `stepScript`가 `run: |`을 못 찾으면 명명된 assertion 대신 TypeError. temp 디렉터리를 정리하지 않아 실행당 7개 잔존
- **🟢 curl 치환이 `-f`를 가린다 (코드 LOW-6)**: `-f`를 빼면 404 HTML 본문이 exit 0으로 저장되고 `revocation-sequence.ts`가 0으로 읽어 게이트가 permissive. 의도된 "unreachable" 스킵과 동일한 순효과라 영향은 작지만 테스트가 볼 수 없다

## 2026-08-03 회수 목록 서명 (§69, PR #365) — 범위 밖으로 남긴 것

> 서명 PR의 코드/보안 리뷰 2라운드에서 나온 것 중 **의식적으로 안 한 것**. 리뷰가 지적한 CRITICAL 1건·HIGH 3건은 PR 안에서 닫았고 각각 뮤테이션으로 고정했다.

- **✅ RESOLVED (2026-08-05, PR A) — CI가 `.sig`를 암호학적으로 검증하지 않는다 (P2)**: Rust 빌드 없이 Node로 동일 레시피 재구현(`scripts/minisign-verify.ts`) + **앱이 쓰는 키를 Rust 소스에서 count-assert 추출**해 검증. 두 지점에서 돈다 — push **전**(나쁜 쌍을 Pages에 안 올림)과 발행 **후**(publish=false 런까지 포함해 라이브 쌍을 매 런 검증). 관대한 방향으로의 발산 3개를 의도적으로 차단: strict base64 / legacy 알고리즘 거부(‼️ Rust가 "테스트 없음"이라 명시한 `allow_legacy:false`를 위조 서명으로 레포 최초로 실행 가능하게 만듦) / trusted comment global 서명 검증. 뮤테이션 14/14 kill. 원문: 발행 워크플로의 라이브 검증은 `.sig`가 **서빙되는지** + trusted comment가 `revoked.json`을 **가리키는지**만 본다. 즉 **낡은 `.sig`는 통과한다** — 서명 단계가 건너뛰어졌거나 다른 파일을 서명한 경우는 잡지만, 어제 서명이 오늘 본문에 붙어 있는 경우는 못 잡는다. 제대로 하려면 앱 자신의 `verify_revocation_signature`, 즉 Rust 빌드가 필요하고 이 워크플로에 그만한 시간(수 분)이 없다. 실질 보호는 클라이언트가 매 fetch마다 하는 검증이므로 우선순위는 낮지만, **무장 이후에는** 발행이 조용히 깨진 상태를 CI가 못 보는 구멍이 된다. 대안: `minisign-verify`만 쓰는 작은 Rust 바이너리를 캐시해 두거나, 무장 PR에서 별도 잡으로 분리
- **"무장 안 됨" 표현이 빈 문자열 센티널이다 (P3)**: `REVOCATION_PUBLIC_KEY: &str = ""`. `Option<&str>` 이나 enum이면 "아직 안 채움"과 "빈 키를 실수로 넣음"이 타입에서 갈린다. 지금은 `is_empty()` 분기 하나로 둘을 같게 취급하는데, 무장은 **한 줄 붙여넣기**이므로 그 한 줄을 실수했을 때 조용히 미무장으로 돌아간다. 무장 PR에서 상수를 지우고 `Option`으로 바꾸는 편이 자연스러움(같은 커밋에서 값이 들어가므로)
- **`fetch_registry`가 capped-fetch 루프를 여전히 중복한다 (P3)**: `fetch_capped_text`를 추출한 이유가 "손으로 복사한 두 번째 루프에서 상한이 빠진다"였는데, 정작 `fetch_registry`는 아직 자기 루프를 갖고 있다. 지금은 셋 다 상한·타임아웃·스킴 가드를 갖고 있어 결함은 아니지만, 다음에 하나를 고칠 때 나머지를 잊는 구조. 인덱스 쪽은 타입 있는 구조체를 반환해서 시그니처가 달라 단순 치환이 안 됨 — 본문 fetch만 공유하도록 쪼개면 됨
- **`revocationSequenceSeen`을 정리하지 않는다 (P3)**: 레지스트리 URL별로 영구 보존하고 **일부러** 지우지 않는다(지우는 순간 롤백 방지가 리셋되므로). 사용자가 여러 커스텀 레지스트리를 오가면 항목이 무한히 쌓이는데, 문자열 하나 + 숫자 하나라 실용적 문제는 아니다. 정리한다면 "지우기"가 아니라 "설정에 등록된 레지스트리만 유지" 형태여야 함
- **`plugin/mod.rs`가 계속 커진다 (P3)**: 4,400줄대. 회수 서명 경로(`fetch_revocations`/`verified_revocations`/`verify_revocation_signature`/`decode_b64_text` + 상수 3개 + 테스트)는 다운로드·설치·스테이징과 공유하는 것이 `fetch_capped_text`·`validate_http_url`뿐이라 `plugin/revocation.rs`로 떼기 가장 쉬운 덩어리. 프로젝트 규약(단일 파일 ~300줄, ~500줄 초과 시 분리) 대비 한참 초과 상태

## 2026-07-31 GitHub 이슈 내부 이전 (내부 이슈는 dev/backlog.md에서 관리)

> 정책 변경: GitHub 이슈는 외부 개발자·사용자 공간으로 쓰고, 개발 중 발생하는 내부 이슈는 이 문서에서 관리한다. 아래는 GitHub에 올라가 있던 내부 발견을 옮겨온 것 (원본 이슈는 삭제). PR이 `Closes`로 참조 중인 #330은 유지.

### 🟡 P2 (부분 해소) — 플러그인 마켓플레이스 UI i18n (구 GitHub #329)

> **컴포넌트 6개는 PR #342로 완료** (2026-07-31, 57개 키). 참고: `src/components/plugins/__tests__/plugin-ui-i18n.test.tsx`의 정적 스캔이 컴포넌트 쪽 재발을 막는다
>
> **✅ 두 헬퍼도 완료 (2026-08-06)** — `legacyEntryMessage`(2분기)·`legacyInstallMessage`(2개 메시지)를 키 4개로 이전. 결정은 **(b) 호출부 해석**이고, 스토어를 읽는 (a)를 택하지 않은 이유는 프로젝트에 이미 규약이 있었기 때문 — `i18n/useTranslation.ts`가 "헬퍼가 파라미터로 받도록" 만든 `Translate` 타입을 export하고 `capabilityLabel(capability, t)`가 그 예다. 컴포넌트 호출부 3곳은 `t`를 이미 갖고 있고, 로더는 이미 `tr`(스토어 바인딩)을 갖고 있었다. ‼️영어 문자열을 단정하던 테스트 7곳은 en 바인딩 translate로 유지(카피가 아니라 **분기→remedy 대응**이 요점)하되, 로더 메시지와 문자열을 직접 비교하는 2곳은 **로더와 같은 스토어 바인딩**으로 맞췄다. 번역 여부를 실제로 잡는 테스트를 별도로 추가(ko 로케일에서 로더가 던지는 메시지 검사) — mutation 4개 kill: 두 헬퍼의 하드코딩 복귀, 두 분기가 한 키 공유, unknown-tier가 엉뚱한 키
>
> **‼️ 정정 (같은 날)**: 위 문단의 첫 버전은 "`plugin-loader.ts`의 나머지 영어 throw는 shipped 레지스트리가 만들 수 없는 manifest만 도달한다"고 적었다. **너무 관대한 진술이었다** — 코드 주석이 그렇게 말한 대상은 **manifest 검증 throw**뿐이고, 나머지 3개는 평범하게 도달한다. 그리고 `plugin-lifecycle.ts:119/168`·`PluginMarketplace.tsx:695`가 `setError(id, String(err))`로 **모든 로더 throw를 UI에 그대로** 노출한다(추적해 확인). 그래서 3개를 추가 번역: 모듈 import 실패(플러그인 ESM 버그 = 누구나 도달), 활성화 타임아웃, **신뢰 등급 상승 거부**(§260 Phase 5가 만든 설계된 경로 — 등급을 올리는 평범한 업데이트에서 발동). 앞의 두 개는 **테스트가 아예 없었다**. 상승 거부는 승인 등급을 내부 값(`sandboxed`) 대신 **UI 라벨**(`샌드박스`)로 렌더 — 기존 테스트 2곳이 `/approved as "sandboxed"/`를 단정했으므로 라벨 기준으로 갱신(로케일 바인딩도 로더와 동일하게)
>
> **여전히 의도적으로 남긴 것**: manifest 검증의 **스키마 텍스트**(`validateManifest`가 필드명을 말하는 문장 — 별도 표면이고 범위가 큼)와, `trust: null`/`""`/숫자 같은 present-but-meaningless 케이스가 remedy 대신 스키마 텍스트를 받는 동작(어떤 버전도 그 값을 받아들이지 않으므로 "Baram 업데이트"는 막다른 길 — 테스트로 고정). teardown/deactivation 타임아웃은 `logger` 경로라 사용자 노출이 아니다

- **문제**: `locale: "ko"`에서 **영어** 마켓플레이스 화면이 **완전히 한국어인** 동의 대화상자를 띄운다. PR #328이 대화상자와 capability 배지만 고쳤고(신고된 지점), 나머지는 하드코딩 영어로 남아 화면 단위 불일치가 오히려 더 눈에 띈다
- **범위**: 6개 컴포넌트 전부 `useTranslation` 미사용 — `PluginMarketplace`, `PluginDetail`, `PluginCard`, `PluginTrustBadge`, `PluginSettingsForm`, `PluginDeveloperSection`. **대략 40~50 문자열** (리뷰 스윕 기준 사이징, 정확한 체크리스트 아님)
- **놓치기 쉬운 부분**: 컴포넌트 **밖**의 오류 문자열이 `setError`를 통해 Browse 카드·Updates 카드·상세 뷰·(#328 이후) Installed 행에 그대로 노출된다 — `src/components/plugins/legacy-entry-message.ts`(두 분기), `src/plugins/plugin-trust.ts`(`legacyInstallMessage` 세 갈래), `src/plugins/plugin-loader.ts`(`throw new Error` 3곳). §260에서 영어로 작성돼 i18n을 거친 적이 없다
- **용어 주의**: #328이 배지 "Full trust" vs 대화상자 `완전한 신뢰 권한`으로 용어를 갈라놨다 — i18n 시 통일 필요
- **참고**: `src/i18n/__tests__/locale-parity.test.ts`(#328에서 추가)가 en/ko 패리티·빈 값·원문복사를 이미 검사하므로 키 추가 시 자동 커버

### 🟡 P2 — Gemini의 차단/non-STOP 응답이 빈 SUCCESS로 해소 (구 GitHub #304)

- **문제**: provider가 `STOP` 이외의 finish reason(`SAFETY`/`RECITATION`/`MAX_TOKENS`)으로 스트림을 끝내면, 토큰 0개인 채로 end-of-stream fallback을 타고 **오류가 아니라 빈 문자열 성공**으로 해소된다
- **실측 (§260 Phase 4a 라이브 스모크, PR #305, `gemini-2.0-flash`)**: `models✓(32) ai1✓(len=0:) stream✓(1tok/2ch) ai2✓(len=0:)` — 동일 프롬프트("Reply with the single word OK.")·동일 `opts`(`{maxTokens:64}`)로 complete → stream → complete 순서. **한 세션 안에서 연달아** stream은 토큰을 받고 complete 둘은 빈 문자열
- **이전 관측과의 차이**: 3c-3 스모크 노트는 "위치 무관·API 비특정"이라 했으나, 이전 런은 `ai1(len=2) stream(1tok) ai2(len=0)`으로 complete가 한 번은 성공했다. 즉 런 간 **complete는 간헐적**이고 stream 실패는 아직 관측되지 않음
- **호스트 측은 같은 경로다**: `createAIAPI.complete`는 `start(prompt, opts, t => buffer += t)`, `.stream`은 `start(prompt, opts, onToken)` — 같은 `start`·`createLLMStream`·`llmComplete`, 토큰을 받는 콜백만 다르다. 따라서 빈 complete + 정상 stream은 **그 요청에 토큰이 안 온 것**이지 누적 경로가 깨진 게 아니다. 표본 3개(빈 2 / 성공 1)는 요청당 ~50% 확률과도 동등하게 일치 — 여기서 픽스를 유도하면 안 됨
- **선행 작업**: provider별 SSE 파서가 `complete_stream` 안에 인라인이라 라이브 provider 없이는 테스트 불가. **파서 추출이 결정적 재현의 전제조건**. `SAFETY`/`RECITATION`/`MAX_TOKENS`로 종료되는 스트림을 먹여 호출자가 빈 성공이 아니라 **오류**를 보는지 단정하는 파서 테스트가 결론을 낸다
- **§260 회귀 아님**: 같은 런에서 Phase 4a 라우터 분리(`host-request-router.ts`)가 `ai` 경로에 무영향임을 확인 (`ai_list_models` 32개 반환, `ai_stream` 정상)

### ✅ 대부분 해소 (2026-08-09, `feature/plugin-detail-editor-tab`) — 플러그인 상세를 에디터 탭으로 + README 렌더링

> 사용자 요청("상세 전체를 에디터뷰에서")으로 구현. Graph View가 이미 쓰던 **가상 탭** 패턴을 따라 `EditorTabType`에 `"plugin"`을 추가하고, `EditorTab.pluginId`를 페이로드로 둔다. 상세는 `PluginDetailTab`이 id만 받아 **스토어에서 라이브로 해석**한다(탭이 자기를 연 패널보다 오래 살아 스냅샷은 상한다).
>
> **‼️ README가 안 뜨던 진짜 이유는 내장 문제가 아니었다.** 위 "문제 2"는 절반만 맞았다 — `readFile`은 vault 제약(`fs_cmd.rs:152` → `check_vault` → `validate_path_any`)이고 플러그인은 `~/.baram/plugins/`에 설치되므로 **설치된 플러그인도 전부 거부**당했다(두 분기 모두: 컨텍스트가 있으면 `validate_path_any`, 없으면 `vault_fallback_decision`). `.catch`가 그걸 "README 없음"으로 바꿔 조용히 숨겼다. 해법은 새 Rust 커맨드가 아니라 **이미 허용된 asset 프로토콜**이다 — `plugin_prepare_scopes`가 플러그인 디렉터리를 `allow_directory(recursive)`로 열어두고 staging은 forbid하며, CSP `connect-src`에 `asset:`이 있고, `plugin-loader.ts:548`이 이미 같은 경로로 플러그인 JS를 읽는다. `plugin-readme.ts`가 그 경로를 쓴다.
>
> **‼️ read-only는 공짜가 아니었다.** 탭 타입 가드가 전부 `isGraphTab(x) → return` 형태의 **열거된 denylist**여서, 새 타입은 기본값이 "파일처럼 취급"이었다. 실측한 결과: **Cmd+S가 Save As 다이얼로그를 열고, 확정하면 `use-file-operations.ts:199-225`가 그 탭을 파일 탭으로 덮어썼다**(내용은 공유 에디터에 남아 있던 마크다운). Cmd+/는 소스 모드로 진입했다(두 번째 가드도 `isFileTab` 게이트라 같이 빗나감). `use-tab-switching.ts`는 `filePath: ""`로 로더에 진입했다. 네 곳 모두 `!isFileTab(tab)`으로 뒤집고, `isFileTab`을 타입 술어로 바꿔 narrowing이 따라오게 했다. StatusBar의 `mode !== "graph"`도 같은 부류라 `DOCUMENT_MODES` **allowlist**로 반전(새 모드는 기본적으로 "0 words, Ln 1"을 주장하지 않는다).
>
> 뮤테이션 **18/18 kill**(가드 4종 되돌리기 + 각각의 비공허성 대조군, 싱글턴 키, pluginId 누락, 술어 무력화, 모달 조건 양방향, entry 해석 순서, 내장 status 폴백, 내장 README 조회, cap 제거, `<pre>` 복귀, Back 무력화, 상태바 패널). ‼️러너 교훈 재확인: 첫 배터리가 **0/18을 오보**했다 — 실패 이름 정규식이 watch 모드의 `×` 글리프를 찾고 있었고 run 리포터는 `FAIL <file> > <describe> > <test>`를 쓴다. [[mutation-testing-mis-aimed]]와 같은 부류.
>
> **남은 것 (분리)**:
>
> - **내장 플러그인 README는 여전히 없다 (P3)**: `media-viewer.ts` 하나뿐이고 옆에 README 파일이 없다. 메커니즘만 넣으면(`BuiltinPlugin.readme` + `?raw`) 아무도 안 채우는 필드가 생겨 knip 표면이 되므로, **문서를 실제로 쓸 때 함께** 할 일이다. 지금은 매니페스트 `description`이 그 자리를 대신한다
> - **README 읽기는 캡이 렌더 쪽에만 있다 (P3)**: `MAX_README_BYTES`(256 KiB)는 `MarkdownRenderer`가 메인 스레드에서 mdast→React를 도는 비용을 묶지만, `res.text()`가 이미 전체를 메모리에 올린 **뒤**에 적용된다. 읽기까지 묶으려면 `res.body` 스트리밍 리더가 필요하다. 설치에 동의한 로컬 콘텐츠라 우선순위 낮음
> - **`>` → `>=`는 등가 뮤턴트 (기록용)**: 정확히 cap 길이인 문자열을 cap으로 slice하면 같은 문자열이라 **어떤 입력도 두 연산자를 구분하지 못한다**. 경계 테스트는 이 뮤테이션을 잡을 수 없고, 잡을 수 있게 만들려면 잘렸다는 마커를 붙여야 하는데 그건 제품 변경이다
> - **Browse/Updates에서 열면 이제 설치된 버전이 보인다 (의도, 기록용)**: 예전 라우트는 리스팅 스냅샷을 넘겨 더 새 버전을 보여줬다. 업데이트 제공은 영향 없다(`updateAvailable` + `handleUpdate`가 리스팅을 재해석). 테스트로 고정됨
> - **`PluginDetail.tsx`의 인라인 스타일은 그대로다 (P3)**: 아래 "플러그인 관리 UI 잔여 정리"의 CSS 이관 항목과 같은 작업. README 블록만 `.plugin-detail-readme`로 나갔고, 그 스코프는 `panels.css`의 `:is(.help-panel-content, .plugin-detail-readme)`로 Help 패널과 규칙 18개를 공유한다
>
> **리뷰 2라운드에서 이월한 것 (2026-08-09, PR #389)** — 두 리뷰가 찾은 것 중 이 PR 밖 표면:
>
> - **🟡 설치 가드가 표면별 `useRef`다 (보안 MED-2)**: `usePluginActions.ts:114`(`inFlight`)·`:102`(`togglingRef`)·`:110`(`consentResolver`)가 훅 인스턴스 안에 있어 `PluginDetailTab`과 `PluginMarketplace`가 각자 하나씩 갖는다. 그 가드의 주석이 설명하는 실패(교차 커밋 → `ENOTEMPTY` + "이전 버전이 …에 남았다" 오보 + 절대 홈 경로 노출)를 표면 간에는 막지 못한다. Rust 쪽 직렬화 락도 없다(`plugin_install_commit`은 그대로 위임하고 `staging.rs`의 락은 stage 맵을 지킨다). **선재하지만 악화됨** — 사이드바+설정 모달로 이미 두 인스턴스가 가능했으나, 탭은 패널과 **공존하도록 설계**돼 이제 예외가 아니라 정상이다. 수정: ref를 스토어로 올리거나 pluginId별 Rust 락
> - **🟡 매니페스트 `name`이 무검증 (보안 MED-3)**: `manifest.ts:69-84`는 "필수 + 문자열"만 본다(형제 `requireId`는 `CONTRIBUTION_ID` + 길이 상한을 갖는다). 이제 탭 제목·`document.title`·TabSwitcher까지 흘러가고 동의 다이얼로그 제목에는 이미 갔다. React 텍스트 노드라 HTML 주입은 아니고 **스푸핑**이 표면 — U+202E가 윈도우 타이틀과 탭바의 뒤 텍스트를 뒤집고(Trojan-Source), 길이 무제한은 타이틀바 denial. `.tab-title`은 clip은 하지만 `white-space: nowrap`이 없어 개행이 탭을 재배치한다. 방향은 **열거가 아니라 allowlist** — 길이 상한(~128) + `Cc`/`Cf` 거부 ([[enumerated-denylist-over-open-set]])
> - **🔵 vault 없이 상세를 열면 탭바가 없다 (코드 L1, 새로 도달 가능)**: `SettingsModal`은 `rootPath`와 무관하게 마운트되므로(Cmd+,) vault 없는 HomeScreen에서 Details를 누를 수 있다. 그러면 `activeTabId`가 생겨 HomeScreen 분기를 벗어나 상세가 렌더되는데 `App.tsx`가 `{!!rootPath && <TabBar />}`라 **탭이 보이지 않는다**(Back으로 복구는 됨). graph 탭은 사이드바 경유라 vault가 필요해 도달 불가였다. ‼️이 항목과 M2의 근본 수정이 얽힌다 — backfill을 없애면 vault를 닫아도 플러그인 탭이 남아 같은 상태가 되므로, 그래서 M2를 소비 지점 게이팅으로 고쳤다. 제대로 하려면 `TabBar`/`StatusBar` 게이트를 `rootPath || activeTabId`로
> - **🔵 QuickSwitcher가 non-file 탭을 untitled 파일로 나열 (코드 L2)**: `QuickSwitcher.tsx:135-143`의 `tabs.filter(t => !t.filePath)`가 graph·plugin 탭을 포함한다. 선택하면 탭이 활성화되므로 동작은 정상이고 graph에서 선재하지만 항목이 늘어난다. 필터를 `isFileTab(t) && !t.filePath`로
> - **🔵 업데이트 후 README가 stale (코드 L3)**: README effect가 `installPath`만 키로 삼는다(맵 identity 재조회를 피하려는 의도적 선택이고 그 근거는 유효). 같은 경로에 새 README가 덮어써지면 재실행되지 않아 헤더 버전과 본문이 어긋난다. `[installPath, installed?.updatedAt]` — `updatedAt`이 primitive라 원래 문제를 되살리지 않는다
> - **🔵 `MAX_README_BYTES`가 바이트가 아니라 문자 (보안 LOW-3)**: 이름과 다르다. 그리고 `res.text()`는 무계라 캡은 **렌더만** 묶는다 — 레지스트리 플러그인은 ZIP 상한이 감싸지만 **dev 폴더는 아니다**. 읽기까지 묶으려면 `res.body` 스트리밍 리더
> - **⬜ 상세의 Uninstall에 확인이 없다 (보안 L, 판단 필요)**: 선재 동작이고 목록도 같다(#261 이후 파괴적이지도 않다). 다만 탭은 패널 이동에도 살아남아 오클릭 노출이 길어진다. 보안 회귀는 아니고 UX 판단
> - **⬜ 범위 밖으로 명시된 것 (보안 리뷰)**: asset 스코프가 앱 전역(`app.asset_protocol_scope()`)이라 샌드박스 플러그인의 `WebviewWindow`도 공유한다. 그 창의 CSP가 `asset:` fetch를 허용하는지 — 즉 한 샌드박스 플러그인이 다른 플러그인 디렉터리를 읽을 수 있는지 — 는 이 PR이 만들지도 건드리지도 않은 §260 질문
> **재리뷰(2라운드) 결과 (2026-08-09)** — 두 리뷰 모두 HIGH-1·MEDIUM-1이 닫혔다고 판정. 새 MEDIUM 1건이 나와 같은 브랜치에서 닫았고, 남은 것은 아래:
>
> - **🔵 한 줄짜리 `<svg><style>…</style></svg>`는 CSS 텍스트가 보인다 (코드 리뷰 LOW)**: 여러 줄 형태는 블록 `html` 노드 하나라 통째로 떨어지지만, 한 줄 형태는 **텍스트 노드를 감싼 인라인 html 노드들**로 파싱된다. html을 떨어뜨리면 가운데 텍스트(`.x{display:none}`)가 남아 화면에 보인다. **무해**(스타일로 해석되지 않는 평문)하지만 지저분하다. 고치려면 텍스트 노드까지 판단해야 하는데 그건 정상 콘텐츠를 깨뜨릴 방향이라 안 했다
> - **⬜ trusted 경로의 WKWebView 확인 1회 (보안 리뷰 권고)**: 문서 전역 스타일시트 메커니즘이 우리 둘이 생각한 그것이었는지를 실앱에서 30초면 확인할 수 있다. 수정 후에는 untrusted 경로에서 재현 불가여야 하므로, 확인은 **trusted** 쪽으로 해야 한다(채팅/Help에 SVG `<style>`을 넣어 앱 전역 CSS에 닿는지). ‼️jsdom은 `SVGStyleElement`를 스타일시트로 구현하지 않아 이 다리는 애초에 테스트로 관측 불가 — "이제 불가능"의 근거는 구조적(파서 도달 전 노드 제거) + 27개 위치 probe다
> - **🔵 vault A를 닫으면 A에서 열었던 플러그인 탭도 닫힌다 (의도, 기록용)**: 사용자가 vault B에서 작업 중이어도 그렇다. `ContextTabBar:118`이 `contextId`로 닫기 때문이고, 그 backfill을 유지한 이유가 바로 고아 탭 방지다(위 L1 참조). 코드 리뷰가 "내 제안보다 이 쪽이 낫다 — 그 상호작용을 추적하지 못했다"고 정정
> - **‼️ 테스트 신뢰성 교훈 (기록용)**: `expect(listed.requests).toBeGreaterThan(0)`는 **"한 번도 fetch 안 함"만** 막는다 — 호출 카운트는 마운트 시점에 이미 만족되므로 microtask 부족을 잡지 못하고 취약성을 **문서화할 뿐**이다. 실제로 그걸 제거한 것은 **3-state 머신**이다: 덜 flush되면 이제 아무것도 렌더되지 않아 `getByText`가 던진다(그럴듯한 오답 상태가 렌더되지 않는다). 교훈: **틀린 상태가 렌더 가능한 곳에서는 `mode: "defer"`를 쓸 것.** [[unobservable-property-needs-an-injected-fixture]] 부류
> - **‼️ 리뷰 에이전트가 내 작업물을 자기 것과 혼동했다 (기록용)**: 보안 리뷰가 `src/components/ai/__tests__/tmpprobe/perf.test.tsx`를 **내가 만든 것**으로 지목하고 "이미 찾으셨네요"라고 전제했다. 나는 그 파일을 만든 적이 없다 — 리뷰 에이전트 자신의 probe였다. 로컬 테스트 카운트 불일치(4,480 vs 4,477)도 그 probe 3개로 정확히 설명된다. **교훈: 에이전트가 "당신의 파일"이라고 하면 `git status`로 확인할 것.** 에이전트 probe가 `src/**/*.test.tsx` include glob 안에 들어가면 내 카운트를 오염시킨다(untracked라 CI는 무영향)
> - **‼️ 리뷰 인프라 교훈 (기록용)**: code-reviewer가 idle로 전환됐는데 findings 본문이 도착하지 않았고 읽을 수 있는 출력 파일도 없었다. 이름으로 `SendMessage`를 보내 재요청하면 트랜스크립트에서 재개되어 전문을 받을 수 있다 — [[subagent-final-message-is-the-only-channel]]의 두 번째 사례. 재요청 시 "완료하지 않았다면 재구성하지 말고 그렇다고 말할 것"을 명시할 것
>
> 아래 원문은 이력용:

- **문제 1 — 렌더링**: `PluginDetail.tsx`가 README를 `<pre>` 블록에 **원문 그대로** 넣는다(`white-space: pre-wrap`, `max-height: 300px`). 마크다운 에디터가 마크다운 문서를 파싱 없이 보여주는 셈이라 헤딩·링크·코드펜스가 전부 평문이다
- **문제 2 — 내장은 README가 없다**: `PluginMarketplace.tsx`가 `readFile(\`${plugin.installPath}/README.md\`)`로 읽는데 **내장의 `installPath`는 빈 문자열**이라 `/README.md`를 읽으려다 실패하고, `.catch`가 조용히 `null`로 만든다. 즉 Media Viewer 상세에는 README 섹션이 아예 안 뜬다 — 오류도 안 보인다
- **사용자 기대**: 리포터는 '상세'가 **오른쪽 에디터 뷰에서 README.md를 여는** 동작을 예상했다. 그 편이 마크다운 렌더링·링크 이동·검색이 전부 공짜로 따라온다
- **선행 고려**: 에디터 탭으로 열려면 (a) 탭 생성 경로, (b) 플러그인 디렉터리 경로 해석(vault 밖이라 `read_file`의 vault 제약 확인 필요 — `export_binary_file` 선례 참조), (c) **내장은 디스크에 파일이 없다**는 사실 처리가 필요하다. 내장 README를 번들에 포함할지(`?raw` import) 아니면 상세에 인라인 문서를 둘지가 갈림길
- **참고**: 계획·스펙 어디에도 에디터 연동은 없었다. PR #382는 이 동작을 건드리지 않았다

### 🟢 P3 — 플러그인 토글 라벨 "켜짐/꺼짐"이 상태인지 동작인지 모호 (PR #382 후속)

- **문제**: `PluginRowView`의 토글은 체크박스 + 상태 텍스트 쌍이고 텍스트는 **현재 상태**를 말한다(`plugin.action.on` = "켜짐"). 리포터가 "'켜짐'이 enable 설정 버튼이냐"고 물었다 — 즉 *누르면 켜진다*로도 읽힌다
- **선택지**: 상태 텍스트를 없애고 스위치만 두기 / 라벨을 동작 중립어("사용")로 바꾸기 / aria-label은 이미 플러그인 이름을 담고 있으므로 시각 라벨만 조정
- **주의**: `plugin.action.on`/`off`는 다른 곳에서도 쓰일 수 있으니 grep 후 변경할 것

### 🟢 P3 — 플러그인 관리 UI 잔여 정리 (PR #382에서 의도적으로 미룸)

- **설정 단일화(PR2)**: 선언 필드 폼과 `addSettingsTab` 등록 탭이 아직 네 곳에 흩어져 있다. 스펙 §7과 계획 Task 9~12에 전체 설계가 있음
- **dev 플러그인을 목록에 통합**: 지금은 `PluginDeveloperSection`이 따로 담당하고 `buildPluginRows`에 `devPlugins: {}`를 넘긴다. `actionsFor("dev")`와 `PluginRowView`의 `onReload`는 이미 준비돼 있음
- **인라인 스타일 CSS 이관**: `marketplace-styles.ts`의 셸 크롬 14개, `PluginCard.tsx` 전체, `PluginDetail.tsx` 대부분
- **`usePluginActions.ts` 분리**: 683줄. install/update와 toggle 이음매로 쪼갤 것 (순수 이동 커밋이라 당시 미분리)
- **`PluginRevokedNotice`의 "Remove it" 버튼에 플러그인 이름 없음**: 행의 다른 컨트롤은 전부 이름을 갖는데 이것만 예외라, `PluginRow.test.tsx`의 이름 부여 속성 테스트에 폐기 케이스를 추가하면 실패한다. `pluginName` prop + `plugin.revoked.removeFor` 두 로케일
- **`.plugin-row__version` / `__icon` 오버플로**: 형제인 `__name`만 `min-width: 0` + `overflow-wrap: anywhere`를 받았다. `manifest.ts`가 버전 형식을 검사하지 않으므로 긴 버전 문자열이 자기 flex 줄을 넘칠 수 있음(작성자 통제, 외관 문제)
- **`PluginCard`의 키보드 접근성**: 카드가 `<div onClick>`이라 role/tabIndex/onKeyDown이 없어 Browse·Updates 상세를 키보드로 열 수 없다 (기존 결함)
- **`activateOne`의 뷰어 등록 누수**: `activate()`가 등록 *후* 던지면 `activeBuiltins`에 안 들어가 teardown이 닿지 못한다. 토글로 재시도할 때마다 반복 등록됨 (기존 결함이나 토글 추가로 재현 가능해짐)
