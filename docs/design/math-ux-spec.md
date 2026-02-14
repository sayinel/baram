# 수식 편집 UX 설계

WYSIWYG 마크다운 에디터에서의 수식(LaTeX/KaTeX) 입력·편집·렌더링 UX 명세.
Typora의 수식 UX를 참고하되, 실시간 프리뷰를 추가한 설계.

---

## 1. 개요

수식은 **인라인 수식**(`$...$`)과 **블록 수식**(`$$...$$`) 두 가지 형태를 지원한다.

| 구분 | 마크다운 문법 | 렌더링 모드 | 편집 방식 |
|------|-------------|------------|----------|
| 인라인 수식 | `$x^2 + y^2$` | 본문 흐름 안에 렌더링 | ProseMirror 플러그인 — 텍스트 기반 편집 |
| 블록 수식 | `$$\n...\n$$` | 중앙 정렬 독립 블록 | React NodeView — textarea 편집 |

두 형태 모두 **atom 노드**(ProseMirror 용어: 내부에 커서가 진입할 수 없는 단일 단위)로 구현한다. 편집이 아닌 상태에서는 KaTeX로 렌더링된 결과만 보이고, 편집 모드 진입 시 LaTeX 소스가 노출된다.

---

## 2. 인라인 수식 (`$...$`)

### 2.1 아키텍처

인라인 수식은 두 개의 Extension이 역할을 분담한다:

- **MathInline Node** — `atom: true`인 Tiptap Node. 렌더링만 담당하는 React NodeView(KaTeX → HTML)를 가진다.
- **MathInlineEdit Extension** — ProseMirror 플러그인. `$` 입력 감지, 자동 페어링, 프리뷰 오버레이, 수식 확정/취소, 재편집 등 모든 편집 로직을 전담한다.

렌더링과 편집을 분리한 이유: 인라인 수식은 본문 텍스트 흐름 안에 있으므로, atom NodeView 내부에 input을 넣는 방식으로는 자연스러운 타이핑 UX를 구현할 수 없다. 대신 ProseMirror의 텍스트 레이어에서 직접 `$...$` 텍스트를 다루고, 확정 시 atom 노드로 변환하는 방식을 사용한다.

### 2.2 새 수식 입력

```
사용자가 $ 타이핑
  ↓
handleTextInput에서 가로챔
  ↓
$$ 삽입, 커서를 두 $ 사이에 배치
  ↓
플러그인 상태 활성화: { active: true, from: $위치, to: $위치+2 }
  ↓
편집 모드 진입 → 딜리미터 데코레이션 + 프리뷰 오버레이 표시
  ↓
사용자가 수식 입력 (예: x^2)
  ↓
Enter 또는 Escape → 수식 확정
  ↓
$x^2$ 텍스트가 mathInline atom 노드로 변환 → KaTeX 렌더링
```

### 2.3 편집 모드 UI

편집 중 화면에 보이는 요소:

```
일반 텍스트 $x^2+y^2$ 일반 텍스트
             ↑         ↑
         여는 딜리미터  닫는 딜리미터 (회색 모노스페이스)
             ┌──────────────────┐
             │  x² + y²         │  ← 프리뷰 오버레이 (커서 아래)
             └──────────────────┘
```

- **딜리미터 데코레이션**: `$` 기호를 회색(`#999`) 모노스페이스로 시각적 구분
- **프리뷰 오버레이**: 여는 `$` 위치 기준으로 아래쪽에 fixed 포지션 div로 표시

### 2.4 프리뷰 오버레이 상세

| 항목 | 사양 |
|------|------|
| 위치 | `view.coordsAtPos(editState.from)`의 bottom + 4px |
| 포지셔닝 | `position: fixed`, `z-index: 9999` |
| 렌더링 | `katex.render(formula, element, { throwOnError: true })` (DOM 직접 렌더링) |
| 정상 수식 | KaTeX 렌더링 결과 표시 |
| 오류 수식 | 빨간색(`#d32f2f`) 모노스페이스 에러 메시지 |
| 빈 수식 | "수식을 입력하세요" 플레이스홀더 (회색 이탤릭) |
| 스타일 | 흰색 배경, `border: 1px solid #e0e0e0`, `border-radius: 6px`, `box-shadow: 0 2px 12px rgba(0,0,0,0.12)`, `padding: 8px 12px`, `font-size: 16px` |
| 최대 너비 | 400px |
| 인터랙션 | `pointer-events: none` (클릭 투과) |

### 2.5 수식 확정

| 트리거 | 동작 |
|--------|------|
| Enter | `$formula$` → `mathInline` 노드로 변환, 커서를 노드 뒤로 이동 |
| Escape | 동일 |
| 커서가 `$...$` 범위 밖으로 이동 | 동일 (view update에서 감지) |
| `$...$` 범위 밖 클릭 | 동일 (handleClick에서 감지) |

