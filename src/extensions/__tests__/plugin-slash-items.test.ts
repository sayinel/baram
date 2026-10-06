// §391 spec 0070 §7 · §10 (슬래시) — plugin items at the end of the slash menu.
import type { PluginEntryContributions } from "../../plugins/plugin-ui-store";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { execute, openUrl } = vi.hoisted(() => ({
  execute: vi.fn(async (..._a: unknown[]) => {}),
  openUrl: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl }));
vi.mock("../../plugins/plugin-host-registry", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../plugins/plugin-host-registry")
  >()),
  executePluginCommand: (...a: unknown[]) => execute(...a),
}));

import { realEditor } from "../../plugins/__tests__/real-editor";
import {
  commandHandlers,
  commandOwners,
  registerHostCommandHandler,
} from "../../plugins/plugin-host-registry";
import { usePluginUIStore } from "../../plugins/plugin-ui-store";
import { unregisterPluginUI } from "../../plugins/trusted/ui-api";
import { useAIStore } from "../../stores/ai/ai";
import { useSettingsStore } from "../../stores/settings/store";
import { runSlashItem } from "../plugins/slash-command";
import { buildSlashItems } from "../plugins/slash-command-items";
import { buildPluginSlashItems } from "../plugins/slash-command-items-plugins";
import { createMockEditor } from "./helpers/mock-editor";

function plugin(
  pluginId: string,
  name: string,
  slash: PluginEntryContributions["slash"],
): PluginEntryContributions {
  return {
    commands: [
      { id: "insert", title: "Insert citation" },
      { id: "pick", title: "Pick a source" },
    ],
    menu: [],
    name,
    pluginId,
    slash,
  };
}
const all = () => true;

beforeEach(() => {
  usePluginUIStore.setState({ contributions: {} });
  // Every built-in group on, so the order row below compares a full list
  // (src/extensions/plugins/__tests__/slash-feature-gates.test.ts sets the same flags for the
  // same reason).
  useSettingsStore.setState({
    journalEnabled: true,
    tasksEnabled: true,
    zettelkastenEnabled: true,
  });
  useAIStore.setState({
    aiEnabled: true,
    customCommands: [{ id: "gate-test", name: "Gate Test", prompt: "x" }],
  });
});
afterEach(() => {
  commandHandlers.clear();
  commandOwners.clear();
  execute.mockReset();
});

