// §391 spec 0070 §8 · §10 (단축키 — 목록 · 충돌) — plugin commands in the keybinding functions.
import type { PluginEntryContributions } from "../../plugins/plugin-ui-store";

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { usePluginUIStore } from "../../plugins/plugin-ui-store";
import { KEYBINDING_REGISTRY } from "../keybinding-registry";
import {
  isPluginKeybindingId,
  keybindingLabel,
  parsePluginKeybindingId,
  pluginCommandFullId,
  pluginKeybindingEntries,
  pluginOverlap,
} from "../plugin-keybindings";
import {
  conflictCommandId,
  findCommandByKey,
  findConflict,
  getMergedKeybindings,
  isRefusedConflict,
  useKeybindings,
} from "../use-keybindings";

/** No registry entry has this default (Task 0 Step 2 measured it). */
const FREE = "Mod+Alt+K";

function plugin(
  pluginId: string,
  commands: PluginEntryContributions["commands"],
  name = pluginId,
): PluginEntryContributions {
  return { commands, menu: [], name, pluginId, slash: [] };
}

const CONTRIBUTIONS = {
  zeta: plugin("zeta", [{ id: "one", title: "Zeta one" }], "Zeta"),
  cite: plugin(
    "cite",
    [
      { id: "insert", title: "Insert citation" },
      { id: "pick", title: "Pick a source" },
    ],
    "Cite",
  ),
};
const entries = () => pluginKeybindingEntries(CONTRIBUTIONS);

describe("pluginKeybindingEntries", () => {
  it("one unassigned entry per declared command, by plugin id and then as declared", () => {
    expect(entries()).toEqual([
      {
        category: "plugins",
        customizable: true,
        defaultKey: "",
        id: "plugin:cite.insert",
        label: "Insert citation",
        literalLabel: true,
        pluginName: "Cite",
      },
      {
        category: "plugins",
        customizable: true,
        defaultKey: "",
        id: "plugin:cite.pick",
        label: "Pick a source",
        literalLabel: true,
        pluginName: "Cite",
      },
      {
        category: "plugins",
        customizable: true,
        defaultKey: "",
        id: "plugin:zeta.one",
        label: "Zeta one",
        literalLabel: true,
        pluginName: "Zeta",
      },
    ]);
  });

  it("keeps a plugin's commands in the order it declared them, not by id", () => {
    const declared = pluginKeybindingEntries({
      p: plugin("p", [
        { id: "pick", title: "Pick" },
        { id: "insert", title: "Insert" },
      ]),
    });
    expect(declared.map((e) => e.id)).toEqual([
      "plugin:p.pick",
      "plugin:p.insert",
    ]);
  });

  it("is built once per slice object — the global keydown handler asks on every key (P9)", () => {
    expect(pluginKeybindingEntries(CONTRIBUTIONS)).toBe(
      pluginKeybindingEntries(CONTRIBUTIONS),
    );
    expect(pluginKeybindingEntries({ ...CONTRIBUTIONS })).not.toBe(
      pluginKeybindingEntries(CONTRIBUTIONS),
    );
  });

  it("D16 — titles and names lose bidi and control characters", () => {
    const [entry] = pluginKeybindingEntries({
      x: plugin("x", [{ id: "a", title: "\u202eab\u0007c" }], "\u2066Name"),
    });
    expect(entry.label).toBe("ab c");
    expect(entry.pluginName).toBe("Name");
  });
});

describe("keybindingLabel", () => {
  const t = (key: string) =>
    key === "menu.edit.copy"
      ? "Copy"
      : key === "keybindings.file.save"
        ? "Save"
        : key;

  it("draws a plugin title as written, even one that is an i18n key", () => {
    const [entry] = pluginKeybindingEntries({
      x: plugin("x", [{ id: "a", title: "menu.edit.copy" }]),
    });
    expect(keybindingLabel(entry, t)).toBe("menu.edit.copy");
  });

  it("translates a core label (the positive half)", () => {
    const save = KEYBINDING_REGISTRY.find((e) => e.id === "file.save")!;
    expect(keybindingLabel(save, t)).toBe("Save");
  });
});

