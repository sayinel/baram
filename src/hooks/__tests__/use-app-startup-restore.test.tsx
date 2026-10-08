// §81 The launch restore chooses ONE context: the vault tab (`activeContextId`), the
// file tree and the active tab agree when it settles.
//
// Three defects shared a shape — something after the restore moved one of the three
// and not the others:
//  - the space startups activated their context locally (`_setActiveContextLocal`),
//    so the vault tab said Zettel while the tree still showed the folder;
//  - `onLaunch` was read only when no context existed, so its three values behaved
//    alike whenever one did;
//  - today's journal was opened from a React effect outside the startup order and
//    took the active tab whenever it happened to land.
//
// The stores, the loader (`openFolder`/`switchContext`), the spaces, the recorder and
// `openFileByPath` are the real ones; only the IPC answers are faked, by a small
// in-memory backend below. Asserting on the tree (`fileTree`), not on `rootPath`, is
// deliberate: the subscription in `stores/file/file.ts` copies a seat that moves to a
// vault or folder context into `rootPath` without loading a tree, so `rootPath`
// agrees with a seat that moved alone — the very state defect 1 is.
import { invoke } from "@tauri-apps/api/core";

import type { ContextInfo } from "../../ipc/types";

import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getJournalFilePath } from "../../utils/journal/journal";

type OnLaunch = "newFile" | "restoreLastFile" | "restoreLastFolder";

const ZK = "/zk";
const JOURNAL = "/journal";
const WORK = "/work";
const OTHER = "/other";
const HOME = `${ZK}/home.md`;
const NOTE = `${WORK}/note.md`;
const SECOND = `${WORK}/second.md`;
const FAR = `${OTHER}/far.md`;
const EXTERNAL = "/ext/outside.md";
/** The maintainer's measured `lastOpenedFile`: a journal entry a week old. */
const OLD_ENTRY = `${JOURNAL}/2026-09-23.md`;
const FORMAT = "YYYY-MM-DD.md";
const TREE_MARKER = "tree-marker.md";

function ctx(
  id: string,
  path: string,
  contextType: ContextInfo["contextType"],
  vaultType?: ContextInfo["vaultType"],
): ContextInfo {
  return {
    addedAt: 0,
    color: "#fff",
    contextType,
    id,
    label: id,
    path,
    vaultType,
  };
}

/** The persisted contexts: both spaces and two folders, the shape of the maintainer's five. */
const CONTEXTS = [
  ctx("z", ZK, "vault", "zettelkasten"),
  ctx("j", JOURNAL, "vault", "journal"),
  ctx("f", WORK, "folder"),
  ctx("g", OTHER, "folder"),
];

/** The fake backend's state, which `route` answers from. */
const backend = {
  /** Paths whose registration fails, with Rust's error code. */
  addRefused: new Map<string, string>(),
  approved: new Set<string>(),
  calls: [] as string[],
  /** Paths whose approval dialog the user declines (§333). */
  declined: new Set<string>(),
  files: new Map<string, string>(),
  /** Paths whose recursive listing (the tree load) fails. */
  listFails: new Set<string>(),
  /** Every command with the path it named, in order. */
  log: [] as string[],
  /** What `get_opened_urls` answers: the files the OS queued for the launch. */
  queued: [] as string[],
  /** What Rust's ContextManager holds: registered roots and FileContext paths. */
  registered: new Set<string>(),
  /** Paths `set_vault_root` refuses, with Rust's error code. */
  rootRefused: new Map<string, string>(),
};

