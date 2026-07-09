# Part 3. 아키텍처 설계

---

## 3.1 기술 스택 확정

### 전체 기술 스택 다이어그램

```
┌─────────────────────────────────────────────────────────────────┐
│                        Baram Desktop App                        │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                    Tauri 2.0 Shell                         │  │
│  │  ┌─────────────────────┐  ┌────────────────────────────┐  │  │
│  │  │   Rust Backend      │  │   WebView Frontend         │  │  │
│  │  │                     │  │                            │  │  │
│  │  │  · File System I/O  │  │  React 19 + TypeScript     │  │  │
│  │  │  · File Watcher     │◄─┤  + Vite 6                  │  │  │
│  │  │  · Git Operations   │  │                            │  │  │
│  │  │  · Link Index DB    │  │  ┌────────────────────┐    │  │  │
│  │  │  · Search Engine    │  │  │   Tiptap v2        │    │  │  │
│  │  │  · LLM API Proxy    │  │  │   (ProseMirror)    │    │  │  │
│  │  │  · Auto-save        │  │  │                    │    │  │  │
│  │  │  · Snapshot Manager │  │  │  · Node Extensions │    │  │  │
│  │  │  · Export Engine    │  │  │  · Mark Extensions │    │  │  │
│  │  │                     │  │  │  · Plugin Exts     │    │  │  │
│  │  │  IPC (Tauri Commands│  │  └────────────────────┘    │  │  │
│  │  │   + Events)         │  │                            │  │  │
│  │  └─────────────────────┘  │  ┌────────────────────┐    │  │  │
│  │                           │  │ Supporting Libs     │    │  │  │
│  │                           │  │ · KaTeX (수식)      │    │  │  │
│  │                           │  │ · Mermaid.js (도표) │    │  │  │
│  │                           │  │ · CodeMirror 6 (코드)│   │  │  │
│  │                           │  │ · unified/remark    │    │  │  │
│  │                           │  │ · Zustand (상태)    │    │  │  │
│  │                           │  │ · Tailwind CSS      │    │  │  │
│  │                           │  └────────────────────┘    │  │  │
│  │                           └────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ OS Integration: macOS (WebKit) / Windows (WebView2) /   │    │
│  │                 Linux (WebKitGTK)                        │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

### 각 기술 선정 근거

#### 데스크톱 프레임워크: Tauri 2.0

Electron과 Tauri 2.0을 비교 평가한 결과, Tauri 2.0을 선택했다.

| 항목 | Electron | Tauri 2.0 | 판정 |
|------|----------|-----------|------|
| 앱 크기 | 80~150MB | 3~10MB | **Tauri** — 배포 크기가 10배 이상 작음 |
| 메모리 (유휴) | 200~400MB | 30~50MB | **Tauri** — 메모리 사용량 4~8배 절감 |
| 시작 시간 | 1~2초 | 0.4초 이하 | **Tauri** — 체감 즉시 실행 |
| 렌더링 일관성 | ★★★★★ (Chromium 번들) | ★★★☆☆ (OS WebView) | Electron 우위 |
| 생태계 | ★★★★★ (Node.js 전체) | ★★★☆☆ (성장 중) | Electron 우위 |
| 보안 | 수동 설정 필요 | 기본 보안 강화 | **Tauri** |
| 백엔드 | JavaScript (Node.js) | Rust | **Tauri** — 파일 I/O, 검색 고성능 |
| 모바일 지원 | ✗ | ✅ (iOS/Android) | **Tauri** — 미래 확장성 |

선택 근거: 마크다운 에디터는 성능 체감이 중요한 개인 도구이다. 0.4초 안에 열리고, 10MB 이하로 설치되며, 50MB 이하 메모리로 동작하는 것은 "가볍다"는 Baram의 핵심 가치와 직결된다. Tauri 2.0의 모바일(iOS/Android) 지원은 Phase 3 이후 확장 경로를 열어둔다.

WebView 호환성 리스크 대응 전략: CSS `-webkit` 프리픽스 관리, macOS WebKit / Windows WebView2 / Linux WebKitGTK 크로스 테스트 파이프라인 구축, Polyfill 전략 수립. Tauri의 WebView 격차는 점점 줄어들고 있으며, Baram이 사용하는 CSS/JS 범위에서는 실질적 호환성 이슈가 적다.

#### 에디터 엔진: Tiptap v2 (ProseMirror 기반)

7개 에디터 프레임워크를 비교 평가했다.

| 프레임워크 | 기반 | WYSIWYG | MD 지원 | 확장성 | 성숙도 | 협업 | 추천도 |
|-----------|------|---------|--------|-------|-------|------|-------|
| **Tiptap** | ProseMirror | ✅ | 플러그인 | ★★★★★ | ★★★★★ | Yjs | **최우선 추천** |
| Milkdown | ProseMirror+Remark | ✅ | 네이티브 | ★★★★☆ | ★★★☆☆ | Yjs | 강력 추천 |
| Lexical | Meta 자체 | ✅ | 플러그인 | ★★★★☆ | ★★★☆☆ | Yjs | 차선 |
| BlockNote | ProseMirror+Tiptap | ✅ (블록) | 플러그인 | ★★★☆☆ | ★★★☆☆ | Yjs | 블록형 선호 시 |
| Plate | Slate | ✅ | 플러그인 | ★★★★☆ | ★★★☆☆ | Yjs | Notion 스타일 시 |
| ProseMirror | 자체 | 커스텀 | 커스텀 | ★★★★★ | ★★★★★ | Yjs | 완전 커스텀 시 |
| CodeMirror 6 | 자체 | ✗ (코드) | 구문강조 | ★★★★☆ | ★★★★★ | Yjs | 소스 편집 전용 |

선택 근거: Tiptap은 ProseMirror 위에 구축되어 검증된 안정성(Asana, NYT 등이 ProseMirror 사용)을 제공하면서도, 헤드리스 아키텍처로 완전한 UI 커스터마이징이 가능하다. Extension 시스템이 모듈러하고 성숙하여 Baram의 Extension-First 아키텍처와 자연스럽게 합치된다. React/Vue/Svelte 유연 지원, JSON + HTML + Markdown 출력, 풍부한 커뮤니티와 문서가 개발 속도를 가속한다.

Milkdown은 "Typora에서 영감을 받은" WYSIWYG 에디터로, ProseMirror + Remark 조합의 아키텍처를 참조 설계로 활용한다. 특히 마크다운 파싱 파이프라인(unified/remark ↔ ProseMirror) 설계에서 Milkdown의 접근을 학습한다.

#### 프론트엔드: React 19 + TypeScript + Vite 6

React를 선택한 이유는 Tiptap의 공식 React 바인딩(@tiptap/react)이 가장 안정적이고 문서화가 풍부하기 때문이다. TypeScript는 ProseMirror의 복잡한 스키마와 Extension 타입 안전성에 필수이다. Vite 6는 HMR(Hot Module Replacement)으로 에디터 개발 시 즉시 피드백을 제공한다.

#### 수식: KaTeX

MathJax가 아닌 KaTeX를 선택한 결정적 이유는 **Notion 호환성**이다. Notion은 KaTeX 라이브러리를 사용하므로, Baram도 KaTeX를 채택하면 Notion에서 가져온 수식이 100% 동일하게 렌더링된다. 추가적으로 KaTeX는 MathJax 대비 렌더링 속도가 빠르고, 서버사이드 렌더링을 지원하며, 번들 크기가 작다. mhchem 확장으로 화학식(`\ce{H2O}`)도 지원한다.

#### 마크다운 처리: unified (remark + rehype) 생태계

마크다운 파싱과 직렬화에 unified 생태계를 사용한다. remark-parse로 마크다운 → AST 변환, remark-stringify로 AST → 마크다운 변환, remark-gfm으로 GitHub Flavored Markdown(테이블, 태스크 리스트, 취소선 등), remark-math로 수식 구문 처리, remark-frontmatter로 YAML frontmatter를 처리한다. unified의 플러그인 파이프라인은 마크다운 확장 문법(wikilink, 블록 참조 등)을 추가하기에 이상적이다.

#### 코드 편집: CodeMirror 6

코드 블록 내부의 구문 강조와 편집에 CodeMirror 6를 사용한다. Shiki(구문 강조 전용)도 고려했으나, Baram의 코드 블록은 편집 가능해야 하므로 CodeMirror 6가 적합하다. Language Pack으로 200개 이상의 언어를 지원하며, Tiptap NodeView 안에 CodeMirror 인스턴스를 임베드하는 방식으로 통합한다.

#### 다이어그램: Mermaid.js

Mermaid.js는 11종 다이어그램(플로우차트, 시퀀스, 간트, 클래스, 상태, ER, 파이, 마인드맵 등)을 텍스트 기반으로 생성한다. Typora와 동일한 ```` ```mermaid ```` 코드 블록으로 트리거하며, NodeView로 렌더링한다.

