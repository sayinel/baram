// §87 · §56l Two branches of `resolveWikilinkTarget` read a path relative to a
// root: a path link to the open vault by its alias (`[[work::skills/analyzer]]`)
// and a link inside a journal (its `notes/` folder first, then a date's daily
// note). On Windows Rust lists `C:\…\notes\plan.md`, which a root joined with
// `/` (`${journalDir}/notes`) or a path cut and compared with `/` never meets.
import type { ContextInfo } from "../../ipc/types";
import type { FileEntry } from "../../stores/file/file";

import { beforeEach, describe, expect, it, vi } from "vitest";

const scope = vi.hoisted(() => ({
  active: null as null | Partial<ContextInfo>,
  contexts: [] as ContextInfo[],
}));

vi.mock("../../stores/context/context", () => ({
  useContextStore: {
    getState: () => ({
      activeContext: () => scope.active,
      contexts: scope.contexts,
    }),
    subscribe: vi.fn(),
  },
}));

vi.mock("../../stores/file/file", () => ({
  isActiveContextJournal: () => scope.active?.vaultType === "journal",
  useFileStore: { getState: vi.fn() },
}));

vi.mock("../../stores/editor/editor", () => ({
  useEditorStore: { getState: vi.fn() },
}));

vi.mock("../../stores/settings/store", () => ({
  useSettingsStore: { getState: vi.fn() },
}));

import { useFileStore } from "../../stores/file/file";
import { useSettingsStore } from "../../stores/settings/store";
import { resolveWikilinkTarget } from "../editor/wikilink-nav";

/** A tree Rust listed: `paths` under `root`, folders made as needed. */
function listed(root: string, paths: string[], sep: "/" | "\\"): FileEntry[] {
  const top: FileEntry[] = [];
  const folders = new Map<string, FileEntry[]>([[root, top]]);
  for (const rel of paths) {
    const parts = rel.split("/");
    let dir = root;
    for (const part of parts.slice(0, -1)) {
      const next = `${dir}${sep}${part}`;
      if (!folders.has(next)) {
        const children: FileEntry[] = [];
        folders.get(dir)!.push({
          children,
          isDir: true,
          name: part,
          path: next,
        } as FileEntry);
        folders.set(next, children);
      }
      dir = next;
    }
    const name = parts[parts.length - 1];
    folders
      .get(dir)!
      .push({ isDir: false, name, path: `${dir}${sep}${name}` } as FileEntry);
  }
  return top;
}

function vault(alias: string, path: string): ContextInfo {
  return {
    addedAt: 0,
    alias,
    color: "#000",
    contextType: "vault",
    id: path,
    label: alias,
    path,
  } as ContextInfo;
}

function withTree(rootPath: string, fileTree: FileEntry[]): void {
  vi.mocked(useFileStore.getState).mockReturnValue({
    fileTree,
    rootPath,
  } as unknown as ReturnType<typeof useFileStore.getState>);
}

beforeEach(() => {
  scope.active = null;
  scope.contexts = [];
  vi.mocked(useSettingsStore.getState).mockReturnValue({
    journalDirectory: "",
    journalUseHierarchy: true,
  } as unknown as ReturnType<typeof useSettingsStore.getState>);
});

