// §395 spec 0074 D10 · D12 · §7 "따라가기" · "순서 관문" — the tree's rename, move and delete tell plugins
// once each after the IPC resolved, move the decorations with them, and hold the vault's `vault:changed`
// until then. The mocked IPC publishes the watcher's echo while it runs, as a long rename in a large vault
// does (spec 0074 §2 "watcher"). What fails this: a notice before the IPC resolved or after it failed, a
// missing notice, decorations left at the old key or moved after the first await, a gate never raised
// (the echo would come first) or never released (the echo would never come).
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ipc = vi.hoisted(() => ({
  deleteDir: vi.fn(),
  deleteFile: vi.fn(),
  readFile: vi.fn(),
  renameFile: vi.fn(),
  renameFileWithLinks: vi.fn(),
  renameNamespace: vi.fn(),
}));

vi.mock("../../../../ipc/invoke", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../ipc/invoke")>()),
  ...ipc,
  refreshIndex: vi.fn(async () => ({ fileCount: 0, linkCount: 0 })),
}));
vi.mock("../../../../utils/confirm-dialog", () => ({
  showAlert: vi.fn(async () => undefined),
  showConfirm: vi.fn(async () => true),
}));
vi.mock("../../../../utils/tasks/sync-open-surfaces", () => ({
  syncCleanSurfacesAfterReferrerRewrite: vi.fn(() => true),
}));

import { recordNotices } from "../../../../plugins/file-decorations/__tests__/notice-recorder";
import {
  __resetFileDecorations,
  applyDecorations,
  useFileDecorationStore,
} from "../../../../plugins/file-decorations/file-decoration-store";
import {
  __resetVaultChangeHolds,
  publishVaultChange,
} from "../../../../services/vault-changes";
import { useContextStore } from "../../../../stores/context/context";
import { useFileStore } from "../../../../stores/file/file";
import { useFileTreeCrud } from "../use-file-tree-crud";
import { useFileTreeMove } from "../use-file-tree-move";
import { useFileTreeRename } from "../use-file-tree-rename";

const TREE = [
  {
    children: [{ isDir: false, name: "x.md", path: "/vault/ns/x.md" }],
    isDir: true,
    name: "ns",
    path: "/vault/ns",
  },
  { isDir: false, name: "b.md", path: "/vault/b.md" },
  { children: [], isDir: true, name: "t", path: "/vault/t" },
];

/** An IPC that publishes the watcher's echo while it runs, then resolves with `value` or throws it. */
function echoing(value: unknown) {
  return async () => {
    publishVaultChange("ctx-v");
    if (value instanceof Error) throw value;
    return value;
  };
}

const badgeAt = (path: string) =>
  useFileDecorationStore.getState().merged.get(path)?.badges[0]?.text;

function decorate(path: string): void {
  applyDecorations("p", "P", [
    { decoration: { badge: "1" }, where: { absolute: path } },
  ]);
}

let recorder: ReturnType<typeof recordNotices>;

beforeEach(() => {
  for (const mock of Object.values(ipc)) mock.mockReset();
  useContextStore.setState({
    activeContextId: "ctx-v",
    contexts: [{ contextType: "vault", id: "ctx-v", path: "/vault" }] as never,
  });
  useFileStore.setState({
    fileTree: structuredClone(TREE),
    openFiles: new Map(),
    rootPath: "/vault",
  });
  recorder = recordNotices();
});
afterEach(() => {
  recorder.stop();
  __resetFileDecorations();
  __resetVaultChangeHolds();
});