#### 상태 관리: Zustand

Redux 대비 보일러플레이트가 극소하고, React 컴포넌트와의 결합이 자연스러우며, 미들웨어(persist, devtools, immer)가 충분하다. 에디터 상태(ProseMirror 자체 관리)와 앱 상태(Zustand)를 명확히 분리하는 것이 설계 핵심이다.

#### 스타일링: Tailwind CSS + CSS Variables

Tailwind CSS로 컴포넌트 스타일링, CSS Variables로 테마 시스템을 구현한다. 테마 전환은 CSS Variables 값만 교체하면 되므로, Typora처럼 사용자 정의 CSS 테마도 쉽게 지원된다.

### 기술 스택 요약 표

| 영역 | 기술 | 버전 | 역할 |
|------|------|------|------|
| 데스크톱 셸 | Tauri | 2.x | 앱 패키징, OS 통합, IPC |
| 백엔드 | Rust | stable | 파일 I/O, 검색, Git, LLM 프록시 |
| 프론트엔드 | React | 19 | UI 렌더링 |
| 타입 시스템 | TypeScript | 5.x | 타입 안전성 |
| 빌드 도구 | Vite | 6.x | 번들링, HMR |
| 에디터 엔진 | Tiptap | 2.x | WYSIWYG 에디터 코어 |
| 에디터 기반 | ProseMirror | — | 문서 모델, 트랜잭션, 스키마 |
| 마크다운 처리 | unified (remark+rehype) | — | MD 파싱, 직렬화, 변환 |
| 수식 | KaTeX | 0.16+ | 수식 렌더링 (Notion 호환) |
| 코드 편집 | CodeMirror | 6.x | 코드 블록 편집, 구문 강조 |
| 다이어그램 | Mermaid.js | 11.x | 다이어그램 렌더링 |
| 상태 관리 | Zustand | 5.x | 앱 상태 관리 |
| 스타일링 | Tailwind CSS | 4.x | 유틸리티 CSS |
| 테마 | CSS Variables | — | 다크/라이트/커스텀 테마 |
| 협업 (Phase 3) | Yjs | — | CRDT 기반 실시간 협업 |
| Git (Phase 3) | libgit2 (Rust) | — | Git 통합 |

---

## 3.2 시스템 아키텍처

### 전체 레이어 구조

Baram의 시스템 아키텍처는 4개 레이어로 구성된다.

```
┌─────────────────────────────────────────────────────────────┐
│                     Layer 4: OS Integration                  │
│  Tauri Shell · Window Management · System Menu · Tray       │
│  Native Dialogs · File Associations · Auto-Update           │
├─────────────────────────────────────────────────────────────┤
│                     Layer 3: Rust Backend                    │
│                                                             │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐      │
│  │ File     │ │ Search   │ │ Link     │ │ LLM      │      │
│  │ System   │ │ Engine   │ │ Index    │ │ Proxy    │      │
│  │          │ │          │ │          │ │          │      │
│  │ · read   │ │ · ripgrep│ │ · graph  │ │ · Claude │      │
│  │ · write  │ │   -based │ │ · cache  │ │ · OpenAI │      │
│  │ · watch  │ │ · fuzzy  │ │ · update │ │ · Ollama │      │
│  │ · rename │ │ · index  │ │ · query  │ │ · stream │      │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘      │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐      │
│  │ Git      │ │ Snapshot │ │ Export   │ │ Config   │      │
│  │ Ops      │ │ Manager  │ │ Engine   │ │ Store    │      │
│  │          │ │          │ │          │ │          │      │
│  │ · status │ │ · auto   │ │ · PDF    │ │ · prefs  │      │
│  │ · commit │ │ · manual │ │ · HTML   │ │ · theme  │      │
│  │ · diff   │ │ · restore│ │ · Word   │ │ · keys   │      │
│  │ · branch │ │ · diff   │ │ · LaTeX  │ │ · persist│      │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘      │
├────────────────────── IPC (Tauri Commands + Events) ────────┤
│                     Layer 2: Frontend App                    │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ UI Components                                       │    │
│  │ · Sidebar (FileTree / Outline / Search / Backlinks) │    │
│  │ · TabBar · StatusBar · CommandPalette              │    │
│  │ · FloatingToolbar · SlashMenu · AI Panel           │    │
│  │ · Settings · ThemeSwitcher                         │    │
│  └─────────────────────────────────────────────────────┘    │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────────┐    │
│  │ Zustand      │ │ Extension    │ │ Command          │    │
│  │ Stores       │ │ Registry     │ │ Registry         │    │
│  │              │ │              │ │                  │    │
│  │ · editor     │ │ · register   │ │ · register       │    │
│  │ · files      │ │ · enable     │ │ · execute        │    │
│  │ · ui         │ │ · disable    │ │ · fuzzy search   │    │
│  │ · settings   │ │ · config     │ │ · keybinding     │    │
│  │ · ai         │ │ · lifecycle  │ │ · MRU            │    │
│  └──────────────┘ └──────────────┘ └──────────────────┘    │
├─────────────────────────────────────────────────────────────┤
│                     Layer 1: Editor Engine                   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ Tiptap v2 (ProseMirror)                             │    │
│  │                                                     │    │
│  │ Document Schema ─→ Transaction ─→ View Update       │    │
│  │                                                     │    │
│  │ Extensions:                                         │    │
│  │ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌──────────┐  │    │
│  │ │ Nodes   │ │ Marks   │ │ Plugins │ │ Custom   │  │    │
│  │ │         │ │         │ │         │ │          │  │    │
│  │ │ Heading │ │ Bold    │ │ History │ │ Wikilink │  │    │
│  │ │ CodeBlk │ │ Italic  │ │ Collab  │ │ BlockRef │  │    │
│  │ │ MathBlk │ │ Code    │ │ Search  │ │ SlashCmd │  │    │
│  │ │ Table   │ │ Link    │ │ Paste   │ │ GhostTxt │  │    │
│  │ │ Image   │ │ KaTeX   │ │ Drop    │ │ InlineAI │  │    │
│  │ │ Mermaid │ │ Hlight  │ │ Keys    │ │ SkillsMd │  │    │
│  │ │ Callout │ │ Strike  │ │ InputR  │ │ QueryBlk │  │    │
│  │ └─────────┘ └─────────┘ └─────────┘ └──────────┘  │    │
│  │                                                     │    │
│  │ MD Pipeline: unified(remark) ←→ ProseMirror Doc     │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

### Tauri 프론트엔드 ↔ Rust 백엔드 통신 구조

Tauri의 IPC는 두 가지 채널로 구성된다.

**Tauri Commands (프론트엔드 → 백엔드 요청-응답)**

프론트엔드가 Rust 함수를 호출하고 결과를 받는 동기적/비동기적 패턴이다.

```
Frontend                           Rust Backend
────────                           ────────────
invoke('read_file', { path })  ──→  #[tauri::command]
                                    fn read_file(path: &str) -> Result<String>
                               ←──  Ok(content) | Err(error)
