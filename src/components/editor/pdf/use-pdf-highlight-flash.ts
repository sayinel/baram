// §275.6 Consumes the pending highlight id set by handleBlockRefNavigate
// (use-navigation.ts) once its target PDF's own sidecar has loaded and its
// pages are ready to scroll to — jumps to the highlight's page and flashes it
// briefly. Split out of use-pdf-highlights.ts (already near the file-size
// budget) rather than grown in place; PdfPreview composes the two exactly
// like it already composes usePdfFind + usePdfHighlights.
import { useEffect, useState } from "react";

import type { Sidecar } from "./pdf-highlight-sidecar";

import { useLinkStore } from "../../../stores/editor/link";

/** How long the flash affordance stays visible — matches the
 * `pdf-hl-flash` animation duration in pdf.css. */
const FLASH_DURATION_MS = 1600;

export function usePdfHighlightFlash({
  pagesReady,
  scrollToPage,
  sidecar,
}: {
  /** True once PdfPreview has a base scale and at least one page proxy — the
   * point at which every page's wrapper element is registered (PdfPreview's
   * per-page map), so `scrollToPage` can actually find its target. Reading
   * the pending id before this would silently no-op the scroll and still
   * consume the id. */
  pagesReady: boolean;
  /** The SAME function usePdfFind hands the toolbar and createLinkService —
   * see its own doc comment for why a second page registry must not exist. */
  scrollToPage: (n: number) => void;
  sidecar: null | Sidecar;
}): { flashHighlightId: null | string } {
  const pendingHighlightId = useLinkStore((s) => s.pendingPdfHighlightId);
  // ‼️ §282.2 상태가 id가 아니라 `{id, token}`인 이유. 레일의 하이라이트
  // 목록이 생기면서 **같은 항목을 두 번 클릭**하는 경로가 열렸다(§275.6의
  // 문서 간 점프는 매번 새로 마운트돼 닿지 않았다). id만 들고 있으면 두 번째
  // 클릭이 같은 값을 세팅하는 것이라 React가 리렌더를 생략하고, 아래 타이머
  // effect도 다시 돌지 않아 **처음 클릭의 1600ms 마감이 그대로 남는다** —
  // 1.4초 뒤에 다시 누르면 200ms만 반짝이고 꺼져 "클릭이 반만 먹었다"로 읽힌다.
  //
  // `setState(null)` 후 `setState(id)`로 끊는 것은 **듣지 않는다**(그렇게 먼저
  // 고쳤다가 아래 테스트에 걸렸다): 같은 effect 안의 두 호출은 배치되고 React는
  // **최종값**을 현재값과 비교하므로 결국 같은 값이라 그대로 bailout된다.
  // 매번 새 객체를 만드는 token이 그 비교를 확실히 통과시킨다.
  const [flash, setFlash] = useState<null | { id: string; token: number }>(
    null,
  );

  useEffect(() => {
    if (!pendingHighlightId || !pagesReady || !sidecar) return;
    const hit = sidecar.highlights.find((h) => h.id === pendingHighlightId);
    // Consumed either way — leaving it set would let a later, unrelated
    // sidecar reload (e.g. after picking a color) replay a stale jump.
    useLinkStore.getState().setPendingPdfHighlightId(null);
    // §277.2 삭제 여부로 거르지 않는다 — 삭제된 하이라이트도 자리로 데려가
    // 점선으로 짚어 준다(use-pdf-highlights.ts의 getPageHighlights). 여기서
    // 걸러 버리면 참조 칩은 원문/크롭을 보여주는데 클릭은 아무 일도 안 하는,
    // 설명할 수 없는 상태가 된다.
    if (!hit) return; // 완전 삭제됐거나 다른 PDF의 id — no-op
    scrollToPage(hit.page);
    setFlash((prev) => ({ id: hit.id, token: (prev?.token ?? 0) + 1 }));
  }, [pagesReady, pendingHighlightId, scrollToPage, sidecar]);

  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(null), FLASH_DURATION_MS);
    return () => clearTimeout(timer);
    // flash는 세팅될 때마다 **새 객체**라, 같은 id로 다시 들어와도 이 effect가
    // 반드시 다시 돌아 마감이 처음부터 흐른다.
  }, [flash]);

  return { flashHighlightId: flash?.id ?? null };
}
