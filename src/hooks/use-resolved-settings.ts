// §86 Hook that merges global settings with active vault config overrides
import { useEffect, useState } from "react";

import type { VaultConfig } from "../ipc/types";

import { useShallow } from "zustand/shallow";

import { getVaultConfigByPath } from "../ipc/context";
import { useAIStore } from "../stores/ai/ai";
import { useContextStore } from "../stores/context/context";
import { useSettingsStore } from "../stores/settings/store";
import {
  type ResolvedSettings,
  resolveSettings,
} from "../utils/settings-resolve";

/**
 * Returns settings resolved with vault-scoped overrides applied.
 * Re-resolves when the active context or global settings change.
 *
 * Global settings are sourced from multiple stores:
 * - AI model / privacy: useAIStore
 * - Wikilink format / diagrams: useSettingsStore
 * - Journal directory: useSettingsStore
 * - Theme: useSettingsStore
 */
export function useResolvedSettings(): ResolvedSettings {
  const [vaultConfig, setVaultConfig] = useState<null | VaultConfig>(null);
  const activeContextId = useContextStore((s) => s.activeContextId);
  const contexts = useContextStore((s) => s.contexts);

  // Get active context path (only for non-file contexts)
  const activeCtx = contexts.find((c) => c.id === activeContextId);
  const activePath = activeCtx?.contextType !== "file" ? activeCtx?.path : null;

  // Load vault config when active context changes
  useEffect(() => {
    if (!activePath) {
      setVaultConfig(null);
      return;
    }
    getVaultConfigByPath(activePath)
      .then((c) => setVaultConfig(c))
      .catch(() => setVaultConfig(null));
  }, [activePath]);

  // Read AI settings from AI store
  const { aiModel, privacyMode } = useAIStore(
    useShallow((s) => ({
      aiModel: s.model,
      privacyMode: s.privacyMode,
    })),
  );

  // Read relevant global settings from settings store
  const { wikilinkFormat, diagrams, journalDirectory, activeThemeId } =
    useSettingsStore(
      useShallow((s) => ({
        wikilinkFormat: s.wikilinkFormat,
        diagrams: s.diagrams,
        journalDirectory: s.journalDirectory,
        activeThemeId: s.activeThemeId,
      })),
    );

  // Map store fields to resolveSettings' expected shape
  const globalSettings = {
    aiModel,
    privacyMode,
    enableWikilink: wikilinkFormat === "wikilink",
    enableMermaid: diagrams,
    dailyNotesFolder: journalDirectory || undefined,
    themeId: activeThemeId,
  };

  return resolveSettings(globalSettings, vaultConfig);
}