interface Scenario {
  /** Persisted `activeContextId`. Default: the folder `f`. */
  active?: string;
  /** Mount `useJournal` too, before `useAppStartup`, in App's order. */
  appJournal?: boolean;
  /** Paths whose approval dialog the user declines. */
  declined?: string[];
  /** Contexts persisted besides `CONTEXTS`. */
  extraContexts?: ContextInfo[];
  /** Zettel home note setting. Default: `home.md` in the Zettel directory. */
  homeNote?: string;
  /** Journal "Open today's journal". */
  journal?: boolean;
  lastOpenedFile?: null | string;
  onLaunch: OnLaunch;
  /** Context paths NOT approved this session (skipped at launch, §334). */
  unapproved?: string[];
  /** Zettel "Open the home note". */
  zettel?: boolean;
}

/**
 * Rust's approval gate (§333): an approved path passes; any other raises the
 * dialog, which the user declines for `declined` paths and accepts otherwise.
 */
function approve(path: string): void {
  if (backend.approved.has(path)) return;
  if (backend.declined.has(path)) throw "VAULT_APPROVAL_DENIED";
  backend.approved.add(path);
}

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
}

function pathOf(args: Record<string, unknown>): string {
  const info = args.info as undefined | { path: string };
  return (args.path as string | undefined) ?? info?.path ?? "";
}

/** `check_vault`: a path inside no registered context is refused. */
function readable(path: string): boolean {
  return [...backend.registered].some(
    (root) => path === root || path.startsWith(`${root}/`),
  );
}

/**
 * What Rust would answer to the commands the restore sends. Any other command
 * answers `undefined`, as the global stub in `test-setup.ts` does.
 */
function route(command: string, args: Record<string, unknown> = {}): unknown {
  const path = pathOf(args);
  backend.calls.push(command);
  backend.log.push(`${command} ${path}`);
  switch (command) {
    case "add_context": {
      const refused = backend.addRefused.get(path);
      if (refused) throw refused;
      approve(path);
      backend.registered.add(path);
      return args.info;
    }
    case "get_config":
      return null;
    case "get_contexts":
      // `switchContext` registers (and so asks) only what Rust does not hold.
      return [...backend.registered].map((registered) => ({
        path: registered,
      }));
    case "get_opened_urls":
      return backend.queued;
    case "get_vault_config_by_path":
      throw "no .baram/config.json";
    case "is_path_approved":
      return backend.approved.has(path);
    case "list_dir":
      // A tree load is the recursive listing; one marker entry names the folder
      // it came from, so a test can tell which tree is on screen.
      if (!args.recursive) return [];
      if (backend.listFails.has(path)) throw `I/O error listing ${path}`;
      return [
        {
          isDir: false,
          modifiedAt: 0,
          name: TREE_MARKER,
          path: `${path}/${TREE_MARKER}`,
          size: 0,
        },
      ];
    case "read_file": {
      if (!readable(path)) throw `Access denied: ${path}`;
      const content = backend.files.get(path);
      // `FsError::NotFound`'s Display, word for word: the journal service creates an
      // entry only on THIS rejection and raises any other read failure rather than
      // write a template over a file it could not read (`isFileNotFoundError`).
      if (content === undefined) throw `파일을 찾을 수 없습니다: ${path}`;
      return content;
    }
    case "set_vault_root": {
      const refused = backend.rootRefused.get(path);
      if (refused) throw refused;
      // An unregistered root is registered — after the approval gate.
      if (!backend.registered.has(path)) {
        approve(path);
        backend.registered.add(path);
      }
      return undefined;
    }
    case "write_file":
      backend.files.set(path, args.content as string);
      // #824 `WriteOutcome`
      return { indexFresh: true, mtime: 1 };
    default:
      return undefined;
  }
}

/**
 * A fresh module registry per test: `use-app-startup` keeps its cold-start drain
 * guard in module state, and the drain (`get_opened_urls`) is how a test knows the
 * restore has settled — a guard left set by an earlier test would never call it.
 */
