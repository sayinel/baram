import type { PDFPageProxy } from "pdfjs-dist";

// §272.5 찾기 경로의 유일한 **비-모킹** 테스트.
//
// ‼️ 이 파일에는 vi.mock이 없다. 그것이 존재 이유다. 이 디렉터리의 다른 찾기
// 테스트는 전부 PDFFindController를 FakeFindController로 바꾸고 문서도
// `{ numPages: 1 }` 껍데기를 쓴다 — 그래서 진짜 컨트롤러와 우리 배선의 통합이
// 한 번도 실행되지 않았고, 실앱에서 찾기가 **완전히 죽은 채로**(WKWebView의
// ReadableStream이 async-iterable이 아니라 getTextContent가 던졌다) 스위트
// 4,988개가 초록이었다.
//
// 한계는 정직하게: jsdom의 ReadableStream은 이미 async-iterable이라 이 테스트가
// 그 WKWebView 결함 자체를 재현하지는 못한다. 폴리필의 동작은 주입된 가짜
// 스트림으로 따로 고정한다(utils/__tests__/readable-stream-async-iterator).
// 여기서 막는 것은 그 다음 층 — 배선·오프셋 변환·카운트 경로가 진짜 pdfjs
// 위에서 실제로 도는가.
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { usePdfFind } from "../use-pdf-find";
import { buildTinyPdf, TINY_PDF_LINES } from "./fixtures/tiny-pdf";

async function openTinyPdf() {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await getDocument({ data: buildTinyPdf() }).promise;
  const pages: PDFPageProxy[] = [await doc.getPage(1)];
  return { doc, pages };
}

describe("usePdfFind against the real PDFFindController and a real document", () => {
  it("extracts text through the real pdfjs page API", async () => {
    const { pages } = await openTinyPdf();
    const tc = await pages[0].getTextContent({ disableNormalization: true });
    // getTextContent는 WKWebView에서 던지던 바로 그 호출이다.
    expect(tc.items.map((i) => (i as { str: string }).str)).toEqual([
      ...TINY_PDF_LINES,
    ]);
  }, 20000);

  it("finds every occurrence and reports a 1-based current match", async () => {
    const { doc, pages } = await openTinyPdf();
    const { result } = renderHook(() =>
      usePdfFind({
        doc,
        getScrollElement: () => document.body,
        isOpen: true,
        pages,
      }),
    );

    // "alpha"는 두 줄에 각각 한 번씩 나온다(TINY_PDF_LINES 참조).
    await waitFor(() => expect(result.current.matchCount).toBe(0), {
      timeout: 10000,
    });
    result.current.onQueryChange("alpha", false);

    await waitFor(() => expect(result.current.matchCount).toBe(2), {
      timeout: 10000,
    });
    // ‼️ currentIdx까지 단정한다. 정확한 current를 싣고 오는 것은 마지막에
    // 도착하는 updatefindmatchescount 하나뿐인데, 그 핸들러가 total만 읽던
    // 시절에는 여기가 -1로 남아 찾기 바가 "0 / 2"를 보여줬다.
    expect(result.current.currentIdx).toBe(0);
  }, 30000);

  it("converts the controller's offsets into text-layer coordinates", async () => {
    const { doc, pages } = await openTinyPdf();
    const { result } = renderHook(() =>
      usePdfFind({
        doc,
        getScrollElement: () => document.body,
        isOpen: true,
        pages,
      }),
    );
    result.current.onQueryChange("alpha", false);
    await waitFor(() => expect(result.current.matchCount).toBe(2), {
      timeout: 10000,
    });

    const matches = result.current.getPageMatches(1);
    expect(matches?.positions).toHaveLength(2);
    // 각 줄에서 "alpha"가 실제로 시작하는 자리 — 두 줄이 서로 다른 text item
    // (divIdx 0과 1)이고, 오프셋은 TINY_PDF_LINES에서 직접 계산된다.
    expect(matches?.positions[0].begin).toEqual({
      divIdx: 0,
      offset: TINY_PDF_LINES[0].indexOf("alpha"),
    });
    expect(matches?.positions[1].begin).toEqual({
      divIdx: 1,
      offset: TINY_PDF_LINES[1].indexOf("alpha"),
    });
  }, 30000);

  it("reports zero for a query the document does not contain", async () => {
    const { doc, pages } = await openTinyPdf();
    const { result } = renderHook(() =>
      usePdfFind({
        doc,
        getScrollElement: () => document.body,
        isOpen: true,
        pages,
      }),
    );
    result.current.onQueryChange("thisisnotinthedocument", false);
    // 없다는 것을 확인하려면 "아직 안 왔다"와 구분해야 한다 — 있는 단어가
    // 2를 만드는 데 걸리는 시간보다 넉넉히 기다린 뒤에 0을 단정한다.
    await new Promise((r) => setTimeout(r, 2000));
    expect(result.current.matchCount).toBe(0);
    expect(result.current.currentIdx).toBe(-1);
  }, 30000);
});
