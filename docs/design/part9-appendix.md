# Part 9. 부록

---

## 9.1 Skills 활용 가이드 (개발 자동화)

Baram 개발 과정에서 Claude Skills를 활용하여 반복 작업을 자동화하는 3가지 방법과 구체적인 스킬 예시를 제시한다.

### 방법 1: Tiptap Extension Generator

새로운 Tiptap Extension을 생성할 때마다 반복되는 보일러플레이트 코드를 자동화한다.

```yaml
---
name: tiptap-extension-generator
description: "Baram의 Tiptap Extension 보일러플레이트를 생성한다."
version: 1.0.0
tags: [code-gen, tiptap, baram]
input_format: text
output_format: code
model: claude-sonnet-4-5
---

## 역할
당신은 Baram 마크다운 에디터의 Tiptap Extension 코드 생성기입니다.

## 입력
사용자가 Extension의 이름, 유형(Node/Mark/Plugin), 마크다운 구문을 설명합니다.

## 출력 규칙
1. Extension 파일 (`extensions/{name}.ts`)
   - Tiptap의 Node.create() / Mark.create() 패턴 사용
   - addAttributes(), addInputRules(), addKeyboardShortcuts() 포함
   - NodeView가 필요한 경우 React 컴포넌트도 생성
2. 테스트 파일 (`extensions/__tests__/{name}.test.ts`)
   - 생성, 파싱, 직렬화 라운드트립 테스트
3. mdast 변환 코드 (`pipeline/{name}-transformer.ts`)
   - mdast → ProseMirror, ProseMirror → mdast 양방향

## 컨텍스트
- Part 3(§3.3) Node/Mark Extension 목록과 스키마를 따릅니다
- Part 7(§7.2) ProseMirror Document 스키마를 준수합니다
- Part 7(§7.1) 마크다운 직렬화 규칙을 적용합니다
```

**사용 예시**: "Callout Extension을 만들어줘. 구문은 `> [!type] title`이고, NodeView로 아이콘과 접기 버튼이 필요해." → Extension 코드, React NodeView 컴포넌트, 파서/직렬화 코드, 테스트 파일이 모두 생성된다.

### 방법 2: Notion Converter

Notion 데이터를 Baram 마크다운으로 변환하는 스킬이다.

```yaml
---
name: notion-to-baram-converter
description: "Notion Export 데이터를 Baram 호환 마크다운으로 변환한다."
version: 1.0.0
tags: [converter, notion, baram]
input_format: markdown
output_format: markdown
---

## 역할
Notion에서 내보낸 마크다운 파일을 Baram 호환 형식으로 변환합니다.

## 변환 규칙
1. 수식: Notion의 $$...$$ (블록) → Baram의 $$...$$ (유지)
2. 수식: Notion의 $..$ (인라인) → Baram의 $..$ (유지, KaTeX 호환 검증)
3. 콜아웃: Notion의 > 💡 ... → Baram의 > [!tip] ...
4. 토글: Notion의 <details> → Baram의 토글 구문
5. 데이터베이스: Notion 테이블 → YAML Frontmatter + 마크다운 테이블
6. 링크: Notion 내부 링크 → [[wikilink]] 변환
7. 이미지: 상대 경로 정리, assets/ 폴더로 이동
8. Frontmatter: Notion 속성 → YAML Frontmatter 매핑

## 출력
변환된 마크다운 파일과 변환 보고서 (변환 항목 수, 수동 확인 필요 항목)
```

### 방법 3: 디자인 문서 → 구현 코드 브릿지

디자인 문서의 스펙을 읽고 해당 구현 코드의 스켈레톤을 생성한다.