describe("rename (use-file-tree-rename)", () => {
  const rename = async (path: string, name: string) => {
    const { result } = renderHook(() => useFileTreeRename({ current: null }));
    await act(() => result.current.handleConfirmRename(path, name));
  };

  it("tells once after the IPC, moves the decoration, and lets the echo follow", async () => {
    decorate("/vault/b.md");
    ipc.renameFileWithLinks.mockImplementation(
      echoing({ skippedFiles: [], updatedFiles: [] }),
    );
    await rename("/vault/b.md", "c.md");
    expect(recorder.events).toEqual([
      "rename /vault/b.md → /vault/c.md",
      "vault ctx-v",
    ]);
    expect(badgeAt("/vault/c.md")).toBe("1");
    expect(badgeAt("/vault/b.md")).toBeUndefined();
  });

  /** D10 · review m11 — in the tree update's synchronous span: the referrer read (the first await after
   *  the IPC) already sees the decoration at the new key. */
  it("moves the decoration before reading the referrers", async () => {
    decorate("/vault/b.md");
    useFileStore.setState({ openFiles: new Map([["/vault/r.md", "old"]]) });
    let seenAtRead: string | undefined;
    ipc.readFile.mockImplementation(async () => {
      seenAtRead = badgeAt("/vault/c.md");
      return "new";
    });
    ipc.renameFileWithLinks.mockResolvedValue({
      skippedFiles: [],
      updatedFiles: ["/vault/r.md"],
    });
    await rename("/vault/b.md", "c.md");
    expect(ipc.readFile).toHaveBeenCalledTimes(1);
    expect(seenAtRead).toBe("1");
  });

  /** D10 — `renameNamespace` is the folder branch: `isDir` true, the keys under the folder move. */
  it("renames a folder as a folder", async () => {
    decorate("/vault/ns/x.md");
    ipc.renameNamespace.mockImplementation(
      echoing({
        filesMoved: 1,
        indexRebuilt: true,
        skippedFiles: [],
        uncheckedFiles: [],
        updatedFiles: [],
      }),
    );
    await rename("/vault/ns", "ns2");
    expect(recorder.events).toEqual([
      "rename /vault/ns → /vault/ns2 dir",
      "vault ctx-v",
    ]);
    expect(badgeAt("/vault/ns2/x.md")).toBe("1");
  });

  /** §7 — the pair of the first row: a refused IPC tells nothing and leaves the store; the gate is
   *  released (the echo goes out, and a later publish is not held). */
  it("tells nothing when the IPC fails, and releases the gate", async () => {
    decorate("/vault/b.md");
    ipc.renameFileWithLinks.mockImplementation(echoing(new Error("not ready")));
    await rename("/vault/b.md", "c.md");
    expect(recorder.events).toEqual(["vault ctx-v"]);
    expect(badgeAt("/vault/b.md")).toBe("1");
    publishVaultChange("ctx-v");
    expect(recorder.events).toEqual(["vault ctx-v", "vault ctx-v"]);
  });
});

describe("move (use-file-tree-move)", () => {
  const move = async (paths: string[], target: string) => {
    const { result } = renderHook(() => useFileTreeMove());
    await act(() => result.current.moveEntries(paths, target));
  };

  /** §7 — one notice per top-level item after `pruneNestedPaths`, each after its own IPC. */
  it("tells once per top-level item", async () => {
    decorate("/vault/ns/x.md");
    ipc.renameFile.mockImplementation(echoing(undefined));
    await move(["/vault/ns", "/vault/ns/x.md", "/vault/b.md"], "/vault/t");
    expect(recorder.events).toEqual([
      "rename /vault/ns → /vault/t/ns dir",
      "vault ctx-v",
      "rename /vault/b.md → /vault/t/b.md",
      "vault ctx-v",
    ]);
    expect(badgeAt("/vault/t/ns/x.md")).toBe("1");
  });

  it("tells nothing for an item whose IPC fails", async () => {
    ipc.renameFile
      .mockImplementationOnce(echoing(undefined))
      .mockImplementationOnce(echoing(new Error("busy")));
    await move(["/vault/ns", "/vault/b.md"], "/vault/t");
    expect(recorder.events).toEqual([
      "rename /vault/ns → /vault/t/ns dir",
      "vault ctx-v",
      "vault ctx-v",
    ]);
  });
});

describe("delete (use-file-tree-crud)", () => {
  const crud = () => renderHook(() => useFileTreeCrud()).result;

  it("deletes one entry: a notice after the IPC, the decoration dropped", async () => {
    decorate("/vault/b.md");
    ipc.deleteFile.mockImplementation(echoing(undefined));
    const result = crud();
    await act(() => result.current.handleDelete("/vault/b.md"));
    expect(recorder.events).toEqual(["delete /vault/b.md", "vault ctx-v"]);
    expect(badgeAt("/vault/b.md")).toBeUndefined();
  });

  it("deletes many: one notice per top-level item", async () => {
    ipc.deleteDir.mockImplementation(echoing(undefined));
    ipc.deleteFile.mockImplementation(echoing(undefined));
    const result = crud();
    await act(() =>
      result.current.handleDeleteMany([
        "/vault/ns",
        "/vault/ns/x.md",
        "/vault/b.md",
      ]),
    );
    expect(recorder.events).toEqual([
      "delete /vault/ns dir",
      "vault ctx-v",
      "delete /vault/b.md",
      "vault ctx-v",
    ]);
  });

  it("tells nothing when the IPC fails, and keeps the decoration", async () => {
    decorate("/vault/b.md");
    ipc.deleteFile.mockImplementation(echoing(new Error("trash failed")));
    const result = crud();
    await act(() => result.current.handleDelete("/vault/b.md"));
    expect(recorder.events).toEqual(["vault ctx-v"]);
    expect(badgeAt("/vault/b.md")).toBe("1");
  });
});
