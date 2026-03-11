import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";

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