```

주요 Commands 목록:

| Command | 입력 | 출력 | 용도 |
|---------|------|------|------|
| `read_file` | path | content: String | 파일 읽기 |
| `write_file` | path, content | success: bool | 파일 쓰기 |
| `list_dir` | path | entries: Vec<FileEntry> | 디렉토리 목록 |
| `rename_file` | old, new | success: bool | 파일 이름 변경 |
| `search_files` | query, options | results: Vec<SearchResult> | 전역 검색 |
| `get_link_index` | — | graph: LinkGraph | 링크 인덱스 조회 |
| `git_status` | — | changes: Vec<GitChange> | Git 상태 |
| `git_commit` | message | oid: String | Git 커밋 |
| `llm_complete` | prompt, model, config | stream: EventId | LLM 호출 |
| `export_document` | path, format, options | output_path: String | 내보내기 |
| `create_snapshot` | path | snapshot_id: String | 스냅샷 생성 |
| `get_config` | key | value: JsonValue | 설정 조회 |
| `set_config` | key, value | success: bool | 설정 저장 |

**Tauri Events (백엔드 → 프론트엔드 단방향 푸시)**

백엔드에서 프론트엔드로 비동기 이벤트를 보내는 패턴이다. 파일 변경 감지, LLM 스트리밍 응답, Git 진행 상태 등에 사용한다.

```
Rust Backend                       Frontend
────────────                       ────────
emit('file-changed', payload)  ──→  listen('file-changed', handler)
emit('llm-chunk', payload)     ──→  listen('llm-chunk', handler)
emit('git-progress', payload)  ──→  listen('git-progress', handler)
emit('index-updated', payload) ──→  listen('index-updated', handler)
```

주요 Events 목록:

| Event | Payload | 용도 |
|-------|---------|------|
| `file-changed` | { path, kind: create\|modify\|delete } | 파일 시스템 변경 감지 |
| `file-renamed` | { old_path, new_path } | 파일 이름 변경 (링크 갱신 트리거) |
| `llm-chunk` | { request_id, chunk, done } | LLM 스트리밍 응답 |
| `llm-error` | { request_id, error } | LLM 호출 오류 |
| `git-progress` | { operation, progress, message } | Git 작업 진행률 |
| `index-updated` | { kind: links\|search, stats } | 인덱스 갱신 완료 |
| `snapshot-created` | { path, snapshot_id, timestamp } | 스냅샷 생성 완료 |

### 프론트엔드 내부 레이어 구조

프론트엔드는 4개의 내부 레이어로 구성된다.

```
┌─────────────────────────────────────────────────────┐
│ UI Layer          React 컴포넌트, 레이아웃, 이벤트 처리  │
│                   (Sidebar, TabBar, Editor, Panel...)  │
├─────────────────────────────────────────────────────┤
│ State Layer       Zustand 스토어, 파생 상태, 셀렉터     │
│                   (editorStore, fileStore, uiStore...)│
├─────────────────────────────────────────────────────┤
│ Service Layer     비즈니스 로직, Tauri IPC 래퍼          │
│                   (FileService, SearchService, AI...)  │
├─────────────────────────────────────────────────────┤
│ Editor Layer      Tiptap/ProseMirror, Extensions       │
│                   (자체 상태 관리, 트랜잭션 기반)          │
└─────────────────────────────────────────────────────┘
```

**데이터 흐름 원칙**: UI Layer → State Layer → Service Layer → Rust Backend → Service Layer → State Layer → UI Layer. 에디터 내부 상태(ProseMirror document, selection, history)는 Zustand를 거치지 않고 ProseMirror의 자체 트랜잭션 시스템으로 관리한다. 두 상태 시스템이 만나는 접점(예: 파일 저장 시 에디터 content를 Zustand를 통해 Service로 전달)만 명시적 브릿지로 연결한다.

---

## 3.3 에디터 엔진 아키텍처

### ProseMirror 핵심 개념

Tiptap은 ProseMirror의 래퍼이므로, 에디터 엔진의 핵심은 ProseMirror의 4대 구성요소이다.

**Schema** — 문서의 구조를 정의한다. 어떤 노드(블록)와 마크(인라인 서식)가 존재하며, 이들이 어떤 계층 관계를 가질 수 있는지 선언한다.

```
document
├── heading (attrs: { level: 1~6 })
├── paragraph
│   ├── text (marks: bold, italic, code, link, katex_inline...)
│   ├── wikilink (inline node)
│   └── block_reference (inline node)
├── code_block (attrs: { language })
├── math_block (attrs: { formula })
├── table → table_row → table_cell → paragraph...
├── image (attrs: { src, alt, title })
├── mermaid_block (attrs: { code })
├── callout (attrs: { type, title })
├── blockquote → paragraph...
├── bullet_list → list_item → paragraph...
├── ordered_list → list_item → paragraph...
├── task_list → task_item (attrs: { checked }) → paragraph...
├── horizontal_rule
└── frontmatter (attrs: { yaml })
```

**State** — 현재 문서의 상태(내용 + 선택 영역 + 스토어드 마크)를 불변 객체로 보유한다.

**Transaction** — 상태 변경은 항상 트랜잭션을 통해 이루어진다. 트랜잭션은 문서 변경(step)의 시퀀스이며, 적용 전에 Plugin들이 가로채어 추가 변경을 덧붙일 수 있다.

**View** — State를 DOM으로 렌더링하고, 사용자 입력을 Transaction으로 변환한다.

```
User Input → View → Transaction → [Plugins] → New State → View Update
                                      ↑
                              InputRule, Paste, Drop,
                              Collaboration, History...
