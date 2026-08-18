# Part 15. PDF 뷰어 고도화 (§270–§279)

> 상태: 설계 승인 대기
> 관련: §5.1 PDF 파일 뷰어, §30b 블록 참조, §30c 블록 참조 내비게이션, §32 호버 프리뷰, §29 링크 인덱스

## 15.1 개요 (§270)

현재 PDF 뷰어(`src/components/editor/PdfPreview.tsx`, 229줄)는 pdfjs 저수준 API로 직접 구성한
커스텀 뷰어다. pdfjs 기본 뷰어(`PDFViewer`)를 쓰지 않은 것은 의도적이다 — 앱 공용 `zoomLevel`과
lazy 페이지 렌더를 직접 제어하기 위해서다. 제공 기능은 렌더·줌·텍스트 선택뿐이다.

여기에 두 기능을 추가한다.

1. **PDF 내 찾기** — 문서 전체 텍스트 검색, 매치 하이라이트, 이전/다음 이동
2. **텍스트 하이라이트 + reference** — PDF 텍스트를 하이라이트하고, 그 하이라이트를 가리키는
   reference를 다른 노트에서 사용

### 확정된 설계 결정

| # | 결정 | 근거 |
|---|---|---|
| 1 | 하이라이트는 **마크다운 블록**으로 저장 (Logseq 방식) | 백링크·전문 검색·블록 임베드가 전부 따라온다 |
| 2 | 노트 삽입 경로는 **클립보드 복사** | 분할 뷰가 없어 드래그 앤 드롭이 불가능 (§270.1) |
| 3 | 1차 범위 = **찾기 + 텍스트 하이라이트** | 영역(이미지) 하이라이트는 2차 (§279) |
| 4 | reference는 **기존 블록 참조** `((target#^id\|display))` 재사용 | 새 마크다운 문법 0개, 파이프라인 변경 0개 |
| 5 | 노트에서의 내용 표시는 **`display` 속성에 텍스트를 구워 넣어** 해결 | 블록 참조의 전역 동작을 바꾸지 않는다 (§275) |
| 6 | 동반 노트는 **전용 폴더 + 경로 미러링** | 파일 트리 소음 회피 + 파일명 충돌 구조적 제거 |
| 7 | 하이라이트 색 **5색**, 사이드카에만 저장 | `==text==` mark에 color 속성이 없다 (§273.3) |

### §270.1 레이아웃 제약 (확정 사실)

Baram에는 **분할 뷰가 없다.** 탭 하나가 에디터 영역 전체를 차지하며, `RightPanelMode`는
`chat | help | memories | none | photo-gallery | properties`뿐이다 (`src/stores/ui/ui.ts:15`).
따라서 PDF 탭이 활성인 동안 마크다운 에디터는 화면에 없고, Logseq의 "하이라이트를 노트로 드래그"는
구현할 수 없다. 클립보드 복사가 유일하게 성립하는 경로다.

---

## 15.2 뷰어 구조 재편 (§271)

두 기능을 현재의 단일 파일에 넣으면 500줄을 넘어 프로젝트 규칙(단일 파일 ~300줄)을 위반한다.
기능 추가 **전에** 분해한다.

```
src/components/editor/pdf/
├── PdfPreview.tsx          문서 로드 · baseScale · 페이지 목록 · 툴바 마운트   (~130줄)
├── PdfPage.tsx             canvas · text layer · 하이라이트/매치 오버레이      (~140줄)
├── PdfToolbar.tsx          상주 툴바 (페이지·줌·찾기·영역모드)                 (~110줄)
├── PdfFindBar.tsx          찾기 입력 UI                                        (~130줄)
├── PdfSelectionPopup.tsx   선택/하이라이트 팝업                                (~120줄)
├── pdf-find.ts             FindController 어댑터 + 매치 → DOM 매핑             (~150줄)
├── pdf-highlight-geom.ts   좌표 변환 (client ↔ PDF user space)                 (~90줄)
└── pdf-highlight-store.ts  사이드카 I/O + 동반 노트 쓰기                       (~160줄)
```

기존 `src/components/editor/PdfPreview.tsx`는 삭제하고 `App.tsx`의 lazy import 경로를
`./components/editor/pdf/PdfPreview`로 옮긴다.

---

## 15.3 PDF 내 찾기 (§272)

### §272.1 pdfjs 부품 조달