async function start(scenario: Scenario) {
  vi.resetModules();
  const [
    { useContextStore },
    { isFileTab, useEditorStore },
    { useFileStore },
    { useSettingsStore },
    { waitForHydration },
    { useAppStartup },
    { useJournal },
    { openFileByPath },
    { openRecentFile },
    { useUIStore },
  ] = await Promise.all([
    import("../../stores/context/context"),
    import("../../stores/editor/editor"),
    import("../../stores/file/file"),
    import("../../stores/settings/store"),
    import("../../stores/system/hydration"),
    import("../use-app-startup"),
    import("../use-journal"),
    import("../../utils/open-file"),
    import("../../utils/recent-open"),
    import("../../stores/ui/ui"),
  ]);
  await Promise.all([
    waitForHydration(useContextStore.persist),
    waitForHydration(useSettingsStore.persist),
  ]);

  useContextStore.setState({
    activeContextId: scenario.active ?? "f",
    contexts: [...CONTEXTS, ...(scenario.extraContexts ?? [])].map((c) => ({
      ...c,
    })),
  });
  useSettingsStore.setState({
    journalDirectory: JOURNAL,
    journalEnabled: true,
    journalFilenameFormat: FORMAT,
    journalStartupBehavior: scenario.journal ? "openJournal" : "nothing",
    journalTemplatePath: "",
    journalUseHierarchy: false,
    lastOpenedFile: scenario.lastOpenedFile ?? null,
    lastOpenedFolder: null,
    onLaunch: scenario.onLaunch,
    recentFiles: [],
    zettelkastenDirectory: ZK,
    zettelkastenEnabled: true,
    zettelkastenHomeNote: scenario.homeNote ?? "home.md",
    zettelkastenStartupBehavior: scenario.zettel ? "openHomeNote" : "nothing",
  });
  for (const c of [...CONTEXTS, ...(scenario.extraContexts ?? [])]) {
    if (!scenario.unapproved?.includes(c.path)) backend.approved.add(c.path);
  }
  for (const path of scenario.declined ?? []) backend.declined.add(path);

  // The app's own two handlers (`use-file-operations.ts`), over the fresh stores.
  const handleOpenFilePath = async (path: string) => {
    try {
      await openFileByPath(path);
    } catch {
      // production logs and carries on
    }
  };
  const handleNewFile = () => {
    const id = crypto.randomUUID();
    useFileStore.getState().setFileContent(id, "");
    useEditorStore.getState().openTab({
      contextId: "",
      filePath: "",
      id,
      isDirty: false,
      isPinned: false,
      title: "Untitled",
    });
  };

  renderHook(() => {
    if (scenario.appJournal) useJournal();
    useAppStartup({ handleNewFile, handleOpenFilePath });
  });
  // The drain of queued OS opens is the restore's last step.
  await waitFor(() => expect(backend.calls).toContain("get_opened_urls"));
  // Then let anything the restore set off without awaiting (a tab selection's
  // fire-and-forget context switch, for one) land before the state is read.
  await flush();

  const tabs = () => useEditorStore.getState().tabs;
  const activeTab = () =>
    tabs().find((t) => t.id === useEditorStore.getState().activeTabId);
  const tabFor = (path: string) => tabs().find((t) => t.filePath === path);

  /** The vault tab, the tree on screen and the active file tab name one context. */
  function expectOneContext(id: string): void {
    const seat = CONTEXTS.find((c) => c.id === id)!;
    expect(useContextStore.getState().activeContextId).toBe(id);
    expect(useFileStore.getState().rootPath).toBe(seat.path);
    expect(useFileStore.getState().fileTree.map((e) => e.path)).toEqual([
      `${seat.path}/${TREE_MARKER}`,
    ]);
    const active = activeTab();
    if (isFileTab(active)) expect(active.contextId).toBe(id);
  }

  /** The space notes are open, in their own context, and not on screen. */
  function expectSpaceNotesInBackground(): void {
    const activeId = useEditorStore.getState().activeTabId;
    if (scenario.zettel) {
      expect(tabFor(HOME)).toMatchObject({ contextId: "z" });
      expect(tabFor(HOME)!.id).not.toBe(activeId);
    }
    if (scenario.journal) {
      expect(tabFor(today())).toMatchObject({ contextId: "j" });
      expect(tabFor(today())!.id).not.toBe(activeId);
    }
  }

  /**
   * What the recorder made of the launch: the restored file at the head of the
   * recent list, or — with no restored file — nothing recorded at all. The list
   * starts empty, so a space note activated even for a moment shows up here.
   */
  function expectRecorded(restored: null | string): void {
    const { lastOpenedFile, recentFiles } = useSettingsStore.getState();
    expect(lastOpenedFile).toBe(restored ?? scenario.lastOpenedFile ?? null);
    expect(recentFiles.map((f) => f.path)).toEqual(restored ? [restored] : []);
  }

  /** Tabs other than the space notes — what the restore itself opened. */
  const restoreTabs = () =>
    tabs().filter((t) => t.filePath !== HOME && t.filePath !== today());

  return {
    activeTab,
    expectOneContext,
    expectRecorded,
    expectSpaceNotesInBackground,
    openFileByPath,
    openRecentFile,
    restoreTabs,
    tabFor,
    useContextStore,
    useEditorStore,
    useSettingsStore,
    useUIStore,
  };
}

