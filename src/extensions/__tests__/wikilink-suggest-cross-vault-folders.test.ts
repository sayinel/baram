// §87 · §61 `[[work::` with nothing after it lists the vault's notes under a
// header per folder. The folder is read from each listed path the way the
// path is spelled — on Windows Rust lists `C:\…\a\x.md`, with no `/`.
import type { ContextInfo, FileEntry } from "../../ipc/types";
import type { WikilinkSuggestionItem } from "../plugins/wikilink-suggest-utils";

import { describe, expect, it, vi } from "vitest";

type MenuItems = (args: { query: string }) => Promise<WikilinkSuggestionItem[]>;

// The Suggestion plugin is replaced by a recorder of its options: `items` is
// reachable only through them.
const captured = vi.hoisted(() => ({ items: null as MenuItems | null }));
vi.mock("@tiptap/suggestion", () => ({
  Suggestion: (options: { items: MenuItems }) => {
    captured.items = options.items;
    return {};
  },
}));

import { useContextStore } from "../../stores/context/context";
import { useFileStore } from "../../stores/file/file";
import { WikilinkSuggest } from "../plugins/wikilink-suggest";

function entry(path: string, name: string, children?: FileEntry[]): FileEntry {
  return {
    ...(children ? { children } : {}),
    isDir: children !== undefined,
    modifiedAt: 0,
    name,
    path,
    size: 0,
  };
}

/** The headers `[[work::` shows for the vault at `root` listing `tree`. */
async function folderHeaders(root: string, tree: FileEntry[]) {
  const vault: ContextInfo = {
    addedAt: 0,
    alias: "work",
    color: "#000",
    contextType: "vault",
    id: "work",
    label: "work",
    path: root,
  };
  useContextStore.setState({ contexts: [vault] });
  useFileStore.setState({ fileTree: tree, rootPath: root });
  WikilinkSuggest.config.addProseMirrorPlugins!.call({ editor: {} } as never);
  const rows = await captured.items!({ query: "work::" });
  return rows.filter((r) => r.kind === "folder-header").map((r) => r.label);
}

describe("§87 browsing another vault groups its notes by folder", () => {
  it("on Windows, from the paths Rust lists", async () => {
    // What fails this: taking the folder after the vault's root at the last
    // `/` — `a\x.md` has none, so every note sat under "/ (root)".
    const ROOT = "C:\\Users\\me\\work";
    expect(
      await folderHeaders(ROOT, [
        entry(`${ROOT}\\a`, "a", [entry(`${ROOT}\\a\\x.md`, "x.md")]),
        entry(`${ROOT}\\top.md`, "top.md"),
      ]),
    ).toEqual(["a", "/ (root)"]);
  });

  it("on a UNC share", async () => {
    // What fails this: cutting at the root's length as written. `slashPath`
    // turns a UNC root's two leading `\` into one `/`, so the cut lands a
    // character late and `a/b` reads as `/b`. A drive letter keeps its length.
    const ROOT = "\\\\server\\share\\work";
    expect(
      await folderHeaders(ROOT, [
        entry(`${ROOT}\\a`, "a", [
          entry(`${ROOT}\\a\\b`, "b", [entry(`${ROOT}\\a\\b\\x.md`, "x.md")]),
        ]),
        entry(`${ROOT}\\top.md`, "top.md"),
      ]),
    ).toEqual(["a/b", "/ (root)"]);
  });

  it("on POSIX, where a backslash is a character of a name", async () => {
    // The pin: `a\b.md` at the root is a note named so, not `b.md` in `a`.
    const ROOT = "/Users/me/work";
    expect(
      await folderHeaders(ROOT, [
        entry(`${ROOT}/a`, "a", [entry(`${ROOT}/a/x.md`, "x.md")]),
        entry(`${ROOT}/a\\b.md`, "a\\b.md"),
      ]),
    ).toEqual(["a", "/ (root)"]);
  });
});