describe("the merged list and key lookup with plugin entries", () => {
  it("lists plugin entries after every registry entry, unassigned until overridden", () => {
    const merged = getMergedKeybindings(
      { "plugin:cite.pick": FREE },
      entries(),
    );
    expect(
      merged.slice(0, KEYBINDING_REGISTRY.length).map((e) => e.id),
    ).toEqual(KEYBINDING_REGISTRY.map((e) => e.id));
    expect(
      merged
        .slice(KEYBINDING_REGISTRY.length)
        .map((e) => [e.id, e.activeKey, e.isOverridden]),
    ).toEqual([
      ["plugin:cite.insert", "", false],
      ["plugin:cite.pick", FREE, true],
      ["plugin:zeta.one", "", false],
    ]);
  });

  it("finds a plugin command by its assigned key, and nothing when it has none", () => {
    expect(
      findCommandByKey(FREE, { "plugin:cite.pick": FREE }, entries())?.id,
    ).toBe("plugin:cite.pick");
    expect(findCommandByKey(FREE, {}, entries())).toBeUndefined();
  });

  it("a core command wins a key it shares with a plugin command — core comes first", () => {
    expect(
      findCommandByKey("Mod+S", { "plugin:cite.pick": "Mod+S" }, entries())?.id,
    ).toBe("file.save");
  });

  it("of two plugins on one key, the lower plugin id wins", () => {
    expect(
      findCommandByKey(
        FREE,
        { "plugin:cite.insert": FREE, "plugin:zeta.one": FREE },
        entries(),
      )?.id,
    ).toBe("plugin:cite.insert");
  });

  it("without plugin entries, a stored plugin key matches nothing (the callers that pass none)", () => {
    expect(
      findCommandByKey(FREE, { "plugin:cite.pick": FREE }),
    ).toBeUndefined();
  });
});

describe("stored plugin keys", () => {
  it("cut the plugin id at the first `.` after `plugin:`", () => {
    expect(parsePluginKeybindingId("plugin:cite.insert")).toEqual({
      commandId: "insert",
      pluginId: "cite",
    });
    const longest = "a".repeat(64);
    expect(parsePluginKeybindingId(`plugin:cite.${longest}`)).toEqual({
      commandId: longest,
      pluginId: "cite",
    });
    expect(parsePluginKeybindingId("plugin:my-plugin-2.A_b-9")).toEqual({
      commandId: "A_b-9",
      pluginId: "my-plugin-2",
    });
  });

  it.each([
    "plugin:",
    "plugin:cite",
    "plugin:.x",
    "plugin:cite.",
    "plugin:Cite.x",
    "plugin:cite.a.b",
    "plugin:cite.a b",
    `plugin:cite.${"a".repeat(65)}`,
    "file.save",
    "xplugin:cite.x",
  ])("ignore the hand-edited shape %j", (id) => {
    expect(parsePluginKeybindingId(id)).toBeNull();
  });

  it("isPluginKeybindingId and pluginCommandFullId", () => {
    expect(isPluginKeybindingId("plugin:cite.insert")).toBe(true);
    expect(isPluginKeybindingId("file.save")).toBe(false);
    expect(pluginCommandFullId("plugin:cite.insert")).toBe("cite.insert");
  });
});

describe("findConflict with plugin commands (D13 · §8)", () => {
  it.each([
    ["a core default key", {}, "Mod+S", "file.save"],
    ["a core key the user assigned", { "file.new": FREE }, FREE, "file.new"],
    ["a Tiptap key", {}, "Mod+B", "formatting.bold"],
  ] as const)(
    "a plugin target meeting %s gets that core entry, refused",
    (_name, overrides, key, core) => {
      const conflict = findConflict(
        "plugin:cite.insert",
        key,
        { ...overrides },
        entries(),
      );
      expect(conflict).toMatchObject({ entry: { id: core }, kind: "entry" });
      expect(isRefusedConflict("plugin:cite.insert", conflict)).toBe(true);
    },
  );

  it("a CORE target still skips a Tiptap key, as before §391", () => {
    expect(findConflict("file.save", "Mod+B", {}, entries())).toBeNull();
  });

  it("plugin ↔ plugin is a conflict, not a refusal", () => {
    const conflict = findConflict(
      "plugin:cite.insert",
      FREE,
      { "plugin:zeta.one": FREE },
      entries(),
    );
    expect(conflict).toMatchObject({
      entry: { id: "plugin:zeta.one" },
      kind: "entry",
    });
    expect(isRefusedConflict("plugin:cite.insert", conflict)).toBe(false);
    expect(conflictCommandId(conflict!)).toBe("plugin:zeta.one");
  });

  it("a core target meeting a plugin key: a conflict the swap resolves, not a refusal", () => {
    const conflict = findConflict(
      "file.save",
      FREE,
      { "plugin:cite.pick": FREE },
      entries(),
    );
    expect(conflict).toMatchObject({
      entry: { id: "plugin:cite.pick" },
      kind: "entry",
    });
    expect(isRefusedConflict("file.save", conflict)).toBe(false);
  });

  it("sees the stored key of a plugin command not in the list — plugin off or removed, or the command dropped", () => {
    const off = findConflict(
      "file.save",
      FREE,
      { "plugin:gone.cmd": FREE },
      entries(),
    );
    expect(off).toEqual({
      commandId: "plugin:gone.cmd",
      kind: "absent",
      pluginId: "gone",
    });
    expect(conflictCommandId(off!)).toBe("plugin:gone.cmd");
    // `cite` is up, but declares no `removed` command any more.
    expect(
      findConflict(
        "file.save",
        FREE,
        { "plugin:cite.removed": FREE },
        entries(),
      ),
    ).toMatchObject({ kind: "absent", pluginId: "cite" });
  });

  it("ignores a stored key of another shape", () => {
    expect(
      findConflict(
        "file.save",
        FREE,
        { "plugin:Bad": FREE, "plugin:cite.a.b": FREE },
        entries(),
      ),
    ).toBeNull();
  });

  it("checks the merged list first: a plugin target colliding with a core key AND a stored key is refused", () => {
    const conflict = findConflict(
      "plugin:cite.insert",
      FREE,
      { "plugin:gone.cmd": FREE, "file.new": FREE },
      entries(),
    );
    expect(conflict).toMatchObject({
      entry: { id: "file.new" },
      kind: "entry",
    });
    expect(isRefusedConflict("plugin:cite.insert", conflict)).toBe(true);
  });

  it("an absent stored key is a swap for a plugin target too, not a refusal", () => {
    const conflict = findConflict(
      "plugin:cite.insert",
      FREE,
      { "plugin:gone.cmd": FREE },
      entries(),
    );
    expect(conflict?.kind).toBe("absent");
    expect(isRefusedConflict("plugin:cite.insert", conflict)).toBe(false);
  });

  it("a command's own stored key is not a conflict", () => {
    expect(
      findConflict(
        "plugin:gone.cmd",
        FREE,
        { "plugin:gone.cmd": FREE },
        entries(),
      ),
    ).toBeNull();
  });
});

