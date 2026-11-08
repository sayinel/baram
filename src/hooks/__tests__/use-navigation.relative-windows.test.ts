// §61 A click on a relative wikilink in a note of a Windows vault opens the
// note it names — through the real resolver (`wikilink-nav.ts`), not a mock of
// it. When the resolver missed, the click took the path for a link to nothing
// and asked `createFile` for a new note.
import type { Editor } from "@tiptap/core";

import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../components/editor/pdf/pdf-highlight-store", () => ({
  readSidecar: vi.fn(),
}));

const { createFile } = vi.hoisted(() => ({
  createFile: vi.fn(async (_path: string, _content: string) => {}),
}));
vi.mock("../../ipc/invoke", () => ({
  createDir: vi.fn(async () => {}),
  createFile,
  isFileExistsError: () => false,
  listDir: vi.fn(async () => []),
  refreshIndex: vi.fn(async () => {}),
  writeFile: vi.fn(async () => {}),
}));

vi.mock("../../utils/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn() },
}));

import type { ContextInfo, FileEntry } from "../../ipc/types";

import { useContextStore } from "../../stores/context/context";
import { useEditorStore } from "../../stores/editor/editor";
import { useFileStore } from "../../stores/file/file";
import { useNavigation } from "../use-navigation";

const ROOT = "C:\\Users\\me\\vault";

function entry(path: string, children?: FileEntry[]): FileEntry {
  return {
    ...(children ? { children } : {}),
    isDir: children !== undefined,
    modifiedAt: 0,
    name: path.slice(path.lastIndexOf("\\") + 1),
    path,
    size: 0,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  const vault = {
    addedAt: 0,
    color: "#000",
    contextType: "vault",
    id: "ctx-v",
    label: "vault",
    path: ROOT,
    vaultType: "general",
  } as ContextInfo;
  useContextStore.setState({ activeContextId: vault.id, contexts: [vault] });
  useFileStore.setState({
    fileTree: [
      entry(`${ROOT}\\notes`, [
        entry(`${ROOT}\\notes\\note.md`),
        entry(`${ROOT}\\notes\\plan.md`),
      ]),
    ],
    rootPath: ROOT,
  });
  useEditorStore.setState({
    activeTabId: "t1",
    tabs: [
      {
        contextId: vault.id,
        filePath: `${ROOT}\\notes\\note.md`,
        id: "t1",
        isDirty: false,
        isPinned: false,
        title: "note",
      },
    ],
  } as never);
});

describe("§61 clicking [[./plan]] in a note Rust listed", () => {
  it("opens the note beside it and creates nothing", async () => {
    // What fails this: the resolver taking the open note's folder at its last
    // `/` — the click then asked `createFile` for `C:\…\vault/./plan.md`.
    const handleOpenFilePath = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useNavigation({
        editor: null as unknown as Editor,
        handleOpenFilePath,
      }),
    );

    result.current.handleWikilinkNavigate("./plan");

    await waitFor(() =>
      expect(handleOpenFilePath).toHaveBeenCalledWith(
        `${ROOT}\\notes\\plan.md`,
      ),
    );
    expect(createFile).not.toHaveBeenCalled();
  });
});
