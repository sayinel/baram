// §276.4 영역 프리뷰용 PDFDocumentProxy 캐시.
//
// 한 노트에 같은 PDF를 가리키는 영역 참조가 여러 개면(논문 하나에서 그림
// 세 개를 잘라 붙이는 것이 이 기능의 정상 사용 방식이다) 참조마다 문서를
// 새로 열게 된다 — 참조 N개마다 worker 파싱 N번이다. 경로별로 **로딩
// Promise**를 캐시해(문서가 아니라) 동시 N건도 로드 1회로 접는다.
import { convertFileSrc } from "@tauri-apps/api/core";

import type { PDFDocumentProxy } from "pdfjs-dist";

// 워커 URL은 PdfPreview.tsx와 같은 경로/이유(legacy 빌드)로 가져온다 —
// ?url import는 문자열 하나로 컴파일되므로 pdfjs 코드를 번들에 끌고 오지
// 않는다. pdfjs 자체는 아래 defaultLoadDocument에서 동적 import한다.
import pdfWorkerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";

/** 동시에 살려두는 문서 수 상한. 초과하면 사용 중이 아닌 가장 오래된 것을 파기한다. */
export const MAX_CACHED_PDF_DOCUMENTS = 4;

export type PdfDocumentLoader = (
  absPdfPath: string,
) => Promise<PDFDocumentProxy>;

interface CacheEntry {
  lastUsed: number;
  promise: Promise<PDFDocumentProxy>;
  refCount: number;
}

/** 테스트 전용 — 캐시를 비운다(파기는 하지 않는다, 목 문서에는 의미가 없다). */
export function __resetPdfDocumentCacheForTest(): void {
  cache.clear();
  clock = 0;
}

/** 테스트 전용 — 로더를 갈아끼운다. null이면 실제 pdfjs 로더로 되돌린다. */
export function __setPdfDocumentLoaderForTest(
  loader: null | PdfDocumentLoader,
): void {
  loadDocument = loader ?? defaultLoadDocument;
}

/**
 * `fn`이 실행되는 동안 문서가 살아 있음을 보장한 채 캐시된 문서를 빌려준다.
 *
 * refcount를 쓰는 이유: LRU 축출이 **다른 참조가 렌더 중인** 문서를
 * destroy()하면 그 렌더는 "Worker was destroyed"로 죽는다. 페이지 5개가 동시에
 * 프리뷰를 그리는 노트에서 상한 4를 넘기면 정확히 그 일이 일어난다.
 * 축출은 refcount 0인 엔트리만 고르고, 고를 수 있는 것이 없으면 상한을 넘긴
 * 채로 둔다 — 잠깐 메모리를 더 쓰는 편이 렌더를 죽이는 것보다 낫다.
 */
export async function withPdfDocument<T>(
  absPdfPath: string,
  fn: (doc: PDFDocumentProxy) => Promise<T>,
): Promise<T> {
  const entry = cache.get(absPdfPath) ?? createEntry(absPdfPath);
  entry.lastUsed = ++clock;
  entry.refCount++;
  try {
    return await fn(await entry.promise);
  } finally {
    entry.refCount--;
    evictOverflow();
  }
}

const cache = new Map<string, CacheEntry>();

/** 단조 증가 카운터 — LRU 기준. Date.now()는 같은 틱에 두 번 열면 동률이 된다. */
let clock = 0;

let loadDocument: PdfDocumentLoader = defaultLoadDocument;

function createEntry(absPdfPath: string): CacheEntry {
  const entry: CacheEntry = {
    lastUsed: ++clock,
    promise: loadDocument(absPdfPath),
    refCount: 0,
  };
  // 실패한 Promise를 캐시에 남기면 그 PDF는 세션이 끝날 때까지 영구히
  // 실패한다 — 일시적 실패(파일이 아직 동기화 중, 잠깐의 권한 오류)가
  // 영구 장애가 된다. 실패 시 즉시 캐시에서 뺀다.
  //
  // 아직 그 자리에 이 엔트리가 있는지 먼저 확인한다: 이미 축출됐거나 다른
  // 엔트리로 교체된 뒤라면 남의 엔트리를 지우게 된다.
  entry.promise.catch(() => {
    if (cache.get(absPdfPath) === entry) cache.delete(absPdfPath);
  });
  cache.set(absPdfPath, entry);
  return entry;
}

async function defaultLoadDocument(
  absPdfPath: string,
): Promise<PDFDocumentProxy> {
  // ‼️ 동적 import: 정적으로 가져오면 pdfjs 전체가 에디터 번들에 들어가
  // PDF를 한 번도 열지 않는 사용자까지 비용을 낸다. legacy 빌드인 이유는
  // PdfPreview.tsx:18-22 참조.
  const { getDocument, GlobalWorkerOptions } =
    await import("pdfjs-dist/legacy/build/pdf.mjs");
  GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  return getDocument({ url: convertFileSrc(absPdfPath) }).promise;
}

function evictOverflow(): void {
  while (cache.size > MAX_CACHED_PDF_DOCUMENTS) {
    let victimKey: null | string = null;
    let victimTick = Infinity;
    for (const [key, entry] of cache) {
      if (entry.refCount > 0) continue;
      if (entry.lastUsed < victimTick) {
        victimTick = entry.lastUsed;
        victimKey = key;
      }
    }
    // 전부 사용 중 — 상한을 넘긴 채 둔다. 여기서 던지면 정상 렌더가 죽는다.
    if (victimKey === null) return;

    const victim = cache.get(victimKey);
    cache.delete(victimKey);
    // 파기는 캐시에서 뺀 **뒤에** 부른다 — 실패하더라도 엔트리는 이미
    // 사라졌으므로 상한이 영구히 초과된 채 남지 않는다.
    //
    // ‼️ PDFDocumentProxy에는 destroy()가 없다(pdfjs 6.x: cleanup()과
    // loadingTask getter뿐이다 — types/src/display/api.d.ts:839~). 워커와
    // 문서 메모리를 실제로 해제하는 것은 loadingTask.destroy()이고,
    // PdfPreview.tsx:118-122도 같은 이유로 로딩 태스크를 파기한다.
    void victim?.promise
      .then((doc) => doc.loadingTask.destroy())
      .catch(() => {
        // 이미 파기됐거나 로드가 실패한 문서 — 축출이 목적이므로 무시한다.
      });
  }
}