function today(): string {
  return getJournalFilePath(null, JOURNAL, new Date(), FORMAT)!;
}

beforeEach(() => {
  backend.addRefused.clear();
  backend.approved.clear();
  backend.calls.length = 0;
  backend.declined.clear();
  backend.files = new Map([
    [EXTERNAL, "# outside"],
    [FAR, "# far"],
    [HOME, "# home"],
    [NOTE, "# note"],
    [OLD_ENTRY, "# 2026-09-23"],
    [SECOND, "# second"],
  ]);
  backend.listFails.clear();
  backend.log.length = 0;
  backend.queued = [];
  backend.registered.clear();
  backend.rootRefused.clear();
  vi.mocked(invoke).mockImplementation(async (command, args) =>
    route(command, args as Record<string, unknown>),
  );
});

const SPACES = [
  { label: "no space action", journal: false, zettel: false },
  { label: "Zettel opens its home note", journal: false, zettel: true },
  { label: "Journal opens today's entry", journal: true, zettel: false },
  { label: "both space actions", journal: true, zettel: true },
];

describe("§81 launch restore — one context, whatever the spaces do", () => {
  describe.each(SPACES)("$label", (spaces) => {
    it("restoreLastFolder opens the last active context and no file of its own", async () => {
      const h = await start({
        ...spaces,
        lastOpenedFile: NOTE,
        onLaunch: "restoreLastFolder",
      });

      h.expectOneContext("f");
      h.expectSpaceNotesInBackground();
      // ‼️ The negative half: a `lastOpenedFile` inside the restored folder used to
      // be opened whatever `onLaunch` said (defect 3).
      expect(h.restoreTabs()).toEqual([]);
      expect(h.activeTab()).toBeUndefined();
      h.expectRecorded(null);
    });

    it("restoreLastFile activates the last file in its context", async () => {
      const h = await start({
        ...spaces,
        lastOpenedFile: NOTE,
        onLaunch: "restoreLastFile",
      });

      h.expectOneContext("f");
      h.expectSpaceNotesInBackground();
      expect(h.activeTab()).toMatchObject({ contextId: "f", filePath: NOTE });
      h.expectRecorded(NOTE);
    });

    it("newFile opens the last active context with an untitled file on screen", async () => {
      const h = await start({
        ...spaces,
        lastOpenedFile: NOTE,
        onLaunch: "newFile",
      });

      h.expectOneContext("f");
      h.expectSpaceNotesInBackground();
      expect(h.activeTab()).toMatchObject({ contextId: "f", filePath: "" });
      expect(h.restoreTabs()).toHaveLength(1);
      h.expectRecorded(null);
    });
  });
});