```yaml
---
name: baram-spec-to-code
description: "Baram 디자인 문서의 섹션을 읽고 구현 코드 스켈레톤을 생성한다."
version: 1.0.0
tags: [code-gen, baram, design-doc]
requires:
  - skills/tiptap-extension-generator.md
input_format: text
output_format: code
---

## 역할
Baram 디자인 문서(Part 1~9)의 특정 섹션을 참조하여
TypeScript/Rust 구현 코드의 스켈레톤을 생성합니다.

## 입력
디자인 문서 섹션 번호 (예: "§5.3 수식 편집")

## 출력
1. 관련 TypeScript 파일 목록 + 스켈레톤 코드
2. 관련 Rust 파일 목록 + 스켈레톤 코드
3. 필요한 테스트 파일 목록
4. 구현 순서 제안 (의존성 기반)
5. 주의사항 및 엣지 케이스 목록

## 참조
디자인 문서 전체 (Part 1~9)를 컨텍스트로 활용합니다.
특히 Part 3(아키텍처), Part 7(데이터 모델)의 인터페이스 정의를 준수합니다.
```

### 개발 워크플로우 with Skills

```
[일반적인 기능 개발 흐름]

  1. 디자인 문서에서 구현할 섹션 확인
       │
  2. baram-spec-to-code 스킬로 스켈레톤 생성
       │
  3. tiptap-extension-generator로 Extension 보일러플레이트 생성
       │
  4. 생성된 코드를 기반으로 구현
       │
  5. 라운드트립 테스트 통과 확인
       │
  6. PR 생성 (§5.15 Git 통합)
```

이 워크플로우에서 Steps 2~3은 Baram의 AI Chat Panel(§6.2 Level 3)에서 직접 실행할 수 있다. `@skills/tiptap-extension-generator.md`를 참조하여 대화형으로 코드를 생성하고, Apply to Editor로 파일에 적용하는 것이 가능하다.

---

## 9.2 용어집 (Glossary)

### 에디터 / 문서 모델

| 용어 | 정의 |
|------|------|
| **ProseMirror** | 구조화된 텍스트 편집을 위한 오픈소스 프레임워크. 불변 문서 모델, 트랜잭션 기반 상태 관리, 스키마 정의를 제공한다. Baram 에디터 엔진의 기반이다. |
| **Tiptap** | ProseMirror 위에 구축된 헤드리스 에디터 프레임워크. Extension 시스템으로 기능을 모듈화하며, React/Vue/Svelte 바인딩을 제공한다. Baram은 Tiptap v2를 사용한다. |
| **WYSIWYG** | What You See Is What You Get. 편집 중인 화면이 최종 출력과 동일하게 보이는 편집 방식. Baram은 마크다운의 WYSIWYG 렌더링을 제공한다. |
| **Node** | ProseMirror 문서의 블록 레벨 요소. Paragraph, Heading, CodeBlock, Table 등이 Node이다. 각 Node는 스키마에서 허용하는 내용(content)과 속성(attrs)을 가진다. |
| **Mark** | ProseMirror의 인라인 서식 요소. Bold, Italic, Code, Link 등이 Mark이다. 텍스트 노드에 중첩 적용할 수 있으며, 배타 규칙(excludes)으로 조합을 제한한다. |
| **NodeView** | ProseMirror Node의 커스텀 렌더러. 기본 DOM 렌더링 대신 React 컴포넌트를 사용하여 복잡한 UI(코드 블록, 수식, 테이블 컨트롤 등)를 구현한다. |
| **Schema** | ProseMirror 문서의 구조를 정의하는 선언. 어떤 Node와 Mark가 존재하고, 어떤 계층 관계가 허용되는지 명시한다. §7.2에서 Baram의 전체 스키마를 정의한다. |
| **Transaction** | ProseMirror 상태 변경의 단위. 문서 변경(Step)의 시퀀스이며, 적용 전에 Plugin이 가로채어 추가 변경을 덧붙일 수 있다. |
| **InputRule** | 사용자 입력 패턴을 감지하여 자동 변환하는 ProseMirror 메커니즘. `#`+스페이스 → 헤딩, `**`→볼드 등 마크다운 WYSIWYG의 핵심이다. |
| **Decoration** | ProseMirror 문서에 시각적 효과를 추가하되 문서 내용은 변경하지 않는 메커니즘. Ghost Text, AI Diff 표시, 검색 하이라이트 등에 사용한다. |
| **Extension** | Tiptap에서 Node, Mark, Plugin을 통합하는 모듈 단위. Baram은 Core Extension(기본)과 선택적 Extension(ext-)으로 나누어 점진적 복잡도를 구현한다. |
| **mdast** | Markdown Abstract Syntax Tree. unified/remark 생태계의 마크다운 AST 표현이다. Baram의 파이프라인에서 마크다운 파일 ↔ ProseMirror 문서 간 중간 표현으로 사용한다. |