이미 설치된 `pdfjs-dist@6.2.108`의 `legacy/web/pdf_viewer.mjs`가 `PDFFindController`와 `EventBus`를
export한다. 어려운 부분(발음부호·합자·전각/반각·줄바꿈 하이픈 정규화)이 여기에 들어 있다.

**`TextHighlighter`는 export되지 않는다.** 클래스는 번들 안(`pdf_viewer.mjs:10872`)에 있으나
export 목록(`:14754`)과 `globalThis.pdfjsViewer`(`:14729`) 어디에도 없다. 매치를 DOM에 칠하는
부분은 직접 구현한다 (§272.3).

### §272.2 모듈 로드 순서 — 정적 import 금지

`pdf_viewer.mjs`는 pdfjs core를 import하지 않고 `globalThis.pdfjsLib`에서 구조분해한다
(`:5033`). 그 전역은 `pdf.mjs`가 평가될 때 스스로 설정한다(`pdf.mjs:34374`).

정적 `import`는 평가 순서를 보장하지 않으므로 — 두 모듈 사이에 의존 간선이 없다 — **반드시
동적 import를 쓴다**:

```ts
// pdf-find.ts
export async function loadFindController() {
  await import("pdfjs-dist/legacy/build/pdf.mjs"); // globalThis.pdfjsLib 설정
  return import("pdfjs-dist/legacy/web/pdf_viewer.mjs");
}
```

ES 모듈은 싱글턴이므로 `pdf.mjs`가 이미 정적 import로 평가되었다면 위 동적 import는 재평가 없이
같은 인스턴스를 돌려준다. 즉 비용 없이 순서만 보장한다.

부수 효과로 14,756줄짜리 뷰어 번들이 메인 청크에서 빠진다 (앱 시작 예산에 유리).

### §272.3 어댑터와 매치 렌더링

`PDFFindController`가 뷰어에 요구하는 표면은 셋뿐이다
(`pdf_viewer.mjs:5997, 6091, 6138, 6178, 6193`에서 확인):

```ts
const linkService = {
  get pagesCount() { return doc.numPages; },
  get page() { return currentPageRef.current; },
  set page(n: number) { scrollToPage(n); },
};
findController.onIsPageVisible = (n) => visiblePagesRef.current.has(n);
```

매치 렌더링은 `TextHighlighter._convertMatches`(`:10920`)를 이식한다. 입력은
`findController.pageMatches[i]` / `pageMatchesLength[i]`와 우리 `TextLayer`의
`textContentItemsStr` getter(`pdf.mjs:21277`)뿐이며, 알고리즘은 누적 길이 위를 걷는 순수 산술이다.

오프셋은 **이미 원문 기준**이다 — `#calculateMatch`가 `getOriginalIndex(diffs, ...)`로
정규화 인덱스를 되돌린 뒤에 배열에 넣는다(`:6072`). 정규화 역매핑을 우리가 할 필요는 없다.

### §272.4 ⚠️ 텍스트 추출 파라미터 정합 (필수)

`PDFFindController`는 `{ disableNormalization: true }`로 추출한다(`:6134`).
현재 `PdfPreview`는 `page.streamTextContent()`를 **인자 없이** 호출하므로 정규화가 켜져 있다
(`PdfPreview.tsx:197`).

두 쪽의 item 문자열이 달라지면 오프셋이 어긋나 **엉뚱한 글자에 하이라이트가 칠해진다.**
특정 PDF에서만 재현되는 종류의 결함이므로, 텍스트 레이어를 다음으로 바꾸고 테스트로 고정한다:

```ts
textContentSource: page.streamTextContent({ disableNormalization: true })
```

### §272.5 lazy 페이지와의 상호작용

페이지는 `IntersectionObserver`로 지연 마운트되므로 화면 밖 페이지에는 텍스트 레이어 DOM이 없다.

- **매치 개수·이동은 영향 없음** — `PDFFindController`는 `getTextContent`로 전 페이지를 스캔한다.
- 페이지가 마운트될 때 해당 페이지의 매치를 다시 칠한다.
- 매치로 점프하면 `linkService.page` setter가 스크롤 → 페이지 마운트 → 매치 렌더 순으로 진행된다.

### §272.6 UI 배선

