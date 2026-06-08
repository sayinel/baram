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

const mockInvoke = vi.fn(
  async (command: string): Promise<null | string[] | undefined> => {
    switch (command) {
      case "get_config":
      case "keyring_get":
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