### 아키텍처 / 프레임워크

| 용어 | 정의 |
|------|------|
| **Tauri** | Rust 백엔드 + WebView 프론트엔드로 구성된 경량 데스크톱 앱 프레임워크. Electron 대비 바이너리 크기(~10MB vs ~300MB)와 메모리 사용이 현저히 작다. Baram은 Tauri 2.0을 사용한다. |
| **IPC** | Inter-Process Communication. Tauri에서 프론트엔드(WebView)와 백엔드(Rust) 간 통신 방식. Tauri Command(요청-응답)와 Event(단방향 알림)로 구분된다. |
| **Zustand** | React용 경량 상태 관리 라이브러리. Baram은 5개 스토어(fileStore, uiStore, settingsStore, aiStore, linkStore)로 앱 상태를 관리한다. |
| **tantivy** | Rust로 구현된 전문 검색 라이브러리(Apache Lucene 영감). Baram의 Vault 전체 파일 검색에 사용한다. |
| **rusqlite** | Rust의 SQLite 바인딩. 링크 인덱스, 블록 ID 인덱스, 메타데이터 캐시를 저장한다. |
| **KaTeX** | LaTeX 수식을 HTML로 고속 렌더링하는 라이브러리. MathJax 대비 빠르며, Notion과 호환되는 수식 렌더링을 제공한다. |
| **CodeMirror 6** | 코드 편집기 프레임워크. Baram의 코드 블록 NodeView에 임베드하여 구문 강조와 편집 기능을 제공한다. |
| **Mermaid.js** | 텍스트 기반 다이어그램 생성 라이브러리. 플로우차트, 시퀀스, 간트 등 11종 다이어그램을 지원한다. |
| **Yjs** | CRDT 기반 실시간 협업 프레임워크. Phase 3에서 멀티 사용자 동시 편집에 사용한다. |
| **CRDT** | Conflict-free Replicated Data Type. 여러 사용자가 동시에 편집해도 자동으로 충돌이 해결되는 데이터 구조. Yjs가 이를 구현한다. |
| **Vault** | Baram에서 하나의 작업 공간을 나타내는 로컬 폴더. Obsidian의 Vault 개념과 동일하다. 폴더 안의 모든 `.md` 파일이 작업 대상이다. |
| **WAL** | Write-Ahead Logging. SQLite의 동시 접근 모드. 읽기와 쓰기가 서로를 차단하지 않아 인덱스 갱신 중에도 검색이 가능하다. |

### AI 관련

