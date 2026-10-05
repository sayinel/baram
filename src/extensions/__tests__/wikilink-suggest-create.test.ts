// §31 The suggest menu's "create" row never overwrites a file.
//
// The row is offered because no listed name matched the typed text. A note whose
// name is stored decomposed (NFD) is not matched by the composed (NFC) text the
// keyboard types, yet on APFS both spellings open the same file — so writing the
// new note with `writeFile` emptied that note to its heading line.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { createFile, listDir, refreshIndex, writeFile } = vi.hoisted(() => ({
  createFile: vi.fn(async (_path: string, _content: string) => {}),
  listDir: vi.fn(async () => []),
  refreshIndex: vi.fn(async () => {}),
  writeFile: vi.fn(async () => {}),
}));
vi.mock("../../ipc/invoke", async () => {
  const fs =
    await vi.importActual<typeof import("../../ipc/fs")>("../../ipc/fs");
  return {
    createFile,
    isFileExistsError: fs.isFileExistsError,
    listDir,
    refreshIndex,
    writeFile,
  };
});

import { Editor } from "@tiptap/core";

import { createBaramExtensions } from "..";
import { FileExistsError } from "../../ipc/fs";
import { useContextStore } from "../../stores/context/context";
import { useFileStore } from "../../stores/file/file";
import { useUIStore } from "../../stores/ui/ui";
import {
  applyWikilinkSuggestion,
  createLinkedNote,
  offersCreate,
} from "../plugins/wikilink-suggest";
import { type WikilinkSuggestionItem } from "../plugins/wikilink-suggest-utils";

beforeEach(() => {
  vi.clearAllMocks();
  useUIStore.setState({ toast: null });
  useContextStore.setState({ activeContextId: null, contexts: [] });
  useFileStore.setState({
    fileTree: [{ isDir: false, name: "foo.md", path: "/v/foo.md" }],
    rootPath: "/v",
  });
});

/** The menu's row for the root note `foo.md`: keyed by its stem, as the menu lists it. */
const FOO: WikilinkSuggestionItem = {
  id: "0",
  label: "foo",
  path: "/v/foo.md",
  target: "foo",
};

describe("§31 offersCreate — the create row only for a link a click would create", () => {
  it("is offered for a name nothing resolves to", () => {
    expect(offersCreate([FOO], "bar")).toBe(true);
  });

  it("is not offered for a listed name", () => {
    expect(offersCreate([FOO], "foo")).toBe(false);
  });

  it("is not offered for a name the link already resolves, with its extension", () => {
    // What fails this: dropping the resolver check — `foo.md` matches no row's stem,
    // so the menu offered to create the `foo.md` that `[[foo.md]]` resolves to.
    expect(offersCreate([FOO], "foo.md")).toBe(false);
    expect(offersCreate([FOO], "FOO.md")).toBe(false);
  });
});

describe("§31 applyWikilinkSuggestion — the create row", () => {
  it("makes the note through createLinkedNote and inserts the link", async () => {
    // What fails this: making the note any other way at the call site, such as the
    // old inline `writeFile` — `createFile` is never called.
    const editor = new Editor({
      content: "<p>[[bar</p>",
      extensions: createBaramExtensions(),
    });
    const item: WikilinkSuggestionItem = {
      id: "__create__",
      kind: "create",
      label: 'Create "bar"',
      path: "",
      target: "bar",
    };

    applyWikilinkSuggestion({ editor, props: item, range: { from: 1, to: 6 } });

    await vi.waitFor(() =>
      expect(createFile).toHaveBeenCalledWith("/v/bar.md", "# bar\n"),
    );
    expect(writeFile).not.toHaveBeenCalled();
    const links: string[] = [];
    editor.state.doc.descendants((node) => {
      if (node.type.name === "wikilink") links.push(node.attrs.target);
    });
    expect(links).toEqual(["bar"]);
    editor.destroy();
  });
});

describe("§31 createLinkedNote", () => {
  it("makes the note with createFile and refreshes the index and the tree", async () => {
    await createLinkedNote("/v", "노트 이름");

    expect(createFile).toHaveBeenCalledWith("/v/노트 이름.md", "# 노트 이름\n");
    expect(refreshIndex).toHaveBeenCalledWith("/v");
    expect(listDir).toHaveBeenCalledWith("/v", true);
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("leaves a taken path alone and says so", async () => {
    // What fails this: making the note with `writeFile` again — it replaces the
    // file at the path instead of being refused, and the toast never shows.
    createFile.mockRejectedValueOnce(new FileExistsError("/v/노트 이름.md"));

    await createLinkedNote("/v", "노트 이름");

    expect(writeFile).not.toHaveBeenCalled();
    expect(refreshIndex).not.toHaveBeenCalled();
    expect(listDir).not.toHaveBeenCalled();
    expect(useUIStore.getState().toast).toMatchObject({ type: "error" });
    expect(useUIStore.getState().toast?.message).toContain("노트 이름.md");
  });

  it("passes any other failure to the caller", async () => {
    createFile.mockRejectedValueOnce(new Error("disk full"));

    await expect(createLinkedNote("/v", "x")).rejects.toThrow("disk full");
    expect(useUIStore.getState().toast).toBeNull();
  });
});
