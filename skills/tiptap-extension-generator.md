---
name: tiptap-extension-generator
description: "Baram의 Tiptap Extension 보일러플레이트를 생성한다. 코드, NodeView, 파이프라인 변환기, 라운드트립 테스트를 포함."
version: 1.0.0
tags: [code-gen, tiptap, prosemirror, baram]
input_format: text
output_format: code
---

# Tiptap Extension Generator for Baram

## 역할

사용자가 Extension의 이름, 유형(Node/Mark/Plugin), 마크다운 구문을 설명하면
4개 파일(Extension, NodeView, 변환기, 테스트)을 생성한다.

## 참조 설계 문서

- Part 3 §3.3: Extension 체계 (Node/Mark/Plugin 목록과 스키마)
- Part 3 §3.4: Extension-First 아키텍처, 등록 패턴
- Part 5: 각 기능의 상세 스펙 (§5.1 기본요소 ~ §5.15)
- Part 7 §7.1: 마크다운 파일 규격, 직렬화 규칙
- Part 7 §7.2: ProseMirror Document 스키마

## 입력 형식

```
Extension 이름: MathBlock
유형: Node
마크다운 구문: $$\n...\n$$
설계 참조: §5.3
NodeView 필요: 예 (KaTeX 렌더링 + 편집 오버레이)
단축키: Cmd+Shift+M
```

## 출력 규칙

### 파일 1: Extension (`src/extensions/{type}s/{name}.ts`)

```typescript
import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { {Name}View } from './{name}-view'

export interface {Name}Options {
  // Extension 설정 옵션
  HTMLAttributes: Record<string, any>
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    {camelName}: {
      /**
       * Insert a {name}
       * @ref §{섹션}
       */
      insert{Name}: (attrs?: Partial<{Name}Attrs>) => ReturnType
    }
  }
}

export const {Name} = Node.create<{Name}Options>({
  name: '{camelName}',
  group: '{block|inline}',
  content: '{content expression}',
  marks: '{허용 marks}',
  atom: {true|false},
  draggable: {true|false},
  selectable: true,
  defining: true,

  addOptions() {
    return {
      HTMLAttributes: {},
    }
  },

  addAttributes() {
    return {
      // Part 7 §7.2 스키마에 정의된 속성
    }
  },

  parseHTML() {
    return [{
      tag: '{적절한 태그}[data-type="{name}"]',
    }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['{태그}', mergeAttributes(
      this.options.HTMLAttributes,
      HTMLAttributes,
      { 'data-type': '{name}' }
    ), 0]
  },

  addInputRules() {
    // 마크다운 구문 → Extension 자동 변환
    return []
  },

  addPasteRules() {
    // 붙여넣기 시 마크다운 감지 및 변환
    return []
  },

  addKeyboardShortcuts() {
    return {
      // Part 9 §9.3 단축키 맵 참조
    }
  },

  addCommands() {
    return {
      insert{Name}: (attrs) => ({ commands }) => {
        return commands.insertContent({
          type: this.name,
          attrs,
        })
      },
    }
  },

  // NodeView가 필요한 경우에만 포함
  addNodeView() {
    return ReactNodeViewRenderer({Name}View)
  },
})
```

### 파일 2: NodeView (`src/extensions/{type}s/{name}-view.tsx`)

NodeView가 필요한 경우에만 생성한다 (수식, 코드블록, Mermaid, 콜아웃 등).

```typescript
import { NodeViewWrapper, NodeViewContent } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/react'

/**
 * {Name} NodeView
 * @ref §{섹션}
 */
export function {Name}View({
  node,
  updateAttributes,
  editor,
  selected,
  deleteNode,
  getPos,
}: NodeViewProps) {
  // 편집 모드 vs 표시 모드 전환 로직
  const [isEditing, setIsEditing] = useState(false)

  return (
    <NodeViewWrapper
      className={cn(
        'baram-{kebab-name}',
        selected && 'ring-2 ring-blue-500/30',
        isEditing && 'editing',
      )}
      data-type="{kebab-name}"
    >
      {isEditing ? (
        // 편집 UI (텍스트 입력, 설정 등)
        <div className="baram-{kebab-name}__editor">
          {/* 구현 */}
        </div>
      ) : (
        // 렌더링된 표시 (KaTeX, 코드 하이라이트 등)
        <div
          className="baram-{kebab-name}__display"
          onClick={() => setIsEditing(true)}
        >
          {/* 구현 */}
        </div>
      )}
    </NodeViewWrapper>
  )
}
```

