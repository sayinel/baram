// §391 spec 0070 §8 · §10 — plugin commands in Settings > Keybindings. Task 5 rows: the conflict
// note and the swap for a key a plugin command holds while it is not in the list.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../utils/confirm-dialog", () => ({
  showAlert: vi.fn(async () => undefined),
  showConfirm: vi.fn(async () => true),
}));

import type { PluginEntryContributions } from "../../../plugins/plugin-ui-store";

import en from "../../../i18n/en.json";
import { usePluginUIStore } from "../../../plugins/plugin-ui-store";
import { useSettingsStore } from "../../../stores/settings/store";
import { KeybindingsTab } from "../tabs/KeybindingsTab";

/** No registry entry has this default (Task 0 Step 2). jsdom is not a Mac: Mod is Ctrl. */
const FREE = "Mod+Alt+K";
const PRESS_FREE: KeyboardEventInit = {
  altKey: true,
  code: "KeyK",
  ctrlKey: true,
  key: "k",
};

beforeEach(() => {
  useSettingsStore.setState({ keybindingOverrides: {}, locale: "en" });
  usePluginUIStore.setState({ contributions: {} });
});
afterEach(() => vi.clearAllMocks());

/** The row whose label text — the first text node of `.keybinding-label` — is `label`. */
function row(label: string): HTMLElement {
  const found = [
    ...document.querySelectorAll<HTMLElement>(".keybinding-row"),
  ].find(
    (r) =>
      r.querySelector(".keybinding-label")?.firstChild?.textContent?.trim() ===
      label,
  );
  if (!found) throw new Error(`no row "${label}"`);
  return found;
}

/** Click the row's Edit, then press `init` — the tab's capture listener is on window. */
function capture(label: string, init: KeyboardEventInit = PRESS_FREE): void {
  fireEvent.click(row(label).querySelector(".keybinding-edit-btn")!);
  fireEvent.keyDown(window, init);
}

const note = (label: string) =>
  row(label).querySelector(".keybinding-conflict")?.textContent;

describe("the conflict note (§391 §8)", () => {
  it("a core↔core conflict reads as it did before", () => {
    render(<KeybindingsTab />);
    capture("Save", { code: "KeyN", ctrlKey: true, key: "n" });
    expect(note("Save")).toBe(
      en["keybindings.conflict"].replace(
        "{command}",
        en["keybindings.file.new"],
      ),
    );
  });

  it("a core command meeting the key of a plugin command not in the list: names the plugin, says confirming removes it, and does", () => {
    useSettingsStore.setState({
      keybindingOverrides: { "plugin:gone.cmd": FREE },
    });
    render(<KeybindingsTab />);
    capture("Save");
    expect(note("Save")).toBe(
      `${en["keybindings.conflict.absent"].replace("{plugin}", "gone")} ${en["keybindings.conflict.absentRemoves"]}`,
    );
    fireEvent.click(row("Save").querySelector(".keybinding-confirm-btn")!);
    expect(useSettingsStore.getState().keybindingOverrides).toEqual({
      "file.save": FREE,
    });
  });

  it("a free key shows no note and is simply assigned (the positive half)", () => {
    render(<KeybindingsTab />);
    capture("Save");
    expect(note("Save")).toBeUndefined();
    fireEvent.click(row("Save").querySelector(".keybinding-confirm-btn")!);
    expect(useSettingsStore.getState().keybindingOverrides).toEqual({
      "file.save": FREE,
    });
  });
});

const CITE: PluginEntryContributions = {
  commands: [
    { id: "insert", title: "Insert citation" },
    { id: "pick", title: "Pick a source" },
  ],
  menu: [],
  name: "Cite",
  pluginId: "cite",
  slash: [],
};
const ZETA: PluginEntryContributions = {
  commands: [{ id: "one", title: "Zeta one" }],
  menu: [],
  name: "Zeta",
  pluginId: "zeta",
  slash: [],
};
const withPlugins = () =>
  usePluginUIStore.setState({ contributions: { cite: CITE, zeta: ZETA } });