describe("pluginOverlap (§8 — the overlap note on a plugin row)", () => {
  const overlap = (overrides: Record<string, string>, id: string) => {
    const merged = getMergedKeybindings(overrides, entries());
    return pluginOverlap(
      merged.find((e) => e.id === id)!,
      merged,
    );
  };

  it("a key a customizable core command has → shadowed", () => {
    expect(
      overlap({ "plugin:cite.insert": "Mod+S" }, "plugin:cite.insert"),
    ).toBe("shadowed");
  });

  it("a key an earlier plugin has → shadowed; the earlier plugin's row → nothing", () => {
    const both = { "plugin:cite.insert": FREE, "plugin:zeta.one": FREE };
    expect(overlap(both, "plugin:zeta.one")).toBe("shadowed");
    expect(overlap(both, "plugin:cite.insert")).toBeNull();
  });

  it("a Tiptap key → both run", () => {
    expect(
      overlap({ "plugin:cite.insert": "Mod+B" }, "plugin:cite.insert"),
    ).toBe("both-run");
  });

  it("Mod+Shift+B, held by a core command and a Tiptap key → shadowed (P22)", () => {
    expect(
      overlap({ "plugin:cite.insert": "Mod+Shift+B" }, "plugin:cite.insert"),
    ).toBe("shadowed");
  });

  it("nothing for a free key, an unassigned row or a core row — the core pair on Mod+Shift+B stays unmarked", () => {
    expect(
      overlap({ "plugin:cite.insert": FREE }, "plugin:cite.insert"),
    ).toBeNull();
    expect(overlap({}, "plugin:cite.insert")).toBeNull();
    // A later plugin: without the unassigned guard an earlier entry would be its "winner".
    expect(overlap({}, "plugin:zeta.one")).toBeNull();
    expect(overlap({}, "search.backlinks")).toBeNull();
    expect(overlap({}, "formatting.blockquote")).toBeNull();
  });
});

describe("useKeybindings (§8 — subscribed)", () => {
  beforeEach(() => usePluginUIStore.setState({ contributions: {} }));

  it("re-renders with a plugin's rows when its contributions go up, and without them when they come down", () => {
    const { result } = renderHook(() => useKeybindings());
    expect(result.current.some((e) => isPluginKeybindingId(e.id))).toBe(false);
    act(() =>
      usePluginUIStore.getState().registerContributions(CONTRIBUTIONS.cite),
    );
    expect(
      result.current.filter((e) => isPluginKeybindingId(e.id)).map((e) => e.id),
    ).toEqual(["plugin:cite.insert", "plugin:cite.pick"]);
    act(() => usePluginUIStore.getState().unregisterPlugin("cite"));
    expect(result.current.some((e) => isPluginKeybindingId(e.id))).toBe(false);
  });
});
