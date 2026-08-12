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

import type { PdfPageMatches } from "./pdf-find-cache";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import type {
  EventBus,
  PDFFindController,
  PDFLinkService,
} from "pdfjs-dist/legacy/web/pdf_viewer.mjs";

import { createLinkService, loadPdfViewerModule } from "./pdf-find";
import { recomputePageMatches } from "./pdf-find-cache";
import { type EolTextItem, toEolItems } from "./pdf-find-eol";

export type { PdfPageMatches } from "./pdf-find-cache";

/** §272 usePdfFind이 내놓는 표면 중 PdfFindBar를 그리는 데 필요한 부분 — 부모
 * (PdfPreview → App.tsx)가 그대로 끌어올려 PdfFindBar props로 펼친다. */
export interface PdfFindApi {
  currentIdx: number;
  matchCount: number;
  onNext: () => void;
  onPrev: () => void;
  onQueryChange: (query: string, caseSensitive: boolean) => void;
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
  /** §276 Task 12 correction 1 — reactive mirror of getCurrentPage(), kept in
   * sync on scroll (see the effect below). This is what the toolbar's page
   * counter and prev/next boundary checks read. */
  currentPage: number;
  /** §276 Task 12 — the SAME "topmost visible page" reading `createLinkService`
   * feeds the find controller (getPage above). The toolbar's page counter
   * must read this, not a second computation, or it can disagree with where
   * find navigation lands. */
  getCurrentPage: () => number;
  getPageMatches: (pageNumber: number) => PdfPageMatches | undefined;
  registerPageEl: (pageNumber: number, el: HTMLElement | null) => void;
  /** §276 Task 12 — the SAME function `createLinkService` above wires into the
   * find controller's `page` setter. The toolbar's prev/next buttons and any
   * ref-navigation-triggered jump must call this one, not a second registry —
   * a second one would very likely re-register the `display:contents`
   * wrapper instead of `resolvePageBoxEl`'s box-generating child (the I1 bug
   * PdfPreview.tsx's comment documents), and jsdom can't catch that because
   * it returns zero rects for every element regardless of `display`. */
  scrollToPage: (n: number) => void;
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