describe("buildPluginSlashItems (§7)", () => {
  it("one item per slash entry: a namespaced id, its title or the command's, its description, the plugin's category", () => {
    const items = buildPluginSlashItems({
      contributions: {
        cite: plugin("cite", "Cite", [
          {
            command: "insert",
            description: "Insert a citation at the caret",
            id: "cite",
            title: "cite",
          },
          { command: "pick", id: "pick" },
        ]),
      },
      isLive: all,
    });
    expect(
      items.map(({ category, description, id, label }) => ({
        category,
        description,
        id,
        label,
      })),
    ).toEqual([
      {
        category: "Plugin · Cite",
        description: "Insert a citation at the caret",
        id: "plugin:cite.cite",
        label: "cite",
      },
      {
        category: "Plugin · Cite",
        description: "",
        id: "plugin:cite.pick",
        label: "Pick a source",
      },
    ]);
  });

  it("D7 — an item whose command has no handler is left out", () => {
    const items = buildPluginSlashItems({
      contributions: {
        cite: plugin("cite", "Cite", [
          { command: "insert", id: "a" },
          { command: "pick", id: "b" },
        ]),
      },
      isLive: (id) => id === "cite.pick",
    });
    expect(items.map((i) => i.id)).toEqual(["plugin:cite.b"]);
  });

  it("orders plugins by name (not id), and a plugin's items as declared", () => {
    const items = buildPluginSlashItems({
      contributions: {
        "a-one": plugin("a-one", "Zed", [
          { command: "pick", id: "2" },
          { command: "insert", id: "1" },
        ]),
        "z-two": plugin("z-two", "Alpha", [{ command: "insert", id: "1" }]),
      },
      isLive: all,
    });
    expect(items.map((i) => i.id)).toEqual([
      "plugin:z-two.1",
      "plugin:a-one.2",
      "plugin:a-one.1",
    ]);
  });

  it("D6 — two plugins whose names READ the same get their ids; a third keeps its plain name", () => {
    const items = buildPluginSlashItems({
      contributions: {
        "cite-a": plugin("cite-a", "Cite", [{ command: "insert", id: "x" }]),
        // A zero-width space is stripped by pluginSourceLabel: on screen this name is "Cite".
        "cite-b": plugin("cite-b", "Cite\u200b", [
          { command: "insert", id: "x" },
        ]),
        other: plugin("other", "Other", [{ command: "insert", id: "x" }]),
      },
      isLive: all,
    });
    expect(items.map((i) => i.category)).toEqual([
      "Plugin · Cite (cite-a)",
      "Plugin · Cite (cite-b)",
      "Plugin · Other",
    ]);
  });

  it("D16 — label, description and category lose bidi and control characters; label and description are capped", () => {
    const [item] = buildPluginSlashItems({
      contributions: {
        cite: plugin("cite", "\u202eCite", [
          {
            command: "insert",
            description: "d".repeat(130),
            id: "x",
            title: "a\u0007b\u2066c",
          },
        ]),
      },
      isLive: all,
    });
    expect(item.label).toBe("a bc");
    expect(item.description).toBe(`${"d".repeat(119)}…`);
    expect(item.category).toBe("Plugin · Cite");
  });

  it("D8 — choosing an item runs executePluginCommand with the full COMMAND id, not the item id", () => {
    const [item] = buildPluginSlashItems({
      contributions: {
        cite: plugin("cite", "Cite", [{ command: "pick", id: "p" }]),
      },
      isLive: all,
    });
    item.action();
    expect(execute).toHaveBeenCalledWith("cite.pick");
  });
});

describe("buildSlashItems with plugins (§7)", () => {
  it("appends plugin items LAST and leaves every built-in item where it was", () => {
    const before = buildSlashItems(createMockEditor()).map((i) => i.id);
    usePluginUIStore.setState({
      contributions: {
        cite: plugin("cite", "Cite", [{ command: "insert", id: "cite" }]),
      },
    });
    registerHostCommandHandler("cite.insert", () => {}, "cite");
    const after = buildSlashItems(createMockEditor()).map((i) => i.id);
    expect(before.length).toBeGreaterThan(10); // a real list, not an empty one
    expect(after.slice(0, before.length)).toEqual(before);
    expect(after.slice(before.length)).toEqual(["plugin:cite.cite"]);
  });

  it("is gone once the plugin unloads", () => {
    usePluginUIStore.setState({
      contributions: {
        cite: plugin("cite", "Cite", [{ command: "insert", id: "cite" }]),
      },
    });
    registerHostCommandHandler("cite.insert", () => {}, "cite");
    expect(
      buildSlashItems(createMockEditor()).some(
        (i) => i.id === "plugin:cite.cite",
      ),
    ).toBe(true);
    unregisterPluginUI("cite");
    expect(
      buildSlashItems(createMockEditor()).some((i) =>
        i.id.startsWith("plugin:"),
      ),
    ).toBe(false);
  });
});

describe("runSlashItem — the order a plugin item relies on (§7)", () => {
  it("the /query range is already gone when the item's action runs", () => {
    // The range stands for `/cite`. It is spelled without the `/` so the real Suggestion
    // plugin in `createBaramExtensions()` does not open its popup in jsdom — the pin is about
    // `runSlashItem`'s order, not about the popup.
    const { editor, from, to } = realEditor("a @@cite@@ b\n");
    const seen: string[] = [];
    // `executePluginCommand` is the action's first call: record the document at that moment.
    execute.mockImplementationOnce(async () => {
      seen.push(editor.state.doc.textContent);
    });
    const [item] = buildPluginSlashItems({
      contributions: {
        cite: plugin("cite", "Cite", [{ command: "insert", id: "cite" }]),
      },
      isLive: all,
    });
    runSlashItem({ editor, props: item, range: { from, to } });
    expect(seen).toEqual(["a  b"]);
    editor.destroy();
  });
});
