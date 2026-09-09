// §85/§92/§93 The space slice of the context store — the journal and
// zettelkasten contexts: finding them, ensuring one exists at the configured
// directory (and moving it when that directory changed, issue 598), keeping
// the space tabs pinned to the front of the tab bar, and keeping the zettel id
// index scoped to the active space. Composed into `useContextStore`
// (`context.ts`) — nothing here is a store of its own. `ContextState` comes in
// as a type only, so the module pair carries no value cycle.
import type { ContextInfo, VaultType } from "../../ipc/types";
import type { ContextState } from "./context";

import { logger } from "../../utils/logger";
import { stripTrailingSeparators } from "../../utils/path-utils";
import { resolveZettelDir } from "../../utils/zettelkasten/zettelkasten";
import { useSettingsStore } from "../settings/store";
import {
  refreshZettelIndex,
  useZettelIndexStore,
} from "../zettelkasten/zettel-index";
import { SpaceDirectoryTakenError } from "./errors";

type SetState = (
  partial:
    ((state: ContextState) => Partial<ContextState>) | Partial<ContextState>,
) => void;

type SpaceContextOpts = Parameters<ContextState["ensureSpaceContext"]>[2];

interface SpaceSlice {
  ensureJournalContext: ContextState["ensureJournalContext"];
  ensureSpaceContext: ContextState["ensureSpaceContext"];
  journalContext: ContextState["journalContext"];
  pinSpaceTabs: ContextState["pinSpaceTabs"];
  spaceContext: ContextState["spaceContext"];
}

/** The space actions, over the store's own `set`/`get`. */
export function createSpaceSlice(
  set: SetState,
  get: () => ContextState,
): SpaceSlice {
  return {
    // §85/§93 No pinning here: every path that registers the context pins —
    // `_addContextTracked` after an add, the move after retiring the old one.
    ensureJournalContext: (journalDir, opts) =>
      get().ensureSpaceContext("journal", journalDir, {
        activate: opts?.activate,
        label: "journal",
        color: "#10b981",
      }),

    ensureSpaceContext: async (vaultType, dir, opts) => {
      const activate = opts?.activate !== false;
      const wanted = stripTrailingSeparators(dir) || dir;
      const existing = get().spaceContext(vaultType) ?? undefined;
      if (existing && existing.path === wanted) {
        // Activate if not active — use local-only to avoid stale ID IPC failures
        if (activate && get().activeContextId !== existing.id) {
          get()._setActiveContextLocal(existing.id);
        }
        return existing;
      }
      // issue 598: a space context at ANOTHER path is the space whose directory
      // setting moved. It used to be returned as-is, so the setting never took
      // effect: writes went to the old directory (or were refused as outside
      // every context) and `refresh_index(newDir)` was refused as unregistered.
      // Register the new directory FIRST — the backend dedups by canonical path
      // and may answer with the very context we hold (a case or symlink
      // spelling of the same directory) — and only then retire the old one.
      // ‼️ Captured BEFORE the add: `_addContextTracked` auto-activates when it
      // appends the first context of an empty store, and a refusal has to put
      // that seat back exactly as it found it.
      const activeBefore = get().activeContextId;
      const { context: created, inserted } = await get()._addContextTracked(
        "vault",
        dir,
        inheritedOptions(vaultType, existing, opts),
      );
      // The backend dedups across ALL contexts, not just this space's. If
      // `dir` is already registered as something else — a plain vault, the
      // other space — `created` is THAT context: taking it as the space's
      // would leave the space with no context of its type (and, on a move,
      // retire the one it had). Refuse, whether or not the space had a
      // context before; what the store held stays exactly as it was.
      if (created.contextType !== "vault" || created.vaultType !== vaultType) {
        refuseTakenDirectory(
          set,
          vaultType,
          dir,
          created,
          inserted,
          activeBefore,
        );
      }
      if (existing && created.id !== existing.id) {
        // Retiring the old registration, re-homing its tabs, re-pinning and
        // switching the view reach the editor store and the loader, both of
        // which import the store — hence the dynamic import, as `editor.ts`
        // reaches `switchContext`.
        const { retireMovedSpaceContext } =
          await import("../../services/space-context-migration");
        await retireMovedSpaceContext(existing, created, {
          activate,
          vaultType,
        });
        return created;
      }
      // Activate the newly created context
      if (activate && get().activeContextId !== created.id) {
        get()._setActiveContextLocal(created.id);
      }
      return created;
    },

    journalContext: () => get().spaceContext("journal"),

    pinSpaceTabs: () => {
      const pinned = pinSpaceContexts(get().contexts);
      if (pinned) set({ contexts: pinned });
    },

    spaceContext: (vaultType) =>
      get().contexts.find(
        (c) => c.contextType === "vault" && c.vaultType === vaultType,
      ) ?? null,
  };
}