| 용어 | 정의 |
|------|------|
| **Ghost Text** | 커서 위치에 희미한 회색 텍스트로 표시되는 AI 자동완성 제안. Tab으로 수락, Esc으로 거부한다. Copilot/Cursor Tab과 유사하며, Baram은 Level 1 AI 기능이다. |
| **Inline Edit** | 텍스트를 선택하고 자연어 지시를 입력하면 AI가 변환 결과를 diff로 미리 보여주는 기능. Baram의 Level 2 AI이며, Cmd+K로 트리거한다. |
| **AI Diff Engine** | AI 생성 결과를 원본과 비교하여 문자 수준 차이를 ProseMirror Decoration으로 표시하는 시스템. 초록(삽입), 빨강(삭제), 청크별 부분 수락을 지원한다. |
| **Agent Mode** | AI가 계획을 수립하고 여러 파일을 자율적으로 편집하는 Level 4 AI 기능. 사용자가 최종 diff를 검토/승인한다. Phase 3에서 구현한다. |
| **Knowledge Q&A** | Vault 전체를 벡터 검색하여 질문에 답하는 Level 5 AI 기능. 답변에 출처(citation)를 포함한다. Phase 3에서 구현한다. |
| **Provider** | LLM API 서비스 제공자. Claude(Anthropic), GPT(OpenAI), Gemini(Google), Ollama(로컬) 등을 추상화 레이어로 통합 지원한다. |
| **MCP** | Model Context Protocol. AI 모델이 외부 도구/데이터에 접근할 수 있게 하는 프로토콜. Phase 3에서 MCP 서버 연동으로 AI가 파일 시스템, 웹 검색 등을 활용한다. |
| **Privacy Mode** | AI에 문서 내용을 전송하지 않는 모드. 글로벌 설정 또는 파일별 Frontmatter(`privacy: true`)로 활성화한다. 민감 문서 보호에 사용한다. |
| **3-tier Prompt** | Ghost Text의 컨텍스트 구성 전략. 현재 파일(필수) → 열린 탭 파일(선택) → Vault 인덱스(선택)의 3단계로 AI에 전달할 문맥을 구성한다. |
| **Skills** | LLM에 특정 역할과 규칙을 부여하는 마크다운 파일. YAML Frontmatter로 메타데이터를 정의하고, 본문에 프롬프트를 작성한다. Baram은 Skills 편집에 최적화된 전용 기능을 제공한다. |

### 마크다운 / 콘텐츠

