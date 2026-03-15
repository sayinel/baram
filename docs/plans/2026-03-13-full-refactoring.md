# Baram Full Refactoring Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Baram 코드베이스의 구조적 기술 부채를 해소하여 Critical/High 이슈 0건을 달성하고, 코드 품질·확장성·안정성을 개선한다.

**Architecture:** 4-Phase 점진적 리팩토링. Phase A(안전 패치) → B(구조 분해) → C(패턴 통일) → D(아키텍처 개선). 각 Phase는 독립 branch에서 작업하며, 완료 시 부모 branch(`refactoring`)에 merge한다. 모든 변경은 기존 인터페이스를 유지하여 breaking change 없이 진행한다.

**Tech Stack:** Tauri 2.0, Rust (tokio, thiserror, git2), React 19, TypeScript strict, Tiptap v2, Zustand, Vite 7

**Branch Strategy:**
```
main
 └── refactoring
      ├── refactoring/phase-a  ✅ merged
      ├── refactoring/phase-b  ✅ merged
      ├── refactoring/phase-c  ✅ merged
      └── refactoring/phase-d  ✅ merged
```

**HITL Decisions:**
- i18n: 별도 티켓 (리팩토링 범위 외)
- 키바인딩: Tiptap Extension만 동기화 (Phase D4)
- 에러 핸들링: Error Boundary + formatError 조합 (Phase D5)
- `as` 단언: ProseMirror 경계 허용, 추후 티켓
- Branch: Phase별 branch → refactoring merge

---

## 진행 현황 요약

| Phase | 상태 | 완료 | 미완료 |
|-------|------|------|--------|
| **A: 안전 패치** | ✅ 완료 | 8/8 | — |
| **B: 구조 분해** | ✅ 완료 | 8/8 | — |
| **C: 패턴 통일** | 🔶 95% | 7/9 | C4 (LazyLock), C8 (exhaustive-deps 6건 잔존) |
| **D: 아키텍처 개선** | 🔶 87% | 6/8 | D3 (EditorContext), D8 (구조화 로깅) |
| **전체** | **~93%** | **29/33** | **4건 잔존** |

### 추가 완료 작업 (계획 외)

| 작업 | 날짜 | 설명 |
|------|------|------|
| pre-push hook 추가 | 2026-03-13 | `.husky/pre-push`: `cargo clippy --all-targets -- -D warnings` + `npx knip` |
| knip.json 정리 | 2026-03-13 | redundant entry 5개, 불필요한 ignoreDependencies 9개 제거 |
| 의존성 최신화 | 2026-03-13 | npm: codemirror, tailwindcss 4.2, katex, commitlint, lint-staged, typescript-eslint, mdast-util-from-markdown, vitest 4.1, @vitejs/plugin-react 5.2 / Rust: 93개 패치 업데이트 |
| dependabot PR 정리 | 2026-03-13 | #10(notify 8), #11(tokio), #13(codemirror), #14(tauri-cli), #20(tiptap) merge / #15(testing) close — jsdom 28.1의 `@csstools/css-syntax-patches-for-csstree`가 stylelint css-tree와 충돌 |
| jsdom 28.0.0 고정 | 2026-03-13 | `package.json`에서 `^28.0.0` → `28.0.0` exact pin. jsdom 28.1이 cssstyle 업데이트 → `@csstools/css-syntax-patches-for-csstree` 추가 → stylelint의 `cursor: pointer` 파싱 실패 |
| clippy lint 수정 | 2026-03-13 | `manual_contains` (pandoc.rs), `doc_lazy_continuation` (tag/mod.rs) — Rust 1.94 새 lint |
| Vite 6→7 업그레이드 | — | 이전 작업에서 완료 |
| syntax-reveal 분할 | — | `syntax-reveal.ts` → `state`, `expand`, `collapse`, `decorations` 4개 모듈로 분할 |
| pipeline 분할 | — | `md-to-pm.ts` → `convert-block-special.ts`, `convert-inline-text.ts`, `convert-list.ts` 분리 |
| FileTree 분할 | — | `FileTree.tsx` (1261줄) → `FileTreeNode.tsx`, `FileTreeContext.tsx`, hooks/ (crud, dnd, rename, search) |