- PDF 탭이 활성일 때 `Cmd+F`는 마크다운 `FindReplaceBar` 대신 `PdfFindBar`로 라우팅한다.
- 표시 항목: 입력창, `3 / 27` 형태의 매치 카운트, 이전/다음, 닫기, 대소문자 구분 토글.
- `Enter` = 다음, `Shift+Enter` = 이전, `Esc` = 닫기.

---

## 15.4 하이라이트 데이터 모델 (§273)

### §273.1 동반 노트

PDF 하나당 마크다운 노트 하나. 위치는 **vault 루트의 `highlights/` 아래에 PDF의 상대 경로를 미러링**한다.

```
papers/attention.pdf          →  highlights/papers/attention.md
research/nlp/bert.pdf         →  highlights/research/nlp/bert.md
```

하이라이트 하나 = **문단 하나**, 마지막에 블록 ID:

```markdown
Attention mechanisms allow modeling of dependencies without regard to distance ^h7k2m9

We propose a new simple network architecture, the Transformer ^p3n8q1
```

형식 제약 두 가지:

- **한 줄이어야 한다.** `findBlockContent`(`src/utils/editor/block-nav.ts:8`)는 ` ^id`로 끝나는
  줄을 찾는다. PDF 선택 텍스트의 줄바꿈은 공백으로 접합한다.
- **리스트·인용 마커를 쓰지 않는다.** `findBlockContent`는 heading 접두사(`#`)만 제거하므로
  `- `나 `> `는 프리뷰에 그대로 노출된다. 평문 문단 + 문단 사이 빈 줄을 쓴다.

### §273.2 기하 사이드카

기하 정보는 마크다운에 담을 수 없으므로 별도 JSON에 둔다.
사이드카는 **PDF의 상대 경로**를 `.baram/pdf-highlights/` 아래에 미러링한다
(동반 노트가 `highlights/` 아래에 미러링하는 것과 같은 규칙, 다른 뿌리):

```
papers/attention.pdf  →  .baram/pdf-highlights/papers/attention.json
```

```json
{
  "version": 1,
  "pdf": "papers/attention.pdf",
  "companion": "highlights/papers/attention.md",
  "highlights": [
    {
      "id": "h7k2m9",
      "kind": "text",
      "page": 3,
      "color": "yellow",
      "rects": [[72.1, 540.3, 380.5, 12.4], [72.1, 526.0, 210.8, 12.4]]
    }
  ]
}
```

- `companion`은 **파생이 아니라 기록**이다. 규칙이 바뀌거나 사용자가 노트를 옮겨도 추적이 끊기지 않는다.
- `kind`는 2차의 영역 하이라이트를 위해 지금 자리를 잡아둔다 (`"text" | "area"`).
- `rects`는 **PDF user space**(scale 1, 회전 미적용) — §274.1.

### §273.3 색상

`Highlight` mark(`==text==`)에는 color 속성이 없다(`src/extensions/marks/highlight.ts`).
마크다운 `==...==`가 색을 실을 수 없으므로 **사이드카가 색의 유일한 저장 위치**다.

5색: `yellow` `green` `blue` `pink` `purple`.
토큰은 `--color-editor-pdf-hl-{name}` (CSS 변수 category 9종 규칙상 `editor` 아래).
캔버스의 글자가 비쳐야 하므로 알파를 포함한 반투명 색으로 정의하며, **라이트/다크 양쪽과
8개 테마 전부에서 확인**한다.

### §273.4 손상 내성

사이드카 파싱은 **항목 단위로 실패**한다. 스키마에 맞지 않는 하이라이트 하나 때문에 파일 전체를
버리면 사용자는 모든 하이라이트를 잃는다. 잘못된 항목만 버리고 나머지는 살리며, 버린 개수를
로그에 남긴다 (조용한 부분 실패 금지).

---

## 15.5 좌표계와 렌더링 (§274)

### §274.1 좌표 변환

선택 → 저장:

1. `selection.getRangeAt(0).getClientRects()` — 뷰포트 기준 사각형들
2. 각 rect에서 `.pdf-page`의 `getBoundingClientRect()`를 빼 **페이지 로컬 좌표**로
3. `viewport.convertToPdfPoint(x, y)`(`pdf.mjs:6970`)로 **PDF user space**로 변환해 저장

저장 → 렌더: `viewport.convertToViewportPoint`로 역변환해 절대 위치 div를 그린다.

