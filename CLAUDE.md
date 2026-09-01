# Baram — Lightweight WYSIWYG Markdown Editor

## 에이전트 정책 (OMC)

멀티 에이전트 오케스트레이션은 **oh-my-claudecode(OMC)** 를 활용한다 (상세 라우팅은 글로벌 CLAUDE.md 참조).

- 대규모 병렬 구현 `/team N:executor` · `/ultrawork` | 지속 완수 `/ralph` | 합의 계획 `/plan` · `/ralplan`
- 탐색/리서치는 `explore`(haiku), 소스 편집은 `executor`(sonnet)/`deep-executor`(opus)에 위임해 메인 컨텍스트 보존
- 독립 하위 작업 2개 이상이면 병렬 디스패치, 완료 선언 전 `verifier`로 증거 기반 검증

## 프로젝트 개요

Baram(바람)은 Tauri 2.0 + Tiptap/ProseMirror + React 기반의 경량 WYSIWYG 마크다운 에디터다.
Typora의 WYSIWYG 품질 + Obsidian의 확장성 + AI 네이티브 통합을 목표한다.

- **핵심 가치**: 가볍다(~10MB) / 아름답다(구문이 사라지는 WYSIWYG) / 연결된다(양방향 링크 + AI)
- **타겟 사용자**: AI 개발자(Skills 편집), 마크다운 파워유저(기술 문서), 연구자(수식+지식 링크)
- **라이선스**: Apache-2.0

## 기술 스택

| 영역                  | 기술                                 | 버전          |
| --------------------- | ------------------------------------ | ------------- |
| Desktop Framework     | Tauri                                | 2.0           |
| Backend               | Rust                                 | latest stable |
| Dev Runtime           | Node.js                              | 24 LTS        |
| Frontend              | React                                | 19            |
| Language              | TypeScript                           | 6.0           |
| Bundler               | Vite (rolldown)                      | 8             |
| Styling               | Tailwind CSS                         | 4             |
| Editor Engine         | Tiptap (ProseMirror)                 | v3            |
| Math / Code / Diagram | KaTeX / CodeMirror 6 / Mermaid.js    | latest        |
| State Management      | Zustand                              | latest        |
| Search / Link Index   | regex 검색 · 인메모리 HashMap (Rust) | —             |
| PDF Export            | chromiumoxide (headless)             | 0.9           |
| File Watcher          | notify (Rust)                        | 8             |
| Design Tokens         | Style Dictionary + W3C DTCG          | 5.x           |

## 디렉토리 구조

```
baram/
├── src-tauri/              # Rust 백엔드 (자체 CLAUDE.md)
│   └── src/
│       ├── commands/       # IPC 커맨드 핸들러 (thin layer): {fs,search,index,git,llm,export,
│       │                   #   config,context,embedding,keyring,plugin,snapshot,tag}_cmd.rs
│       ├── context/        # ContextManager (§88)        embedding/ # Knowledge Q&A (§11.4)
│       ├── search/         # regex 전문 검색 (§5.11)      index/     # 링크 인덱서 (§29)
│       ├── plugin/         # 플러그인 설치/레지스트리 (§69) snapshot/  # 버전 히스토리 (§71)
│       ├── tag/            # Vault 태그 인덱스 (§56m)
│       └── fs/ git/ llm/ export/ config/
├── src/                    # React 프론트엔드
│   ├── components/         # editor/ sidebar/ toolbar/ command/ ai/ settings/ layout/ journal/
│   ├── extensions/         # Tiptap Extensions (자체 CLAUDE.md): nodes/ marks/ plugins/ __tests__/
│   │                       #   registry.json = Extension 메타데이터 레지스트리 (등록 필수)
│   ├── pipeline/           # MD ↔ ProseMirror: md-to-pm.ts / pm-to-md.ts / transformers/
│   ├── stores/             # Zustand: context/ editor/ file/ ui/ settings/ system/ zettelkasten/ ai/
│   │                       #   RightPanelMode·SidebarPanel canonical = ui/ui.ts
│   ├── styles/             # CSS 모듈(~23): index.css(@import) + base.css(토큰·유틸·다크모드)
│   │                       #   generated/ = Style Dictionary 자동 생성 (DO NOT EDIT)
│   ├── ipc/                # Tauri IPC 래퍼 (types.ts, invoke.ts)
│   ├── sandbox/            # 플러그인 샌드박스 호스트/브리지 (§260) — 신뢰 티어 경계
│   └── hooks/ contexts/ i18n/(en,ko) keybindings/ plugins/ services/ spaces/ utils/ types/ spike/
├── tokens/                 # W3C DTCG 디자인 토큰: primitive/ semantic/ tokens-studio.json
├── scripts/                # audit-css-vars.ts, export-tokens-studio.ts
├── docs/                   # 공개 사용자 문서 — user-guide·keyboard-shortcuts·faq(앱 Help에 ?raw 번들), plugin-development
├── dev/                    # 내부 개발 문서 (public 배포 제외) — design/ plans/ impl-notes/
│                           #   superpowers/ features/ backlog.md next-steps.md progress.json
├── tests/                  # E2E (Playwright)
├── skills/                 # Claude Code Skills (원주인 로컬 전용 — 의도적 추적 해제, 이 머신에 없어도 정상)
├── .claude/commands/       # 슬래시 커맨드 (동상 — dev/와 같은 부류)
└── .claude/docs/           # 상황별 지침 (CI 계약·성능 기준·설계 § 지도 — 해당 작업 전 필독)
```

