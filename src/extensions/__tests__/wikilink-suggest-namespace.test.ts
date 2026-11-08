// §61 The [[ menu's relative mode (`[[./`, `[[../`, `[[./a/`) lists the folder
// the prefix names, read from the open note's folder. Driven through the menu's
// own `items`, with the paths the app hands it: absolute POSIX paths on macOS
// and Linux, and on Windows the backslash paths Rust lists (`list_dir`) mixed
// with the `/` the frontend joins onto them (`getHierarchicalJournalPath`).
import type { FileEntry } from "../../ipc/types";
import type { WikilinkSuggestionItem } from "../plugins/wikilink-suggest-utils";

import { beforeEach, describe, expect, it, vi } from "vitest";

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

import { useEditorStore } from "../../stores/editor/editor";
import { useFileStore } from "../../stores/file/file";
import { useZettelIndexStore } from "../../stores/zettelkasten/zettel-index";
import { WikilinkSuggest } from "../plugins/wikilink-suggest";

function menuItems(): MenuItems {
  WikilinkSuggest.config.addProseMirrorPlugins!.call({ editor: {} } as never);
  return captured.items!;
}

/** A file the tree lists, its name read the way `sep` spells the path. */
function file(path: string, sep: "/" | "\\" = "/"): FileEntry {
  return {
    isDir: false,
    modifiedAt: 0,
    name: path.slice(path.lastIndexOf(sep) + 1),
    path,
    size: 0,
  };
}

async function labels(query: string): Promise<string[]> {
  return (await menuItems()({ query })).map((r) => r.label);
}

/** The vault at `rootPath` listing `files`, with `openPath` the active tab. */
function open(rootPath: string, files: FileEntry[], openPath: string): void {
  useFileStore.setState({ fileTree: files, rootPath });
  useEditorStore.setState({
    activeTabId: "t1",
    tabs: [
      {
        contextId: "c1",
        filePath: openPath,
        id: "t1",
        isDirty: false,
        isPinned: false,
        title: "note",
      },
    ],
  } as never);
}

beforeEach(() => useZettelIndexStore.getState().clear());

describe("§61 relative mode on a POSIX vault", () => {
  const ROOT = "/Users/me/vault";

  beforeEach(() =>
    open(
      ROOT,
      [
        file(`${ROOT}/index.md`),
        file(`${ROOT}/notes/note.md`),
        file(`${ROOT}/notes/plan.md`),
        file(`${ROOT}/notes/ai/prompt.md`),
        file(`${ROOT}/other/far.md`),
      ],
      `${ROOT}/notes/note.md`,
    ),
  );

  it("./ lists the open note's folder", async () => {
    // What fails this: the folder resolved from the open note's path losing
    // its leading `/` (`Users/me/vault/notes`), which no listed file's folder
    // equals — the menu said "No matching pages" for every `[[./`.
    expect(await labels("./")).toEqual(["./note", "./plan"]);
  });

  it("../ lists the parent folder", async () => {
    expect(await labels("../")).toEqual(["../index"]);
  });

  it("./ai/ lists a folder inside the open note's folder", async () => {
    expect(await labels("./ai/")).toEqual(["./ai/prompt"]);
  });

  it("../other/ lists a sibling folder", async () => {
    expect(await labels("../other/")).toEqual(["../other/far"]);
  });

  it("the text after the last / filters the folder's rows", async () => {
    expect(await labels("./pl")).toEqual(["./plan"]);
  });

  it("inserts the prefixed name, the link a click resolves", async () => {
    const [row] = await menuItems()({ query: "./ai/pr" });
    expect(row.target).toBe("./ai/prompt");
    expect(row.path).toBe(`${ROOT}/notes/ai/prompt.md`);
  });

  it("a backslash in a POSIX name is a character, not a separator", async () => {
    // What fails this: reading `\` as a separator on every platform, as
    // `toPosixPath` does — `a\b.md` would sit in a folder `notes/a` and be
    // listed for `./a/` (issue 595 for the same rule elsewhere).
    open(
      ROOT,
      [file(`${ROOT}/notes/note.md`), file(`${ROOT}/notes/a\\b.md`)],
      `${ROOT}/notes/note.md`,
    );
    expect(await labels("./")).toEqual(["./note", "./a\\b"]);
    expect(await labels("./a/")).toEqual([]);
  });
});

