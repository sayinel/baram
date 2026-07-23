import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";

// jsdom does not implement `elementFromPoint`. ProseMirror's `posAtCoords`
// (prosemirror-view) calls it unconditionally, and Tiptap's Placeholder
// extension (@tiptap/extensions, viewport tracking) invokes `posAtCoords` on
// every editor mount. Without this polyfill, mounting any editor that includes
// the Placeholder extension throws `elementFromPoint is not a function`.
// Returning null is the correct "no element at this point" signal — ProseMirror
// then falls back gracefully and Placeholder treats it as "no viewport info".
if (typeof Document.prototype.elementFromPoint !== "function") {
  Document.prototype.elementFromPoint = () => null;
}

// jsdom does not implement `scrollIntoView`. Keyboard-navigable list/picker
// components (Quick Switcher, Move-to-folder modal, etc.) call it
// unconditionally on the highlighted row to keep it visible while navigating.
// A no-op is the correct stand-in — scrolling has no visible effect in a
// headless test DOM anyway.
if (typeof Element.prototype.scrollIntoView !== "function") {
  Element.prototype.scrollIntoView = () => {};
}

const mockInvoke = vi.fn(
  async (command: string): Promise<null | string[] | undefined> => {
    switch (command) {
      case "get_config":
        return null;
      case "get_opened_urls":
        return [];
      default:
        return undefined;
    }
  },
);

const mockListen = vi.fn().mockResolvedValue(() => {});

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mockInvoke,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: mockListen,
}));

afterEach(() => {
  mockInvoke.mockClear();
  mockListen.mockClear();
  mockListen.mockResolvedValue(() => {});
});

// §perf-large-file: jsdom has no IntersectionObserver. Provide a mock whose
// instances are tracked so tests can trigger intersection manually.
class MockIntersectionObserver implements IntersectionObserver {
  static instances: MockIntersectionObserver[] = [];
  elements = new Set<Element>();
  readonly root = null;
  readonly rootMargin = "";
  readonly scrollMargin = "";
  readonly thresholds = [];
  private cb: IntersectionObserverCallback;

  constructor(cb: IntersectionObserverCallback) {
    this.cb = cb;
    MockIntersectionObserver.instances.push(this);
  }
  disconnect() {
    this.elements.clear();
  }
  observe(el: Element) {
    this.elements.add(el);
  }
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
  /** Test helper: fire intersection for all observed elements. */
  triggerIntersect(isIntersecting = true) {
    const entries = [...this.elements].map(
      (target) => ({ target, isIntersecting }) as IntersectionObserverEntry,
    );
    this.cb(entries, this);
  }
  unobserve(el: Element) {
    this.elements.delete(el);
  }
}
globalThis.IntersectionObserver =
  MockIntersectionObserver as unknown as typeof IntersectionObserver;
(
  globalThis as unknown as {
    MockIntersectionObserver: typeof MockIntersectionObserver;
  }
).MockIntersectionObserver = MockIntersectionObserver;
