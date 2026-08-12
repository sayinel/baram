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

/** 원문을 처음 볼 때 보관한다. 이후 렌더는 항상 이 값에서 다시 시작한다. */
function originalText(div: HTMLElement): string {
  if (div.dataset[ORIGINAL_KEY] === undefined) {
    div.dataset[ORIGINAL_KEY] = div.textContent ?? "";
  }
  return div.dataset[ORIGINAL_KEY];
}