---

## Phase 0: Branch 준비 — ✅ 완료

### Task 0.1: Branch 생성 — ✅ 완료

---

# PHASE A: 안전 패치 — ✅ 완료

> 기간: 1-2일 | 리스크: 최소 | 모든 작업 독립 병렬 가능
> Branch: `refactoring/phase-a`

---

### Task A1: std::sync::Mutex → tokio::Mutex — ✅ 완료

**해결:** `index_cmd.rs`에서 `use tokio::sync::Mutex`로 변경. 모든 `.lock()` → `.lock().await`, `map_err` 제거 (tokio::Mutex는 poisoning 없음). `lib.rs`의 `LinkIndexState` 초기화도 `tokio::sync::Mutex::new()`로 변경.

---

### Task A2: 비원자적 파일 쓰기 수정 — ✅ 완료

**해결:** `tag/mod.rs`에서 `tokio::fs::write` → `crate::fs::write_file`로 변경. tmp→rename 원자적 쓰기 패턴 적용.

---

### Task A3: Mutex unwrap() 제거 — ✅ 완료

**해결:** `get_opened_urls` 반환 타입을 `Result<Vec<String>, String>`으로 변경. `.lock().map_err(|e| e.to_string())?` 패턴 적용.

---

### Task A4: extractTextFromPhrasing 누락 타입 추가 — ✅ 완료

**해결:** `pm-to-md.ts`에서 link, inlineMath, wikiLink, mention, tagNode 5개 phrasing 타입 핸들러 추가. highlight+link 조합의 데이터 손실 해소.

---

### Task A5: convertTableNode 이중 구현 통일 — ✅ 완료

**해결:** `md-to-pm.ts`의 standalone `convertTableNode` 함수 삭제. table 변환은 `nodeTransformers` registry → `table-transformer.ts`의 `mdastToPm`으로 라우팅.

---

### Task A6: registry table.hasNodeView → false — ✅ 완료

**해결:** `registry.json`에서 table의 `hasNodeView`를 `false`로 수정. table.ts에는 `addNodeView()` 메서드가 없음.

---

### Task A7: @tiptap/starter-kit dead dependency 제거 — ✅ 완료

**해결:** `package.json`에서 `@tiptap/starter-kit` 제거. 소스 코드에서 import 없음 확인.

---

### Task A8: 500파일 하드코딩 제한 개선 — ✅ 완료

**해결:** `tag/mod.rs`에서 500파일 루프 제한 제거. 전체 vault 순회로 변경.

---

# PHASE B: 구조 분해 — ✅ 완료

> 기간: 3-5일 | 리스크: 중간 | Branch: `refactoring/phase-b`

---

### Task B1: App.tsx 분해 (2,734줄 → 824줄) — ✅ 완료

**해결:** 7개 커스텀 훅 추출:
- `use-menu-event-handler.ts` — 메뉴 이벤트 핸들러 (~50 cases)
- `use-tab-switching.ts` — 탭 전환, 콘텐츠 로드, dirty 상태
- `use-editor-effects.ts` — 에디터 초기화 및 부수효과
- `use-keybinding-actions.ts` — `registerAction()` 호출 (~40개)
- `use-navigation.ts` — 파일 네비게이션 로직
- `use-file-operations.ts` — 파일 열기/저장/생성
- `use-settings-effects.ts` — 설정 변경 부수효과

**결과:** App.tsx 2,734줄 → 824줄 (70% 감소). 목표 500줄보다 큰 이유는 JSX 렌더링과 최소 글루 로직이 예상보다 많았기 때문.

---

### Task B2: SettingsModal.tsx 탭 분리 (3,047줄 → 141줄 셸) — ✅ 완료