describe("plugin rows (§391 §8)", () => {
  it("lists each declared command under Plugins, unassigned, with its plugin's name — by plugin id", () => {
    withPlugins();
    render(<KeybindingsTab />);
    expect(
      screen.getByText(en["keybindings.category.plugins"]),
    ).toBeInTheDocument();
    const pluginRows = [...document.querySelectorAll(".keybinding-row")].filter(
      (r) => r.querySelector(".keybinding-plugin-name"),
    );
    expect(
      pluginRows.map((r) =>
        r.querySelector(".keybinding-label")?.firstChild?.textContent?.trim(),
      ),
    ).toEqual(["Insert citation", "Pick a source", "Zeta one"]);
    expect(
      pluginRows.map(
        (r) => r.querySelector(".keybinding-plugin-name")?.textContent,
      ),
    ).toEqual(["Cite", "Cite", "Zeta"]);
    expect(
      row("Insert citation").querySelector(".keybinding-unassigned")
        ?.textContent,
    ).toBe(en["keybindings.unassigned"]);
    expect(row("Insert citation").querySelector(".keybinding-kbd")).toBeNull();
    // A core row still shows its key (the positive half).
    expect(row("Save").querySelector(".keybinding-kbd")).not.toBeNull();
  });

  it("draws a plugin title as written — never through t() — while a core label is translated", () => {
    usePluginUIStore.setState({
      contributions: {
        x: {
          ...CITE,
          commands: [{ id: "a", title: "menu.edit.copy" }],
          pluginId: "x",
        },
      },
    });
    render(<KeybindingsTab />);
    // Through `t()` this title would read "Copy", and `row` would find no such row.
    expect(row("menu.edit.copy")).toBeTruthy();
    expect(row(en["keybindings.file.save"])).toBeTruthy();
  });

  it("D16 — a plugin's title and name lose bidi and control characters on the row", () => {
    usePluginUIStore.setState({
      contributions: {
        x: {
          commands: [{ id: "a", title: "\u202eab\u0007c" }],
          menu: [],
          name: "\u2066Name",
          pluginId: "x",
          slash: [],
        },
      },
    });
    render(<KeybindingsTab />);
    const r = row("ab c");
    expect(r.querySelector(".keybinding-plugin-name")?.textContent).toBe(
      "Name",
    );
    // Written as code points: the characters themselves are invisible in an editor.
    const unwanted = new Set([0x07, 0x202e, 0x2066]);
    expect(
      [...(r.textContent ?? "")].filter((c) => unwanted.has(c.codePointAt(0)!)),
    ).toEqual([]);
  });

  it("assigning a key stores it under the plugin: id, and the row shows it", () => {
    withPlugins();
    render(<KeybindingsTab />);
    capture("Insert citation");
    fireEvent.click(
      row("Insert citation").querySelector(".keybinding-confirm-btn")!,
    );
    expect(useSettingsStore.getState().keybindingOverrides).toEqual({
      "plugin:cite.insert": FREE,
    });
    expect(
      row("Insert citation").querySelector(".keybinding-kbd"),
    ).not.toBeNull();
  });

  it.each([
    [
      "a core default key",
      {},
      { code: "KeyS", ctrlKey: true, key: "s" },
      "keybindings.file.save",
    ],
    [
      "a core key the user assigned",
      { "file.new": FREE },
      PRESS_FREE,
      "keybindings.file.new",
    ],
    [
      "a Tiptap key",
      {},
      { code: "KeyB", ctrlKey: true, key: "b" },
      "keybindings.formatting.bold",
    ],
  ] as const)(
    "D13 — refuses %s for a plugin command: the note says so and confirming assigns nothing",
    (_name, overrides, press, labelKey) => {
      withPlugins();
      useSettingsStore.setState({ keybindingOverrides: { ...overrides } });
      render(<KeybindingsTab />);
      capture("Insert citation", press);
      expect(note("Insert citation")).toBe(
        en["keybindings.conflict.core"].replace(
          "{command}",
          (en as Record<string, string>)[labelKey],
        ),
      );
      const confirm = row("Insert citation").querySelector<HTMLButtonElement>(
        ".keybinding-confirm-btn",
      )!;
      expect(confirm.disabled).toBe(true);
      fireEvent.click(confirm);
      expect(useSettingsStore.getState().keybindingOverrides).toEqual({
        ...overrides,
      });
    },
  );

  it("plugin ↔ plugin: confirming swaps — only the newly assigned command keeps the key", () => {
    withPlugins();
    useSettingsStore.setState({
      keybindingOverrides: { "plugin:zeta.one": FREE },
    });
    render(<KeybindingsTab />);
    capture("Insert citation");
    expect(note("Insert citation")).toBe(
      en["keybindings.conflict"].replace("{command}", "Zeta one"),
    );
    fireEvent.click(
      row("Insert citation").querySelector(".keybinding-confirm-btn")!,
    );
    expect(useSettingsStore.getState().keybindingOverrides).toEqual({
      "plugin:cite.insert": FREE,
    });
  });

  it("a plugin command meeting the stored key of a command not in the list: the note, and the swap (P10)", () => {
    withPlugins();
    useSettingsStore.setState({
      keybindingOverrides: { "plugin:gone.cmd": FREE },
    });
    render(<KeybindingsTab />);
    capture("Insert citation");
    expect(note("Insert citation")).toBe(
      `${en["keybindings.conflict.absent"].replace("{plugin}", "gone")} ${en["keybindings.conflict.absentRemoves"]}`,
    );
    fireEvent.click(
      row("Insert citation").querySelector(".keybinding-confirm-btn")!,
    );
    expect(useSettingsStore.getState().keybindingOverrides).toEqual({
      "plugin:cite.insert": FREE,
    });
  });

  it("a core command swapping with a plugin command takes the plugin's key away", () => {
    withPlugins();
    useSettingsStore.setState({
      keybindingOverrides: { "plugin:cite.pick": FREE },
    });
    render(<KeybindingsTab />);
    capture("Save");
    expect(note("Save")).toBe(
      en["keybindings.conflict"].replace("{command}", "Pick a source"),
    );
    fireEvent.click(row("Save").querySelector(".keybinding-confirm-btn")!);
    expect(useSettingsStore.getState().keybindingOverrides).toEqual({
      "file.save": FREE,
    });
  });

  it("marks an overlapping plugin row — shadowed by a core command, both-run with a Tiptap key", () => {
    withPlugins();
    useSettingsStore.setState({
      keybindingOverrides: {
        "plugin:cite.insert": "Mod+S",
        "plugin:cite.pick": "Mod+B",
      },
    });
    render(<KeybindingsTab />);
    expect(
      row("Insert citation").querySelector(".keybinding-overlap")?.textContent,
    ).toBe(en["keybindings.overlap.shadowed"]);
    expect(
      row("Pick a source").querySelector(".keybinding-overlap")?.textContent,
    ).toBe(en["keybindings.overlap.bothRun"]);
    expect(row("Zeta one").querySelector(".keybinding-overlap")).toBeNull();
  });

  it("puts no mark on core rows — Backlinks and Blockquote share Mod+Shift+B unmarked", () => {
    render(<KeybindingsTab />);
    expect(
      row(en["keybindings.search.backlinks"]).querySelector(
        ".keybinding-overlap",
      ),
    ).toBeNull();
    expect(
      row(en["keybindings.formatting.blockquote"]).querySelector(
        ".keybinding-overlap",
      ),
    ).toBeNull();
    expect(document.querySelectorAll(".keybinding-overlap")).toHaveLength(0);
  });

  it("a plugin row's Reset clears its key back to Not assigned", () => {
    withPlugins();
    useSettingsStore.setState({
      keybindingOverrides: { "plugin:cite.insert": FREE },
    });
    render(<KeybindingsTab />);
    fireEvent.click(
      row("Insert citation").querySelector(".keybinding-reset-btn")!,
    );
    expect(useSettingsStore.getState().keybindingOverrides).toEqual({});
    expect(
      row("Insert citation").querySelector(".keybinding-unassigned"),
    ).not.toBeNull();
  });

  it("D14 — Reset All clears plugin keys too, the key of a plugin not in the list included", async () => {
    withPlugins();
    useSettingsStore.setState({
      keybindingOverrides: {
        "file.save": "Mod+Alt+S",
        "plugin:cite.insert": FREE,
        "plugin:gone.cmd": "Mod+Alt+J",
      },
    });
    render(<KeybindingsTab />);
    await act(async () => {
      fireEvent.click(screen.getByText(en["keybindings.resetAll"]));
    });
    expect(useSettingsStore.getState().keybindingOverrides).toEqual({});
  });

  it("the filter finds a plugin row by part of its title, and hides another plugin's rows", () => {
    withPlugins();
    render(<KeybindingsTab />);
    fireEvent.change(
      screen.getByPlaceholderText(en["keybindings.search.placeholder"]),
      {
        target: { value: "pick a" },
      },
    );
    expect(row("Pick a source")).toBeTruthy();
    expect(() => row("Insert citation")).toThrow();
    expect(() => row("Zeta one")).toThrow();
  });

  it("the filter finds every row of a plugin by part of its name, and hides another plugin's rows", () => {
    withPlugins();
    render(<KeybindingsTab />);
    // "cite" is in no title: "Insert citation" has "citat", "Pick a source" has none.
    fireEvent.change(
      screen.getByPlaceholderText(en["keybindings.search.placeholder"]),
      {
        target: { value: "cite" },
      },
    );
    expect(row("Insert citation")).toBeTruthy();
    expect(row("Pick a source")).toBeTruthy();
    expect(() => row("Zeta one")).toThrow();
  });

  it("a stored key of a plugin that is not loaded renders no row — the loaded plugins' rows are exactly theirs", () => {
    withPlugins();
    useSettingsStore.setState({
      keybindingOverrides: { "plugin:gone.cmd": FREE },
    });
    render(<KeybindingsTab />);
    const pluginRows = [...document.querySelectorAll(".keybinding-row")].filter(
      (r) => r.querySelector(".keybinding-plugin-name"),
    );
    expect(pluginRows).toHaveLength(3);
    expect(
      [...document.querySelectorAll(".keybinding-row")].filter((r) =>
        /gone/i.test(r.textContent ?? ""),
      ),
    ).toHaveLength(0);
  });

  it("redraws when a plugin comes and goes", () => {
    render(<KeybindingsTab />);
    expect(document.querySelector(".keybinding-plugin-name")).toBeNull();
    act(() => usePluginUIStore.getState().registerContributions(CITE));
    expect(row("Insert citation")).toBeTruthy();
    act(() => usePluginUIStore.getState().unregisterPlugin("cite"));
    expect(document.querySelector(".keybinding-plugin-name")).toBeNull();
  });
});
