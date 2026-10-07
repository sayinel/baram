// §28 A wikilink that resolves to nothing creates its note — and never overwrites one.
//
// "Resolves to nothing" is no evidence the path is free: the resolver reads the file
// tree, not the disk. Before §390 a note whose name was stored decomposed (NFD) was not
// matched by the composed (NFC) link text, yet on APFS both spellings open the same
// file, so creating the note with `writeFile` emptied that note to its heading line.
import type { Editor } from "@tiptap/core";

import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { readSidecar } = vi.hoisted(() => ({ readSidecar: vi.fn() }));
vi.mock("../../components/editor/pdf/pdf-highlight-store", () => ({
  readSidecar,
}));

// Every export use-navigation imports from this module (`findAliasContext`,
// `findNoteByStem`, `resolveWikilinkTarget`): vitest throws on reading a
// missing one, and the async IIFE's `try` in use-navigation swallows that.
const { findAliasContext, resolveWikilinkTarget } = vi.hoisted(() => ({
  findAliasContext: vi.fn(),
  resolveWikilinkTarget: vi.fn(),
}));
vi.mock("../../utils/editor/wikilink-nav", () => ({
  findAliasContext,
  findNoteByStem: vi.fn(() => null),
  resolveWikilinkTarget,
}));

const { createDir, createFile, listDir, refreshIndex, writeFile } = vi.hoisted(
  () => ({
    createDir: vi.fn(async () => {}),
    createFile: vi.fn(async (_path: string, _content: string) => {}),
    listDir: vi.fn(async () => []),
    refreshIndex: vi.fn(async () => {}),
    writeFile: vi.fn(async () => {}),
  }),
);
vi.mock("../../ipc/invoke", async () => {
  const fs =
    await vi.importActual<typeof import("../../ipc/fs")>("../../ipc/fs");
  return {
    createDir,
    createFile,
    isFileExistsError: fs.isFileExistsError,
    listDir,
    refreshIndex,
    writeFile,
  };
});

const { logger } = vi.hoisted(() => ({
  logger: { error: vi.fn(), warn: vi.fn() },
}));
vi.mock("../../utils/logger", () => ({ logger }));

import type { ContextInfo } from "../../ipc/types";

import { FileExistsError } from "../../ipc/fs";
import { useContextStore } from "../../stores/context/context";
import { useFileStore } from "../../stores/file/file";
import { useUIStore } from "../../stores/ui/ui";
import { useNavigation } from "../use-navigation";

const VAULT = {
  addedAt: 0,
  color: "#000",
  contextType: "vault",
  id: "ctx-v",
  label: "V",
  path: "/v",
  vaultType: "general",
} as ContextInfo;

function renderNav() {
  const handleOpenFilePath = vi.fn().mockResolvedValue(undefined);
  const editor = {
    commands: { scrollIntoView: vi.fn(), setTextSelection: vi.fn() },
    state: { doc: { descendants: vi.fn() } },
    view: { dispatch: vi.fn() },
  } as unknown as Editor;
  const { result } = renderHook(() =>
    useNavigation({ editor, handleOpenFilePath }),
  );
  return { handleOpenFilePath, result };
}

beforeEach(() => {
  vi.clearAllMocks();
  resolveWikilinkTarget.mockReturnValue(null);
  findAliasContext.mockReturnValue(null);
  useContextStore.setState({ activeContextId: VAULT.id, contexts: [VAULT] });
  useFileStore.setState({ rootPath: "/v" });
  useUIStore.setState({ toast: null });
});

describe("§28 creating the target of a link that resolves to nothing", () => {
  it("makes the note with createFile, then opens it", async () => {
    const { handleOpenFilePath, result } = renderNav();

    result.current.handleWikilinkNavigate("노트 이름");

    await waitFor(() =>
      expect(handleOpenFilePath).toHaveBeenCalledWith("/v/노트 이름.md"),
    );
    expect(createFile).toHaveBeenCalledWith("/v/노트 이름.md", "# 노트 이름\n");
    expect(refreshIndex).toHaveBeenCalledWith("/v");
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("leaves a taken path alone, says so, and opens nothing", async () => {
    // What fails this: making the note with `writeFile` again — it replaces the
    // file at the path instead of being refused, and the toast never shows.
    createFile.mockRejectedValueOnce(new FileExistsError("/v/노트 이름.md"));
    const { handleOpenFilePath, result } = renderNav();

    result.current.handleWikilinkNavigate("노트 이름");

    await waitFor(() =>
      expect(useUIStore.getState().toast).toMatchObject({ type: "error" }),
    );
    expect(useUIStore.getState().toast?.message).toContain("노트 이름.md");
    expect(writeFile).not.toHaveBeenCalled();
    expect(refreshIndex).not.toHaveBeenCalled();
    expect(handleOpenFilePath).not.toHaveBeenCalled();
  });

  it("logs any other failure and opens nothing", async () => {
    createFile.mockRejectedValueOnce(new Error("disk full"));
    const { handleOpenFilePath, result } = renderNav();

    result.current.handleWikilinkNavigate("x");

    await waitFor(() =>
      expect(logger.error).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ message: "disk full" }),
      ),
    );
    expect(handleOpenFilePath).not.toHaveBeenCalled();
    expect(useUIStore.getState().toast).toBeNull();
  });
});
