// §272 PdfPreview가 소유하는 PDFFindController 배선.
//
// doc이 준비되면 EventBus + PDFFindController를 만들어 setDocument한다.
// updatefindmatchescount/updatefindcontrolstate를 구독해 전체 매치 수와 현재
// 인덱스를 state로 끌어올리고, findController.pageMatches/pageMatchesLength를
// (EOL 보정을 거쳐) 페이지별 MatchPosition[]으로 변환해 캐시한다 — PdfPreview는
// getPageMatches(pageNumber)로 그 캐시를 읽어 각 PdfPage에 matches prop으로
// 내려준다. 캐시는 실제로 바뀐 페이지만 새 객체로 교체한다(다른 페이지는 이전
// 참조를 그대로 유지) — PdfPage의 `[matches]`-keyed effect가 안 바뀐 페이지에는
// 다시 안 그리도록.
import { useCallback, useEffect, useRef, useState } from "react";

import type { MatchPosition } from "./pdf-find";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import type {
  EventBus,
  PDFFindController,
  PDFLinkService,
} from "pdfjs-dist/legacy/web/pdf_viewer.mjs";

import { createLinkService, loadPdfViewerModule } from "./pdf-find";
import {
  convertMatchesWithEol,
  type EolTextItem,
  toEolItems,
} from "./pdf-find-eol";

/** §272 usePdfFind이 내놓는 표면 중 PdfFindBar를 그리는 데 필요한 부분 — 부모
 * (PdfPreview → App.tsx)가 그대로 끌어올려 PdfFindBar props로 펼친다. */
export interface PdfFindApi {
  currentIdx: number;
  matchCount: number;
  onNext: () => void;
  onPrev: () => void;
  onQueryChange: (query: string, caseSensitive: boolean) => void;
}

export interface PdfPageMatches {
  currentIdx: number;
  positions: MatchPosition[];
}

interface FindMatchesCountEvent {
  matchesCount: { current: number; total: number };
}