describe("§81 the reported sequence", () => {
  it("a folder was the vault tab and Zettel opens its home note: the vault tab stays the folder", async () => {
    // Defect 1, "the file tree reopens the previous folder but the vault tab always
    // has Zettel selected": the Zettel startup took the seat locally.
    const h = await start({ onLaunch: "restoreLastFolder", zettel: true });

    h.expectOneContext("f");
    expect(h.useContextStore.getState().activeContextId).not.toBe("z");
  });

  it("the measured machine: Restore last file with a journal entry from last week", async () => {
    const h = await start({
      journal: true,
      lastOpenedFile: OLD_ENTRY,
      onLaunch: "restoreLastFile",
      zettel: true,
    });

    // The file lives in another registered context: the restore switches there,
    // tree and all.
    h.expectOneContext("j");
    h.expectSpaceNotesInBackground();
    expect(h.activeTab()).toMatchObject({
      contextId: "j",
      filePath: OLD_ENTRY,
    });
    h.expectRecorded(OLD_ENTRY);
  });
});

describe("§81 restoreLastFile — where the file lives", () => {
  it("in another registered context: switches to it", async () => {
    const h = await start({ lastOpenedFile: FAR, onLaunch: "restoreLastFile" });

    h.expectOneContext("g");
    expect(h.activeTab()).toMatchObject({ contextId: "g", filePath: FAR });
  });

  it("in a context not approved this session: restores the last folder instead", async () => {
    // §334 Only the active context may ask at launch; switching to `g` would
    // raise the dialog the launch withheld.
    const h = await start({
      lastOpenedFile: FAR,
      onLaunch: "restoreLastFile",
      unapproved: [OTHER],
    });

    h.expectOneContext("f");
    expect(h.restoreTabs()).toEqual([]);
  });

  it("in a context that refuses the switch: restores the last folder instead", async () => {
    // `switchContext` puts the seat back on a refused root (§333) and loads nothing.
    backend.rootRefused.set(OTHER, "VAULT_PATH_UNRESOLVABLE");

    const h = await start({ lastOpenedFile: FAR, onLaunch: "restoreLastFile" });

    h.expectOneContext("f");
    expect(h.restoreTabs()).toEqual([]);
  });

  it("in a context whose tree fails to load: restores the last folder, spaces and all", async () => {
    // `_loadContextFileTree` reports and rethrows; the seat is already on `g`.
    backend.listFails.add(OTHER);

    const h = await start({
      lastOpenedFile: FAR,
      onLaunch: "restoreLastFile",
      zettel: true,
    });

    h.expectOneContext("f");
    expect(h.restoreTabs()).toEqual([]);
    // Not the legacy path: the space startups still ran.
    h.expectSpaceNotesInBackground();
  });

  it("outside every vault and folder: opens it in a FileContext of its own", async () => {
    const h = await start({
      lastOpenedFile: EXTERNAL,
      onLaunch: "restoreLastFile",
    });

    const tab = h.activeTab();
    expect(tab).toMatchObject({ filePath: EXTERNAL });
    const fileCtx = h.useContextStore
      .getState()
      .contexts.find((c) => c.id === tab!.contextId);
    expect(fileCtx).toMatchObject({ contextType: "file", path: EXTERNAL });
    expect(h.useContextStore.getState().activeContextId).toBe(fileCtx!.id);
  });

  it("outside every vault and folder but unreadable: the last folder, and no empty FileContext", async () => {
    // The external file "exists" (its FileContext registers) but cannot be read.
    const unreadable = "/ext/unreadable.md";

    const h = await start({
      lastOpenedFile: unreadable,
      onLaunch: "restoreLastFile",
    });

    h.expectOneContext("f");
    expect(h.restoreTabs()).toEqual([]);
    expect(
      h.useContextStore.getState().contexts.map((c) => c.path),
    ).not.toContain(unreadable);
  });

  it("no longer on disk, in the same context: restores the last folder", async () => {
    const h = await start({
      lastOpenedFile: `${WORK}/gone.md`,
      onLaunch: "restoreLastFile",
    });

    h.expectOneContext("f");
    expect(h.restoreTabs()).toEqual([]);
  });

  it("no longer on disk, in another context: comes back to the last folder", async () => {
    const h = await start({
      lastOpenedFile: `${OTHER}/gone.md`,
      onLaunch: "restoreLastFile",
    });

    h.expectOneContext("f");
    expect(h.restoreTabs()).toEqual([]);
  });

  it("with no last file: restores the last folder", async () => {
    const h = await start({
      lastOpenedFile: null,
      onLaunch: "restoreLastFile",
    });

    h.expectOneContext("f");
    expect(h.restoreTabs()).toEqual([]);
  });

  it("the Zettel home note, set by absolute path in the folder: stays in the folder", async () => {
    // The home note's tab belongs to the context holding the file. Tagged with
    // the Zettel space instead, selecting it switched the launch to Zettel.
    const homeInFolder = `${WORK}/home2.md`;
    backend.files.set(homeInFolder, "# home2");

    const h = await start({
      homeNote: homeInFolder,
      lastOpenedFile: homeInFolder,
      onLaunch: "restoreLastFile",
      zettel: true,
    });

    h.expectOneContext("f");
    expect(h.activeTab()).toMatchObject({
      contextId: "f",
      filePath: homeInFolder,
    });
  });
});

