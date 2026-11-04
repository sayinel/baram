// §395 spec 0074 D16 · §5.6 — the plugin group at the foot of the file tree's row menu, the file tree's
// counterpart of `toolbar/context-menu-plugins.ts`. Pure functions over what the host holds — the tree,
// the selection, the plugins' contributions (`PluginEntrySource`, read when the menu opens) — so no plugin
// code runs to draw an item. `FileTree.tsx` calls both when a row's menu opens; the empty area's menu
// gets no plugin item.
import type { PluginEntrySource } from "../../plugins/plugin-entry-points";
import type {
  FileMenuTarget,
  SandboxFileMenuTarget,
} from "../../plugins/types";
import type { FileEntry } from "../../stores/file/file";

import { MAX_FILE_MENU_TARGETS } from "../../plugins/file-decorations/limits";
import { locateInContext } from "../../plugins/locate-in-context";
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

/** R8 — the hover text of an item drawn disabled for its count. English, like the rest of the tree's menu (spec 0074 §2). */
export const TOO_MANY_TARGETS = `Not available for more than ${MAX_FILE_MENU_TARGETS.toLocaleString("en-US")} items`;

/** R8 — the hover text of a sandboxed plugin's item when a target is in no registered context. */
export const OUTSIDE_EVERY_CONTEXT =
  "Not available: an item is outside every open vault or folder";

/** A plugin item as the menu draws it: runnable, or disabled with the reason as its hover text (plan 0128 R17). */
export type FileTreePluginItem =
  | (FileTreePluginItemBase & { disabledReason: string })
  | (FileTreePluginItemBase & { run: () => void });

interface FileTreePluginItemBase {
  /** The plugin's name (`pluginSourceLabel`), drawn muted beside the label (D16, as §391 D5). */
  detail: string;
  /** `pluginId:itemId` — a React key. */
  key: string;
  /** `fileMenu[].title ?? the command's title`, through the D16 sanitiser of spec 0070. */
  label: string;
}

/**
 * D16 — what the menu hands a command: every selected item, in the selection's order, when the click is
 * inside a selection of two or more — the condition `handleContextMenu` in `FileTree.tsx` applies to the
 * app's own items — else the row clicked. Not folded: a folder and a file inside it both go (as Copy
 * Path, unlike the delete and the move that `pruneNestedPaths`). A selected path `tree` does not hold is
 * left out: nothing prunes the selection when a path leaves the tree (plan 0128 R5). `isDir` of the
 * selected items (the clicked row among them) comes from the same walk; when the clicked row is the only
 * target, from its caller.
 */
export function fileMenuTargets(
  path: string,
  isDir: boolean,
  selectedPaths: ReadonlySet<string>,
  tree: readonly FileEntry[],
): FileMenuTarget[] {
  if (!selectedPaths.has(path) || selectedPaths.size <= 1)
    return [{ isDir, path }];
  const kinds = new Map<string, boolean>();
  const stack = [...tree];
  while (stack.length > 0) {
    const entry = stack.pop();
    if (!entry) continue;
    if (selectedPaths.has(entry.path)) kinds.set(entry.path, entry.isDir);
    if (entry.children) stack.push(...entry.children);
  }
  const targets: FileMenuTarget[] = [];
  for (const selected of selectedPaths) {
    const kind = kinds.get(selected);
    if (kind !== undefined) targets.push({ isDir: kind, path: selected });
  }
  return targets;
}

/**
 * D16 · §5.6 — the plugin items for `targets`: plugins by name (`pluginGroupsByName`), each plugin's in
 * declaration order. An item shows while its plugin's contributions are up and its command has a handler
 * (`source.isLive`, D7 of spec 0070); `when: "file"` only when every target is a file, `"folder"` only
 * when every target is a folder. Drawn disabled, with the reason: every item over `MAX_FILE_MENU_TARGETS`
 * targets, and a sandboxed plugin's items when a target is in no registered context (`locateInContext`
 * gives `null`). The sandboxed form is computed once per menu, and only when a sandboxed plugin's item is
 * drawn within the cap (plan 0128 R7).
 *
 * A click hands the command a fresh copy of its targets through `executePluginCommand`, the entry that
 * grants the §385 prompt rights a click earns; a rejection is the palette's error toast.
 */
export function fileTreePluginItems(
  targets: readonly FileMenuTarget[],
  source: PluginEntrySource,
): FileTreePluginItem[] {
  const allFiles = targets.every((target) => !target.isDir);
  const allFolders = targets.every((target) => target.isDir);
  const tooMany = targets.length > MAX_FILE_MENU_TARGETS;
  let located: null | SandboxFileMenuTarget[] | undefined;
  const sandboxedTargets = (): null | SandboxFileMenuTarget[] => {
    if (located === undefined) located = locateAll(targets);
    return located;
  };
  const items: FileTreePluginItem[] = [];
  for (const { entry, label } of pluginGroupsByName(source.contributions)) {
    for (const item of entry.fileMenu) {
      if (item.when === "file" && !allFiles) continue;
      if (item.when === "folder" && !allFolders) continue;
      const command = declaredCommand(entry, item.command);
      const fullId = `${entry.pluginId}.${item.command}`;
      if (!command || !source.isLive(fullId)) continue;
      const drawn = {
        detail: label,
        key: `${entry.pluginId}:${item.id}`,
        label: sanitizePluginText(
          item.title ?? command.title,
          MAX_ENTRY_TITLE_CHARS,
        ),
      };
      if (tooMany) {
        items.push({ ...drawn, disabledReason: TOO_MANY_TARGETS });
        continue;
      }
      const handed: null | readonly (FileMenuTarget | SandboxFileMenuTarget)[] =
        entry.trust === "sandboxed" ? sandboxedTargets() : targets;
      if (handed === null) {
        items.push({ ...drawn, disabledReason: OUTSIDE_EVERY_CONTEXT });
        continue;
      }
      items.push({
        ...drawn,
        run: () => {
          void executePluginCommand(
            fullId,
            handed.map((target) => ({ ...target })),
          ).catch(reportPluginCommandError);
        },
      });
    }
  }
  return items;
}

/** Each target relative to its context (`locateInContext`), or `null` when one is in no registered context. */
function locateAll(
  targets: readonly FileMenuTarget[],
): null | SandboxFileMenuTarget[] {
  const located: SandboxFileMenuTarget[] = [];
  for (const target of targets) {
    const at = locateInContext(target.path);
    if (at === null) return null;
    located.push({ context: at.context, isDir: target.isDir, path: at.path });
  }
  return located;
}
