import type { ReadableStreamLike } from "../readable-stream-async-iterator";

// §272.5 The environment this polyfill exists for cannot be reproduced here:
// jsdom/Node's ReadableStream IS async-iterable, so installing against the real
// prototype is always a no-op and would assert nothing. The whole point is to
// drive an INJECTED stream class that lacks Symbol.asyncIterator — the shape
// WKWebView actually ships — so the polyfill's own behaviour is what is under
// test, not the host engine's.
import { describe, expect, it, vi } from "vitest";

import { installReadableStreamAsyncIterator } from "../readable-stream-async-iterator";

/** A ReadableStream as WKWebView presents it: readable, but NOT async-iterable. */
class FakeStream<T> implements ReadableStreamLike<T> {
  cancelled: null | { reason: unknown } = null;
  locks = 0;
  #chunks: T[];
  #throwAt: null | number;

  constructor(chunks: T[], throwAt: null | number = null) {
    this.#chunks = [...chunks];
    this.#throwAt = throwAt;
  }

  getReader() {
    this.locks++;
    let i = 0;
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const stream = this;
    return {
      cancel: (reason?: unknown) => {
        stream.cancelled = { reason };
        return Promise.resolve();
      },
      read: () => {
        if (stream.#throwAt !== null && i === stream.#throwAt) {
          return Promise.reject(new Error("read blew up"));
        }
        if (i >= stream.#chunks.length) {
          return Promise.resolve({ done: true, value: undefined });
        }
        return Promise.resolve({ done: false, value: stream.#chunks[i++] });
      },
      releaseLock: () => {
        stream.locks--;
      },
    };
  }
}

function installed<T>(chunks: T[], throwAt: null | number = null) {
  class S extends FakeStream<T> {}
  const did = installReadableStreamAsyncIterator(S.prototype);
  return { did, stream: new S(chunks, throwAt) as AsyncIterable<T> & S };
}

describe("installReadableStreamAsyncIterator", () => {
  it("reports that it installed on a prototype without Symbol.asyncIterator", () => {
    const { did } = installed([1]);
    expect(did).toBe(true);
  });

  it("makes `for await` read every chunk in order", async () => {
    const { stream } = installed(["a", "b", "c"]);
    const seen: string[] = [];
    for await (const chunk of stream) seen.push(chunk);
    expect(seen).toEqual(["a", "b", "c"]);
  });

  it("releases the reader lock when the stream is exhausted", async () => {
    const { stream } = installed([1, 2]);
    for await (const _ of stream) void _;
    expect(stream.locks).toBe(0);
  });

  it("releases the lock AND cancels the source when the loop breaks early", async () => {
    const { stream } = installed([1, 2, 3, 4]);
    for await (const chunk of stream) {
      if (chunk === 2) break;
    }
    expect(stream.locks).toBe(0);
    expect(stream.cancelled).not.toBeNull();
  });

  it("releases the lock when a read rejects, so the stream can be retried", async () => {
    const { stream } = installed([1, 2, 3], 1);
    await expect(async () => {
      for await (const _ of stream) void _;
    }).rejects.toThrow("read blew up");
    // A held lock is what turns one failed read into a permanently unreadable
    // stream — every later attempt dies with "locked to a reader".
    expect(stream.locks).toBe(0);
  });

  it("does NOT overwrite a native implementation", () => {
    const native = vi.fn();
    // On the PROTOTYPE, which is where a real engine puts it — a class field
    // would land on the instance and the guard would (correctly) not see it.
    class Native {}
    Object.defineProperty(Native.prototype, Symbol.asyncIterator, {
      configurable: true,
      value: native,
      writable: true,
    });
    expect(installReadableStreamAsyncIterator(Native.prototype)).toBe(false);
    expect(
      (Native.prototype as unknown as Record<symbol, unknown>)[
        Symbol.asyncIterator
      ],
    ).toBe(native);
  });

  it("is a no-op for a missing prototype rather than throwing", () => {
    expect(installReadableStreamAsyncIterator(null)).toBe(false);
    expect(installReadableStreamAsyncIterator(undefined)).toBe(false);
  });

  it("also exposes `values()`, which is how the spec names the same iterator", async () => {
    const { stream } = installed([7, 8]);
    const values = (
      stream as unknown as { values: () => AsyncIterableIterator<number> }
    ).values();
    const seen: number[] = [];
    for await (const chunk of values) seen.push(chunk);
    expect(seen).toEqual([7, 8]);
  });
});