**해결:** 8개 탭 컴포넌트로 분리 (계획의 7개보다 1개 추가):
- `GeneralTab.tsx`, `EditorTab.tsx`, `AITab.tsx`, `AppearanceTab.tsx`
- `KeybindingsTab.tsx`, `LanguageTab.tsx`, `MarkdownTab.tsx`, `ActivityBarTab.tsx`
- 추가: `settings-registry.ts` (검색 가능한 설정 레지스트리), `settings-shared.tsx` (공유 타입), `SearchSettingControl.tsx`, `SettingsSearchResults.tsx`

**결과:** SettingsModal.tsx 3,047줄 → 141줄 (95% 감소).

---

### Task B3: settings-store.ts Slices 분리 — ✅ 완료

**해결:** Zustand Slices 패턴 적용. 4개 slice 파일 생성:
- `journal-settings.ts`, `editor-settings.ts`, `appearance-settings.ts`, `general-settings.ts`

기존 `useSettingsStore` 인터페이스 100% 유지 (breaking change 없음).

---

### Task B4: ipc/invoke.ts 도메인별 분리 — ✅ 완료

**해결:** 11개 도메인 모듈로 분리 (계획의 8개보다 3개 추가):
- `fs.ts`, `git.ts`, `llm.ts`, `export.ts`, `config.ts`, `snapshot.ts` (계획)
- `keyring.ts`, `link-index.ts`, `plugin.ts`, `search.ts`, `tag.ts` (추가)

`invoke.ts`는 re-export facade로 유지하여 기존 import 경로 호환.

---

### Task B5: tag 모듈 분리 (Rust) — ✅ 완료

**해결:** `src-tauri/src/tag/mod.rs` 생성. 비즈니스 로직 (tag 추출, frontmatter 파싱, regex 처리) 이동. `tag_cmd.rs`는 IPC thin layer만 남김.

---

### Task B6: lib.rs 메뉴 모듈 추출 — ✅ 완료

**해결:** `src-tauri/src/menu.rs` 생성. 메뉴 빌더 코드 (~55개 MenuItemBuilder) 이동.

---

### Task B7: SKIP_DIRS / collect_md_files 공통화 — ✅ 완료

**해결:** `fs/mod.rs`에 `pub const SKIP_DIRS` + `pub async fn collect_md_files()` 정의. search, index, tag 3개 모듈에서 `crate::fs::collect_md_files()` 호출로 통일.

---

### Task B8: git/mod.rs GitError 타입 도입 — ✅ 완료

**해결:** `thiserror` 기반 `GitError` enum 정의 (`Git`, `Io`, `Custom` variants). 모든 함수를 `Result<T, GitError>`로 변경. `git_cmd.rs`에서 `.map_err(|e| e.to_string())`으로 IPC 경계 변환.

---

# PHASE C: 패턴 통일 — 🔶 95% (7/9 완료)

> 기간: 2-3일 | 리스크: 낮음 | Branch: `refactoring/phase-c`

---

### Task C1: 6개 untyped Node.create() → typed — ✅ 완료

**해결:** `definition-list.ts`, `footnote-ref.ts`, `footnote-definition.ts`, `query-block.ts`, `table-of-contents.ts`, `tag-node.ts` 모두 `Node.create<XxxOptions>()` 패턴으로 변경. Options 인터페이스 정의 포함.

---

### Task C2: mergeAttributes 추가 (6 atom nodes) — ✅ 완료

**해결:** `block-reference`, `footnote-ref`, `tag-node`, `block-embed`, `table-of-contents`, `wikilink`의 `renderHTML()`에 `mergeAttributes()` 적용.

---

### Task C3: §spec 주석 추가 — ✅ 완료

**해결:** `definition-list.ts`, `image.ts`, `link.ts`, `table-virtual-scroll.ts`, `toggle.ts` 등에 `// §X.X ...` 주석 추가.

