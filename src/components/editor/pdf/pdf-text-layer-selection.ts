// §274 UX fix round 3 (defect A) — pdf.js's own TextLayerBuilder
// (web/pdf_viewer.mjs) ships a mouse/selectionchange-driven mechanism this
// project never picked up, because PdfPage.tsx drives pdf.js's low-level
// `TextLayer` class directly (see PdfPage.tsx's disableNormalization
// comment) instead of going through TextLayerBuilder. Without it, engines
// that still rely on native hit-testing to extend a selection (see
// isFirefoxOrModernChromium below — recent Chromium/Firefox fixed this
// natively and skip the workaround, but WebKit/Safari — which is what
// Tauri's WKWebView on macOS renders with — still needs it) can anchor the
// extending boundary to the wrong span whenever a drag crosses the GAPS
// between pdf.js's scattered, absolutely-positioned text-layer spans (a
// paragraph boundary with no blank line, or reversing drag direction) —
// which reads as the selection jumping backward/upward. This is not a
// geometry bug in pdf.css (see selection-ux-fix-3-report.md for the
// rule-by-rule comparison against pdfjs-dist's own .textLayer stylesheet)
// — pdf.js's own viewer avoids the symptom purely through this mechanism,
// so we port it here rather than re-deriving it.
//
// The trick: an invisible "endOfContent" element is kept as a normally
// flowing block the browser CAN reliably hit-test, and on every
// `selectionchange` we reposition it to sit immediately after whichever
// node the selection is actually extending from (see resolveSelectionAnchor
// below) — sized to the text layer's own dimensions. A drag into a blank
// gap then lands on this element instead of hunting among sparse spans.

const textLayers = new Map<HTMLDivElement, HTMLDivElement>();
let globalListenerController: AbortController | null = null;
let isFirefoxOrModernChromium: boolean | undefined;
let prevRange: null | Range = null;

/**
 * 텍스트 레이어 컨테이너 하나를 이 추적 대상으로 등록한다. PdfPage.tsx의
 * 텍스트 레이어 렌더 완료 콜백(마지막에, 기존 find 관련 줄들은 건드리지
 * 않고 추가로) 호출한다 — pdf.js의 TextLayerBuilder가 자기 `render()`
 * 완료 직후 `endOfContent`를 붙이는 것과 같은 시점이다.
 */
export function attachTextLayerEndOfContent(container: HTMLDivElement): void {
  const end = document.createElement("div");
  end.className = "endOfContent";
  container.append(end);
  container.addEventListener("mousedown", () => {
    container.classList.add("selecting");
  });
  textLayers.set(container, end);
  enableGlobalListener();
}

/** PdfPage.tsx의 텍스트 레이어 재렌더/언마운트 시 호출 — 다음 attach가
 * 항상 새 endOfContent로 시작하도록 등록을 완전히 지운다. */
export function detachTextLayerEndOfContent(container: HTMLDivElement): void {
  textLayers.delete(container);
  disableGlobalListenerIfIdle();
}

/**
 * pdf.js 원본(web/pdf_viewer.mjs, TextLayerBuilder의 selectionchange 핸들러)의
 * anchor 판정 로직을 그대로 옮긴다. range가 이전 range에서 START 경계만
 * 바뀐 것이면(뒤에서 앞으로, 즉 위로 드래그) startContainer를 anchor로 삼고,
 * 그 외(정방향 드래그, 또는 이번이 첫 selectionchange)에는 endContainer를
 * 쓴다. 텍스트 노드는 그 부모 span으로 끌어올리고, 드래그가 span의 시작
 * 경계(offset 0)에서 멈췄다면 그 span 자체가 아니라 문서 순서상 바로 앞의
 * 온전한(자식이 있는) 형제를 anchor로 삼는다 — 비어 있는 형제(`<br>` 등)는
 * 건너뛴다.
 *
 * modifyStart도 함께 돌려준다 — 호출부가 endOfContent를 anchor 앞(뒤로
 * 드래그)에 꽂을지 뒤(정방향)에 꽂을지 결정하는 데 같은 판정이 다시
 * 필요하기 때문이다.
 */
