# PDF Viewer Enhancement Implementation Plan (§270–§279)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PDF 뷰어에 문서 내 찾기와 텍스트 하이라이트를 추가하고, 하이라이트를 기존 블록 참조 문법으로 다른 노트에서 인용할 수 있게 한다.

**Architecture:** 현재의 커스텀 pdfjs 뷰어(직접 `getDocument` + `page.render` + `TextLayer`)를 유지한 채, 찾기는 pdfjs의 `PDFFindController`를 20줄 어댑터로 구동하고 매치 → DOM 매핑만 직접 구현한다. 하이라이트는 동반 마크다운 노트(블록 = 하이라이트)와 기하 사이드카 JSON으로 이원화 저장하며, reference는 새 문법 없이 기존 `((target#^id|display))` 블록 참조를 그대로 쓴다. 노트에서의 내용 표시는 `display` 속성에 텍스트를 구워 넣어 해결하므로 블록 참조의 전역 동작은 바뀌지 않는다.

**Tech Stack:** pdfjs-dist 6.2.108 (legacy build), React 19, TypeScript strict + `verbatimModuleSyntax`, Vitest + jsdom, Tiptap v3, Zustand.

**설계 문서:** [`dev/design/part15-pdf-viewer-enhancement.md`](../design/part15-pdf-viewer-enhancement.md) — 모든 `§27x` 참조는 이 문서를 가리킨다.

## Global Constraints

- **테스트 러너는 Vitest 전용** — `npm test` → `vitest run`. `npx jest` 금지 (Babel 파싱 실패).
- **게이트 exit code는 파이프 없이 캡처** — `cmd > /tmp/log; echo $?`. `cmd | tail`은 tail의 exit를 반환한다.
- **`import type` 필수** — `verbatimModuleSyntax`가 켜져 있어 타입 전용 import는 반드시 `import type`.
- **`npm run typecheck`는 3개 프로젝트(앱/node/테스트)를 모두 검사** — 테스트 코드도 타입 검사 대상.
- **단일 파일 ~300줄 이하**, CSS 파일 ~1,500줄 이하.
- **Zustand 셀렉터는 `useShallow`** — 컴포넌트에서 `useStore()` bare call 금지.
- **CSS 변수 category는 정해진 9개뿐** — `accent` `bg` `border` `callout` `editor` `git` `graph` `status` `text`. 새 색은 `--color-editor-*` 아래에 만든다. `tokens/semantic/color-light.json`이 canonical.
- **디자인 토큰은 손으로 CSS에 쓰지 않는다** — `tokens/semantic/color-{light,dark}.json` 수정 → `npm run tokens:build` → `src/styles/generated/` 자동 생성. `generated/`는 DO NOT EDIT.
- **커밋은 Conventional Commits + 영어 + 설계 섹션 참조** — 예: `feat(§272): add PDF find controller adapter`.
- **`--no-verify` 금지.** pre-commit은 prettier + eslint `--max-warnings=0`(perfectionist import/member 정렬)을 돌린다. 실패하면 `npx eslint --fix` / `npx prettier --write` 후 재시도.
- **`dev/`는 gitignore 대상**(`.gitignore:581`) — 이 계획서와 설계 문서는 커밋하지 않는다.
- **pre-push hook은 `cargo clippy --all-targets` + `npx knip`** — base 변경 후 첫 push는 5~7분. push는 백그라운드로.

---

## File Structure

| File | Responsibility | New? |
|---|---|---|
| `src/components/editor/pdf/PdfPreview.tsx` | 문서 로드 · baseScale · 페이지 목록 · 툴바/찾기바 마운트 | Create (기존 파일 이설) |
| `src/components/editor/pdf/PdfPage.tsx` | canvas · text layer · 하이라이트/매치 오버레이 | Create |
| `src/components/editor/pdf/pdf-find.ts` | 동적 로더 · linkService 어댑터 · 매치 → (divIdx, offset) 변환 | Create |
| `src/components/editor/pdf/pdf-find-render.ts` | 매치 위치를 텍스트 레이어 span에 칠하기 | Create |
| `src/components/editor/pdf/PdfFindBar.tsx` | 찾기 입력 UI | Create |
| `src/components/editor/pdf/PdfToolbar.tsx` | 상주 툴바 (페이지 · 줌 · 찾기 · 영역모드 슬롯) | Create |
| `src/components/editor/pdf/PdfSelectionPopup.tsx` | 선택/하이라이트 팝업 (색 · Copy reference · Copy text · 삭제) | Create |
| `src/components/editor/pdf/pdf-highlight-geom.ts` | 좌표 변환 (client ↔ PDF user space) | Create |
| `src/components/editor/pdf/pdf-highlight-sidecar.ts` | 사이드카 스키마 · 파싱 · 경로 규칙 | Create |
| `src/components/editor/pdf/pdf-highlight-store.ts` | 사이드카 I/O + 동반 노트 쓰기 | Create |
| `src/components/editor/pdf/pdf-ref-display.ts` | `display` 문자열 생성 규칙 | Create |
| `src/components/editor/PdfPreview.tsx` | 삭제 (pdf/ 로 이설) | Delete |
| `src/extensions/nodes/block-reference.ts` | `addInputRules` + `addPasteRules` 추가 | Modify |
| `src/hooks/use-navigation.ts:213` | 하이라이트 ref → PDF 점프 분기 | Modify |
| `src/App.tsx:123,880` | lazy import 경로 · Cmd+F 라우팅 | Modify |
| `src/styles/editor/pdf.css` | PDF 뷰어 전용 스타일 (html-preview.css에서 분리 + 신규) | Create |
| `src/styles/editor.css:13` | `@import "./editor/pdf.css";` 추가 | Modify |
| `src/styles/editor/html-preview.css` | pdf 규칙 제거 (html 전용으로 축소) | Modify |
| `tokens/semantic/color-light.json` · `color-dark.json` | 하이라이트 5색 토큰 | Modify |
| `src/i18n/en.json` · `ko.json` | 찾기/하이라이트 문자열 | Modify |

> **왜 `pdf/` 하위 디렉터리인가:** 현재 `PdfPreview.tsx`는 229줄이고 두 기능을 넣으면 500줄을 넘어 프로젝트 규칙을 위반한다. 순수 로직(좌표·오프셋·display·사이드카 파싱)을 DOM에서 분리해야 jsdom으로 테스트할 수 있다는 점도 같은 방향을 가리킨다.

---

## Phase A — 구조 재편 (PR 1)

기능 변경 없음. 이후 두 페이즈가 올라탈 자리를 만들고, 찾기의 전제 조건인 텍스트 추출 파라미터를 맞춘다.

### Task 1: PdfPreview 분해 + 텍스트 추출 파라미터 정합

**Files:**
- Create: `src/components/editor/pdf/PdfPreview.tsx`, `src/components/editor/pdf/PdfPage.tsx`
- Delete: `src/components/editor/PdfPreview.tsx`
- Modify: `src/App.tsx:123-126`
- Create: `src/styles/editor/pdf.css`
- Modify: `src/styles/editor.css:13`, `src/styles/editor/html-preview.css`
- Test: `src/components/editor/pdf/__tests__/pdf-page.test.tsx`

**Interfaces:**
- Consumes: 없음 (첫 태스크)
- Produces:
  - `PdfPreview` — `{ filePath: string; refreshKey?: number; title?: string }`, default export 아님 (named)
  - `PdfPage` — `{ page: PDFPageProxy; scale: number }`, `PdfPage.tsx`에서 named export

**배경:** `PDFFindController`는 텍스트를 `{ disableNormalization: true }`로 추출한다(`pdf_viewer.mjs:6134`). 현재 `PdfPreview.tsx:197`은 `page.streamTextContent()`를 인자 없이 부르므로 정규화가 켜져 있고, 두 쪽의 item 문자열이 달라지면 Phase B에서 **오프셋이 어긋나 엉뚱한 글자에 하이라이트가 칠해진다.** 특정 PDF에서만 재현되는 결함이므로 지금 맞추고 테스트로 고정한다.

- [ ] **Step 1: 실패하는 테스트를 작성한다**

`src/components/editor/pdf/__tests__/pdf-page.test.tsx`:

```tsx
import type { PDFPageProxy } from "pdfjs-dist";

import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PdfPage } from "../PdfPage";

// TextLayer는 실제 pdfjs 클래스를 쓰지 않는다 — 우리가 검증할 것은
// "어떤 인자로 streamTextContent를 부르는가"뿐이다.
vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
  GlobalWorkerOptions: { workerSrc: "" },
  TextLayer: class {
    cancel() {}
    render() {
      return Promise.resolve();
    }
    get textContentItemsStr() {
      return [];
    }
    get textDivs() {
      return [];
    }
  },
  getDocument: vi.fn(),
}));

function makePage(streamTextContent: ReturnType<typeof vi.fn>): PDFPageProxy {
  return {
    getViewport: () => ({ height: 800, scale: 1, width: 600 }),
    pageNumber: 1,
    render: () => ({ cancel() {}, promise: Promise.resolve() }),
    streamTextContent,
  } as unknown as PDFPageProxy;
}

describe("PdfPage text extraction", () => {
  it("requests text with disableNormalization so find offsets align", () => {
    const streamTextContent = vi.fn(() => ({}));
    render(<PdfPage page={makePage(streamTextContent)} scale={1} />);

    // 페이지는 IntersectionObserver로 지연 마운트된다 — 교차를 수동 발화
    const observers = (
      globalThis as unknown as {
        MockIntersectionObserver: { instances: { triggerIntersect(): void }[] };
      }
    ).MockIntersectionObserver.instances;
    observers[observers.length - 1].triggerIntersect();

    expect(streamTextContent).toHaveBeenCalledWith({
      disableNormalization: true,
    });
  });
});
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

```bash
npx vitest run src/components/editor/pdf/__tests__/pdf-page.test.tsx > /tmp/t1.log 2>&1; echo $?
```

Expected: FAIL — `Failed to resolve import "../PdfPage"`

- [ ] **Step 3: `PdfPage.tsx`를 만든다**

기존 `src/components/editor/PdfPreview.tsx:148-229`의 `PdfPage` 함수를 그대로 옮기되, 텍스트 레이어 소스만 바꾼다.

```tsx
// §5.1 PDF 페이지 — canvas + 텍스트 레이어. 뷰포트 근처에서만 렌더한다.
import type { CSSProperties } from "react";
import type { PDFPageProxy } from "pdfjs-dist";

import { useEffect, useRef, useState } from "react";

import { TextLayer } from "pdfjs-dist/legacy/build/pdf.mjs";

/** 뷰포트 밖 이만큼까지 미리 렌더한다. */
const LAZY_ROOT_MARGIN = "800px";

