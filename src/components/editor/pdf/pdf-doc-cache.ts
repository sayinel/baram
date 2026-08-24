// §276.4 공유 PDFDocumentProxy 캐시.
//
// 한 노트에 같은 PDF를 가리키는 영역 참조가 여러 개면(논문 하나에서 그림
// 세 개를 잘라 붙이는 것이 이 기능의 정상 사용 방식이다) 참조마다 문서를
// 새로 열게 된다 — 참조 N개마다 worker 파싱 N번이다. 경로별로 **로딩
// Promise**를 캐시해(문서가 아니라) 동시 N건도 로드 1회로 접는다.
//
// §291 이제 PdfPreview도 여기서 문서를 **임대한다**(acquirePdfDocument).
// 유지 상한(RETENTION_CAPS.pdf)을 넘겨 축출된 PDF 탭은 표면이 언마운트되므로
// 돌아올 때 문서를 다시 열어야 했다 — PDF 세 개를 오가면 매 세 번째 방문마다
// 워커 파싱을 처음부터 다시 했다. 캐시는 표면보다 오래 살아 그 파싱을 건너뛴다.
// 렌더된 페이지 캐시(operator list·디코드된 이미지)는 따라오지 않는다:
// PdfPageRetention이 표면의 언마운트에서 그것을 비운다(pdf-page-retention.ts의
// dispose 주석 — 그 파일이 이제 페이지를 비우는 **유일한** 경로다).
import { convertFileSrc } from "@tauri-apps/api/core";

import type { PDFDocumentProxy } from "pdfjs-dist";

// 워커 URL은 PdfPreview.tsx와 같은 경로/이유(legacy 빌드)로 가져온다 —
// ?url import는 문자열 하나로 컴파일되므로 pdfjs 코드를 번들에 끌고 오지
// 않는다. pdfjs 자체는 아래 defaultLoadDocument에서 동적 import한다.
import pdfWorkerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";

/** 동시에 살려두는 문서 수 상한. 초과하면 사용 중이 아닌 가장 오래된 것을 파기한다. */
export const MAX_CACHED_PDF_DOCUMENTS = 4;

/**
 * 임대 — `release()`를 부를 때까지 이 문서가 살아 있음을 보장한다.
 *
 * `withPdfDocument`는 호출이 끝나는 시점이 곧 놓는 시점인 경우를 위한 것이고, 이쪽은
 * **컴포넌트 수명**만큼 붙잡아야 하는 경우를 위한 것이다(PdfPreview). 두 형태가 같은
 * refcount를 쓰므로 LRU 축출은 어느 쪽이 붙잡고 있어도 그 문서를 고르지 않는다.
 */
export interface PdfDocumentLease {
  promise: Promise<PDFDocumentProxy>;
  release: () => void;
}

