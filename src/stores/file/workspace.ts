// §52 Workspace 프리셋 스토어
import type { VaultType } from "../../ipc/types";
import type { FeatureKey } from "../settings/feature-keys";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { type Locale, t } from "../../i18n";
import { reportSpaceDirectoryTaken } from "../../services/space-context-migration";
import { switchContext } from "../../services/vault-context-loader";
import { getSpace } from "../../spaces";
import { featureReady } from "../../utils/feature-gate";
import { resolveJournalDir } from "../../utils/journal/journal";
import { logger } from "../../utils/logger";
import {
  ensureZettelkastenScaffold,
  resolveZettelDir,
} from "../../utils/zettelkasten/zettelkasten";
import { useContextStore } from "../context/context";
import { useSettingsStore } from "../settings/store";
import { tauriStorage } from "../system/tauri-storage";
import {
  isRightPanelMode,
  type RightPanelMode,
  type SidebarPanel,
  useUIStore,
} from "../ui/ui";
import { refreshZettelIndex } from "../zettelkasten/zettel-index";
import { useFileStore } from "./file";

// --- Types ---

export interface WorkspaceLayout {
  rightPanelMode: RightPanelMode;
  rightPanelOpen: boolean;
  sidebarOpen: boolean;
  sidebarPanel: SidebarPanel;
}

export interface WorkspacePreset {
  builtIn: boolean;
  description: string;
  id: string;
  layout: WorkspaceLayout;
  name: string;
}

// --- Built-in Presets (§4.3) ---

export const BUILTIN_PRESETS: WorkspacePreset[] = [
  {
    id: "writing",
    name: "Writing",
    description: "Hide sidebar and focus on the editor.",
    builtIn: true,
    layout: {
      sidebarOpen: false,
      sidebarPanel: "files",
      rightPanelOpen: false,
      rightPanelMode: "none",
    },
  },
  {
    id: "zettelkasten",
    name: "Zettel",
    description: "Capture ideas fast and refine them into linked notes.",
    builtIn: true,
    layout: getSpace("zettelkasten")?.layout ?? {
      sidebarOpen: true,
      sidebarPanel: "files",
      rightPanelOpen: false,
      rightPanelMode: "none",
    },
  },
  {
    id: "journal",
    name: "Journal",
    description: "Open calendar, today's journal, and Memories view together.",
    builtIn: true,
    layout: {
      sidebarOpen: true,
      sidebarPanel: "calendar",
      rightPanelOpen: true,
      rightPanelMode: "memories",
    },
  },
  {
    id: "skills",
    name: "Skills",
    description: "Layout optimized for editing LLM Skills files.",
    builtIn: true,
    layout: {
      sidebarOpen: true,
      sidebarPanel: "files",
      rightPanelOpen: true,
      rightPanelMode: "properties",
    },
  },
];

/**
 * §338/I-8 어느 프리셋이 어느 기능에 속하는가. 기능이 꺼지면 이 프리셋은
 * StatusBar 드롭다운·AppearanceTab 목록에서 사라지고(`isPresetVisible`),
 * `applyPreset`도 적용 시점에 한 번 더 막는다(렌더 필터를 우회해도 진입은
 * 막힌다) — 셋 다 이 맵 하나를 쓴다.
 *
 * ‼️ 여기 없는 프리셋 id는 늘 보인다 — `writing`·`skills`는 기능이 아니다
 * (활동표시줄의 `ACTIVITY_BAR_ITEM_FEATURE`와 같은 형태: 없으면 always-on).
 * 커스텀 프리셋도 이 맵에 없으므로 늘 보인다 — 사용자가 만든 것이고 필터
 * 대상이 아니다(그리고 `applyPreset`은 이 맵으로만 분기하므로 커스텀 프리셋
 * id는 애초에 여기 걸리지 않는다).
 */
export const PRESET_FEATURE: Readonly<Record<string, FeatureKey>> = {
  journal: "journal",
  zettelkasten: "zettelkasten",
};

/**
 * 이 프리셋이 기능 게이트를 통과하는가. 기능에 속하지 않는 프리셋과 커스텀
 * 프리셋(둘 다 맵에 없음)은 늘 통과한다.
 *
 * 표를 읽는 유일한 함수 — `StatusBar.tsx`와 `AppearanceTab.tsx`가 각자 지역
 * 클로저로 이 로직을 복제하면 표류면이 생긴다(`ACTIVITY_BAR_ITEM_FEATURE`와
 * 같은 이유로 `isActivityBarItemVisible`을 공유 함수로 뒀다).
 */
export function isPresetVisible(
  id: string,
  flags: Record<FeatureKey, boolean>,
): boolean {
  const feature = PRESET_FEATURE[id];
  return feature === undefined || flags[feature];
}

// --- Store ---

