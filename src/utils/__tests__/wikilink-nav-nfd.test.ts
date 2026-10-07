// §390 spec 0069 §3.3 — wikilink resolution finds a note whose name the disk
// stores decomposed (NFD) from the composed (NFC) text a keyboard types.
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

import { useEditorStore } from "../../stores/editor/editor";
import { useFileStore } from "../../stores/file/file";
import { useSettingsStore } from "../../stores/settings/store";
import {
  findAliasContext,
  findNoteByStem,
  resolveWikilinkTarget,
} from "../editor/wikilink-nav";

// A name as a keyboard types it (composed, NFC) and as some macOS tools store
// it (decomposed, NFD).
const MEETING = "회의록";
const MEETING_NFD = MEETING.normalize("NFD");
const PROJECT = "프로젝트";
const PROJECT_NFD = PROJECT.normalize("NFD");
const DIARY = "일기";
const DIARY_NFD = DIARY.normalize("NFD");

function folder(path: string, children: FileEntry[]): FileEntry {
  return {
    children,
    isDir: true,
    name: path.slice(path.lastIndexOf("/") + 1),
    path,
  } as FileEntry;
}

function journalAt(journalDirectory: string): void {
  scope.active = { contextType: "vault", path: "/v", vaultType: "journal" };
  settings(journalDirectory);
}

function leaf(path: string): FileEntry {
  return {
    isDir: false,
    name: path.slice(path.lastIndexOf("/") + 1),
    path,
  } as FileEntry;
}

function openTab(filePath: string): void {
  vi.mocked(useEditorStore.getState).mockReturnValue({
    activeTabId: "t",
    tabs: [{ filePath, id: "t" }],
  } as unknown as ReturnType<typeof useEditorStore.getState>);
}

function settings(journalDirectory: string): void {
  vi.mocked(useSettingsStore.getState).mockReturnValue({
    journalDirectory,
    journalUseHierarchy: true,
  } as unknown as ReturnType<typeof useSettingsStore.getState>);
}