PDF user space에 저장하므로 줌·리사이즈·회전·devicePixelRatio 변화에 모두 불변이다.
WKWebView의 `getBoundingClientRect`는 visual 좌표를 반환하지만, 페이지 요소 기준 **상대** 좌표만
쓰므로 zoom 배율이 상쇄된다 — 이 성질은 테스트로 고정한다 (§278).

### §274.2 DOM 레이어 스택

```
.pdf-page
├── <canvas>                  페이지 래스터
├── .pdf-highlight-layer      하이라이트 오버레이   pointer-events: none
├── .pdf-find-layer           찾기 매치 오버레이    pointer-events: none
└── .pdf-text-layer           투명 선택 텍스트      (최상단)
```

텍스트 레이어가 **반드시 최상단**이어야 텍스트 선택과 `Cmd+C`가 동작한다.
따라서 하이라이트는 순수 시각 레이어(`pointer-events: none`)로 두고, 하이라이트 클릭은
`.pdf-page`의 클릭 좌표를 저장된 rect와 **히트 테스트**해서 판정한다. 이것이 텍스트 선택을
죽이지 않는 유일한 배치다.

---

## 15.6 reference 생성과 노트 측 렌더링 (§275)

### §275.1 왜 블록 참조의 전역 동작을 바꾸지 않는가

Baram에는 이미 두 구조가 의도적으로 나뉘어 있다:

| | `blockReference` `((...))` | `blockEmbed` |
|---|---|---|
| 배치 | `group: "inline"` | `group: "block"` |
| 표시 | 주소 | 내용 |
| 편집 | 불가 | 가능 + 양방향 동기 |

블록 참조가 내용을 렌더하게 만들면 이 구분이 무너지고, 추가로 **성능 비용**이 발생한다:
`useEmbedSync`의 로드 경로(`src/hooks/use-embed-sync.ts:75-77`)는 `openFiles` 캐시를 보고 없으면
`readFile`을 호출하는데 **NodeView 간 공유 캐시가 없다.** 동반 노트는 보통 열려 있지 않으므로
하이라이트 ref 40개가 달린 노트는 같은 파일을 40번 읽는다.

### §275.2 `display` 속성 활용 (채택)

`display` 속성은 파이프라인 전 구간에 이미 구현·테스트되어 있다:

| 단계 | 위치 |
|---|---|
| 정규식 | `src/pipeline/block-id.ts:42` — `(?:\|([^)]+))?` |
| 파싱 | `block-id.ts:53` — `display: match[3] \|\| null` |
| 직렬화 | `block-id.ts:65` — `((ref\|display))` |
| 렌더 | `src/extensions/nodes/block-reference-view.tsx:21` — `display \|\| (target ? …)` |
| 테스트 | `src/pipeline/__tests__/block-id.test.ts:108` (한글 display 포함) |

따라서 ref 복사 시 하이라이트 텍스트를 `display`에 구워 넣으면 **코드 변경 0, 파일 I/O 0,
성능 비용 0**으로 내용이 렌더된다:

```
((highlights/papers/attention#^h7k2m9|Attention mechanisms allow modeling of dependencies))
```

스냅샷이라는 성질도 이 경우엔 **의미상 옳다** — PDF 텍스트는 불변이므로 소스와 어긋날 여지가 없다.
반대로 일반 블록 참조는 대상이 계속 편집되므로 스냅샷이 부적절하다. 두 경우가 다른 성질이라
다른 표시가 맞고, 그래서 일반 블록 참조에는 이 방식을 강요하지 않는다.

라이브 내용 확인 경로는 `Cmd+hover`(`src/components/editor/HoverPreview.tsx:132`)가 그대로 제공한다.

### §275.3 display 생성 규칙

두 가지 함정을 복사 시점에 처리한다.

1. **`)` 와 `|` 금지.** 정규식이 `([^)]+)`이므로 `)`를 담을 수 없는데, 논문 텍스트에는 흔하다
   (`"as shown in (Fig. 3)"`). 두 문자를 제거/치환한다. **원문은 동반 노트에 온전히 보존**되므로
   display의 손실은 허용된다 — display는 표시용 요약이다.
2. **길이 절단.** 80자를 넘으면 자르고 `…`를 붙인다. 전문은 동반 노트와 hover에 있다.

### §275.4 경로 한정 target

