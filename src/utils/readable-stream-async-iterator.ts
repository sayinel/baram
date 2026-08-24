// §272.5 WKWebView 폴리필 — `ReadableStream`의 비동기 이터레이션.
//
// WHY: WKWebView(Tauri의 macOS 웹뷰)의 ReadableStream에는
// `Symbol.asyncIterator`가 없다. 그래서 `for await (const x of stream)`이
// 스트림을 읽지 못하고 즉시 던진다:
//
//   TypeError: undefined is not a function (near '...value of readableStream...')
//       getTextContent — pdf.mjs:22166
//
// 이게 실제로 무엇을 망가뜨렸나: pdfjs가 같은 스트림을 두 가지 방식으로
// 소비한다.
//   • TextLayer(pdf.mjs:21234)는 `textContentSource.getReader()` — 잘 돈다.
//     그래서 PDF 텍스트 선택과 하이라이트는 멀쩡히 동작했다.
//   • PDFPageProxy.getTextContent(pdf.mjs:22166)는 `for await` — 던진다.
//     찾기(우리 추출과 PDFFindController의 #extractText 둘 다 이걸 쓴다)만
//     32페이지 전부 실패해 조용히 "0 / 0"이 됐다.
//
// 그래서 우리 호출부만 getReader()로 바꾸는 것으로는 부족하다 — 라이브러리
// **내부**의 #extractText가 여전히 getTextContent를 부른다. 누락된 표준
// 기능 자체를 채워야 양쪽이 함께 고쳐진다.
//
// core-js(legacy 빌드가 들고 오는)는 언어 기능만 폴리필하고 Web Streams 같은
// 플랫폼 API는 다루지 않으므로 legacy 빌드를 써도 이 구멍은 남는다.
//
// 구현은 WHATWG Streams의 `ReadableStream.prototype.values` 정의를 따른다:
// reader를 하나 잡고, 소진되거나 던지면 releaseLock하고, 조기 종료(break /
// throw)에는 cancel한다.

/** 폴리필이 붙일 최소 표면 — 테스트가 진짜 ReadableStream 없이도 검증할 수 있게 한다. */
export interface ReadableStreamLike<T> {
  getReader(): {
    cancel(reason?: unknown): Promise<void>;
    read(): Promise<{ done: boolean; value?: T }>;
    releaseLock(): void;
  };
}

interface AsyncIterableOptions {
  preventCancel?: boolean;
}

/**
 * `proto`에 `Symbol.asyncIterator`(와 `values`)가 없으면 추가한다. 이미 있으면
 * 아무것도 하지 않는다 — 최신 엔진의 네이티브 구현을 우리 것으로 덮어쓰면
 * 스펙과 미묘하게 다른 동작을 심게 된다.
 *
 * @returns 실제로 폴리필을 설치했으면 true.
 */
export function installReadableStreamAsyncIterator(
  proto: null | object | undefined,
): boolean {
  if (!proto) return false;
  if (Symbol.asyncIterator in proto) return false;

  function values<T>(
    this: ReadableStreamLike<T>,
    { preventCancel = false }: AsyncIterableOptions = {},
  ): AsyncIterableIterator<T> {
    const reader = this.getReader();
    return {
      async next(): Promise<IteratorResult<T>> {
        try {
          const { done, value } = await reader.read();
          if (done) {
            reader.releaseLock();
            return { done: true, value: undefined };
          }
          return { done: false, value: value as T };
        } catch (err) {
          // 읽기가 실패하면 락을 쥔 채로 두지 않는다 — 그 스트림을 다시
          // 읽으려는 다음 시도가 "locked to a reader"로 또 죽는다.
          reader.releaseLock();
          throw err;
        }
      },
      // `break`/`return`/`throw`로 루프를 빠져나갈 때 호출된다. preventCancel이
      // 아니면 스펙대로 소스를 취소한다 — 안 하면 pdfjs의 워커 스트림처럼
      // 백프레셔를 쓰는 소스가 영영 대기한다.
      async return(value?: unknown): Promise<IteratorResult<T>> {
        if (!preventCancel) {
          const cancelled = reader.cancel(value);
          reader.releaseLock();
          await cancelled;
        } else {
          reader.releaseLock();
        }
        return { done: true, value: undefined };
      },
      [Symbol.asyncIterator](): AsyncIterableIterator<T> {
        return this;
      },
    };
  }

  Object.defineProperty(proto, Symbol.asyncIterator, {
    configurable: true,
    value: values,
    writable: true,
  });
  if (!("values" in proto)) {
    Object.defineProperty(proto, "values", {
      configurable: true,
      value: values,
      writable: true,
    });
  }
  return true;
}

/** 앱 시작 시 한 번 — main.tsx가 가장 먼저 부른다(pdfjs가 로드되기 전이어야 한다). */
export function installStreamPolyfills(): boolean {
  return installReadableStreamAsyncIterator(
    typeof ReadableStream === "undefined" ? null : ReadableStream.prototype,
  );
}
