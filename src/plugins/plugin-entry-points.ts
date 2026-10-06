// §391 spec 0070 §5 · D7 — the host's side of a plugin's three entry points (the editor's
// right-click menu, the slash menu, shortcuts): when a plugin's contributions go up, and which
// of its items may be drawn right now. Data only — no plugin code runs to draw an item.
import type {
  PluginEntryCommand,
  PluginEntryContributions,
} from "./plugin-ui-store";
import type { PluginManifest } from "./types";

import { useUIStore } from "../stores/ui/ui";
import { logger } from "../utils/logger";
import { commandHandlers } from "./plugin-host-registry";
import { pluginSourceLabel } from "./plugin-text";
import { usePluginUIStore } from "./plugin-ui-store";

/** What the right-click menu and the slash list read when they open (D7, plan 0118 P5). */
export interface PluginEntrySource {
  contributions: Readonly<Record<string, PluginEntryContributions>>;
  /** Is a handler registered for this full command id (`<pluginId>.<commandId>`) now? */
  isLive: (fullId: string) => boolean;
}

/** A plugin's contributions with the name the entry points draw for it (D5 · D6). */
export interface PluginGroup {
  entry: PluginEntryContributions;
  label: string;
}

/** The declared command `commandId` names, or `undefined`. */
export function declaredCommand(
  entry: PluginEntryContributions,
  commandId: string,
): PluginEntryCommand | undefined {
  return entry.commands.find((command) => command.id === commandId);
}

/**
 * D7 — the handler half of "visible". `.has`, not `.get`: nothing is looked up to run here
 * (spec §9 pins the two files that look a handler up — `execute-plugin-command-callers.test.ts`,
 * whose scan would match that call spelled out in this comment).
 */
export function isPluginCommandLive(fullId: string): boolean {
  return commandHandlers.has(fullId);
}

/** The source as it is at this moment — read when a menu or the slash list opens (D7). */
export function livePluginEntrySource(): PluginEntrySource {
  return {
    contributions: usePluginUIStore.getState().contributions,
    isLive: isPluginCommandLive,
  };
}

/**
 * D5 · D6 — plugins by their drawn name, then by id when two names read the same (plan 0118
 * P23). The right-click menu and the slash list read in this order; shortcut rows go by plugin
 * id instead (spec §7: that order decides which of two plugin keys wins, it is not read).
 */
export function pluginGroupsByName(
  contributions: Readonly<Record<string, PluginEntryContributions>>,
): PluginGroup[] {
  return Object.values(contributions)
    .map((entry) => ({
      entry,
      label: pluginSourceLabel(entry.name, entry.pluginId),
    }))
    .sort(
      (a, b) =>
        a.label.localeCompare(b.label) ||
        compareIds(a.entry.pluginId, b.entry.pluginId),
    );
}

/**
 * §5 — put a plugin's entry points up, AFTER its activation succeeded. Called right before each
 * loader tier records the plugin (`this.loaded.set` in `plugin-loader.ts`) and before a
 * built-in is recorded active (`activateOne` in `plugin-lifecycle.ts`). Earlier would leak: a
 * trusted `activate` that throws or times out is not unwound (`runLoad`), and `activateOne`
 * unwinds nothing. `unregisterPluginUI` takes the entry down; it is called on all four unload
 * paths — `unloadPlugin`, `rollbackSandboxLoad` and `unwindAfterActivate` in `plugin-loader.ts`,
 * and `teardownBuiltin` in `plugin-lifecycle.ts` (2026-10-06; a reload is an unload then a load).
 *
 * Nothing goes up for a plugin that declares no command (plan 0118 P3).
 */
export function registerEntryContributions(manifest: PluginManifest): void {
  const contributions = manifest.contributions;
  const commands = contributions?.commands ?? [];
  if (commands.length === 0) return;
  // D12 — a trusted plugin without `commands` (after consent narrowing: `manifest` is the
  // narrowed one) gets a denying `ctx.commands` and can never register these handlers. Up, its
  // menu and slash items would hide, but its shortcut rows would stay dead for good. The
  // status bar's precedent: `registerDeclaredStatusBar` warns and skips the same way.
  if (
    manifest.trust === "trusted" &&
    !manifest.capabilities.includes("commands")
  ) {
    logger.warn(
      `[PluginLoader] ${manifest.id} declares commands without the "commands" capability — ` +
        `its menu, slash and shortcut entries are not shown`,
    );
    return;
  }
  usePluginUIStore.getState().registerContributions({
    commands: commands.map(({ id, title }) => ({ id, title })),
    menu: contributions?.menu ?? [],
    name: manifest.name,
    pluginId: manifest.id,
    slash: contributions?.slash ?? [],
  });
}

/**
 * A command started from an entry point that rejected becomes an error toast — the one the
 * command palette shows for the same failure.
 */
export function reportPluginCommandError(err: unknown): void {
  useUIStore.getState().showToast(String(err), "error");
}

/** Code-unit order — plugin ids are `^[a-z0-9-]+$`, so this is dictionary order too. */
function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