describe("§81 the context the restore opens on is one Rust holds this session", () => {
  it("the last active context is gone: the first registered one, not an unapproved space", async () => {
    // Removing the unresolvable `g` hands the seat to the first context — the
    // Zettel tab, not approved this session. Opening it would raise its dialog.
    backend.addRefused.set(OTHER, "VAULT_PATH_UNRESOLVABLE");

    const h = await start({
      active: "g",
      onLaunch: "restoreLastFolder",
      unapproved: [ZK],
    });

    h.expectOneContext("j");
    expect(backend.log).not.toContain(`set_vault_root ${ZK}`);
    expect(backend.log).not.toContain(`add_context ${ZK}`);
  });

  it("and with none registered, the legacy path opens nothing", async () => {
    backend.addRefused.set(OTHER, "VAULT_PATH_UNRESOLVABLE");

    await start({
      active: "g",
      onLaunch: "restoreLastFolder",
      unapproved: [ZK, JOURNAL, WORK],
    });

    expect(backend.calls).not.toContain("set_vault_root");
  });
});

describe("§81 opening a file switches to the context it belongs to", () => {
  it("a file the OS queued for the launch, in another context: that context, whole", async () => {
    backend.queued = [FAR];

    const h = await start({ onLaunch: "restoreLastFolder" });

    h.expectOneContext("g");
    expect(h.activeTab()).toMatchObject({ contextId: "g", filePath: FAR });
  });

  it("a file of another context opened after the launch: that context, whole", async () => {
    const h = await start({ onLaunch: "restoreLastFolder" });

    await h.openFileByPath(FAR);

    h.expectOneContext("g");
    expect(h.activeTab()).toMatchObject({ contextId: "g", filePath: FAR });
  });

  it("a file of the context on screen: no switch", async () => {
    const h = await start({ onLaunch: "restoreLastFolder" });
    const before = backend.calls.filter((c) => c === "set_vault_root").length;

    await h.openFileByPath(SECOND);

    expect(backend.calls.filter((c) => c === "set_vault_root")).toHaveLength(
      before,
    );
    h.expectOneContext("f");
    expect(h.activeTab()).toMatchObject({ contextId: "f", filePath: SECOND });
  });
});