describe("§87 a path link to the open vault by its alias", () => {
  it("finds the note on Windows, from the paths Rust lists", () => {
    // What fails this: cutting the path after the root and comparing it with
    // the link's `/` — Rust lists `skills\analyzer.md`.
    const ROOT = "C:\\Users\\me\\work";
    scope.contexts = [vault("work", ROOT)];
    withTree(ROOT, listed(ROOT, ["skills/analyzer.md"], "\\"));
    expect(resolveWikilinkTarget("skills/analyzer", "work")?.path).toBe(
      `${ROOT}\\skills\\analyzer.md`,
    );
  });

  it("on a UNC share", () => {
    // What fails this: cutting at the root's length as written — the root's
    // two leading `\` become one `/` when read, so the cut lands a
    // character late.
    const ROOT = "\\\\server\\share\\work";
    scope.contexts = [vault("work", ROOT)];
    withTree(ROOT, listed(ROOT, ["skills/analyzer.md"], "\\"));
    expect(resolveWikilinkTarget("skills/analyzer", "work")?.path).toBe(
      `${ROOT}\\skills\\analyzer.md`,
    );
  });

  it("on POSIX, a backslash in a name is a character", () => {
    // What fails this: reading `\` as a separator everywhere (the tree's
    // `relativePath` does) — `x/a\b.md` then reads `x/a/b`, which the link
    // `x/a\b` is not. The stem lookup cannot answer for the path link first.
    const ROOT = "/Users/me/work";
    scope.contexts = [vault("work", ROOT)];
    withTree(ROOT, listed(ROOT, ["x/a/b.md", "x/a\\b.md"], "/"));
    expect(resolveWikilinkTarget("x/a\\b", "work")?.path).toBe(
      `${ROOT}/x/a\\b.md`,
    );
  });
});

describe("§56l a link inside a journal", () => {
  function journalAt(dir: string, paths: string[], sep: "/" | "\\"): void {
    scope.active = { contextType: "vault", path: dir, vaultType: "journal" };
    vi.mocked(useSettingsStore.getState).mockReturnValue({
      journalDirectory: dir,
      journalUseHierarchy: true,
    } as unknown as ReturnType<typeof useSettingsStore.getState>);
    withTree(dir, listed(dir, paths, sep));
  }

  const J = "C:\\Users\\me\\journal";
  // `plan` and the date are listed first outside the place the journal looks,
  // so a miss there falls through to the stem match and returns the wrong
  // file. `sub/idea` has no such decoy; a miss returns nothing.
  const PATHS = [
    "archive/plan.md",
    "archive/2026-10-06.md",
    "notes/plan.md",
    "notes/sub/idea.md",
    "daily/2026/10/2026-10-06.md",
  ];

  it("takes a note from notes/ first, on Windows", () => {
    // What fails this: `${journalDir}/notes` compared with the start of a
    // path Rust listed with `\` — notes/ was never searched first.
    journalAt(J, PATHS, "\\");
    expect(resolveWikilinkTarget("plan")?.path).toBe(`${J}\\notes\\plan.md`);
  });

  it("reads folder/name under notes/, on Windows", () => {
    journalAt(J, PATHS, "\\");
    expect(resolveWikilinkTarget("sub/idea")?.path).toBe(
      `${J}\\notes\\sub\\idea.md`,
    );
  });

  it("opens a date's daily note, on Windows", () => {
    // What fails this: the daily path joined with `/` compared for equality
    // with the listed `\` path.
    journalAt(J, PATHS, "\\");
    expect(resolveWikilinkTarget("2026-10-06")?.path).toBe(
      `${J}\\daily\\2026\\10\\2026-10-06.md`,
    );
  });

  it("and on POSIX", () => {
    // The pin for the three above.
    const P = "/Users/me/journal";
    journalAt(P, PATHS, "/");
    expect(resolveWikilinkTarget("plan")?.path).toBe(`${P}/notes/plan.md`);
    expect(resolveWikilinkTarget("sub/idea")?.path).toBe(
      `${P}/notes/sub/idea.md`,
    );
    expect(resolveWikilinkTarget("2026-10-06")?.path).toBe(
      `${P}/daily/2026/10/2026-10-06.md`,
    );
  });

  it("does not read a sibling that starts with notes as notes/", () => {
    // What fails this: comparing the start of the path without the boundary
    // after `notes` — `notes-old/plan.md`, listed first, passed for notes/.
    const P = "/Users/me/journal";
    journalAt(P, ["notes-old/plan.md", "notes/plan.md"], "/");
    expect(resolveWikilinkTarget("plan")?.path).toBe(`${P}/notes/plan.md`);
  });
});
