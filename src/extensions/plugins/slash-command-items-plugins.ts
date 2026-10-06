// §391 spec 0070 §7 — the slash items of plugins whose contributions are up and whose command
// has a handler right now (D7). `buildSlashItems` appends them LAST. Built from data the host
// holds; no plugin code runs to draw the list.
//
// The first production file under `src/extensions/` that imports `src/plugins/` (plan 0118 P6).
// No cycle: no production file under `src/plugins/` reaches `slash-command*` or
// `src/extensions/index.ts`, directly or transitively (static value-import edges only — `import
// type` and test files do not count; measured when this was written).
import type { SlashMenuItem } from "../../components/command/slash-menu-item";
import type { PluginEntrySource } from "../../plugins/plugin-entry-points";

import {
  declaredCommand,
  pluginGroupsByName,
  reportPluginCommandError,
} from "../../plugins/plugin-entry-points";
import { executePluginCommand } from "../../plugins/plugin-host-registry";
import {
  MAX_ENTRY_DESCRIPTION_CHARS,
  MAX_ENTRY_TITLE_CHARS,
  MAX_SOURCE_CHARS,
  sanitizePluginText,
} from "../../plugins/plugin-text";

/** D6 — the host's word for the group: English in both locales, like the palette's (spec §12). */
const CATEGORY_PREFIX = "Plugin · ";

/**
 * One item per `slash` entry: id `plugin:<pluginId>.<itemId>`, label `slash[].title ?? the
 * command's title`, description `slash[].description ?? ""`, category `Plugin · <name>` —
 * `Plugin · <name> (<id>)` when two plugins whose contributions are up have names that read the
 * same (D6, plan 0118 P21). Plugins by name, a plugin's items as declared. Every string goes
 * through the D16 sanitiser.
 */
export function buildPluginSlashItems(
  source: PluginEntrySource,
): SlashMenuItem[] {
  const groups = pluginGroupsByName(source.contributions);
  const items: SlashMenuItem[] = [];
  for (const { entry, label } of groups) {
    const shared = groups.filter((g) => g.label === label).length > 1;
    const category = shared
      ? `${CATEGORY_PREFIX}${label} (${sanitizePluginText(entry.pluginId, MAX_SOURCE_CHARS)})`
      : `${CATEGORY_PREFIX}${label}`;
    for (const slash of entry.slash) {
      const command = declaredCommand(entry, slash.command);
      const fullId = `${entry.pluginId}.${slash.command}`;
      if (!command || !source.isLive(fullId)) continue;
      items.push({
        // D8 — `runSlashItem` deletes the `/query` range first, then calls this.
        action: () => {
          void executePluginCommand(fullId).catch(reportPluginCommandError);
        },
        category,
        description: sanitizePluginText(
          slash.description ?? "",
          MAX_ENTRY_DESCRIPTION_CHARS,
        ),
        id: `plugin:${entry.pluginId}.${slash.id}`,
        label: sanitizePluginText(
          slash.title ?? command.title,
          MAX_ENTRY_TITLE_CHARS,
        ),
      });
    }
  }
  return items;
}
