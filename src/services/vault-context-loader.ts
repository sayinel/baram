// §81/§4.5 Vault context orchestration.
//
// This is an application-level service, not store state: it ties together
// i18n (t), toast (useUIStore), four IPC calls (setVaultRoot, listDir,
// refreshIndex, vault-config get/set), and four other stores (context,
// settings, ui, editor/link) to open/switch a vault context and load its
// file tree. It lives outside stores/file/file.ts specifically so that
// stores/editor/editor.ts can import switchContext() statically — before
// this module existed, editor.ts had to reach switchContext through a lazy
// `import()` to avoid a stores/file/file.ts ↔ stores/editor/editor.ts cycle
// (file.ts imports useEditorStore for closeFolder; editor.ts needed
// switchContext for setActiveTab's cross-vault auto-switch).
import { type Locale, t } from "../i18n";
import { getVaultConfigByPath, setVaultConfigByPath } from "../ipc/context";
import {
  isFolderAccessDeniedError,
  listDir,
  refreshIndex,
  setVaultRoot,
} from "../ipc/invoke";
import { useContextStore } from "../stores/context/context";
import { useLinkStore } from "../stores/editor/link";
import { useFileStore } from "../stores/file/file";
import { buildFileTree } from "../stores/file/file-tree-ops";
import {
  DEFAULT_SORT_ORDER,
  type SortOrder,
} from "../stores/file/file-tree-sort";
import { useSettingsStore } from "../stores/settings/store";
import { useUIStore } from "../stores/ui/ui";
import { logger } from "../utils/logger";

/**
 * §81 Open an additional folder as a new context without replacing the current one.
 * Used by the "+" button in ContextTabBar.
 */
export async function addFolder(path: string): Promise<void> {
  const contextStore = useContextStore.getState();

  // Check if already open — just switch to it
  const existing = contextStore.contexts.find((c) => c.path === path);
  if (existing) {
    await switchContext(existing.id);
    return;
  }

  // Detect vault by loading .baram/config.json (bypasses check_vault).
  // Must run BEFORE setVaultRoot — setVaultRoot registers a legacy "folder"
  // context in Rust, and addContext's dedup would return it with wrong type.
  const { getVaultConfigByPath } = await import("../ipc/context");
  let isVault = false;
  try {
    const cfg = await getVaultConfigByPath(path);
    isVault = cfg.vault !== undefined && cfg.vault !== null;
  } catch {
    // No .baram/config.json or parse error → folder
  }

  // Register context in frontend + Rust FIRST (with correct type)
  const added = await contextStore.addContext(
    isVault ? "vault" : "folder",
    path,
  );

  // §81 Update legacy VaultRootState AFTER addContext (so Rust dedup
  // finds the correctly-typed context we just registered)
  await setVaultRoot(path);

  // Explicitly activate the new context (addContext only auto-activates the first)
  contextStore._setActiveContextLocal(added.id);

  await _loadContextFileTree(path);

  // Update settings (§81 tag the recent entry with vault-ness detected above)
  useSettingsStore.getState().addRecentFolder(path, isVault);
}

/**
 * Open a folder: list its contents recursively, build tree, update store.
 * §81 M2: Does NOT remove existing contexts — supports multi-context.
 */
export async function openFolder(path: string): Promise<void> {
  const contextStore = useContextStore.getState();

  // Check if already open as a context
  const existing = contextStore.contexts.find((c) => c.path === path);
  // §82 Fix: for an already-open context (e.g. startup restore of the active
  // vault via use-app-startup.ts), derive isVault from the known context type
  // instead of defaulting to false — otherwise addRecentFolder(path, false)
  // below would clobber a previously-stored isVault: true (nullish
  // coalescing does not treat `false` as absent).
  let isVault = existing?.contextType === "vault";
  if (!existing) {
    // Detect vault via .baram/config.json (bypasses check_vault).
    // Must run BEFORE setVaultRoot to avoid Rust legacy "folder" dedup.
    const { getVaultConfigByPath } = await import("../ipc/context");
    try {
      const cfg = await getVaultConfigByPath(path);
      isVault = cfg.vault !== undefined && cfg.vault !== null;
    } catch {
      // No .baram/config.json or parse error → folder
    }

    // Register context with correct type FIRST
    await contextStore
      .addContext(isVault ? "vault" : "folder", path)
      .catch((err) => {
        logger.warn("§81 openFolder: context registration failed", err);
      });
  } else {
    // Existing context (possibly persisted from previous session)
    // Use local-only activation to avoid IPC failure for stale IDs
    contextStore._setActiveContextLocal(existing.id);
  }

  // §81 Update legacy VaultRootState AFTER context registration
  await setVaultRoot(path);

  await _loadContextFileTree(path);

  // Update settings
  useSettingsStore.getState().addRecentFolder(path, isVault);
}

