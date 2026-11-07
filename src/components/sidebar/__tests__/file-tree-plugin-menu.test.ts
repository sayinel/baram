// §395 spec 0074 D16 · §7 "계획 B" (메뉴 · 대상 · 호출) — the file tree menu's plugin group as data: which
// targets a command gets, which items show, which are disabled and why, and what a click hands the command.
// Every hidden or disabled row has the shown or enabled row it differs from beside it. Commands run through
// the real `executePluginCommand`, so the §385 rights are the real ones.
import type { PluginEntryContributions } from "../../../plugins/plugin-ui-store";
import type { FileMenuTarget } from "../../../plugins/types";
import type { FileEntry } from "../../../stores/file/file";
import type { FileTreePluginItem } from "../file-tree-plugin-menu";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MAX_FILE_MENU_TARGETS } from "../../../plugins/file-decorations/limits";
import {
  commandHandlers,
  commandOwners,
  registerHostCommandHandler,
} from "../../../plugins/plugin-host-registry";
import { promptRefusal, resetPromptGate } from "../../../plugins/prompt-gate";
import { useContextStore } from "../../../stores/context/context";
import { useUIStore } from "../../../stores/ui/ui";
import {
  fileMenuTargets,
  fileTreePluginItems,
  OUTSIDE_EVERY_CONTEXT,
  TOO_MANY_TARGETS,
} from "../file-tree-plugin-menu";

type Trust = PluginEntryContributions["trust"];
function entry(
  pluginId: string,
  name: string,
  trust: Trust,
  fileMenu: PluginEntryContributions["fileMenu"],
): PluginEntryContributions {
  const commands = [
    { id: "go", title: "Go" },
    { id: "other", title: "Other" },
  ];
  return { commands, fileMenu, menu: [], name, pluginId, slash: [], trust };
}
const go = (pluginId: string, name: string, trust: Trust) =>
  entry(pluginId, name, trust, [{ command: "go", id: "g" }]);
/** Every declared command is live unless `live` names the live ones. */
const source = (entries: PluginEntryContributions[], live?: string[]) => ({
  contributions: Object.fromEntries(entries.map((e) => [e.pluginId, e])),
  isLive: (id: string) => live === undefined || live.includes(id),
});
const file = (path: string): FileMenuTarget => ({ isDir: false, path });
const folder = (path: string): FileMenuTarget => ({ isDir: true, path });
const many = (n: number) =>
  Array.from({ length: n }, (_, i) => file(`/v/n/${i}.md`));
/** "label · plugin", with "(off)" for a disabled item. */
const shown = (items: FileTreePluginItem[]) =>
  items.map((i) => `${i.label} · ${i.detail}${"run" in i ? "" : " (off)"}`);
function runFirst(items: FileTreePluginItem[]): void {
  const item = items[0];
  if (item === undefined || !("run" in item))
    throw new Error("no runnable item");
  item.run();
}
const TREE: FileEntry[] = [
  {
    children: [{ isDir: false, name: "c.md", path: "/v/docs/c.md" }],
    isDir: true,
    name: "docs",
    path: "/v/docs",
  },
  { isDir: false, name: "a.md", path: "/v/a.md" },
  { isDir: false, name: "b.md", path: "/v/b.md" },
];

beforeEach(() => {
  useContextStore.setState({
    activeContextId: "ctx-1",
    contexts: [{ contextType: "vault", id: "ctx-1", path: "/v" }] as never,
  });
});
afterEach(() => {
  commandHandlers.clear();
  commandOwners.clear();
  resetPromptGate();
});

