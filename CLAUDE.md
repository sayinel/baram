# Baram — Lightweight WYSIWYG Markdown Editor

## 프로젝트 개요

Baram(바람)은 Tauri 2.0 + Tiptap/ProseMirror + React 기반의 경량 WYSIWYG 마크다운 에디터다.
Typora의 WYSIWYG 품질 + Obsidian의 확장성 + AI 네이티브 통합을 목표한다.

- **핵심 가치**: 가볍다 (~10MB) / 아름답다 (구문이 사라지는 WYSIWYG) / 연결된다 (양방향 링크 + AI)
- **타겟 사용자**: AI 개발자(Skills 편집), 마크다운 파워유저(기술 문서), 연구자(수식+지식 링크)
- **라이선스**: 에디터 코어 MIT / 앱 AGPL-3.0

## 기술 스택

| 영역 | 기술 | 버전 |
|------|------|------|
| Desktop Framework | Tauri | 2.0 |
| Backend | Rust | latest stable |
| Frontend | React + TypeScript | 19 |
| Bundler | Vite | 6 |
| Styling | Tailwind CSS | 4 |
| Editor Engine | Tiptap (ProseMirror) | v2 |
| Math Rendering | KaTeX | latest |
| Code Blocks | CodeMirror | 6 |
| Diagrams | Mermaid.js | latest |
| State Management | Zustand | latest |
| Full-text Search | tantivy (Rust) | latest |
| Database | SQLite (rusqlite) | latest |
| File Watcher | notify (Rust) | latest |

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
│   │   │   └── config_cmd.rs
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
│   ├── stores/              # Zustand 스토어
│   │   ├── editor-store.ts  # 에디터 상태 (활성 탭, dirty 상태)
│   │   ├── file-store.ts    # 파일 시스템 (열린 파일, 파일 트리)
│   │   ├── ui-store.ts      # UI 레이아웃 (사이드바, 패널, 모달)
│   │   ├── settings-store.ts # 사용자 설정 (테마, 폰트, Extension)
│   │   └── ai-store.ts      # AI 상태 (스트리밍, Ghost Text, provider)
│   ├── hooks/               # React Hooks
│   ├── ipc/                 # Tauri IPC 래퍼
│   │   ├── types.ts         # IPC 타입 정의
│   │   └── invoke.ts        # invoke 유틸리티
│   ├── utils/               # 유틸리티
│   └── types/               # 공유 TypeScript 타입
├── docs/
│   ├── design/              # 설계 문서 (Part 1~9)
│   ├── impl-notes/          # 구현 노트 (/implement 시 생성)
│   └── progress.json        # 진행 상황 추적
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
- Jest + ts-jest (TypeScript 단위/통합)
- cargo test (Rust 단위)
- Playwright (E2E, 크로스 플랫폼)
- **라운드트립 보존이 최우선 품질 기준**: MD → ProseMirror → MD 변환 시 원본과 정확히 일치해야 함

### Git
- Conventional Commits: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`
- 커밋 메시지에 설계 문서 섹션 참조 포함 (예: `feat(§5.3): implement KaTeX math block`)
- 브랜치: `feature/m2-basic-editing`, `fix/roundtrip-heading-whitespace`

## 설계 문서 참조 규칙

구현 시 반드시 해당 설계 문서 섹션을 참조할 것. `§` 번호를 코드 주석과 커밋에 유지한다.

| 영역 | 설계 문서 | 핵심 참조 |
|------|-----------|-----------|
| 아키텍처 | `docs/design/part3-architecture.md` | §3.1 스택, §3.2 IPC, §3.3 엔진, §3.4 Extension, §3.5 상태, §3.6 파일 |
| UI/UX | `docs/design/part4-uiux.md` | §4.1 원칙, §4.2 레이아웃, §4.3~§4.8 각 요소 |
| 기능 상세 | `docs/design/part5-core-features.md` | §5.1~§5.15 각 기능 상세 스펙 |
| AI 통합 | `docs/design/part6-ai-integration.md` | §6.1 전략, §6.2 5-Level, §6.3 Provider |
| 데이터 모델 | `docs/design/part7-data-models.md` | §7.1 MD 규격, §7.2 PM 스키마, §7.3~§7.5 DB |
| 로드맵 | `docs/design/part8-roadmap.md` | §8.1 Phase, §8.2 마일스톤, §8.4 품질, §8.6 의존성 |

## 성능 기준 (Part 8 §8.4)

| 지표 | 목표 |
|------|------|
| 앱 시작 → 에디터 준비 | < 1.5초 (콜드), < 0.5초 (웜) |
| 1,000줄 파일 열기 | < 200ms |
| 10,000줄 파일 열기 | < 1초 |
| 타이핑 레이턴시 | < 16ms (60fps) |
| KaTeX 렌더링 | < 50ms |
| 파일 저장 | < 100ms |
| 앱 바이너리 크기 | < 15MB |
| 유휴 메모리 | < 100MB |

## 현재 Phase 및 마일스톤

Phase 1: MVP (27개 기능, M1~M6)
- M1: 프로젝트 셋업 (Week 1~2)
- M2: 기본 편집 (Week 3~8)
- M3: 리치 콘텐츠 (Week 9~14)
- M4: UI 프레임워크 (Week 15~18)
- M5: AI Level 2 (Week 19~22)
- M6: MVP 릴리스 (Week 23~26)