```

### Tiptap Extension 3계층

Tiptap은 ProseMirror의 Schema, Plugin, NodeView를 Extension이라는 통합 인터페이스로 감싼다. Baram의 모든 에디터 기능은 이 3가지 Extension 유형 중 하나로 구현된다.

**Node Extension** — 블록 레벨 요소를 정의한다.

| Extension | 마크다운 구문 | NodeView | 비고 |
|-----------|-------------|----------|------|
| `Heading` | `# ~ ######` | ✗ (기본 렌더링) | attrs: level |
| `CodeBlock` | ```` ``` ```` | ✅ CodeMirror 6 임베드 | 구문 강조, 편집 가능 |
| `MathBlock` | `$$ ... $$` | ✅ KaTeX 렌더링 | 포커스 시 소스 편집 |
| `MermaidBlock` | ```` ```mermaid ```` | ✅ Mermaid.js 렌더링 | 포커스 시 소스 편집 |
| `Table` | GFM 테이블 | ✅ 테이블 조작 UI | 행/열 추가·삭제, 정렬 |
| `Image` | `![](url)` | ✅ 이미지 + 호버 툴바 | 리사이즈, 캡션 |
| `Callout` | `> [!type]` | ✅ 아이콘 + 접기 | Obsidian 호환 |
| `Frontmatter` | `---yaml---` | ✅ Properties GUI | YAML 비주얼 에디터 |
| `BlockReference` | `((block-id))` | ✅ 참조 블록 렌더링 | 인라인 표시 |
| `QueryBlock` | `/query` | ✅ 쿼리 결과 렌더링 | Phase 3 |

**Mark Extension** — 인라인 서식을 정의한다.

| Extension | 마크다운 구문 | 비고 |
|-----------|-------------|------|
| `Bold` | `**text**` | 표준 |
| `Italic` | `*text*` | 표준 |
| `Code` | `` `text` `` | 표준 |
| `Strike` | `~~text~~` | GFM |
| `Link` | `[text](url)` | 표준 |
| `Highlight` | `==text==` | 설정에서 활성화 |
| `Superscript` | `X^2^` | 설정에서 활성화 |
| `Subscript` | `H~2~O` | 설정에서 활성화 |
| `KaTeXInline` | `$formula$` | KaTeX 인라인 렌더링 |
| `Wikilink` | `[[document]]` | Suggestion 팝업 |
| `Mention` | `@date/@page` | Suggestion 팝업 |

**Plugin Extension** — 에디터 동작을 확장한다.

| Extension | 기능 | 비고 |
|-----------|------|------|
| `History` | Undo/Redo | ProseMirror 내장 |
| `InputRules` | 마크다운 구문 → 노드/마크 자동 변환 | WYSIWYG 핵심 |
| `PasteRules` | 붙여넣기 시 마크다운 변환 | HTML/MD 감지 |
| `DropHandler` | 드래그앤드롭 파일 처리 | 이미지 자동 삽입 |
| `KeymapPlugin` | 단축키 매핑 | Tiptap 기본 + 커스텀 |
| `SlashCommands` | `/` 입력 시 블록 삽입 메뉴 | Suggestion API |
| `FloatingMenu` | 빈 줄에 `+` 버튼 | 블록 삽입 대안 |
| `BubbleMenu` | 텍스트 선택 시 서식 툴바 | Tiptap 내장 |
| `GhostText` | AI 텍스트 제안 (회색) | Decoration |
| `InlineAI` | Cmd+K 인라인 편집 | Decoration + overlay |
| `Collaboration` | Yjs CRDT 동기화 | Phase 3 |
| `SearchHighlight` | 검색 결과 하이라이트 | Decoration |
| `FocusMode` | 비활성 줄 흐림 처리 | CSS + Decoration |
| `TypewriterMode` | 활성 줄 중앙 고정 | scrollIntoView |

### 마크다운 파싱 파이프라인

Baram의 핵심 데이터 파이프라인은 마크다운 파일 ↔ ProseMirror 문서 간의 양방향 변환이다.

```
[파일 열기: MD → Editor]

  .md file
     │
     ▼
  remark-parse          ← 마크다운 → mdast (Markdown AST)
     │
  remark-gfm            ← GFM 확장 (테이블, 태스크, 취소선)
  remark-math            ← 수식 구문 ($, $$)
  remark-frontmatter     ← YAML frontmatter
  remark-wikilink*       ← [[wikilink]] 커스텀 플러그인
  remark-block-ref*      ← ((block-ref)) 커스텀 플러그인
     │
     ▼
  mdast (Markdown AST)
     │
     ▼
  mdast-to-prosemirror*  ← 커스텀 변환기: mdast → ProseMirror Node
     │
     ▼
  ProseMirror Document   → Tiptap Editor에 로드
```

```
[파일 저장: Editor → MD]

  ProseMirror Document
     │
     ▼
  prosemirror-to-mdast*  ← 커스텀 변환기: ProseMirror Node → mdast
     │
     ▼
  mdast (Markdown AST)
     │
     ▼
  remark-stringify       ← mdast → 마크다운 텍스트
  remark-gfm             ← GFM 직렬화
  remark-math            ← 수식 직렬화
  remark-frontmatter     ← YAML 직렬화
     │
     ▼
  .md file               → Tauri write_file로 저장
```

`*` 표시는 Baram 커스텀 구현이 필요한 부분이다.

변환기 설계 원칙: **Roundtrip Fidelity** — 마크다운 → ProseMirror → 마크다운 변환을 거쳐도 원본 마크다운과 최대한 동일해야 한다. 불필요한 공백, 줄바꿈, 인용 스타일 변경이 없어야 한다. 이를 위해 mdast 노드에 원본 위치 정보(position)를 보존하고, 직렬화 시 원본 스타일을 존중하는 전략을 사용한다.

### WYSIWYG "구문 사라짐" 구현 원리

Typora의 핵심 경험인 "구문이 사라지는" WYSIWYG를 ProseMirror/Tiptap에서 구현하는 4가지 메커니즘이다.

**1) InputRule — 마크다운 구문 자동 변환**

사용자가 마크다운 구문을 타이핑하면 즉시 해당 노드/마크로 변환된다.

```
사용자 입력: "# Hello"
                ↓ InputRule 트리거 (정규식: /^# /)
에디터 상태: [Heading level=1] "Hello"
                ↓ 화면 표시
렌더링:     Hello  (H1 스타일, "# " 안 보임)
```

```
사용자 입력: "**bold**"
                ↓ InputRule 트리거 (정규식: /\*\*(.+)\*\*/)
에디터 상태: [Bold] "bold"
                ↓ 화면 표시
렌더링:     bold  (볼드체, "**" 안 보임)
```

**2) NodeView — 복합 블록의 이중 모드**

코드 블록, 수식 블록, Mermaid 다이어그램 등 소스 편집과 렌더링 결과가 다른 요소에 적용한다.

```
[포커스 밖]                    [포커스 안]
┌─────────────────────┐      ┌─────────────────────┐
│                     │      │ ```python            │
│  def hello():       │      │ def hello():         │
│      print("Hi")    │  ←→  │     print("Hi")      │
│                     │      │ ```                  │
│ (구문 강조된 렌더링)  │      │ (CodeMirror 에디터)   │
└─────────────────────┘      └─────────────────────┘
```