describe("fileMenuTargets (D16 — the menu's own choice)", () => {
  it("hands every selected item, in the selection's order, when the click is inside a selection of two or more", () => {
    expect(
      fileMenuTargets(
        "/v/b.md",
        false,
        // The Set's insertion order is the selection's order under test; sorting it would test nothing.
        // eslint-disable-next-line perfectionist/sort-sets
        new Set(["/v/b.md", "/v/docs", "/v/a.md"]),
        TREE,
      ),
    ).toEqual([file("/v/b.md"), folder("/v/docs"), file("/v/a.md")]);
  });

  it("hands the row alone when the click is outside the selection, or the selection is that row", () => {
    expect(
      fileMenuTargets("/v/b.md", false, new Set(["/v/a.md", "/v/docs"]), TREE),
    ).toEqual([file("/v/b.md")]);
    expect(
      fileMenuTargets("/v/docs", true, new Set(["/v/docs"]), TREE),
    ).toEqual([folder("/v/docs")]);
  });

  /** What fails this: folding like the app's delete and move (`pruneNestedPaths`). */
  it("does not fold — a folder and a file inside it both go", () => {
    expect(
      fileMenuTargets(
        "/v/docs",
        true,
        new Set(["/v/docs", "/v/docs/c.md"]),
        TREE,
      ),
    ).toEqual([folder("/v/docs"), file("/v/docs/c.md")]);
  });

  /** What fails this: handing `selectedPaths` as it is — nothing prunes it when a path leaves the tree (R5). */
  it("leaves out a selected path the tree no longer holds, and keeps the ones it holds", () => {
    expect(
      fileMenuTargets(
        "/v/a.md",
        false,
        new Set(["/v/a.md", "/v/b.md", "/v/gone.md"]),
        TREE,
      ),
    ).toEqual([file("/v/a.md"), file("/v/b.md")]);
  });
});