- **AGENTS.md는 gitignore된 per-machine 생성물**(OMC deepinit) — 갱신은 이 머신의 문서 정확성용일 뿐, 커밋/PR에 포함하려 하지 말 것

## 코딩 컨벤션

### TypeScript

- strict mode 필수
- `verbatimModuleSyntax` 활성 — 타입 전용 import는 반드시 `import type` 사용
- `npm run typecheck`는 3개 프로젝트(앱 / node 도구 / 테스트)를 모두 검사 — 테스트 코드도 타입 검사 대상
- React: 함수형 컴포넌트 + Hooks only (class 컴포넌트 사용 금지)
- 파일명: kebab-case (`math-block.ts`)
- export: PascalCase for 컴포넌트/Extension (`MathBlock`), camelCase for 함수/훅
- 타입: 인터페이스 우선, `I` 접두사 사용하지 않음
- **파일 크기**: 단일 파일 ~300줄 이하 유지. ~500줄 초과 시 집중 서브모듈로 분리
  - 단, Rust in-file `#[cfg(test)]`·사고 이력 주석은 카운트 제외하고 판단. **분리 금지 판정 파일**(응집이 본질): FileTree.tsx, viewport-virtualize.ts, vim/adapters/operations.ts, plugins/types.ts(공개 .d.ts 계약), plugin-loader.ts 동시성 클래스, Rust authorizer/task/write/logging
  - **부분 분리 완료·잔여는 응집 판정**(PR 519): mermaid-block-view.tsx(13-state 코어+훅 순서 계약), md-to-pm.ts(상호 재귀 블록 워커+공유 루프 카운터), App.tsx(useEditor 안정성 계약+keepalive/fileOps/navigation 순환 매듭) — 추가 분리는 시그니처 변경이 필요한 재설계
- **Zustand 셀렉터**: 컴포넌트에서 `useStore()` bare call 금지. 반드시 `useShallow((s) => ({...}))` 셀렉터 사용
  ```ts
  import { useShallow } from "zustand/shallow";
  const { foo, bar } = useUIStore(
    useShallow((s) => ({ foo: s.foo, bar: s.bar })),
  );
  ```
- **고빈도 경로의 store write는 동등성 관문 필수**: 값이 같으면 `set`을 호출하지 말 것 (partial은 새 root가 되어 모든 리스너를 깨운다)
- **Tauri 이벤트 cleanup**: `createLLMStream()` 반환값은 반드시 `try/finally`로 호출할 것 (`.catch()` 단독 사용 금지)
  ```ts
  const cleanup = await createLLMStream(id, { ... });
  try { await llmComplete(...); } catch { ... } finally { cleanup(); }
  ```