NodeView는 React 컴포넌트로 구현하며, `selected` prop에 따라 렌더링 모드와 편집 모드를 전환한다.

**3) Decoration — 포커스 기반 구문 표시/숨김**

인라인 마크(볼드, 이탤릭 등)의 구문 기호를 선택적으로 표시/숨긴다. 커서가 마크 범위 안에 있으면 구문 기호(`**`, `*` 등)를 표시하고, 밖에 있으면 숨긴다.

```
커서 위치에 따른 렌더링:

  "이것은 **볼드** 텍스트이다"  ← 커서가 볼드 밖
       ↓
  "이것은 볼드 텍스트이다"     ← **가 사라지고 볼드체로 표시

  "이것은 **볼드**| 텍스트이다" ← 커서(|)가 구문 기호 바로 뒤, 
  또는 "이것은 **볼드|** 텍스트이다" ← 커서(|)가 볼드 안
       ↓
  "이것은 **볼드|** 텍스트이다" ← **가 보이고 편집 가능 (구문기호도 편집 가능)
```

이 동작은 ProseMirror의 Decoration 시스템으로 구현한다. 매 selection 변경마다 커서 주변의 마크 구문 가시성을 재계산하는 Plugin을 등록한다.

**4) CSS Transition — 부드러운 전환 애니메이션**

구문이 나타나고 사라지는 과정에 opacity와 width transition을 적용하여 깜빡임 없이 자연스러운 전환을 제공한다.

---

## 3.4 Extension-First 아키텍처

### "모든 것은 Extension이다" 설계 원칙

Obsidian에서 배운 핵심 교훈: 코어 기능도 Extension으로 구현하면 토글 가능해지고, 대체 가능해지며, 테스트가 쉬워진다. Baram은 Phase 1부터 내부적으로 Extension 패턴을 사용하고, Phase 3에서 외부 플러그인 API로 개방한다.

### 2단계 확장 체계

Baram의 확장 시스템은 두 레이어로 구성된다.

```
┌─────────────────────────────────────────────────────────────┐
│                  Layer 2: App Extension                      │
│                  (에디터 외부, 앱 전체)                        │
│                                                             │
│  interface AppExtension {                                   │
│    id: string;                                              │
│    name: string;                                            │
│    activate(context: ExtensionContext): void;                │
│    deactivate(): void;                                      │
│  }                                                          │
│                                                             │
│  ExtensionContext provides:                                  │
│  ├── commands: CommandRegistry    ← 커맨드 등록/실행         │
│  ├── sidebar: SidebarRegistry     ← 사이드바 패널 등록       │
│  ├── statusbar: StatusBarRegistry ← 상태바 위젯 등록         │
│  ├── settings: SettingsRegistry   ← 설정 탭 등록            │
│  ├── editor: EditorAccess         ← 에디터 읽기/쓰기 접근    │
│  ├── files: FileSystemAccess      ← 파일 시스템 접근         │
│  ├── events: EventBus             ← 이벤트 구독/발행         │
│  └── ai: AIServiceAccess          ← LLM API 접근           │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                  Layer 1: Tiptap Extension                   │
│                  (에디터 내부)                                │
│                                                             │
│  · Node Extensions (블록 요소)                               │
│  · Mark Extensions (인라인 서식)                              │
│  · Plugin Extensions (에디터 동작)                            │
│                                                             │
│  Tiptap의 Extension API로 등록                               │
│  (addNodeView, addInputRules, addProseMirrorPlugins 등)     │
└─────────────────────────────────────────────────────────────┘
```

Layer 1(Tiptap Extension)은 에디터 내부의 렌더링, 입력 규칙, 키맵을 확장한다. Layer 2(App Extension)는 사이드바, 상태바, 커맨드, 설정 등 앱 전체를 확장한다. 하나의 기능이 양 레이어에 걸칠 수 있다. 예를 들어, "양방향 링크" 기능은 Layer 1(Wikilink Node Extension)과 Layer 2(백링크 사이드바 패널, 링크 인덱스 커맨드)로 구성된다.

### Core Extension 목록

Phase 1에서 제공하는 Core Extension 목록이다. 모든 Core Extension은 설정에서 토글 가능하다.

| Extension | Layer | 기본 상태 | 역할 |
|-----------|-------|---------|------|
| `core-editing` | L1 | ✅ ON | 기본 마크다운 노드/마크 (Heading, Paragraph, Bold, Italic...) |
| `core-code-block` | L1 | ✅ ON | CodeMirror 6 기반 코드 블록 |
| `core-math` | L1 | ✅ ON | KaTeX 인라인/블록 수식 |
| `core-table` | L1 | ✅ ON | GFM 테이블 편집 |
| `core-image` | L1 | ✅ ON | 이미지 삽입, 호버 툴바, 경로 관리 |
| `core-task-list` | L1 | ✅ ON | 체크박스 리스트 |
| `core-frontmatter` | L1+L2 | ✅ ON | YAML frontmatter (소스 뷰 + Properties GUI) |
| `core-input-rules` | L1 | ✅ ON | 마크다운 구문 → 노드/마크 자동 변환 (WYSIWYG 핵심) |
| `core-paste-handler` | L1 | ✅ ON | HTML/MD 붙여넣기 변환 |
| `core-drop-handler` | L1 | ✅ ON | 파일 드래그앤드롭 처리 |
| `core-history` | L1 | ✅ ON | Undo/Redo |
| `core-keymap` | L1 | ✅ ON | 단축키 시스템 |
| `core-file-tree` | L2 | ✅ ON | 사이드바 파일 트리 |
| `core-outline` | L2 | ✅ ON | 사이드바 아웃라인 (헤딩 목차) |
| `core-search` | L2 | ✅ ON | 문서 내 검색 + 글로벌 검색 |
| `core-command-palette` | L2 | ✅ ON | Cmd+K 커맨드 팔레트 |
| `core-quick-switcher` | L2 | ✅ ON | Cmd+O 파일 퍼지 검색 |
| `core-slash-commands` | L1+L2 | ✅ ON | `/` 슬래시 커맨드 |
| `core-floating-toolbar` | L1 | ✅ ON | 텍스트 선택 시 서식 툴바 |
| `core-block-handle` | L1 | ✅ ON | 블록 핸들 (⋮) + 드래그 |
| `core-theme` | L2 | ✅ ON | 테마 시스템, 다크/라이트 전환 |
| `core-status-bar` | L2 | ✅ ON | 하단 상태바 |
| `core-auto-save` | L2 | ✅ ON | 자동 저장 |

Phase 2에서 추가되는 Extension:

