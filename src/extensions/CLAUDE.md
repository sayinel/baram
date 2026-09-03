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

## Extension 목록

**`registry.json`이 canonical 레지스트리다** — 전체 Extension 목록(nodes/marks/plugins)과
각각의 마크다운 구문·InputRule·마일스톤 메타데이터는 registry.json에서 확인할 것.
이 문서에 목록을 중복 기재하지 않는다 (과거 이 표가 실제 등록 수의 절반 수준으로 낡은 전례가 있음).

파일 위치 규칙: `nodes/{name}.ts`, `marks/{name}.ts`, `plugins/{name}.ts` (+ NodeView는 `{name}-view.tsx`).

## `data-vim-suspend` 마커 규약 (§298 vim Phase 1, 설계 §4)

NodeView 안에 **PM 본문이 아닌 입력 요소**(input/textarea/select/CM 등 "입력 섬")를
두는 경우, 그 요소(또는 섬 전체를 감싸는 컨테이너)에 `data-vim-suspend` 속성을
반드시 부여할 것. vim 플러그인은 키 이벤트의 `composedPath()`를 target에서
바깥으로 순회하며 **먼저 만나는 마커로 판정**한다:

- `[data-node-view-content]` → PM 본문 (vim 정상 동작)
- `[data-vim-suspend]` → vim 일시 중단 (섬이 키를 소유)

규칙:

- 컨트롤이 하나면 요소에 직접, 여러 개가 묶여 있으면 공통 컨테이너에 1개만 부여
  (단, 컨테이너와 target 사이에 `data-node-view-content`가 끼면 안 됨).
- `Decoration.widget`처럼 render마다 DOM을 재생성하는 경우 생성 코드에서 부여.
- Shadow DOM NodeView는 host 요소에 마커 필수. 에디터 외부 portal은 키가
  view.dom에 도달하지 않으므로 규약 대상 아님.
- 마커 없는 서드파티 NodeView의 입력 섬은 vim 미지원으로 간주된다.
- **보안 불변식**: 마커는 앱 capability다. HTML/SVG/외부 마크다운을 처리하는 sanitizer는 반드시
  `VIM_ISLAND_MARKERS`를 제거할 것 (DOMPurify는 `data-*`·`tabindex`를 기본 허용하므로 공유 문서가
  suspension을 자칭하거나 실제 island에서 거부해 사용자 타이핑을 vim 명령으로 실행시킬 수 있다).

## atom 블록의 vim 편집 세션 (§298)

textarea 기반 atom 블록(수식·mermaid·svg류)의 vim 진입/이탈 세션(진입 래치, 선택 해제 시 저장,
Esc 계단, 대기 textarea 배선)은 **`nodes/views/use-atom-edit-session.ts` 공유 훅을 쓸 것** —
entryKey는 인자로 주입(노드 모듈 import 금지, 순환). 과거 세 뷰가 이 기계를 복사해 갖고 있다가
수정이 한 곳에만 착지하는 사고가 있어 통일했다. 새 atom 블록은 네 번째 복사본을 만들지 말 것.
훅 호출 위치는 기존 effect 순서를 바꾸지 않는 자리에 둘 것 (렌더 디바운스가 effect 등록 순서에 의존).

codemirror-vim의 keymap·엔진 본체는 `@replit/codemirror-vim`이 아니라 의존성 `@replit/codemirror-vim-core/vim.js`에 있다 (dist에는 keymap이 없다 — 키 바인딩을 찾을 때 헛걸음 주의).

**NodeView wrapper의 React 핸들러(`onContextMenu` 등)는 `createPortal`로 body에 그린 모달 안의 이벤트도 받는다** — React 트리 기준으로 버블하기 때문. 블록 자신의 이벤트인지는 `wrapperRef.current.contains(e.target)`로 먼저 걸러라 (mermaid/svg fullscreen 모달 우클릭이 인라인 상태에 묶인 블록 메뉴를 열던 사고, PR 537).

## registry.json 유지 규칙

Extension을 추가/수정할 때 반드시 `registry.json`도 함께 업데이트할 것.
이 레지스트리는 다른 스킬(`/milestone`, `/spec-check`)이 참조한다.