경로 미러링은 **파일** 충돌을 없애지만 **stem 모호성**은 남는다.
`highlights/papers/attention.md`와 `highlights/notes/attention.md`가 공존할 수 있고,
`resolveWikilinkTarget`은 stem으로 트리를 매칭하며 **첫 매치가 이긴다.**

따라서 ref를 발행할 때 **항상 경로를 한정한다** — `((highlights/papers/attention#^id|…))`.
`resolveWikilinkTarget`은 `[[path/name]]` 형태를 지원하므로 그대로 해결된다.

### §275.5 붙여넣기 즉시 노드화 (InputRule + pasteRule)

`src/extensions/nodes/block-reference.ts`에는 **InputRule도 pasteRule도 없다.**
그래서 `((...))`를 붙여넣으면 노드가 되지 않고, 저장 후 재오픈으로 파이프라인을 한 번 돌아야
비로소 렌더된다. 클립보드 복사를 삽입 경로로 삼은 이상 이것은 반드시 고쳐야 한다.

`src/extensions/nodes/wikilink.ts`가 이미 가진 `InputRule` + `nodePasteRule` 패턴을 그대로 적용하고,
정규식은 `BLOCK_REF_RE`(`block-id.ts:42`)를 재사용한다. 이는 블록 참조 전반에 이로운 변경이며
어떤 구분도 무너뜨리지 않는다.

**syntax-reveal 통합은 하지 않는다.** `syntax-reveal-state.ts:13`의 kind union
(`"image" | "link" | "mark" | "wikilink"`)에 `blockReference`를 추가하는 작업은 핵심 플러그인을
건드리는 유일한 조각인데, display 방식에서는 렌더된 텍스트가 곧 원문의 일부이므로
"펼쳐서 원문 보기"의 값이 작다. 값 대비 리스크가 맞지 않는다.

### §275.6 ref 클릭 시 목적지

`handleBlockRefNavigate`(`src/hooks/use-navigation.ts:213`)는 대상 노트를 열고 블록으로 스크롤한다.
하이라이트 ref는 **PDF를 열고 해당 위치로 스크롤한 뒤 잠깐 강조**해야 하므로 분기를 추가한다:
사이드카에 해당 `id`가 존재하면 PDF로, 아니면 기존 동작.

---

## 15.7 UI 표면 (§276)

`src/components/toolbar/FloatingToolbar.tsx`(305줄)는 Tiptap `BubbleMenu`(`@tiptap/react/menus`)
기반이라 **재사용할 수 없다** — PDF는 ProseMirror 문서가 아니다. 위치 계산은 직접 작성한다
(`src/components/toolbar/table-toolbar-position.ts`가 49줄짜리 순수 기하로 참고 가능).

성격이 다른 두 표면이 필요하다.

### §276.1 PDF 툴바 (상주, 문서 단위)

PDF 위에 떠 있으며 항상 보인다.

- 페이지 `3 / 27` + 이전/다음
- 줌 (앱 공용 `zoomLevel` 연동)
- **찾기 토글**
- **영역 하이라이트 모드 토글** — 2차 구현이지만 **슬롯은 지금 확보한다.** 나중에 끼워 넣으면
  툴바 레이아웃을 다시 짜게 된다.
- 하이라이트 목록 열기

### §276.2 선택 팝업 (일시적, 선택 단위)

텍스트를 선택하면 선택 영역 근처에 뜬다.

- 색 스와치 5개
- `Copy reference` — §275.3 규칙으로 생성한 `((…))`
- `Copy text` — 하이라이트 원문 텍스트 (절단·치환 없는 그대로)

이미 만들어진 하이라이트를 클릭했을 때는 위 항목에 더해:

- `Change color`
- `Delete`

### §276.3 텍스트 하이라이트와 영역 하이라이트의 관계

두 하이라이트는 **생성 제스처가 충돌한다.** 텍스트 레이어가 최상단(§274.2)이므로 캔버스 위 드래그를
텍스트 선택이 먼저 먹는다. 같은 제스처를 둘이 나눠 쓸 수 없다.

- **생성 진입점은 분리** — 텍스트는 선택 팝업이 자동으로 뜨고(모드 불필요), 영역은 툴바 모드 토글
  또는 `Alt+드래그`로 진입한다. 토글은 발견 가능성, 단축키는 속도를 담당하며 같은 코드 경로다.
- **관리 메뉴는 완전히 통합** — 생성 이후에는 둘 다 "ref를 가진 하이라이트"일 뿐이다. 클릭하면
  같은 팝업(§276.2)이 뜬다. 사이드카의 `kind` 필드 하나만 값이 다르다.