describe("§61 relative mode on a Windows vault", () => {
  const ROOT = "C:\\Users\\me\\vault";
  const files = () => [
    file(`${ROOT}\\index.md`, "\\"),
    file(`${ROOT}\\notes\\note.md`, "\\"),
    file(`${ROOT}\\notes\\plan.md`, "\\"),
    file(`${ROOT}\\notes\\ai\\prompt.md`, "\\"),
  ];

  it("./ lists the open note's folder from a path Rust listed", async () => {
    // What fails this: splitting the open note's path and the listed paths
    // on `/` alone — Rust lists `C:\…\notes\plan.md`, which has no `/`.
    open(ROOT, files(), `${ROOT}\\notes\\note.md`);
    expect(await labels("./")).toEqual(["./note", "./plan"]);
    expect(await labels("../")).toEqual(["../index"]);
    expect(await labels("./ai/")).toEqual(["./ai/prompt"]);
  });

  it("./ lists the open note's folder from a path the frontend joined", async () => {
    // What fails this: reading one separator per path. Today's journal entry
    // opens at `${journalDir}/daily/…` (`getHierarchicalJournalPath`), and on
    // Windows `journalDir` is a `C:\…` setting, so a path can carry both.
    open(ROOT, files(), `${ROOT}/notes/note.md`);
    expect(await labels("./")).toEqual(["./note", "./plan"]);
    expect(await labels("../")).toEqual(["../index"]);
  });

  it("a UNC vault reads \\ as a separator too", async () => {
    // What fails this: taking only a drive letter as the mark of a Windows
    // path — `\\server\share` has none.
    const UNC = "\\\\server\\share\\vault";
    open(
      UNC,
      [
        file(`${UNC}\\notes\\note.md`, "\\"),
        file(`${UNC}\\notes\\plan.md`, "\\"),
        file(`${UNC}\\index.md`, "\\"),
      ],
      `${UNC}\\notes\\note.md`,
    );
    expect(await labels("./")).toEqual(["./note", "./plan"]);
    expect(await labels("../")).toEqual(["../index"]);
  });
});

describe("§61 · §390 relative mode over names stored decomposed (NFD)", () => {
  const ROOT = "/Users/me/vault";
  const PROJECT = "프로젝트";
  const PROJECT_NFD = PROJECT.normalize("NFD");
  const MEETING = "회의록";
  const MEETING_NFD = MEETING.normalize("NFD");

  it("the spellings differ", () => {
    expect(PROJECT_NFD).not.toBe(PROJECT);
    expect(MEETING_NFD).not.toBe(MEETING);
  });

  it("./ in a folder stored decomposed lists its notes composed", async () => {
    open(
      ROOT,
      [
        file(`${ROOT}/${PROJECT_NFD}/${MEETING_NFD}.md`),
        file(`${ROOT}/${PROJECT_NFD}/plan.md`),
      ],
      `${ROOT}/${PROJECT_NFD}/plan.md`,
    );
    expect(await labels("./")).toEqual([`./${MEETING}`, "./plan"]);
  });

  it("a folder typed composed finds the folder stored decomposed", async () => {
    // What fails this: comparing the folder typed with the folder stored byte
    // for byte — `../프로젝트/` is typed composed (NFC).
    open(
      ROOT,
      [
        file(`${ROOT}/${PROJECT_NFD}/${MEETING_NFD}.md`),
        file(`${ROOT}/notes/note.md`),
      ],
      `${ROOT}/notes/note.md`,
    );
    expect(await labels(`../${PROJECT}/`)).toEqual([
      `../${PROJECT}/${MEETING}`,
    ]);
  });
});
