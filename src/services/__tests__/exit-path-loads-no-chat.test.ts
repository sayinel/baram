// §44 #800 review — the ways out of the window are on the startup path (`App` →
// `use-editor-features` → `use-close-guard` → `services/app-exit`), so they must not import the
// chat store: that import alone would hydrate the whole chat history in every session, opened
// or not. The store registers its exit save itself when it loads (`registerExitSave`).
import { describe, expect, it, vi } from "vitest";

const loaded = vi.hoisted(() => ({ chat: false }));

vi.mock("../../stores/ai/chat", () => {
  loaded.chat = true;
  return {};
});

describe("the exit path", () => {
  // 이것을 실패시키는 것: `services/app-exit` 이나 `use-close-guard` 가 `stores/ai/chat` 을 정적으로
  // import 한다(시작할 때 채팅 기록 전체를 읽는다).
  it("loads without the chat store", async () => {
    await import("../app-exit");
    await import("../../hooks/use-close-guard");
    expect(loaded.chat).toBe(false);
  });

  // The pair: the mock above does run when the module is imported, so the check can fail.
  it("would see the chat store if something imported it", async () => {
    await import("../../stores/ai/chat");
    expect(loaded.chat).toBe(true);
  });
});