  // §276 Task 12 correction 1 — 툴바의 페이지 카운터가 읽는 currentPage는
  // "지금 스크롤이 어디 있는가"의 REACTIVE 미러다. getCurrentPage() 자체는
  // (linkService adapter가 쓰는 그대로) 호출 시점에만 계산되는 명령형
  // 함수라 리렌더를 유발하지 않는다 — 스크롤 이벤트에서 다시 샘플링해
  // React state로 끌어올린다. rAF로 묶어 스크롤 픽셀 하나마다 setState가
  // 안 나가게 한다. [pages]도 의존성에 둔다 — 스크롤 이벤트 없이 다른
  // PDF로 전환된 경우에도(§272 lazy 언마운트로 이전 문서의 페이지 엘리먼트가
  // 이미 pageElsRef에서 빠진 뒤) 새 문서 기준으로 즉시 다시 읽는다.
  const [currentPage, setCurrentPage] = useState(1);
  useEffect(() => {
    const scrollEl = getScrollElement();
    if (!scrollEl) return;
    let rafId: null | number = null;
    const sample = () => {
      rafId = null;
      setCurrentPage(getCurrentPage());
    };
    const onScroll = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(sample);
    };
    sample();
    scrollEl.addEventListener("scroll", onScroll);
    return () => {
      scrollEl.removeEventListener("scroll", onScroll);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [getCurrentPage, getScrollElement, pages]);

  // §272 Fix round 1 — I5: [doc] 이펙트의 .then() 안에서 컨트롤러가 뜬 직후
  // 대기 중인 쿼리를 재전송하려면 dispatchFind가 필요하다 — 그 이펙트보다
  // 앞에 선언해 참조할 수 있게 한다(onQueryChange/onNext/onPrev는 그대로
  // 아래에서 이걸 쓴다).
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

  // §272 각 페이지의 텍스트 항목을 한 번씩 캐시한다 — findController가 주는
  // pageMatches/pageMatchesLength를 textDivs 좌표로 되돌리려면 그 페이지의
  // hasEOL 목록이 필요하다(pdf-find-eol.ts). PdfPage가 쓰는 streamTextContent와
  // 같은 옵션(disableNormalization, includeMarkedContent 없음)이어야 항목
  // 순서가 findController의 도메인과 1:1로 맞는다 — 이 정렬 전제는 검증됨
  // (PdfPage.tsx와 findController 둘 다 includeMarkedContent를 안 쓴다).
  //
  // §272 Fix round 1 — I2: isOpen으로 게이팅한다. 찾기 바를 한 번도 안 열면
  // 이 추출은 전혀 필요 없다 — PDFFindController.#extractText가 첫 검색에서
  // 어차피 같은 일을 다시 한다(우리 쪽 결과와 무관하게). 이전 버전은 [pages]
  // 만 보고 문서를 열 때마다 N페이지 전부를 즉시 추출했는데, 이는 lazy 페이지
  // 설계(PdfPage.tsx의 IntersectionObserver)와 정면으로 어긋난다. 늦게
  // 도착하는 항목은 이미 처리돼 있다 — recomputeRef.current() 호출 참조.
  useEffect(() => {
    pageItemsRef.current.clear();
    if (!isOpen || pages.length === 0) return;
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
  }, [isOpen, pages]);

  // §272 doc이 바뀔 때마다 EventBus + PDFFindController를 새로 만든다.
  useEffect(() => {
    if (!doc) return;
    let cancelled = false;
    let bus: EventBus | null = null;
    let onCount: ((e: FindMatchesCountEvent) => void) | null = null;
    let onState: ((e: FindMatchesCountEvent) => void) | null = null;
    // ref는 안정적이다(useRef로 한 번만 만든 같은 Map — recomputeAll이 절대
    // positionsRef.current를 재대입하지 않는다, 아래 참조). 그래서 클린업에서
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
        const { cache, changed } = recomputePageMatches({
          numPages: doc.numPages,
          pageItems: pageItemsRef.current,
          pageMatches: findController.pageMatches ?? [],
          pageMatchesLength: findController.pageMatchesLength ?? [],
          previous: positionsRef.current,
          selected: findController.selected ?? { matchIdx: -1, pageIdx: -1 },
        });
        // §272 Fix round 2 — N1: recomputePageMatches는 순수 함수로 남기려고
        // (테스트하기 좋게) 호출마다 새 Map을 만든다(pdf-find-cache.ts의
        // `new Map(previous)`) — 아무것도 안 바뀌어도. 그 반환값으로
        // positionsRef.current를 통째로 바꿔치기하면(이전 버전이 그랬다)
        // 위에서 캡처한 positionsCache와 어긋나 버려서, 이 이펙트의
        // 클린업(:246 근처 positionsCache.clear())이 이미 버려진 Map을
        // 지우고 진짜 살아있는 Map은 영영 안 지워진다 — 문서를 바꿔도(bar를
        // 안 닫고) 이전 문서의 매치 위치가 새 문서로 새어 들어간다. 그래서
        // 여기서는 참조를 바꾸지 않고 **내용만** 옮겨 담는다 — ref의 Map
        // identity는 이펙트 생애 내내 절대 안 바뀐다(위 positionsCache 캡처가
        // 계속 유효한 이유).
        if (changed) {
          positionsRef.current.clear();
          for (const [pageNumber, matches] of cache) {
            positionsRef.current.set(pageNumber, matches);
          }
          bumpVersion((v) => v + 1);
        }
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

      // §272 Fix round 1 — I5: 컨트롤러가 뜨는 동안(getDocument +
      // loadPdfViewerModule이 둘 다 끝나기 전) 이미 타이핑된 쿼리가 있으면
      // 지금 한 번 검색을 쏴준다 — 안 그러면 dispatchFind가 그동안 매번
      // eventBusRef.current===null로 조용히 no-op해서, 컨트롤러가 뜬 뒤에도
      // 아무것도 재전송되지 않아 사용자가 다음 키를 누르기 전까지 거짓
      // "0 / 0"에 갇힌다. 닫힘 경로가 이미 queryRef를 비우므로(아래 [isOpen]
      // 이펙트), 빈 쿼리면 그냥 아무 일도 안 한다.
      if (queryRef.current) dispatchFind({});
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
    currentPage,
    getCurrentPage,
    getPageMatches,
    matchCount,
    onNext,
    onPrev,
    onQueryChange,
    registerPageEl,
    scrollToPage,
  };
}