export function usePdfFind({
  doc,
  getScrollElement,
  isOpen,
  pages,
}: {
  doc: null | PDFDocumentProxy;
  /** 스크롤 컨테이너를 호출 시점에 얻는다 — linkService.page/getPage와 같은
   * "값이 아니라 함수" 패턴(pdf-find.ts createLinkService 참조). */
  getScrollElement: () => HTMLElement | null;
  isOpen: boolean;
  pages: PDFPageProxy[];
}): PdfFindApi & {
  getPageMatches: (pageNumber: number) => PdfPageMatches | undefined;
  registerPageEl: (pageNumber: number, el: HTMLElement | null) => void;
} {
  const [matchCount, setMatchCount] = useState(0);
  const [currentIdx, setCurrentIdx] = useState(-1);
  // getPageMatches()가 읽는 캐시가 바뀔 때 PdfPreview를 다시 그리게 만드는
  // 용도 — 값 자체는 쓰지 않는다.
  const [, bumpVersion] = useState(0);

  const pageElsRef = useRef<Map<number, HTMLElement>>(new Map());
  const pageItemsRef = useRef<Map<number, EolTextItem[]>>(new Map());
  const positionsRef = useRef<Map<number, PdfPageMatches>>(new Map());
  const eventBusRef = useRef<EventBus | null>(null);
  const findControllerRef = useRef<null | PDFFindController>(null);
  const queryRef = useRef("");
  const caseSensitiveRef = useRef(false);
  const recomputeRef = useRef<() => void>(() => {});

  const registerPageEl = useCallback(
    (pageNumber: number, el: HTMLElement | null) => {
      if (el) pageElsRef.current.set(pageNumber, el);
      else pageElsRef.current.delete(pageNumber);
    },
    [],
  );

  const getCurrentPage = useCallback((): number => {
    const entries = [...pageElsRef.current.entries()].sort(
      (a, b) => a[0] - b[0],
    );
    const scrollEl = getScrollElement();
    if (!scrollEl || entries.length === 0) return 1;
    const top = scrollEl.getBoundingClientRect().top;
    let current = entries[0][0];
    for (const [num, el] of entries) {
      if (el.getBoundingClientRect().top <= top + 1) current = num;
      else break;
    }
    return current;
  }, [getScrollElement]);

  const scrollToPage = useCallback((n: number) => {
    pageElsRef.current.get(n)?.scrollIntoView({ block: "start" });
  }, []);

  const getPageMatches = useCallback(
    (pageNumber: number) => positionsRef.current.get(pageNumber),
    [],
  );

  // §272 각 페이지의 텍스트 항목을 한 번씩 캐시한다 — findController가 주는
  // pageMatches/pageMatchesLength를 textDivs 좌표로 되돌리려면 그 페이지의
  // hasEOL 목록이 필요하다(pdf-find-eol.ts). PdfPage가 쓰는 streamTextContent와
  // 같은 옵션(disableNormalization, includeMarkedContent 없음)이어야 항목
  // 순서가 findController의 도메인과 1:1로 맞는다 — 이 정렬 전제는 검증됨
  // (PdfPage.tsx와 findController 둘 다 includeMarkedContent를 안 쓴다).
  useEffect(() => {
    pageItemsRef.current.clear();
    if (pages.length === 0) return;
    let cancelled = false;
    for (const page of pages) {
      page
        .getTextContent({ disableNormalization: true })
        .then((tc) => {
          if (cancelled) return;
          pageItemsRef.current.set(page.pageNumber, toEolItems(tc.items));
          recomputeRef.current();
        })
        .catch(() => {
          // 페이지 텍스트 추출 실패 — 그 페이지는 매치를 못 칠한다
        });
    }
    return () => {
      cancelled = true;
    };
  }, [pages]);

  // §272 doc이 바뀔 때마다 EventBus + PDFFindController를 새로 만든다.
  useEffect(() => {
    if (!doc) return;
    let cancelled = false;
    let bus: EventBus | null = null;
    let onCount: ((e: FindMatchesCountEvent) => void) | null = null;
    let onState: ((e: FindMatchesCountEvent) => void) | null = null;
    // ref는 안정적이지만(useRef로 한 번만 만든 같은 Map), 클린업에서
    // ref.current를 직접 읽지 말라는 lint 제안을 따라 지금 값을 잡아둔다.
    const positionsCache = positionsRef.current;

    loadPdfViewerModule().then((mod) => {
      if (cancelled) return;
      bus = new mod.EventBus();
      const linkService = createLinkService({
        getPage: getCurrentPage,
        pagesCount: doc.numPages,
        scrollToPage,
      });
      const findController = new mod.PDFFindController({
        eventBus: bus,
        // PdfLinkServiceAdapter는 findController가 실제로 읽는 page/pagesCount
        // 만 갖춘 최소 표면이다(pdf-find.ts 주석). 진짜 PDFLinkService의 나머지
        // 멤버(goToDestination 등)는 findController가 내부에서 절대 부르지
        // 않는다 — pdf_viewer.mjs의 #nextMatch/#updatePage 본문을 읽어 확인했다.
        linkService: linkService as unknown as PDFLinkService,
      });
      // §272 onIsPageVisible을 안 채워도 기본값(null)이 같은 효과(항상 true)를
      // 내지만, 브리프가 명시적으로 연결하라고 지시했고 앞으로(§272 Task 12)
      // 실제 가시성 체크로 바꿀 자리이므로 의도를 남겨둔다.
      findController.onIsPageVisible = () => true;
      findController.setDocument(doc);

      const recomputeAll = () => {
        let changed = false;
        const pageMatches: number[][] = findController.pageMatches ?? [];
        const pageMatchesLength: number[][] =
          findController.pageMatchesLength ?? [];
        const selected = findController.selected ?? {
          matchIdx: -1,
          pageIdx: -1,
        };
        for (let idx = 0; idx < doc.numPages; idx++) {
          const pageNumber = idx + 1;
          const items = pageItemsRef.current.get(pageNumber);
          if (!items) continue;
          const matches = pageMatches[idx] ?? [];
          const matchesLength = pageMatchesLength[idx] ?? [];
          const positions = matches.length
            ? convertMatchesWithEol(matches, matchesLength, items)
            : [];
          const pageCurrentIdx =
            selected.pageIdx === idx ? selected.matchIdx : -1;
          const prev = positionsRef.current.get(pageNumber);
          if (
            prev &&
            prev.currentIdx === pageCurrentIdx &&
            samePositions(prev.positions, positions)
          ) {
            continue;
          }
          positionsRef.current.set(pageNumber, {
            currentIdx: pageCurrentIdx,
            positions,
          });
          changed = true;
        }
        if (changed) bumpVersion((v) => v + 1);
      };
      recomputeRef.current = recomputeAll;

      onCount = (e) => {
        setMatchCount(e.matchesCount.total);
        recomputeAll();
      };
      onState = (e) => {
        setMatchCount(e.matchesCount.total);
        setCurrentIdx(
          e.matchesCount.current > 0 ? e.matchesCount.current - 1 : -1,
        );
        recomputeAll();
      };
      bus.on("updatefindmatchescount", onCount);
      bus.on("updatefindcontrolstate", onState);

      eventBusRef.current = bus;
      findControllerRef.current = findController;
    });

    return () => {
      cancelled = true;
      recomputeRef.current = () => {};
      if (bus) {
        if (onCount) bus.off("updatefindmatchescount", onCount);
        if (onState) bus.off("updatefindcontrolstate", onState);
      }
      // setDocument(null)은 pdf_viewer.mjs 런타임이 명시적으로 처리하는
      // 정리 경로다(`if (!pdfDocument) return;`) — 다만 .d.ts의 파라미터
      // 타입은 null을 허용하지 않게 선언돼 있어(문서·타입 불일치) 캐스트한다.
      findControllerRef.current?.setDocument(
        null as unknown as PDFDocumentProxy,
      );
      eventBusRef.current = null;
      findControllerRef.current = null;
      positionsCache.clear();
      setMatchCount(0);
      setCurrentIdx(-1);
    };
    // getCurrentPage/scrollToPage는 ref 기반이라 안정적이다 — doc만 실제로
    // 컨트롤러 재생성을 트리거해야 한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc]);

  const dispatchFind = useCallback(
    (opts: { findPrevious?: boolean; type?: string }) => {
      const bus = eventBusRef.current;
      if (!bus) return;
      bus.dispatch("find", {
        caseSensitive: caseSensitiveRef.current,
        entireWord: false,
        findPrevious: opts.findPrevious ?? false,
        highlightAll: true,
        matchDiacritics: false,
        query: queryRef.current,
        type: opts.type,
      });
    },
    [],
  );

  const onQueryChange = useCallback(
    (query: string, caseSensitive: boolean) => {
      queryRef.current = query;
      caseSensitiveRef.current = caseSensitive;
      dispatchFind({});
    },
    [dispatchFind],
  );

  const onNext = useCallback(
    () => dispatchFind({ findPrevious: false, type: "again" }),
    [dispatchFind],
  );
  const onPrev = useCallback(
    () => dispatchFind({ findPrevious: true, type: "again" }),
    [dispatchFind],
  );

  // §272 찾기 바가 닫히면 findController에 알리고(하이라이트 상태 리셋) 우리
  // 쪽 캐시도 비운다 — PdfPage들이 다음 렌더에서 matches=undefined를 받아
  // clearMatches를 탄다.
  useEffect(() => {
    if (isOpen) return;
    eventBusRef.current?.dispatch("findbarclose", {});
    queryRef.current = "";
    caseSensitiveRef.current = false;
    if (positionsRef.current.size > 0) {
      positionsRef.current.clear();
      bumpVersion((v) => v + 1);
    }
    setMatchCount(0);
    setCurrentIdx(-1);
  }, [isOpen]);

  return {
    currentIdx,
    getPageMatches,
    matchCount,
    onNext,
    onPrev,
    onQueryChange,
    registerPageEl,
  };
}

function samePositions(a: MatchPosition[], b: MatchPosition[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((pos, i) => {
    const other = b[i];
    return (
      pos.begin.divIdx === other.begin.divIdx &&
      pos.begin.offset === other.begin.offset &&
      pos.end.divIdx === other.end.divIdx &&
      pos.end.offset === other.end.offset
    );
  });
}