describe("§81 opening a file of a context whose tree fails to load", () => {
  // One unreadable subfolder fails the whole recursive listing. The switch reports
  // it and leaves the seat on the context, as a tab-bar click does; the file itself
  // is readable, and opened before opening a file switched contexts at all.
  it("opens it, and says it opened", async () => {
    backend.listFails.add(OTHER);
    const h = await start({ onLaunch: "restoreLastFolder" });

    expect(await h.openFileByPath(FAR)).toBe("opened");

    expect(h.activeTab()).toMatchObject({ contextId: "g", filePath: FAR });
    expect(h.useContextStore.getState().activeContextId).toBe("g");
  });

  it("from Open Recent: opens it, and the entry stays", async () => {
    backend.listFails.add(OTHER);
    const h = await start({ onLaunch: "restoreLastFolder" });
    h.useSettingsStore.setState({
      recentFiles: [{ lastOpened: 1, path: FAR }],
    });

    await h.openRecentFile(FAR);

    expect(h.activeTab()).toMatchObject({ contextId: "g", filePath: FAR });
    expect(
      h.useSettingsStore.getState().recentFiles.map((f) => f.path),
    ).toContain(FAR);
    expect(h.useUIStore.getState().toast?.message).not.toBe(
      "Path not found — removed from recents: far.md",
    );
  });
});

describe("§81 opening a file whose context switch is refused", () => {
  // The user declines the approval dialog for a context the launch skipped.
  // `switchContext` says so and puts the seat back; the open must stop there.
  const refusedOther = {
    declined: [OTHER],
    onLaunch: "restoreLastFolder" as const,
    unapproved: [OTHER],
  };

  it("a tab of that context already open: one dialog, and nothing selected", async () => {
    const h = await start(refusedOther);
    h.useEditorStore.setState((state) => ({
      tabs: [
        ...state.tabs,
        {
          contextId: "g",
          filePath: FAR,
          id: "t-far",
          isDirty: false,
          isPinned: false,
          title: "far.md",
        },
      ],
    }));

    expect(await h.openFileByPath(FAR)).toBe("refused");
    await flush();

    expect(
      backend.log.filter((l) => l === `add_context ${OTHER}`),
    ).toHaveLength(1);
    h.expectOneContext("f");
    expect(h.activeTab()).toBeUndefined();
  });

  it("a recent file of that context: the entry stays, and nothing says it is gone", async () => {
    const h = await start(refusedOther);
    h.useSettingsStore.setState({
      recentFiles: [{ lastOpened: 1, path: FAR }],
    });

    await h.openRecentFile(FAR);

    expect(
      h.useSettingsStore.getState().recentFiles.map((f) => f.path),
    ).toEqual([FAR]);
    // The last word is the refusal's, not "Path not found — removed".
    expect(h.useUIStore.getState().toast?.message).toBe(
      `Access to ${OTHER} was not allowed.`,
    );
    expect(backend.log).not.toContain(`read_file ${FAR}`);
    h.expectOneContext("f");
  });

  it("a file of a refused context nested in the folder on screen: no tab of it", async () => {
    // The folder `f` would permit the read; the tab would name the refused
    // context in front of `f`'s tree.
    const nested = `${WORK}/nested`;
    const inner = `${nested}/inner.md`;
    backend.files.set(inner, "# inner");

    const h = await start({
      declined: [nested],
      extraContexts: [ctx("n", nested, "vault")],
      onLaunch: "restoreLastFolder",
      unapproved: [nested],
    });

    expect(await h.openFileByPath(inner)).toBe("refused");
    await flush();

    expect(h.tabFor(inner)).toBeUndefined();
    h.expectOneContext("f");
  });
});

describe("§81 the recorder runs with the launch", () => {
  it("records a file opened after the launch, through openTab as the file tree opens one", async () => {
    const h = await start({ onLaunch: "restoreLastFolder" });

    h.useEditorStore.getState().openTab({
      contextId: "f",
      filePath: SECOND,
      id: "t-second",
      isDirty: false,
      isPinned: false,
      title: "second.md",
    });

    expect(h.useSettingsStore.getState().lastOpenedFile).toBe(SECOND);
  });
});