describe("fileTreePluginItems (D16 · §5.6)", () => {
  it("orders plugins by name, a plugin's items as declared, with the item's title or the command's and the plugin's name", () => {
    const items = fileTreePluginItems(
      [file("/v/a.md")],
      source([
        entry("zz", "Alpha", "trusted", [
          { command: "go", id: "g" },
          { command: "other", id: "o", title: "Other‮ here" },
        ]),
        entry("aa", "Be⁦ta", "trusted", [{ command: "go", id: "g" }]),
      ]),
    );
    expect(shown(items)).toEqual([
      "Go · Alpha",
      "Other here · Alpha",
      "Go · Beta",
    ]);
    expect(items.map((i) => i.key)).toEqual(["zz:g", "zz:o", "aa:g"]);
  });

  it("D7 of spec 0070 — an item shows while its command has a handler, and hides without one", () => {
    const plugin = entry("p", "P", "trusted", [
      { command: "go", id: "g" },
      { command: "other", id: "o" },
    ]);
    expect(
      shown(
        fileTreePluginItems([file("/v/a.md")], source([plugin], ["p.other"])),
      ),
    ).toEqual(["Other · P"]);
  });

  /** What fails this: `when` read for the clicked row only instead of every target, or not read at all. */
  it.each([
    ["files", [file("/v/a.md"), file("/v/b.md")], ["Any · P", "Files · P"]],
    [
      "folders",
      [folder("/v/docs"), folder("/v/x")],
      ["Any · P", "Folders · P"],
    ],
    [
      "a mixed selection",
      [folder("/v/docs"), file("/v/docs/c.md")],
      ["Any · P"],
    ],
  ])("when — %s", (_, targets, expected) => {
    const plugin = entry("p", "P", "trusted", [
      { command: "go", id: "any", title: "Any" },
      { command: "go", id: "files", title: "Files", when: "file" },
      { command: "go", id: "folders", title: "Folders", when: "folder" },
    ]);
    expect(shown(fileTreePluginItems(targets, source([plugin])))).toEqual(
      expected,
    );
  });

  /** What fails this: the cap off by one, or a cap that hides items instead of saying why (D16). */
  it.each(["trusted", "sandboxed"] as const)(
    "%s — enabled at 1,000 targets, disabled with its reason at 1,001",
    (trust) => {
      const plugin = go("p", "P", trust);
      expect(
        fileTreePluginItems(many(MAX_FILE_MENU_TARGETS), source([plugin])).map(
          (i) => "run" in i,
        ),
      ).toEqual([true]);
      expect(
        fileTreePluginItems(many(MAX_FILE_MENU_TARGETS + 1), source([plugin])),
      ).toEqual([
        {
          detail: "P",
          disabledReason: TOO_MANY_TARGETS,
          key: "p:g",
          label: "Go",
        },
      ]);
      expect(TOO_MANY_TARGETS).toBe("Not available for more than 1,000 items");
    },
  );

  /** What fails this: enabling a sandboxed item whose targets cannot all be named, or disabling the trusted one too. */
  it("disables a sandboxed plugin's items when a target is in no registered context; a trusted plugin's stay", () => {
    const items = fileTreePluginItems(
      [file("/v/a.md"), file("/elsewhere/b.md")],
      source([go("s", "S", "sandboxed"), go("t", "T", "trusted")]),
    );
    expect(items.map((i) => ("run" in i ? "runs" : i.disabledReason))).toEqual([
      OUTSIDE_EVERY_CONTEXT,
      "runs",
    ]);
  });

  /** What fails this: locating for trusted plugins, above the cap, or once per item instead of once per menu (R7). */
  it("locates the targets once per menu, only for a sandboxed item within the cap", () => {
    const real = useContextStore.getState().getContextForPath;
    const spy = vi.fn(real);
    useContextStore.setState({ getContextForPath: spy });
    try {
      fileTreePluginItems(many(3), source([go("t", "T", "trusted")]));
      fileTreePluginItems(
        many(MAX_FILE_MENU_TARGETS + 1),
        source([go("s", "S", "sandboxed")]),
      );
      expect(spy).toHaveBeenCalledTimes(0);
      fileTreePluginItems(
        many(3),
        source([
          entry("s", "S", "sandboxed", [
            { command: "go", id: "g" },
            { command: "other", id: "o" },
          ]),
        ]),
      );
      expect(spy).toHaveBeenCalledTimes(3);
    } finally {
      useContextStore.setState({ getContextForPath: real });
    }
  });

  /** What fails this: `executePluginCommand(fullId)` with no targets (the editor menu's call), or one form for both tiers. */
  it("a click hands a trusted command absolute targets and a sandboxed one { context, path, isDir }", () => {
    const seen: Record<string, unknown[]> = {};
    registerHostCommandHandler(
      "t.go",
      (...args) => {
        seen.t = args;
      },
      "t",
    );
    registerHostCommandHandler(
      "s.go",
      (...args) => {
        seen.s = args;
      },
      "s",
    );
    const items = fileTreePluginItems(
      [folder("/v/docs"), file("/v/docs/c.md")],
      source([go("s", "S", "sandboxed"), go("t", "T", "trusted")]),
    );
    for (const item of items) if ("run" in item) item.run();
    expect(seen.t).toEqual([[folder("/v/docs"), file("/v/docs/c.md")]]);
    expect(seen.s).toEqual([
      [
        { context: "ctx-1", isDir: true, path: "docs" },
        { context: "ctx-1", isDir: false, path: "docs/c.md" },
      ],
    ]);
  });

  /** What fails this: one array shared by every click — a handler that changes it changes the next click's targets. */
  it("hands each click a fresh copy", () => {
    const calls: FileMenuTarget[][] = [];
    registerHostCommandHandler(
      "t.go",
      (targets) => {
        const list = targets as FileMenuTarget[];
        calls.push(list.map((target) => ({ ...target })));
        list[0].path = "changed";
        list.push(file("extra"));
      },
      "t",
    );
    const items = fileTreePluginItems(
      [file("/v/a.md")],
      source([go("t", "T", "trusted")]),
    );
    runFirst(items);
    runFirst(items);
    expect(calls).toEqual([[file("/v/a.md")], [file("/v/a.md")]]);
  });

  /** What fails this: a menu that calls the handler itself — it runs without the rights a click earns (§385). */
  it("§385 — the command runs with its plugin's prompt rights, which end when it settles", async () => {
    let during: null | string = "unset";
    registerHostCommandHandler(
      "t.go",
      () => {
        during = promptRefusal("t");
      },
      "t",
    );
    runFirst(
      fileTreePluginItems([file("/v/a.md")], source([go("t", "T", "trusted")])),
    );
    expect(during).toBeNull();
    await vi.waitFor(() =>
      expect(promptRefusal("t")).toMatch(/commands is running/),
    );
  });

  it("§6 — a command that rejects becomes an error toast, as in the command palette", async () => {
    const showToast = vi.fn();
    const original = useUIStore.getState().showToast;
    useUIStore.setState({ showToast });
    try {
      registerHostCommandHandler(
        "t.go",
        async () => {
          throw new Error("nope");
        },
        "t",
      );
      runFirst(
        fileTreePluginItems(
          [file("/v/a.md")],
          source([go("t", "T", "trusted")]),
        ),
      );
      await vi.waitFor(() =>
        expect(showToast).toHaveBeenCalledWith("Error: nope", "error"),
      );
    } finally {
      useUIStore.setState({ showToast: original });
    }
  });
});