### 파일 3: 파이프라인 변환기 (`src/pipeline/transformers/{name}-transformer.ts`)

```typescript
import type { Node as MdastNode } from 'mdast'
import type { Node as PMNode, Schema } from 'prosemirror-model'

/**
 * mdast → ProseMirror 변환
 *
 * @ref Part 7 §7.2 ProseMirror 스키마
 * @param mdastNode - mdast 트리의 해당 노드
 * @param schema - ProseMirror 스키마
 * @returns ProseMirror 노드
 */
export function mdastTo{Name}(mdastNode: MdastNode, schema: Schema): PMNode {
  // 1. mdast 노드에서 속성 추출
  // 2. 자식 노드 재귀 변환 (있는 경우)
  // 3. schema.nodes.{name}.create(attrs, children) 반환
  throw new Error('Not implemented: mdastTo{Name}')
}

/**
 * ProseMirror → mdast 변환
 *
 * @ref Part 7 §7.1 마크다운 파일 규격
 * @param pmNode - ProseMirror 노드
 * @returns mdast 노드
 */
export function {camelName}ToMdast(pmNode: PMNode): MdastNode {
  // 1. ProseMirror 노드에서 속성 추출
  // 2. 자식 노드 재귀 변환 (있는 경우)
  // 3. mdast 노드 형태로 반환
  throw new Error('Not implemented: {camelName}ToMdast')
}
```

### 파일 4: 테스트 (`src/extensions/__tests__/{name}.test.ts`)

```typescript
import { createTestEditor } from '../../test-utils/editor'
import { parseMarkdown, serializeMarkdown } from '../../pipeline'
import { {Name} } from '../{type}s/{name}'

describe('{Name} Extension', () => {
  const editor = createTestEditor([{Name}])

  // ========================================
  // 라운드트립 테스트 (MUST PASS)
  // ========================================
  describe('Roundtrip Fidelity', () => {
    const cases: [string, string][] = [
      ['기본 케이스', `{기본 마크다운}`],
      ['복잡한 케이스', `{복잡한 마크다운}`],
      ['엣지 케이스: 빈 콘텐츠', `{빈 케이스}`],
      ['엣지 케이스: 특수 문자', `{특수 문자 포함}`],
      ['엣지 케이스: 유니코드', `{한글/이모지 포함}`],
    ]

    test.each(cases)('라운드트립 보존: %s', (_, input) => {
      const doc = parseMarkdown(input)
      const output = serializeMarkdown(doc)
      expect(output).toBe(input)
    })
  })

  // ========================================
  // 기능 테스트
  // ========================================
  describe('Creation', () => {
    test('Extension이 정상적으로 로드된다', () => {
      expect(editor.extensionManager.extensions).toContainEqual(
        expect.objectContaining({ name: '{camelName}' })
      )
    })

    test('커맨드로 생성할 수 있다', () => {
      editor.commands.insert{Name}()
      // 생성 확인
    })
  })

  describe('InputRules', () => {
    test('마크다운 구문 입력 시 변환된다', () => {
      // {구문} 입력 → Extension으로 변환 확인
    })
  })

  describe('Keyboard Shortcuts', () => {
    test('{단축키} 동작', () => {
      // 단축키 시뮬레이션 → 동작 확인
    })
  })

  describe('PasteRules', () => {
    test('마크다운 붙여넣기 시 변환된다', () => {
      // 클립보드 마크다운 → Extension으로 변환 확인
    })
  })

  describe('Edge Cases', () => {
    test('빈 콘텐츠 처리', () => {})
    test('중첩된 구조 처리', () => {})
    test('삭제 시 정상 동작', () => {})
  })
})
```

## registry.json 업데이트

생성 후 반드시 `src/extensions/registry.json`에 항목을 추가한다.

## 라운드트립 보존 규칙 (절대 원칙)

1. 원본 마크다운의 공백, 줄바꿈, 들여쓰기를 **정확히** 보존한다
2. 확장 구문(`$$`, `> [!tip]` 등)의 형식을 변경하지 않는다
3. 알 수 없는 구문은 raw text로 통과시킨다 (데이터 손실 금지)
4. 정규화는 최소한으로: 줄끝 CRLF→LF, 파일끝 빈줄 1개 통일만 허용
