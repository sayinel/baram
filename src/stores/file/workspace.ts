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
  activityBarVisible: boolean;
  rightPanelMode: RightPanelMode;
  rightPanelOpen: boolean;
  sidebarOpen: boolean;
  sidebarPanel: SidebarPanel;
  statusBarVisible: boolean;
  tabBarVisible: boolean;
}

export interface WorkspacePreset {
  builtIn: boolean;
  /** §343 — translation key for `description`. Built-in only; a custom preset has no key and
   * falls back to its user-typed `description` (see `presetDisplayDescription`). */
  descKey?: string;
  description: string;
  id: string;
  layout: WorkspaceLayout;
  name: string;
  /** §343 — translation key for `name`. Built-in only; a custom preset has no key and falls
   * back to its user-typed `name` (see `presetDisplayName`). */
  nameKey?: string;
}

/**
 * §343 A built-in preset always carries its own i18n keys — narrowing them to required (rather
 * than leaving them optional like `WorkspacePreset` must for custom presets) means tsc catches a
 * missing key the moment a fifth built-in is added, the same shape this branch already uses for
 * `isLLMAllowed(aiEnabled, …)` and `Record<FeatureKey, string>`.
 */
type BuiltinPreset = WorkspacePreset & {
  builtIn: true;
  descKey: string;
  nameKey: string;
};

// --- Built-in Presets (§4.3) ---

export const BUILTIN_PRESETS: BuiltinPreset[] = [
  {
    id: "writing",
    name: "Writing",
    nameKey: "menu.workspace.writing",
    description: "Hide sidebar and focus on the editor.",
    descKey: "settings.workspace.preset.writing.desc",
    builtIn: true,
    layout: {
      sidebarOpen: false,
      sidebarPanel: "files",
      rightPanelOpen: false,
      rightPanelMode: "none",
      // §370 오늘 이 넷은 크롬을 감추지 않는다 — 값이 곧 현재 동작이다.
      activityBarVisible: true,
      statusBarVisible: true,
      tabBarVisible: true,
    },
  },
  {
    id: "zettelkasten",
    name: "Zettel",
    // ‼️ Suffix differs from the id — `zettelkasten` names its menu key `menu.workspace.zettel`.
    // String-assembling `` `menu.workspace.${id}` `` is exactly the bug this key fixes: write it
    // as data, not derive it.
    nameKey: "menu.workspace.zettel",
    description: "Capture ideas fast and refine them into linked notes.",
    descKey: "settings.workspace.preset.zettelkasten.desc",
    builtIn: true,
    layout: {
      // §370 `SpaceLayout`(spaces/types.ts) 은 이 셋을 모르므로 병합한다 —
      // getSpace() 쪽이 옛 넷과 같은 이유로 오늘 크롬을 감추지 않는다.
      ...(getSpace("zettelkasten")?.layout ?? {
        sidebarOpen: true,
        sidebarPanel: "files",
        rightPanelOpen: false,
        rightPanelMode: "none",
      }),
      // 아래 셋은 스프레드 뒤에 와서 늘 이긴다 — 오늘은 안전하다: `SpaceLayout`
      // (spaces/types.ts:19-24)은 이 세 키를 선언하지 않으므로 스프레드가
      // 채울 값이 없다. 코퍼스는 `SpaceDefinition` 타입의 객체 리터럴 전체 —
      // 소스 파일 3개(production 2, test fixture 1)에 있다. 경계는
      // "production 구현"으로 좁힌다: `journal-space.ts`·`zettelkasten-space.ts`
      // 둘만 센다 — `spaces/__tests__/registry.test.ts`의 픽스처는
      // production 코드 경로에 닿지 않으므로 제외한다. 그 둘의 layout을
      // production에서 읽는 지점은 이 스프레드 한 곳뿐이다. (이 문단은 재현
      // 가능한 검색 패턴을 그대로 인용하지 않는다 — 파일 안의 인용은 다시
      // 실행하면 자기 자신도 세어 숫자를 흔든다, CLAUDE.md.) `SpaceLayout`이
      // 이 셋을 갖게 되면 이 줄이 조용히 그 값을 덮어쓰므로, 그때 이 자리를
      // 다시 볼 것.
      activityBarVisible: true,
      statusBarVisible: true,
      tabBarVisible: true,
    },
  },
  {
    id: "journal",
    name: "Journal",
    nameKey: "menu.workspace.journal",
    description: "Open calendar, today's journal, and Memories view together.",
    descKey: "settings.workspace.preset.journal.desc",
    builtIn: true,
    layout: {
      sidebarOpen: true,
      sidebarPanel: "calendar",
      rightPanelOpen: true,
      rightPanelMode: "memories",
      // §370 오늘 이 넷은 크롬을 감추지 않는다 — 값이 곧 현재 동작이다.
      activityBarVisible: true,
      statusBarVisible: true,
      tabBarVisible: true,
    },
  },
  {
    id: "skills",
    name: "Skills",
    nameKey: "menu.workspace.skills",
    description: "Layout optimized for editing LLM Skills files.",
    descKey: "settings.workspace.preset.skills.desc",
    builtIn: true,
    layout: {
      sidebarOpen: true,
      sidebarPanel: "files",
      rightPanelOpen: true,
      rightPanelMode: "properties",
      // §370 오늘 이 넷은 크롬을 감추지 않는다 — 값이 곧 현재 동작이다.
      activityBarVisible: true,
      statusBarVisible: true,
      tabBarVisible: true,
    },
  },
  {
    id: "focus",
    name: "Focus",
    nameKey: "menu.workspace.focus",
    description: "Hide every chrome surface and focus on the editor alone.",
    descKey: "settings.workspace.preset.focus.desc",
    builtIn: true,
    // §370.2 포커스 모드는 상태들의 프리셋이지 별도 모드 플래그가 아니다 —
    // 다섯 표면을 전부 감추는 값 하나로 충분하다. `PRESET_FEATURE` 에는
    // 넣지 않는다: 포커스는 어느 기능에도 속하지 않으므로, 넣으면 기능
    // 하나를 끈 사용자가 포커스 모드를 잃는다(위 `PRESET_FEATURE` 주석 참조).
    layout: {
      activityBarVisible: false,
      rightPanelMode: "none",
      rightPanelOpen: false,
      sidebarOpen: false,
      sidebarPanel: "files",
      statusBarVisible: false,
      tabBarVisible: false,
    },
  },
];

