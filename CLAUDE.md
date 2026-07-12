# Baram — Lightweight WYSIWYG Markdown Editor

## 에이전트 정책

- 멀티 에이전트 오케스트레이션은 \*\*oh-my-claudecode(OMC)\*\*를 활용할 것
  - 대규모 구현: `/team N:executor "task"` 또는 `/ultrawork`로 병렬 실행
  - 지속적 완수: `/ralph`로 완료될 때까지 반복 루프
  - 계획 수립: `/plan` 또는 `/ralplan`으로 합의 기반 설계
  - 코드 리뷰: `/code-review`, `/security-review`로 전문 에이전트 위임
- 독립적인 하위 작업이 2개 이상이면 OMC의 `executor` / `deep-executor` 에이전트를 병렬 디스패치할 것
- 코드베이스 탐색/리서치는 `explore` (haiku) 에이전트에 위임하여 메인 컨텍스트를 보존할 것
- 소스 코드 편집은 `executor` (sonnet) 에이전트에 위임, 복잡한 작업은 `deep-executor` (opus) 사용
- 검증은 `verifier` 에이전트로 증거 기반 확인 후 완료 선언할 것

## 프로젝트 개요

Baram(바람)은 Tauri 2.0 + Tiptap/ProseMirror + React 기반의 경량 WYSIWYG 마크다운 에디터다.
Typora의 WYSIWYG 품질 + Obsidian의 확장성 + AI 네이티브 통합을 목표한다.

- **핵심 가치**: 가볍다 (\~10MB) / 아름답다 (구문이 사라지는 WYSIWYG) / 연결된다 (양방향 링크 + AI)
- **타겟 사용자**: AI 개발자(Skills 편집), 마크다운 파워유저(기술 문서), 연구자(수식+지식 링크)
- **라이선스**: Apache-2.0

## 기술 스택

| 영역                | 기술                          | 버전            |
| ----------------- | --------------------------- | ------------- |
| Desktop Framework | Tauri                       | 2.0           |
| Backend           | Rust                        | latest stable |
| Frontend          | React + TypeScript          | 19            |
| Bundler           | Vite                        | 6             |
| Styling           | Tailwind CSS                | 4             |
| Editor Engine     | Tiptap (ProseMirror)        | v2            |
| Math Rendering    | KaTeX                       | latest        |
| Code Blocks       | CodeMirror                  | 6             |
| Diagrams          | Mermaid.js                  | latest        |
| State Management  | Zustand                     | latest        |
| Full-text Search  | tantivy (Rust)              | latest        |
| Database          | SQLite (rusqlite)           | latest        |
| File Watcher      | notify (Rust)               | latest        |
| Design Tokens     | Style Dictionary + W3C DTCG | 5.x           |

## 디렉토리 구조