**빈 수식** (`$$` 상태에서 확정): 딜리미터를 포함하여 전체 삭제.

### 2.6 수식 취소 / 텍스트 복원

| 트리거 | 동작 |
|--------|------|
| Backspace (커서가 여는 `$` 바로 뒤) | `$formula$` → 일반 텍스트 `formula`로 복원, 편집 모드 해제 |
| Backspace (빈 수식에서) | `$$` 전체 삭제 |

### 2.7 기존 수식 재편집

이미 확정된 mathInline 노드를 다시 편집하는 플로우:

```
mathInline 노드 클릭 또는 방향키로 진입 (NodeSelection)
  ↓
atom 노드를 $formula$ 텍스트로 변환
  ↓
커서를 formula 끝에 배치
  ↓
편집 모드 진입 (이후 플로우는 새 수식과 동일)
```

- **클릭**: `view.update()`에서 `NodeSelection` + `mathInline` 감지 → `requestAnimationFrame`으로 변환
- **키보드**: `handleKeyDown`에서 `NodeSelection` 감지 → 문자 입력 시 해당 문자를 formula 뒤에 삽입하면서 편집 모드 진입
- **Backspace/Delete**: NodeSelection 기본 동작 유지 (노드 삭제)

### 2.8 블록 수식 자동 전환

인라인 수식 편집 중 블록 수식으로 자연스럽게 전환하는 메커니즘:

```
$ 입력 → $$ (인라인 편집 모드)
  ↓
빈 상태에서 다시 $ 입력
  ↓
인라인 편집 취소 → $$ 텍스트가 남음
  ↓
단락 전체가 $$content$$ 패턴인지 검사
  ↓
매칭되면 → 단락을 mathBlock 노드로 자동 변환
```

이 설계의 핵심: `$` 자동 페어링이 `$$` 입력을 가로채는 문제를 역이용하여, 빈 인라인 수식에서 `$`를 다시 누르면 인라인 편집을 취소하고 `$$`를 남겨둔다. 이후 사용자가 `$$content$$` 형태로 완성하면 블록 수식으로 변환한다.

### 2.9 플러그인 상태 관리

```typescript
interface MathEditState {
  active: boolean;   // 편집 모드 여부
  from: number;      // 여는 $ 의 document position
  to: number;        // 닫는 $ 의 다음 document position
}
```

- `PluginKey`로 ProseMirror 상태에 저장
- 트랜잭션 발생 시 `tr.mapping.map(from, -1)`, `tr.mapping.map(to, 1)`으로 위치 자동 보정
- `tr.setMeta(pluginKey, newState)`로 상태 전환
- 매 view update마다 `$` 딜리미터 존재 여부를 검증, 깨지면 자동 비활성화
- 오버레이 DOM 요소는 플러그인 `destroy()` 시 제거

---

## 3. 블록 수식 (`$$...$$`)

### 3.1 아키텍처

블록 수식은 단일 Extension이 렌더링과 편집을 모두 담당한다:

- **MathBlock Node** — `atom: true`, `group: 'block'`인 Tiptap Node
- **MathBlockView** — React NodeView. `selected` 상태에 따라 렌더링/편집 모드를 자체 전환

### 3.2 모드 전환

| 상태 | 화면 표시 |
|------|----------|
| 비선택 상태 | KaTeX 렌더링 결과 (중앙 정렬, `displayMode: true`) |
| 선택 상태 (`selected`) | textarea + 실시간 프리뷰 |
| 수식 비어있음 (비선택) | "Empty math block" 이탤릭 플레이스홀더 |

`useEffect`가 `selected` prop 변화를 감지하여 `editing` 상태를 자동 전환한다.

### 3.3 편집 모드 UI 레이아웃

```
┌─────────────────────────────────────────┐
│  textarea                               │
│  ┌─────────────────────────────────┐    │
│  │ \int_{0}^{\infty} e^{-x} dx    │    │
│  │                                 │    │
│  └─────────────────────────────────┘    │
│  ┌─────────────────────────────────┐    │
│  │        ∫₀^∞ e⁻ˣ dx             │    │  ← 실시간 프리뷰
│  └─────────────────────────────────┘    │
└─────────────────────────────────────────┘
```

#### textarea

| 항목 | 사양 |
|------|------|
| 너비 | 100% |
| 기본 행 수 | 3 |
| 폰트 | 모노스페이스 (`SF Mono`, `Consolas`) |
| 폰트 크기 | 14px |
| 보더 | `1px solid #ddd`, `border-radius: 4px` |
| 리사이즈 | vertical (세로만 가능) |
| placeholder | "LaTeX formula..." |

#### 실시간 프리뷰

