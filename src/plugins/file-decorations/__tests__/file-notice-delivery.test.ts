// §395 spec 0074 D11 · §7 "알림" — who hears the app's renames and deletions, and what each tier receives.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useContextStore } from "../../../stores/context/context";
import { utf8Bytes } from "../../rendered/limits";
import {
  deliverFileNoticeToSandbox,
  emitFileNotice,
  sandboxNoticeEvent,
  watchFileNotices,
} from "../file-notice-delivery";

beforeEach(() => {
  useContextStore.setState({
    contexts: [
      { contextType: "vault", id: "ctx-v", path: "/v" },
      { contextType: "vault", id: "ctx-sub", path: "/v/sub" },
    ] as never,
  });
});
afterEach(() => {
  vi.restoreAllMocks();
});

function source() {
  const listeners: Array<(n: Parameters<typeof emitFileNotice>[1]) => void> =
    [];
  return {
    count: () => listeners.length,
    publish: (n: Parameters<typeof emitFileNotice>[1]) =>
      listeners.forEach((l) => l(n)),
    subscribe: (l: (n: Parameters<typeof emitFileNotice>[1]) => void) => {
      listeners.push(l);
      return () => void listeners.splice(listeners.indexOf(l), 1);
    },
  };
}

describe("watchFileNotices (D11)", () => {
  /** What fails this: gating on `events` (the plugin that may read the paths would not hear), or on
   *  nothing (the plugin that may not would). */
  it("subscribes files and files:readonly, and not events alone", () => {
    for (const capabilities of [["files"], ["files:readonly"]] as const) {
      const s = source();
      const deliver = vi.fn();
      const stop = watchFileNotices({
        capabilities,
        deliver,
        label: "T",
        pluginId: "p",
        subscribe: s.subscribe,
      });
      s.publish({ isDir: false, kind: "delete", path: "/v/a.md" });
      expect(deliver).toHaveBeenCalledTimes(1);
      stop();
      expect(s.count()).toBe(0);
    }
    const s = source();
    watchFileNotices({
      capabilities: ["events"],
      deliver: vi.fn(),
      label: "T",
      pluginId: "p",
      subscribe: s.subscribe,
    });
    expect(s.count()).toBe(0);
  });
});

describe("what each tier receives (D11 · §4)", () => {
  it("gives the trusted tier absolute paths and isDir", () => {
    const emit = vi.fn();
    emitFileNotice(emit, {
      from: "/v/a.md",
      isDir: false,
      kind: "rename",
      to: "/v/b.md",
    });
    emitFileNotice(emit, { isDir: true, kind: "delete", path: "/v/d" });
    expect(emit.mock.calls).toEqual([
      ["file:rename", "/v/a.md", "/v/b.md", false],
      ["file:delete", "/v/d", true],
    ]);
  });

  /** A move between nested vaults: each side in its own innermost context. */
  it("gives the sandboxed tier each side in its own context", () => {
    expect(
      sandboxNoticeEvent({
        from: "/v/sub/a.md",
        isDir: false,
        kind: "rename",
        to: "/v/b.md",
      }),
    ).toEqual({
      args: [
        {
          from: { context: "ctx-sub", path: "a.md" },
          isDir: false,
          to: { context: "ctx-v", path: "b.md" },
        },
      ],
      event: "file:rename",
    });
    expect(
      sandboxNoticeEvent({ isDir: true, kind: "delete", path: "/v/d" }),
    ).toEqual({
      args: [{ context: "ctx-v", isDir: true, path: "d" }],
      event: "file:delete",
    });
  });

  /** D11 — a side in no registered context: not sent. What fails this: sending a half-located rename. */
  it("sends nothing when a path is in no context", () => {
    expect(
      sandboxNoticeEvent({
        from: "/v/a.md",
        isDir: false,
        kind: "rename",
        to: "/elsewhere/b.md",
      }),
    ).toBeNull();
    expect(
      sandboxNoticeEvent({
        isDir: false,
        kind: "delete",
        path: "/elsewhere/a.md",
      }),
    ).toBeNull();
  });
});

describe("deliverFileNoticeToSandbox (D11 · P21)", () => {
  const rename = (length: number) => ({
    from: `/v/${"a".repeat(length)}.md`,
    isDir: false,
    kind: "rename" as const,
    to: `/v/${"b".repeat(length)}.md`,
  });

  /** Spec 0074 D11 (dev-notes `240ed96`) — no size bound: a rename at the path cap, whose frame is over
   *  tauri's 8,192-byte direct threshold (measured below, not asserted in prose), is still sent. What fails
   *  this: any size check left in at or under that threshold (the bound the spec removed). */
  it("sends a rename whose frame is over 8,192 bytes, and a short one", () => {
    const deliver = vi.fn();
    deliverFileNoticeToSandbox(deliver, rename(4090));
    deliverFileNoticeToSandbox(deliver, rename(10));
    expect(deliver).toHaveBeenCalledTimes(2);
    const [event, args] = deliver.mock.calls[0]!;
    expect(event).toBe("file:rename");
    expect(
      utf8Bytes(JSON.stringify({ type: "deliverEvent", event, args })),
    ).toBeGreaterThan(8192);
  });

  it("sends nothing for a notice in no context", () => {
    const deliver = vi.fn();
    deliverFileNoticeToSandbox(deliver, {
      isDir: false,
      kind: "delete",
      path: "/elsewhere/a.md",
    });
    expect(deliver).not.toHaveBeenCalled();
  });
});