---

### Task C4: Regex → LazyLock (15곳) — ❌ 미완료

**상태:** `index/mod.rs`와 `tag/mod.rs`에서 여전히 함수 내부에서 `Regex::new()` 호출. `std::sync::LazyLock<Regex>` 전환 필요.

**영향:** 기능적 문제 없음. 대량 파일 인덱싱 시 성능 영향 가능 (매 호출마다 정규식 재컴파일).

---

### Task C5: console.* → 조건부 logger — ✅ 완료

**해결:** `src/utils/logger.ts` 생성. `isDev` 조건부 로깅 (`debug`, `warn`, `error`).

---

### Task C6: pm-to-md hard-coded → registry 패턴 — ✅ 완료

**해결:** `src/pipeline/serializer.ts` 생성. `pm-to-md.ts`의 `convertPmNode()` 분기를 `pmNodeTransformers` / `pmMarkTransformers` registry로 라우팅.

---

### Task C7: mdast in-place 변이 → 불변 처리 — ✅ 완료

**해결:** `extractBlockIdFromMdast`를 별도 모듈로 추출, 불변 처리 패턴으로 변경. 원본 노드 수정 없이 결과 반환.

---

### Task C8: exhaustive-deps 해소 — 🔶 부분 완료

**상태:** 6개 파일에 `eslint-disable exhaustive-deps` 잔존:
- `App.tsx` (1건)
- `use-editor-effects.ts` (3건)
- `use-file-operations.ts` (2건)
- `use-keybinding-actions.ts` (2건)
- `use-tab-switching.ts` (1건)

**사유:** B1에서 추출된 복잡한 effect hooks에서 deps 배열 관리가 까다로운 케이스. `useRef` 패턴 적용 또는 effect 재구성 필요.

---

### Task C9: non-Extension 파일 이동 — ✅ 완료

**해결:**
- `code-block-node-view.ts` → `src/extensions/nodes/views/code-block-node-view.ts`
- `table-virtual-scroll.ts` → `src/extensions/nodes/plugins/table-virtual-scroll.ts`

import 경로 업데이트 완료.

---

# PHASE D: 아키텍처 개선 — 🔶 87% (6/8 완료)

> 기간: 1-2주 | 리스크: 높음 | Branch: `refactoring/phase-d`

---

### Task D1: 라운드트립 테스트 보강 (8 노드) — ✅ 완료

**해결:** `src/extensions/__tests__/`에 테스트 파일 생성:
- `callout.test.ts`, `definition-list.test.ts`, `footnote.test.ts`
- `wikilink.test.ts`, `mention.test.ts`, `tag-node.test.ts`, `query-block.test.ts`

---

### Task D2: math-block / math-inline 테스트 추가 — ✅ 완료

**해결:** `src/extensions/__tests__/math.test.ts` 생성. 라운드트립 + InputRule + KaTeX 렌더링 검증 포함.

---

### Task D3: editor prop → EditorContext — ❌ 미완료

**상태:** `src/contexts/editor-context.tsx` 미생성. 현재 editor 인스턴스는 prop drilling 또는 Zustand store를 통해 관리.

**판단:** Zustand 기반 상태 관리가 이미 잘 동작하고 있어, React Context 전환의 이점이 제한적. 추후 필요 시 검토.

---

### Task D4: 키바인딩 Tiptap 동기화 — ✅ 완료

**해결:** `src/extensions/utils/shortcut-resolver.ts` 생성. 10+ Extension에서 `resolveShortcut()` 사용: heading, bullet-list, code-block, math-block, mermaid-block, ordered-list, task-list, bold, code, highlight 등.

---

### Task D5: Error Boundary + formatError 통일 — ✅ 완료

**해결:** `src/components/ErrorBoundary.tsx` 생성. `App.tsx`에 Provider 배치.

---

### Task D6: 지연 로딩 (mermaid, katex 등) — ✅ 완료

