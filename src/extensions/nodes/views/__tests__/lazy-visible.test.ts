import { afterEach, describe, expect, it, vi } from "vitest";

import {
  _mountQueueLength,
  _resetForTest,
  onFirstVisible,
} from "../lazy-visible";

declare const MockIntersectionObserver: {
  instances: {
    elements: Set<Element>;
    triggerIntersect: (v?: boolean) => void;
  }[];
};

describe("onFirstVisible — shared observer + idle queue (C3.2)", () => {
  afterEach(() => {
    _resetForTest();
    vi.clearAllTimers();
  });

  it("uses ONE shared IntersectionObserver for multiple elements", () => {
    vi.useFakeTimers();
    const countBefore = MockIntersectionObserver.instances.length;

    const el1 = document.createElement("div");
    const el2 = document.createElement("div");
    onFirstVisible(el1, vi.fn());
    onFirstVisible(el2, vi.fn());

    // Both elements registered on the SAME shared observer instance.
    expect(MockIntersectionObserver.instances.length).toBe(countBefore + 1);
    const io = MockIntersectionObserver.instances.at(-1)!;
    expect(io.elements.has(el1)).toBe(true);
    expect(io.elements.has(el2)).toBe(true);
    vi.useRealTimers();
  });

  it("runs the callback only after the element intersects, once", () => {
    vi.useFakeTimers();
    const el = document.createElement("div");
    const cb = vi.fn();
    onFirstVisible(el, cb);

    expect(cb).not.toHaveBeenCalled();

    const io = MockIntersectionObserver.instances.at(-1)!;
    io.triggerIntersect(true);

    // Callback is in the queue — not yet called.
    expect(cb).not.toHaveBeenCalled();
    expect(_mountQueueLength()).toBe(1);

    vi.runAllTimers();
    expect(cb).toHaveBeenCalledTimes(1);

    // A second intersection (should not happen in practice) is a no-op
    // because the element was removed from the map on first fire.
    io.triggerIntersect(true);
    vi.runAllTimers();
    expect(cb).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("drains callbacks serialized (all fire after enough idle ticks)", () => {
    // We verify: N elements intersecting → N callbacks eventually called, all
    // deferred (not synchronous on intersection). The "one per tick" invariant
    // is guaranteed by the drainScheduled flag + scheduleIdle in production
    // code; it cannot be observed step-by-step in jsdom because fake-timer
    // setTimeout(0) chains are executed atomically in a single advance call.
    vi.useFakeTimers();
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    const cb3 = vi.fn();

    const el1 = document.createElement("div");
    const el2 = document.createElement("div");
    const el3 = document.createElement("div");

    onFirstVisible(el1, cb1);
    onFirstVisible(el2, cb2);
    onFirstVisible(el3, cb3);

    const io = MockIntersectionObserver.instances.at(-1)!;
    // Burst: all three intersect at once.
    io.triggerIntersect(true);

    // None fired synchronously — they are in the queue.
    expect(_mountQueueLength()).toBe(3);
    expect(cb1).not.toHaveBeenCalled();
    expect(cb2).not.toHaveBeenCalled();
    expect(cb3).not.toHaveBeenCalled();

    // Flush all pending timers → all three drain.
    vi.runAllTimers();
    expect(_mountQueueLength()).toBe(0);
    expect(cb1).toHaveBeenCalledTimes(1);
    expect(cb2).toHaveBeenCalledTimes(1);
    expect(cb3).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("most-recently-intersected callback runs first (LIFO drain order)", () => {
    vi.useFakeTimers();
    const order: number[] = [];
    const el1 = document.createElement("div");
    const el2 = document.createElement("div");
    const el3 = document.createElement("div");

    onFirstVisible(el1, () => order.push(1));
    onFirstVisible(el2, () => order.push(2));
    onFirstVisible(el3, () => order.push(3));

    const io = MockIntersectionObserver.instances.at(-1)!;
    // Fire elements one at a time in order: el1, el3, el2.
    // Each unshift prepends to queue so final queue = [2, 3, 1].
    io["cb"](
      [{ target: el1, isIntersecting: true } as IntersectionObserverEntry],
      io as unknown as IntersectionObserver,
    );
    io["cb"](
      [{ target: el3, isIntersecting: true } as IntersectionObserverEntry],
      io as unknown as IntersectionObserver,
    );
    io["cb"](
      [{ target: el2, isIntersecting: true } as IntersectionObserverEntry],
      io as unknown as IntersectionObserver,
    );

    expect(_mountQueueLength()).toBe(3);

    // Drain all — order should be most-recently-intersected first.
    vi.runAllTimers();

    expect(order).toEqual([2, 3, 1]);
    vi.useRealTimers();
  });

  it("disposer removes element from observer and queue before it fires", () => {
    vi.useFakeTimers();
    const cb = vi.fn();
    const el = document.createElement("div");
    const dispose = onFirstVisible(el, cb);

    // Dispose before any intersection — element removed from observer.
    dispose();
    const io = MockIntersectionObserver.instances.at(-1)!;
    expect(io.elements.has(el)).toBe(false);

    vi.runAllTimers();
    expect(cb).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("disposer removes cb from queue when called after intersection but before drain", () => {
    vi.useFakeTimers();
    const cb = vi.fn();
    const el = document.createElement("div");
    const dispose = onFirstVisible(el, cb);

    const io = MockIntersectionObserver.instances.at(-1)!;
    io.triggerIntersect(true);
    expect(_mountQueueLength()).toBe(1);

    // Dispose after intersection (e.g. NodeView destroyed mid-scroll)
    dispose();
    expect(_mountQueueLength()).toBe(0);

    vi.runAllTimers();
    expect(cb).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("runs immediately when IntersectionObserver is unavailable", () => {
    const saved = globalThis.IntersectionObserver;
    _resetForTest(); // also resets sharedIO which holds the old constructor
    // @ts-expect-error force-undefined for graceful degradation path
    delete globalThis.IntersectionObserver;

    const cb = vi.fn();
    onFirstVisible(document.createElement("div"), cb);
    expect(cb).toHaveBeenCalledTimes(1);

    globalThis.IntersectionObserver = saved;
  });
});
