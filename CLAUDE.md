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

| 영역                | 기술                          | 버전            |
| ----------------- | --------------------------- | ------------- |
| Desktop Framework | Tauri                       | 2.0           |
| Backend           | Rust                        | latest stable |
| Dev Runtime       | Node.js                     | 24 LTS        |
| Frontend          | React                       | 19            |
| Language          | TypeScript                  | 6.0           |
| Bundler           | Vite (rolldown)             | 8             |
| Styling           | Tailwind CSS                | 4             |
| Editor Engine     | Tiptap (ProseMirror)        | v3            |
| Math / Code / Diagram | KaTeX / CodeMirror 6 / Mermaid.js | latest    |
| State Management  | Zustand                     | latest        |
| Search / Link Index | regex 검색 · 인메모리 HashMap (Rust) | —          |
| PDF Export        | chromiumoxide (headless)    | 0.9           |
| File Watcher      | notify (Rust)               | 8             |
| Design Tokens     | Style Dictionary + W3C DTCG | 5.x           |

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
│   ├── styles/             # CSS 모듈(~19): index.css(@import) + base.css(토큰·유틸·다크모드)
│   │                       #   generated/ = Style Dictionary 자동 생성 (DO NOT EDIT)
│   ├── ipc/                # Tauri IPC 래퍼 (types.ts, invoke.ts)
│   └── hooks/ contexts/ i18n/(en,ko) keybindings/ plugins/ services/ spaces/ utils/ types/
├── tokens/                 # W3C DTCG 디자인 토큰: primitive/ semantic/ tokens-studio.json
├── scripts/                # audit-css-vars.ts, export-tokens-studio.ts
├── docs/                   # 공개 사용자 문서 — user-guide·keyboard-shortcuts·faq(앱 Help에 ?raw 번들), plugin-development
├── dev/                    # 내부 개발 문서 (public 배포 제외) — design/ plans/ impl-notes/
│                           #   superpowers/ features/ backlog.md next-steps.md progress.json
├── tests/                  # E2E (Playwright)
├── skills/                 # Claude Code Skills
└── .claude/commands/       # 슬래시 커맨드
```

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
- **Zustand 셀렉터**: 컴포넌트에서 `useStore()` bare call 금지. 반드시 `useShallow((s) => ({...}))` 셀렉터 사용
  ```ts
  import { useShallow } from "zustand/shallow";
  const { foo, bar } = useUIStore(
    useShallow((s) => ({ foo: s.foo, bar: s.bar })),
  );
  ```
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
- **CSS 변수 네이밍**: `--color-{category}-{qualifier}` 패턴 (예: `--color-bg-default`, `--color-text-muted`, `--color-accent-default`)
- **공유 CSS 유틸리티**: `base.css`의 `.btn-unstyled`, `.flex-header`, `.text-truncate`, `.icon-btn`, `.flex-col` 사용
- **Shadow 토큰**: `--shadow-sm`, `--shadow-md`, `--shadow-lg`, `--shadow-xl`
- **CSS 파일 크기**: 단일 CSS 파일 ~1,500줄 이하 유지

### Rust

- 모듈 구조: `mod.rs` 패턴 사용
- 에러 처리: `thiserror` crate으로 커스텀 에러 타입 정의
- IPC 커맨드: `Result<T, String>` 반환 (Tauri 직렬화 제약)

### Extension

- 모든 Tiptap Extension은 `Node.create()` / `Mark.create()` / `Extension.create()` 패턴
- 반드시 라운드트립 테스트(`__tests__/{name}.test.ts`) + 파이프라인 변환기(`pipeline/transformers/{name}-transformer.ts`) 포함
- `registry.json`에 메타데이터 등록 필수

### 테스트

- **Vitest** (TypeScript 단위/통합) — `npm test` → `vitest run`. `npx jest` 사용 금지 (Babel 파싱 실패)
- **게이트 exit code는 파이프 없이 캡처**: `cmd | tail`은 tail의 exit를 반환한다 — `cmd > /tmp/log; echo $?` 또는 zsh `pipestatus` 사용
- cargo test (Rust 단위) · Playwright (E2E, 크로스 플랫폼)
- **라운드트립 보존이 최우선 품질 기준**: MD → ProseMirror → MD 변환 시 원본과 정확히 일치해야 함

### 의존성 관리

- **tiptap 그룹 업데이트**: `@tiptap/*`는 core·extensions·bubble/floating-menu(숨은 멤버)까지 exact-version peer로 묶여 있어 `npm update`/`npm install`이 ERESOLVE로 교착한다. package-lock에서 `node_modules/@tiptap/*` 항목을 삭제한 뒤 `npm install`로 전체 재해결할 것
- 설치 버전 확인은 `npm ls <pkg>` — exports 제한 패키지(@tiptap/react 등)는 `require('pkg/package.json')`이 실패

### Git

- Conventional Commits: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`
- 커밋 메시지에 설계 문서 섹션 참조 포함 (예: `feat(§5.3): implement KaTeX math block`)
- 브랜치: `feature/m2-basic-editing`, `fix/roundtrip-heading-whitespace`
- **pre-push hook**: `cargo clippy --all-targets` + `npx knip` 실행 — base 변경 후 첫 push는 cargo cold라 5~7분 소요. push는 백그라운드로 실행할 것

### 디자인 토큰

- **3-tier 계층**: Primitive (raw values) → Semantic (meaning) → Component CSS
- **소스**: `tokens/*.json` (W3C DTCG) → **빌드** `npm run tokens:build` → `src/styles/generated/` 자동 생성
- **감사** `npm run audit:css-vars` (미정의 CSS 변수 검출) · **Figma export** `npm run tokens:export` → `tokens/tokens-studio.json`
- **Settings store version**: 12 (v10: CSS 변수키 리네이밍, v11: ThemeColors 16→25 키 확장, v12: 대형 파일 windowing kill-switch)

## 설계 문서 참조 규칙

구현 시 반드시 해당 설계 문서 섹션을 참조할 것. `§` 번호를 코드 주석과 커밋에 유지한다.

| 영역        | 설계 문서                                  | 핵심 참조                                                                                                                                     |
| --------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 아키텍처      | `dev/design/part3-architecture.md`    | §3.1 스택, §3.2 IPC, §3.3 엔진, §3.4 Extension, §3.5 상태, §3.6 파일                                                                              |
| UI/UX     | `dev/design/part4-uiux.md`            | §4.1 원칙, §4.2 레이아웃, §4.3~§4.8 각 요소                                                                                                        |
| 기능 상세     | `dev/design/part5-core-features.md`   | §5.1~§5.15 각 기능 상세 스펙                                                                                                                     |
| AI 통합     | `dev/design/part6-ai-integration.md`  | §6.1 전략, §6.2 5-Level, §6.3 Provider                                                                                                      |
| 데이터 모델    | `dev/design/part7-data-models.md`     | §7.1 MD 규격, §7.2 PM 스키마, §7.3~§7.5 DB                                                                                                     |
| 로드맵       | `dev/design/part8-roadmap.md`         | §8.1 Phase, §8.2 마일스톤, §8.4 품질, §8.6 의존성                                                                                                  |
| AI 고도화    | `dev/design/part11-ai-enhancement.md` | §11.2 빠른 개선, §11.3 Writing Flow, §11.4 Knowledge Q&A, §11.5 Semantic Wikilink, §11.6 Agent Mode, §11.7 Authorship, §11.8 Smart Templates |
| Vault 시스템 | `dev/design/part12-vault-system.md`   | §80 Context 모델, §81 워크스페이스, §82~§84 UI, §85 Journal, §86 설정 계층, §87 Cross-vault 링크, §88 ContextManager, §89~§90 파일/시작                     |

## 성능 기준 (Part 8 §8.4)

| 지표            | 목표                      |
| ------------- | ----------------------- |
| 앱 시작 → 에디터 준비 | < 1.5초 (콜드), < 0.5초 (웜) |
| 1,000줄 파일 열기  | < 200ms                 |
| 10,000줄 파일 열기 | < 1초                    |
| 타이핑 레이턴시      | < 16ms (60fps)          |
| KaTeX 렌더링     | < 50ms                  |
| 파일 저장         | < 100ms                 |
| 앱 바이너리 크기     | < 15MB                  |
| 유휴 메모리        | < 100MB                 |

## CI/CD 계약 (이슈 207 / PR 208)

- **push CI는 main만** 돈다 — feature 브랜치는 PR CI가 검증 (이중 실행 제거). main push는 test·rust까지 전체 스위트 실행
- **ci-pass 게이트**: rust skip이 허용되는 유일한 경우는 "rust 관련 경로를 안 건드린 PR". 그 외 모든 skip/실패는 빨간불
- **릴리스 태그 규칙**: `v*` 태그는 package.json 버전과 일치하고 **main에 포함된 커밋**이어야 함 — verify-tag 잡이 불일치 시 즉시 실패
- **reusable workflow 함정**: called workflow 안에서 `github.event_name`은 호출자의 이벤트 — 절대 `'workflow_call'`이 아님. 릴리스 여부는 `inputs.release`로 판별
- **액션은 커밋 SHA 핀** (+`# vN` 주석, dependabot이 갱신). dtolnay/rust-toolchain만 예외: master 히스토리 SHA + `toolchain:` 입력 (ref명이 툴체인을 선택, release 브랜치 SHA는 GC됨)
- **release Linux 러너는 ubuntu-22.04 고정** — 오래된 glibc에서 빌드해야 배포 호환이 넓어짐. "현대화" 금지
- **gitleaks는 curl 설치** — dependabot 사각지대라 버전+체크섬을 손으로 함께 갱신

## 현재 Phase 및 마일스톤

- **Phase 1 (MVP, M1~M6)** · **Phase 2 (확장, M7~M9)** — ✅ 완료
- **Phase 3 (고급 기능)** — 진행 중
  - ✅ 완료: 테이블 고급(셀 병합·가상 스크롤), 쿼리 블록(§5.13), Git 고급(§67), 파일 스냅샷/버전 히스토리(§71), 네임스페이스(§61, P2 보류), Skills 모드(§72), Settings UI 리디자인, 키보드 단축키 커스터마이징, Heading/List Folding, 코드 리팩토링 + CSS 디자인 토큰 시스템, Vault System(§80~§90), macOS Universal Binary 릴리스(PR #200)
  - 🚧 미착수: Canvas, Agent Mode(§11.6), Knowledge Q&A(§11.4), 실시간 협업

> 완료 항목의 상세 이력은 git 히스토리 · `dev/next-steps.md` · `dev/progress.json` 참조.