interface WorkspaceState {
  activePresetId: null | string;
  applyPreset: (id: string) => void;

  customPresets: WorkspacePreset[];
  deleteCustomPreset: (id: string) => void;
  getAllPresets: () => WorkspacePreset[];
  getPreset: (id: string) => undefined | WorkspacePreset;
  renameCustomPreset: (id: string, name: string) => void;
  /**
   * §82 Revert to the Writing space when the context backing the current
   * space (journal/zettelkasten) is closed from the context tab bar.
   */
  revertSpaceIfContextClosed: (closedVaultType?: VaultType) => void;
  saveCustomPreset: (name: string, description?: string) => string;
}

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set, get) => ({
      activePresetId: null,
      customPresets: [],

      applyPreset: (id) => {
        const preset = get().getPreset(id);
        if (!preset) return;

        // §338/I-8 One chokepoint for "does this preset need a feature on":
        // PRESET_FEATURE also drives the StatusBar dropdown and AppearanceTab
        // list filters (isPresetVisible below), so the id set this blocks and
        // the id set those two hide from is the SAME map, not two hand-kept
        // copies that can drift.
        const feature = PRESET_FEATURE[id];
        if (feature && !featureReady(feature)) return;

        // §93 The Zettel space also needs a directory set — featureReady above
        // already handled (and toasted for) the feature being off.
        // Guide the user with a toast instead of switching into an empty space.
        if (id === "zettelkasten") {
          const { locale, zettelkastenDirectory } = useSettingsStore.getState();
          if (
            !resolveZettelDir(
              useFileStore.getState().rootPath,
              zettelkastenDirectory,
            )
          ) {
            useUIStore
              .getState()
              .showToast(t("space.zettel.noDirectory", locale as Locale));
            return;
          }
        }

        // §85 The Journal space has the same contract as Zettel: the feature enabled
        // (featureReady above) and a directory that resolves. It used to just skip
        // its open step, so "Open Today's Journal" (which routes here) swapped the
        // panels and opened nothing — and the palette closes before the action
        // runs, leaving no signal at all. `resolveJournalDir` rejects relative
        // paths, so an unresolvable directory is as much a dead end as an empty
        // setting.
        if (id === "journal") {
          const { journalDirectory, locale } = useSettingsStore.getState();
          if (
            !resolveJournalDir(
              useFileStore.getState().rootPath,
              journalDirectory,
            )
          ) {
            useUIStore
              .getState()
              .showToast(t("space.journal.noDirectory", locale as Locale));
            return;
          }
        }

        const ui = useUIStore.getState();
        const { layout } = preset;

        // §4.2 A preset persisted before a RightPanelMode was removed (e.g. the
        // deleted "help" mode) carries a mode string no panel component owns —
        // every one of them `return null`s for a mode that isn't theirs, so
        // open:true + an unrecognized mode renders an empty column with no way
        // back. Fall back to "none" and force the panel closed rather than
        // trusting the stale open flag.
        const rightPanelMode = isRightPanelMode(layout.rightPanelMode)
          ? layout.rightPanelMode
          : "none";
        const rightPanelOpen =
          rightPanelMode === layout.rightPanelMode
            ? layout.rightPanelOpen
            : false;

        // Apply layout to ui-store.
        // §82 Preserve an open folder tree across space switches: a preset may
        // OPEN the sidebar but must never force-close one the user has open.
        if (layout.sidebarOpen && !ui.sidebarOpen) ui.toggleSidebar();
        ui.setSidebarPanel(layout.sidebarPanel);
        if (ui.rightPanelOpen !== rightPanelOpen) ui.toggleRightPanel();
        ui.setRightPanelMode(rightPanelMode);

        // §85 M2b: When switching away from journal, activate the first non-journal context
        if (id !== "journal") {
          const contextStore = useContextStore.getState();
          const activeCtx = contextStore.activeContext();
          if (activeCtx?.vaultType === "journal") {
            const firstNonJournal = contextStore.contexts.find(
              (c) => c.vaultType !== "journal",
            );
            if (firstNonJournal) {
              contextStore
                .setActiveContext(firstNonJournal.id)
                .catch((err) =>
                  logger.error(
                    "[Workspace] Failed to switch from journal:",
                    err,
                  ),
                );
            }
          }
        }

        set({ activePresetId: id });

        // §85 M2b: Journal preset — activate journal context + open today's file
        if (id === "journal") {
          // No re-check of journalEnabled/resolvedDir here: the guard above returned
          // early for both, so an inner `if` would be dead code claiming a doubt that
          // no longer exists.
          const { journalDirectory } = useSettingsStore.getState();
          const { rootPath } = useFileStore.getState();
          const resolvedDir = resolveJournalDir(rootPath, journalDirectory);
          if (resolvedDir) {
            (async () => {
              try {
                const ctx = await useContextStore
                  .getState()
                  .ensureJournalContext(resolvedDir);
                await getSpace("journal")?.newFileFlow?.();
                // Load the journal's tree, exactly as the zettel branch does above.
                // `ensureJournalContext` activates the context but the subscription in
                // file.ts syncs `rootPath` ALONE (its own comment says so) — the note
                // that used to sit here claimed the subscription switched the tree,
                // which was false: `rootPath` pointed at the journal while `fileTree`
                // still held the previous vault, so the Files panel, new-file paths and
                // QuickSwitcher's relative paths all disagreed with each other. Run it
                // after newFileFlow so today's entry is in the tree it loads.
                await switchContext(ctx.id);
              } catch (err) {
                if (!reportSpaceDirectoryTaken(err)) {
                  logger.error("[Workspace] Failed to open journal:", err);
                }
              }
            })();
          }
        }

        // §93 Zettelkasten preset — activate context + ensure scaffold folders
        if (id === "zettelkasten") {
          const { zettelkastenEnabled, zettelkastenDirectory } =
            useSettingsStore.getState();
          const { rootPath } = useFileStore.getState();
          const resolvedDir = resolveZettelDir(rootPath, zettelkastenDirectory);
          if (zettelkastenEnabled && resolvedDir) {
            (async () => {
              try {
                // Register the zettel dir as a context FIRST — createDir/writeFile
                // are vault-constrained (check_vault → validate_path_any), so the
                // scaffold folders can only be created after the dir is a
                // registered context. (Otherwise createDir throws "Access denied",
                // aborting this whole block: no folders, no context, no index.)
                const ctx = await useContextStore
                  .getState()
                  .ensureSpaceContext("zettelkasten", resolvedDir, {
                    label: "Zettel",
                  });
                await ensureZettelkastenScaffold(resolvedDir);
                await refreshZettelIndex(resolvedDir);
                // Load the file tree for the zettel dir — ensureSpaceContext
                // activates the context locally but does NOT load its tree
                // (only switchContext/openFolder do), except when the directory
                // setting moved (issue 598): then it has switched already and
                // this is a second, harmless load. Without this the sidebar
                // keeps showing the previous vault's tree until the user clicks
                // the context tab. inbox/ + notes/ now exist, so load them here.
                await switchContext(ctx.id);
                await getSpace("zettelkasten")?.startup?.();
              } catch (err) {
                if (!reportSpaceDirectoryTaken(err)) {
                  logger.error("[Workspace] Failed to open zettelkasten:", err);
                }
              }
            })();
          }
        }
      },

      revertSpaceIfContextClosed: (closedVaultType) => {
        // The Journal/Zettelkasten spaces are each backed by a single context
        // (maxInstances=1). When the user closes that context from the tab bar
        // while its space is the active one, fall back to the Writing space so
        // the layout + space indicator no longer point at a space that is gone.
        if (
          closedVaultType !== "journal" &&
          closedVaultType !== "zettelkasten"
        ) {
          return;
        }
        // Preset ids ("journal"/"zettelkasten") match the VaultType strings.
        if (get().activePresetId !== closedVaultType) return;
        // applyPreset preserves an open folder tree (it never force-closes the
        // sidebar), so reverting to Writing keeps the tree exactly as it was.
        get().applyPreset("writing");
      },

      saveCustomPreset: (name, description) => {
        const ui = useUIStore.getState();
        const id = `custom-${Date.now()}`;
        const preset: WorkspacePreset = {
          id,
          name,
          description: description ?? "",
          builtIn: false,
          layout: {
            sidebarOpen: ui.sidebarOpen,
            sidebarPanel: ui.sidebarPanel,
            rightPanelOpen: ui.rightPanelOpen,
            rightPanelMode: ui.rightPanelMode,
          },
        };
        set((state) => ({
          customPresets: [...state.customPresets, preset],
          activePresetId: id,
        }));
        return id;
      },

      deleteCustomPreset: (id) => {
        set((state) => ({
          customPresets: state.customPresets.filter((p) => p.id !== id),
          activePresetId:
            state.activePresetId === id ? null : state.activePresetId,
        }));
      },

      renameCustomPreset: (id, name) => {
        set((state) => ({
          customPresets: state.customPresets.map((p) =>
            p.id === id ? { ...p, name } : p,
          ),
        }));
      },

      getAllPresets: () => [...BUILTIN_PRESETS, ...get().customPresets],

      getPreset: (id) => {
        const builtin = BUILTIN_PRESETS.find((p) => p.id === id);
        if (builtin) return builtin;
        return get().customPresets.find((p) => p.id === id);
      },
    }),
    {
      name: "baram:workspace",
      storage: createJSONStorage(() => tauriStorage),
      partialize: (state) => ({
        activePresetId: state.activePresetId,
        customPresets: state.customPresets,
      }),
      version: 1,
    },
  ),
);
