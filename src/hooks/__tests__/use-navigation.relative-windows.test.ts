// A click in a note of a Windows vault opens what it names, read from the
// note's folder: a relative wikilink (§61), a markdown link (§278.1) and a
// path in a Skills file (§72) — through the real resolvers, not mocks of
// them. Rust lists `C:\…\notes\note.md`; a folder cut at the last `/` alone is
// empty there.
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
const LISTED = [
  "notes/note.md",
  "notes/plan.md",
  "notes/Paper.pdf",
  "other/far.md",
  "skills/SKILL.md",
  "skills/agents/executor.md",
];

/** What a Cmd+click on a path in a Skills file sends (`prompt-highlight.ts`). */
function clickSkillsPath(path: string): void {
  window.dispatchEvent(
    new CustomEvent("baram:open-filepath", { detail: { path } }),
  );
}

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

function renderNav() {
  const handleOpenFilePath = vi.fn().mockResolvedValue(undefined);
  const { result } = renderHook(() =>
    useNavigation({ editor: null as unknown as Editor, handleOpenFilePath }),
  );
  return { handleOpenFilePath, result };
}

/** The vault at `root`, `rels` listed with `sep`, `open` the active tab. */
function seed(root: string, sep: "/" | "\\", rels: string[], open: string) {
  const top: FileEntry[] = [];
  const folders = new Map<string, FileEntry[]>([[root, top]]);
  for (const rel of rels) {
    const parts = rel.split("/");
    let dir = root;
    for (const part of parts.slice(0, -1)) {
      const next = `${dir}${sep}${part}`;
      if (!folders.has(next)) {
        const children: FileEntry[] = [];
        folders.get(dir)!.push(entry(next, part, children));
        folders.set(next, children);
      }
      dir = next;
    }
    const name = parts[parts.length - 1];
    folders.get(dir)!.push(entry(`${dir}${sep}${name}`, name));
  }
  const vault = {
    addedAt: 0,
    color: "#000",
    contextType: "vault",
    id: "ctx-v",
    label: "vault",
    path: root,
    vaultType: "general",
  } as ContextInfo;
  useContextStore.setState({ activeContextId: vault.id, contexts: [vault] });
  useFileStore.setState({ fileTree: top, rootPath: root });
  useEditorStore.setState({
    activeTabId: "t1",
    tabs: [
      {
        contextId: vault.id,
        filePath: `${root}${sep}${open.split("/").join(sep)}`,
        id: "t1",
        isDirty: false,
        isPinned: false,
        title: "note",
      },
    ],
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("§61 clicking [[./plan]] in a note Rust listed", () => {
  it("opens the note beside it and creates nothing", async () => {
    // What fails this: the resolver taking the open note's folder at its last
    // `/` — the click then asked `createFile` for `C:\…\vault/./plan.md`.
    seed(ROOT, "\\", LISTED, "notes/note.md");
    const { handleOpenFilePath, result } = renderNav();

    result.current.handleWikilinkNavigate("./plan");

    await waitFor(() =>
      expect(handleOpenFilePath).toHaveBeenCalledWith(
        `${ROOT}\\notes\\plan.md`,
      ),
    );
    expect(createFile).not.toHaveBeenCalled();
  });
});

describe("§278.1 clicking a markdown link in a note Rust listed", () => {
  beforeEach(() => seed(ROOT, "\\", LISTED, "notes/note.md"));

  it("opens a file beside the note in the app", () => {
    // What fails this: the note's folder taken with `dirname`, which reads
    // `/` alone — empty here, so the link had no candidate, was not claimed,
    // and went to the OS opener.
    const { handleOpenFilePath, result } = renderNav();
    expect(result.current.handleLocalLinkNavigate("Paper.pdf")).toBe(true);
    expect(handleOpenFilePath).toHaveBeenCalledWith(
      `${ROOT}\\notes\\Paper.pdf`,
    );
  });

  it("opens a note reached through ../, as Rust listed it", () => {
    // What fails this: comparing the joined path with the listed one as
    // written — `C:\…\notes/../other/far.md` is not `C:\…\other\far.md`.
    const { handleOpenFilePath, result } = renderNav();
    expect(result.current.handleLocalLinkNavigate("../other/far.md")).toBe(
      true,
    );
    expect(handleOpenFilePath).toHaveBeenCalledWith(`${ROOT}\\other\\far.md`);
  });

  it("opens from a tab path the frontend joined with /", () => {
    // What fails this: a folder cut at the last `\\` alone — the tab
    // `C:\…\vault/notes/note.md` would read as the folder `C:\…\vault`.
    useEditorStore.setState({
      tabs: [
        {
          ...useEditorStore.getState().tabs[0],
          filePath: `${ROOT}/notes/note.md`,
        },
      ],
    });
    const { handleOpenFilePath, result } = renderNav();
    result.current.handleLocalLinkNavigate("Paper.pdf");
    expect(handleOpenFilePath).toHaveBeenCalledWith(
      `${ROOT}\\notes\\Paper.pdf`,
    );
  });

  it("still tries a markdown file the tree does not list, spelled as Rust lists", () => {
    // What fails this: the fallback joined onto an empty folder, or left as
    // joined (`C:\…\notes/gone.md`) — not the spelling an open tab carries.
    const { handleOpenFilePath, result } = renderNav();
    expect(result.current.handleLocalLinkNavigate("gone.md")).toBe(true);
    expect(handleOpenFilePath).toHaveBeenCalledWith(`${ROOT}\\notes\\gone.md`);
  });

  it("resolves ../ in an unlisted file's path, keeping the drive", () => {
    // What fails this: leaving `..` in the path — Rust refuses any path with a
    // `..` segment before it reads (`validate_path`) — or tidying with
    // `normalizePath`, which splits on `/` alone: `../` deletes all of
    // `C:\…\notes` and leaves `gone.md`.
    const { handleOpenFilePath, result } = renderNav();
    result.current.handleLocalLinkNavigate("../gone.md");
    expect(handleOpenFilePath).toHaveBeenCalledWith(`${ROOT}\\gone.md`);
  });

  it("opens ../ from a standalone file, which has no tree", () => {
    // A file opened on its own lists no tree, so every markdown link takes
    // the fallback. What fails this: the same `..` left in the path — the
    // click then asked to approve the file and the read was refused.
    useFileStore.setState({ fileTree: [], rootPath: null });
    useEditorStore.setState({
      tabs: [
        {
          ...useEditorStore.getState().tabs[0],
          filePath: "C:\\docs\\sub\\a.md",
        },
      ],
    });
    const { handleOpenFilePath, result } = renderNav();
    result.current.handleLocalLinkNavigate("../b.md");
    expect(handleOpenFilePath).toHaveBeenCalledWith("C:\\docs\\b.md");
  });
});

describe("§72 Cmd+clicking a path in a Skills file", () => {
  it("opens the file the path names, spelled as Rust lists it", () => {
    // What fails this: the file's folder cut at its last `/` — empty here, so
    // the click opened `/agents/executor.md`.
    seed(ROOT, "\\", LISTED, "skills/SKILL.md");
    const { handleOpenFilePath } = renderNav();
    clickSkillsPath("agents/executor.md");
    expect(handleOpenFilePath).toHaveBeenCalledWith(
      `${ROOT}\\skills\\agents\\executor.md`,
    );
    clickSkillsPath("./agents/executor.md");
    expect(handleOpenFilePath).toHaveBeenLastCalledWith(
      `${ROOT}\\skills\\agents\\executor.md`,
    );
  });

  it("opens a path the tree does not list beside the file, resolved", () => {
    // What fails this: the folder cut at its last `/` (the click opened
    // `/agents/missing.md`), or the join left as written with its `..`.
    seed(ROOT, "\\", LISTED, "skills/SKILL.md");
    const { handleOpenFilePath } = renderNav();
    clickSkillsPath("agents/missing.md");
    expect(handleOpenFilePath).toHaveBeenLastCalledWith(
      `${ROOT}\\skills\\agents\\missing.md`,
    );
    clickSkillsPath("../other/none.md");
    expect(handleOpenFilePath).toHaveBeenLastCalledWith(
      `${ROOT}\\other\\none.md`,
    );
  });

  it("and on POSIX, the join resolved", () => {
    // The pin for the two above. The join opens resolved, so a `./` path
    // finds the tab already open — before, it opened
    // `/v/skills/./agents/executor.md` — and `../other/none.md` opens
    // `/v/other/none.md` where it opened `/v/skills/../other/none.md`, which
    // Rust refuses.
    seed("/v", "/", LISTED, "skills/SKILL.md");
    const { handleOpenFilePath } = renderNav();
    clickSkillsPath("./agents/executor.md");
    expect(handleOpenFilePath).toHaveBeenLastCalledWith(
      "/v/skills/agents/executor.md",
    );
    clickSkillsPath("agents/missing.md");
    expect(handleOpenFilePath).toHaveBeenLastCalledWith(
      "/v/skills/agents/missing.md",
    );
    clickSkillsPath("../other/none.md");
    expect(handleOpenFilePath).toHaveBeenLastCalledWith("/v/other/none.md");
  });
});