| Extension | Layer | 기본 상태 | 역할 |
|-----------|-------|---------|------|
| `ext-wikilink` | L1+L2 | ☐ OFF | 양방향 링크 + 백링크 패널 |
| `ext-block-ref` | L1 | ☐ OFF | 블록 참조 `(())` + 블록 임베드 |
| `ext-mermaid` | L1 | ☐ OFF | Mermaid 다이어그램 |
| `ext-callout` | L1 | ☐ OFF | 콜아웃 블록 |
| `ext-highlight` | L1 | ☐ OFF | `==하이라이트==` |
| `ext-superscript` | L1 | ☐ OFF | `X^2^` 위첨자 |
| `ext-subscript` | L1 | ☐ OFF | `H~2~O` 아래첨자 |
| `ext-focus-mode` | L1 | ☐ OFF | 포커스 모드 (F8) |
| `ext-typewriter` | L1 | ☐ OFF | 타자기 모드 (F9) |
| `ext-ghost-text` | L1 | ☐ OFF | AI Ghost Text 제안 |
| `ext-inline-ai` | L1 | ☐ OFF | Cmd+K 인라인 AI 편집 |
| `ext-ai-chat` | L2 | ☐ OFF | AI 채팅 패널 |
| `ext-skills-mode` | L1+L2 | ☐ OFF | Skills 편집 모드 |
| `ext-journal` | L2 | ☐ OFF | 데일리 노트 |
| `ext-bookmark` | L2 | ☐ OFF | 북마크 시스템 |
| `ext-notion-compat` | L2 | ☐ OFF | Notion 가져오기/내보내기 |
| `ext-export` | L2 | ☐ OFF | PDF/HTML/Word 내보내기 |
| `ext-workspace` | L2 | ☐ OFF | Workspace 프리셋 (Writing/Research/Manage) |

Phase 2 Extension은 기본 비활성이며, 사용자가 설정에서 활성화하거나, 커맨드 팔레트에서 기능을 처음 사용할 때 활성화를 제안한다. 이것이 Typora의 5번째 원칙 "점진적 복잡도"의 Extension-First 구현이다.

### Extension API 초안

Phase 1에서는 내부 Extension만 사용하지만, API 설계는 Phase 3의 외부 플러그인 개방을 염두에 둔다.

```typescript
// Extension 등록 인터페이스
interface AppExtension {
  id: string;                          // 'ext-wikilink'
  name: string;                        // 'Bidirectional Links'
  description: string;                 // 'Enable [[wikilinks]] and backlinks'
  version: string;                     // '1.0.0'
  dependencies?: string[];             // ['core-editing']

  // 생명주기
  activate(ctx: ExtensionContext): void | Promise<void>;
  deactivate(): void | Promise<void>;

  // 선택적 훅
  onFileOpen?(path: string): void;
  onFileSave?(path: string, content: string): void;
  onEditorReady?(editor: TiptapEditor): void;
}

// ExtensionContext — Extension이 접근할 수 있는 앱 API
interface ExtensionContext {
  // 커맨드 등록
  commands: {
    register(cmd: Command): Disposable;
  };

  // 사이드바 패널 등록
  sidebar: {
    registerPanel(panel: SidebarPanel): Disposable;
  };

  // 상태바 위젯 등록
  statusbar: {
    registerWidget(widget: StatusBarWidget): Disposable;
  };

  // 설정 등록
  settings: {
    registerSection(section: SettingsSection): Disposable;
    get<T>(key: string): T;
    set<T>(key: string, value: T): void;
  };

  // 에디터 접근
  editor: {
    getContent(): string;               // 현재 문서 마크다운
    insertAt(pos: number, content: string): void;
    replaceRange(from: number, to: number, content: string): void;
    getSelection(): { from: number; to: number; text: string };
    getTiptapEditor(): TiptapEditor;     // 전체 접근 (고급)
  };

  // 파일 시스템
  files: {
    read(path: string): Promise<string>;
    write(path: string, content: string): Promise<void>;
    list(dir: string): Promise<FileEntry[]>;
    watch(pattern: string, callback: FileChangeHandler): Disposable;
  };

  // 이벤트 버스
  events: {
    on(event: string, handler: EventHandler): Disposable;
    emit(event: string, payload: any): void;
  };

  // AI 서비스 (Phase 2)
  ai: {
    complete(prompt: string, options?: AIOptions): AsyncIterable<string>;
    isAvailable(): boolean;
  };
}

// Disposable — 자원 정리 패턴
interface Disposable {
  dispose(): void;
}
```

모든 `register*` 메서드가 `Disposable`을 반환하며, `deactivate()` 시 자동으로 정리된다. 이것이 Obsidian의 "컴포넌트 기반 생명주기" 패턴의 핵심이다.

### Progressive Disclosure 활성화 단계

Extension 활성화 수준에 따라 3단계의 사용 경험을 제공한다.

```
[기본 모드]  Core Extension만 활성
             Typora와 유사한 미니멀 마크다운 에디터
             · WYSIWYG 마크다운 편집
             · 파일 트리, 아웃라인, 검색
             · KaTeX 수식, 코드 블록, 테이블
             · 커맨드 팔레트, 슬래시 커맨드
                    │
                    ▼
[중급 모드]  지식 관리 Extension 활성화
             Obsidian 유사 양방향 링크 + AI 지원 에디터
             · + 양방향 링크, 백링크, 블록 참조
             · + Mermaid 다이어그램, 콜아웃
             · + AI Ghost Text, 인라인 AI 편집
             · + 데일리 노트, 북마크
                    │
                    ▼
[고급 모드]  전문가 Extension 활성화
             Skills 편집 + Agent 수준 에디터
             · + Skills 편집 모드 (YAML GUI, 구조 검증, 인라인 테스트)
             · + AI 채팅 패널, Agent Mode
             · + 쿼리 블록, 그래프 뷰
             · + Git 통합, 실시간 협업
             · + 커뮤니티 플러그인
```

---

## 3.5 상태 관리 설계

### Zustand 스토어 구조

앱 상태는 5개의 독립된 Zustand 스토어로 관리한다. 에디터 내부 상태(ProseMirror document, selection)는 Zustand에 포함하지 않는다.

```
┌─────────────────────────────────────────────────────────┐
│                    Zustand Stores                         │
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │ fileStore     │  │ uiStore      │  │ settingsStore│  │
│  │              │  │              │  │              │  │
│  │ openFiles[]  │  │ sidebarOpen  │  │ theme        │  │
│  │ activeFile   │  │ sidebarMode  │  │ fontSize     │  │
│  │ dirtyFiles   │  │ panelsLayout │  │ extensions   │  │
│  │ recentFiles  │  │ commandPalette│ │ keybindings  │  │
│  │ rootDir      │  │ zenMode      │  │ markdown     │  │
│  │ fileTree     │  │ focusMode    │  │ editor       │  │
│  └──────────────┘  └──────────────┘  │ ai           │  │
│                                      │ export       │  │
│  ┌──────────────┐  ┌──────────────┐  └──────────────┘  │
│  │ aiStore      │  │ linkStore    │                     │
│  │              │  │              │                     │
│  │ provider     │  │ linkGraph    │                     │
│  │ model        │  │ backlinks{}  │                     │
│  │ isStreaming   │  │ unlinked{}   │                     │
│  │ chatHistory  │  │ lastIndexed  │                     │
│  │ ghostText    │  │              │                     │
│  └──────────────┘  └──────────────┘                     │
└─────────────────────────────────────────────────────────┘
```

#### fileStore — 파일 관련 상태

