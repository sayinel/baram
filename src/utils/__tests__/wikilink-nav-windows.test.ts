// §61 · §89 A relative wikilink (`[[./plan]]`, `[[../other/far]]`) opens the
// note it names from the open note's folder on Windows, as it does on macOS and
// Linux. Driven through `resolveWikilinkTarget`, the resolver a click calls
// (`use-navigation.ts`), with the paths the app holds on Windows: the backslash
// paths Rust lists (`list_dir`), the `/` the frontend joins onto them
// (`getHierarchicalJournalPath`), and UNC roots.
import type { ContextInfo } from "../../ipc/types";
import type { FileEntry } from "../../stores/file/file";

import { beforeEach, describe, expect, it, vi } from "vitest";

const scope = vi.hoisted(() => ({
  active: null as null | Partial<ContextInfo>,
}));

vi.mock("../../stores/context/context", () => ({
  useContextStore: {
    getState: () => ({ activeContext: () => scope.active, contexts: [] }),
    subscribe: vi.fn(),
  },
}));

vi.mock("../../stores/file/file", () => ({
  isActiveContextJournal: () => false,
  useFileStore: { getState: vi.fn() },
}));

vi.mock("../../stores/editor/editor", () => ({
  useEditorStore: { getState: vi.fn() },
}));

import { useEditorStore } from "../../stores/editor/editor";
import { useFileStore } from "../../stores/file/file";
import { resolveWikilinkTarget } from "../editor/wikilink-nav";

/** A folder Rust listed, its name read the way `sep` spells the path. */
function folder(
  path: string,
  children: FileEntry[],
  sep: "/" | "\\" = "\\",
): FileEntry {
  return {
    children,
    isDir: true,
    name: path.slice(path.lastIndexOf(sep) + 1),
    path,
  } as FileEntry;
}

/** A file Rust listed, its name read the way `sep` spells the path. */
function leaf(path: string, sep: "/" | "\\" = "\\"): FileEntry {
  return {
    isDir: false,
    name: path.slice(path.lastIndexOf(sep) + 1),
    path,
  } as FileEntry;
}

function openTab(filePath: string): void {
  vi.mocked(useEditorStore.getState).mockReturnValue({
    activeTabId: "t",
    tabs: [{ filePath, id: "t" }],
  } as unknown as ReturnType<typeof useEditorStore.getState>);
}

function useTree(rootPath: string, fileTree: FileEntry[]): void {
  vi.mocked(useFileStore.getState).mockReturnValue({
    fileTree,
    rootPath,
  } as unknown as ReturnType<typeof useFileStore.getState>);
}

/** The vault at `root`, listed by Rust with `\`. */
function windowsVault(root: string): FileEntry[] {
  return [
    leaf(`${root}\\index.md`),
    folder(`${root}\\notes`, [
      folder(`${root}\\notes\\ai`, [leaf(`${root}\\notes\\ai\\prompt.md`)]),
      leaf(`${root}\\notes\\note.md`),
      leaf(`${root}\\notes\\plan.md`),
    ]),
    folder(`${root}\\other`, [leaf(`${root}\\other\\far.md`)]),
  ];
}

beforeEach(() => {
  scope.active = null;
});

describe("§61 a relative link in a note of a Windows vault", () => {
  const ROOT = "C:\\Users\\me\\vault";

  beforeEach(() => useTree(ROOT, windowsVault(ROOT)));

  it("opens from a path Rust listed", () => {
    // What fails this: taking the open note's folder at its last `/` — Rust
    // lists `C:\…\notes\note.md`, which has none, so the folder came out
    // empty, `./plan` became `plan.md` and matched no file. The click then
    // went on to create a new note (`use-navigation.ts`).
    openTab(`${ROOT}\\notes\\note.md`);
    expect(resolveWikilinkTarget("./plan")).toEqual({
      name: "plan.md",
      path: `${ROOT}\\notes\\plan.md`,
    });
    expect(resolveWikilinkTarget("../index")?.path).toBe(`${ROOT}\\index.md`);
    expect(resolveWikilinkTarget("./ai/prompt")?.path).toBe(
      `${ROOT}\\notes\\ai\\prompt.md`,
    );
    expect(resolveWikilinkTarget("../other/far")?.path).toBe(
      `${ROOT}\\other\\far.md`,
    );
    // A `\` typed in the link separates too, as it does in the note's path.
    expect(resolveWikilinkTarget("./ai\\prompt")?.path).toBe(
      `${ROOT}\\notes\\ai\\prompt.md`,
    );
  });

  it("opens from a path the frontend joined with /", () => {
    // What fails this: reading one separator per path. Today's journal entry
    // opens at `${journalDir}/daily/…`, and on Windows `journalDir` is a
    // `C:\…` setting, so the open note's path can carry both. The path comes
    // back as Rust listed it: an open tab is found by its path string
    // (`openFileByPath`), and a `/` spelling would open the note twice.
    openTab(`${ROOT}/notes/note.md`);
    expect(resolveWikilinkTarget("./plan")?.path).toBe(
      `${ROOT}\\notes\\plan.md`,
    );
    expect(resolveWikilinkTarget("../other/far")?.path).toBe(
      `${ROOT}\\other\\far.md`,
    );
  });

  it("stays in the folder the link names", () => {
    // The partner of the cases above: they find the note by its folder, not
    // by matching any note of that name.
    openTab(`${ROOT}\\notes\\note.md`);
    expect(resolveWikilinkTarget("./index")).toBeNull();
    expect(resolveWikilinkTarget("./far")).toBeNull();
    expect(resolveWikilinkTarget("../plan")).toBeNull();
  });

  it("opens from a note on a UNC share", () => {
    // What fails this: taking only a drive letter as the mark of a Windows
    // path — `\\server\share` has none.
    const UNC = "\\\\server\\share\\vault";
    useTree(UNC, windowsVault(UNC));
    openTab(`${UNC}\\notes\\note.md`);
    expect(resolveWikilinkTarget("./plan")?.path).toBe(
      `${UNC}\\notes\\plan.md`,
    );
    expect(resolveWikilinkTarget("../index")?.path).toBe(`${UNC}\\index.md`);
    // What fails this: joining the link onto the folder's `slashPath` and
    // reading it again — on a UNC share that folder is `/server/share/…`,
    // which no longer reads as a Windows path, so the typed `\` stayed a
    // character while it separated on a drive letter.
    expect(resolveWikilinkTarget("./ai\\prompt")?.path).toBe(
      `${UNC}\\notes\\ai\\prompt.md`,
    );
  });
});