```
baram/
├── CLAUDE.md                # ← 이 파일
├── src-tauri/               # Rust 백엔드
│   ├── CLAUDE.md            # Rust 영역 컨텍스트
│   ├── src/
│   │   ├── main.rs
│   │   ├── lib.rs
│   │   ├── commands/        # IPC 커맨드 핸들러 (thin layer)
│   │   │   ├── mod.rs
│   │   │   ├── fs_cmd.rs
│   │   │   ├── search_cmd.rs
│   │   │   ├── index_cmd.rs
│   │   │   ├── git_cmd.rs
│   │   │   ├── llm_cmd.rs
│   │   │   ├── export_cmd.rs
│   │   │   ├── config_cmd.rs
│   │   │   └── context_cmd.rs
│   │   ├── context/         # 컨텍스트 관리자 (§88)
│   │   ├── fs/              # 파일 시스템 모듈
│   │   ├── search/          # tantivy 검색 엔진
│   │   ├── index/           # 링크 인덱서 (SQLite)
│   │   ├── git/             # Git 연동
│   │   ├── llm/             # LLM API 프록시
│   │   ├── export/          # 내보내기 엔진 (PDF, HTML)
│   │   └── config/          # 설정 관리
│   ├── Cargo.toml
│   └── tauri.conf.json
├── src/                     # React 프론트엔드
│   ├── main.tsx             # 엔트리포인트
│   ├── App.tsx
│   ├── components/          # UI 컴포넌트
│   │   ├── editor/          # EditorArea, EditorToolbar
│   │   ├── sidebar/         # FileTree, Outline, Search, Backlinks
│   │   ├── toolbar/         # FloatingToolbar, BlockHandle, StatusBar
│   │   ├── command/         # CommandPalette, SlashMenu
│   │   ├── ai/              # AIPanel, InlineAIEdit, GhostText
│   │   ├── settings/        # SettingsModal, 각 탭 컴포넌트
│   │   └── layout/          # AppLayout, TabBar, Splitter
│   ├── extensions/          # Tiptap Extensions
│   │   ├── CLAUDE.md        # Extension 영역 컨텍스트
│   │   ├── registry.json    # Extension 메타데이터 레지스트리
│   │   ├── nodes/           # Node Extensions (heading, codeBlock, mathBlock, ...)
│   │   ├── marks/           # Mark Extensions (bold, italic, link, wikilink, ...)
│   │   ├── plugins/         # Plugin Extensions (history, search, collaboration, ...)
│   │   └── __tests__/       # Extension 라운드트립 테스트
│   ├── pipeline/            # MD ↔ ProseMirror 변환
│   │   ├── md-to-pm.ts      # remark-parse → mdast → ProseMirror Doc
│   │   ├── pm-to-md.ts      # ProseMirror Doc → mdast → remark-stringify
│   │   ├── transformers/    # 노드별 변환기 ({name}-transformer.ts)
│   │   └── __tests__/       # 파이프라인 테스트
│   ├── stores/              # Zustand 스토어 (서브디렉토리 구조)
│   │   ├── context/         # context.ts — 컨텍스트 관리 (§80-§81)
│   │   ├── editor/          # editor.ts — 에디터 상태 (활성 탭, dirty 상태)
│   │   ├── file/            # file.ts, workspace.ts — 파일 시스템, 워크스페이스
│   │   ├── ui/              # ui.ts — UI 레이아웃 (사이드바, 패널, 모달)
│   │   │                    #   RightPanelMode, SidebarPanel 타입 canonical 위치
│   │   ├── settings/        # store.ts — 사용자 설정 (테마, 폰트, Extension)
│   │   ├── system/          # git.ts 등 시스템 상태
│   │   └── ai/              # ai.ts — AI 상태 (스트리밍, Ghost Text, provider)
│   ├── styles/              # CSS 모듈 (19개 파일)
│   │   ├── index.css        # @import 오케스트레이터 (App.css 대체)
│   │   ├── base.css         # 토큰 import + reset + 공유 유틸리티 + 다크모드
│   │   ├── generated/       # Style Dictionary 자동 생성 (DO NOT EDIT)
│   │   ├── editor.css       # Tiptap 에디터 스타일
│   │   ├── layout.css, file-tree.css, toolbar.css, dialogs.css
│   │   ├── settings.css, git.css, ai.css, skills.css
│   │   ├── journal-calendar.css, journal-mood.css, journal-notes.css, journal-extras.css
│   │   ├── links.css, graph.css, panels.css, components.css
│   ├── hooks/               # React Hooks
│   ├── ipc/                 # Tauri IPC 래퍼
│   │   ├── types.ts         # IPC 타입 정의
│   │   └── invoke.ts        # invoke 유틸리티
│   ├── utils/               # 유틸리티
│   └── types/               # 공유 TypeScript 타입
├── tokens/                  # W3C DTCG 디자인 토큰 (JSON)
│   ├── primitive/           # color.json, spacing.json, typography.json
│   ├── semantic/            # color-light.json, color-dark.json
│   └── tokens-studio.json   # Figma Tokens Studio export
├── scripts/
│   ├── audit-css-vars.ts    # CSS 변수 감사 스크립트
│   └── export-tokens-studio.ts  # Figma export 스크립트
├── docs/                    # 사용자/배포용 문서 (public)
│   ├── user-guide.md        # 사용자 가이드 (앱 Help 패널에 ?raw 번들)
│   ├── keyboard-shortcuts.md # 단축키 레퍼런스 (앱 Help 패널에 ?raw 번들)
│   ├── faq.md               # FAQ (앱 Help 패널에 ?raw 번들)
│   └── plugin-development.md # 플러그인 개발 가이드
├── dev/                     # 내부 개발 문서 (public 배포 시 제외)
│   ├── design/              # 설계 문서 (Part 1~14)
│   ├── plans/               # 구현 계획
│   ├── impl-notes/          # 구현 노트 (/implement 시 생성)
│   ├── superpowers/         # Brainstorm 스펙/플랜 (specs/, plans/)
│   ├── features/            # 기능 카탈로그
│   ├── backlog.md           # 기술부채 & 보안 백로그
│   ├── next-steps.md        # 로드맵
│   ├── progress.json        # 진행 상황 추적
│   └── claude-automation-guide.md  # Claude Code 자동화 가이드
├── tests/                   # E2E 테스트 (Playwright)
├── skills/                  # Claude Code Skills
└── .claude/
    └── commands/            # Claude Code 슬래시 커맨드
```