| 용어 | 정의 |
|------|------|
| **CommonMark** | 마크다운의 표준 사양. 모호한 해석을 배제하고 일관된 파싱을 보장한다. Baram은 CommonMark 0.31을 기저 사양으로 사용한다. |
| **GFM** | GitHub Flavored Markdown. CommonMark에 테이블, 태스크 리스트, 취소선, 자동 링크를 추가한 확장 사양이다. Baram에서 기본 활성이다. |
| **Frontmatter** | 마크다운 파일 상단에 `---`로 감싼 YAML 메타데이터 블록. 제목, 태그, 작성일 등을 구조화된 형태로 저장한다. |
| **Wikilink** | `[[페이지명]]` 또는 `[[페이지명|표시텍스트]]` 형태의 양방향 링크 구문. Obsidian/Logseq에서 널리 사용되며, Baram의 지식 연결 시스템 핵심이다. |
| **블록 참조** | `((block-id))` 형태로 특정 블록을 참조하는 구문. Logseq에서 영감을 받았으며, 블록 임베드(`{{embed ((id))}}`와 연동한다. |
| **Strict Mode** | Baram 확장 구문(수식, 위키링크, 하이라이트 등)을 모두 비활성화하여 순수 GFM만 출력하는 모드. 호환성이 중요한 파일에 사용한다. |
| **콜아웃** | `> [!type] title` 형태의 강조 블록. Obsidian/GitHub의 Admonition/Alert 구문과 호환된다. info, warning, tip, danger 등의 타입을 지원한다. |
| **Slug** | 헤딩 텍스트를 URL 안전 문자로 변환한 앵커 ID. "## API 설계" → `api-설계`. 내부 링크와 HTML 내보내기의 링크 타겟으로 사용한다. |

### UI / 인터랙션

| 용어 | 정의 |
|------|------|
| **3-Layer Interaction** | Baram의 UI 인터랙션 모델. Layer 1(타이핑 중, 에디터 내 슬래시/InputRule), Layer 2(탐색 중, 커맨드 팔레트/Quick Switcher), Layer 3(구성 중, 설정/메뉴)으로 분류한다. |
| **커맨드 팔레트** | Cmd+K로 호출하는 퍼지 검색 기반 명령 실행 인터페이스. 모든 기능의 단일 진입점이다. VS Code, Cursor에서 보편화된 패턴이다. |
| **슬래시 커맨드** | `/` 입력으로 트리거되는 블록 삽입 메뉴. Notion, Logseq에서 보편화된 패턴이다. |
| **플로팅 서식 툴바** | 텍스트 선택 시 선택 영역 위에 나타나는 인라인 서식 도구 모음. Notion, Medium에서 보편화된 패턴이다. |
| **블록 핸들** | 블록 좌측에 호버 시 나타나는 ⋮⋮ 아이콘. 드래그 이동, 블록 변환, 복사/삭제 메뉴를 제공한다. |
| **Zen 모드** | 사이드바, 상태바, 메뉴바를 모두 숨기고 에디터만 전체화면으로 표시하는 집중 모드. |
| **Workspace 프리셋** | 사이드바/패널/편집 모드 조합을 저장한 UI 레이아웃 프리셋. 기본 3종(글쓰기, Skills, 리서치)을 제공하며, 사용자 커스텀도 가능하다. |
| **Quick Switcher** | Cmd+O(또는 Cmd+P)로 호출하는 파일 퍼지 검색 다이얼로그. 파일명, 별칭, `#`헤딩, `^`블록 검색을 지원한다. |

---

## 9.3 단축키 전체 맵 (Quick Reference)

모든 단축키는 설정(`keybindings.json`, §7.3)에서 재할당할 수 있다.

### 파일

| 동작 | macOS | Windows / Linux |
|------|-------|-----------------|
| 새 파일 | `⌘N` | `Ctrl+N` |
| 파일 열기 (Quick Switcher) | `⌘P` | `Ctrl+P` |
| 파일 저장 | `⌘S` | `Ctrl+S` |
| 다른 이름으로 저장 | `⇧⌘S` | `Ctrl+Shift+S` |
| 탭 닫기 | `⌘W` | `Ctrl+W` |
| 다음 탭 | `⌃Tab` | `Ctrl+Tab` |
| 이전 탭 | `⌃⇧Tab` | `Ctrl+Shift+Tab` |
| 설정 | `⌘,` | `Ctrl+,` |

### 편집

| 동작 | macOS | Windows / Linux |
|------|-------|-----------------|
| 실행 취소 | `⌘Z` | `Ctrl+Z` |
| 다시 실행 | `⇧⌘Z` | `Ctrl+Y` |
| 잘라내기 | `⌘X` | `Ctrl+X` |
| 복사 | `⌘C` | `Ctrl+C` |
| 붙여넣기 | `⌘V` | `Ctrl+V` |
| 마크다운으로 복사 | `⇧⌘C` | `Ctrl+Shift+C` |
| 서식 없이 붙여넣기 | `⇧⌘V` | `Ctrl+Shift+V` |
| 전체 선택 | `⌘A` | `Ctrl+A` |
| 줄 선택 | `⌘L` | `Ctrl+L` |
| 스타일 범위 선택 | `⌘E` | `Ctrl+E` |
| 서식 모두 해제 | `⌘\` | `Ctrl+\` |

### 인라인 서식

| 동작 | macOS | Windows / Linux |
|------|-------|-----------------|
| 볼드 | `⌘B` | `Ctrl+B` |
| 이탤릭 | `⌘I` | `Ctrl+I` |
| 밑줄 | `⌘U` | `Ctrl+U` |
| 취소선 | `⌥⇧5` | `Alt+Shift+5` |
| 인라인 코드 | `` ⌘` `` | `` Ctrl+` `` |
| 링크 삽입 | `⌘K` (선택 시) | `Ctrl+K` (선택 시) |
| 이미지 삽입 | `⇧⌘I` | `Ctrl+Shift+I` |
| 인라인 수식 | `⇧⌘M` | `Ctrl+Shift+M` |

### 블록 서식

| 동작 | macOS | Windows / Linux |
|------|-------|-----------------|
| 헤딩 1~6 | `⌘1` ~ `⌘6` | `Ctrl+1` ~ `Ctrl+6` |
| 일반 문단 | `⌘0` | `Ctrl+0` |
| 헤딩 레벨 증가 | `⌘=` | `Ctrl+=` |
| 헤딩 레벨 감소 | `⌘-` | `Ctrl+-` |
| 테이블 삽입 | `⌘T` | `Ctrl+T` |
| 코드 블록 | `⇧⌘K` | `Ctrl+Shift+K` |
| 인용 블록 | `⇧⌘Q` | `Ctrl+Shift+Q` |
| 순서 리스트 | `⇧⌘[` | `Ctrl+Shift+[` |
| 비순서 리스트 | `⇧⌘]` | `Ctrl+Shift+]` |
| 들여쓰기 | `Tab` | `Tab` |
| 내어쓰기 | `⇧Tab` | `Shift+Tab` |

### 뷰 전환

| 동작 | macOS | Windows / Linux |
|------|-------|-----------------|
| 소스 코드 모드 | `⌘/` | `Ctrl+/` |
| 포커스 모드 | `F8` | `F8` |
| 타자기 모드 | `F9` | `F9` |
| Zen 모드 | `⇧⌘Enter` | `Ctrl+Shift+Enter` |
| 좌 사이드바 토글 | `⇧⌘L` | `Ctrl+Shift+L` |
| 우 사이드바 토글 | `⇧⌘R` | `Ctrl+Shift+R` |
| 확대 | `⌘=` | `Ctrl+=` |
| 축소 | `⌘-` | `Ctrl+-` |
| 전체화면 | `⌃⌘F` | `F11` |

### 검색 / 네비게이션

| 동작 | macOS | Windows / Linux |
|------|-------|-----------------|
| 문서 내 찾기 | `⌘F` | `Ctrl+F` |
| 전체 파일 검색 | `⇧⌘F` | `Ctrl+Shift+F` |
| 찾아 바꾸기 | `⌥⌘F` | `Ctrl+H` |
| 줄 번호 이동 | `⌃G` | `Ctrl+G` |
| 뒤로 (네비게이션) | `⌃-` | `Alt+←` |
| 앞으로 (네비게이션) | `⌃⇧-` | `Alt+→` |

### 커맨드 시스템

| 동작 | macOS | Windows / Linux |
|------|-------|-----------------|
| 커맨드 팔레트 | `⌘K` (선택 없이) | `Ctrl+K` (선택 없이) |
| Quick Switcher | `⌘P` | `Ctrl+P` |
| 슬래시 커맨드 | `/` (빈 블록에서) | `/` (빈 블록에서) |

### AI

| 동작 | macOS | Windows / Linux |
|------|-------|-----------------|
| AI 인라인 편집 | `⌘K` (선택 시) | `Ctrl+K` (선택 시) |
| AI 채팅 패널 | `⇧⌘A` | `Ctrl+Shift+A` |
| Ghost Text 수락 | `Tab` | `Tab` |
| Ghost Text 단어 수락 | `⌘→` | `Ctrl+→` |
| Ghost Text 거부 | `Esc` | `Esc` |
| Ghost Text 토글 | `⇧⌘G` | `Ctrl+Shift+G` |

### Baram 고유

| 동작 | macOS | Windows / Linux |
|------|-------|-----------------|
| 백링크 패널 | `⇧⌘B` | `Ctrl+Shift+B` |
| Workspace: 글쓰기 | `⌥⌘1` | `Ctrl+Alt+1` |
| Workspace: Skills | `⌥⌘2` | `Ctrl+Alt+2` |
| Workspace: 리서치 | `⌥⌘3` | `Ctrl+Alt+3` |

### 테이블 내 전용

| 동작 | macOS | Windows / Linux |
|------|-------|-----------------|
| 다음 셀 | `Tab` | `Tab` |
| 이전 셀 | `⇧Tab` | `Shift+Tab` |
| 셀 내 줄바꿈 | `Enter` | `Enter` |
| 현재 행 선택 | `⌃L` | `Ctrl+L` |
| 현재 셀 선택 | `⌃E` | `Ctrl+E` |
| 테이블 밖으로 이동 | `⌘Enter` | `Ctrl+Enter` |

### 수식 편집 내 전용

| 동작 | macOS | Windows / Linux |
|------|-------|-----------------|
| 자동완성 수락 | `Tab` | `Tab` |
| 자동완성 다음 항목 | `↓` | `↓` |
| 자동완성 이전 항목 | `↑` | `↑` |
| 수식 확정 (블록 수식) | `⇧Enter` | `Shift+Enter` |
| 수식 취소 | `Esc` | `Esc` |

---

## 9.4 참고 자료 및 링크

### 벤치마킹 에디터

| 에디터 | URL | 참조 파트 |
|--------|-----|-----------|
| Typora | https://typora.io | Part 2(§2.1), Part 4 전체 |
| Obsidian | https://obsidian.md | Part 2(§2.2), Part 5(§5.6, §5.12) |
| Logseq | https://logseq.com | Part 2(§2.3), Part 5(§5.13, §5.14) |
| Notion | https://notion.so | Part 2(§2.4), Part 5(§5.3 KaTeX 호환) |
| Cursor | https://cursor.sh | Part 6(AI 아키텍처 참조) |
| Zed | https://zed.dev | Part 6(AI 아키텍처 참조) |
| VS Code | https://code.visualstudio.com | Part 4(커맨드 팔레트, keybindings) |
| Milkdown | https://milkdown.dev | Part 3(ProseMirror+Remark 파이프라인 참조) |

### 핵심 기술 문서

| 기술 | URL | 사용처 |
|------|-----|--------|
| Tauri 2.0 | https://v2.tauri.app | 데스크톱 앱 프레임워크 |
| Tiptap | https://tiptap.dev/docs | 에디터 엔진 |
| ProseMirror | https://prosemirror.net/docs | 문서 모델, 스키마, 트랜잭션 |
| KaTeX | https://katex.org/docs | 수식 렌더링 |
| CodeMirror 6 | https://codemirror.net/docs | 코드 블록 편집 |
| Mermaid.js | https://mermaid.js.org/intro | 다이어그램 생성 |
| unified / remark | https://unifiedjs.com | 마크다운 파싱 파이프라인 |
| Zustand | https://zustand-demo.pmnd.rs | 상태 관리 |
| tantivy | https://github.com/quickwit-oss/tantivy | 전문 검색 엔진 |
| Yjs | https://yjs.dev | CRDT 실시간 협업 |

### 마크다운 사양

| 사양 | URL | 비고 |
|------|-----|------|
| CommonMark 0.31 | https://spec.commonmark.org/0.31.2 | Baram 기저 사양 |
| GFM | https://github.github.com/gfm | 기본 확장 사양 |
| remark-math | https://github.com/remarkjs/remark-math | 수식 구문 ($, $$) |
| remark-gfm | https://github.com/remarkjs/remark-gfm | GFM 확장 |
| remark-frontmatter | https://github.com/remarkjs/remark-frontmatter | YAML Frontmatter |

### AI / LLM

| 자료 | URL | 비고 |
|------|-----|------|
| Anthropic API (Claude) | https://docs.anthropic.com | 기본 LLM 프로바이더 |
| OpenAI API | https://platform.openai.com/docs | GPT 프로바이더 |
| Google Gemini API | https://ai.google.dev/docs | Gemini 프로바이더 |
| Ollama | https://ollama.com | 로컬 LLM |
| MCP Specification | https://modelcontextprotocol.io | 모델 컨텍스트 프로토콜 |

### 디자인 레퍼런스

| 자료 | 참조 내용 |
|------|-----------|
| Notion 디자인 시스템 | 슬래시 커맨드, 블록 핸들, 플로팅 툴바 패턴 |
| Radix UI Primitives | 접근성 준수 UI 컴포넌트 기반 |
| Tailwind CSS | 유틸리티 기반 스타일링 |
| Lucide Icons | 아이콘 시스템 (MIT 라이선스) |
| Inter / Pretendard 폰트 | UI 타이포그래피 |
| JetBrains Mono / Fira Code | 코드/수식 모노스페이스 폰트 |
| Tokyo Night 컬러 팔레트 | 기본 다크 테마 색상 참조 |

---

## 9.5 설계 문서 전체 구조 요약

### 파트 목록

| 파트 | 제목 | 주요 내용 | 분량 |
|------|------|-----------|------|
| Part 1 | 프로젝트 개요 | 비전, 포지셔닝, 기술 스택, 핵심 원칙 | ~150줄 |
| Part 2 | 시장 분석 및 벤치마킹 | Typora/Obsidian/Logseq/Notion 분석, 차별화 전략 | ~200줄 |
| Part 3 | 아키텍처 설계 | Tauri 구조, Tiptap/ProseMirror, IPC, Zustand, 파일 시스템 | ~1,125줄 |
| Part 4 | UI/UX 설계 | 3-Layer Interaction, 레이아웃, 메뉴, 단축키, 테마, 설정, 온보딩 | ~1,036줄 |
| Part 5 | 핵심 기능 상세 설계 | 편집, 수식, 코드, 연결, Skills, 검색, 내보내기, Git 등 15개 섹션 | ~1,874줄 |
| Part 6 | AI 통합 설계 | 5-Level AI, LLM 추상화, Skills-Aware, 구현 로드맵 | ~1,080줄 |
| Part 7 | 데이터 모델 및 파일 규격 | 마크다운 사양, ProseMirror 스키마, 설정 JSON, 인덱스 DB, 스냅샷 | ~1,405줄 |
| Part 8 | 개발 로드맵 및 일정 | 3 Phase, 10 마일스톤, 리스크, 품질 보증, 릴리스 전략, KPI | ~665줄 |
| Part 9 | 부록 | Skills 가이드, 용어집, 단축키 맵, 참고 자료 | 본 문서 |

### 교차 참조 맵

문서 간 주요 교차 참조 관계이다.

```
Part 3 (아키텍처)
  ├── §3.3 ProseMirror 스키마 ─→ Part 7 §7.2 (상세 스키마)
  ├── §3.4 Extension 목록 ─→ Part 5 전체 (기능별 Extension)
  ├── §3.5 Zustand Stores ─→ Part 7 §7.3 (JSON 스키마)
  └── §3.6 파일 시스템 ─→ Part 7 §7.4 (인덱스 DB)

Part 4 (UI/UX)
  ├── §4.2 3-Layer Interaction ─→ Part 5 (각 기능의 UI 명세)
  ├── §4.3 사이드바 ─→ Part 5 §5.6 (백링크), §5.15 (Git)
  ├── §4.6 단축키 ─→ Part 9 §9.3 (전체 맵)
  └── §4.8 설정 ─→ Part 7 §7.3 (설정 JSON)

Part 5 (핵심 기능)
  ├── §5.3 수식 ─→ Part 7 §7.2 (math_block, math_inline 스키마)
  ├── §5.6 연결 ─→ Part 7 §7.4 (링크 인덱스 DB)
  ├── §5.8 Skills ─→ Part 6 §6.4 (Skills-Aware AI)
  └── §5.15 Git ─→ Part 7 §7.3 (Git 설정)

Part 6 (AI)
  ├── §6.2 5-Level ─→ Part 8 §8.1 (Phase별 AI 기능 배분)
  ├── §6.3 Provider ─→ Part 7 §7.3 (AI 설정 JSON)
  └── §6.4 Skills ─→ Part 5 §5.8 (Skills 편집 UI)

Part 7 (데이터 모델)
  ├── §7.1 마크다운 사양 ─→ Part 3 §3.3 (파싱 파이프라인)
  ├── §7.2 스키마 ─→ Part 3 §3.3 (Extension 목록)
  └── §7.5 스냅샷 ─→ Part 8 §8.1 (Phase 3 구현)

Part 8 (로드맵)
  └── §8.1~§8.2 전체 ─→ Part 3~7 (각 기능의 구현 시점)
```

---

*Part 9 끝. Baram 설계 문서 전체 완료.*
