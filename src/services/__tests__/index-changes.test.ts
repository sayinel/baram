// §29 #824 `index:changed` → the `indexVersion` bump Graph and Backlinks read: one per
// event, naming its one file in the active tab's spelling (#791, #797).
import { beforeEach, describe, expect, it, vi } from "vitest";

const handlers = new Map<string, (e: { payload: unknown }) => void>();
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(
    async (event: string, handler: (e: { payload: unknown }) => void) => {
      handlers.set(event, handler);
      return () => handlers.delete(event);
    },
  ),
}));

import { useEditorStore } from "../../stores/editor/editor";
import { useLinkStore } from "../../stores/editor/link";
import { installIndexChanges, onIndexChanged } from "../index-changes";
import { subscribeVaultChanges } from "../vault-changes";

function changed(
  entries: { canonical: string; spellings: string[] }[],
  rebuilt: string[] = [],
): void {
  onIndexChanged({ entries, rebuilt });
}

function version(): number {
  return useLinkStore.getState().indexVersion;
}

beforeEach(() => {
  useLinkStore.setState({ indexVersion: 0, savedPath: null });
  useEditorStore.setState({ activeTabId: null, tabs: [] } as never);
});

describe("index:changed", () => {
  // 이것을 실패시키는 것: 항목 하나인 이벤트도 `invalidate()` 로 올린다(#791 의 self-save 판정이
  // 저장마다 mention 검색을 다시 부른다).
  it("names the one file of an event on the bump", () => {
    changed([{ canonical: "/v/a.md", spellings: ["/v/a.md"] }]);
    expect(version()).toBe(1);
    expect(useLinkStore.getState().savedPath).toBe("/v/a.md");
  });

  // 이것을 실패시키는 것: 활성 탭의 경로를 항목의 spelling 과 canonical 에서 찾지 않는다(첫 spelling 을 쓴다).
  it("names one file in the spelling the active tab uses", () => {
    useEditorStore.setState({
      activeTabId: "t",
      tabs: [{ filePath: "/var/v/a.md", id: "t" } as never],
    });
    changed([
      {
        canonical: "/private/var/v/a.md",
        spellings: ["/private/var/v/a.md", "/var/v/a.md"],
      },
    ]);
    expect(useLinkStore.getState().savedPath).toBe("/var/v/a.md");

    useEditorStore.setState({
      activeTabId: "t",
      tabs: [{ filePath: "/private/var/v/b.md", id: "t" } as never],
    });
    changed([{ canonical: "/private/var/v/b.md", spellings: ["/var/v/b.md"] }]);
    expect(useLinkStore.getState().savedPath).toBe("/private/var/v/b.md");
  });

  // 이것을 실패시키는 것: 항목 여럿이나 rebuild 가 실린 이벤트에 첫 경로를 이름 붙인다.
  it("names nothing when several files or a whole index changed", () => {
    changed([
      { canonical: "/v/a.md", spellings: ["/v/a.md"] },
      { canonical: "/v/b.md", spellings: ["/v/b.md"] },
    ]);
    expect(useLinkStore.getState().savedPath).toBeNull();
    changed([{ canonical: "/v/a.md", spellings: ["/v/a.md"] }], ["/v"]);
    expect(useLinkStore.getState().savedPath).toBeNull();
    expect(version()).toBe(2);
  });

  // 이것을 실패시키는 것: `installIndexChanges` 가 `index:changed` 를 듣지 않는다 — 또는 부를 때마다 다시 구독한다.
  it("subscribes once and turns Rust's event into the bump", async () => {
    await installIndexChanges();
    await installIndexChanges();
    const { listen } = await import("@tauri-apps/api/event");
    expect(vi.mocked(listen)).toHaveBeenCalledTimes(1);
    handlers.get("index:changed")?.({
      payload: {
        entries: [{ canonical: "/v/a.md", spellings: ["/v/a.md"] }],
        rebuilt: [],
      },
    });
    expect(version()).toBe(1);
  });

  // §29 #824 A watcher batch whose rebuild went to the scheduler: the batch names the
  // note it applied, then the rebuild announces the vault. One bump each, the first
  // naming the active tab (#791), the second naming nothing.
  // 이것을 실패시키는 것: rebuild 이벤트가 활성 탭을 이름 붙인다 — 또는 이벤트 하나에 두 번 올린다.
  it("names the applied note, then bumps once for the rebuilt vault", () => {
    useEditorStore.setState({
      activeTabId: "t",
      tabs: [{ filePath: "/v/n.md", id: "t" } as never],
    });
    changed([{ canonical: "/v/n.md", spellings: ["/v/n.md"] }]);
    expect(version()).toBe(1);
    expect(useLinkStore.getState().savedPath).toBe("/v/n.md");
    changed([], ["/v"]);
    expect(version()).toBe(2);
    expect(useLinkStore.getState().savedPath).toBeNull();
  });

  // §393 `vault:changed`: what used to be `useVaultChangeSync`'s answer now rides on Rust's
  // event — each context once, and the panel left alone when no path or index changed.
  // 이것을 실패시키는 것: 이름 붙인 경로도 rebuild 도 없는 이벤트에 `invalidate()` 를 부른다(watcher 메아리가
  // Graph · Backlinks 를 다시 읽게 한다), 또는 `contexts` 를 publish 하지 않는다.
  it("announces each context and re-reads nothing when no path changed", () => {
    const heard: string[] = [];
    const off = subscribeVaultChanges((id) => heard.push(id));
    onIndexChanged({ contexts: ["a", "b"], entries: [], rebuilt: [] });
    off();
    expect(heard).toEqual(["a", "b"]);
    expect(version()).toBe(0);
  });

  // 이것을 실패시키는 것: 구독자에게 알린 뒤에 `invalidate` 를 부른다 — 듣자마자 읽는 플러그인이 옛 판을 읽는다.
  it("announces after the bump, so a listener reads the new state", () => {
    const seenAt: number[] = [];
    const off = subscribeVaultChanges(() => seenAt.push(version()));
    onIndexChanged({
      contexts: ["a"],
      entries: [{ canonical: "/v/a.md", spellings: ["/v/a.md"] }],
      rebuilt: [],
    });
    off();
    expect(seenAt).toEqual([1]);
  });

  it("announces nothing for an event without contexts — a command's", () => {
    const heard: string[] = [];
    const off = subscribeVaultChanges((id) => heard.push(id));
    changed([{ canonical: "/v/a.md", spellings: ["/v/a.md"] }]);
    off();
    expect(heard).toEqual([]);
    expect(version()).toBe(1);
  });
});
