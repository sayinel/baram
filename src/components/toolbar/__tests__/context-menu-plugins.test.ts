// §391 spec 0070 §6 · §10 (우클릭 메뉴) — the plugin group the right-click menu appends.
import type { PluginEntrySource } from "../../../plugins/plugin-entry-points";
import type { PluginEntryContributions } from "../../../plugins/plugin-ui-store";
import type { MenuItem } from "../context-menu-types";
import type { Editor } from "@tiptap/core";
import type { Selection } from "@tiptap/pm/state";

import { AllSelection, NodeSelection } from "@tiptap/pm/state";
import { CellSelection } from "@tiptap/pm/tables";
import { afterEach, describe, expect, it, vi } from "vitest";

const { execute, openUrl } = vi.hoisted(() => ({
  execute: vi.fn(async (..._a: unknown[]) => {}),
  openUrl: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl }));
vi.mock("../../../plugins/plugin-host-registry", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../../plugins/plugin-host-registry")
  >()),
  executePluginCommand: (...a: unknown[]) => execute(...a),
}));

import { realEditor } from "../../../plugins/__tests__/real-editor";
import { useUIStore } from "../../../stores/ui/ui";
import {
  isNonEmptyTextSelection,
  withPluginMenuItems,
} from "../context-menu-plugins";

const BASE: MenuItem[] = [{ action: () => {}, label: "Cut" }];

function cite(
  menu: PluginEntryContributions["menu"],
  extra: Partial<PluginEntryContributions> = {},
): PluginEntryContributions {
  return {
    commands: [
      { id: "insert", title: "Insert citation" },
      { id: "pick", title: "Pick a source" },
    ],
    menu,
    name: "Cite",
    pluginId: "cite",
    slash: [],
    ...extra,
  };
}

const source = (
  contributions: Record<string, PluginEntryContributions>,
  live: string[] = ["cite.insert", "cite.pick"],
): PluginEntrySource => ({
  contributions,
  isLive: (id) => live.includes(id),
});

const editors: Editor[] = [];
afterEach(() => {
  for (const e of editors.splice(0)) e.destroy();
  execute.mockReset();
});

/** A caret and a selected word, each in a real editor. */
function selections(): { caret: Selection; text: Selection } {
  const caret = realEditor("alpha @@ omega\n");
  const range = realEditor("alpha @@beta@@ omega\n");
  editors.push(caret.editor, range.editor);
  return {
    caret: caret.editor.state.selection,
    text: range.editor.state.selection,
  };
}

/** Labels, a separator as "—". */
const labels = (items: MenuItem[]) =>
  items.map((i) => (i.separator ? "—" : i.label));

describe("isNonEmptyTextSelection (D15)", () => {
  it("is true for a selected word and false for a caret", () => {
    const { caret, text } = selections();
    expect(isNonEmptyTextSelection(text)).toBe(true);
    expect(isNonEmptyTextSelection(caret)).toBe(false);
  });
});