| 항목 | 사양 |
|------|------|
| 위치 | textarea 바로 아래 (`margin-top: 8px`) |
| 렌더링 | `katex.renderToString(formula, { throwOnError: true, displayMode: true })` |
| 메모이제이션 | `useMemo`로 `formula` 변경 시에만 재렌더링 |
| 정상 수식 | KaTeX 렌더링 결과 (중앙 정렬) |
| 오류 수식 | 빨간색(`#d32f2f`) 모노스페이스 12px 에러 메시지 |
| 빈 수식 | "수식을 입력하세요" 플레이스홀더 (회색 이탤릭 13px) |
| 스타일 | 인라인 프리뷰 오버레이와 동일 (흰색 배경, 그림자, 둥근 모서리) |

### 3.4 키보드 네비게이션

textarea 내부에서 블록을 빠져나가는 키보드 동작:

| 키 | 조건 | 동작 |
|----|------|------|
| Escape | 항상 | 블록 뒤로 커서 이동 |
| ArrowLeft | 커서가 텍스트 맨 앞 | 블록 앞으로 커서 이동 |
| ArrowRight | 커서가 텍스트 맨 뒤 | 블록 뒤로 커서 이동 |
| ArrowUp | 첫 번째 줄에 커서 | 블록 앞으로 커서 이동 |
| ArrowDown | 마지막 줄에 커서 | 블록 뒤로 커서 이동 |

블록 탈출 시 `editor.chain().setTextSelection(targetPos).focus().run()` 패턴으로 에디터에 포커스를 반환한다.

### 3.5 Slash 커맨드

에디터에서 `/`를 입력하면 나타나는 메뉴에 "Math Block" 항목을 등록한다.

| 항목 | 값 |
|------|------|
| label | Math Block |
| icon | ∑ |
| keywords | math, equation, katex, latex, 수식 |
| 동작 | 빈 `mathBlock` 노드 삽입 |

---

## 4. 프리뷰 공통 스타일

인라인 프리뷰 오버레이와 블록 프리뷰는 동일한 시각적 스타일을 공유한다:

```css
/* 공통 프리뷰 스타일 */
background: #fff;
border: 1px solid #e0e0e0;
border-radius: 6px;
padding: 8px 12px;
box-shadow: 0 2px 12px rgba(0, 0, 0, 0.12);
font-size: 16px;

/* 에러 상태 */
color: #d32f2f;
font-size: 12px;
font-family: 'SF Mono', Consolas, monospace;

/* 플레이스홀더 */
color: #999;
font-style: italic;
font-size: 13px;
```

인라인과 블록의 차이점:

| 항목 | 인라인 프리뷰 | 블록 프리뷰 |
|------|-------------|------------|
| 포지셔닝 | `position: fixed` (커서 위치 기준) | 정적 (textarea 아래에 배치) |
| 최대 너비 | 400px | 부모 컨테이너 너비 |
| 최소 높이 | 없음 | 40px |
| 클릭 | `pointer-events: none` (투과) | 일반 (상호작용 가능) |
| KaTeX displayMode | `false` | `true` |
| 렌더링 방식 | `katex.render()` (DOM 직접) | `katex.renderToString()` (HTML 문자열) |

---

## 5. 마크다운 변환

### 5.1 파싱 (마크다운 → 에디터)

markdown-it에 수식 플러그인을 사용하지 않고, **전처리 방식**을 사용한다:

1. 파싱 전 블록 수식(`$$...$$`)을 플레이스홀더로 치환
2. 파싱 전 인라인 수식(`$...$`)을 플레이스홀더로 치환
3. markdown-it으로 나머지 마크다운 파싱
4. 파싱 결과에서 플레이스홀더를 `mathBlock` / `mathInline` 노드로 복원

```
블록 수식 regex:  /\$\$\n?([\s\S]*?)\n?\$\$/g    (멀티라인 + 싱글라인)
인라인 수식 regex: /(?<!\$)\$([^\$\n]+?)\$(?!\$)/g  (단일 $ 매칭, $$ 제외)
```

### 5.2 직렬화 (에디터 → 마크다운)

| 노드 타입 | 직렬화 형식 |
|-----------|------------|
| mathBlock | `$$\n{formula}\n$$` |
| mathInline | `${formula}$` |

---

## 6. Atom 노드 구현 주의사항

수식 노드처럼 `atom: true`인 노드를 구현할 때 필수 패턴:

1. **`renderHTML`에 콘텐츠 홀(`0`) 사용 금지** — atom 노드는 자식 콘텐츠가 없으므로, `renderHTML` 반환값에 `0`을 포함하면 ProseMirror와 충돌한다. `['div', mergeAttributes(...)]` 형태로 반환해야 한다.

2. **`contentEditable={false}` 필수** — React NodeView의 `NodeViewWrapper`에 `contentEditable={false}` 속성을 명시해야 정상 동작한다.

3. **키보드 네비게이션 패턴** — atom 노드 내부의 textarea에서 블록을 빠져나가려면:
   ```typescript
   editor.chain().setTextSelection(targetPos).focus().run()
   ```

4. **CSS import 누락 주의** — Extension의 CSS 파일은 해당 Extension의 진입점에서 반드시 import해야 한다.
