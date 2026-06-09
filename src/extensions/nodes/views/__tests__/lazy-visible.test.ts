import { describe, expect, it, vi } from "vitest";

import { onFirstVisible } from "../lazy-visible";

declare const MockIntersectionObserver: {
  instances: { triggerIntersect: (v?: boolean) => void }[];
};

describe("onFirstVisible", () => {
  it("runs the callback only after the element intersects, once", () => {
    const el = document.createElement("div");
    const cb = vi.fn();
    onFirstVisible(el, cb);

    expect(cb).not.toHaveBeenCalled();

    const io = MockIntersectionObserver.instances.at(-1)!;
    io.triggerIntersect(true);
    io.triggerIntersect(true);

    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("runs immediately when IntersectionObserver is unavailable", () => {
    const saved = globalThis.IntersectionObserver;
    // @ts-expect-error force-undefined for graceful degradation path
    delete globalThis.IntersectionObserver;
    const cb = vi.fn();
    onFirstVisible(document.createElement("div"), cb);
    expect(cb).toHaveBeenCalledTimes(1);
    globalThis.IntersectionObserver = saved;
  });
});
