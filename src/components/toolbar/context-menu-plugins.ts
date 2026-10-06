// §391 spec 0070 §6 — the plugin group at the foot of the editor's right-click menu. A pure
// function over data the host holds (plan 0118 P5): every `setItems` site in `ContextMenu.tsx`
// passes its items through it, and no plugin code runs to draw an item.
import type { PluginEntrySource } from "../../plugins/plugin-entry-points";
import type { MenuItem } from "./context-menu-types";
import type { Selection } from "@tiptap/pm/state";

import { anchorKindOfSelection } from "../../extensions/plugins/selection-anchors";
import {
  declaredCommand,
  pluginGroupsByName,
  reportPluginCommandError,
} from "../../plugins/plugin-entry-points";
import { executePluginCommand } from "../../plugins/plugin-host-registry";
import {
  MAX_ENTRY_TITLE_CHARS,
  sanitizePluginText,
} from "../../plugins/plugin-text";

/**
 * D15 — what `when: "selection"` means: a non-empty TEXT selection. A cell, node or
 * whole-document selection is non-empty too, but spec 0067's insert refuses a cell selection
 * and replaces a node.
 */
export function isNonEmptyTextSelection(selection: Selection): boolean {
  return !selection.empty && anchorKindOfSelection(selection) === "text";
}

/**
 * `items`, then a separator and each plugin's `menu` items (D5): plugins by name, a plugin's
 * items in declaration order, each labelled `menu[].title ?? the command's title` with the
 * plugin's name as `detail` — both through the D16 sanitiser. An item shows only while its
 * plugin's contributions are up and its command has a handler (D7), and a `when: "selection"`
 * item only over a text selection (D15). With nothing to show it returns `items` itself — no
 * separator; with no `items` it adds no leading separator (plan 0118 P14).
 */
export function withPluginMenuItems(
  items: MenuItem[],
  selection: Selection,
  source: PluginEntrySource,
): MenuItem[] {
  const textSelected = isNonEmptyTextSelection(selection);
  const plugin: MenuItem[] = [];
  for (const { entry, label } of pluginGroupsByName(source.contributions)) {
    for (const item of entry.menu) {
      if (item.when === "selection" && !textSelected) continue;
      const command = declaredCommand(entry, item.command);
      const fullId = `${entry.pluginId}.${item.command}`;
      if (!command || !source.isLive(fullId)) continue;
      plugin.push({
        // D8 — through `executePluginCommand`, the entry that grants the §385 prompt rights a
        // click earns. `MenuList.runItem` closes the menu after this returns.
        action: () => {
          void executePluginCommand(fullId).catch(reportPluginCommandError);
        },
        detail: label,
        label: sanitizePluginText(
          item.title ?? command.title,
          MAX_ENTRY_TITLE_CHARS,
        ),
      });
    }
  }
  if (plugin.length === 0) return items;
  if (items.length === 0) return plugin;
  return [
    ...items,
    { action: () => {}, label: "", separator: true },
    ...plugin,
  ];
}