describe("withPluginMenuItems (§6)", () => {
  it("appends a separator, then the plugin's items with the plugin's name as detail (D5)", () => {
    const { caret } = selections();
    const out = withPluginMenuItems(
      BASE,
      caret,
      source({
        cite: cite([
          { command: "insert", id: "m" },
          { command: "pick", id: "p", title: "Pick for here" },
        ]),
      }),
    );
    expect(labels(out)).toEqual([
      "Cut",
      "—",
      "Insert citation",
      "Pick for here",
    ]);
    expect(out.slice(2).map((i) => i.detail)).toEqual(["Cite", "Cite"]);
    expect(out[0]).toBe(BASE[0]); // the built items are untouched
  });

  it("adds nothing — not even the separator — when no plugin item is visible", () => {
    const { caret } = selections();
    expect(withPluginMenuItems(BASE, caret, source({}))).toBe(BASE);
    // Declared, but no handler now (D7):
    expect(
      withPluginMenuItems(
        BASE,
        caret,
        source({ cite: cite([{ command: "insert", id: "m" }]) }, []),
      ),
    ).toBe(BASE);
  });

  it("D7 — an item shows while its command has a handler and hides without one", () => {
    const { caret } = selections();
    const contributions = {
      cite: cite([
        { command: "insert", id: "m" },
        { command: "pick", id: "p" },
      ]),
    };
    expect(
      labels(
        withPluginMenuItems(BASE, caret, source(contributions, ["cite.pick"])),
      ),
    ).toEqual(["Cut", "—", "Pick a source"]);
  });

  it("orders plugins by name (not id), and a plugin's items as declared", () => {
    const { caret } = selections();
    const out = withPluginMenuItems(BASE, caret, {
      contributions: {
        "a-one": {
          ...cite([
            { command: "pick", id: "2" },
            { command: "insert", id: "1" },
          ]),
          name: "Zed",
          pluginId: "a-one",
        },
        "z-two": {
          ...cite([{ command: "insert", id: "1" }]),
          name: "Alpha",
          pluginId: "z-two",
        },
      },
      isLive: () => true,
    });
    expect(out.slice(2).map((i) => `${i.detail}:${i.label}`)).toEqual([
      "Alpha:Insert citation",
      "Zed:Pick a source",
      "Zed:Insert citation",
    ]);
  });

  it('D15 — `when: "selection"` shows over a selected word', () => {
    const { text } = selections();
    const contributions = {
      cite: cite([{ command: "insert", id: "m", when: "selection" }]),
    };
    expect(
      labels(withPluginMenuItems(BASE, text, source(contributions))),
    ).toEqual(["Cut", "—", "Insert citation"]);
  });

  it("D15 — …and hides on a caret, a cell, a node and a whole-document selection", () => {
    const contributions = {
      cite: cite([
        { command: "insert", id: "m", when: "selection" },
        { command: "pick", id: "p" },
      ]),
    };
    const shown = (sel: Selection) =>
      labels(withPluginMenuItems(BASE, sel, source(contributions)));
    const { caret } = selections();
    const table = realEditor("| a | b |\n| --- | --- |\n| c | d |\n");
    const code = realEditor("alpha\n\n```\ncode\n```\n\nomega\n");
    editors.push(table.editor, code.editor);
    const cells: number[] = [];
    table.editor.state.doc.descendants((n, pos) => {
      if (n.type.name === "tableCell" || n.type.name === "tableHeader")
        cells.push(pos);
    });
    let codeAt = -1;
    code.editor.state.doc.forEach((n, pos) => {
      if (n.type.name === "codeBlock") codeAt = pos;
    });
    const cell = CellSelection.create(
      table.editor.state.doc,
      cells[0],
      cells[1],
    );
    const node = NodeSelection.create(code.editor.state.doc, codeAt);
    const all = new AllSelection(code.editor.state.doc);
    // The item without `when` stays: the rule drops one item, not the plugin's group.
    const hidden = ["Cut", "—", "Pick a source"];
    expect(shown(caret)).toEqual(hidden);
    expect(shown(cell)).toEqual(hidden);
    expect(shown(node)).toEqual(hidden);
    expect(shown(all)).toEqual(hidden);
    // Those three are non-empty — `!empty` alone would have shown the item (spec D15).
    expect([cell.empty, node.empty, all.empty]).toEqual([false, false, false]);
  });

  it("D8 — clicking an item runs executePluginCommand with the full command id", () => {
    const { caret } = selections();
    const out = withPluginMenuItems(
      BASE,
      caret,
      source({ cite: cite([{ command: "pick", id: "m" }]) }),
    );
    out[2].action();
    expect(execute).toHaveBeenCalledWith("cite.pick");
  });

  it("a command that rejects becomes an error toast, as in the command palette", async () => {
    const { caret } = selections();
    const showToast = vi.fn();
    const original = useUIStore.getState().showToast;
    useUIStore.setState({ showToast });
    try {
      execute.mockRejectedValueOnce(new Error("nope"));
      const out = withPluginMenuItems(
        BASE,
        caret,
        source({ cite: cite([{ command: "pick", id: "m" }]) }),
      );
      out[2].action();
      await vi.waitFor(() =>
        expect(showToast).toHaveBeenCalledWith("Error: nope", "error"),
      );
    } finally {
      useUIStore.setState({ showToast: original });
    }
  });

  it("D16 — title and plugin name lose bidi and control characters, and a long title is capped at 64", () => {
    const { caret } = selections();
    const out = withPluginMenuItems(
      BASE,
      caret,
      source({
        cite: cite(
          [{ command: "insert", id: "m", title: "\u202etxet\u0007 x" }],
          {
            name: "\u2066Cite\u2069",
          },
        ),
      }),
    );
    expect(out[2].label).toBe("txet  x");
    expect(out[2].detail).toBe("Cite");
    const long = withPluginMenuItems(
      BASE,
      caret,
      source({
        cite: cite([{ command: "insert", id: "m" }], {
          commands: [{ id: "insert", title: "y".repeat(100) }],
        }),
      }),
    );
    expect(long[2].label).toBe(`${"y".repeat(63)}…`);
  });

  it("does not open an empty menu with a separator (P14)", () => {
    const { caret } = selections();
    expect(
      labels(
        withPluginMenuItems(
          [],
          caret,
          source({ cite: cite([{ command: "insert", id: "m" }]) }),
        ),
      ),
    ).toEqual(["Insert citation"]);
  });
});
