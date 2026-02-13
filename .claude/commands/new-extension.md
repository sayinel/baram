# /new-extension — Tiptap Extension 생성

새로운 Tiptap Extension의 보일러플레이트를 생성한다 (코드 + 테스트 + 파이프라인 변환기).

## 사용법

```
/new-extension Heading --type Node --syntax "# ~ ######" --ref §5.1
/new-extension Bold --type Mark --syntax "**text**" --ref §5.1
/new-extension MathBlock --type Node --syntax "$$...$$" --ref §5.3 --nodeview
```

## 인자

- `$ARGUMENTS`: Extension 이름과 옵션
  - 이름: PascalCase (예: MathBlock, InlineMath, Wikilink)
  - `--type`: Node | Mark | Plugin
  - `--syntax`: 마크다운 구문
  - `--ref`: 설계 문서 섹션 번호
  - `--nodeview`: React NodeView 필요 시 플래그

---

## 생성 파일

### 1. Extension 파일

**Node인 경우**: `src/extensions/nodes/{kebab-name}.ts`
**Mark인 경우**: `src/extensions/marks/{kebab-name}.ts`
**Plugin인 경우**: `src/extensions/plugins/{kebab-name}.ts`

```typescript
import { Node } from '@tiptap/core'

export const {PascalName} = Node.create({
  name: '{camelName}',
  group: '{block|inline}',
  content: '{적절한 content expression}',

  addAttributes() {
    return {
      // 설계 문서에서 필요한 속성 추출
    }
  },

  parseHTML() {
    return [{ tag: '{적절한 태그}' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['{태그}', mergeAttributes(HTMLAttributes, { 'data-type': '{name}' }), 0]
  },

  addInputRules() {
    // 마크다운 구문 → Extension 변환 규칙
    return []
  },

  addKeyboardShortcuts() {
    // Part 4 §4.10 또는 Part 9 §9.3 단축키 맵 참조
    return {}
  },

  addCommands() {
    return {
      // insert{PascalName}, toggle{PascalName} 등
    }
  },
})
```

### 2. React NodeView (--nodeview 플래그 시)

`src/extensions/nodes/{kebab-name}-view.tsx`

```typescript
import { NodeViewWrapper, NodeViewContent } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/react'

export function {PascalName}View({ node, updateAttributes, editor, selected }: NodeViewProps) {
  return (
    <NodeViewWrapper
      className={`baram-{kebab-name} ${selected ? 'selected' : ''}`}
      data-type="{kebab-name}"
    >
      {/* 설계 문서의 UI 스펙에 맞게 구현 */}
      <NodeViewContent />
    </NodeViewWrapper>
  )
}
```

### 3. 파이프라인 변환기

`src/pipeline/transformers/{kebab-name}-transformer.ts`

```typescript
import type { Node as MdastNode } from 'mdast'
import type { Node as PMNode } from 'prosemirror-model'

/**
 * mdast → ProseMirror 변환
 * 설계 참조: Part 7 §7.2
 */
export function mdastTo{PascalName}(mdastNode: MdastNode): PMNode {
  // TODO: 구현
  throw new Error('Not implemented')
}

/**
 * ProseMirror → mdast 변환
 * 설계 참조: Part 7 §7.1
 */
export function {camelName}ToMdast(pmNode: PMNode): MdastNode {
  // TODO: 구현
  throw new Error('Not implemented')
}
```

### 4. 테스트 파일

`src/extensions/__tests__/{kebab-name}.test.ts`

```typescript
import { {PascalName} } from '../{type}s/{kebab-name}'

describe('{PascalName} Extension', () => {
  // === 라운드트립 테스트 (필수) ===
  describe('라운드트립 보존', () => {
    test.each([
      ['기본 케이스', '{기본 마크다운 예시}'],
      ['복잡한 케이스', '{복잡한 예시}'],
      ['엣지 케이스', '{엣지 케이스}'],
    ])('%s', (_, input) => {
      const doc = parseMarkdown(input)
      const output = serializeMarkdown(doc)
      expect(output).toBe(input)
    })
  })

  // === 기능 테스트 ===
  describe('InputRule', () => {
    test('마크다운 구문 입력 시 변환', () => {
      // TODO
    })
  })

  describe('키보드 단축키', () => {
    test('단축키 동작', () => {
      // TODO
    })
  })

  describe('PasteRule', () => {
    test('마크다운 붙여넣기 시 변환', () => {
      // TODO
    })
  })
})
```

---

## registry.json 업데이트

생성 후 `src/extensions/registry.json`에 항목을 추가한다:

```json
{
  "name": "{camelName}",
  "file": "{type}s/{kebab-name}.ts",
  "markdown": "{구문}",
  "spec": "§{번호}",
  "phase": {번호},
  "milestone": "M{번호}",
  "status": "implemented",
  "hasNodeView": {true|false},
  "inputRules": ["{규칙들}"],
  "shortcuts": { "{키}": "{동작}" }
}
```