describe("§81 today's journal entry is created after the launch restore", () => {
  it("with Open today's journal: the startup creates it, useJournal finds it", async () => {
    const h = await start({
      appJournal: true,
      journal: true,
      onLaunch: "restoreLastFolder",
    });

    // useJournal reads after the restore's drain, and finds the entry there.
    const drained = backend.log.indexOf("get_opened_urls ");
    await waitFor(() =>
      expect(backend.log.lastIndexOf(`read_file ${today()}`)).toBeGreaterThan(
        drained,
      ),
    );
    await flush();
    expect(
      backend.log.filter((l) => l === `write_file ${today()}`),
    ).toHaveLength(1);
    expect(backend.log.indexOf(`write_file ${today()}`)).toBeLessThan(drained);
    h.expectSpaceNotesInBackground();
  });

  it("with On Startup: nothing, it is still created at launch — and not opened", async () => {
    const h = await start({ appJournal: true, onLaunch: "restoreLastFolder" });

    await waitFor(() => expect(backend.files.has(today())).toBe(true));
    const drained = backend.log.indexOf("get_opened_urls ");
    expect(backend.log.indexOf(`write_file ${today()}`)).toBeGreaterThan(
      drained,
    );
    expect(h.tabFor(today())).toBeUndefined();
  });
});

describe("§81 the Zettel preset still enters the space", () => {
  // The Zettel startup action is shared with the preset (`stores/file/workspace.ts`).
  // At launch it must not take the seat or the active tab; entering the space by
  // choice must still do both — the preset switches, and the home note is on screen.
  it("switches to the Zettel context and shows the home note", async () => {
    const h = await start({ onLaunch: "restoreLastFolder" });
    h.expectOneContext("f");
    h.useSettingsStore.setState({
      zettelkastenStartupBehavior: "openHomeNote",
    });

    const { useWorkspaceStore } = await import("../../stores/file/workspace");
    useWorkspaceStore.getState().applyPreset("zettelkasten");

    await waitFor(() =>
      expect(h.activeTab()).toMatchObject({ contextId: "z", filePath: HOME }),
    );
    h.expectOneContext("z");
  });

  // A home note set by absolute path inside another registered context: at launch
  // its tab belongs to that context (it stays out of the way); entering the space
  // shows it in the Zettel context, where it does not switch the app back.
  const homeInFolder = `${WORK}/home2.md`;

  it("…with a home note in a folder, not yet open: Zettel, whole", async () => {
    backend.files.set(homeInFolder, "# home2");
    const h = await start({
      homeNote: homeInFolder,
      onLaunch: "restoreLastFolder",
    });
    h.useSettingsStore.setState({
      zettelkastenStartupBehavior: "openHomeNote",
    });

    const { useWorkspaceStore } = await import("../../stores/file/workspace");
    useWorkspaceStore.getState().applyPreset("zettelkasten");

    await waitFor(() =>
      expect(h.activeTab()).toMatchObject({ filePath: homeInFolder }),
    );
    await flush();
    expect(h.activeTab()).toMatchObject({ contextId: "z" });
    h.expectOneContext("z");
  });

  it("…with a home note in a folder, open since the launch: Zettel, whole", async () => {
    backend.files.set(homeInFolder, "# home2");
    const h = await start({
      homeNote: homeInFolder,
      onLaunch: "restoreLastFolder",
      zettel: true,
    });
    expect(h.tabFor(homeInFolder)).toMatchObject({ contextId: "f" });

    const { useWorkspaceStore } = await import("../../stores/file/workspace");
    useWorkspaceStore.getState().applyPreset("zettelkasten");

    await waitFor(() =>
      expect(h.activeTab()).toMatchObject({ filePath: homeInFolder }),
    );
    await flush();
    expect(h.activeTab()).toMatchObject({ contextId: "z" });
    h.expectOneContext("z");
  });
});
