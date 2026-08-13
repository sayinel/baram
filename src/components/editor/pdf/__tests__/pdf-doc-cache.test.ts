import type { PdfDocumentLoader } from "../pdf-doc-cache";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { Mock } from "vitest";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __resetPdfDocumentCacheForTest,
  __setPdfDocumentLoaderForTest,
  MAX_CACHED_PDF_DOCUMENTS,
  withPdfDocument,
} from "../pdf-doc-cache";

// 파기만 관찰하면 되므로 진짜 PDFDocumentProxy는 필요 없다. 파기 지점이
// loadingTask.destroy()인 것은 우연이 아니다 — PDFDocumentProxy에는
// destroy()가 아예 없고(pdfjs 6.x), 워커/문서 메모리를 해제하는 것은
// 로딩 태스크 쪽이다. 이 목이 그 모양을 그대로 흉내 내야 구현이 존재하지
// 않는 메서드를 부르는 것을 잡을 수 있다.
interface FakeDoc {
  loadingTask: { destroy: Mock<() => Promise<void>> };
}

function fakeDoc(): FakeDoc {
  return { loadingTask: { destroy: vi.fn(async () => {}) } };
}

/** destroy()는 축출 시점의 마이크로태스크에서 일어난다 — 단정 전에 흘려준다. */
async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/** 끝나지 않는 fn — 그 문서를 "사용 중"(refcount>0)으로 붙잡아 둔다. */
function hold(path: string): void {
  void withPdfDocument(path, () => new Promise<void>(() => {})).catch(() => {});
}

describe("withPdfDocument", () => {
  let docs: Map<string, FakeDoc>;
  let loader: Mock<PdfDocumentLoader>;

  beforeEach(() => {
    __resetPdfDocumentCacheForTest();
    docs = new Map();
    loader = vi.fn(async (path: string) => {
      const doc = fakeDoc();
      docs.set(path, doc);
      return doc as unknown as PDFDocumentProxy;
    });
    __setPdfDocumentLoaderForTest(loader);
  });

  afterEach(() => {
    __setPdfDocumentLoaderForTest(null);
    __resetPdfDocumentCacheForTest();
  });

  it("loads a document once for concurrent requests to the same path", async () => {
    let release: (doc: PDFDocumentProxy) => void = () => {};
    loader.mockReturnValue(
      new Promise<PDFDocumentProxy>((resolve) => {
        release = resolve;
      }),
    );

    const seen: PDFDocumentProxy[] = [];
    const both = Promise.all([
      withPdfDocument("/v/a.pdf", async (doc) => void seen.push(doc)),
      withPdfDocument("/v/a.pdf", async (doc) => void seen.push(doc)),
    ]);

    // 문서가 아니라 **로딩 Promise**를 캐시하므로, 첫 로드가 아직 안 끝난
    // 시점에 온 두 번째 요청도 로더를 다시 부르지 않는다.
    expect(loader).toHaveBeenCalledTimes(1);

    const doc = fakeDoc() as unknown as PDFDocumentProxy;
    release(doc);
    await both;
    expect(seen).toEqual([doc, doc]);
  });

  it("destroys the least recently used document once the cap is exceeded", async () => {
    const paths = ["/v/a.pdf", "/v/b.pdf", "/v/c.pdf", "/v/d.pdf", "/v/e.pdf"];
    expect(paths).toHaveLength(MAX_CACHED_PDF_DOCUMENTS + 1);
    for (const path of paths) await withPdfDocument(path, async () => {});
    await flush();

    expect(docs.get("/v/a.pdf")?.loadingTask.destroy).toHaveBeenCalledTimes(1);
    for (const path of paths.slice(1)) {
      expect(docs.get(path)?.loadingTask.destroy).not.toHaveBeenCalled();
    }
  });

  it("re-loads an evicted document instead of handing back the destroyed one", async () => {
    for (const path of ["/v/a.pdf", "/v/b.pdf", "/v/c.pdf", "/v/d.pdf"]) {
      await withPdfDocument(path, async () => {});
    }
    loader.mockClear();

    await withPdfDocument("/v/e.pdf", async () => {}); // a를 밀어낸다
    await flush();
    await withPdfDocument("/v/a.pdf", async () => {});

    expect(loader.mock.calls.map((call) => call[0])).toEqual([
      "/v/e.pdf",
      "/v/a.pdf",
    ]);
  });

  it("never destroys a document while a caller still holds it", async () => {
    // held는 가장 오래됐지만 fn이 끝나지 않아 refcount가 1이다. refcount
    // 검사가 빠지면 "가장 오래된 것"이라는 이유만으로 파기되고, 그 문서로
    // 아직 그리는 중인 렌더가 "Worker was destroyed"로 죽는다.
    hold("/v/held.pdf");
    await flush();

    for (const path of ["/v/b.pdf", "/v/c.pdf", "/v/d.pdf", "/v/e.pdf"]) {
      await withPdfDocument(path, async () => {});
    }
    await flush();

    expect(docs.get("/v/held.pdf")?.loadingTask.destroy).not.toHaveBeenCalled();
    // 대신 사용 중이 아닌 것 중 가장 오래된 b가 파기된다.
    expect(docs.get("/v/b.pdf")?.loadingTask.destroy).toHaveBeenCalledTimes(1);
  });

  it("gives up on the cap rather than destroying any busy document", async () => {
    const busy = ["/v/a.pdf", "/v/b.pdf", "/v/c.pdf", "/v/d.pdf", "/v/e.pdf"];
    for (const path of busy) hold(path);
    await flush();

    // 6번째는 끝나므로 축출이 돈다. 파기 가능한 후보는 자기 자신뿐이고, 그
    // 뒤로는 후보가 없다 — 상한을 못 맞춰도 멈춰야 한다. 안 멈추면 이 await는
    // 영원히 돌아오지 않는다(무한 루프).
    await withPdfDocument("/v/f.pdf", async () => {});
    await flush();

    for (const path of busy) {
      expect(docs.get(path)?.loadingTask.destroy).not.toHaveBeenCalled();
    }
    expect(docs.get("/v/f.pdf")?.loadingTask.destroy).toHaveBeenCalledTimes(1);
  });

  it("drops a failed load from the cache so the next attempt retries", async () => {
    loader.mockRejectedValueOnce(new Error("boom"));

    await expect(
      withPdfDocument("/v/a.pdf", async () => "unreachable"),
    ).rejects.toThrow("boom");

    // 실패한 Promise를 캐시에 남기면 이 PDF는 세션이 끝날 때까지 영구히
    // 실패한다 — 두 번째 호출은 로더를 다시 불러야 한다.
    await expect(withPdfDocument("/v/a.pdf", async () => "ok")).resolves.toBe(
      "ok",
    );
    expect(loader).toHaveBeenCalledTimes(2);
  });
});