```typescript
interface FileStore {
  // 현재 상태
  rootDir: string | null;           // Vault 루트 디렉토리
  fileTree: FileTreeNode[];          // 파일 트리 구조
  openFiles: OpenFile[];             // 열린 파일 탭 목록
  activeFileId: string | null;       // 현재 활성 탭
  dirtyFiles: Set<string>;           // 저장 안 된 파일 (path Set)
  recentFiles: string[];             // 최근 열었던 파일 (최대 20개)

  // 액션
  openFile(path: string): Promise<void>;
  closeFile(id: string): void;
  saveFile(id: string): Promise<void>;
  saveAllFiles(): Promise<void>;
  setActiveFile(id: string): void;
  markDirty(id: string): void;
  setRootDir(path: string): Promise<void>;
  refreshFileTree(): Promise<void>;
}

interface OpenFile {
  id: string;                        // 고유 ID (같은 파일 여러 탭 방지용)
  path: string;                      // 파일 경로
  name: string;                      // 파일명
  content: string;                   // 마지막 저장된 내용
  lastSaved: number;                 // 마지막 저장 시각
}
```

#### uiStore — UI 레이아웃 상태

```typescript
interface UIStore {
  // 레이아웃
  sidebarOpen: boolean;
  sidebarMode: 'file-tree' | 'outline' | 'search' | 'backlinks';
  sidebarWidth: number;              // 리사이즈 가능
  rightPanelOpen: boolean;           // AI 패널 등
  rightPanelMode: 'ai-chat' | 'backlinks' | 'properties' | null;
  statusBarVisible: boolean;

  // 모달/오버레이
  commandPaletteOpen: boolean;
  quickSwitcherOpen: boolean;
  settingsOpen: boolean;

  // 편집 모드
  sourceMode: boolean;               // WYSIWYG ↔ Source Code 토글
  zenMode: boolean;                  // 전체화면, UI 최소화
  focusMode: boolean;                // 비활성 줄 흐림
  typewriterMode: boolean;           // 활성 줄 중앙

  // 액션
  toggleSidebar(): void;
  setSidebarMode(mode: string): void;
  toggleSourceMode(): void;
  toggleZenMode(): void;
  toggleFocusMode(): void;
  openCommandPalette(): void;
  openQuickSwitcher(): void;
}
```

#### settingsStore — 영구 설정

```typescript
interface SettingsStore {
  // 외관
  theme: 'light' | 'dark' | 'system';
  customThemePath: string | null;
  fontSize: number;                   // 12~24
  fontFamily: string;                 // 'system' | 'mono' | custom
  editorMaxWidth: number;             // 에디터 최대 폭 (px)

  // 에디터
  indentSize: 2 | 4 | 8;
  indentType: 'spaces' | 'tabs';
  lineEnding: 'lf' | 'crlf' | 'auto';
  autoPairBrackets: boolean;
  autoPairMarkdown: boolean;
  spellCheck: boolean;
  highlightCurrentLine: boolean;

  // 마크다운 확장
  enableInlineMath: boolean;          // $수식$
  enableHighlight: boolean;           // ==하이라이트==
  enableSuperscript: boolean;         // X^2^
  enableSubscript: boolean;           // H~2~O
  enableDiagrams: boolean;            // Mermaid
  strictHeadingSpace: boolean;        // # 뒤 스페이스 필수

  // Extension 활성화 상태
  enabledExtensions: string[];        // ['core-*', 'ext-wikilink', ...]

  // AI 설정
  ai: {
    provider: 'claude' | 'openai' | 'gemini' | 'ollama' | null;
    model: string;
    apiKey: string;                   // 암호화 저장 (Tauri keychain)
    ghostTextEnabled: boolean;
    privacyMode: boolean;             // 데이터 비전송 모드
    ollamaUrl: string;                // 로컬 LLM URL
  };

  // 이미지
  imageInsertPolicy: 'do-nothing' | 'copy-to-current' | 'copy-to-assets' | 'custom-folder' | 'upload';
  imageUploader: 'picgo' | 'custom' | null;

  // 내보내기
  export: {
    pdfMargins: { top: number; right: number; bottom: number; left: number };
    pandocPath: string;
  };

  // 자동 저장
  autoSaveDelay: number;              // ms, 0이면 비활성
  snapshotInterval: number;           // 분, 0이면 비활성
}
```

설정은 Zustand의 `persist` 미들웨어로 JSON 파일(Tauri `app_data_dir()`)에 자동 저장된다. AI API Key는 Tauri의 OS keychain 통합으로 별도 암호화 저장한다.

#### aiStore — AI 상태

```typescript
interface AIStore {
  // 상태
  isAvailable: boolean;               // API 키 설정 여부
  isStreaming: boolean;                // 현재 스트리밍 중
  currentRequestId: string | null;

  // Ghost Text
  ghostText: {
    text: string;
    position: number;
    visible: boolean;
  } | null;

  // Chat Panel
  chatHistory: ChatMessage[];
  chatInput: string;

  // 인라인 AI
  inlineAI: {
    active: boolean;
    prompt: string;
    diff: InlineDiff | null;          // { original, modified, hunks }
  };

  // 액션
  requestGhostText(context: string): Promise<void>;
  acceptGhostText(): void;
  dismissGhostText(): void;
  sendChatMessage(message: string, context?: string[]): Promise<void>;
  requestInlineEdit(selection: string, instruction: string): Promise<void>;
  acceptInlineEdit(): void;
  rejectInlineEdit(): void;
}
```

#### linkStore — 링크 인덱스 상태

```typescript
interface LinkStore {
  // 인덱스 (Rust 백엔드에서 구축, 프론트엔드에서 캐시)
  linkGraph: Map<string, Set<string>>;  // path → 이 파일이 링크하는 파일들
  backlinks: Map<string, BacklinkEntry[]>;  // path → 이 파일을 링크하는 곳들
  unlinkedMentions: Map<string, UnlinkedMention[]>;
  lastIndexed: number;                 // 마지막 인덱싱 시각

  // 액션
  refreshIndex(): Promise<void>;       // Rust 백엔드에 재인덱싱 요청
  getBacklinks(path: string): BacklinkEntry[];
  getOutgoingLinks(path: string): string[];
}

interface BacklinkEntry {
  sourcePath: string;                  // 링크를 포함한 파일
  lineNumber: number;                  // 링크가 있는 줄
  context: string;                     // 주변 텍스트 (미리보기용)
}
```

### 에디터 상태 vs 앱 상태 분리 원칙

에디터 내부 상태(ProseMirror)와 앱 상태(Zustand)를 명확히 분리하는 것이 아키텍처의 핵심 원칙이다.

| 상태 | 관리 주체 | 예시 |
|------|---------|------|
| 문서 내용 (Doc) | ProseMirror State | 노드 트리, 텍스트 내용 |
| 선택 영역 (Selection) | ProseMirror State | 커서 위치, 선택 범위 |
| 편집 이력 (History) | ProseMirror Plugin | Undo/Redo 스택 |
| 트랜잭션 메타데이터 | ProseMirror Transaction | 변경 유형, 타임스탬프 |
| 열린 파일 목록 | Zustand (fileStore) | 탭, 활성 파일 |
| UI 레이아웃 | Zustand (uiStore) | 사이드바, 패널, 모달 |
| 사용자 설정 | Zustand (settingsStore) | 테마, 폰트, Extension |
| AI 상태 | Zustand (aiStore) | 스트리밍, Ghost Text |
| 링크 인덱스 | Zustand (linkStore) | 그래프, 백링크 |

