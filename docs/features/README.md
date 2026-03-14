# Baram Feature Catalog

> **Last Updated**: 2026-03-14
> **Codebase Basis**: `main` branch, verified against actual source code

Baram의 모든 기능을 코드 기반으로 정리한 문서. 추측이 아닌 실제 구현 상태만 기록한다.

---

## 목차

1. [전체 현황](#전체-현황)
2. [에디터 코어](#1-에디터-코어)
3. [블록 요소](#2-블록-요소)
4. [인라인 마크](#3-인라인-마크)
5. [에디터 플러그인](#4-에디터-플러그인)
6. [UI/UX](#5-uiux)
7. [파일 관리](#6-파일-관리)
8. [연결 시스템 & 네비게이션](#7-연결-시스템--네비게이션)
9. [검색](#8-검색)
10. [AI 통합](#9-ai-통합)
11. [Skills 시스템](#10-skills-시스템)
12. [저널](#11-저널)
13. [Git 연동](#12-git-연동)
14. [내보내기](#13-내보내기)
15. [설정 & 커스터마이징](#14-설정--커스터마이징)
16. [플러그인 시스템](#15-플러그인-시스템)
17. [버전 히스토리](#16-버전-히스토리)
18. [Rust 백엔드 IPC](#17-rust-백엔드-ipc)
19. [MD ↔ ProseMirror 파이프라인](#18-md--prosemirror-파이프라인)
20. [미구현 기능](#19-미구현-기능)

---

## 전체 현황

| 지표 | 수치 |
|------|------|
| 로드맵 기능 (Part 8) | 72개 |
| 구현 완료 | 68개 (94.4%) |
| 미착수 | 4개 |
| Tiptap Node Extensions | 30개 |
| Tiptap Mark Extensions | 9개 |
| Tiptap Plugin Extensions | 17개 |
| Pipeline Transformers | 36개 |
| Rust IPC Commands | 70개 |
| Frontend Components | 87개 |
| React Hooks | 18개 |
| Zustand Stores | 17개 |
| Test Suites | 32개 (2,007 tests) |

---

## 1. 에디터 코어

> Tiptap (ProseMirror) 기반 WYSIWYG 마크다운 편집

| 기능 | 설명 | 스펙 | Phase |
|------|------|------|-------|
| WYSIWYG 편집 | "구문 사라짐" — 커서 위치에 따라 마크다운 구문 표시/숨김 | §5.1 | P1/M2 |
| MD ↔ PM 파이프라인 | remark-parse → mdast → ProseMirror 양방향 변환 | §3.3 | P1/M2 |
| InputRules | 마크다운 구문 타이핑 시 자동 변환 (`# ` → H1, `**` → Bold 등) | §5.1 | P1/M2 |
| History (Undo/Redo) | ProseMirror 기반 Cmd+Z / Cmd+Shift+Z | §5.2 | P1/M2 |
| Source Mode | Cmd+/ 로 WYSIWYG ↔ 마크다운 소스 전환 | §5.1 | P1/M3 |
| Find & Replace | Cmd+F / Cmd+H — 정규식, 대소문자, 전체 단어 옵션 | §5.6 | P2/M8 |
| Heading & List Folding | Obsidian 스타일 접기/펼치기, 거터 화살표 | — | P3/M10 |

**소스 파일:**
- `src/extensions/plugins/syntax-reveal.ts` (구문 숨김/표시)
- `src/extensions/plugins/find-replace.ts`
- `src/extensions/plugins/fold.ts`
- `src/components/editor/SourceCodeEditor.tsx`
- `src/pipeline/md-to-pm.ts`, `src/pipeline/pm-to-md.ts`

---

## 2. 블록 요소

> 30개 Node Extension — 모두 MD ↔ PM 라운드트립 변환기 포함

### 기본 블록 (P1/M2)

| Extension | 마크다운 구문 | NodeView | InputRules | 단축키 |
|-----------|-------------|----------|-----------|--------|
| Heading | `# ` ~ `###### ` | — | 6 rules | Mod-1~6, Mod-=, Mod-- |
| Paragraph | (기본) | — | — | — |
| Blockquote | `> ` | — | 1 rule | Mod-Shift-> |
| BulletList | `- `, `* ` | — | 2 rules | Mod-Shift-8 |
| OrderedList | `1. ` | — | 1 rule | Mod-Shift-7 |
| TaskList | `- [ ] `, `- [x] ` | — | 2 rules | — |
| HorizontalRule | `---`, `***` | — | 2 rules | — |
| Image | `![alt](url)` | ✅ | 1 rule | — |

### 리치 콘텐츠 (P1/M3)

| Extension | 마크다운 구문 | NodeView | InputRules | 단축키 |
|-----------|-------------|----------|-----------|--------|
| CodeBlock | ` ``` ` | ✅ (CodeMirror 6) | 1 rule | Mod-Shift-c |
| MathBlock | `$$...$$` | ✅ (KaTeX) | 1 rule | Mod-Shift-m |
| MathInline | `$...$` | ✅ (KaTeX) | 1 rule | — |
| Table | `\| \| \|` | — | 1 rule | Mod-t |
| Frontmatter | `---\nyaml\n---` | ✅ | — | — |

### 확장 블록 (P2~P3)

| Extension | 마크다운 구문 | NodeView | InputRules | 단축키 | Phase |
|-----------|-------------|----------|-----------|--------|-------|
| Callout | `> [!type] title` | ✅ | 1 rule | — | P2/M7 |
| Toggle | `<details><summary>` | ✅ | 1 rule | — | P2/M7 |
| MermaidBlock | ` ```mermaid ` | ✅ | 1 rule | Mod-Shift-d | P2/M9 |
| DefinitionList | `Term\n: Definition` | — | 1 rule | `: ` | P2/M9 |
| FootnoteRef | `[^id]` | ✅ | 1 rule | `[^` | P2/M9 |
| FootnoteDefinition | `[^id]: content` | ✅ | — | — | P2/M9 |
| TableOfContents | `[TOC]` | ✅ | — | — | P2/M9 |
| HtmlBlock | `<div>...</div>` | ✅ | — | — | P3/M10 |
| QueryBlock | ` ```query ` | ✅ | — | — | P3/M10 |

### 연결 블록 (P2/M7)

| Extension | 마크다운 구문 | NodeView | InputRules | 단축키 |
|-----------|-------------|----------|-----------|--------|
| Wikilink | `[[page]]` | ✅ | 1 rule | `[[` |
| BlockReference | `((target#^id))` | ✅ | — | — |
| BlockEmbed | `{{embed ((target))}}` | ✅ | — | — |
| TagNode | `#tag` | ✅ | 1 rule | `#tag ` |
| Mention | `@[[page]]` | ✅ | 1 rule | `@` |

**테스트:** 32개 테스트 파일 — callout, definition-list, footnote, math, wikilink, mention, tag-node, query-block, html-block, table-advanced 등

---

## 3. 인라인 마크

> 9개 Mark Extension

| Mark | 마크다운 구문 | InputRules | 단축키 |
|------|-------------|-----------|--------|
| Bold | `**text**` | ✅ | Mod-b |
| Italic | `*text*` | ✅ | Mod-i |
| Code | `` `text` `` | ✅ | Mod-e |
| Strike | `~~text~~` | ✅ | Mod-Shift-x |
| Link | `[text](url)` | ✅ | Mod-k |
| Underline | `<u>text</u>` | — | Mod-u |
| Highlight | `==text==` | ✅ | Mod-Shift-h |
| Subscript | `~text~` | — | — |
| Superscript | `^text^` | — | — |

---

## 4. 에디터 플러그인

> 17개 Plugin Extension — 에디터 동작 확장

| Plugin | 설명 | 스펙 | Phase |
|--------|------|------|-------|
| History | Undo/Redo | §5.2 | P1/M2 |
| SyntaxReveal | WYSIWYG 구문 숨김/표시 | §5.1 | P1/M2 |
| DropHandler | 파일 드래그앤드롭 처리 | §3.3 | P1/M2 |
| SlashCommands | `/` 블록 삽입 메뉴 (30+ 커맨드) | §4.6 | P1/M4 |
| MathInlineEdit | 인라인 수식 편집 모달 | §5.3 | P1/M3 |
| WikilinkSuggest | `[[` 자동완성 (vault 검색) | §31 | P2/M7 |
| BlockIdDecoration | 블록 ID 힌트 표시 (⚓, ^blockId) | §30a | P2/M7 |
| FindReplace | Mod-f / Mod-h 검색/치환 | §5.6 | P2/M8 |
| GhostText | AI 스트리밍 완성 오버레이 | §43 | P2/M8 |
| AIDiff | AI 인라인 diff 미리보기 (char-level) | §6.2 | P2/M8 |
| PromptHighlight | Skills 파일 구문 강조 (XML, Mustache) | §41 | P2/M8 |
| PromptLint | Skills 파일 정적 분석 (6 rules) | §46 | P2/M8 |
| MentionSuggest | `@` 자동완성 (date/page) | §57 | P2/M9 |
| TagSuggest | `#` 자동완성 (vault 태그 인덱스) | §56m | P2/M9 |
| TagClick | Cmd/Ctrl+Click #tag → 글로벌 검색 | §56m | P2/M9 |
| ListAtomFix | WebKit 리스트 마커 정렬 수정 | — | P2/M9 |
| Fold | Heading/List 접기 (Obsidian 스타일) | — | P3/M10 |

---

## 5. UI/UX

### 레이아웃

| 컴포넌트 | 설명 | 스펙 |
|---------|------|------|
| AppLayout | 3-Column: Activity Bar + Sidebar + Editor + Right Panel | §4.2 |
| ActivityBar | 좌측 패널 토글 바 (파일, 검색, Git, 북마크, 캘린더 등) | §4.2 |
| Sidebar | 좌측 멀티 패널 탭 | §4.3 |
| TabBar | 에디터 탭 — 드래그 정렬, 핀, MRU | §38, §39 |
| StatusBar | 하단 — 커서 위치, 단어 수, Git 브랜치, 인코딩 | §4.8 |
| Splitter | 패널 간 리사이즈 | — |

### 인터랙션

| 컴포넌트 | 설명 | 스펙 | 단축키 |
|---------|------|------|--------|
| CommandPalette | 커맨드 팔레트 — 파일/Git/액션 검색 | §4.4 | Cmd+P |
| QuickSwitcher | 파일 전환 — fuzzy 검색, MRU | §35 | Cmd+K |
| SlashMenu | 블록 삽입 메뉴 (50+ 타입) | §4.6 | `/` |
| FloatingToolbar | 텍스트 선택 시 서식 + AI 바 | §4.7 | (선택 시) |
| BlockHandle | 좌측 호버 ⋮ — 드래그, 블록 변환 | §4.8 | (호버 시) |
| ContextMenu | 우클릭 컨텍스트 메뉴 (7종) | §4.8 | (우클릭) |
| HomeScreen | 온보딩 — 폴더 열기, 최근 파일 | §4.9 | — |
| HelpPanel | 도움말 패널 | — | — |

**소스:** `src/components/layout/`, `src/components/command/`, `src/components/toolbar/`

---

## 6. 파일 관리

| 기능 | 설명 | 스펙 |
|------|------|------|
| FileTree | 파일 트리 — CRUD, 드래그앤드롭, 태그 필터 | §4.3 |
| Multi-Tab | 탭 바 — 핀, 드래그 정렬, MRU | §38, §39 |
| Auto-Save | 디바운스 2초 자동 저장 | §5.7 |
| File Watcher | 외부 변경 감지 자동 리로드 | §3.6 |
| Atomic Write | tmp→rename 원자적 쓰기 | §3.6 |
| Properties Panel | Frontmatter 시각 편집기 | §40 |

**Rust IPC (11개):** `read_file`, `write_file`, `list_dir`, `rename_file`, `delete_file`, `create_dir`, `delete_dir`, `copy_file`, `watch_dir`, `extract_zip`, `write_binary_file`

**소스:** `src/components/sidebar/FileTree.tsx`, `src/hooks/use-file-operations.ts`, `src-tauri/src/fs/mod.rs`

---

## 7. 연결 시스템 & 네비게이션

| 기능 | 설명 | 스펙 |
|------|------|------|
| Wikilinks | `[[page]]` 양방향 링크 + 자동완성 | §28, §31 |
| Backlinks | 역링크 패널 — 그룹화, 컨텍스트 | §29 |
| Block References | `((target#^id))` — 자동 블록 ID | §30 |
| Block Embeds | `{{embed ((target))}}` — 임베드 표시 | §30 |
| Link Auto-Update | 파일 이름 변경 시 모든 링크 자동 갱신 | §33 |
| Unlinked Mentions | 링크 없는 텍스트 멘션 탐지 | §34 |
| Hover Preview | Ctrl+hover → 팝업 미리보기 (20줄) | §32 |
| Graph View | Cytoscape + fcose 레이아웃 — 노드/링크 시각화 | §30 |
| Outline | 헤딩 계층 네비게이션, 레벨 필터 | §4.3 |
| Quick Switcher | Cmd+O fuzzy 검색 (파일/별칭/헤딩/블록) | §35 |
| Bookmarks | 파일/헤딩/블록 북마크, 사이드바 패널 | §36 |
| Back/Forward | 점프 히스토리 스택 — Cmd+[ / Cmd+] | §37 |
| Namespace | 상대 wikilink (`./`, `../`), `ns:` 필터 | §61 |

**Rust IPC (8개):** `get_backlinks`, `get_link_index`, `refresh_index`, `update_file_index`, `get_unlinked_mentions`, `rename_file_with_links`, `rename_block_id`, `rename_namespace`

---

## 8. 검색

| 기능 | 설명 | 스펙 |
|------|------|------|
| Global Search | tantivy 전문 검색 — Cmd+Shift+F | §5.11 |
| Regex 검색 | 정규식 패턴 지원 | §5.11 |
| 파일 필터 | include/exclude glob 패턴 | §5.11 |
| Find & Replace | 에디터 내 검색/치환 (Mod-f, Mod-h) | §5.6 |
| Query Block | 시각적 쿼리 빌더, 동적 결과 블록 | §5.13 |

**Rust IPC:** `search_files` (tantivy 기반, 한국어 2-gram 토크나이저)

---

## 9. AI 통합

| 기능 | 설명 | 스펙 |
|------|------|------|
| LLM Provider | Claude, OpenAI, Gemini, Ollama 추상화 레이어 | §6.3 |
| AI Chat | 사이드바 멀티턴 대화 — @reference, Apply to Editor | §44 |
| Inline AI Edit | Cmd+J — 자연어 → 스트리밍 → diff 미리보기 → accept/reject | §6.2 |
| Ghost Text | 500ms 디바운스 AI 자동완성 — Tab 수락, Mod-→ 단어 수락 | §43 |
| AI Slash Commands | 7개 프리셋 (/ai-write, /brainstorm, /translate, /summarize, /expand, /fix-grammar, /explain) | §6.2 |
| AI Diff Engine | Character-level diff — ProseMirror Decoration (green insert, red delete) | §6.2 |
| Custom AI Commands | 사용자 정의 프롬프트 + 단축키 | §48 |
| Privacy Mode | 파일별 + 전역 AI 비활성화 토글 | §49 |
| Per-Task Model | chat/ghost-text/inline-edit/agent 별도 모델 선택 | §6.3 |

**Rust IPC (3개):** `llm_complete` (SSE 스트리밍), `llm_cancel`, `llm_list_models`
**Events:** `llm:token`, `llm:done`, `llm:error`

---

## 10. Skills 시스템

| 기능 | 설명 | 스펙 |
|------|------|------|
| Skills Mode | Skills 전용 편집 모드 — 자동 감지, Properties Panel, LLM Preview | §72 |
| Skill Templates | 5개 템플릿 + NewSkillDialog | §42 |
| Skill Auto-Gen | AI 구조 자동 생성 | §45 |
| Prompt Highlight | XML 태그, Mustache 변수 구문 강조 | §41 |
| Prompt Lint | 6개 정적 분석 규칙 + 제안 | §46 |
| Skill Inline Test | 실행 + 검증 | §47 |
| Skill Gallery | vault 내 Skills 브라우징 | §72 |
| Skill Dependency | 의존성 분석 시각화 | §72 |
| Skill Optimize | 최적화 제안 | §46 |

**소스:** `src/components/ai/Skill*.tsx`, `src/components/sidebar/SkillGalleryPanel.tsx`, `src/hooks/use-skills-mode.ts`, `src/stores/skill-store.ts`

---

## 11. 저널

| 기능 | 설명 | 스펙 |
|------|------|------|
| Daily Notes | 일별 저널 생성, 계층적 경로 (YYYY/MM/YYYY-MM-DD.md) | §56 |
| Journal Workspace | enterJournalScope — Graph View 스코핑 | §56b |
| Memories View | 3탭 (Journal/Photos/Notes), one-line 편집 | §56c |
| Photo Journal | 드래그앤드롭/붙여넣기, /photo 커맨드, 갤러리, 라이트박스 | §56d |
| Mood Tracker | MoodBar (1-5), mood dots, YearInPixels, MoodTrend30 | §56e |
| Periodic Notes | 주간/월간/연간 노트 생성 | §56f |
| Streaks & Stats | 연속 기록, 월/년 통계, 히트맵 | §56g |
| Journal Themes | 5개 테마 (default/nature/ocean/sunset/minimal) | §56h |
| Daily Prompts | 63개 한국어 글쓰기 프롬프트, 날짜 기반 결정론적 | §56i |
| AI Reflection | LLM 기반 성찰, 후속 질문, 감정 추론 | §56j |
| Journal Search | 카테고리 그룹화, 태그 검색, 하이라이트 | §56k |
| Quick Capture | 4종 캡처 (/idea /link /quote /note), 태그 자동완성 | §56l |
| Tag System | vault 전체 인덱스, 이름 변경, 색상, 클라우드 뷰, AI 추천 | §56m |

**소스:** `src/components/journal/` (20개 파일), `src/hooks/use-journal.ts`, `src/stores/settings/journal-settings.ts`

---

## 12. Git 연동

### Basic (P2/M9, §57b)

| 기능 | IPC 커맨드 |
|------|-----------|
| 상태 확인 | `git_status` |
| 스테이징/언스테이징 | `git_stage`, `git_unstage` |
| 커밋 | `git_commit` |
| 파일 diff | `git_diff_file` |
| 브랜치 목록/전환/생성 | `git_branches`, `git_switch_branch`, `git_create_branch` |
| 변경 취소 | `git_discard` |

### Advanced (P3/M10, §67)

| 기능 | IPC 커맨드 |
|------|-----------|
| 커밋 로그 | `git_log` |
| Stash 관리 | `git_stash_save`, `git_stash_list`, `git_stash_pop`, `git_stash_drop` |
| 리모트 | `git_remotes`, `git_fetch`, `git_pull`, `git_push` |
| Ahead/Behind | `git_ahead_behind` |
| 브랜치 삭제 | `git_delete_branch` |

**소스:** `src/components/sidebar/GitPanel.tsx`, `src/stores/git-store.ts`, `src-tauri/src/git/mod.rs`

---

## 13. 내보내기

| 형식 | 설명 | 스펙 | IPC 커맨드 |
|------|------|------|-----------|
| PDF | Tauri webview → PDF (KaTeX/코드/테이블 지원) | §5.10 | `export_pdf` |
| HTML | Standalone HTML, 인라인 CSS, 이미지 임베드 | §5.10 | `export_document` |
| Notion | convertForNotion() — 12개 변환기 | §53 | — (프론트엔드) |
| Pandoc | Word/LaTeX/Epub/RST via Pandoc CLI | §55 | `export_pandoc` |
| Custom | 사용자 정의 셸 명령 (`${file}`, `${basename}` 변수) | §55 | `run_custom_export` |

**소스:** `src/components/export/ExportDialog.tsx`, `src-tauri/src/export/`

---

## 14. 설정 & 커스터마이징

### 9-Tab 설정 모달

| 탭 | 주요 설정 |
|----|----------|
| General | 언어, 자동 저장, 시작 동작, 저널 디렉토리 |
| Editor | 줄 높이, 들여쓰기, 탭 크기, 자동 줄바꿈, 공백 표시 |
| Appearance | 테마 (6 내장 + 커스텀), 폰트, 에디터 너비 |
| Markdown | 마크다운 확장 토글 (테이블, 취소선, 각주 등) |
| AI | Provider/모델 선택, API 키, Privacy 모드 |
| ActivityBar | 패널 표시/숨김, 순서 |
| Language | 로케일 선택 (i18n) |
| Keybindings | 54개 키바인딩 레지스트리, 키 캡처, 충돌 감지 |
| Plugins | 플러그인 관리 |

### 추가 커스터마이징

| 기능 | 설명 | 스펙 |
|------|------|------|
| Theme System | 6 내장 테마, CSS var 오버라이드, 커스텀 import/export | §54 |
| Workspace Presets | 3 프리셋 (Writing/Skills/Research) + 커스텀 | §52 |
| Keybinding Override | Extension별 단축키 오버라이드 (shortcut-resolver) | — |
| Settings Search | 설정 항목 검색 (settings-registry) | — |

**소스:** `src/components/settings/`, `src/stores/settings-store.ts`, `src/stores/settings/`

---

## 15. 플러그인 시스템

| 기능 | 설명 | 스펙 |
|------|------|------|
| Plugin Marketplace | 플러그인 브라우징, 검색 | §69 |
| Plugin Install/Uninstall | URL 기반 다운로드, SHA256 체크섬 | §69 |
| Plugin Lifecycle | initializePlugins, notifyFileOpen/Save/EditorReady, shutdown | §69 |
| Plugin Loader | Dynamic import(), 5초 activate 타임아웃 | §69 |
| Capability Gating | 플러그인 권한 선언 시스템 | §69 |

**Rust IPC (6개):** `plugin_install`, `plugin_uninstall`, `plugin_list_installed`, `plugin_read_manifest`, `plugin_fetch_registry`, `plugin_get_dir`

---

## 16. 버전 히스토리

| 기능 | 설명 | 스펙 |
|------|------|------|
| Snapshot 생성 | 타임스탬프 기반 vault 스냅샷 | §71 |
| 버전 목록 | 메타데이터 (id, timestamp, label, type) | §71 |
| Diff 보기 | 스냅샷 vs 현재 파일 diff (Myers 알고리즘) | §71 |
| 복원 | 전체 또는 선택적 파일 복원 | §71 |
| 보존 정책 | Retention policy 지원 | §71 |
| 파일별 히스토리 | 특정 파일의 모든 스냅샷 조회 | §71 |

**Rust IPC (6개):** `create_snapshot`, `list_snapshots`, `get_snapshot_diff`, `restore_snapshot`, `delete_snapshot`, `get_file_history`

---

## 17. Rust 백엔드 IPC

> 총 70개 커맨드, 12개 모듈

| 모듈 | 커맨드 수 | 주요 기능 |
|------|----------|----------|
| fs | 11 | 파일 읽기/쓰기/삭제/복사/감시/ZIP |
| search | 1 | tantivy 전문 검색 |
| index | 8 | 링크 인덱싱, 백링크, 네임스페이스 |
| git | 19 | status~push, log, stash, remote |
| llm | 3 | SSE 스트리밍, 모델 목록, 취소 |
| export | 5 | PDF, HTML, Pandoc, 커스텀 |
| config | 3 | JSON 설정 get/set/remove |
| keyring | 3 | OS 키체인 (macOS/Linux/Windows) |
| tag | 3 | vault 태그 인덱스, 이름 변경 |
| snapshot | 6 | 스냅샷 CRUD, diff, 히스토리 |
| plugin | 6 | 설치/삭제/레지스트리 |
| app | 2 | 파일 연결, 메뉴 i18n |

**Managed State:** `LinkIndexState`, `CancelRegistry`, `PendingOpenFiles`, `MenuState`
**Events:** `file:changed/created/deleted`, `llm:token/done/error`, `menu-event`, `index:updated`, `git:progress`

---

## 18. MD ↔ ProseMirror 파이프라인

> 36개 Transformer — 라운드트립 보존이 최우선 품질 기준

### Node Transformers (27개)
blockquote, block-reference, block-embed, bullet-list, callout, code-block, definition-list, footnote-definition, footnote-ref, frontmatter, heading, horizontal-rule, html-block, image, list-item, math-block, math-inline, mention, mermaid-block, ordered-list, paragraph, query-block, table, table-of-contents, tag, task-list, toggle, wikilink

### Mark Transformers (9개)
bold, code, highlight, italic, link, strike, subscript, superscript, underline (inline)

**소스:** `src/pipeline/transformers/`, `src/pipeline/md-to-pm.ts`, `src/pipeline/pm-to-md.ts`, `src/pipeline/serializer.ts`

---

## 19. 미구현 기능

> Phase 3 잔여 — 4개 미착수

| 기능 | 스펙 | 카테고리 | 난이도 | 설명 |
|------|------|---------|--------|------|
| **Canvas** | §60 | 지식 관리 | 높음 | 무한 캔버스 UI |
| **Agent Mode** | §62 | AI | 높음 | 멀티 파일 자율 LLM 편집 |
| **Knowledge Q&A** | §63 | AI | 높음 | 벡터 검색 + LLM 인용 |
| **Real-time Collaboration** | §68 | 협업 | 매우 높음 | Yjs CRDT + 서버 인프라 |

### 추후 검토 (로드맵 범위 외)

| 기능 | 설명 |
|------|------|
| Mobile Support | Tauri Mobile (iOS/Android) |
| MCP Server Integration | §65 |
| Custom AI Plugin API | §66 |
| i18n 전체 적용 | 74 컴포넌트 + Rust 메뉴 |
