// §69 — the registry-driven card list. Browse and Updates both iterate the REGISTRY and
// render the same card, so they share one component; what differs is which entries they
// hand it and what Install does.
import type { InstalledPlugin, RegistryEntry } from "../../plugins/types";

import { PluginCard } from "./PluginCard";
import { getPluginStatus } from "./usePluginActions";

/**
 * ‼️ Index signatures rather than `Record<…>`, and not a style preference:
 * `plugin-ui-i18n.test.tsx`'s `proseChildren` scan reads every `>…<` pair in a `.tsx` as
 * JSX text, so two adjacent generic annotations hand it `"; installing: Record"` and it
 * reports hardcoded prose. Braces terminate the scan, which an index signature has and a
 * generic does not. Same class of accommodation as `SECTION_KEY` in
 * `PluginInstalledList.tsx`.
 */
interface PluginBrowseListProps {
  entries: RegistryEntry[];
  installedPlugins: { [id: string]: InstalledPlugin };
  installing: { [id: string]: boolean };
  onInstall: (entry: RegistryEntry) => void;
  onSelect: (entry: RegistryEntry) => void;
  onUninstall: (id: string) => void;
  onUpdate: (entry: RegistryEntry) => void;
  pluginErrors: { [id: string]: string };
  /** Whether to badge this listing as withdrawn — the shell owns that resolution. */
  revoked: (entry: RegistryEntry) => boolean;
  updateAvailable: { [id: string]: string };
}

export function PluginBrowseList({
  entries,
  installedPlugins,
  installing,
  onInstall,
  onSelect,
  onUninstall,
  onUpdate,
  pluginErrors,
  revoked,
  updateAvailable,
}: PluginBrowseListProps) {
  return (
    <>
      {entries.map((entry) => (
        <PluginCard
          entry={entry}
          error={pluginErrors[entry.id]}
          key={entry.id}
          onInstall={() => onInstall(entry)}
          onSelect={() => onSelect(entry)}
          onUninstall={() => onUninstall(entry.id)}
          onUpdate={() => onUpdate(entry)}
          revoked={revoked(entry)}
          status={getPluginStatus(
            entry.id,
            installing,
            installedPlugins[entry.id],
          )}
          updateAvailable={updateAvailable[entry.id]}
        />
      ))}
    </>
  );
}