- **공유 유틸리티 위치** — 로컬 재구현 금지:
  - `basename()` / `dirname()` → `src/utils/path-utils.ts`
  - Journal 날짜 regex → `src/utils/journal/journal.ts` (`JOURNAL_FILENAME_RE`, `JOURNAL_DATE_PARTS_RE`, `JOURNAL_FILENAME_COMPACT_RE`)
  - `fuzzyMatch()` → `src/utils/file-search.ts`
  - `RightPanelMode` / `SidebarPanel` 타입 → `src/stores/ui/ui.ts`
  - PM 뷰 포커스 → `src/utils/editor/focus-editor-view.ts` (`focusEditorView`) — bare `view.focus()`는 non-editable 뷰에서 no-op
- **i18n(en/ko.json) 키는 알파벳 정렬** — 추가 시 정렬 자리에 삽입, 두 카탈로그 동시(parity 테스트 있음)
- **단축키 추가**: `keybinding-registry.ts` 등록이 규약(Settings 표시·리매핑 가능) — menu.rs accelerator만 달면 안 보인다. 네이티브 accelerator는 DOM과 별개 레이어라 조건부 양보 불가·리바인드 후에도 fallback 잔존; registry 경로는 상위 stopPropagation에 자동 양보된다. 충돌 조사 필수(Ctrl+R=vim redo, Mod+Shift+R=Memories 등) — 함정 상세는 menu.rs 상단 주석
- **perfectionist autofix는 주석을 안 옮긴다** — sort-modules는 doc 주석-함수 짝을 깨고, sort-imports는 파일 헤더 주석 **위로** import를 올린다. `--fix` 후 diff로 주석 위치 확인 (분리 캠페인 한 세션에서만 사고 6건)
- **madge --circular는 dynamic import·`import type`도 간선으로 센다** — 순환 판단은 static 값 간선만 손으로 분류해서 (TDZ 위험은 static 간선만이 만든다)
- **CSS 변수 네이밍**: `--color-{category}-{qualifier}` 패턴. **category는 정해진 9개뿐이다** — `accent` `bg` `border` `callout` `editor` `git` `graph` `status` `text` (`tokens/semantic/color-light.json`이 canonical). 위험/오류색은 `status` 아래에 있다: `--color-status-danger` (`--color-danger-*`는 없다)
- **공유 CSS 유틸리티**: `base.css`의 `.btn-unstyled`, `.flex-header`, `.text-truncate`, `.icon-btn`, `.flex-col` 사용
- **Shadow 토큰**: `--shadow-sm`, `--shadow-md`, `--shadow-lg`, `--shadow-xl`
- **CSS 파일 크기**: 단일 CSS 파일 ~1,500줄 이하 유지

### Rust

- 모듈 구조: `mod.rs` 패턴 사용
- zip 추출은 `fs/archive.rs`의 `ExtractBounds` 공용 코어 경유 (6종 폭탄 방어 — fs·plugin 공유; 경로 봉쇄는 호출자 책임)
- 에러 처리: `thiserror` crate으로 커스텀 에러 타입 정의
- IPC 커맨드: `Result<T, String>` 반환 (Tauri 직렬화 제약)

### Extension

- 모든 Tiptap Extension은 `Node.create()` / `Mark.create()` / `Extension.create()` 패턴
- 반드시 라운드트립 테스트(`__tests__/{name}.test.ts`) + 파이프라인 변환기(`pipeline/transformers/{name}-transformer.ts`) 포함
- `registry.json`에 메타데이터 등록 필수

### 로컬 실행

- **프로젝트 루트에서** `npm run dev`(백그라운드) + `./src-tauri/target/debug/baram` — `npm run tauri dev`는 cwd가 `src-tauri/`로 바뀐다
- **프런트엔드 출처는 실행법이 아니라 빌드법이 정한다** — `tauri-build`가 `cfg(dev)`를 붙였는지로 갈리고, 바이너리에 고정된다
  - `npm run tauri dev`로 빌드한 바이너리: dev 서버가 서빙 → TS/CSS 변경이 재빌드 없이 반영
  - 맨 `cargo build`로 빌드한 바이너리: 컴파일 시점의 `dist/`를 **내장** → dev 서버가 떠 있어도 무시한다. 프런트 변경을 보려면 `npm run build && (cd src-tauri && cargo build)` 후 재실행
  - 증상: 고친 게 화면에 안 나온다. 확인법은 `lsof -nP -p $(pgrep -f target/debug/baram) | grep 1420` — 연결이 없으면 내장 자산을 쓰는 바이너리다