function useTree(fileTree: FileEntry[]): void {
  vi.mocked(useFileStore.getState).mockReturnValue({
    fileTree,
    rootPath: "/v",
  } as unknown as ReturnType<typeof useFileStore.getState>);
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

beforeEach(() => {
  scope.active = null;
  scope.contexts = [];
  settings("");
});

it("the two spellings differ", () => {
  // Without this, every test below could pass on two equal strings.
  expect(MEETING_NFD).not.toBe(MEETING);
  expect(PROJECT_NFD).not.toBe(PROJECT);
  expect(DIARY_NFD).not.toBe(DIARY);
});

describe("§390 a note stored decomposed answers to its name typed composed", () => {
  it("by name, and a longer name is still not it", () => {
    // What fails this: the standard loop's stem comparison left at toLowerCase.
    useTree([leaf(`/v/${MEETING_NFD}.md`)]);
    expect(resolveWikilinkTarget(MEETING)?.path).toBe(`/v/${MEETING_NFD}.md`);
    expect(resolveWikilinkTarget(`${MEETING} 2`)).toBeNull();
  });

  it("by a path from the vault root", () => {
    // What fails this: the path-qualified comparison (`relStem`) left at toLowerCase.
    useTree([
      folder(`/v/${PROJECT_NFD}`, [
        leaf(`/v/${PROJECT_NFD}/${MEETING_NFD}.md`),
      ]),
    ]);
    expect(resolveWikilinkTarget(`${PROJECT}/${MEETING}`)?.path).toBe(
      `/v/${PROJECT_NFD}/${MEETING_NFD}.md`,
    );
  });

  it("by a path relative to the open note", () => {
    // What fails this: the relative comparison left at toLowerCase. The
    // candidate joins the open note's folder as stored (NFD) with the name as
    // typed (NFC), so neither spelling matches the tree byte for byte.
    useTree([
      folder(`/v/${PROJECT_NFD}`, [
        leaf(`/v/${PROJECT_NFD}/index.md`),
        leaf(`/v/${PROJECT_NFD}/${MEETING_NFD}.md`),
      ]),
    ]);
    openTab(`/v/${PROJECT_NFD}/index.md`);
    expect(resolveWikilinkTarget(`./${MEETING}`)?.path).toBe(
      `/v/${PROJECT_NFD}/${MEETING_NFD}.md`,
    );
  });

  it("by its file name with an extension", () => {
    // What fails this: resolveByExactFileName left at toLowerCase.
    useTree([leaf(`/v/${MEETING_NFD}.pdf`)]);
    expect(resolveWikilinkTarget(`${MEETING}.pdf`)?.path).toBe(
      `/v/${MEETING_NFD}.pdf`,
    );
  });

  it("by a folder and a file name with an extension", () => {
    // What fails this: resolveByExactFileName's comparison of the relative
    // path left at toLowerCase — the name alone is no match for a target that
    // carries its folder.
    useTree([
      folder(`/v/${PROJECT_NFD}`, [
        leaf(`/v/${PROJECT_NFD}/${MEETING_NFD}.pdf`),
      ]),
    ]);
    expect(resolveWikilinkTarget(`${PROJECT}/${MEETING}.pdf`)?.path).toBe(
      `/v/${PROJECT_NFD}/${MEETING_NFD}.pdf`,
    );
  });

  it("from a standalone file's folder", () => {
    // What fails this: resolveInSameFolder's comparison left at toLowerCase —
    // the fallback then builds `${dir}/${target}.md` from the name as typed,
    // which is not the path the tree holds.
    scope.active = { contextType: "file", path: `/v/${PROJECT_NFD}/a.md` };
    useTree([
      folder(`/v/${PROJECT_NFD}`, [
        leaf(`/v/${PROJECT_NFD}/a.md`),
        leaf(`/v/${PROJECT_NFD}/${MEETING_NFD}.md`),
      ]),
    ]);
    expect(resolveWikilinkTarget(MEETING)?.path).toBe(
      `/v/${PROJECT_NFD}/${MEETING_NFD}.md`,
    );
  });
});

describe("§390 the journal's folder, set in the settings as typed", () => {
  it("finds a note in notes/ before the same name elsewhere", () => {
    // What fails this: the notes/ folder compared byte for byte — the
    // settings spell it composed, the disk decomposed, so notes/ is skipped
    // and the standard loop answers with the same name listed first.
    journalAt(`/v/${DIARY}`);
    useTree([
      folder("/v/archive", [leaf(`/v/archive/${MEETING}.md`)]),
      folder(`/v/${DIARY_NFD}`, [
        folder(`/v/${DIARY_NFD}/notes`, [
          leaf(`/v/${DIARY_NFD}/notes/${MEETING_NFD}.md`),
        ]),
      ]),
    ]);
    expect(resolveWikilinkTarget(MEETING)?.path).toBe(
      `/v/${DIARY_NFD}/notes/${MEETING_NFD}.md`,
    );
  });

  it("finds a note by name from a folder under notes/", () => {
    // What fails this: the stem comparison in the notes/ loop left at
    // toLowerCase. The note sits in a folder, so the folder/name comparison
    // beside it cannot match a bare name and only the stem comparison can; when
    // that misses, the standard loop answers with the same name listed first.
    journalAt(`/v/${DIARY}`);
    useTree([
      folder("/v/archive", [leaf(`/v/archive/${MEETING}.md`)]),
      folder(`/v/${DIARY_NFD}`, [
        folder(`/v/${DIARY_NFD}/notes`, [
          folder(`/v/${DIARY_NFD}/notes/${PROJECT_NFD}`, [
            leaf(`/v/${DIARY_NFD}/notes/${PROJECT_NFD}/${MEETING_NFD}.md`),
          ]),
        ]),
      ]),
    ]);
    expect(resolveWikilinkTarget(MEETING)?.path).toBe(
      `/v/${DIARY_NFD}/notes/${PROJECT_NFD}/${MEETING_NFD}.md`,
    );
  });

  it("finds folder/name under notes/", () => {
    // What fails this: the folder/name cut from the stored path at the length
    // of the composed folder — the decomposed path is longer, so the cut
    // lands inside the folder name and never matches.
    journalAt(`/v/${DIARY}`);
    useTree([
      folder(`/v/${DIARY_NFD}`, [
        folder(`/v/${DIARY_NFD}/notes`, [
          folder(`/v/${DIARY_NFD}/notes/${PROJECT_NFD}`, [
            leaf(`/v/${DIARY_NFD}/notes/${PROJECT_NFD}/${MEETING_NFD}.md`),
          ]),
        ]),
      ]),
    ]);
    expect(resolveWikilinkTarget(`${PROJECT}/${MEETING}`)?.path).toBe(
      `/v/${DIARY_NFD}/notes/${PROJECT_NFD}/${MEETING_NFD}.md`,
    );
  });

  it("finds a date note before the same name elsewhere", () => {
    // What fails this: the daily path compared byte for byte.
    journalAt(`/v/${DIARY}`);
    useTree([
      folder("/v/archive", [leaf("/v/archive/2026-10-06.md")]),
      folder(`/v/${DIARY_NFD}`, [
        folder(`/v/${DIARY_NFD}/daily`, [
          folder(`/v/${DIARY_NFD}/daily/2026`, [
            folder(`/v/${DIARY_NFD}/daily/2026/10`, [
              leaf(`/v/${DIARY_NFD}/daily/2026/10/2026-10-06.md`),
            ]),
          ]),
        ]),
      ]),
    ]);
    expect(resolveWikilinkTarget("2026-10-06")?.path).toBe(
      `/v/${DIARY_NFD}/daily/2026/10/2026-10-06.md`,
    );
  });

  it("does not take a folder of another case for it", () => {
    // These paths compare composed, case as written: on a disk that keeps
    // case, `Diary` and `diary` are two folders. The partner of the notes/
    // test above, on the same shape of tree.
    // What fails this: the notes/ folder and the stored path both folded
    // under foldName — `diary/notes` then counts as the journal's notes/ and
    // answers before the standard loop reaches `archive`.
    journalAt("/v/Diary");
    useTree([
      folder("/v/archive", [leaf("/v/archive/plan.md")]),
      folder("/v/diary", [
        folder("/v/diary/notes", [leaf("/v/diary/notes/plan.md")]),
      ]),
    ]);
    expect(resolveWikilinkTarget("plan")?.path).toBe("/v/archive/plan.md");
  });

  it("does not take a date note in a folder of another case for it", () => {
    // The partner of the date-note test above, on the same shape of tree: the
    // daily path compares composed, case as written, like the notes/ folder.
    // What fails this: the daily path and the stored path both folded under
    // foldName — `diary/daily/…` then counts as the journal's date note and
    // answers before the standard loop reaches `archive`.
    journalAt("/v/Diary");
    useTree([
      folder("/v/archive", [leaf("/v/archive/2026-10-06.md")]),
      folder("/v/diary", [
        folder("/v/diary/daily", [
          folder("/v/diary/daily/2026", [
            folder("/v/diary/daily/2026/10", [
              leaf("/v/diary/daily/2026/10/2026-10-06.md"),
            ]),
          ]),
        ]),
      ]),
    ]);
    expect(resolveWikilinkTarget("2026-10-06")?.path).toBe(
      "/v/archive/2026-10-06.md",
    );
  });
});

describe("§390 another vault, and its alias", () => {
  it("an alias that is a folder's name stored decomposed answers typed composed", () => {
    // What fails this: findAliasContext comparing aliases by toLowerCase.
    const project = vault(PROJECT_NFD, "/w");
    scope.contexts = [project];
    expect(findAliasContext(PROJECT)).toBe(project);
    expect(findAliasContext(`${PROJECT}2`)).toBeNull();
  });

  it("resolves by name in the alias's vault when it is the open one", () => {
    // What fails this: findNoteByStem comparing by toLowerCase. The note sits
    // in a folder, so the path comparison after the stem lookup cannot match a
    // bare name and the stem lookup is the only way to this note.
    scope.contexts = [vault("w", "/v")];
    useTree([
      folder(`/v/${PROJECT_NFD}`, [
        leaf(`/v/${PROJECT_NFD}/${MEETING_NFD}.md`),
      ]),
    ]);
    expect(resolveWikilinkTarget(MEETING, "w")?.path).toBe(
      `/v/${PROJECT_NFD}/${MEETING_NFD}.md`,
    );
  });

  it("and by a path in that vault", () => {
    // What fails this: resolveCrossVaultTarget's path comparison left at toLowerCase.
    scope.contexts = [vault("w", "/v")];
    useTree([
      folder(`/v/${PROJECT_NFD}`, [
        leaf(`/v/${PROJECT_NFD}/${MEETING_NFD}.md`),
      ]),
    ]);
    expect(resolveWikilinkTarget(`${PROJECT}/${MEETING}`, "w")?.path).toBe(
      `/v/${PROJECT_NFD}/${MEETING_NFD}.md`,
    );
  });
});

describe("§390 findNoteByStem", () => {
  it("matches a .md or .markdown stem under foldName, and nothing else", () => {
    // What fails this: comparing by toLowerCase — the stored names are
    // decomposed; and dropping the extension guard — `.js` is as long as `.md`,
    // so its stem would match too.
    const files = [
      { name: `${MEETING_NFD}.js` },
      { name: `${PROJECT_NFD}.markdown` },
      { name: `${MEETING_NFD}.md` },
    ];
    expect(findNoteByStem(files, MEETING)).toBe(files[2]);
    expect(findNoteByStem(files, PROJECT)).toBe(files[1]);
    expect(findNoteByStem(files, "없는 노트")).toBeNull();
  });
});
