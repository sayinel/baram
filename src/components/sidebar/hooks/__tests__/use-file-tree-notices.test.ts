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

import type { EditorTab } from "../../../../stores/editor/editor";

import { recordNotices } from "../../../../plugins/file-decorations/__tests__/notice-recorder";
import {
  __resetFileDecorations,
  applyDecorations,
  useFileDecorationStore,
} from "../../../../plugins/file-decorations/file-decoration-store";
import { onFileNotice } from "../../../../plugins/file-decorations/operation-notices";
import {
  __resetVaultChangeHolds,
  publishVaultChange,
} from "../../../../services/vault-changes";
import { useContextStore } from "../../../../stores/context/context";
import { useEditorStore } from "../../../../stores/editor/editor";
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

  /** §33 · D10 — a PDF's rename carries its highlight note and sidecar along (`moved`), and each carried
   *  file is an in-app rename too: one notice per file in the hook's order (the PDF, then `moved` as the
   *  result lists it), each decoration moved, all before the held echo. What fails this: telling the
   *  renamed file alone — the two carried notices are missing and their decorations stay at the old
   *  paths. */
  it("tells a rename for each file a PDF's rename carries along", async () => {
    const note = "/vault/highlights/papers/Paper.md";
    const sidecar = "/vault/.baram/pdf-highlights/papers/Paper.json";
    const movedNote = "/vault/highlights/papers/Survey.md";
    const movedSidecar = "/vault/.baram/pdf-highlights/papers/Survey.json";
    decorate(note);
    decorate(sidecar);
    ipc.renameFileWithLinks.mockImplementation(
      echoing({
        moved: [
          { from: note, to: movedNote },
          { from: sidecar, to: movedSidecar },
        ],
        skippedFiles: [],
        updatedFiles: [],
      }),
    );
    await rename("/vault/papers/Paper.pdf", "Survey.pdf");
    expect(recorder.events).toEqual([
      "rename /vault/papers/Paper.pdf → /vault/papers/Survey.pdf",
      `rename ${note} → ${movedNote}`,
      `rename ${sidecar} → ${movedSidecar}`,
      "vault ctx-v",
    ]);
    expect(badgeAt(movedNote)).toBe("1");
    expect(badgeAt(movedSidecar)).toBe("1");
    expect(badgeAt(note)).toBeUndefined();
    expect(badgeAt(sidecar)).toBeUndefined();
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

/**
 * D10 — a listener runs after the app's tabs follow the rename or move, as a delete closes its tabs before
 * telling: a trusted plugin's `file:rename` handler that reads the open tabs finds them on the new path.
 * Each row records the tab paths at each notice. What fails this: telling before `renameTab` /
 * `renameDirInTabs` (the row would see the old path).
 */
describe("a listener finds the tabs already on the new path", () => {
  const tab = (id: string, filePath: string): EditorTab => ({
    contextId: "ctx-v",
    filePath,
    id,
    isDirty: false,
    isPinned: false,
    title: filePath.split("/").pop() ?? "",
  });
  let seen: string[][];
  let off: () => void;

  beforeEach(() => {
    seen = [];
    off = onFileNotice(() => {
      seen.push(useEditorStore.getState().tabs.map((t) => t.filePath));
    });
  });
  afterEach(() => {
    off();
    useEditorStore.setState({ tabs: [] });
  });

  /** §33 — the renamed PDF, then the highlight note it carries along, each re-keyed before its notice. */
  it("renames a file and what it carries", async () => {
    const note = "/vault/highlights/papers/Paper.md";
    const movedNote = "/vault/highlights/papers/Survey.md";
    useEditorStore.setState({
      tabs: [tab("pdf", "/vault/papers/Paper.pdf"), tab("note", note)],
    });
    ipc.renameFileWithLinks.mockResolvedValue({
      moved: [{ from: note, to: movedNote }],
      skippedFiles: [],
      updatedFiles: [],
    });
    const { result } = renderHook(() => useFileTreeRename({ current: null }));
    await act(() =>
      result.current.handleConfirmRename(
        "/vault/papers/Paper.pdf",
        "Survey.pdf",
      ),
    );
    expect(seen).toEqual([
      ["/vault/papers/Survey.pdf", note],
      ["/vault/papers/Survey.pdf", movedNote],
    ]);
  });

  it("renames a folder", async () => {
    useEditorStore.setState({ tabs: [tab("x", "/vault/ns/x.md")] });
    ipc.renameNamespace.mockResolvedValue({
      filesMoved: 1,
      indexRebuilt: true,
      skippedFiles: [],
      uncheckedFiles: [],
      updatedFiles: [],
    });
    const { result } = renderHook(() => useFileTreeRename({ current: null }));
    await act(() => result.current.handleConfirmRename("/vault/ns", "ns2"));
    expect(seen).toEqual([["/vault/ns2/x.md"]]);
  });

  /** Each moved item's tabs follow before its own notice; the next item's tabs are not moved yet. */
  it("moves a folder and a file", async () => {
    useEditorStore.setState({
      tabs: [tab("b", "/vault/b.md"), tab("x", "/vault/ns/x.md")],
    });
    ipc.renameFile.mockResolvedValue(undefined);
    const { result } = renderHook(() => useFileTreeMove());
    await act(() =>
      result.current.moveEntries(["/vault/ns", "/vault/b.md"], "/vault/t"),
    );
    expect(seen).toEqual([
      ["/vault/b.md", "/vault/t/ns/x.md"],
      ["/vault/t/b.md", "/vault/t/ns/x.md"],
    ]);
  });
});