### 테스트

- **Vitest** (TypeScript 단위/통합) — `npm test` → `vitest run`. `npx jest` 사용 금지 (Babel 파싱 실패)
- **게이트 exit code는 파이프 없이 캡처**: `cmd | tail`은 tail의 exit를 반환한다 — `cmd > /tmp/log; echo $?` 또는 zsh `pipestatus` 사용
- cargo test (Rust 단위) · Playwright (E2E, 크로스 플랫폼)
- **라운드트립 보존이 최우선 품질 기준**: MD → ProseMirror → MD 변환 시 원본과 정확히 일치해야 함
- **성능 회귀 테스트는 타이밍이 아니라 카운트로 고정**: 분절·순회·dispatch 횟수를 세고, 결함 재도입으로 핀 민감도까지 확인
- **jsdom 에디터 픽스처**: `focus()`는 DOM에 붙은 요소만 · contenteditable은 `tabindex` 없으면 포커스 불가 · `focusin`은 수동 dispatch · `Range.getClientRects` 없음(폴리필 필요)
- **리터럴 경로 스캔 테스트**: revocation 테스트 2개·`scripts/rust-constants.ts`는 `src-tauri/src/plugin/mod.rs`를 경로로 읽어 스캔(REVOCATION 상수 3개는 그 파일에 고정), vim `editable-ownership.test.tsx`의 REGISTER_ALLOW는 경로 allowlist — 심볼을 옮기면 컴파일은 통과해도 검증이 조용히 죽는다. 이동 시 스캔 경로 동반 갱신
  - media-toolbar-reveal.test.ts는 소스 텍스트를 스캔해 NodeViewWrapper+MediaToolbar 파일 수 ≥4를 요구 — 뷰에서 toolbar 블록을 다른 파일로 빼면 깨진다
  - pipeline/에 프로덕션 파일을 추가하면 import-boundary의 `MD_TO_PM_ROUTE_FILES` Set(+감사 주석의 개수·날짜)을 갱신해야 한다 — allowlist를 넓히는 우회는 금지

### 의존성 관리

- **tiptap 그룹 업데이트**: `@tiptap/*`는 core·extensions·bubble/floating-menu(숨은 멤버)까지 exact-version peer로 묶여 있어 `npm update`/`npm install`이 ERESOLVE로 교착한다. package-lock에서 `node_modules/@tiptap/*` 항목을 삭제한 뒤 `npm install`로 전체 재해결할 것
- 설치 버전 확인은 `npm ls <pkg>` — exports 제한 패키지(@tiptap/react 등)는 `require('pkg/package.json')`이 실패

### Git