/**
 * §81 Switch the active context — updates VaultRootState, reloads file tree + index.
 * Called directly from ContextTabBar click handler (not via subscription).
 */
export async function switchContext(contextId: string): Promise<void> {
  const contextStore = useContextStore.getState();
  const ctx = contextStore.contexts.find((c) => c.id === contextId);
  if (!ctx) return;

  // 1. Update frontend active context (no IPC — avoid potential failures)
  contextStore._setActiveContextLocal(contextId);

  // 2. Update Rust VaultRootState
  if (ctx.contextType !== "file") {
    try {
      await setVaultRoot(ctx.path);
    } catch (err) {
      logger.warn("§81 switchContext: setVaultRoot failed", err);
    }

    // 3. Reload file tree + rebuild link index
    await _loadContextFileTree(ctx.path);
  } else {
    // FileContext: clear file tree
    useFileStore.getState().setRootPath(null as unknown as string);
    useFileStore.getState().setFileTree([]);
    useFileStore.getState().setLoadError(null);
  }
}

/**
 * §81 Internal: Load file tree and index for a context path.
 * Shared by openFolder, addFolder, and switchContext.
 *
 * Exported (despite the leading underscore) so stores/file/file.ts's
 * `retryLoadFileTree` can reach it without re-creating the very cycle this
 * module exists to remove — see the file header.
 */
let _loadingPath: null | string = null;

export async function _loadContextFileTree(path: string): Promise<void> {
  // §81 Prevent concurrent loads for the same path only
  if (_loadingPath === path) return;
  _loadingPath = path;

  try {
    // §4.5 Load the persisted sort order before building the tree; fall back
    // to the DEFAULT order (not the previous vault's in-memory value) if the
    // config read fails or has no saved order, so each vault without its own
    // saved order renders with the default rather than inheriting whatever
    // the last-opened vault happened to use.
    let order: SortOrder = DEFAULT_SORT_ORDER;
    try {
      const cfg = await getVaultConfigByPath(path);
      const saved = cfg.fileTree?.sortOrder;
      if (
        saved === "name-asc" ||
        saved === "name-desc" ||
        saved === "mtime-asc" ||
        saved === "mtime-desc"
      ) {
        order = saved;
      }
    } catch (err) {
      // vault config unreadable → keep default order; tree load must not fail on this
      logger.debug(
        "§4.5 _loadContextFileTree: vault config read failed, using default sort",
        err,
      );
    }
    useFileStore.setState({ fileTreeSortOrder: order });

    const entries = await listDir(path, true);
    const tree = buildFileTree(entries, path, order);
    useFileStore.getState().setRootPath(path);
    useFileStore.getState().setFileTree(tree);
    useFileStore.getState().setLoadError(null); // §4.3 clear prior error on success

    // Build link index in background
    refreshIndex(path)
      .then(() => useLinkStore.getState().invalidate())
      .catch((err) =>
        logger.warn("§81 _loadContextFileTree: refreshIndex failed", err),
      );
  } catch (err) {
    // §4.3 Surface the failure instead of silently leaving an empty tree.
    useFileStore.getState().setRootPath(path); // keep context so the panel renders in place
    useFileStore.getState().setFileTree([]);
    const { locale } = useSettingsStore.getState();
    if (isFolderAccessDeniedError(err)) {
      useFileStore.getState().setLoadError({ kind: "permission-denied", path });
      useUIStore
        .getState()
        .showToast(t("fileTree.accessDenied.toast", locale as Locale), "error");
    } else {
      const message = err instanceof Error ? err.message : String(err);
      useFileStore.getState().setLoadError({ kind: "generic", path, message });
      useUIStore
        .getState()
        .showToast(
          t("fileTree.accessDenied.toastGeneric", locale as Locale),
          "error",
        );
    }
    logger.warn("§4.3 _loadContextFileTree: load failed", err);
    throw err; // §4.3 preserve original resolve/reject contract for openFolder/addFolder/switchContext
  } finally {
    _loadingPath = null;
  }
}

/**
 * §4.5 Persist the active sort order to `.baram/config.json` (read-merge-write).
 * Fire-and-forget: failures are non-fatal since the sort still applies in-session.
 */
export async function persistSortOrder(
  vaultPath: string,
  order: SortOrder,
): Promise<void> {
  try {
    const current = await getVaultConfigByPath(vaultPath);
    await setVaultConfigByPath(vaultPath, {
      ...current,
      fileTree: { ...current.fileTree, sortOrder: order },
    });
  } catch {
    // non-fatal: sort still applies in-session
  }
}