export function resolveSelectionAnchor(
  range: Range,
  prevRangeArg: null | Range,
): { anchor: Node | null; modifyStart: boolean } {
  const modifyStart =
    prevRangeArg !== null &&
    (range.compareBoundaryPoints(Range.END_TO_END, prevRangeArg) === 0 ||
      range.compareBoundaryPoints(Range.START_TO_END, prevRangeArg) === 0);
  let anchor: Node | null = modifyStart
    ? range.startContainer
    : range.endContainer;
  if (anchor.nodeType === Node.TEXT_NODE) {
    anchor = anchor.parentNode;
  }
  if (!anchor) return { anchor: null, modifyStart };

  if (!modifyStart && range.endOffset === 0) {
    do {
      while (anchor && !anchor.previousSibling) {
        anchor = anchor.parentNode;
      }
      if (!anchor) return { anchor: null, modifyStart };
      anchor = anchor.previousSibling;
    } while (anchor && anchor.childNodes.length === 0);
  }
  return { anchor, modifyStart };
}

/** pdf.js 원본과 같은 엔진 판별 — Firefox와 최신 Chromium(148+)은 갭을
 * 넘는 드래그를 이미 올바르게 처리해 이 보정이 필요 없다. */
function detectIsFirefoxOrModernChromium(sample: HTMLDivElement): boolean {
  const isFirefox =
    getComputedStyle(sample).getPropertyValue("-moz-user-select") === "none";
  if (isFirefox) return true;
  const chromiumVersion = /\bChrome\/(\d+)\b/.exec(navigator.userAgent)?.[1];
  return !!chromiumVersion && parseInt(chromiumVersion, 10) >= 148;
}

function disableGlobalListenerIfIdle() {
  if (textLayers.size === 0) {
    globalListenerController?.abort();
    globalListenerController = null;
    prevRange = null;
  }
}

function enableGlobalListener() {
  if (globalListenerController) return;
  globalListenerController = new AbortController();
  const { signal } = globalListenerController;

  let isPointerDown = false;
  document.addEventListener(
    "pointerdown",
    () => {
      isPointerDown = true;
    },
    { signal },
  );
  document.addEventListener(
    "pointerup",
    () => {
      isPointerDown = false;
      textLayers.forEach(resetEndOfContent);
    },
    { signal },
  );
  window.addEventListener(
    "blur",
    () => {
      isPointerDown = false;
      textLayers.forEach(resetEndOfContent);
    },
    { signal },
  );
  document.addEventListener(
    "keyup",
    () => {
      if (!isPointerDown) textLayers.forEach(resetEndOfContent);
    },
    { signal },
  );
  document.addEventListener("selectionchange", handleSelectionChange, {
    signal,
  });
}

function handleSelectionChange() {
  const selection = document.getSelection();
  if (!selection || selection.rangeCount === 0) {
    textLayers.forEach(resetEndOfContent);
    return;
  }

  const active = new Set<HTMLDivElement>();
  for (let i = 0; i < selection.rangeCount; i++) {
    const range = selection.getRangeAt(i);
    for (const textLayerDiv of textLayers.keys()) {
      if (!active.has(textLayerDiv) && range.intersectsNode(textLayerDiv)) {
        active.add(textLayerDiv);
      }
    }
  }
  for (const [textLayerDiv, endDiv] of textLayers) {
    if (active.has(textLayerDiv)) {
      textLayerDiv.classList.add("selecting");
    } else {
      resetEndOfContent(endDiv, textLayerDiv);
    }
  }

  if (isFirefoxOrModernChromium === undefined) {
    const sample = textLayers.keys().next().value;
    isFirefoxOrModernChromium = sample
      ? detectIsFirefoxOrModernChromium(sample)
      : false;
  }
  if (isFirefoxOrModernChromium) return;

  const range = selection.getRangeAt(0);
  const { anchor, modifyStart } = resolveSelectionAnchor(range, prevRange);
  prevRange = range.cloneRange();
  if (!anchor || !(anchor instanceof Element) || !anchor.parentElement) return;

  const parentTextLayer = anchor.parentElement.closest(
    ".pdf-text-layer",
  ) as HTMLDivElement | null;
  const endDiv = parentTextLayer ? textLayers.get(parentTextLayer) : undefined;
  if (!parentTextLayer || !endDiv) return;

  endDiv.style.width = parentTextLayer.style.width;
  endDiv.style.height = parentTextLayer.style.height;
  endDiv.style.userSelect = "text";
  anchor.parentElement.insertBefore(
    endDiv,
    modifyStart ? anchor : anchor.nextSibling,
  );
}

function resetEndOfContent(end: HTMLDivElement, textLayer: HTMLDivElement) {
  textLayer.append(end);
  end.style.width = "";
  end.style.height = "";
  textLayer.classList.remove("selecting");
}
