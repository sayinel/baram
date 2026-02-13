# Part 7. 데이터 모델 및 파일 규격

---

## 7.1 마크다운 파일 규격

### 지원 마크다운 사양

Baram의 마크다운 처리는 **CommonMark 0.31**을 기저 사양으로 하고, **GitHub Flavored Markdown (GFM)** 확장을 기본 활성화하며, Baram 고유 확장 구문을 선택적으로 제공한다.

```
[마크다운 사양 계층]

  Layer 3: Baram 확장          ← 설정에서 개별 토글 (§7.1.3)
  ─────────────────────────
  Layer 2: GFM 확장             ← 기본 활성
  ─────────────────────────
  Layer 1: CommonMark 0.31      ← 항상 활성, 비활성 불가
```

#### Layer 1 — CommonMark 0.31

모든 CommonMark 요소를 완전 지원한다.

| 범주 | 요소 |
|------|------|
| 블록 | 헤딩(`#`~`######`), 문단, 코드 블록(`` ``` ``), 인용(`>`), 순서 리스트(`1.`), 비순서 리스트(`-`/`*`/`+`), 수평선(`---`/`***`/`___`), HTML 블록 |
| 인라인 | 볼드(`**`), 이탤릭(`*`), 코드(`` ` ``), 링크(`[]()`), 이미지(`![]()`), 하드 줄바꿈, HTML 인라인 |
| 기타 | 이스케이프(`\`), 엔티티(`&amp;`) |

#### Layer 2 — GFM 확장

GFM은 기본 활성이며, 개별적으로 비활성화할 수 없다.

| 요소 | 구문 | 비고 |
|------|------|------|
| 테이블 | `\| col \| col \|` | 정렬 구문(`:---:`) 포함 |
| 태스크 리스트 | `- [ ]` / `- [x]` | 체크박스 인터랙티브 |
| 취소선 | `~~text~~` | |
| 자동 링크 | `https://...` 자동 감지 | URL, 이메일 |
| 각주 | `[^1]` / `[^1]: text` | GFM 공식 스펙 외, 널리 지원 |

#### Layer 3 — Baram 확장 구문

각 확장은 설정(§7.3)에서 개별 토글할 수 있다. **Strict Mode** 활성화 시 Layer 3 전체가 비활성화되어 순수 GFM만 출력한다.

| 확장 | 구문 | 기본값 | 설정 키 |
|------|------|--------|---------|
| 인라인 수식 | `$formula$` | ✅ ON | `markdown.enableInlineMath` |
| 블록 수식 | `$$ ... $$` | ✅ ON | `markdown.enableBlockMath` |
| 하이라이트 | `==text==` | ❌ OFF | `markdown.enableHighlight` |
| 위첨자 | `X^2^` | ❌ OFF | `markdown.enableSuperscript` |
| 아래첨자 | `H~2~O` | ❌ OFF | `markdown.enableSubscript` |
| 위키링크 | `[[page]]` / `[[page\|alias]]` | ✅ ON | `markdown.enableWikilink` |
| 블록 참조 | `((block-id))` | ✅ ON | `markdown.enableBlockRef` |
| 블록 임베드 | `{{embed ((id))}}` | ✅ ON | `markdown.enableEmbed` |
| Mermaid 다이어그램 | `` ```mermaid `` | ✅ ON | `markdown.enableMermaid` |
| 콜아웃 | `> [!type]` | ✅ ON | `markdown.enableCallout` |
| 프롬프트 태그 | `<system>`, `{{var}}` | ✅ ON | `markdown.enablePromptSyntax` |

**Strict Mode**: `markdown.strictMode: true` 설정 시 Layer 3 확장이 전부 비활성화된다. 파일 수준에서도 Frontmatter로 오버라이드 가능하다.

```yaml
---
strict_markdown: true    # 이 파일만 Strict Mode
---
```

### YAML Frontmatter 스키마

모든 `.md` 파일은 선택적으로 YAML Frontmatter를 포함할 수 있다. Frontmatter는 파일 최상단 `---` 구분자로 감싼다.

#### 범용 Frontmatter 필드

```yaml
---
# 기본 메타데이터
title: "문서 제목"                      # string — 파일명 대신 표시할 제목
aliases: [별칭1, 별칭2]                  # string[] — 위키링크 별칭 매칭용
tags: [tag1, tag2]                       # string[] — 태그
created_at: 2026-02-12                   # date — 생성일
updated_at: 2026-02-12                   # date — 수정일 (자동 갱신 옵션)

# Baram 전용
strict_markdown: false                   # boolean — 파일 수준 Strict Mode
privacy: false                           # boolean — AI 전송 차단 (§6.3)
publish: false                           # boolean — 내보내기/공개 대상 여부

# 사용자 정의 필드
status: draft                            # any — 자유 필드
category: research                       # any — 자유 필드
---
```

#### Skills Frontmatter 필드

Skills 폴더(§5.8) 내 파일은 추가 필드를 인식한다.

```yaml
---
# 필수 필드
name: text-analyzer                      # string — 스킬 식별자
description: "텍스트를 분석하여..."        # string — 스킬 설명

# 선택 필드
version: 1.2.0                           # semver — 버전
tags: [analysis, nlp]                    # string[] — 분류 태그
requires:                                # string[] — 의존 스킬 파일 경로
  - skills/base-skill.md
  - skills/utils.md
input_format: text                       # string — 입력 형식
output_format: json                      # string — 출력 형식
model: claude-sonnet-4-5                 # string — 권장 모델
max_tokens: 4096                         # number — 최대 토큰
temperature: 0.7                         # number — 온도 파라미터
status: draft | active | deprecated      # enum — 스킬 상태
author: donghun                          # string — 작성자
---
```

#### Frontmatter 파싱 규칙

1. 파일 첫 줄이 `---`로 시작하면 Frontmatter 시작으로 인식한다.
2. 두 번째 `---`까지가 YAML 블록이다.
3. YAML 파싱에는 `js-yaml` (프론트엔드) 및 `serde_yaml` (Rust 백엔드)을 사용한다.
4. 파싱 실패 시 Frontmatter를 코드 블록으로 폴백 렌더링하고, 상태바에 경고를 표시한다.
5. 직렬화 시 키 순서와 주석은 원본 그대로 보존한다 (`yaml-unist-parser` 활용).

#### Frontmatter 자동 갱신

설정(`editor.autoUpdateFrontmatter: true`)이 활성화되면 파일 저장 시 `updated_at` 필드를 현재 날짜로 자동 갱신한다. `created_at`은 최초 생성 시에만 자동 설정된다.

### 마크다운 직렬화 규칙

ProseMirror 문서를 `.md` 파일로 저장할 때 적용하는 정규화 규칙이다. Part 3(§3.3)의 마크다운 파싱 파이프라인에서 `prosemirror-to-mdast` → `remark-stringify` 단계에 적용된다.

| 규칙 | 설명 | 예시 |
|------|------|------|
| 헤딩 스타일 | ATX 스타일 고정 | `## 제목` (Setext 사용 안 함) |
| 헤딩 뒤 공백 | `#` 뒤 스페이스 1개 | `# Title` |
| 볼드 마커 | `**` 고정 | `__` 사용 안 함 |
| 이탤릭 마커 | `*` 고정 | `_` 사용 안 함 |
| 비순서 리스트 마커 | `-` 고정 | `*`, `+` 사용 안 함 |
| 코드 블록 스타일 | 펜스(`` ``` ``) 고정 | 들여쓰기 방식 사용 안 함 |
| 수평선 | `---` 고정 | `***`, `___` 사용 안 함 |
| 빈 줄 | 블록 요소 사이 빈 줄 1개 | 연속 빈 줄 축소 |
| 후행 공백 | 제거 | 하드 줄바꿈은 `\` 사용 |
| 파일 끝 | 단일 개행(`\n`)으로 종료 | |

이 규칙들은 `settings.markdown.serializationRules`로 일부 커스터마이징할 수 있다. 예를 들어 리스트 마커를 `*`로 변경하거나, 볼드 마커를 `__`로 변경하는 것이 가능하다.

---

## 7.2 에디터 내부 데이터 모델

### ProseMirror Document 스키마

Part 3(§3.3)에서 개략적으로 정의한 스키마를 상세화한다. 이 스키마가 Baram 에디터의 핵심 데이터 구조이며, 모든 편집 작업은 이 스키마를 준수하는 트랜잭션으로만 이루어진다.

#### Document 구조

```
doc                                 ← 최상위 노드 (1개)
├── frontmatter?                    ← 0 또는 1개, 반드시 첫 자식
└── (block_content)+                ← 1개 이상의 블록 노드
```

#### Node 타입 정의

**블록 노드 (Block Nodes)**:

```typescript
// ─── 기본 블록 ───

paragraph: {
  content: "inline*"                 // 인라인 노드 0개 이상
  group: "block"
  marks: "_"                         // 모든 마크 허용
}

heading: {
  content: "inline*"
  group: "block"
  attrs: {
    level: { default: 1 }            // 1~6
    id: { default: null }            // 자동 생성 앵커 ID (slug)
  }
}

// ─── 코드/수식/다이어그램 ───

code_block: {
  content: "text*"                   // 순수 텍스트만 (마크 불가)
  group: "block"
  marks: ""                          // 마크 불가
  code: true                         // 코드 모드
  attrs: {
    language: { default: null }      // "javascript", "python", ...
    lineNumbers: { default: false }
  }
}

math_block: {
  content: "text*"
  group: "block"
  marks: ""
  code: true
  attrs: {
    formula: { default: "" }         // KaTeX 수식 문자열
  }
}

mermaid_block: {
  content: "text*"
  group: "block"
  marks: ""
  code: true
  attrs: {
    code: { default: "" }            // Mermaid 소스
  }
}

// ─── 리스트 ───

bullet_list: {
  content: "list_item+"
  group: "block"
}

ordered_list: {
  content: "list_item+"
  group: "block"
  attrs: {
    start: { default: 1 }           // 시작 번호
  }
}

task_list: {
  content: "task_item+"
  group: "block"
}

list_item: {
  content: "paragraph block*"        // 첫 자식 paragraph 필수, 이후 중첩 블록 가능
  group: "list_content"
}

task_item: {
  content: "paragraph block*"
  group: "list_content"
  attrs: {
    checked: { default: false }
  }
}

// ─── 테이블 ───

table: {
  content: "table_row+"
  group: "block"
  attrs: {
    colWidths: { default: null }     // number[] | null (자동)
  }
}

table_row: {
  content: "(table_cell | table_header)+"
}

table_cell: {
  content: "paragraph+"              // 셀 내부는 paragraph만 허용
  attrs: {
    colspan: { default: 1 }
    rowspan: { default: 1 }
    alignment: { default: null }     // "left" | "center" | "right" | null
  }
}

table_header: {
  content: "paragraph+"
  attrs: {
    colspan: { default: 1 }
    rowspan: { default: 1 }
    alignment: { default: null }
  }
}

// ─── 컨테이너 블록 ───

blockquote: {
  content: "block+"
  group: "block"
}

callout: {
  content: "paragraph block*"        // 첫 paragraph = 제목 줄
  group: "block"
  attrs: {
    type: { default: "info" }        // "info"|"warning"|"tip"|"danger"|"note"|"abstract"
    title: { default: "" }
    collapsed: { default: false }
  }
}

toggle: {
  content: "paragraph block*"        // 첫 paragraph = 토글 제목
  group: "block"
  attrs: {
    open: { default: true }
  }
}

// ─── 특수 블록 ───

frontmatter: {
  content: "text*"
  group: "block"
  marks: ""
  code: true
  attrs: {
    yaml: { default: "" }           // 파싱된 YAML 문자열
  }
}

image: {
  group: "block"
  inline: false
  attrs: {
    src: {}                          // 필수
    alt: { default: null }
    title: { default: null }
    width: { default: null }         // 리사이즈된 너비
    alignment: { default: "center" } // "left"|"center"|"right"
    caption: { default: null }       // 캡션 텍스트
  }
}

horizontal_rule: {
  group: "block"
}

query_block: {
  group: "block"
  attrs: {
    query: { default: "" }           // 쿼리 DSL 문자열
    display: { default: "list" }     // "list"|"table"|"card"
    sort: { default: null }
    limit: { default: 20 }
  }
}
```

**인라인 노드 (Inline Nodes)**:

```typescript
text: {
  group: "inline"
  // 텍스트 노드는 marks를 가질 수 있음
}

math_inline: {
  group: "inline"
  inline: true
  atom: true                         // 커서가 내부로 진입하지 않음
  attrs: {
    formula: { default: "" }         // KaTeX 수식
  }
}

wikilink: {
  group: "inline"
  inline: true
  atom: true
  attrs: {
    target: {}                       // 대상 파일 경로/이름
    alias: { default: null }         // 표시 텍스트 (|alias)
  }
}

block_reference: {
  group: "inline"
  inline: true
  atom: true
  attrs: {
    blockId: {}                      // 참조 블록 ID
    embedMode: { default: false }    // true면 임베드 렌더링
  }
}

mention: {
  group: "inline"
  inline: true
  atom: true
  attrs: {
    type: {}                         // "date" | "page" | "user"
    value: {}                        // 실제 값
  }
}

hard_break: {
  group: "inline"
  inline: true
}

footnote_ref: {
  group: "inline"
  inline: true
  atom: true
  attrs: {
    id: {}                           // 각주 식별자
  }
}
```

#### Mark 타입 정의

```typescript
// ─── 표준 마크 ───

bold: {
  parseDOM: [{ tag: "strong" }, { style: "font-weight=bold" }]
  // 구문: **text**
}

italic: {
  parseDOM: [{ tag: "em" }, { style: "font-style=italic" }]
  // 구문: *text*
}

code: {
  parseDOM: [{ tag: "code" }]
  excludes: "_"                      // 다른 모든 마크와 배타적
  // 구문: `text`
}

strike: {
  parseDOM: [{ tag: "del" }, { tag: "s" }]
  // 구문: ~~text~~
}

underline: {
  parseDOM: [{ tag: "u" }, { style: "text-decoration=underline" }]
  // 단축키 전용 (Cmd+U), 마크다운 구문 없음
}

link: {
  attrs: {
    href: {}
    title: { default: null }
    target: { default: null }
  }
  inclusive: false                    // 링크 끝에서 타이핑 시 링크 밖으로
  parseDOM: [{ tag: "a[href]" }]
  // 구문: [text](url "title")
}

// ─── 확장 마크 ───

highlight: {
  parseDOM: [{ tag: "mark" }]
  // 구문: ==text==
  // 설정: markdown.enableHighlight
}

superscript: {
  parseDOM: [{ tag: "sup" }]
  excludes: "subscript"              // 위첨자와 아래첨자 동시 불가
  // 구문: X^2^
}

subscript: {
  parseDOM: [{ tag: "sub" }]
  excludes: "superscript"
  // 구문: H~2~O
}

katex_inline: {
  attrs: {
    formula: { default: "" }
  }
  excludes: "_"
  // 구문: $formula$
  // NOTE: 실제 구현에서는 math_inline Node가 우선. Mark는 폴백.
}

// ─── AI 전용 마크 (비영속적) ───

ai_ghost: {
  // Ghost Text용 — 문서에 저장되지 않음
  // ProseMirror Decoration으로 구현, Schema에는 등록하지 않음
}

ai_diff_insert: {
  // AI Diff 삽입 표시 — Decoration
}

ai_diff_delete: {
  // AI Diff 삭제 표시 — Decoration
}
```

AI 관련 시각 마크(Ghost Text, Diff 표시)는 ProseMirror Decoration으로 구현하므로 Schema에 등록하지 않는다. 문서 내용에 영향을 주지 않으며, 저장 시 직렬화되지 않는다.

#### Mark 배타성 규칙

```
code    → 다른 모든 마크와 배타 (excludes: "_")
katex   → 다른 모든 마크와 배타 (excludes: "_")
super   ↔ sub 상호 배타
link    → code와 배타
bold    ↔ italic, strike, highlight, link : 공존 가능
```

### 블록 ID 체계

양방향 링크의 블록 참조(`((block-id))`)를 위한 블록 식별자 체계이다.

#### ID 생성 규칙

```
블록 ID = 접두사 + "-" + 랜덤 문자열
접두사   = 블록 첫 단어 (영문은 소문자, 한글은 그대로, 최대 12자)
랜덤     = nanoid(6) — [a-z0-9] 6자리

예시:
  "설계 원칙을 정리하면..."    → 설계-a3f2c1
  "The architecture..."       → the-b8d4e2
  "## API 설계"               → api-c1a9f3
```

#### ID 부여 시점

블록 ID는 **명시적 요청 시에만** 부여한다. 모든 블록에 자동 부여하면 마크다운이 오염되므로, 다음 경우에만 생성한다.

| 시점 | 트리거 |
|------|--------|
| 블록 참조 생성 시 | `((`를 타이핑하고 대상 블록 선택 → 대상에 ID 부여 |
| 블록 핸들 메뉴 | "블록 ID 복사" 선택 → 해당 블록에 ID 부여 + 클립보드 복사 |
| 커맨드 팔레트 | "Block: Copy Block Reference" → 현재 블록에 ID 부여 |

#### 마크다운 직렬화

블록 ID는 마크다운에서 블록 끝에 `^block-id` 형태로 저장한다 (Obsidian 호환).

```markdown
설계 원칙을 정리하면 다음과 같다. ^설계-a3f2c1

- 리스트 항목에도 ID 부여 가능 ^리스트-d2e4f6

> 인용 블록에도 가능 ^인용-e5f7a8
```

#### ID 안정성 정책

| 상황 | 동작 |
|------|------|
| 블록 텍스트 편집 | ID 유지 (내용 변경으로 ID가 변하지 않음) |
| 블록 이동 (드래그) | ID 유지 |
| 블록 분할 (Enter) | 원본 ID는 분할 후 첫 블록에 유지 |
| 블록 병합 (Backspace) | 병합 결과에 첫 블록의 ID 유지, 두 번째 블록 ID는 고아화 |
| 블록 삭제 | ID도 함께 삭제. 참조하던 곳은 `((unknown-id))` 표시 |
| 파일 이름 변경 | ID 자체는 변경 없음 (파일 내부 식별자) |

#### 고아 ID 처리

참조 대상 블록이 삭제되어 `((block-id))`가 깨진 경우, 에디터에서 경고 스타일(빨간 밑줄 + 취소선)로 표시한다. 호버 시 "참조 대상을 찾을 수 없습니다" 툴팁을 표시하고, 클릭 시 "참조 제거" 또는 "새 대상 선택" 옵션을 제공한다.

### 헤딩 앵커 ID

헤딩에는 블록 ID와 별도로 앵커 ID(`heading.attrs.id`)가 자동 생성된다. URL 프래그먼트(`#section-name`) 및 내보내기 시 링크 타겟으로 사용한다.

```
생성 규칙:
  "## API 설계"         → id: "api-설계"
  "### 3.1 시스템 구조"  → id: "31-시스템-구조"
  "## Hello World"      → id: "hello-world"

규칙:
  1. 텍스트를 소문자로 변환 (영문만)
  2. 특수문자 제거 (마침표, 괄호 등)
  3. 공백 → 하이픈
  4. 중복 시 접미사 추가: "api-설계", "api-설계-1", "api-설계-2"
```

---

## 7.3 앱 설정 파일 구조

### 설정 파일 위치

Baram의 설정은 **글로벌 설정**과 **Vault별 설정** 두 계층으로 구분된다.

```
[글로벌 설정 — 앱 전체에 적용]

  macOS:    ~/Library/Application Support/com.baram.app/
  Windows:  %APPDATA%\com.baram.app\
  Linux:    ~/.config/com.baram.app/

  ├── global-settings.json           ← 글로벌 설정
  ├── recent-vaults.json             ← 최근 열었던 Vault 목록
  ├── window-state.json              ← 창 크기, 위치
  └── themes/                        ← 사용자 설치 테마
      ├── custom-dark.css
      └── academic.css
```

```
[Vault별 설정 — 해당 Vault에만 적용]

  my-vault/
  └── .baram/
      ├── config.json                ← Vault별 설정 (글로벌 오버라이드)
      ├── workspace.json             ← UI 상태 스냅샷 (열린 탭, 사이드바 등)
      ├── keybindings.json           ← 커스텀 단축키 (선택적)
      ├── snippets.json              ← 사용자 스니펫 (선택적)
      ├── link-index.db              ← 링크 인덱스 (§7.4)
      ├── search-index/              ← 전문 검색 인덱스 (§7.4)
      ├── snapshots/                 ← 자동 스냅샷 (§7.5)
      ├── chat-history/              ← AI 대화 히스토리 (§6.2)
      └── embeddings/                ← 벡터 임베딩 (§6.2)
```

**우선순위**: Vault별 설정(`config.json`) > 글로벌 설정(`global-settings.json`) > 기본값. Vault별 `config.json`은 글로벌과 동일한 스키마이며, 값이 있는 필드만 오버라이드한다.

### 글로벌 설정 스키마 (global-settings.json)

Part 3(§3.5)의 `settingsStore` TypeScript 인터페이스를 JSON 스키마로 확장한다.

```jsonc
{
  // ─── 외관 ───
  "appearance": {
    "theme": "system",               // "light" | "dark" | "system"
    "customThemePath": null,         // string | null
    "fontSize": 16,                  // 12~24
    "fontFamily": "system",          // "system" | "mono" | 커스텀 폰트명
    "editorMaxWidth": 800,           // px, 0 = 무제한
    "lineHeight": 1.6,              // 1.0~3.0
    "showLineNumbers": false,        // 에디터 줄번호
    "highlightCurrentLine": true
  },

  // ─── 에디터 ───
  "editor": {
    "indentSize": 2,                 // 2 | 4 | 8
    "indentType": "spaces",          // "spaces" | "tabs"
    "lineEnding": "lf",             // "lf" | "crlf" | "auto"
    "autoPairBrackets": true,
    "autoPairMarkdown": true,        // **|**, *|* 자동 쌍
    "spellCheck": false,
    "autoSaveDelay": 2000,           // ms, 0 = 비활성
    "autoUpdateFrontmatter": false,  // updated_at 자동 갱신
    "defaultNewFileLocation": "root", // "root" | "current" | "daily"
    "dailyNotesFolder": "daily",     // 데일리 노트 폴더명
    "skillsFolder": "skills"         // Skills 폴더명
  },

  // ─── 마크다운 ───
  "markdown": {
    "strictMode": false,             // true면 확장 구문 전부 비활성
    "enableInlineMath": true,
    "enableBlockMath": true,
    "enableHighlight": false,
    "enableSuperscript": false,
    "enableSubscript": false,
    "enableWikilink": true,
    "enableBlockRef": true,
    "enableEmbed": true,
    "enableMermaid": true,
    "enableCallout": true,
    "enablePromptSyntax": true,
    "strictHeadingSpace": true,      // # 뒤 스페이스 필수
    "serializationRules": {
      "bulletListMarker": "-",       // "-" | "*" | "+"
      "boldMarker": "**",           // "**" | "__"
      "italicMarker": "*",          // "*" | "_"
      "hardBreakStyle": "\\"         // "\\" | "  " (후행 공백)
    }
  },

  // ─── AI ───
  "ai": {
    "provider": null,                // "claude" | "openai" | "gemini" | "ollama" | null
    "model": "claude-sonnet-4-5",
    "apiKey": "keychain:baram-claude-api-key",  // Keychain 참조만 저장
    "ghostText": {
      "enabled": false,
      "debounceMs": 500,
      "maxLength": 100,
      "enableInCode": true,
      "enableInMath": true
    },
    "autoModelSelection": false,     // 작업별 자동 모델 선택
    "privacyMode": false,            // 전역 Privacy Mode
    "ollama": {
      "url": "http://localhost:11434",
      "model": "llama3.2"
    }
  },

  // ─── 이미지 ───
  "image": {
    "insertPolicy": "copy-to-assets", // "do-nothing"|"copy-to-current"|"copy-to-assets"|"custom"|"upload"
    "customFolder": "./assets",
    "uploader": null,                // "picgo" | "custom" | null
    "uploaderCommand": ""
  },

  // ─── 내보내기 ───
  "export": {
    "pdfMargins": { "top": 20, "right": 20, "bottom": 20, "left": 20 },
    "pdfPageSize": "A4",
    "pandocPath": "pandoc",          // Pandoc 실행 경로
    "defaultFormat": "pdf"
  },

  // ─── Git ───
  "git": {
    "autoFetchInterval": 5,          // 분, 0 = 비활성
    "autoPull": false,
    "autoPushOnCommit": false,
    "commitAuthor": "",              // "이름 <이메일>"
    "defaultDiffView": "side-by-side", // "side-by-side" | "unified"
    "ignoreWhitespace": true
  },

  // ─── 스냅샷 ───
  "snapshot": {
    "interval": 30,                  // 분, 0 = 비활성
    "maxCount": 50,                  // 최대 보관 개수
    "includeUnmodified": false       // 변경 없는 파일 포함 여부
  },

  // ─── Extension ───
  "extensions": {
    "enabled": [                     // 활성화된 Extension ID 목록
      "core-paragraph", "core-heading", "core-list",
      "core-code-block", "core-table", "core-image",
      "core-math", "core-frontmatter",
      "ext-wikilink", "ext-block-ref", "ext-callout",
      "ext-mermaid", "ext-skills"
    ],
    "disabled": [],                  // 명시적 비활성 (기본 ON 확장을 끌 때)
    "config": {}                     // Extension별 설정 { "ext-id": { ... } }
  }
}
```

### Workspace 상태 파일 (workspace.json)

앱 종료 시 현재 UI 상태를 저장하고, 다음 실행 시 복원한다.

```jsonc
{
  "version": 1,

  // 열린 탭
  "openTabs": [
    {
      "id": "tab-a3f2c1",
      "path": "docs/README.md",
      "scrollPosition": 342,         // 스크롤 위치 (px)
      "cursorPosition": {            // 커서 위치
        "line": 42,
        "column": 15
      },
      "pinned": false
    },
    {
      "id": "tab-b8d4e2",
      "path": "skills/analyzer.md",
      "scrollPosition": 0,
      "cursorPosition": { "line": 1, "column": 0 },
      "pinned": true
    }
  ],
  "activeTabId": "tab-a3f2c1",

  // 레이아웃
  "sidebar": {
    "open": true,
    "mode": "file-tree",             // "file-tree"|"outline"|"search"|"backlinks"|"git"
    "width": 260
  },
  "rightPanel": {
    "open": false,
    "mode": null,                    // "ai-chat"|"backlinks"|"properties"
    "width": 320
  },

  // 편집 모드
  "sourceMode": false,
  "zenMode": false,
  "focusMode": false,
  "typewriterMode": false,

  // Workspace 프리셋
  "activePreset": "글쓰기",          // null이면 커스텀 상태

  // 파일 트리 상태
  "expandedFolders": [
    "docs",
    "skills",
    "daily"
  ],

  // 검색 상태
  "lastSearch": {
    "query": "",
    "scope": "vault",
    "caseSensitive": false,
    "regex": false
  }
}
```

### Workspace 프리셋 구조

Part 4(§4.7)에서 정의한 3가지 Workspace 프리셋의 저장 형태이다. 커스텀 프리셋도 동일 구조로 저장한다.

```jsonc
// .baram/presets.json
{
  "presets": [
    {
      "name": "글쓰기",
      "shortcut": "Ctrl+Alt+1",
      "icon": "✍️",
      "layout": {
        "sidebar": { "open": true, "mode": "outline", "width": 240 },
        "rightPanel": { "open": false },
        "focusMode": false,
        "typewriterMode": true,
        "zenMode": false
      },
      "editorOverrides": {
        "editorMaxWidth": 700,
        "fontSize": 18
      }
    },
    {
      "name": "Skills",
      "shortcut": "Ctrl+Alt+2",
      "icon": "🤖",
      "layout": {
        "sidebar": { "open": true, "mode": "file-tree", "width": 280 },
        "rightPanel": { "open": true, "mode": "ai-chat", "width": 360 },
        "focusMode": false,
        "typewriterMode": false,
        "zenMode": false
      },
      "editorOverrides": {}
    },
    {
      "name": "리서치",
      "shortcut": "Ctrl+Alt+3",
      "icon": "🔬",
      "layout": {
        "sidebar": { "open": true, "mode": "backlinks", "width": 300 },
        "rightPanel": { "open": true, "mode": "backlinks", "width": 300 },
        "focusMode": false,
        "typewriterMode": false,
        "zenMode": false
      },
      "editorOverrides": {}
    }
  ]
}
```

### 테마 파일 구조

테마는 CSS Variables를 정의하는 단일 CSS 파일이다. Typora와 동일한 접근이다.

```css
/* example-theme.css */

/* ─── 메타데이터 (주석으로 선언) ─── */
/* @theme-name: Baram Night */
/* @theme-author: donghun */
/* @theme-version: 1.0.0 */
/* @theme-mode: dark */

/* ─── 색상 토큰 ─── */
:root {
  /* 배경 */
  --bg-primary: #1a1b26;
  --bg-secondary: #24283b;
  --bg-tertiary: #292e42;
  --bg-hover: #33384d;
  --bg-active: #3d4260;

  /* 텍스트 */
  --text-primary: #c0caf5;
  --text-secondary: #9aa5ce;
  --text-muted: #565f89;
  --text-accent: #7aa2f7;

  /* 에디터 */
  --editor-bg: var(--bg-primary);
  --editor-text: var(--text-primary);
  --editor-heading: #e0af68;
  --editor-link: var(--text-accent);
  --editor-code-bg: var(--bg-secondary);
  --editor-selection: rgba(122, 162, 247, 0.3);
  --editor-current-line: rgba(255, 255, 255, 0.04);

  /* 구문 하이라이팅 */
  --syntax-keyword: #bb9af7;
  --syntax-string: #9ece6a;
  --syntax-number: #ff9e64;
  --syntax-comment: var(--text-muted);
  --syntax-function: #7aa2f7;

  /* 수식 */
  --math-text: #7dcfff;
  --math-bg: rgba(125, 207, 255, 0.08);

  /* AI */
  --accent-ai: #bb9af7;
  --ai-ghost-text: rgba(187, 154, 247, 0.4);
  --ai-diff-insert: rgba(158, 206, 106, 0.2);
  --ai-diff-delete: rgba(247, 118, 142, 0.2);

  /* Skills 프롬프트 */
  --syntax-prompt-tag: #7aa2f7;
  --syntax-prompt-var: var(--accent-ai);

  /* 사이드바 */
  --sidebar-bg: var(--bg-secondary);
  --sidebar-text: var(--text-secondary);
  --sidebar-active: var(--bg-active);

  /* 상태바 */
  --statusbar-bg: var(--bg-tertiary);
  --statusbar-text: var(--text-muted);

  /* 보더 */
  --border-color: rgba(255, 255, 255, 0.08);
  --border-radius: 6px;

  /* 타이포그래피 */
  --font-body: 'Pretendard', -apple-system, sans-serif;
  --font-mono: 'JetBrains Mono', 'Fira Code', monospace;
  --font-heading: var(--font-body);
}
```

테마에서 정의하지 않은 변수는 Baram 기본 테마의 값을 상속한다. 사용자는 `global-settings-dir/themes/` 에 CSS 파일을 추가하면 설정 UI의 테마 목록에 자동으로 나타난다.

### 단축키 설정 파일 (keybindings.json)

```jsonc
// .baram/keybindings.json (Vault별) 또는 글로벌
{
  "version": 1,
  "bindings": [
    {
      "command": "editor.toggleBold",
      "key": "Cmd+B",                // macOS 표기
      "winKey": "Ctrl+B",            // Windows/Linux 표기
      "when": "editorFocused"        // 컨텍스트 조건
    },
    {
      "command": "editor.insertMathInline",
      "key": "Shift+Cmd+M",
      "winKey": "Ctrl+Shift+M",
      "when": "editorFocused"
    },
    {
      "command": "ai.inlineEdit",
      "key": "Cmd+K",
      "winKey": "Ctrl+K",
      "when": "editorFocused && editorHasSelection"
    }
    // ...
  ]
}
```

`when` 조건은 VS Code의 When Clause와 유사한 간단한 표현식을 지원한다.

| 조건 | 의미 |
|------|------|
| `editorFocused` | 에디터에 포커스가 있을 때 |
| `editorHasSelection` | 텍스트가 선택되어 있을 때 |
| `sidebarFocused` | 사이드바에 포커스가 있을 때 |
| `inCodeBlock` | 커서가 코드 블록 안에 있을 때 |
| `inMathBlock` | 커서가 수식 블록 안에 있을 때 |
| `inTable` | 커서가 테이블 안에 있을 때 |
| `sourceMode` | 소스 코드 모드일 때 |

---

## 7.4 링크 인덱스 / 메타데이터 캐시

Part 3(§3.6)에서 정의한 링크 인덱스의 상세 스키마와 운영 정책을 정의한다.

### 저장소 기술

| 용도 | 기술 | 파일 위치 |
|------|------|-----------|
| 링크 그래프 + 메타데이터 | SQLite (rusqlite) | `.baram/link-index.db` |
| 전문 검색 | tantivy | `.baram/search-index/` |
| 벡터 임베딩 | usearch 또는 hnswlib | `.baram/embeddings/` |

모두 `.baram/` 하위에 저장되므로 `.gitignore`에 포함하면 Git 추적에서 제외된다. 삭제해도 Vault를 다시 열면 자동으로 재구축된다.

### SQLite 스키마 (link-index.db)

```sql
-- ─── 파일 메타데이터 ───

CREATE TABLE files (
  path          TEXT PRIMARY KEY,       -- Vault 상대 경로
  title         TEXT,                   -- frontmatter title 또는 첫 H1
  checksum      TEXT NOT NULL,          -- SHA-256 (변경 감지용)
  modified_at   INTEGER NOT NULL,       -- Unix timestamp (ms)
  size_bytes    INTEGER NOT NULL,
  word_count    INTEGER DEFAULT 0,
  frontmatter   TEXT,                   -- JSON 문자열 (파싱된 YAML)
  has_block_ids BOOLEAN DEFAULT 0       -- 블록 ID 포함 여부
);

-- ─── 링크 관계 ───

CREATE TABLE links (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  source_path   TEXT NOT NULL,          -- 링크를 포함한 파일
  target_path   TEXT NOT NULL,          -- 링크 대상 파일
  target_raw    TEXT NOT NULL,          -- 원본 링크 텍스트 ([[원본]])
  line_number   INTEGER NOT NULL,
  column_start  INTEGER,
  column_end    INTEGER,
  context       TEXT,                   -- 링크 주변 텍스트 (전후 50자)
  link_type     TEXT NOT NULL,          -- 'wikilink'|'md_link'|'block_ref'|'embed'
  UNIQUE(source_path, target_path, line_number, link_type)
);

-- ─── 별칭 인덱스 ───

CREATE TABLE aliases (
  path          TEXT NOT NULL,          -- 파일 경로
  alias         TEXT NOT NULL,          -- 별칭 (frontmatter aliases 필드)
  alias_lower   TEXT NOT NULL,          -- 소문자 변환 (검색용)
  PRIMARY KEY (path, alias)
);

-- ─── 블록 ID 인덱스 ───

CREATE TABLE blocks (
  path          TEXT NOT NULL,
  block_id      TEXT NOT NULL,          -- ^block-id
  line_number   INTEGER NOT NULL,
  node_type     TEXT,                   -- "paragraph"|"heading"|"list_item"|...
  content       TEXT,                   -- 블록 텍스트 (검색/미리보기용)
  PRIMARY KEY (path, block_id)
);

-- ─── 태그 인덱스 ───

CREATE TABLE tags (
  path          TEXT NOT NULL,
  tag           TEXT NOT NULL,          -- 태그명 (# 제외)
  source        TEXT NOT NULL,          -- 'frontmatter'|'inline'
  PRIMARY KEY (path, tag, source)
);

-- ─── 헤딩 인덱스 (아웃라인 + 앵커 링크) ───

CREATE TABLE headings (
  path          TEXT NOT NULL,
  anchor_id     TEXT NOT NULL,          -- 앵커 ID (slug)
  level         INTEGER NOT NULL,       -- 1~6
  text          TEXT NOT NULL,          -- 헤딩 텍스트
  line_number   INTEGER NOT NULL,
  PRIMARY KEY (path, anchor_id)
);

-- ─── 성능 인덱스 ───

CREATE INDEX idx_links_source ON links(source_path);
CREATE INDEX idx_links_target ON links(target_path);
CREATE INDEX idx_links_type ON links(link_type);
CREATE INDEX idx_aliases_lower ON aliases(alias_lower);
CREATE INDEX idx_blocks_id ON blocks(block_id);
CREATE INDEX idx_tags_tag ON tags(tag);
CREATE INDEX idx_headings_text ON headings(text);
CREATE INDEX idx_files_modified ON files(modified_at);
```

### 쿼리 패턴

주요 기능별 SQL 쿼리 패턴이다.

```sql
-- 백링크 조회 (§5.6)
SELECT l.source_path, l.line_number, l.context, f.title
FROM links l
JOIN files f ON l.source_path = f.path
WHERE l.target_path = ?
ORDER BY f.modified_at DESC;

-- 위키링크 자동완성 (§5.6): 파일명 + 별칭 통합 검색
SELECT path, title, NULL as alias FROM files
WHERE title LIKE ? || '%'
UNION
SELECT a.path, f.title, a.alias FROM aliases a
JOIN files f ON a.path = f.path
WHERE a.alias_lower LIKE lower(?) || '%'
ORDER BY title
LIMIT 20;

-- 블록 참조 조회
SELECT b.path, b.content, b.node_type, f.title
FROM blocks b
JOIN files f ON b.path = f.path
WHERE b.block_id = ?;

-- 쿼리 블록: 태그 필터 (§5.13)
SELECT f.path, f.title, f.frontmatter, f.modified_at
FROM files f
JOIN tags t ON f.path = t.path
WHERE t.tag = ?
ORDER BY f.modified_at DESC
LIMIT ?;

-- 언링크드 멘션 (§5.6)
-- Rust 측에서 파일 제목 목록을 메모리에 로드 후,
-- 각 파일의 텍스트에서 제목 문자열 검색 (links 테이블에 없는 것만)
```

### 전문 검색 인덱스 (tantivy)

tantivy 스키마는 다음 필드를 인덱싱한다.

| 필드 | 타입 | 인덱싱 | 용도 |
|------|------|--------|------|
| `path` | TEXT (stored) | 정확 | 결과에서 파일 식별 |
| `title` | TEXT (stored, indexed) | 토큰화 | 제목 검색 |
| `body` | TEXT (indexed) | 토큰화 | 본문 전문 검색 |
| `headings` | TEXT (indexed) | 토큰화 | 헤딩 텍스트 검색 |
| `tags` | TEXT (stored, indexed) | 키워드 | 태그 필터 |
| `modified_at` | U64 (stored, indexed) | 범위 | 날짜 정렬/필터 |

**토크나이저**: `tantivy::tokenizer::NgramTokenizer`(2-gram, 한글 지원) + `SimpleTokenizer`(영문 공백 기반)을 결합한 하이브리드 토크나이저. 한글은 자소 분해 없이 2-gram으로 처리하여 부분 일치 검색을 지원한다.

**인덱스 크기 추정**: 1,000개 파일(파일당 평균 1,000단어) 기준 약 5~10MB. 10,000개 파일에서도 100MB 이내.

### 벡터 임베딩 인덱스 (embeddings/)

Part 6(§6.2, Level 5)의 Knowledge Q&A를 위한 벡터 인덱스이다.

```
.baram/embeddings/
├── index.usearch                    ← 벡터 인덱스 파일 (usearch)
├── chunks.db                        ← 청크 메타데이터 (SQLite)
└── meta.json                        ← 인덱스 메타정보
```

```sql
-- chunks.db 스키마
CREATE TABLE chunks (
  id            INTEGER PRIMARY KEY,
  path          TEXT NOT NULL,
  heading       TEXT,                   -- 소속 헤딩 (컨텍스트)
  content       TEXT NOT NULL,          -- 청크 텍스트
  start_line    INTEGER,
  end_line      INTEGER,
  token_count   INTEGER,                -- 토큰 수 (추정)
  checksum      TEXT NOT NULL           -- 변경 감지용
);

CREATE TABLE meta (
  key           TEXT PRIMARY KEY,
  value         TEXT
);
-- key: "model", "dimension", "last_full_build", "total_chunks"
```

```jsonc
// meta.json
{
  "model": "text-embedding-3-small",  // 임베딩 모델
  "dimension": 1536,                  // 벡터 차원
  "lastFullBuild": "2026-02-12T10:00:00Z",
  "totalChunks": 2450,
  "totalFiles": 312,
  "indexSizeBytes": 15728640           // ~15MB
}
```

**청킹 전략**: 헤딩 기반 분할. 각 헤딩 섹션을 하나의 청크로 취급한다. 헤딩이 없는 긴 문단은 500토큰 단위로 분할하며, 50토큰 오버랩을 둔다.

**임베딩 크기 제한**: 설정(`ai.embeddingMaxStorageMB`, 기본 200MB)으로 최대 저장 용량을 제한한다. 초과 시 오래된 미사용 청크부터 삭제한다.

### 캐시 갱신 전략

모든 인덱스는 동일한 갱신 전략을 따른다.

```
[갱신 흐름]

  File Watcher (Rust)
       │
       ▼
  변경 감지 (create/modify/delete/rename)
       │
       ├── checksum 비교 → 실제 변경 확인
       │   (불필요한 갱신 방지: 저장 시 내용 미변경인 경우)
       │
       ▼
  증분 갱신 (해당 파일만)
       │
       ├── link-index.db: DELETE WHERE path = ? → 재삽입
       ├── search-index: tantivy delete + add
       └── embeddings: 해당 파일 청크만 재임베딩
```

| 시점 | 범위 | 방식 | 소요 시간 (1,000 파일 기준) |
|------|------|------|--------------------------|
| Vault 최초 열기 | 전체 | Full rebuild (백그라운드) | 5~15초 (검색), 수분 (임베딩) |
| 파일 저장 | 해당 파일 | Incremental | < 50ms (검색), 1~2초 (임베딩) |
| 파일 삭제/이동 | 해당 파일 + 관련 링크 | Incremental | < 100ms |
| 파일 이름 변경 | 해당 파일 + 이 파일을 참조하는 파일들 | Incremental | < 200ms |
| 외부 변경 (Git pull 등) | 변경된 파일들 | Batch incremental | 파일 수 × 50ms |

**무결성 검증**: 앱 시작 시 `files` 테이블의 `checksum`과 실제 파일을 비교하여, 불일치하는 파일만 재인덱싱한다. 인덱스 파일이 손상되었으면 전체 재구축을 트리거한다.

**잠금**: SQLite는 WAL 모드로 운영하여 읽기/쓰기 동시 접근을 허용한다. 검색 인덱스(tantivy)는 단일 writer + 다중 reader 모델이다.

---

## 7.5 스냅샷 / 버전 관리 데이터

### 로컬 스냅샷 저장 구조

스냅샷은 Git과 독립적인 Baram 내장 버전 관리이다. Git을 사용하지 않는 사용자도 파일 복원이 가능하다.

```
.baram/snapshots/
├── index.json                       ← 스냅샷 인덱스
└── data/
    ├── 2026-02-12T10-00-00/
    │   ├── docs/README.md           ← 변경된 파일만 저장
    │   └── skills/analyzer.md
    ├── 2026-02-12T10-30-00/
    │   └── docs/README.md
    └── 2026-02-12T11-00-00/
        ├── docs/README.md
        └── docs/guide.md
```

```jsonc
// index.json
{
  "version": 1,
  "snapshots": [
    {
      "id": "snap-a3f2c1d4",
      "timestamp": "2026-02-12T10:00:00Z",
      "type": "auto",                // "auto" | "manual"
      "label": null,                 // 수동 스냅샷의 사용자 라벨
      "files": [
        {
          "path": "docs/README.md",
          "checksum": "sha256:abc123...",
          "sizeBytes": 4520
        },
        {
          "path": "skills/analyzer.md",
          "checksum": "sha256:def456...",
          "sizeBytes": 2130
        }
      ],
      "totalSizeBytes": 6650
    }
    // ...
  ],
  "totalSizeBytes": 524288,          // 전체 스냅샷 용량
  "oldestSnapshot": "2026-02-10T08:00:00Z",
  "newestSnapshot": "2026-02-12T11:00:00Z"
}
```

### 스냅샷 생성 정책

| 트리거 | 조건 | 타입 |
|--------|------|------|
| 주기적 자동 | `snapshot.interval` 분마다 (기본 30분) | `auto` |
| 파일 저장 시 | 마지막 스냅샷 이후 설정 시간 경과 | `auto` |
| 수동 생성 | 커맨드 팔레트 "Snapshot: Create" | `manual` |
| 위험 작업 전 | 전체 바꾸기, Agent Mode 실행 전 | `auto` (자동 트리거) |

**저장 범위**: 마지막 스냅샷 대비 `checksum`이 변경된 파일만 저장한다. 변경되지 않은 파일은 이전 스냅샷의 데이터를 참조한다 (복원 시 가장 최근 스냅샷에서 해당 파일을 찾음).

### Diff 알고리즘

스냅샷 간 비교와 복원 미리보기에 사용하는 diff 알고리즘이다.

**텍스트 diff**: `similar` crate (Rust) — Myers diff 알고리즘 기반. 줄 단위 diff를 기본으로 하되, 변경된 줄 내부는 단어 단위 인라인 diff를 추가 수행한다.

```
[Diff 출력 구조]

  DiffResult {
    hunks: [
      {
        oldStart: 10,
        oldCount: 3,
        newStart: 10,
        newCount: 5,
        changes: [
          { type: "equal",  content: "변경 없는 줄" },
          { type: "delete", content: "삭제된 줄", inlineDiff: [...] },
          { type: "insert", content: "추가된 줄", inlineDiff: [...] },
          { type: "equal",  content: "변경 없는 줄" }
        ]
      }
    ],
    stats: {
      additions: 5,
      deletions: 3,
      unchanged: 42
    }
  }
```

**인라인 diff**: 변경된 줄 내부에서 단어/문자 수준 차이를 표시한다. Part 6(§6.2)의 AI Diff Engine과 동일한 시각적 스타일(초록 삽입, 빨간 삭제)을 적용한다.

### 보관 정책

```
[보관 정책 — 계층적 축소]

  최근 24시간:   모든 스냅샷 보관
  1~7일:        시간당 최대 1개로 축소
  7~30일:       일당 최대 1개로 축소
  30일 초과:     주당 최대 1개로 축소
  
  전체 개수 제한: snapshot.maxCount (기본 50개)
  전체 용량 제한: snapshot.maxSizeMB (기본 500MB)
```

축소 시 수동 스냅샷(`manual`)은 자동 스냅샷(`auto`)보다 우선 보관한다. 사용자 라벨이 있는 스냅샷은 자동 삭제하지 않는다.

**정리 시점**: 새 스냅샷 생성 시마다 보관 정책을 확인하고, 초과분을 삭제한다. 삭제는 백그라운드에서 수행하여 편집에 영향을 주지 않는다.

### 스냅샷 복원 흐름

```
[복원 흐름]

  커맨드: "Snapshot: Browse History"
       │
       ▼
  ┌──────────────────────────────────────┐
  │  스냅샷 히스토리                        │
  │  ──────────────────────────────────  │
  │                                      │
  │  ● 2026-02-12 11:00 (자동)    3 파일  │  ← 클릭
  │  ● 2026-02-12 10:30 (자동)    1 파일  │
  │  ★ 2026-02-12 10:00 (수동)    2 파일  │  ← 라벨: "리팩토링 전"
  │  ● 2026-02-12 09:00 (자동)    4 파일  │
  │                                      │
  └──────────────────────────────────────┘
       │
       ▼ (스냅샷 선택)
  ┌──────────────────────────────────────┐
  │  변경 파일 목록                        │
  │  ──────────────────────────────────  │
  │  ☑ docs/README.md       +12 -3      │  ← 체크박스로 부분 복원
  │  ☑ skills/analyzer.md   +5  -8      │
  │                                      │
  │  [diff 보기]  [선택 파일 복원]  [전체 복원]│
  └──────────────────────────────────────┘
       │
       ▼ (diff 보기)
  Side-by-side diff 뷰 (§5.15와 동일 UI)
       │
       ▼ (복원 결정)
  현재 상태를 자동 스냅샷으로 저장 → 선택 파일 덮어쓰기
```

복원 전에 현재 상태를 자동 스냅샷으로 저장하므로, 복원 자체도 되돌릴 수 있다.

### Git 통합과의 관계

스냅샷과 Git(§5.15)은 독립적으로 동작한다.

| 관점 | 스냅샷 | Git |
|------|--------|-----|
| 목적 | 자동 백업, 빠른 복원 | 의도적 버전 기록, 협업 |
| 단위 | 파일 변경분 | 커밋 (의미 단위) |
| 대상 | Vault 내 모든 `.md` 파일 | Git이 추적하는 모든 파일 |
| 저장 위치 | `.baram/snapshots/` | `.git/` |
| 용량 관리 | 자동 축소/삭제 정책 | Git GC |
| 사용자 개입 | 불필요 (자동 동작) | 커밋 메시지 작성 등 필요 |

두 시스템이 공존하므로, Git 사용자는 스냅샷을 비활성화(`snapshot.interval: 0`)할 수 있다.

---

*Part 7 끝. 다음: Part 8. 개발 로드맵 및 일정*