두 시스템이 만나는 브릿지 포인트:

```
ProseMirror ──→ Zustand:
  · doc 변경 시 → fileStore.markDirty(activeFileId)
  · selection 변경 시 → aiStore 업데이트 (Ghost Text 트리거)
  · doc 구조 변경 시 → outline 사이드바 갱신

Zustand ──→ ProseMirror:
  · fileStore.openFile() → editor.commands.setContent(content)
  · aiStore.acceptGhostText() → editor.commands.insertContentAt(...)
  · settingsStore 변경 → editor 설정 반영 (enableExtension 등)
```

---

## 3.6 파일 시스템 설계

### Vault 구조

Baram은 Obsidian과 동일한 "Vault" 개념을 사용한다. 하나의 로컬 폴더가 하나의 Vault이며, 그 안의 모든 `.md` 파일이 작업 대상이다.

```
my-vault/                            ← Vault 루트
├── .baram/                          ← Baram 메타데이터 (Git-ignored)
│   ├── config.json                  ← Vault별 설정
│   ├── workspace.json               ← 마지막 UI 상태 (열린 탭, 사이드바 등)
│   ├── link-index.db                ← 링크 인덱스 캐시 (SQLite)
│   ├── search-index/                ← 전문 검색 인덱스 (tantivy)
│   └── snapshots/                   ← 자동 스냅샷
│       ├── 2026-02-12T10-00-00/
│       └── 2026-02-12T11-00-00/
├── docs/
│   ├── README.md
│   └── guide.md
├── skills/
│   ├── skill-a.md
│   └── skill-b.md
├── daily/                           ← 데일리 노트 (설정 가능)
│   ├── 2026-02-11.md
│   └── 2026-02-12.md
└── assets/                          ← 이미지 등 첨부파일
    ├── image-001.png
    └── diagram.svg
```

### Tauri fs API 활용 전략

파일 시스템 작업은 모두 Rust 백엔드에서 수행하고, 프론트엔드는 Tauri Command를 통해 요청한다. 이유는 성능(Rust의 파일 I/O가 JS보다 빠름), 보안(Tauri의 앱 권한 시스템으로 접근 범위 제한), 안정성(파일 잠금, 원자적 쓰기 등 OS 수준 보장)이다.

핵심 패턴:

**원자적 쓰기 (Atomic Write)**: 파일 저장 시 직접 덮어쓰지 않고, 임시 파일에 쓴 뒤 rename한다. 이렇게 하면 저장 중 크래시가 발생해도 원본이 손상되지 않는다.

```
save("docs/README.md", content):
  1. write("docs/.README.md.tmp", content)  ← 임시 파일에 쓰기
  2. rename("docs/.README.md.tmp", "docs/README.md")  ← 원자적 교체
```

**지연 쓰기 (Debounced Write)**: 자동 저장은 마지막 편집 후 일정 시간(기본 2초) 경과하면 실행한다. 타이핑 중에는 저장하지 않는다.

### File Watcher 전략

Tauri의 `notify` crate 기반 파일 감시를 사용하여 외부 변경(Git pull, 다른 에디터에서 수정 등)을 실시간 감지한다.

```
File Watcher (Rust)
     │
     ├── 파일 변경 감지
     │   ├── 새 파일 생성 → emit('file-changed', { kind: 'create' })
     │   ├── 파일 수정    → emit('file-changed', { kind: 'modify' })
     │   ├── 파일 삭제    → emit('file-changed', { kind: 'delete' })
     │   └── 파일 이름변경 → emit('file-renamed', { old, new })
     │
     ├── 프론트엔드 반응
     │   ├── fileStore.refreshFileTree()
     │   ├── 열린 파일이 외부 수정됨 → 충돌 해결 다이얼로그
     │   └── linkStore.refreshIndex() (변경된 파일만 재인덱싱)
     │
     └── 무시 패턴
         ├── .baram/                  ← 메타데이터 폴더
         ├── .git/                    ← Git 내부
         ├── node_modules/            ← npm
         └── *.tmp                    ← 임시 파일
```

외부 수정 충돌 처리: 에디터에서 편집 중인 파일이 외부에서도 수정된 경우, 3가지 선택지를 제공한다 — (1) 외부 변경으로 덮어쓰기, (2) 에디터 내용 유지, (3) diff 보기.

### 링크 인덱스 / 메타데이터 캐시 구조

양방향 링크, 백링크, 전역 검색을 위해 Vault 전체 파일을 인덱싱한다. 인덱스는 Rust 백엔드에서 구축하고, 프론트엔드에서 캐시한다.

**링크 인덱스** — SQLite(rusqlite)로 구현한다.

```sql
-- 파일 메타데이터
CREATE TABLE files (
  path TEXT PRIMARY KEY,
  title TEXT,
  modified_at INTEGER,
  frontmatter TEXT,                   -- JSON
  checksum TEXT                       -- 변경 감지용
);

-- 링크 관계
CREATE TABLE links (
  source_path TEXT,
  target_path TEXT,
  line_number INTEGER,
  context TEXT,                       -- 링크 주변 텍스트
  link_type TEXT,                     -- 'wikilink' | 'md-link' | 'block-ref'
  PRIMARY KEY (source_path, target_path, line_number)
);

-- 블록 ID
CREATE TABLE blocks (
  path TEXT,
  block_id TEXT,
  line_number INTEGER,
  content TEXT,                       -- 블록 텍스트 (검색용)
  PRIMARY KEY (path, block_id)
);

-- 인덱스
CREATE INDEX idx_links_target ON links(target_path);
CREATE INDEX idx_blocks_id ON blocks(block_id);
```

**전문 검색 인덱스** — tantivy(Rust 기반 Lucene 구현)로 Vault 전체 파일을 인덱싱한다. ripgrep 스타일의 빠른 검색을 제공한다.

**인덱싱 전략**:

| 시점 | 범위 | 방식 |
|------|------|------|
| Vault 최초 열기 | 전체 파일 | Full scan (백그라운드) |
| 파일 저장 시 | 해당 파일만 | Incremental update |
| 외부 변경 감지 시 | 변경된 파일만 | Incremental update |
| 파일 이름 변경 시 | 해당 파일 + 이 파일을 링크하는 파일들 | Link update |

### 자동 저장 / 스냅샷 메커니즘

**자동 저장**: 마지막 편집 후 설정 시간(기본 2초) 경과 시 자동 저장. 원자적 쓰기 사용.

```
편집 → 디바운스 타이머 리셋 → 2초 경과 → write_file → 상태바 "저장됨" 표시
          ↑                      ↑
     추가 편집 시 리셋     타이핑 중에는 저장 안 함
```

**스냅샷**: 설정 간격(기본 30분)마다 Vault 전체 또는 변경된 파일의 스냅샷을 `.baram/snapshots/`에 저장한다. 최대 보관 개수(기본 50개)를 초과하면 오래된 것부터 삭제한다.

스냅샷 복원 UI: 파일별 스냅샷 목록 → 선택 → Diff 뷰로 현재 버전과 비교 → 복원 또는 부분 복원.

---

*Part 3 끝. 다음: Part 4. UI/UX 설계*