- Conventional Commits: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`
- 커밋 메시지에 설계 문서 섹션 참조 포함 (예: `feat(§5.3): implement KaTeX math block`)
- **§ 번호는 추측 금지** — 커밋 전 대상 파일 헤더 주석 또는 `git log --format=%s -- <파일>`로 실측 (fold=§4.2, slash=§4.6처럼 직관과 다른 경우 다수)
- **커밋 메시지는 미리 검증**: `npx --no -- commitlint < msg.txt`. 본문에서 줄 시작 `단어:`는 footer로 오인되므로 줄바꿈 위치를 조정할 것
- 브랜치: `feature/m2-basic-editing`, `fix/roundtrip-heading-whitespace`
- **pre-push hook**: `npm run lint`(CI lint 잡 전체, knip 포함) + `cargo clippy --all-targets` 실행 — push당 ~2분+, cargo cold면 5~7분. push는 백그라운드로 실행할 것
- **push 전 `npm run lint` 필수**: CI lint 잡은 pre-push hook보다 넓다 — `lint:doc-comments`(doc 주석 바로 뒤 doc 주석 금지, 함수 이동·cherry-pick 시 잘 깨짐)·stylelint·audit까지. "테스트 그린 ≠ CI 그린"
- **PR CI는 브랜치가 아니라 "브랜치+최신 main 머지 트리"를 검증한다** — base가 낡으면 로컬 전부 그린이어도 CI만 깨질 수 있다(옮겨진 심볼 import 등). origin/main 전진을 발견하면 rebase 여부를 논의할 것

### 디자인 토큰

- **3-tier 계층**: Primitive (raw values) → Semantic (meaning) → Component CSS
- **소스**: `tokens/*.json` (W3C DTCG) → **빌드** `npm run tokens:build` → `src/styles/generated/` 자동 생성
- **감사** `npm run audit:css-vars` (미정의 CSS 변수 검출) · **Figma export** `npm run tokens:export` → `tokens/tokens-studio.json`
- **Settings store version**: 18 — 실제 값은 `src/stores/settings/store.ts`의 `version:`이 유일한 출처다(이 줄은 참고용이고 실제로 12에서 멎어 있었다). 새 키를 더할 때 기본값이 오늘 동작과 같으면 마이그레이션이 필요 없다 — 기존 사용자에게 **다른** 기본값을 보여야 할 때만 backfill이 필요하다

## 설계 문서 참조 규칙

구현 시 반드시 해당 설계 문서 섹션을 참조할 것. `§` 번호를 코드 주석과 커밋에 유지한다.
어떤 §가 어느 문서(part3~part12)에 있는지는 **`.claude/docs/design-doc-map.md`** 참조.

## 성능 기준 (Part 8 §8.4)

핵심: **타이핑 레이턴시 < 16ms** · 10,000줄 파일 열기 < 1초. 전체 지표 표는 **`.claude/docs/performance-budgets.md`** 참조 — 성능 작업·회귀 판단 시 먼저 읽을 것.

## CI/CD 계약 (이슈 207 / PR 208)

PR에서 rust skip이 허용되는 유일한 경우는 "rust 관련 경로를 안 건드린 PR" — 그 외 모든 skip/실패는 빨간불.
릴리스·워크플로(.github/) 작업 전에는 반드시 **`.claude/docs/ci-contract.md`** 를 읽을 것 (reusable workflow 함정, SHA 핀 규칙, 러너 고정 등).

## 현재 Phase 및 마일스톤

- **Phase 1 (MVP, M1~M6)** · **Phase 2 (확장, M7~M9)** — ✅ 완료
- **Phase 3 (고급 기능)** — 진행 중
  - ✅ 완료: 테이블 고급(셀 병합·가상 스크롤), 쿼리 블록(§5.13), Git 고급(§67), 파일 스냅샷/버전 히스토리(§71), 네임스페이스(§61, P2 보류), Skills 모드(§72), Settings UI 리디자인, 키보드 단축키 커스터마이징, Heading/List Folding, 코드 리팩토링 + CSS 디자인 토큰 시스템, Vault System(§80~§90), macOS Universal Binary 릴리스(PR #200)
  - ✅ 완료(v0.5.0, 2026-07-30 발행): **플러그인 실행 모델 §260 6개 페이즈** — trusted/sandboxed 두 티어, per-plugin WebviewWindow + Rust `plugin_call` 브로커, 설치 동의(consent) 게이트, 앱 커맨드 ACL 락다운. 플러그인이 기본 활성(§259의 `VITE_ENABLE_PLUGINS` 게이트 제거). 라이브 레지스트리에 `baram-word-count` 2.0.0 발행
  - ✅ 완료(v0.5.0): 파일 뷰어 — PDF(읽기 전용), HTML(샌드박스 프리뷰 + 소스 토글), 이미지·SVG(내장 media-viewer 플러그인 + 공개 `viewer` 확장점, §69)
  - 🚧 미착수: Canvas, Agent Mode(§11.6), Knowledge Q&A(§11.4), 실시간 협업

> 완료 항목의 상세 이력은 git 히스토리 · `dev/next-steps.md` · `dev/progress.json` 참조.