---

## 15.8 쓰기 경로 (§277)

`src/hooks/use-file-watcher.ts:159`를 읽고 확인한 동작:

| 동반 노트 상태 | `write_file` 결과 |
|---|---|
| 열려 있지 않음 | 조용히 성공 |
| 열림 + clean | 자동 리로드 |
| 열림 + **dirty** | **ConflictModal 팝업** |

PDF를 읽는 중에 충돌 모달이 뜨는 것은 받아들일 수 없다. 타이밍으로 억제하지 않고 원인 기준으로
해결한다 — **버퍼가 열려 있으면 버퍼가 소유자다**:

- `useFileStore.openFiles`에 해당 경로가 있으면 → 스토어 내용에 append하고 정상 저장 흐름에 맡긴다
- 없으면 → `write_file`로 직접 쓴다

동반 노트가 아직 없으면 부모 디렉터리를 `create_dir`로 만든 뒤 생성한다.

---

## 15.9 테스트 전략 (§278)

라운드트립 보존이 최우선 품질 기준이라는 프로젝트 원칙에 따라, 순수 함수 경계를 넓게 잡고
그 위에 단정을 건다.

**찾기**

- 매치 오프셋 → `(divIdx, offset)` 변환: 합성 `textContentItemsStr` 픽스처로 span 경계 걸침,
  다중 매치, 매치가 마지막 div에서 끝나는 경우를 고정
- §272.4 정합: 텍스트 레이어가 `disableNormalization: true`로 추출하는지 단정.
  이 옵션이 빠지면 실패하도록 작성한다

**좌표**

- `pdf-highlight-geom` 왕복 항등: client rect → PDF point → client rect가 여러 scale과
  devicePixelRatio에서 원래 값으로 복귀
- 회전된 페이지(`rotate: 90`)에서도 성립

**사이드카**

- 손상·구버전 입력에서 **나쁜 항목만** 버리고 나머지를 보존 (§273.4). 전부 버리면 실패
- 버린 개수가 로그에 남는지

**reference**

- display 생성: `)` `|` 포함 텍스트, 80자 초과 텍스트, 한글 텍스트
- `serializeBlockRef` → `BLOCK_REF_RE` → `parseBlockRefMatch` 라운드트립이 생성된 display로 성립
- InputRule/pasteRule: `((path/name#^id|display))` 붙여넣기가 노드를 만드는지

**쓰기 경로**

- 동반 노트가 (닫힘 / 열림+clean / 열림+dirty) 3상태에서 각각 어느 경로를 타는지.
  dirty 상태에서 `write_file`이 호출되면 실패

**동반 노트 형식**

- `findBlockContent`가 생성된 문단 형식에서 하이라이트 텍스트만 정확히 반환

---

## 15.10 범위 밖과 후속 (§279)

**2차로 미루는 것**

- **영역(이미지) 하이라이트** — 캔버스 crop + devicePixelRatio 보정 + 이미지 자산 관리가 붙는다.
  사이드카의 `kind` 필드와 툴바 모드 슬롯은 지금 확보해 둔다 (§273.2, §276.1)
- **노트 안 ref chip의 색상 표시** — 색을 입히려면 노트 렌더 시 PDF 사이드카를 비동기로 읽어야 하고,
  ref 하나당 파일 I/O가 붙는다 (§275.1의 문제가 그대로 재발)

**하지 않기로 한 것**

- **블록 참조 전반의 내용 렌더링** — §275.1의 근거로 기각
- **syntax-reveal 통합** — §275.5의 근거로 기각
- **분할 뷰** — §270.1. 별개의 큰 작업이며 이 설계는 그것 없이 성립한다

**알려진 한계**

- **PDF 자체의 백링크 없음.** Rust 링크 인덱서는 `.md`만 수집한다(`collect_md_files`).
  동반 노트가 `.md`이므로 **노트 → 동반 노트 백링크는 이미 동작**하지만, "이 PDF를 참조하는 노트"
  목록은 인덱서 확장이 필요하다
- **PDF 이동 시 링크 끊김.** 동반 노트는 PDF를 따라 이동하지 않는다. 사이드카가 `pdf` 경로를
  기록하므로 복구는 가능하나, rename 훅 연동은 이 범위 밖이다