## 코딩 컨벤션

### TypeScript

- strict mode 필수
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
- **CSS 파일 크기**: 단일 CSS 파일 \~1,500줄 이하 유지

### Rust

- 모듈 구조: `mod.rs` 패턴 사용
- 에러 처리: `thiserror` crate으로 커스텀 에러 타입 정의
- IPC 커맨드: `Result<T, String>` 반환 (Tauri 직렬화 제약)

### Extension

- 모든 Tiptap Extension은 `Node.create()` / `Mark.create()` / `Extension.create()` 패턴
- 반드시 라운드트립 테스트 포함 (`__tests__/{name}.test.ts`)
- 반드시 파이프라인 변환기 포함 (`pipeline/transformers/{name}-transformer.ts`)
- `registry.json`에 메타데이터 등록 필수

### 테스트

- **Vitest** (TypeScript 단위/통합) — `npm test` → `vitest run`. `npx jest` 사용 금지 (Babel 파싱 실패)
- cargo test (Rust 단위)
- Playwright (E2E, 크로스 플랫폼)
- **라운드트립 보존이 최우선 품질 기준**: MD → ProseMirror → MD 변환 시 원본과 정확히 일치해야 함

### Git

- Conventional Commits: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`
- 커밋 메시지에 설계 문서 섹션 참조 포함 (예: `feat(§5.3): implement KaTeX math block`)
- 브랜치: `feature/m2-basic-editing`, `fix/roundtrip-heading-whitespace`

### 디자인 토큰

- **3-tier 계층**: Primitive (raw values) → Semantic (meaning) → Component CSS
- **소스**: `tokens/*.json` (W3C DTCG 포맷)
- **빌드**: `npm run tokens:build` → `src/styles/generated/` 자동 생성
- **감사**: `npm run audit:css-vars` — 미정의 CSS 변수 검출
- **Figma export**: `npm run tokens:export` → `tokens/tokens-studio.json`
- **Settings store version**: 12 (v10: CSS 변수키 리네이밍, v11: ThemeColors 16→25 키 확장, v12: 대형 파일 windowing kill-switch)

## 설계 문서 참조 규칙

구현 시 반드시 해당 설계 문서 섹션을 참조할 것. `§` 번호를 코드 주석과 커밋에 유지한다.

| 영역        | 설계 문서                                  | 핵심 참조                                                                                                                                     |
| --------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 아키텍처      | `dev/design/part3-architecture.md`    | §3.1 스택, §3.2 IPC, §3.3 엔진, §3.4 Extension, §3.5 상태, §3.6 파일                                                                              |
| UI/UX     | `dev/design/part4-uiux.md`            | §4.1 원칙, §4.2 레이아웃, §4.3\~§4.8 각 요소                                                                                                       |
| 기능 상세     | `dev/design/part5-core-features.md`   | §5.1\~§5.15 각 기능 상세 스펙                                                                                                                    |
| AI 통합     | `dev/design/part6-ai-integration.md`  | §6.1 전략, §6.2 5-Level, §6.3 Provider                                                                                                      |
| 데이터 모델    | `dev/design/part7-data-models.md`     | §7.1 MD 규격, §7.2 PM 스키마, §7.3\~§7.5 DB                                                                                                    |
| 로드맵       | `dev/design/part8-roadmap.md`         | §8.1 Phase, §8.2 마일스톤, §8.4 품질, §8.6 의존성                                                                                                  |
| AI 고도화    | `dev/design/part11-ai-enhancement.md` | §11.2 빠른 개선, §11.3 Writing Flow, §11.4 Knowledge Q\&A, §11.5 Semantic Wikilink, §11.6 Agent Mode, §11.7 Authorship, §11.8 Smart Templates |
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
- **액션은 커밋 SHA 핀** (+`# vN` 주석, dependabot이 갱신). dtolnay/rust-toolchain만 예외 규칙: master 히스토리 SHA + `toolchain:` 입력 (ref명이 툴체인을 선택하고, release 브랜치 SHA는 GC됨)
- **release Linux 러너는 ubuntu-22.04 고정** — 오래된 glibc에서 빌드해야 배포 호환이 넓어짐. "현대화" 금지
- **gitleaks는 curl 설치** — dependabot 사각지대라 버전+체크섬을 손으로 함께 갱신

## 현재 Phase 및 마일스톤

Phase 1: MVP — ✅ 완료 (M1~M6)
Phase 2: 확장 — ✅ 완료 (M7~M9)

- M7: 연결 시스템 & 네비게이션 — ✅ 완료
- M8: AI 심화 + Skills 편집 — ✅ 완료
- M9: 생산성 도구 — ✅ 완료 (인라인 마크, TOC, 테이블 Tier 3, 각주, 도움말 패널, 글로벌 검색, 정의 목록, Mermaid 고도화, Git Basic, 테마 시스템, Extension Settings, Workspace Presets, Export for Notion, Pandoc Export, Journal §56a\~§56m, @멘션, 태그 시스템)

Phase 3: 고급 기능 — 진행 중

- M10 테이블 고급 (셀 병합 + 가상 스크롤) — ✅ 완료
- 쿼리 블록 (§5.13) — ✅ 완료
- Git 고급 (§67: log, stash, remote, delete branch) — ✅ 완료
- 파일 스냅샷 / 버전 히스토리 (§71) — ✅ 완료
- 네임스페이스 (§61) — ✅ 완료 (P0+P1, P2 자동 prefix는 YAGNI 보류)
- Skills 전용 모드 (§72) — ✅ 완료
- Settings UI 리디자인 (P0+P1) — ✅ 완료
- 키보드 단축키 커스터마이징 — ✅ 완료
- Heading & List Folding (Obsidian-style) — ✅ 완료
- **코드 통합/리팩토링** (`refactoring/ai` 브랜치) — ✅ 완료 (2026-03-15)
  - 대형 파일 분리 (export-html, slash-command, ContextMenu)
  - 중복 코드 통합 (fuzzyMatch, RightPanelMode, journal regex, path utils)
  - 버그 수정 (listener leak, dead state, React hook 순서, useShallow)
  - PR 미생성 — main 머지 전 상태
- **CSS 디자인 토큰 시스템** (`refactoring/design-tokens` 브랜치) — ✅ 완료 (2026-03-15)
  - Style Dictionary v5 + W3C DTCG 토큰 시스템
  - App.css (14,506줄) → 19개 모듈 CSS 파일 분리
  - 13개 CSS 변수 체계적 리네이밍
  - 공유 유틸리티 클래스 5개 + shadow 토큰
  - 커스텀 테마 v10 마이그레이션
  - Figma Tokens Studio 호환 export
  - PR 미생성 — refactoring/ai 머지 전 상태
- **Vault System (§80-§90)** — ✅ 완료
  - Context 모델 + 앱 워크스페이스 (§80-§81)
  - 컨텍스트 탭 바 UI + 에디터 탭 표시 (§82-§83)
  - 검색 Scope UI (§84)
  - Journal 시스템 재설계 + Work Log (§85)
  - 설정 3-Tier 계층 (§86)
  - Cross-vault 링크 + 그래프 (§87)
  - ContextManager Rust 백엔드 (§88)
  - 독립 파일 열기 + FileContext (§89)
  - 앱 시작 흐름 + 마이그레이션 (§90)
- Canvas, Agent Mode, Knowledge Q\&A, 실시간 협업 등 — 미착수