export function PdfPage({
  page,
  scale,
}: {
  page: PDFPageProxy;
  scale: number;
}) {
  const holderRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textLayerRef = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);

  const viewport = page.getViewport({ scale });

  useEffect(() => {
    const el = holderRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => setVisible(entries[0]?.isIntersecting ?? false),
      { rootMargin: LAZY_ROOT_MARGIN },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(viewport.width * dpr);
    canvas.height = Math.floor(viewport.height * dpr);
    const renderTask = page.render({
      canvas,
      transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0],
      viewport,
    });
    renderTask.promise.catch(() => {
      // 줌 변경/스크롤 이탈로 취소됨 — 정상 경로
    });
    return () => renderTask.cancel();
    // viewport는 (page, scale)에서 파생된다 — 아래 deps가 이를 포괄한다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, page, scale]);

  useEffect(() => {
    if (!visible) return;
    const container = textLayerRef.current;
    if (!container) return;
    container.replaceChildren();
    // §272.4 disableNormalization: PDFFindController가 같은 옵션으로 텍스트를
    // 추출한다(pdf_viewer.mjs:6134). 이 옵션이 빠지면 item 문자열이 달라져
    // 찾기 매치 오프셋이 어긋난다.
    const textLayer = new TextLayer({
      container,
      textContentSource: page.streamTextContent({
        disableNormalization: true,
      }),
      viewport,
    });
    textLayer.render().catch(() => {
      // 줌 변경/스크롤 이탈로 취소됨 — 정상 경로
    });
    return () => textLayer.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, page, scale]);

  return (
    <div
      className="pdf-page"
      ref={holderRef}
      style={
        {
          // TextLayer가 폰트 메트릭 계산에 읽는다 (PDF.js v5+)
          "--total-scale-factor": String(viewport.scale),
          height: viewport.height,
          width: viewport.width,
        } as CSSProperties
      }
    >
      {visible && (
        <>
          <canvas ref={canvasRef} />
          <div className="pdf-text-layer" ref={textLayerRef} />
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 4: 테스트를 돌려 통과를 확인한다**

```bash
npx vitest run src/components/editor/pdf/__tests__/pdf-page.test.tsx > /tmp/t1.log 2>&1; echo $?
```

Expected: PASS (exit 0)

- [ ] **Step 5: `PdfPreview.tsx`를 `pdf/`로 옮긴다**

`src/components/editor/pdf/PdfPreview.tsx`를 만들고, 기존 파일의 1–146행(문서 로드 · 페이지 목록 · baseScale · 렌더)을 그대로 옮긴다. `PdfPage`는 `./PdfPage`에서 import한다. 기존 파일 하단의 `PdfPage` 정의는 옮기지 않는다(Step 3에서 이미 이설). 그 뒤 `src/components/editor/PdfPreview.tsx`를 삭제한다.

- [ ] **Step 6: `App.tsx`의 lazy import 경로를 고친다**

`src/App.tsx:123-126`:

```tsx
const PdfPreview = lazy(() =>
  import("./components/editor/pdf/PdfPreview").then((m) => ({
    default: m.PdfPreview,
  })),
);
```

- [ ] **Step 7: PDF CSS를 전용 파일로 분리한다**

`src/styles/editor/html-preview.css`에서 `.pdf-*` 규칙(6행 `.editor-area-scroll.pdf-preview-scroll`부터 `.pdf-text-layer ::selection`까지)을 잘라내어 `src/styles/editor/pdf.css`로 옮긴다. `src/styles/editor.css:13` 다음 줄에 추가한다:

```css
@import "./editor/pdf.css"; /* §5.1 / §270 pdf 뷰어 — 페이지, 텍스트 레이어, 툴바, 하이라이트 */
```

그리고 `html-preview.css` 상단 주석을 html 전용으로 고친다.

- [ ] **Step 8: 전체 게이트를 돌린다**

```bash
npm run typecheck > /tmp/tc.log 2>&1; echo "typecheck=$?"
npx vitest run > /tmp/vt.log 2>&1; echo "vitest=$?"
```

Expected: 둘 다 0. 실패하면 로그를 읽고 고친 뒤 재실행.

- [ ] **Step 9: 앱에서 회귀가 없는지 확인한다 (GUI)**

`npm run tauri dev` → PDF 파일을 연다. 확인 항목: 페이지가 렌더되는가 · `Cmd+=`/`Cmd+-`/`Cmd+0` 줌이 도는가 · 텍스트 선택과 `Cmd+C`가 되는가 · 스크롤 시 뒤쪽 페이지가 렌더되는가.

- [ ] **Step 10: 커밋한다**

```bash
git add src/components/editor/pdf/ src/App.tsx src/styles/editor.css src/styles/editor/
git rm src/components/editor/PdfPreview.tsx
git commit -m "refactor(§271): split PdfPreview into pdf/ modules and pin disableNormalization"
```

---

## Phase B — PDF 내 찾기 (PR 2)

### Task 2: 매치 오프셋 → (divIdx, offset) 변환

**Files:**
- Create: `src/components/editor/pdf/pdf-find.ts`
- Test: `src/components/editor/pdf/__tests__/pdf-find.test.ts`

**Interfaces:**
- Consumes: 없음 (순수 함수)
- Produces:
  - `interface MatchPosition { begin: { divIdx: number; offset: number }; end: { divIdx: number; offset: number } }`
  - `convertMatches(matches: number[], matchesLength: number[], textItems: string[]): MatchPosition[]`

**배경:** `TextHighlighter`는 pdfjs 번들에서 export되지 않는다(클래스는 `pdf_viewer.mjs:10872`에 있으나 export 목록 `:14754`과 `globalThis.pdfjsViewer` `:14729` 어디에도 없다). 그 안의 `_convertMatches`(`:10920`)를 이식한다. 입력은 `textContentItemsStr` 하나뿐인 순수 산술이다.

`findController.pageMatches` / `pageMatchesLength`의 오프셋은 **이미 원문 기준**이다 — `#calculateMatch`가 `getOriginalIndex(diffs, ...)`로 정규화 인덱스를 되돌린 뒤 배열에 넣는다(`:6072`). 정규화 역매핑은 우리 몫이 아니다.

- [ ] **Step 1: 실패하는 테스트를 작성한다**

`src/components/editor/pdf/__tests__/pdf-find.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { convertMatches } from "../pdf-find";

describe("convertMatches", () => {
  // 누적 인덱스:  "Hello "=0..5  "world"=6..10  " again"=11..16
  const items = ["Hello ", "world", " again"];

  it("maps a match inside a single div", () => {
    // "world" @ 6, length 5
    expect(convertMatches([6], [5], items)).toEqual([
      { begin: { divIdx: 1, offset: 0 }, end: { divIdx: 1, offset: 5 } },
    ]);
  });

  it("maps a match spanning two divs", () => {
    // "lo wo" @ 3, length 5 → div0 offset 3 ~ div1 offset 2
    expect(convertMatches([3], [5], items)).toEqual([
      { begin: { divIdx: 0, offset: 3 }, end: { divIdx: 1, offset: 2 } },
    ]);
  });

  it("maps multiple ascending matches", () => {
    expect(convertMatches([0, 11], [5, 6], items)).toEqual([
      { begin: { divIdx: 0, offset: 0 }, end: { divIdx: 0, offset: 5 } },
      { begin: { divIdx: 2, offset: 0 }, end: { divIdx: 2, offset: 6 } },
    ]);
  });

  it("clamps a match that ends at the last div", () => {
    // " again" @ 11, length 6 — 마지막 div 끝
    expect(convertMatches([11], [6], items)).toEqual([
      { begin: { divIdx: 2, offset: 0 }, end: { divIdx: 2, offset: 6 } },
    ]);
  });

  it("returns empty for no matches or no items", () => {
    expect(convertMatches([], [], items)).toEqual([]);
    expect(convertMatches([0], [1], [])).toEqual([]);
  });
});
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

```bash
npx vitest run src/components/editor/pdf/__tests__/pdf-find.test.ts > /tmp/t2.log 2>&1; echo $?
```

Expected: FAIL — `Failed to resolve import "../pdf-find"`

- [ ] **Step 3: 최소 구현을 작성한다**

`src/components/editor/pdf/pdf-find.ts`:

```ts
// §272 PDF 내 찾기 — pdfjs PDFFindController 어댑터와 매치 위치 변환.

/** 텍스트 레이어 span 좌표로 표현된 매치 하나의 시작/끝. */
export interface MatchPosition {
  begin: { divIdx: number; offset: number };
  end: { divIdx: number; offset: number };
}

/**
 * findController의 원문 오프셋 매치를 텍스트 레이어 span 좌표로 변환한다.
 * pdfjs `TextHighlighter._convertMatches`(pdf_viewer.mjs:10920) 이식 —
 * 그 클래스가 번들에서 export되지 않기 때문이다.
 *
 * matches는 오름차순이라고 가정한다 (findController가 그렇게 만든다).
 */
export function convertMatches(
  matches: number[],
  matchesLength: number[],
  textItems: string[],
): MatchPosition[] {
  if (matches.length === 0 || textItems.length === 0) return [];

  const result: MatchPosition[] = [];
  const last = textItems.length - 1;
  let i = 0;
  let iIndex = 0;

  for (let m = 0; m < matches.length; m++) {
    let matchIdx = matches[m];
    while (i !== last && matchIdx >= iIndex + textItems[i].length) {
      iIndex += textItems[i].length;
      i++;
    }
    const begin = { divIdx: i, offset: matchIdx - iIndex };

    matchIdx += matchesLength[m];
    while (i !== last && matchIdx > iIndex + textItems[i].length) {
      iIndex += textItems[i].length;
      i++;
    }
    result.push({ begin, end: { divIdx: i, offset: matchIdx - iIndex } });
  }

  return result;
}
```

- [ ] **Step 4: 테스트를 돌려 통과를 확인한다**

```bash
npx vitest run src/components/editor/pdf/__tests__/pdf-find.test.ts > /tmp/t2.log 2>&1; echo $?
```

Expected: PASS (exit 0)

- [ ] **Step 5: 커밋한다**

```bash
git add src/components/editor/pdf/pdf-find.ts src/components/editor/pdf/__tests__/pdf-find.test.ts
git commit -m "feat(§272): port pdfjs match-offset to text-layer coordinate conversion"
```

---

### Task 3: FindController 로더와 linkService 어댑터

**Files:**
- Modify: `src/components/editor/pdf/pdf-find.ts`
- Test: `src/components/editor/pdf/__tests__/pdf-find-adapter.test.ts`

**Interfaces:**
- Consumes: Task 2의 `convertMatches`
- Produces:
  - `interface PdfLinkServiceAdapter { readonly pagesCount: number; page: number }`
  - `createLinkService(opts: { pagesCount: number; getPage: () => number; scrollToPage: (n: number) => void }): PdfLinkServiceAdapter`
  - `loadPdfViewerModule(): Promise<PdfViewerModule>` — `{ EventBus, PDFFindController, FindState }`

**배경:** `pdf_viewer.mjs`는 core를 import하지 않고 `globalThis.pdfjsLib`에서 구조분해한다(`:5033`). 그 전역은 `pdf.mjs`가 평가될 때 스스로 설정한다(`pdf.mjs:34374`). 두 모듈 사이에 의존 간선이 없으므로 **정적 import는 순서를 보장하지 못한다** — 동적 import를 쓴다. ES 모듈은 싱글턴이라 이미 로드됐으면 재평가 비용이 없다.

`PDFFindController`가 요구하는 뷰어 표면은 `pagesCount` / `page`(get·set) / `onIsPageVisible` 셋뿐이다(`:5997, 6091, 6138, 6178, 6193`).

- [ ] **Step 1: 실패하는 테스트를 작성한다**

`src/components/editor/pdf/__tests__/pdf-find-adapter.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

import { createLinkService } from "../pdf-find";

describe("createLinkService", () => {
  it("exposes pagesCount and reads the current page through getPage", () => {
    let current = 3;
    const svc = createLinkService({
      getPage: () => current,
      pagesCount: 27,
      scrollToPage: vi.fn(),
    });

    expect(svc.pagesCount).toBe(27);
    expect(svc.page).toBe(3);
    current = 9;
    expect(svc.page).toBe(9);
  });

  it("routes page assignment to scrollToPage instead of storing it", () => {
    const scrollToPage = vi.fn();
    const svc = createLinkService({
      getPage: () => 1,
      pagesCount: 5,
      scrollToPage,
    });

    svc.page = 4;

    expect(scrollToPage).toHaveBeenCalledWith(4);
    // setter는 값을 저장하지 않는다 — 진실은 getPage 쪽에 있다
    expect(svc.page).toBe(1);
  });
});
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

```bash
npx vitest run src/components/editor/pdf/__tests__/pdf-find-adapter.test.ts > /tmp/t3.log 2>&1; echo $?
```

Expected: FAIL — `createLinkService is not a function`

- [ ] **Step 3: 어댑터와 로더를 구현한다**

`src/components/editor/pdf/pdf-find.ts` 하단에 추가:

```ts
/** PDFFindController가 뷰어에게 요구하는 최소 표면. */
export interface PdfLinkServiceAdapter {
  page: number;
  readonly pagesCount: number;
}

/**
 * PDFFindController용 linkService 어댑터.
 * `page` setter는 값을 저장하지 않고 스크롤로 위임한다 — 현재 페이지의
 * 진실은 스크롤 위치이지 이 객체가 아니다.
 */
export function createLinkService({
  getPage,
  pagesCount,
  scrollToPage,
}: {
  getPage: () => number;
  pagesCount: number;
  scrollToPage: (n: number) => void;
}): PdfLinkServiceAdapter {
  return {
    get page() {
      return getPage();
    },
    set page(n: number) {
      scrollToPage(n);
    },
    get pagesCount() {
      return pagesCount;
    },
  };
}

/**
 * pdfjs 뷰어 컴포넌트를 로드한다.
 *
 * ‼️ 정적 import 금지: pdf_viewer.mjs는 globalThis.pdfjsLib에서
 * 구조분해하는데(pdf_viewer.mjs:5033) 그 전역은 pdf.mjs가 평가될 때
 * 설정된다(pdf.mjs:34374). 두 모듈 사이에 의존 간선이 없어 정적 import는
 * 순서를 보장하지 못한다 — 순서가 뒤집히면 모듈 평가 시점에
 * "Cannot destructure property of undefined"로 죽는다.
 */
export async function loadPdfViewerModule() {
  await import("pdfjs-dist/legacy/build/pdf.mjs"); // globalThis.pdfjsLib 설정
  return import("pdfjs-dist/legacy/web/pdf_viewer.mjs");
}
```

- [ ] **Step 4: 테스트를 돌려 통과를 확인한다**

```bash
npx vitest run src/components/editor/pdf/__tests__/pdf-find-adapter.test.ts > /tmp/t3.log 2>&1; echo $?
```

Expected: PASS (exit 0)

- [ ] **Step 5: 실앱에서 동적 로드가 성립하는지 확인한다 (GUI 스파이크)**

이 계획에서 유일하게 단위 테스트로 증명할 수 없는 항목이다 — jsdom에서 `pdf_viewer.mjs`를 평가하면 전역 설정 순서를 실제 번들러가 아니라 vitest가 결정하기 때문이다.

`npm run tauri dev` → PDF를 연 뒤 DevTools 콘솔:

```js
const m = await import("pdfjs-dist/legacy/web/pdf_viewer.mjs");
console.log(typeof m.PDFFindController, typeof m.EventBus, typeof m.TextHighlighter);
```

Expected: `function function undefined` — 앞의 둘이 `function`이면 성공. `TextHighlighter`가 `undefined`인 것이 정상이며(Task 2가 존재하는 이유), 만약 `function`으로 나오면 pdfjs가 export를 추가한 것이니 Task 2를 삭제하고 그것을 쓴다.

- [ ] **Step 6: 커밋한다**

```bash
git add src/components/editor/pdf/pdf-find.ts src/components/editor/pdf/__tests__/pdf-find-adapter.test.ts
git commit -m "feat(§272): add PDFFindController link-service adapter and ordered loader"
```

---

### Task 4: 매치 DOM 렌더링과 PdfPage 통합

**Files:**
- Create: `src/components/editor/pdf/pdf-find-render.ts`
- Modify: `src/components/editor/pdf/PdfPage.tsx`, `src/styles/editor/pdf.css`
- Test: `src/components/editor/pdf/__tests__/pdf-find-render.test.ts`

**Interfaces:**
- Consumes: Task 2의 `MatchPosition` · `convertMatches`
- Produces:
  - `renderMatches(textDivs: HTMLElement[], positions: MatchPosition[], currentIdx: number): void`
  - `clearMatches(textDivs: HTMLElement[]): void`

**설계:** 매치는 텍스트 레이어 span 안을 `<span class="pdf-find-match">`로 감싸 표시한다. 현재 매치에는 `pdf-find-match-current`를 추가한다. 원본 텍스트를 잃지 않도록 각 div의 원문을 `dataset.pdfOriginalText`에 보관하고, 지울 때 그것으로 복원한다.

- [ ] **Step 1: 실패하는 테스트를 작성한다**

`src/components/editor/pdf/__tests__/pdf-find-render.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";

import { clearMatches, renderMatches } from "../pdf-find-render";

function makeDivs(texts: string[]): HTMLElement[] {
  return texts.map((t) => {
    const el = document.createElement("span");
    el.textContent = t;
    return el;
  });
}

describe("renderMatches", () => {
  let divs: HTMLElement[];

  beforeEach(() => {
    divs = makeDivs(["Hello ", "world", " again"]);
  });

  it("wraps a match inside one div", () => {
    renderMatches(
      divs,
      [{ begin: { divIdx: 1, offset: 0 }, end: { divIdx: 1, offset: 5 } }],
      -1,
    );

    const marks = divs[1].querySelectorAll(".pdf-find-match");
    expect(marks).toHaveLength(1);
    expect(marks[0].textContent).toBe("world");
    // 전체 텍스트는 보존된다
    expect(divs[1].textContent).toBe("world");
  });

  it("wraps the tail and head when a match spans two divs", () => {
    renderMatches(
      divs,
      [{ begin: { divIdx: 0, offset: 3 }, end: { divIdx: 1, offset: 2 } }],
      -1,
    );

    expect(divs[0].querySelector(".pdf-find-match")?.textContent).toBe("lo ");
    expect(divs[1].querySelector(".pdf-find-match")?.textContent).toBe("wo");
    expect(divs[0].textContent).toBe("Hello ");
    expect(divs[1].textContent).toBe("world");
  });

  it("marks only the current match", () => {
    renderMatches(
      divs,
      [
        { begin: { divIdx: 0, offset: 0 }, end: { divIdx: 0, offset: 5 } },
        { begin: { divIdx: 2, offset: 1 }, end: { divIdx: 2, offset: 6 } },
      ],
      1,
    );

    expect(divs[0].querySelector(".pdf-find-match-current")).toBeNull();
    expect(divs[2].querySelector(".pdf-find-match-current")).not.toBeNull();
  });

  it("restores original text on clear", () => {
    renderMatches(
      divs,
      [{ begin: { divIdx: 1, offset: 0 }, end: { divIdx: 1, offset: 5 } }],
      -1,
    );
    clearMatches(divs);

    expect(divs[1].querySelector(".pdf-find-match")).toBeNull();
    expect(divs[1].textContent).toBe("world");
  });

  it("is idempotent — re-rendering does not nest marks", () => {
    const positions = [
      { begin: { divIdx: 1, offset: 0 }, end: { divIdx: 1, offset: 5 } },
    ];
    renderMatches(divs, positions, -1);
    renderMatches(divs, positions, -1);

    expect(divs[1].querySelectorAll(".pdf-find-match")).toHaveLength(1);
    expect(divs[1].textContent).toBe("world");
  });
});
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

```bash
npx vitest run src/components/editor/pdf/__tests__/pdf-find-render.test.ts > /tmp/t4.log 2>&1; echo $?
```

Expected: FAIL — `Failed to resolve import "../pdf-find-render"`

- [ ] **Step 3: 렌더러를 구현한다**

`src/components/editor/pdf/pdf-find-render.ts`:

```ts
// §272 찾기 매치를 텍스트 레이어 span에 칠한다.
// pdfjs TextHighlighter가 export되지 않아 직접 구현한다 (pdf-find.ts 주석 참조).
import type { MatchPosition } from "./pdf-find";

const MATCH_CLASS = "pdf-find-match";
const CURRENT_CLASS = "pdf-find-match-current";
const ORIGINAL_KEY = "pdfOriginalText";

/** div 하나에 대한 [시작, 끝) 구간들. */
interface Span {
  end: number;
  isCurrent: boolean;
  start: number;
}

/** 원문을 처음 볼 때 보관한다. 이후 렌더는 항상 이 값에서 다시 시작한다. */
function originalText(div: HTMLElement): string {
  if (div.dataset[ORIGINAL_KEY] === undefined) {
    div.dataset[ORIGINAL_KEY] = div.textContent ?? "";
  }
  return div.dataset[ORIGINAL_KEY];
}

/** 모든 div를 원문으로 되돌린다. */
export function clearMatches(textDivs: HTMLElement[]): void {
  for (const div of textDivs) {
    const original = div.dataset[ORIGINAL_KEY];
    if (original === undefined) continue;
    div.textContent = original;
  }
}

/**
 * 매치 위치들을 텍스트 레이어에 칠한다.
 * 항상 원문에서 다시 그리므로 반복 호출해도 중첩되지 않는다.
 */
export function renderMatches(
  textDivs: HTMLElement[],
  positions: MatchPosition[],
  currentIdx: number,
): void {
  // div 인덱스 → 그 div 안에서 칠할 구간들
  const perDiv = new Map<number, Span[]>();

  positions.forEach((pos, idx) => {
    const isCurrent = idx === currentIdx;
    for (let d = pos.begin.divIdx; d <= pos.end.divIdx; d++) {
      const div = textDivs[d];
      if (!div) continue;
      const text = originalText(div);
      const start = d === pos.begin.divIdx ? pos.begin.offset : 0;
      const end = d === pos.end.divIdx ? pos.end.offset : text.length;
      if (end <= start) continue;
      const list = perDiv.get(d) ?? [];
      list.push({ end, isCurrent, start });
      perDiv.set(d, list);
    }
  });

  clearMatches(textDivs);

  for (const [divIdx, spans] of perDiv) {
    const div = textDivs[divIdx];
    const text = originalText(div);
    spans.sort((a, b) => a.start - b.start);

    const frag = document.createDocumentFragment();
    let cursor = 0;
    for (const span of spans) {
      if (span.start > cursor) {
        frag.append(text.slice(cursor, span.start));
      }
      const mark = document.createElement("span");
      mark.className = span.isCurrent
        ? `${MATCH_CLASS} ${CURRENT_CLASS}`
        : MATCH_CLASS;
      mark.textContent = text.slice(span.start, span.end);
      frag.append(mark);
      cursor = span.end;
    }
    if (cursor < text.length) {
      frag.append(text.slice(cursor));
    }
    div.replaceChildren(frag);
  }
}
```

- [ ] **Step 4: 테스트를 돌려 통과를 확인한다**

```bash
npx vitest run src/components/editor/pdf/__tests__/pdf-find-render.test.ts > /tmp/t4.log 2>&1; echo $?
```

Expected: PASS (exit 0)

- [ ] **Step 5: 스타일을 추가한다**

`src/styles/editor/pdf.css` 하단:

```css
/* §272 찾기 매치 — 텍스트 레이어는 투명 텍스트이므로 배경만 칠한다 */
.pdf-text-layer .pdf-find-match {
  background: var(--color-editor-find-match);
  border-radius: 2px;
}

.pdf-text-layer .pdf-find-match-current {
  background: var(--color-editor-find-match-current);
}
```

- [ ] **Step 6: 색 토큰을 추가한다**

`tokens/semantic/color-light.json`과 `tokens/semantic/color-dark.json`의 `color.editor` 그룹에 `find-match`와 `find-match-current`를 추가한다. 기존 `color.editor.selection` 항목의 형식을 그대로 따른다. 그 뒤:

```bash
npm run tokens:build > /tmp/tok.log 2>&1; echo $?
npm run audit:css-vars > /tmp/audit.log 2>&1; echo $?
```

Expected: 둘 다 0. `audit:css-vars`가 미정의 변수를 잡으면 토큰 이름 오타다.

- [ ] **Step 7: `PdfPage`에 매치 렌더를 배선한다**

`PdfPage`에 prop을 추가한다 — `matches?: { positions: MatchPosition[]; currentIdx: number }`. 텍스트 레이어 렌더가 끝난 뒤 `textLayer.textDivs`를 ref에 보관하고, `matches`가 바뀔 때마다 `renderMatches(divsRef.current, matches.positions, matches.currentIdx)`를 호출한다. `matches`가 없으면 `clearMatches`.

텍스트 레이어를 다시 그리면(줌 변경) `dataset.pdfOriginalText`가 없는 새 div가 생기므로 별도 초기화는 필요 없다.

- [ ] **Step 8: 전체 게이트를 돌린다**

```bash
npm run typecheck > /tmp/tc.log 2>&1; echo "typecheck=$?"
npx vitest run > /tmp/vt.log 2>&1; echo "vitest=$?"
```

Expected: 둘 다 0.

- [ ] **Step 9: 커밋한다**

```bash
git add src/components/editor/pdf/ src/styles/editor/pdf.css tokens/ src/styles/generated/
git commit -m "feat(§272): render find matches onto the PDF text layer"
```

---

### Task 5: 찾기 UI와 Cmd+F 라우팅

**Files:**
- Create: `src/components/editor/pdf/PdfFindBar.tsx`
- Modify: `src/components/editor/pdf/PdfPreview.tsx`, `src/App.tsx`, `src/i18n/en.json`, `src/i18n/ko.json`, `src/styles/editor/pdf.css`
- Test: `src/components/editor/pdf/__tests__/pdf-find-bar.test.tsx`

**Interfaces:**
- Consumes: Task 3의 `createLinkService` · `loadPdfViewerModule`, Task 2의 `convertMatches`, Task 4의 `renderMatches`
- Produces: `PdfFindBar` — `{ matchCount: number; currentIdx: number; onQueryChange: (q: string, caseSensitive: boolean) => void; onNext: () => void; onPrev: () => void; onClose: () => void }`

**설계:** `PdfPreview`가 `PDFFindController`를 소유한다. `doc`이 로드되면 `findController.setDocument(doc)`, 언마운트 시 정리. `eventBus`의 `updatefindmatchescount` / `updatefindcontrolstate`를 구독해 카운트와 현재 인덱스를 state로 올린다.

**lazy 페이지 주의:** 화면 밖 페이지에는 텍스트 레이어 DOM이 없다. 매치 개수와 이동은 영향받지 않는다(`PDFFindController`는 `getTextContent`로 전 페이지를 스캔한다). 페이지가 마운트될 때 그 페이지의 매치를 다시 칠하면 된다 — Task 4에서 `matches` prop이 바뀌면 다시 그리도록 만들었으므로 자동으로 성립한다.

- [ ] **Step 1: 실패하는 테스트를 작성한다**

`src/components/editor/pdf/__tests__/pdf-find-bar.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { PdfFindBar } from "../PdfFindBar";

const noop = () => {};

function setup(overrides: Partial<Parameters<typeof PdfFindBar>[0]> = {}) {
  const props = {
    currentIdx: 0,
    matchCount: 0,
    onClose: noop,
    onNext: noop,
    onPrev: noop,
    onQueryChange: noop,
    ...overrides,
  };
  render(<PdfFindBar {...props} />);
  return props;
}

describe("PdfFindBar", () => {
  it("reports the query and case-sensitivity upward", async () => {
    const onQueryChange = vi.fn();
    setup({ onQueryChange });

    await userEvent.type(screen.getByRole("searchbox"), "attention");

    expect(onQueryChange).toHaveBeenLastCalledWith("attention", false);
  });

  it("shows a 1-based match position", () => {
    setup({ currentIdx: 2, matchCount: 27 });
    expect(screen.getByText("3 / 27")).toBeInTheDocument();
  });

  it("shows no-results state when the query found nothing", () => {
    setup({ currentIdx: -1, matchCount: 0 });
    expect(screen.getByText("0 / 0")).toBeInTheDocument();
  });

  it("closes on Escape", async () => {
    const onClose = vi.fn();
    setup({ onClose });

    await userEvent.type(screen.getByRole("searchbox"), "{Escape}");

    expect(onClose).toHaveBeenCalled();
  });

  it("moves to the next match on Enter and the previous on Shift+Enter", async () => {
    const onNext = vi.fn();
    const onPrev = vi.fn();
    setup({ matchCount: 3, onNext, onPrev });

    const input = screen.getByRole("searchbox");
    await userEvent.type(input, "{Enter}");
    expect(onNext).toHaveBeenCalledTimes(1);

    await userEvent.type(input, "{Shift>}{Enter}{/Shift}");
    expect(onPrev).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

```bash
npx vitest run src/components/editor/pdf/__tests__/pdf-find-bar.test.tsx > /tmp/t5.log 2>&1; echo $?
```

Expected: FAIL — `Failed to resolve import "../PdfFindBar"`

- [ ] **Step 3: `PdfFindBar`를 구현한다**

`src/components/editor/pdf/PdfFindBar.tsx`. 요소: `input[type="search"]`(자동 포커스), 대소문자 구분 토글, `{currentIdx + 1} / {matchCount}` 카운트(매치 0이면 `0 / 0`), 이전/다음 버튼, 닫기 버튼. 키 처리는 `Enter` = next, `Shift+Enter` = prev, `Escape` = close. 버튼은 `.btn-unstyled` / `.icon-btn` 공유 유틸을 쓰고 문자열은 `useTranslation`으로 뺀다.

- [ ] **Step 4: 테스트를 돌려 통과를 확인한다**

```bash
npx vitest run src/components/editor/pdf/__tests__/pdf-find-bar.test.tsx > /tmp/t5.log 2>&1; echo $?
```

Expected: PASS (exit 0)

- [ ] **Step 5: i18n 키를 추가한다**

`src/i18n/en.json`과 `src/i18n/ko.json`에 같은 키를 추가한다 (기존 `keybindings.edit.find` 등의 평면 키 형식을 따른다):

```
pdfFind.placeholder      "Find in PDF"        / "PDF에서 찾기"
pdfFind.matchCase        "Match case"         / "대소문자 구분"
pdfFind.previous         "Previous match"     / "이전 일치"
pdfFind.next             "Next match"         / "다음 일치"
pdfFind.close            "Close find"         / "찾기 닫기"
```

- [ ] **Step 6: `PdfPreview`에 FindController를 배선한다**

`doc`이 준비되면 `loadPdfViewerModule()`로 모듈을 받아 `EventBus`와 `PDFFindController`를 만들고 `setDocument(doc)`. `createLinkService`로 어댑터를 넘기고 `onIsPageVisible`을 연결한다. `updatefindmatchescount` / `updatefindcontrolstate` 구독으로 카운트·현재 인덱스를 state에 올리고, `pageMatches`/`pageMatchesLength`를 `convertMatches`에 넣어 각 `PdfPage`에 `matches` prop으로 내린다. 언마운트 시 eventBus 구독 해제 + `findController.setDocument(null)`.

- [ ] **Step 7: Cmd+F를 라우팅한다**

`src/App.tsx`에서 PDF 탭이 활성일 때(`isPdfTab`) `findReplaceOpen` 대신 PDF 찾기 상태를 토글하도록 분기한다. 기존 `FindReplaceBar` 마운트 조건(`App.tsx:959`)은 마크다운 편집기 분기 안에 있으므로 건드리지 않고, PDF 분기(`App.tsx:874-886`)에 `PdfFindBar`를 추가한다.

- [ ] **Step 8: 전체 게이트를 돌린다**

```bash
npm run typecheck > /tmp/tc.log 2>&1; echo "typecheck=$?"
npx vitest run > /tmp/vt.log 2>&1; echo "vitest=$?"
```

Expected: 둘 다 0.

- [ ] **Step 9: 실앱에서 확인한다 (GUI)**

`npm run tauri dev` → 여러 페이지짜리 PDF를 연다. 확인 항목:
- `Cmd+F`로 찾기바가 열리고 포커스가 잡히는가
- 문서 전체 매치 수가 맞는가 (화면 밖 페이지 포함)
- `Enter`/`Shift+Enter`로 이동하면 해당 페이지로 스크롤되고 현재 매치가 다른 색으로 강조되는가
- **합자가 있는 논문 PDF**(예: "efficient"의 `ffi`)에서 매치가 올바른 글자에 칠해지는가 — Task 1의 `disableNormalization`이 실제로 작동하는지 보는 지점이다
- 줌을 바꿔도 매치 강조가 유지되는가
- `Esc`로 닫히고 강조가 사라지는가

- [ ] **Step 10: 커밋하고 PR을 연다**

```bash
git add src/components/editor/pdf/ src/App.tsx src/i18n/ src/styles/editor/pdf.css
git commit -m "feat(§272): add find-in-PDF bar with Cmd+F routing"
```

---

## Phase C — 텍스트 하이라이트 + reference (PR 3)

### Task 6: 좌표 변환

**Files:**
- Create: `src/components/editor/pdf/pdf-highlight-geom.ts`
- Test: `src/components/editor/pdf/__tests__/pdf-highlight-geom.test.ts`

**Interfaces:**
- Consumes: 없음 (순수 함수)
- Produces:
  - `interface PdfRect { h: number; w: number; x: number; y: number }`
  - `interface ViewportLike { convertToPdfPoint(x: number, y: number): number[]; convertToViewportPoint(x: number, y: number): number[] }`
  - `clientRectToPdf(rect: DOMRectLike, pageOrigin: { left: number; top: number }, viewport: ViewportLike): PdfRect`
  - `pdfRectToPageLocal(r: PdfRect, viewport: ViewportLike): { height: number; left: number; top: number; width: number }`
  - `type DOMRectLike = { height: number; left: number; top: number; width: number }`

**설계:** 하이라이트 기하는 **PDF user space**(scale 1, 회전 미적용)에 저장한다. `viewport.convertToPdfPoint`(`pdf.mjs:6970`)와 그 역함수를 쓰므로 줌·리사이즈·회전·devicePixelRatio 변화에 모두 불변이다. `getBoundingClientRect`는 WKWebView에서 visual 좌표를 반환하지만 페이지 요소 기준 **상대** 좌표만 쓰므로 zoom 배율이 상쇄된다.

**테스트의 한계를 알고 쓸 것:** 아래 테스트는 왕복 항등(client → pdf → client)을 단정한다. 왕복 항등은 가역 변환이면 무엇이든 성립하므로 **pdfjs의 변환식이 맞는지는 증명하지 못한다** — 증명하는 것은 우리 쪽 합성 로직(페이지 원점 뺄셈, min/abs 처리, 좌표 순서)이다. 회전 케이스를 넣는 이유가 이것이다: x/y가 뒤바뀌는 변환에서 min/abs를 빠뜨린 구현은 여기서 죽는다. 실제 변환식의 정확성은 Step 5의 GUI 확인이 담당한다.

- [ ] **Step 1: 실패하는 테스트를 작성한다**

`src/components/editor/pdf/__tests__/pdf-highlight-geom.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import type { ViewportLike } from "../pdf-highlight-geom";

import { clientRectToPdf, pdfRectToPageLocal } from "../pdf-highlight-geom";

/**
 * 뷰포트 대역. pdfjs PageViewport를 직접 만들 수 없으므로
 * (PDFPageProxy가 필요하다) 가역 아핀 변환으로 대신한다.
 * 왕복 항등만 단정하므로 이 대역이 pdfjs와 달라도 결론은 유효하다.
 */
function makeViewport(
  scale: number,
  rotate: 0 | 90,
  pageHeight = 800,
): ViewportLike {
  if (rotate === 0) {
    // PDF는 y축이 위로, 화면은 아래로 — 뒤집힌다
    return {
      convertToPdfPoint: (x, y) => [x / scale, (pageHeight * scale - y) / scale],
      convertToViewportPoint: (x, y) => [
        x * scale,
        pageHeight * scale - y * scale,
      ],
    };
  }
  // 90도 회전 — x와 y가 뒤바뀐다
  return {
    convertToPdfPoint: (x, y) => [y / scale, x / scale],
    convertToViewportPoint: (x, y) => [y * scale, x * scale],
  };
}

const PAGE_ORIGIN = { left: 120, top: 64 };

describe("coordinate round-trip", () => {
  it.each([
    ["scale 1", 1, 0 as const],
    ["scale 2.5", 2.5, 0 as const],
    ["scale 0.5", 0.5, 0 as const],
    ["rotated 90", 1.5, 90 as const],
  ])("survives client → pdf → page-local: %s", (_label, scale, rotate) => {
    const viewport = makeViewport(scale, rotate);
    const clientRect = {
      height: 14 * scale,
      left: PAGE_ORIGIN.left + 40 * scale,
      top: PAGE_ORIGIN.top + 200 * scale,
      width: 180 * scale,
    };

    const pdfRect = clientRectToPdf(clientRect, PAGE_ORIGIN, viewport);
    const back = pdfRectToPageLocal(pdfRect, viewport);

    // 페이지 로컬 좌표로 돌아오므로 원점을 뺀 값과 같아야 한다
    expect(back.left).toBeCloseTo(clientRect.left - PAGE_ORIGIN.left, 6);
    expect(back.top).toBeCloseTo(clientRect.top - PAGE_ORIGIN.top, 6);
    expect(back.width).toBeCloseTo(clientRect.width, 6);
    expect(back.height).toBeCloseTo(clientRect.height, 6);
  });

  it("always produces non-negative width and height", () => {
    // y축이 뒤집히는 변환에서 min/abs를 빠뜨리면 음수가 나온다
    const viewport = makeViewport(1, 0);
    const pdfRect = clientRectToPdf(
      { height: 14, left: PAGE_ORIGIN.left, top: PAGE_ORIGIN.top, width: 100 },
      PAGE_ORIGIN,
      viewport,
    );

    expect(pdfRect.w).toBeGreaterThan(0);
    expect(pdfRect.h).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

```bash
npx vitest run src/components/editor/pdf/__tests__/pdf-highlight-geom.test.ts > /tmp/t6.log 2>&1; echo $?
```

Expected: FAIL — `Failed to resolve import "../pdf-highlight-geom"`

- [ ] **Step 3: 변환 함수를 구현한다**

`src/components/editor/pdf/pdf-highlight-geom.ts`:

```ts
// §274 하이라이트 좌표 변환.
// 기하는 PDF user space(scale 1, 회전 미적용)에 저장한다 — 줌·리사이즈·
// 회전·devicePixelRatio 변화에 불변이기 때문이다.

/** PDF user space 사각형. */
export interface PdfRect {
  h: number;
  w: number;
  x: number;
  y: number;
}

export type DOMRectLike = {
  height: number;
  left: number;
  top: number;
  width: number;
};

/** pdfjs PageViewport에서 우리가 쓰는 부분만. */
export interface ViewportLike {
  convertToPdfPoint(x: number, y: number): number[];
  convertToViewportPoint(x: number, y: number): number[];
}

/**
 * 뷰포트 기준 client rect를 PDF user space로 변환한다.
 * pageOrigin은 .pdf-page의 getBoundingClientRect() — 페이지 로컬 좌표로
 * 만든 뒤 변환하므로 스크롤 위치와 CSS zoom 배율이 상쇄된다.
 */
export function clientRectToPdf(
  rect: DOMRectLike,
  pageOrigin: { left: number; top: number },
  viewport: ViewportLike,
): PdfRect {
  const x0 = rect.left - pageOrigin.left;
  const y0 = rect.top - pageOrigin.top;
  const [px0, py0] = viewport.convertToPdfPoint(x0, y0);
  const [px1, py1] = viewport.convertToPdfPoint(
    x0 + rect.width,
    y0 + rect.height,
  );

  // PDF는 y축이 위로 향하고 회전에서 축이 뒤바뀔 수 있다 —
  // 두 점 중 어느 쪽이 작은지 가정하지 않는다.
  return {
    h: Math.abs(py1 - py0),
    w: Math.abs(px1 - px0),
    x: Math.min(px0, px1),
    y: Math.min(py0, py1),
  };
}

/** PDF user space 사각형을 페이지 로컬 CSS 픽셀로 되돌린다. */
export function pdfRectToPageLocal(
  r: PdfRect,
  viewport: ViewportLike,
): { height: number; left: number; top: number; width: number } {
  const [vx0, vy0] = viewport.convertToViewportPoint(r.x, r.y);
  const [vx1, vy1] = viewport.convertToViewportPoint(r.x + r.w, r.y + r.h);

  return {
    height: Math.abs(vy1 - vy0),
    left: Math.min(vx0, vx1),
    top: Math.min(vy0, vy1),
    width: Math.abs(vx1 - vx0),
  };
}
```

- [ ] **Step 4: 테스트를 돌려 통과를 확인한다**

```bash
npx vitest run src/components/editor/pdf/__tests__/pdf-highlight-geom.test.ts > /tmp/t6.log 2>&1; echo $?
```

Expected: PASS (exit 0)

- [ ] **Step 5: 커밋한다**

```bash
git add src/components/editor/pdf/pdf-highlight-geom.ts src/components/editor/pdf/__tests__/pdf-highlight-geom.test.ts
git commit -m "feat(§274): add PDF user-space coordinate conversion for highlights"
```

---

### Task 7: 사이드카 스키마와 손상 내성 파싱

**Files:**
- Create: `src/components/editor/pdf/pdf-highlight-sidecar.ts`
- Test: `src/components/editor/pdf/__tests__/pdf-highlight-sidecar.test.ts`

**Interfaces:**
- Consumes: Task 6의 `PdfRect`
- Produces:
  - `type HighlightColor = "blue" | "green" | "pink" | "purple" | "yellow"`
  - `interface StoredHighlight { color: HighlightColor; id: string; kind: "area" | "text"; page: number; rects: PdfRect[] }`
  - `interface Sidecar { companion: string; highlights: StoredHighlight[]; pdf: string; version: 1 }`
  - `parseSidecar(raw: string): { dropped: number; sidecar: null | Sidecar }`
  - `sidecarPathFor(pdfRelPath: string): string`
  - `companionPathFor(pdfRelPath: string): string`

**설계 (§273.4):** 파싱은 **항목 단위로 실패**한다. 하이라이트 하나가 스키마에 안 맞는다고 파일 전체를 버리면 사용자는 모든 하이라이트를 잃는다. 잘못된 항목만 버리고 개수를 반환해 호출부가 로그를 남기게 한다.

- [ ] **Step 1: 실패하는 테스트를 작성한다**

`src/components/editor/pdf/__tests__/pdf-highlight-sidecar.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  companionPathFor,
  parseSidecar,
  sidecarPathFor,
} from "../pdf-highlight-sidecar";

const validHighlight = {
  color: "yellow",
  id: "h7k2m9",
  kind: "text",
  page: 3,
  rects: [{ h: 12.4, w: 380.5, x: 72.1, y: 540.3 }],
};

function sidecarJson(highlights: unknown[]): string {
  return JSON.stringify({
    companion: "highlights/papers/attention.md",
    highlights,
    pdf: "papers/attention.pdf",
    version: 1,
  });
}

describe("path derivation", () => {
  it("mirrors the PDF path under highlights/ for the companion note", () => {
    expect(companionPathFor("papers/attention.pdf")).toBe(
      "highlights/papers/attention.md",
    );
    expect(companionPathFor("research/nlp/bert.pdf")).toBe(
      "highlights/research/nlp/bert.md",
    );
  });

  it("mirrors the PDF path under .baram/pdf-highlights/ for the sidecar", () => {
    expect(sidecarPathFor("papers/attention.pdf")).toBe(
      ".baram/pdf-highlights/papers/attention.json",
    );
  });

  it("handles a PDF at the vault root", () => {
    expect(companionPathFor("attention.pdf")).toBe(
      "highlights/attention.md",
    );
    expect(sidecarPathFor("attention.pdf")).toBe(
      ".baram/pdf-highlights/attention.json",
    );
  });
});

describe("parseSidecar", () => {
  it("parses a well-formed sidecar", () => {
    const { sidecar, dropped } = parseSidecar(sidecarJson([validHighlight]));

    expect(dropped).toBe(0);
    expect(sidecar?.highlights).toHaveLength(1);
    expect(sidecar?.highlights[0].id).toBe("h7k2m9");
  });

  it("drops only the malformed entries and keeps the rest", () => {
    const { sidecar, dropped } = parseSidecar(
      sidecarJson([
        validHighlight,
        { id: "broken" }, // page/rects/color 없음
        { ...validHighlight, id: "p3n8q1", page: 4 },
        { ...validHighlight, id: "bad-color", color: "chartreuse" },
      ]),
    );

    expect(dropped).toBe(2);
    expect(sidecar?.highlights.map((h) => h.id)).toEqual(["h7k2m9", "p3n8q1"]);
  });

  it("returns null for unparseable JSON", () => {
    expect(parseSidecar("{not json").sidecar).toBeNull();
  });

  it("returns null for an unknown schema version", () => {
    const raw = JSON.stringify({
      companion: "x.md",
      highlights: [],
      pdf: "x.pdf",
      version: 99,
    });
    expect(parseSidecar(raw).sidecar).toBeNull();
  });

  it("returns an empty highlight list rather than null when highlights is absent", () => {
    const raw = JSON.stringify({
      companion: "x.md",
      pdf: "x.pdf",
      version: 1,
    });
    const { sidecar } = parseSidecar(raw);
    expect(sidecar?.highlights).toEqual([]);
  });
});
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

```bash
npx vitest run src/components/editor/pdf/__tests__/pdf-highlight-sidecar.test.ts > /tmp/t7.log 2>&1; echo $?
```

Expected: FAIL — `Failed to resolve import "../pdf-highlight-sidecar"`

- [ ] **Step 3: 스키마와 파서를 구현한다**

`src/components/editor/pdf/pdf-highlight-sidecar.ts`:

```ts
// §273 하이라이트 기하 사이드카 — 스키마, 경로 규칙, 손상 내성 파싱.
import type { PdfRect } from "./pdf-highlight-geom";

export const HIGHLIGHT_COLORS = [
  "yellow",
  "green",
  "blue",
  "pink",
  "purple",
] as const;

export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number];

export interface StoredHighlight {
  color: HighlightColor;
  id: string;
  /** "area"는 2차용 자리 — 지금 잡아두면 나중에 스키마 마이그레이션이 없다. */
  kind: "area" | "text";
  /** 1-based 페이지 번호. */
  page: number;
  rects: PdfRect[];
}

export interface Sidecar {
  /** 파생이 아니라 기록 — 규칙이 바뀌거나 노트를 옮겨도 추적이 끊기지 않는다. */
  companion: string;
  highlights: StoredHighlight[];
  pdf: string;
  version: 1;
}

/** vault 상대 PDF 경로 → 동반 노트의 vault 상대 경로. */
export function companionPathFor(pdfRelPath: string): string {
  return `highlights/${pdfRelPath.replace(/\.pdf$/i, ".md")}`;
}

/** vault 상대 PDF 경로 → 사이드카의 vault 상대 경로. */
export function sidecarPathFor(pdfRelPath: string): string {
  return `.baram/pdf-highlights/${pdfRelPath.replace(/\.pdf$/i, ".json")}`;
}

function isPdfRect(v: unknown): v is PdfRect {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.x === "number" &&
    typeof r.y === "number" &&
    typeof r.w === "number" &&
    typeof r.h === "number"
  );
}

function isStoredHighlight(v: unknown): v is StoredHighlight {
  if (typeof v !== "object" || v === null) return false;
  const h = v as Record<string, unknown>;
  return (
    typeof h.id === "string" &&
    h.id.length > 0 &&
    (h.kind === "text" || h.kind === "area") &&
    typeof h.page === "number" &&
    h.page >= 1 &&
    HIGHLIGHT_COLORS.includes(h.color as HighlightColor) &&
    Array.isArray(h.rects) &&
    h.rects.length > 0 &&
    h.rects.every(isPdfRect)
  );
}

/**
 * 사이드카를 파싱한다.
 *
 * §273.4 항목 단위 실패: 하이라이트 하나가 스키마에 안 맞는다고 파일 전체를
 * 버리면 사용자는 모든 하이라이트를 잃는다. 나쁜 항목만 버리고 개수를
 * 돌려주어 호출부가 로그를 남기게 한다 (조용한 부분 실패 금지).
 */
export function parseSidecar(raw: string): {
  dropped: number;
  sidecar: null | Sidecar;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { dropped: 0, sidecar: null };
  }

  if (typeof parsed !== "object" || parsed === null) {
    return { dropped: 0, sidecar: null };
  }
  const obj = parsed as Record<string, unknown>;
  if (obj.version !== 1) return { dropped: 0, sidecar: null };
  if (typeof obj.pdf !== "string" || typeof obj.companion !== "string") {
    return { dropped: 0, sidecar: null };
  }

  const rawList = Array.isArray(obj.highlights) ? obj.highlights : [];
  const highlights = rawList.filter(isStoredHighlight);

  return {
    dropped: rawList.length - highlights.length,
    sidecar: {
      companion: obj.companion,
      highlights,
      pdf: obj.pdf,
      version: 1,
    },
  };
}
```

- [ ] **Step 4: 테스트를 돌려 통과를 확인한다**

```bash
npx vitest run src/components/editor/pdf/__tests__/pdf-highlight-sidecar.test.ts > /tmp/t7.log 2>&1; echo $?
```

Expected: PASS (exit 0)

- [ ] **Step 5: 커밋한다**

```bash
git add src/components/editor/pdf/pdf-highlight-sidecar.ts src/components/editor/pdf/__tests__/pdf-highlight-sidecar.test.ts
git commit -m "feat(§273): add highlight sidecar schema with per-entry corruption tolerance"
```

---

### Task 8: display 문자열 생성 규칙

**Files:**
- Create: `src/components/editor/pdf/pdf-ref-display.ts`
- Test: `src/components/editor/pdf/__tests__/pdf-ref-display.test.ts`

**Interfaces:**
- Consumes: 없음 (순수 함수)
- Produces:
  - `buildRefDisplay(text: string): string`
  - `MAX_DISPLAY_LEN: 80`

**설계 (§275.3):** `BLOCK_REF_RE`(`src/pipeline/block-id.ts:42`)의 display 캡처는 `([^)]+)`이므로 `)`를 담을 수 없다. 그런데 논문 텍스트에는 흔하다 — `"as shown in (Fig. 3)"`. 그리고 `((ref|[[x]]))` 같은 대괄호 쌍은 wikilink 패턴과 충돌할 수 있다.

**규칙:** 공백 접기 → `(`, `)`, `[`, `]`, `|` 제거 → 80자 초과 시 절단 + `…`.
괄호를 여는 쪽까지 지우는 이유는 `"(Fig. 3"`처럼 짝이 깨진 라벨을 만들지 않기 위해서다. display는 표시용 라벨이므로 이 손실은 허용된다 — **원문은 동반 노트에 온전히 보존**되고, 팝업의 `Copy text`가 무손실 경로를 제공한다.

- [ ] **Step 1: 실패하는 테스트를 작성한다**

`src/components/editor/pdf/__tests__/pdf-ref-display.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { BLOCK_REF_RE, parseBlockRefMatch, serializeBlockRef } from "../../../../pipeline/block-id";
import { buildRefDisplay, MAX_DISPLAY_LEN } from "../pdf-ref-display";

describe("buildRefDisplay", () => {
  it("collapses newlines and runs of whitespace into single spaces", () => {
    expect(buildRefDisplay("Attention  mechanisms\nallow   modeling")).toBe(
      "Attention mechanisms allow modeling",
    );
  });

  it("removes parentheses so the label never ends up unbalanced", () => {
    expect(buildRefDisplay("as shown in (Fig. 3) above")).toBe(
      "as shown in Fig. 3 above",
    );
  });

  it("removes square brackets that could form a wikilink pattern", () => {
    // "([1])" 는 제거 없이는 "[[1]]" 가 되어 wikilink로 오인된다
    expect(buildRefDisplay("see ([1]) for details")).toBe(
      "see 1 for details",
    );
  });

  it("removes the pipe that would terminate the display capture", () => {
    expect(buildRefDisplay("a | b")).toBe("a b");
  });

  it("truncates past the limit and appends an ellipsis", () => {
    const long = "x".repeat(MAX_DISPLAY_LEN + 40);
    const out = buildRefDisplay(long);

    expect(out).toHaveLength(MAX_DISPLAY_LEN + 1); // 80 + "…"
    expect(out.endsWith("…")).toBe(true);
  });

  it("leaves text at exactly the limit untouched", () => {
    const exact = "y".repeat(MAX_DISPLAY_LEN);
    expect(buildRefDisplay(exact)).toBe(exact);
  });

  it("preserves Korean text", () => {
    expect(buildRefDisplay("어텐션 메커니즘은 거리에 무관하다")).toBe(
      "어텐션 메커니즘은 거리에 무관하다",
    );
  });
});

describe("generated display survives the block-ref round-trip", () => {
  it.each([
    ["parentheses", "as shown in (Fig. 3) above"],
    ["brackets", "see ([1]) for details"],
    ["pipe", "left | right"],
    ["korean", "어텐션 메커니즘은 거리에 무관하다"],
    ["overlong", "z".repeat(200)],
  ])("serialize → match → parse is lossless: %s", (_label, source) => {
    const display = buildRefDisplay(source);
    const attrs = {
      blockId: "h7k2m9",
      display,
      target: "highlights/papers/attention",
    };

    const serialized = serializeBlockRef(attrs);
    const match = new RegExp(BLOCK_REF_RE.source, "g").exec(serialized);

    expect(match).not.toBeNull();
    expect(parseBlockRefMatch(match!)).toEqual(attrs);
  });
});
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

```bash
npx vitest run src/components/editor/pdf/__tests__/pdf-ref-display.test.ts > /tmp/t8.log 2>&1; echo $?
```

Expected: FAIL — `Failed to resolve import "../pdf-ref-display"`

- [ ] **Step 3: 생성 규칙을 구현한다**

`src/components/editor/pdf/pdf-ref-display.ts`:

```ts
// §275.3 블록 참조 display 문자열 생성.
//
// BLOCK_REF_RE(pipeline/block-id.ts:42)의 display 캡처는 `([^)]+)`라서 `)`를
// 담을 수 없는데, 논문 텍스트에는 흔하다("as shown in (Fig. 3)"). 대괄호는
// 짝이 맞으면 `[[x]]` wikilink 패턴으로 오인될 수 있고, `|`는 캡처를 끊는다.
//
// display는 표시용 라벨이므로 이 손실은 허용된다 — 원문은 동반 노트에 온전히
// 보존되고, 선택 팝업의 "Copy text"가 무손실 경로를 제공한다.

export const MAX_DISPLAY_LEN = 80;

/** 하이라이트 텍스트를 블록 참조 display로 안전하게 변환한다. */
export function buildRefDisplay(text: string): string {
  const stripped = text
    .replace(/[()[\]|]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (stripped.length <= MAX_DISPLAY_LEN) return stripped;
  return `${stripped.slice(0, MAX_DISPLAY_LEN).trimEnd()}…`;
}
```

- [ ] **Step 4: 테스트를 돌려 통과를 확인한다**

```bash
npx vitest run src/components/editor/pdf/__tests__/pdf-ref-display.test.ts > /tmp/t8.log 2>&1; echo $?
```

Expected: PASS (exit 0)

> `"see ([1]) for details"` 케이스는 괄호·대괄호를 지운 뒤 `"see 1 for details"`가 되어야 한다. 공백 접기가 제거 **뒤에** 와야 `"see  1"`의 이중 공백이 접힌다 — 순서를 바꾸면 이 테스트가 잡는다.

- [ ] **Step 5: 커밋한다**

```bash
git add src/components/editor/pdf/pdf-ref-display.ts src/components/editor/pdf/__tests__/pdf-ref-display.test.ts
git commit -m "feat(§275): add safe block-ref display generation for highlight text"
```

---

### Task 9: 동반 노트 쓰기 경로

**Files:**
- Create: `src/components/editor/pdf/pdf-highlight-store.ts`
- Test: `src/components/editor/pdf/__tests__/pdf-highlight-store.test.ts`

**Interfaces:**
- Consumes: Task 7의 `Sidecar` · `StoredHighlight` · `parseSidecar` · `companionPathFor` · `sidecarPathFor`
- Produces:
  - `appendHighlightBlock(absCompanionPath: string, text: string, blockId: string): Promise<void>`
  - `readSidecar(absSidecarPath: string): Promise<null | Sidecar>`
  - `writeSidecar(absSidecarPath: string, sidecar: Sidecar): Promise<void>`

**설계 (§277):** `use-file-watcher.ts:159`를 읽고 확인한 동작 —

| 동반 노트 상태 | `writeFile` 결과 |
|---|---|
| 열려 있지 않음 | 조용히 성공 |
| 열림 + clean | 자동 리로드 |
| 열림 + **dirty** | **ConflictModal 팝업** |

PDF를 읽는 중에 충돌 모달이 뜨는 것은 받아들일 수 없다. 타이밍으로 억제하지 않고 원인 기준으로 해결한다 — **버퍼가 열려 있으면 버퍼가 소유자다.** `useFileStore.openFiles`에 경로가 있으면 스토어 내용에 append하고 정상 저장 흐름에 맡기며, 없을 때만 `writeFile`을 부른다.

**블록 형식 (§273.1):** `findBlockContent`(`src/utils/editor/block-nav.ts:8`)는 ` ^id`로 끝나는 **한 줄**을 찾고 heading 접두사만 제거한다. 따라서 리스트(`- `)나 인용(`> `) 마커를 쓰면 프리뷰에 그대로 노출된다. 평문 문단 + 문단 사이 빈 줄을 쓴다.

- [ ] **Step 1: 실패하는 테스트를 작성한다**

`src/components/editor/pdf/__tests__/pdf-highlight-store.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

import { findBlockContent } from "../../../../utils/editor/block-nav";
import { appendHighlightBlock } from "../pdf-highlight-store";

const writeFile = vi.fn(async () => {});
const readFile = vi.fn(async () => "");
const createDir = vi.fn(async () => {});

vi.mock("../../../../ipc/invoke", () => ({
  createDir: (...a: unknown[]) => createDir(...(a as [])),
  readFile: (...a: unknown[]) => readFile(...(a as [])),
  writeFile: (...a: unknown[]) => writeFile(...(a as [])),
}));

const openFiles = new Map<string, string>();
const setOpenFile = vi.fn();

vi.mock("../../../../stores/file/file", () => ({
  useFileStore: {
    getState: () => ({ openFiles, setOpenFile }),
  },
}));

const COMPANION = "/vault/highlights/papers/attention.md";

describe("appendHighlightBlock", () => {
  beforeEach(() => {
    openFiles.clear();
    writeFile.mockClear();
    readFile.mockClear();
    createDir.mockClear();
    setOpenFile.mockClear();
    readFile.mockResolvedValue("");
  });

  it("writes to disk when the companion note is not open", async () => {
    readFile.mockRejectedValueOnce(new Error("not found"));

    await appendHighlightBlock(COMPANION, "Attention mechanisms", "h7k2m9");

    expect(writeFile).toHaveBeenCalledTimes(1);
    expect(setOpenFile).not.toHaveBeenCalled();
    expect(writeFile.mock.calls[0][1]).toContain("Attention mechanisms ^h7k2m9");
  });

  it("appends into the open buffer instead of writing to disk", async () => {
    openFiles.set(COMPANION, "Earlier highlight ^p3n8q1\n");

    await appendHighlightBlock(COMPANION, "Attention mechanisms", "h7k2m9");

    // 버퍼가 열려 있으면 버퍼가 소유자 — 디스크를 건드리면 ConflictModal이 뜬다
    expect(writeFile).not.toHaveBeenCalled();
    expect(setOpenFile).toHaveBeenCalledTimes(1);
    const [path, content] = setOpenFile.mock.calls[0];
    expect(path).toBe(COMPANION);
    expect(content).toContain("Earlier highlight ^p3n8q1");
    expect(content).toContain("Attention mechanisms ^h7k2m9");
  });

  it("separates blocks with a blank line so each is its own paragraph", async () => {
    openFiles.set(COMPANION, "First ^aaa111\n");

    await appendHighlightBlock(COMPANION, "Second", "bbb222");

    const content = setOpenFile.mock.calls[0][1] as string;
    expect(content).toBe("First ^aaa111\n\nSecond ^bbb222\n");
  });

  it("collapses multi-line selection text into one line", async () => {
    openFiles.set(COMPANION, "");

    await appendHighlightBlock(COMPANION, "line one\nline  two", "ccc333");

    const content = setOpenFile.mock.calls[0][1] as string;
    expect(content).toContain("line one line two ^ccc333");
  });

  it("produces a block findBlockContent can read back verbatim", async () => {
    openFiles.set(COMPANION, "");

    await appendHighlightBlock(COMPANION, "Attention mechanisms", "h7k2m9");

    const content = setOpenFile.mock.calls[0][1] as string;
    expect(findBlockContent(content, "h7k2m9")).toBe("Attention mechanisms");
  });
});
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

```bash
npx vitest run src/components/editor/pdf/__tests__/pdf-highlight-store.test.ts > /tmp/t9.log 2>&1; echo $?
```

Expected: FAIL — `Failed to resolve import "../pdf-highlight-store"`

- [ ] **Step 3: 쓰기 경로를 구현한다**

`src/components/editor/pdf/pdf-highlight-store.ts`:

```ts
// §277 동반 노트와 사이드카 I/O.
import type { Sidecar } from "./pdf-highlight-sidecar";

import { createDir, readFile, writeFile } from "../../../ipc/invoke";
import { useFileStore } from "../../../stores/file/file";
import { logger } from "../../../utils/logger";
import { dirname } from "../../../utils/path-utils";
import { parseSidecar } from "./pdf-highlight-sidecar";

/**
 * 하이라이트 하나를 동반 노트에 문단 블록으로 덧붙인다.
 *
 * §273.1 형식: findBlockContent는 ` ^id`로 끝나는 한 줄을 찾고 heading
 * 접두사만 제거한다. 리스트/인용 마커는 프리뷰에 그대로 노출되므로 평문
 * 문단을 쓰고, 문단끼리 합쳐지지 않도록 빈 줄로 분리한다.
 *
 * §277 소유권: 버퍼가 열려 있으면 버퍼가 소유자다. 열린 파일을 디스크에서
 * 고치면 파일 워처가 ConflictModal을 띄운다(use-file-watcher.ts:159) —
 * PDF를 읽는 중에 그것이 뜨면 안 된다.
 */
export async function appendHighlightBlock(
  absCompanionPath: string,
  text: string,
  blockId: string,
): Promise<void> {
  const oneLine = text.replace(/\s+/g, " ").trim();
  const block = `${oneLine} ^${blockId}`;

  const store = useFileStore.getState();
  const buffered = store.openFiles.get(absCompanionPath);

  if (buffered !== undefined) {
    store.setOpenFile(absCompanionPath, joinBlock(buffered, block));
    return;
  }

  let existing = "";
  try {
    existing = await readFile(absCompanionPath);
  } catch {
    // 아직 없는 파일 — 부모 디렉터리를 만들고 새로 쓴다
    await createDir(dirname(absCompanionPath));
  }
  await writeFile(absCompanionPath, joinBlock(existing, block));
}

/** 기존 내용 뒤에 빈 줄 하나를 두고 블록을 붙인다. */
function joinBlock(existing: string, block: string): string {
  const body = existing.replace(/\n+$/, "");
  return body.length === 0 ? `${block}\n` : `${body}\n\n${block}\n`;
}

/** 사이드카를 읽는다. 없거나 손상되면 null. 버린 항목 수는 로그로 남긴다. */
export async function readSidecar(
  absSidecarPath: string,
): Promise<null | Sidecar> {
  let raw: string;
  try {
    raw = await readFile(absSidecarPath);
  } catch {
    return null; // 아직 하이라이트가 없는 PDF — 정상 경로
  }

  const { sidecar, dropped } = parseSidecar(raw);
  if (dropped > 0) {
    // §273.4 조용한 부분 실패 금지
    logger.warn(
      `[pdf-highlight] dropped ${dropped} malformed highlight(s) from ${absSidecarPath}`,
    );
  }
  if (!sidecar) {
    logger.error(`[pdf-highlight] unreadable sidecar: ${absSidecarPath}`);
  }
  return sidecar;
}

/** 사이드카를 쓴다. 부모 디렉터리가 없으면 만든다. */
export async function writeSidecar(
  absSidecarPath: string,
  sidecar: Sidecar,
): Promise<void> {
  await createDir(dirname(absSidecarPath));
  await writeFile(absSidecarPath, `${JSON.stringify(sidecar, null, 2)}\n`);
}
```

- [ ] **Step 4: 테스트를 돌려 통과를 확인한다**

```bash
npx vitest run src/components/editor/pdf/__tests__/pdf-highlight-store.test.ts > /tmp/t9.log 2>&1; echo $?
```

Expected: PASS (exit 0)

> `useFileStore`에 `setOpenFile`이 없다면 스토어의 실제 액션 이름으로 바꾸고(`src/stores/file/file.ts`에서 `openFiles`를 갱신하는 액션을 찾을 것) 테스트의 mock 이름도 함께 고친다. 액션이 존재하지 않으면 추가한다 — 열린 버퍼를 갱신하는 정식 경로가 필요하다.

- [ ] **Step 5: 커밋한다**

```bash
git add src/components/editor/pdf/pdf-highlight-store.ts src/components/editor/pdf/__tests__/pdf-highlight-store.test.ts
git commit -m "feat(§277): route highlight writes through the open buffer when present"
```

---

### Task 10: 블록 참조 InputRule + pasteRule

**Files:**
- Modify: `src/extensions/nodes/block-reference.ts`
- Test: `src/extensions/__tests__/block-reference-rules.test.ts`

**Interfaces:**
- Consumes: `BLOCK_REF_RE` · `parseBlockRefMatch` (`src/pipeline/block-id.ts`)
- Produces: 없음 (기존 `BlockReference` 노드의 동작 확장)

**배경 (§275.5):** `block-reference.ts`에는 InputRule도 pasteRule도 없다. 그래서 `((...))`를 붙여넣으면 노드가 되지 않고, 저장 후 재오픈으로 파이프라인을 한 번 돌아야 렌더된다. 클립보드 복사를 삽입 경로로 삼은 이상 반드시 고쳐야 한다.

`src/extensions/nodes/wikilink.ts:123-177`의 패턴을 그대로 따른다. InputRule 정규식에는 `$` 앵커가, pasteRule 정규식에는 `g` 플래그가 필요하다 — `BLOCK_REF_RE`는 둘 다 없으므로 `.source`에서 새로 만든다.

**syntax-reveal은 건드리지 않는다.** `syntax-reveal-state.ts:13`의 kind union에 `blockReference`를 추가하는 작업은 핵심 플러그인을 건드리는 유일한 조각인데, display 방식에서는 렌더된 텍스트가 곧 원문의 일부라 "펼쳐서 원문 보기"의 값이 작다.

- [ ] **Step 1: 실패하는 테스트를 작성한다**

`src/extensions/__tests__/block-reference-rules.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { BLOCK_REF_RE } from "../../pipeline/block-id";
import { BlockReference } from "../nodes/block-reference";

describe("BlockReference rules", () => {
  it("registers an input rule and a paste rule", () => {
    // 이 둘이 없으면 붙여넣은 ((...))가 저장·재오픈 전까지 생텍스트로 남는다
    expect(typeof BlockReference.config.addInputRules).toBe("function");
    expect(typeof BlockReference.config.addPasteRules).toBe("function");
  });

  it("anchors the input regex to the end so it fires on the closing ))", () => {
    const anchored = new RegExp(`${BLOCK_REF_RE.source}$`);

    expect(anchored.test("prose ((notes/a#^abc123))")).toBe(true);
    // 뒤에 글자가 더 있으면 아직 타이핑 중 — 발동하지 않아야 한다
    expect(anchored.test("((notes/a#^abc123)) trailing")).toBe(false);
  });

  it("matches every occurrence when the paste regex carries the g flag", () => {
    const global = new RegExp(BLOCK_REF_RE.source, "g");
    const pasted =
      "((notes/a#^abc123|first)) and ((notes/b#^def456|second))";

    expect(pasted.match(global)).toHaveLength(2);
  });

  it("parses a path-qualified target with a display label", () => {
    const match = new RegExp(BLOCK_REF_RE.source, "g").exec(
      "((highlights/papers/attention#^h7k2m9|Attention mechanisms))",
    );

    expect(match).not.toBeNull();
    expect(match![1]).toBe("highlights/papers/attention");
    expect(match![2]).toBe("h7k2m9");
    expect(match![3]).toBe("Attention mechanisms");
  });
});
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

```bash
npx vitest run src/extensions/__tests__/block-reference-rules.test.ts > /tmp/t10.log 2>&1; echo $?
```

Expected: FAIL — `expected "undefined" to be "function"` (앞의 두 단정)

- [ ] **Step 3: 규칙을 추가한다**

`src/extensions/nodes/block-reference.ts`. import에 `InputRule`, `nodePasteRule`을 추가하고(`@tiptap/core`), `BLOCK_REF_RE`·`parseBlockRefMatch`를 `../../pipeline/block-id`에서 가져온 뒤 `addNodeView()` 아래에 추가한다:

```ts
  // §275.5 타이핑/붙여넣기 즉시 노드화.
  // 이것들이 없으면 ((...))는 저장·재오픈으로 파이프라인을 한 번 돌기 전까지
  // 생텍스트로 남는다. wikilink.ts:123-177의 패턴을 따른다.
  addInputRules() {
    return [
      new InputRule({
        // BLOCK_REF_RE에는 끝 앵커가 없다 — 타이핑은 항상 캐럿(입력 끝)에서
        // 매치되어야 하므로 여기서 붙인다.
        find: new RegExp(`${BLOCK_REF_RE.source}$`),
        handler: ({ match, range, state }) => {
          const { tr } = state;
          tr.replaceWith(
            range.from,
            range.to,
            this.type.create(parseBlockRefMatch(match)),
          );
        },
      }),
    ];
  },

  addPasteRules() {
    return [
      nodePasteRule({
        // 붙여넣기 내용은 어디서든, 여러 번 매치될 수 있다 — g 플래그가 필요하다.
        find: new RegExp(BLOCK_REF_RE.source, "g"),
        type: this.type,
        getAttributes: (match) => parseBlockRefMatch(match),
      }),
    ];
  },
```

- [ ] **Step 4: 테스트를 돌려 통과를 확인한다**

```bash
npx vitest run src/extensions/__tests__/block-reference-rules.test.ts > /tmp/t10.log 2>&1; echo $?
```

Expected: PASS (exit 0)

- [ ] **Step 5: 라운드트립이 깨지지 않았는지 전체 스위트로 확인한다**

```bash
npx vitest run > /tmp/vt.log 2>&1; echo "vitest=$?"
```

Expected: 0. 파이프라인 테스트가 깨지면 `((...))`가 이제 노드가 되어 직렬화 경로가 달라진 것이므로, `pm-to-md`의 `serializeBlockRef` 경로(`src/pipeline/pm-to-md.ts:65-75`)를 확인한다.

- [ ] **Step 6: `registry.json`을 갱신한다**

`src/extensions/registry.json`의 `blockReference` 항목에 InputRule/pasteRule이 생겼음을 반영한다 (다른 노드 항목의 형식을 따른다). 이 레지스트리는 다른 스킬이 참조하므로 누락하면 안 된다.

- [ ] **Step 7: 커밋한다**

```bash
git add src/extensions/nodes/block-reference.ts src/extensions/__tests__/block-reference-rules.test.ts src/extensions/registry.json
git commit -m "feat(§275): make typed and pasted block references become nodes immediately"
```

---

### Task 11: 하이라이트 오버레이와 선택 팝업

**Files:**
- Create: `src/components/editor/pdf/PdfSelectionPopup.tsx`
- Modify: `src/components/editor/pdf/PdfPage.tsx`, `src/components/editor/pdf/PdfPreview.tsx`, `src/styles/editor/pdf.css`, `tokens/semantic/color-light.json`, `tokens/semantic/color-dark.json`, `src/i18n/en.json`, `src/i18n/ko.json`
- Test: `src/components/editor/pdf/__tests__/pdf-selection-popup.test.tsx`

**Interfaces:**
- Consumes: Task 6의 `pdfRectToPageLocal` · `clientRectToPdf`, Task 7의 `HighlightColor` · `StoredHighlight`, Task 8의 `buildRefDisplay`, Task 9의 `appendHighlightBlock` · `writeSidecar`
- Produces: `PdfSelectionPopup` — `{ anchor: { left: number; top: number }; existing: null | StoredHighlight; onCopyRef: () => void; onCopyText: () => void; onDelete: () => void; onPickColor: (c: HighlightColor) => void }`

**DOM 레이어 스택 (§274.2):**

```
.pdf-page
├── <canvas>                  페이지 래스터
├── .pdf-highlight-layer      하이라이트 오버레이   pointer-events: none
├── .pdf-find-layer           찾기 매치 (Task 4)
└── .pdf-text-layer           투명 선택 텍스트      (최상단)
```

텍스트 레이어가 **반드시 최상단**이어야 텍스트 선택과 `Cmd+C`가 동작한다. 따라서 하이라이트는 순수 시각 레이어(`pointer-events: none`)로 두고, 하이라이트 클릭은 `.pdf-page`의 클릭 좌표를 저장된 rect와 히트 테스트해 판정한다. 이것이 텍스트 선택을 죽이지 않는 유일한 배치다.

- [ ] **Step 1: 실패하는 테스트를 작성한다**

`src/components/editor/pdf/__tests__/pdf-selection-popup.test.tsx`:

```tsx
import type { StoredHighlight } from "../pdf-highlight-sidecar";

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { HIGHLIGHT_COLORS } from "../pdf-highlight-sidecar";
import { PdfSelectionPopup } from "../PdfSelectionPopup";

const noop = () => {};

function setup(existing: null | StoredHighlight = null) {
  const props = {
    anchor: { left: 100, top: 200 },
    existing,
    onCopyRef: vi.fn(),
    onCopyText: vi.fn(),
    onDelete: vi.fn(),
    onPickColor: vi.fn(),
  };
  render(<PdfSelectionPopup {...props} />);
  return props;
}

const stored: StoredHighlight = {
  color: "yellow",
  id: "h7k2m9",
  kind: "text",
  page: 3,
  rects: [{ h: 12, w: 100, x: 0, y: 0 }],
};

describe("PdfSelectionPopup", () => {
  it("offers every highlight colour", () => {
    setup();
    for (const c of HIGHLIGHT_COLORS) {
      expect(screen.getByTestId(`pdf-hl-color-${c}`)).toBeInTheDocument();
    }
  });

  it("offers both Copy reference and Copy text on a fresh selection", () => {
    setup();
    expect(screen.getByTestId("pdf-hl-copy-ref")).toBeInTheDocument();
    expect(screen.getByTestId("pdf-hl-copy-text")).toBeInTheDocument();
  });

  it("hides delete for a fresh selection", () => {
    setup();
    expect(screen.queryByTestId("pdf-hl-delete")).toBeNull();
  });

  it("shows delete when an existing highlight is clicked", () => {
    setup(stored);
    expect(screen.getByTestId("pdf-hl-delete")).toBeInTheDocument();
  });

  it("reports the chosen colour upward", async () => {
    const props = setup();
    await userEvent.click(screen.getByTestId("pdf-hl-color-green"));
    expect(props.onPickColor).toHaveBeenCalledWith("green");
  });

  it("reports copy actions upward", async () => {
    const props = setup(stored);
    await userEvent.click(screen.getByTestId("pdf-hl-copy-ref"));
    await userEvent.click(screen.getByTestId("pdf-hl-copy-text"));
    expect(props.onCopyRef).toHaveBeenCalledTimes(1);
    expect(props.onCopyText).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

```bash
npx vitest run src/components/editor/pdf/__tests__/pdf-selection-popup.test.tsx > /tmp/t11.log 2>&1; echo $?
```

Expected: FAIL — `Failed to resolve import "../PdfSelectionPopup"`

- [ ] **Step 3: 팝업을 구현한다**

`src/components/editor/pdf/PdfSelectionPopup.tsx`. `anchor` 위치에 절대 배치하고, 색 스와치 5개(`data-testid="pdf-hl-color-{name}"`), `Copy reference`(`pdf-hl-copy-ref`), `Copy text`(`pdf-hl-copy-text`)를 항상 보이며, `existing`이 있을 때만 `Delete`(`pdf-hl-delete`)를 추가한다. 문자열은 `useTranslation`으로 뺀다.

- [ ] **Step 4: 테스트를 돌려 통과를 확인한다**

```bash
npx vitest run src/components/editor/pdf/__tests__/pdf-selection-popup.test.tsx > /tmp/t11.log 2>&1; echo $?
```

Expected: PASS (exit 0)

- [ ] **Step 5: 색 토큰 5쌍을 추가한다**

`tokens/semantic/color-{light,dark}.json`의 `color.editor` 그룹에 `pdf-hl-yellow` · `pdf-hl-green` · `pdf-hl-blue` · `pdf-hl-pink` · `pdf-hl-purple`을 추가한다. 캔버스 글자가 비쳐야 하므로 알파를 포함한 반투명 값으로 정의한다.

```bash
npm run tokens:build > /tmp/tok.log 2>&1; echo $?
npm run audit:css-vars > /tmp/audit.log 2>&1; echo $?
```

- [ ] **Step 6: 8개 테마 전부에서 색을 확인한다 (GUI)**

`npm run tauri dev` → PDF를 열고 하이라이트를 5색으로 하나씩 만든 뒤, 설정에서 **8개 테마를 모두 순회**하며 확인한다. 확인 항목: 어느 테마에서도 글자가 안 읽히는 색이 없는가 · 5색이 서로 구분되는가. 색 하나만 보고 방향을 정하지 말 것 — 라이트에서 좋은 알파가 다크에서 뭉개지는 일이 흔하다.

- [ ] **Step 7: 오버레이와 히트 테스트를 배선한다**

`PdfPage`에 `highlights: StoredHighlight[]` prop을 추가한다. canvas와 text layer 사이에 `.pdf-highlight-layer`를 두고, 각 하이라이트의 `rects`를 `pdfRectToPageLocal`로 변환해 절대 배치 div로 그린다. 레이어는 `pointer-events: none`.

`.pdf-page`에 `mousedown` 핸들러를 달아 클릭 좌표를 페이지 로컬로 바꾼 뒤 `highlights`의 rect들과 히트 테스트한다. 맞으면 그 하이라이트로 팝업을 연다.

새 선택은 `document`의 `selectionchange`(또는 `mouseup`)로 감지해 `getClientRects()`를 `clientRectToPdf`로 변환하고 팝업을 연다.

- [ ] **Step 8: 하이라이트 생성 흐름을 잇는다**

색을 고르면: `generateBlockId()`(`src/pipeline/block-id.ts:33`)로 id 생성 → `appendHighlightBlock(companionAbs, selectedText, id)` → 사이드카에 `StoredHighlight` 추가 후 `writeSidecar` → 오버레이 갱신.

`Copy reference`: `serializeBlockRef({ blockId, display: buildRefDisplay(text), target })`를 클립보드에. `target`은 **항상 경로 한정**(§275.4) — `highlights/papers/attention`.
`Copy text`: 선택 원문을 손실 없이 그대로 클립보드에.

- [ ] **Step 9: i18n 키를 추가한다**

```
pdfHighlight.copyRef     "Copy reference" / "참조 복사"
pdfHighlight.copyText    "Copy text"      / "텍스트 복사"
pdfHighlight.delete      "Delete"         / "삭제"
pdfHighlight.color       "Highlight colour" / "하이라이트 색"
```

- [ ] **Step 10: 전체 게이트를 돌린다**

```bash
npm run typecheck > /tmp/tc.log 2>&1; echo "typecheck=$?"
npx vitest run > /tmp/vt.log 2>&1; echo "vitest=$?"
```

Expected: 둘 다 0.

- [ ] **Step 11: 커밋한다**

```bash
git add src/components/editor/pdf/ src/styles/editor/pdf.css src/styles/generated/ tokens/ src/i18n/
git commit -m "feat(§274): add text highlight overlay and selection popup"
```

---

### Task 12: PDF 툴바와 ref → PDF 내비게이션

**Files:**
- Create: `src/components/editor/pdf/PdfToolbar.tsx`
- Modify: `src/components/editor/pdf/PdfPreview.tsx`, `src/hooks/use-navigation.ts:213`, `src/styles/editor/pdf.css`, `src/i18n/en.json`, `src/i18n/ko.json`
- Test: `src/components/editor/pdf/__tests__/pdf-toolbar.test.tsx`

**Interfaces:**
- Consumes: Task 7의 `sidecarPathFor`, Task 9의 `readSidecar`
- Produces: `PdfToolbar` — `{ areaMode: boolean; currentPage: number; onNextPage: () => void; onPrevPage: () => void; onToggleArea: () => void; onToggleFind: () => void; pageCount: number }`

**설계 (§276.3):** 영역 하이라이트는 2차이지만 **툴바 슬롯은 지금 확보한다.** 나중에 끼워 넣으면 툴바 레이아웃을 다시 짜게 된다. 이번 PR에서 토글 버튼은 렌더하되 `disabled`로 두고 "coming soon" title을 붙인다.

- [ ] **Step 1: 실패하는 테스트를 작성한다**

`src/components/editor/pdf/__tests__/pdf-toolbar.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { PdfToolbar } from "../PdfToolbar";

function setup(overrides: Partial<Parameters<typeof PdfToolbar>[0]> = {}) {
  const props = {
    areaMode: false,
    currentPage: 3,
    onNextPage: vi.fn(),
    onPrevPage: vi.fn(),
    onToggleArea: vi.fn(),
    onToggleFind: vi.fn(),
    pageCount: 27,
    ...overrides,
  };
  render(<PdfToolbar {...props} />);
  return props;
}

describe("PdfToolbar", () => {
  it("shows the current page against the total", () => {
    setup();
    expect(screen.getByText("3 / 27")).toBeInTheDocument();
  });

  it("disables previous on the first page", () => {
    setup({ currentPage: 1 });
    expect(screen.getByTestId("pdf-prev-page")).toBeDisabled();
    expect(screen.getByTestId("pdf-next-page")).toBeEnabled();
  });

  it("disables next on the last page", () => {
    setup({ currentPage: 27, pageCount: 27 });
    expect(screen.getByTestId("pdf-next-page")).toBeDisabled();
  });

  it("reserves the area-highlight slot but keeps it disabled for now", () => {
    setup();
    // §276.3 슬롯은 지금 확보한다 — 2차에 끼워 넣으면 레이아웃을 다시 짜야 한다
    expect(screen.getByTestId("pdf-area-mode")).toBeDisabled();
  });

  it("reports find toggling upward", async () => {
    const props = setup();
    await userEvent.click(screen.getByTestId("pdf-toggle-find"));
    expect(props.onToggleFind).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

```bash
npx vitest run src/components/editor/pdf/__tests__/pdf-toolbar.test.tsx > /tmp/t12.log 2>&1; echo $?
```

Expected: FAIL — `Failed to resolve import "../PdfToolbar"`

- [ ] **Step 3: 툴바를 구현한다**

`src/components/editor/pdf/PdfToolbar.tsx`. 요소: 이전/다음 페이지(`pdf-prev-page` / `pdf-next-page`, 경계에서 `disabled`), `{currentPage} / {pageCount}` 표시, 찾기 토글(`pdf-toggle-find`), 영역 모드 토글(`pdf-area-mode`, `disabled` + "coming soon" title). `.icon-btn` 공유 유틸을 쓰고 문자열은 `useTranslation`으로 뺀다.

- [ ] **Step 4: 테스트를 돌려 통과를 확인한다**

```bash
npx vitest run src/components/editor/pdf/__tests__/pdf-toolbar.test.tsx > /tmp/t12.log 2>&1; echo $?
```

Expected: PASS (exit 0)

- [ ] **Step 5: `PdfPreview`에 툴바를 배선한다**

현재 페이지는 스크롤 컨테이너에서 가장 위에 보이는 페이지로 계산한다(이미 `visiblePages`를 찾기용으로 추적 중이므로 재사용). 이전/다음은 해당 페이지로 스크롤. 이 `scrollToPage`는 Task 3의 `createLinkService`가 쓰는 것과 **같은 함수**여야 한다 — 찾기 이동과 툴바 이동이 갈라지면 안 된다.

- [ ] **Step 6: ref 클릭 → PDF 점프를 배선한다**

`src/hooks/use-navigation.ts:213`의 `handleBlockRefNavigate`에 분기를 추가한다. `target`이 `highlights/`로 시작하면 대응하는 PDF 경로를 되돌려 사이드카를 읽고, 그 `blockId`가 사이드카에 있으면 **동반 노트가 아니라 PDF를 연다.** 해당 페이지로 스크롤하고 하이라이트를 잠깐 강조한다. 사이드카에 없으면 기존 동작(동반 노트 열기)으로 떨어진다.

- [ ] **Step 7: i18n 키를 추가한다**

```
pdfToolbar.prevPage   "Previous page"    / "이전 페이지"
pdfToolbar.nextPage   "Next page"        / "다음 페이지"
pdfToolbar.find       "Find in PDF"      / "PDF에서 찾기"
pdfToolbar.areaMode   "Area highlight (coming soon)" / "영역 하이라이트 (준비 중)"
```

- [ ] **Step 8: 전체 게이트를 돌린다**

```bash
npm run typecheck > /tmp/tc.log 2>&1; echo "typecheck=$?"
npx vitest run > /tmp/vt.log 2>&1; echo "vitest=$?"
npx eslint src --max-warnings=0 > /tmp/lint.log 2>&1; echo "eslint=$?"
```

Expected: 셋 다 0.

- [ ] **Step 9: 전체 흐름을 실앱에서 확인한다 (GUI)**

`npm run tauri dev`. 확인 항목:

1. PDF를 열고 텍스트를 선택 → 팝업이 뜬다 → 색을 고른다 → 하이라이트가 칠해진다
2. `highlights/<경로>/<이름>.md`가 생성되고 문단 + `^id`가 들어 있다
3. `.baram/pdf-highlights/<경로>/<이름>.json`에 기하가 들어 있다
4. `Copy reference` → 노트에 붙여넣기 → **즉시** 하이라이트 텍스트로 렌더된다 (Task 10 검증)
5. `Copy text` → 붙여넣기 → 원문이 손실 없이 들어간다 (괄호 포함 문장으로 확인)
6. 그 ref를 `Cmd+Click` → PDF가 열리고 해당 페이지·하이라이트로 이동한다
7. `Cmd+hover` → 동반 노트의 라이브 내용이 프리뷰로 뜬다
8. 줌을 바꿔도 하이라이트가 제자리에 있다
9. 하이라이트를 클릭 → 팝업에 `Delete`가 있고, 지우면 오버레이·동반 노트·사이드카에서 모두 사라진다
10. **동반 노트를 열어 편집(dirty 상태)한 채** PDF로 돌아가 하이라이트를 추가 → **ConflictModal이 뜨지 않는다** (§277 검증)
11. 사이드카를 손으로 망가뜨려도(항목 하나에 `page` 삭제) 나머지 하이라이트가 살아 있다 (§273.4 검증)

- [ ] **Step 10: 커밋하고 PR을 연다**

```bash
git add src/components/editor/pdf/ src/hooks/use-navigation.ts src/styles/editor/pdf.css src/i18n/
git commit -m "feat(§276): add PDF toolbar and highlight-reference navigation"
```

푸시는 백그라운드로 — pre-push의 `cargo clippy --all-targets` + `npx knip`이 cold 상태에서 5~7분 걸린다.

---

## 검증 매트릭스

| 설계 요구 | 담당 태스크 | 증거 |
|---|---|---|
| §271 구조 재편 | Task 1 | 파일 분해 + 게이트 통과 |
| §272.1 FindController 조달 | Task 3 | GUI 스파이크 (Step 5) |
| §272.2 로드 순서 | Task 3 | GUI 스파이크 (Step 5) |
| §272.3 어댑터 + 매치 변환 | Task 2, 3 | 단위 테스트 |
| §272.4 추출 파라미터 정합 | Task 1 | 단위 테스트 + Task 5 Step 9의 합자 PDF |
| §272.5 lazy 페이지 | Task 4, 5 | GUI (Task 5 Step 9) |
| §272.6 UI 배선 | Task 5 | 단위 테스트 + GUI |
| §273.1 동반 노트 형식 | Task 9 | `findBlockContent` 왕복 테스트 |
| §273.2 사이드카 스키마 | Task 7 | 단위 테스트 |
| §273.3 색상 | Task 11 | 8테마 GUI (Step 6) |
| §273.4 손상 내성 | Task 7 | 단위 테스트 + GUI (Task 12 Step 9-11) |
| §274.1 좌표 변환 | Task 6 | 왕복 테스트 + GUI (Task 12 Step 9-8) |
| §274.2 레이어 스택 | Task 11 | GUI — 텍스트 선택이 살아 있는지 |
| §275.2 display 활용 | Task 8, 11 | 라운드트립 테스트 |
| §275.3 display 생성 규칙 | Task 8 | 단위 테스트 |
| §275.4 경로 한정 target | Task 11 Step 8 | GUI (Task 12 Step 9-6) |
| §275.5 InputRule/pasteRule | Task 10 | 단위 테스트 + GUI (Task 12 Step 9-4) |
| §275.6 ref 클릭 목적지 | Task 12 | GUI (Task 12 Step 9-6) |
| §276.1 툴바 | Task 12 | 단위 테스트 |
| §276.2 선택 팝업 | Task 11 | 단위 테스트 |
| §276.3 영역 슬롯 확보 | Task 12 | 단위 테스트 (disabled 단정) |
| §277 쓰기 경로 | Task 9 | 단위 테스트 + GUI (Task 12 Step 9-10) |

**GUI로만 검증되는 항목** (jsdom이 레이아웃·번들러 평가 순서·실제 PDF 파싱을 실행할 수 없다): §272.1·§272.2의 모듈 로드, §273.3의 색 대비, §274.2의 선택 생존, 그리고 실제 PDF에서의 좌표 정확성. 이들은 각 태스크의 GUI 스텝이 담당하며, 그 스텝을 건너뛰면 해당 요구는 **미검증**이다.