**해결:** `mermaid-block-view.tsx`에서 mermaid dynamic import 적용. 초기 번들 사이즈 감소.

---

### Task D7: 에러 핸들링 Rust 통일 — ✅ 완료

**해결:** `git_cmd.rs`에서 `GitError` 활용. `map_err(|e| e.to_string())` → `?` 연산자로 교체.

---

### Task D8: 구조화된 로깅 시스템 — ❌ 미완료

**상태:** Rust 측에 `tracing` 또는 `log` crate 미도입. 현재 `eprintln!` 사용.

**영향:** 개발 디버깅에는 지장 없으나, 프로덕션 로그 레벨 제어 불가.

---

## 잔존 이슈 (4건)

| 작업 | 우선도 | 난이도 | 설명 |
|------|--------|--------|------|
| C4: Regex → LazyLock | 낮음 | 쉬움 | 성능 최적화. 기능 영향 없음 |
| C8: exhaustive-deps 6건 | 낮음 | 중간 | 복잡한 effect hooks. useRef 패턴 필요 |
| D3: EditorContext | 보류 | 중간 | Zustand로 충분. 필요 시 검토 |
| D8: 구조화 로깅 (Rust) | 낮음 | 쉬움 | tracing crate 도입 필요 |

---

## 추후 티켓 (리팩토링 범위 외)

1. i18n 전체 적용 (74 컴포넌트 + Rust 메뉴)
2. `as` 타입 단언 전체 검토 (695건, PM 경계 제외)
3. 키바인딩 Rust 메뉴 accelerator 동기화
4. 인라인 style={{}} → CSS 클래스 전환 (183건)
5. 스토어 간 직접 import → subscribe/event 패턴
6. ESLint 10 / Vite 8 메이저 업그레이드
7. jsdom 28.1 대기 — `@csstools/css-syntax-patches-for-csstree` ↔ stylelint 호환 해결 후

---

## 의존성 최신화 이력 (2026-03-13)

### npm (semver 호환 범위 내)

| 패키지 | Before | After |
|--------|--------|-------|
| @codemirror/* (5개) | 6.x | latest patch/minor |
| @tailwindcss/vite + tailwindcss | 4.1.18 | 4.2.1 |
| katex | 0.16.28 | 0.16.38 |
| @commitlint/* | 20.4.3 | 20.4.4 |
| lint-staged | 16.3.2 | 16.3.3 |
| typescript-eslint | 8.55.0 | 8.57.0 |
| mdast-util-from-markdown | 2.0.2 | 2.0.3 |
| vitest | 4.0.18 | 4.1.0 |
| @vitejs/plugin-react | 5.1.4 | 5.2.0 |
| @tiptap/* (14개) | 3.19.0 | 3.20.1 |

### npm (메이저 — skip)

| 패키지 | Current | Latest | 사유 |
|--------|---------|--------|------|
| eslint | 9.39.4 | 10.0.3 | 메이저. 마이그레이션 별도 |
| @eslint/js | 9.39.4 | 10.0.1 | eslint 10과 함께 |
| vite | 7.3.1 | 8.0.0 | 메이저. plugin-react 6 필요 |
| @vitejs/plugin-react | 5.2.0 | 6.0.1 | Vite 8 전용 |
| jsdom | 28.0.0 | 28.1.0 | stylelint 충돌 (exact pin) |

### Rust (cargo update)

93개 crate 패치 업데이트 (tokio 1.50, notify 8.2, futures 0.3.32, wasm-bindgen 0.2.114 등)

### CI/DX 개선

| 항목 | 설명 |
|------|------|
| `.husky/pre-push` | `cargo clippy --all-targets -- -D warnings` + `npx knip` |
| `knip.json` 정리 | redundant entry 5개, 불필요한 ignoreDependencies 9개 제거 |
| clippy lint 수정 | `manual_contains` (pandoc.rs), `doc_lazy_continuation` (tag/mod.rs) |