export type PdfDocumentLoader = (
  absPdfPath: string,
  /** 파일이 디스크에서 바뀐 뒤 웹뷰 캐시를 우회하기 위한 값. 0이면 붙이지 않는다. */
  version: number,
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
 * 문서를 임대한다. 반드시 `release()`로 놓을 것 — 놓지 않으면 LRU가 그 문서를 영원히
 * 축출하지 못한다.
 */
export function acquirePdfDocument(
  absPdfPath: string,
  version = 0,
): PdfDocumentLease {
  const key = cacheKey(absPdfPath, version);
  const entry = cache.get(key) ?? createEntry(key, absPdfPath, version);
  entry.lastUsed = ++clock;
  entry.refCount++;
  let released = false;
  return {
    promise: entry.promise,
    release: () => {
      // ‼️ 두 번 놓아도 refCount가 음수로 내려가지 않게 한다. 내려가면 **다른 임대가
      // 그리고 있는** 문서가 축출 후보로 뽑혀 "Worker was destroyed"로 그 렌더가 죽는다.
      // React가 effect cleanup을 두 번 부르지는 않지만 이것은 공개 계약이다.
      if (released) return;
      released = true;
      entry.refCount--;
      evictOverflow();
    },
  };
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
  const lease = acquirePdfDocument(absPdfPath);
  try {
    return await fn(await lease.promise);
  } finally {
    lease.release();
  }
}

const cache = new Map<string, CacheEntry>();

/** 단조 증가 카운터 — LRU 기준. Date.now()는 같은 틱에 두 번 열면 동률이 된다. */
let clock = 0;

let loadDocument: PdfDocumentLoader = defaultLoadDocument;

/**
 * 캐시 키. 버전이 0이면 경로 그대로다 — 그래야 버전을 모르는 호출부
 * (`withPdfDocument`, 영역 프리뷰)와 PdfPreview가 **같은 엔트리를 공유한다.**
 * 저장으로 버전이 올라가면 키가 달라져 새로 파싱하고, 낡은 엔트리는 아무도 붙잡지
 * 않으므로 LRU가 곧 가져간다.
 *
 * NUL로 잇는다 — 경로에 나타날 수 없는 유일한 바이트라 `a?v=1`이라는 이름의 파일이
 * 다른 파일의 버전 1과 같은 키가 되는 일이 없다.
 */
function cacheKey(absPdfPath: string, version: number): string {
  return version > 0 ? `${absPdfPath}\u0000${String(version)}` : absPdfPath;
}

function createEntry(
  key: string,
  absPdfPath: string,
  version: number,
): CacheEntry {
  const entry: CacheEntry = {
    lastUsed: ++clock,
    promise: loadDocument(absPdfPath, version),
    refCount: 0,
  };
  // 실패한 Promise를 캐시에 남기면 그 PDF는 세션이 끝날 때까지 영구히
  // 실패한다 — 일시적 실패(파일이 아직 동기화 중, 잠깐의 권한 오류)가
  // 영구 장애가 된다. 실패 시 즉시 캐시에서 뺀다.
  //
  // 아직 그 자리에 이 엔트리가 있는지 먼저 확인한다: 이미 축출됐거나 다른
  // 엔트리로 교체된 뒤라면 남의 엔트리를 지우게 된다.
  entry.promise.catch(() => {
    if (cache.get(key) === entry) cache.delete(key);
  });
  cache.set(key, entry);
  return entry;
}

async function defaultLoadDocument(
  absPdfPath: string,
  version: number,
): Promise<PDFDocumentProxy> {
  // ‼️ 동적 import: 정적으로 가져오면 pdfjs 전체가 에디터 번들에 들어가
  // PDF를 한 번도 열지 않는 사용자까지 비용을 낸다.
  //
  // ‼️ **legacy 빌드다, modern이 아니다.** modern 빌드는 최신 엔진 API를 전제하는데
  // (예: Map.prototype.getOrInsertComputed) 현재 WKWebView에는 없어 page.render()가
  // 런타임에 죽는다. legacy는 그것들의 core-js 폴리필을 함께 실어 우리
  // minimumSystemVersion(macOS 13)이 함의하는 웹뷰 범위를 지원한다. (이 근거는 예전에
  // PdfPreview.tsx의 정적 import 위에 있었다 — 그 import가 이 모듈로 옮겨 오면서 함께
  // 왔다. PdfPage.tsx의 TextLayer import도 같은 이유로 legacy 경로다.)
  const { getDocument, GlobalWorkerOptions } =
    await import("pdfjs-dist/legacy/build/pdf.mjs");
  GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  // 버전을 쿼리로 붙여 웹뷰의 HTTP 캐시를 우회한다 — 디스크에서 바뀐 파일을 같은 URL로
  // 요청하면 예전 바이트가 돌아올 수 있다.
  const base = convertFileSrc(absPdfPath);
  const url = version > 0 ? `${base}?v=${String(version)}` : base;
  return getDocument({ url }).promise;
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
    // 문서 메모리를 실제로 해제하는 것은 loadingTask.destroy()다.
    //
    // §291 이후로 **이곳이 문서를 파기하는 유일한 지점이다** — PdfPreview는 임대를
    // 놓기만 하고 파기하지 않는다.
    void victim?.promise
      .then((doc) => doc.loadingTask.destroy())
      .catch(() => {
        // 이미 파기됐거나 로드가 실패한 문서 — 축출이 목적이므로 무시한다.
      });
  }
}