/**
 * §343 The one place that decides a preset's displayed NAME. `StatusBar` and `AppearanceTab`
 * both used to carry their own ternary (`preset.builtIn ? t(...) : preset.name`), and one of
 * them (`StatusBar`) skipped the `t()` call entirely — a duplicated branch is exactly how that
 * kind of surface drifts from the other. `translate` takes one argument (not a
 * locale-and-params tuple) so a component's already locale-bound `const { t } = useTranslation()`
 * passes straight through.
 */
export function presetDisplayName(
  preset: WorkspacePreset,
  translate: (key: string) => string,
): string {
  return preset.nameKey ? translate(preset.nameKey) : preset.name;
}

/** §343 The DESCRIPTION counterpart to `presetDisplayName` — same shared-resolver reasoning. */
export function presetDisplayDescription(
  preset: WorkspacePreset,
  translate: (key: string) => string,
): string {
  return preset.descKey ? translate(preset.descKey) : preset.description;
}

/**
 * §338/I-8 어느 프리셋이 어느 기능에 속하는가. 기능이 꺼지면 이 프리셋은
 * StatusBar 드롭다운·workspace-presets.tsx 목록에서 사라지고(`isPresetVisible`),
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
 * 표를 읽는 유일한 함수 — `StatusBar.tsx`와 `workspace-presets.tsx`가 각자 지역
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
  /**
   * §370 `opts.implicit` 는 사용자가 고르지 않은 전이(현재는
   * `revertSpaceIfContextClosed` 하나)를 가리킨다 — 사이드바 적용이 그
   * 구분으로 갈린다(§82, applyPreset 본문의 주석 참조). 생략하면 명시적
   * 호출이다.
   */
  applyPreset: (id: string, opts?: { implicit?: boolean }) => void;

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

      applyPreset: (id, opts) => {
        const preset = get().getPreset(id);
        if (!preset) return;

        // §338/I-8 One chokepoint for "does this preset need a feature on":
        // PRESET_FEATURE also drives the StatusBar dropdown and
        // workspace-presets.tsx's gallery filter (isPresetVisible below), so
        // the id set this blocks and the id set those two hide from is the
        // SAME map, not two hand-kept copies that can drift.
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

        // §370 옛 사용자 프리셋에는 이 셋이 없다 — `partialize` 가 `customPresets`
        // 를 저장하므로 디스크에 있는 것은 그것뿐이고, 내장 넷은 코드에서 온다.
        // 없으면 **보임**이 옳다: 저장되던 시절에는 감출 수단이 없었으므로 저장된
        // 화면이 곧 전부 보이는 화면이었다. `?? true` 는 `false` 를 살린다.
        //
        // 위 `rightPanelMode` 와 같은 자리·같은 이유다(§4.2) — 영속 `version` 을
        // 올리는 대신 적용 시점에 떨어뜨린다. 관문이 하나면 어긋날 곳이 없다.
        const activityBarVisible = layout.activityBarVisible ?? true;
        const statusBarVisible = layout.statusBarVisible ?? true;
        const tabBarVisible = layout.tabBarVisible ?? true;

        // Apply layout to ui-store.
        // §82/§370 이 주석은 바로 아래 사이드바 if/else-if 블록(다음 5줄)에만
        // 걸린다 — 그 뒤 sidebarPanel·rightPanelOpen·rightPanelMode 적용은
        // 명시/암묵을 가리지 않고 그대로 대칭이다(크롬 적용은 별도 예외가
        // 있다 — `setChromeVisibility` 호출 바로 위 주석 참조).
        //
        // 사이드바만 여기서 비대칭이다: 암묵적 적용(`revertSpaceIfContextClosed`
        // 하나뿐)은 사용자가 고른 적 없는 전이라, 열어 둔 폴더 트리를 빼앗지
        // 않는다. 명시적 선택은 레이아웃을 그대로 지킨다 — 그러지 않으면
        // `writing`("Hide sidebar and focus on the editor")과 `focus` 가
        // 이름·설명·레이아웃으로는 감춘다고 말하면서 동작만 다른 상태가 된다.
        if (opts?.implicit) {
          if (layout.sidebarOpen && !ui.sidebarOpen) ui.toggleSidebar();
        } else if (ui.sidebarOpen !== layout.sidebarOpen) {
          ui.toggleSidebar();
        }
        ui.setSidebarPanel(layout.sidebarPanel);
        if (ui.rightPanelOpen !== rightPanelOpen) ui.toggleRightPanel();
        ui.setRightPanelMode(rightPanelMode);
        // §82/§370 암묵적 적용은 크롬을 아예 건드리지 않는다 — 사이드바의
        // "열기만" 규칙과는 다른 처리다. 사이드바는 프리셋이 정당하게 무언가를
        // 드러낼 수 있어 여는 것만 허용하지만, 크롬엔 그런 사례가 없다: 되돌림
        // 대상은 늘 `writing` 하나뿐이므로 크롬을 도로 켜는 것은 정확히 우리가
        // 배제하려는 그 override 다. 코퍼스: 암묵 호출자는
        // `revertSpaceIfContextClosed` 하나뿐이다(§82).
        if (!opts?.implicit) {
          ui.setChromeVisibility({
            activityBarVisible,
            statusBarVisible,
            tabBarVisible,
          });
        }

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
        // §82/§370 Revert implicitly — the user never chose this transition
        // (the context tab closed out from under them), so it must not take
        // an open folder tree away. `{ implicit: true }` routes applyPreset
        // into its asymmetric sidebar branch (open-only, never close),
        // keeping the tree exactly as it was.
        get().applyPreset("writing", { implicit: true });
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
            // §370 현재 크롬 가시성도 함께 스냅샷한다 — 다른 넷과 같은 자리·이유다.
            activityBarVisible: ui.activityBarVisible,
            statusBarVisible: ui.statusBarVisible,
            tabBarVisible: ui.tabBarVisible,
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
