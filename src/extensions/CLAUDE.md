# Tiptap Extensions — Baram

## 이 디렉토리의 역할

Baram의 모든 에디터 기능은 Tiptap Extension으로 구현된다 (Extension-First 아키텍처, §3.4).
Node, Mark, Plugin 3가지 유형이 있으며, 각각 별도 하위 디렉토리에 위치한다.

## Extension 생성 규칙

### 필수 산출물 (Extension 1개당 4개 파일)
1. **Extension 파일**: `{type}s/{name}.ts` — Tiptap Extension 정의
2. **NodeView** (필요시): `{type}s/{name}-view.tsx` — React NodeView 컴포넌트
3. **변환기**: `../pipeline/transformers/{name}-transformer.ts` — mdast ↔ ProseMirror 양방향
4. **테스트**: `__tests__/{name}.test.ts` — 라운드트립 + 기능 테스트

### Extension 작성 패턴

```typescript
// Node Extension 예시
import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'

export const MathBlock = Node.create({
  name: 'mathBlock',
  group: 'block',
  content: 'text*',
  marks: '',
  atom: true,              // 원자적 노드 (내부 커서 불가)
  
  addAttributes() {
    return {
      latex: { default: '' },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="math-block"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'math-block' }), 0]
  },

  addInputRules() {
    // $$ 입력 시 수식 블록 생성
    return [...]
  },

  addKeyboardShortcuts() {
    return {
      'Mod-Shift-m': () => this.editor.commands.insertMathBlock(),
    }
  },

  addNodeView() {
    return ReactNodeViewRenderer(MathBlockView)
  },

  addCommands() {
    return {
      insertMathBlock: () => ({ commands }) => {
        return commands.insertContent({ type: this.name, attrs: { latex: '' } })
      },
    }
  },
})
```

```typescript
// Mark Extension 예시
import { Mark, mergeAttributes } from '@tiptap/core'

export const InlineMath = Mark.create({
  name: 'inlineMath',
  
  addAttributes() {
    return {
      latex: { default: '' },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-type="inline-math"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-type': 'inline-math' }), 0]
  },

  addInputRules() {
    // $...$ 입력 시 인라인 수식
    return [...]
  },
})
```

### 라운드트립 테스트 패턴 (필수)

```typescript
import { createEditor, parseMarkdown, serializeMarkdown } from '../../pipeline'

describe('MathBlock Extension', () => {
  const editor = createEditor([MathBlock])

  // 핵심: 라운드트립 보존
  test.each([
    ['간단한 수식', '$$\nE = mc^2\n$$'],
    ['복잡한 수식', '$$\n\\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}\n$$'],
    ['aligned 환경', '$$\n\\begin{aligned}\nx &= 1 \\\\\ny &= 2\n\\end{aligned}\n$$'],
  ])('라운드트립 보존: %s', (_, input) => {
    const doc = parseMarkdown(input)
    const output = serializeMarkdown(doc)
    expect(output).toBe(input)
  })

  test('InputRule: $$ 입력 시 수식 블록 생성', () => { ... })
  test('키보드 단축키: Cmd+Shift+M', () => { ... })
  test('빈 수식 블록 삭제 시 동작', () => { ... })
})
```

## Node Extension 목록 (Part 3 §3.3)

| Extension | 마크다운 구문 | Phase | Milestone | InputRule |
|-----------|-------------|-------|-----------|-----------|
| heading | `# ~ ######` | 1 | M2 | `# `, `## `, ... |
| paragraph | (기본) | 1 | M2 | — |
| blockquote | `> ` | 1 | M2 | `> ` |
| bulletList | `- `, `* ` | 1 | M2 | `- `, `* ` |
| orderedList | `1. ` | 1 | M2 | `1. ` |
| taskList | `- [ ] `, `- [x] ` | 1 | M2 | `- [ ] ` |
| horizontalRule | `---`, `***` | 1 | M2 | `---` |
| codeBlock | ` ``` ` | 1 | M3 | ` ``` ` |
| mathBlock | `$$...$$` | 1 | M3 | `$$` |
| table | `\| \| \|` | 1 | M3 | — |
| image | `![alt](url)` | 1 | M2 | — |
| callout | `> [!type] title` | 2 | M7 | `> [!` |
| mermaid | ` ```mermaid ` | 2 | M9 | — |

## Mark Extension 목록

| Extension | 마크다운 구문 | Phase | Milestone | InputRule |
|-----------|-------------|-------|-----------|-----------|
| bold | `**text**` | 1 | M2 | `**` |
| italic | `*text*` | 1 | M2 | `*` |
| code | `` `text` `` | 1 | M2 | `` ` `` |
| strike | `~~text~~` | 1 | M2 | `~~` |
| link | `[text](url)` | 1 | M2 | — |
| inlineMath | `$text$` | 1 | M3 | `$` |
| highlight | `==text==` | 2 | M9 | `==` |
| wikilink | `[[page]]` | 2 | M7 | `[[` |
| subscript | `~text~` | 2 | M9 | — |
| superscript | `^text^` | 2 | M9 | — |

## registry.json 유지 규칙

Extension을 추가/수정할 때 반드시 `registry.json`도 함께 업데이트할 것.
이 레지스트리는 다른 스킬(`/milestone`, `/spec-check`)이 참조한다.