describe("§61 a relative link in a note of a POSIX vault", () => {
  it("reads a backslash as a character of a name, not a separator", () => {
    // What fails this: reading `\` as a separator on every platform, as
    // `toPosixPath` does — `./a\b` would then name `a/b.md`, listed first here
    // (issue 595 for the same rule elsewhere).
    useTree("/v", [
      folder(
        "/v/notes",
        [
          folder("/v/notes/a", [leaf("/v/notes/a/b.md", "/")], "/"),
          leaf("/v/notes/a\\b.md", "/"),
          leaf("/v/notes/note.md", "/"),
        ],
        "/",
      ),
    ]);
    openTab("/v/notes/note.md");
    expect(resolveWikilinkTarget("./a\\b")?.path).toBe("/v/notes/a\\b.md");
    expect(resolveWikilinkTarget("./a/b")?.path).toBe("/v/notes/a/b.md");
  });

  it("opens from a note at the root of the file system", () => {
    // What fails this: joining `${folder}/${target}` with the folder cut
    // before the last `/` — `/note.md` has an empty folder, and the leading
    // `/` the join made was stripped as not the note's own, giving `plan.md`.
    // The [[ menu already listed `/` for `./` there.
    useTree("/", [leaf("/note.md", "/"), leaf("/plan.md", "/")]);
    openTab("/note.md");
    expect(resolveWikilinkTarget("./plan")?.path).toBe("/plan.md");
  });
});

describe("§89 a link in a standalone file", () => {
  const DIR = "C:\\Users\\me\\Docs";

  it("finds the note beside a file Rust listed", () => {
    // What fails this: taking the file's folder at its last `/` — empty for
    // `C:\…\note.md` — so no listed note was beside it and the resolver built
    // `/plan.md`, a path on no drive. The note is listed as `Plan.md` so the
    // path built when the lookup finds nothing (`…\plan.md`) cannot pass for
    // it, and `sub\plan.md` is listed first so a lookup that ignores the
    // folder finds the wrong one.
    scope.active = { contextType: "file", path: `${DIR}\\note.md` };
    useTree(DIR, [
      folder(`${DIR}\\sub`, [leaf(`${DIR}\\sub\\plan.md`)]),
      leaf(`${DIR}\\note.md`),
      leaf(`${DIR}\\Plan.md`),
    ]);
    expect(resolveWikilinkTarget("plan")).toEqual({
      name: "Plan.md",
      path: `${DIR}\\Plan.md`,
    });
  });

  it("builds the path beside the file, its folder spelled as the file's is", () => {
    // No listed tree covers a standalone file's folder as a rule; the
    // resolver builds the candidate and the click opens it. A relative
    // target is not looked up or tidied here: the path keeps `./` on every
    // platform (the POSIX pin below) — a known gap, not a goal. A change
    // that tidies it changes both lines.
    scope.active = { contextType: "file", path: `${DIR}\\note.md` };
    useTree("", []);
    expect(resolveWikilinkTarget("plan")).toEqual({
      name: "plan.md",
      path: `${DIR}\\plan.md`,
    });
    expect(resolveWikilinkTarget("./plan")?.path).toBe(`${DIR}\\./plan.md`);
  });

  it("and on POSIX as before", () => {
    // The pin for the case above: macOS and Linux build the same shape — the
    // folder, then the target as written.
    scope.active = { contextType: "file", path: "/Users/me/Docs/note.md" };
    useTree("", []);
    expect(resolveWikilinkTarget("plan")?.path).toBe("/Users/me/Docs/plan.md");
    expect(resolveWikilinkTarget("./plan")?.path).toBe(
      "/Users/me/Docs/./plan.md",
    );
  });
});