/**
 * What a space's context at a new directory is registered with: the context it
 * replaces lends its label, colour and alias; failing that the caller's; the
 * type name is the last resort for the label.
 */
function inheritedOptions(
  vaultType: VaultType,
  existing: ContextInfo | undefined,
  opts: SpaceContextOpts,
): Parameters<ContextState["_addContextTracked"]>[2] {
  return {
    vaultType,
    label: existing?.label ?? opts?.label ?? vaultType,
    color: existing?.color ?? opts?.color,
    alias: existing?.alias,
  };
}

/**
 * §85/§93 Pin the special space contexts to the front of the tab bar in a
 * fixed order: Zettelkasten first (index 0), Journal next. Journal takes
 * index 0 when no Zettelkasten context exists. All other contexts keep their
 * relative order after the pinned spaces.
 * Returns a reordered copy if the order changed, otherwise null. Reached
 * through the `pinSpaceTabs` action, the one place that commits it.
 */
function pinSpaceContexts(contexts: ContextInfo[]): ContextInfo[] | null {
  const zettel =
    contexts.find(
      (c) => c.contextType === "vault" && c.vaultType === "zettelkasten",
    ) ?? null;
  const journal =
    contexts.find(
      (c) => c.contextType === "vault" && c.vaultType === "journal",
    ) ?? null;
  if (!zettel && !journal) return null;

  const rest = contexts.filter((c) => c !== zettel && c !== journal);
  const pinned = [
    ...(zettel ? [zettel] : []),
    ...(journal ? [journal] : []),
    ...rest,
  ];
  // No-op when already in the target order (avoid a needless set/persist).
  if (pinned.every((c, i) => c === contexts[i])) return null;
  return pinned;
}

/**
 * The backend answered a space registration with a context of another kind
 * (the directory is a plain vault, the other space). The backend may hold a
 * context this store does not — a legacy folder root, an entry whose removal
 * never reached Rust — and the add mirrors such an answer into the store. The
 * user did not ask for that tab; a refused setting must leave no trace. Only
 * what THIS call inserted is removed (a concurrent, legitimate add of the same
 * directory is not ours to undo), and Rust's entry is not this call's to
 * remove either.
 */
function refuseTakenDirectory(
  set: SetState,
  vaultType: VaultType,
  dir: string,
  created: ContextInfo,
  inserted: boolean,
  activeBefore: null | string,
): never {
  if (inserted) {
    set((state) => ({
      contexts: state.contexts.filter((c) => c.id !== created.id),
      // ‼️ The seat as well as the list. `_addContextTracked` activates the
      // context it appends when the store was empty, so filtering `contexts`
      // alone leaves — and PERSISTS — an `activeContextId` naming a context
      // the store no longer holds: `activeContext()` is null for good, and the
      // `activeContextId === null` gate that does the auto-activation never
      // fires again, so the next `openFolder` registers a vault that is never
      // activated. Restored only while the seat is still the refused context;
      // a legitimate activation that landed meanwhile is not ours to undo.
      activeContextId:
        state.activeContextId === created.id
          ? activeBefore
          : state.activeContextId,
    }));
  }
  throw new SpaceDirectoryTakenError(vaultType, dir, created);
}

/**
 * §95/§98 M1: Keep the zettel id index scoped to the active zettel space.
 * When the newly active context's path is under the configured zettel dir,
 * refresh the index (covers switching INTO the space via the context tab
 * bar, not just the workspace preset). Otherwise clear it, so stale
 * id→title mappings from a previously active zettel space never leak into
 * an unrelated vault. No-op when the zettelkasten feature is disabled.
 *
 * Note: `resolveZettelDir`'s first (rootPath) argument is unused — only
 * absolute directory settings are supported — so we pass `null` here to
 * avoid importing the file store (which itself imports the context store).
 */
export function syncZettelIndexForContext(ctx: ContextInfo | null): void {
  const { zettelkastenEnabled, zettelkastenDirectory } =
    useSettingsStore.getState();
  if (!zettelkastenEnabled) return;

  const zettelDir = resolveZettelDir(null, zettelkastenDirectory);
  if (!zettelDir) return;

  const prefix = `${zettelDir}/`;
  const inZettelSpace =
    !!ctx && (ctx.path === zettelDir || ctx.path.startsWith(prefix));

  if (inZettelSpace) {
    refreshZettelIndex(zettelDir).catch((err) =>
      logger.error("[contextStore] Failed to refresh zettel index:", err),
    );
  } else {
    useZettelIndexStore.getState().clear();
  }
}
