// §81/§4.5 Vault context orchestration.
//
// This is an application-level service, not store state: it ties together
// i18n (t), toast (useUIStore), four IPC calls (setVaultRoot, listDir,
// refreshIndex, vault-config get/set), and four other stores (context,
// settings, ui, editor/link) to open/switch a vault context and load its
// file tree. It lives outside stores/file/file.ts so the orchestration no
// longer shares a module with the state it orchestrates. Note that
// stores/editor/editor.ts still reaches switchContext through a lazy
// `import()` ON PURPOSE: a static import there would close a real
// three-module cycle — file.ts → editor.ts (closeFolder needs
// useEditorStore) → this service (setActiveTab's cross-vault auto-switch)
// → file.ts (useFileStore) — and the dynamic edge is what keeps the static
// module graph acyclic.
import type { ContextInfo } from "../ipc/types";

import { type Locale, t } from "../i18n";
import {
  isApprovalDeniedError,
  isPathUnresolvableError,
} from "../ipc/approval";
import {
  getContexts,
  getVaultConfigByPath,
  addContext as registerInRust,
  setVaultConfigByPath,
} from "../ipc/context";
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
 * §333 승인 거부는 오류가 아니라 사용자의 선택이다. 조용히 끝내되 **아무 말도 하지
 * 않으면 안 된다** — 파일 목록이 안 바뀌는 이유를 사용자가 알 길이 이 토스트뿐이다.
 */
function showApprovalDeniedToast(path: string): void {
  const { locale } = useSettingsStore.getState();
  useUIStore
    .getState()
    .showToast(t("approval.denied.toast", locale as Locale, { path }), "info");
}

/**
 * §333 승인 게이트의 두 실패를 **가려서** 말한다. 그 구분이 §333이 전용 에러 코드를
 * 만든 이유다: 삭제된 vault·언마운트된 드라이브를 "허용되지 않았습니다"로 보고하면
 * 사용자는 뜬 적도 없는 다이얼로그를 찾게 된다 (§335 리뷰 I3). 거부는 사용자의 선택이라
 * `info`, 해석 실패는 진짜 오류라 `error`.
 *
 * 처리했으면 true. 그 밖의 실패는 false이고, 호출자가 원래 하던 대로 진행한다.
 */
function reportApprovalFailure(err: unknown, path: string): boolean {
  if (isApprovalDeniedError(err)) {
    showApprovalDeniedToast(path);
    return true;
  }
  if (isPathUnresolvableError(err)) {
    const { locale } = useSettingsStore.getState();
    useUIStore
      .getState()
      .showToast(
        t("approval.unresolvable.toast", locale as Locale, { path }),
        "error",
      );
    return true;
  }
  return false;
}

/**
 * §334 시작 시 건너뛴(아직 미승인) 컨텍스트를 Rust에 등록한다 — 확인 다이얼로그가
 * 뜨는 지점이 여기다. 이미 등록돼 있으면 **건드리지 않는다**: `add_context`는 canonical
 * 경로로 dedup하므로 결과는 같지만 `register_asset_scope`를 매번 다시 부르고, tauri
 * scope는 해제가 없어 패턴이 그대로 쌓인다.
 *
 * 반환값은 "계속 진행해도 되는가". 거부면 false — 호출자는 트리를 읽지 말아야 한다.
 * 거부가 아닌 실패는 오늘 동작을 지킨다(경고 로그 후 계속).
 */
async function ensureRegisteredInRust(ctx: ContextInfo): Promise<boolean> {
  const registered = await getContexts().catch((err) => {
    logger.warn("§334 getContexts failed, leaving registration to Rust", err);
    return null;
  });
  // ‼️ `=== null`이 아니라 `Array.isArray`다. 거절만이 목록을 못 읽는 경우가 아니다 —
  // IPC는 `undefined`로 **resolve**할 수도 있고(테스트 하네스의 기본 invoke가 그렇다),
  // 그러면 `.some`이 TypeError로 터져 컨텍스트 전환 자체가 죽는다.
  //
  // 목록을 못 읽었으면 등록을 시도하지 않는다 — 이미 등록된 경로에 두 번째
  // asset scope를 얹느니, 뒤따르는 setVaultRoot의 게이트에 맡기는 쪽이 안전하다.
  if (
    !Array.isArray(registered) ||
    registered.some((c) => c.path === ctx.path)
  ) {
    return true;
  }
  try {
    await registerInRust(ctx);
  } catch (err) {
    // 해석 실패(삭제된 vault)도 여기서 멈춘다 — 그대로 진행해 봐야 트리 읽기가
    // 실패하고, 그때 뜨는 것은 원인을 말하지 않는 일반 오류 토스트다.
    if (reportApprovalFailure(err, ctx.path)) return false;
    logger.warn("§334 context re-registration failed", err);
  }
  return true;
}

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
  // §333 Approval denial is the user's choice, not an error. Swallowing it
  // and falling through to setVaultRoot would make Rust prompt a second
  // time for the same path, so stop here instead.
  let added;
  try {
    added = await contextStore.addContext(isVault ? "vault" : "folder", path);
  } catch (err) {
    if (isApprovalDeniedError(err)) {
      showApprovalDeniedToast(path);
      return;
    }
    // 해석 실패는 원인을 말해 주되 흐름은 그대로 — 호출자의 오류 처리를 뺏지 않는다.
    reportApprovalFailure(err, path);
    throw err;
  }

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
    // §333 Approval denial is the user's choice, not an error. Swallowing it
    // and falling through to setVaultRoot below would make Rust prompt a
    // second time for the same path, so return early instead. Any other
    // failure keeps today's behavior: log and continue to setVaultRoot.
    try {
      await contextStore.addContext(isVault ? "vault" : "folder", path);
    } catch (err) {
      if (isApprovalDeniedError(err)) {
        showApprovalDeniedToast(path);
        return;
      }
      reportApprovalFailure(err, path);
      logger.warn("§81 openFolder: context registration failed", err);
    }
  } else {
    // Existing context (possibly persisted from previous session)
    // Use local-only activation to avoid IPC failure for stale IDs
    contextStore._setActiveContextLocal(existing.id);
  }

  // §81 Update legacy VaultRootState AFTER context registration
  //
  // §333 이 줄은 두 갈래가 함께 지난다. `existing` 갈래(시작 시 활성 vault 복원,
  // 회수된 루트 다시 열기)는 addContext를 거치지 않으므로 **여기서** 확인
  // 다이얼로그가 뜰 수 있다 — 잡지 않으면 거부가 openFolder 밖으로 던져지고,
  // 호출자 중 `FileTree.tsx`의 `onClick={handleOpenFolder}`는 catch가 없어
  // unhandled rejection이 된다(WKWebView에서 조용히 삼켜진다).
  try {
    await setVaultRoot(path);
  } catch (err) {
    if (isApprovalDeniedError(err)) {
      showApprovalDeniedToast(path);
      return;
    }
    reportApprovalFailure(err, path);
    throw err;
  }

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
  const previousId = contextStore.activeContextId;
  contextStore._setActiveContextLocal(contextId);

  // 2. Update Rust VaultRootState
  if (ctx.contextType !== "file") {
    // §334 여기가 비활성 컨텍스트에 확인 다이얼로그가 뜨는 자리다 — 시작 시에는
    // 승인된 것만 조용히 등록하고 나머지는 건너뛰었으므로, 실제로 전환하는 이
    // 순간에 묻는다. ‼️ setVaultRoot보다 **먼저**여야 한다 (§329.4 순서 제약:
    // 뒤집으면 Rust의 legacy "folder" dedup 때문에 타입이 틀린 채로 등록된다).
    if (!(await ensureRegisteredInRust(ctx))) {
      // §333 거부 — 전환을 되돌린다. 그러지 않으면 탭 강조는 새 컨텍스트인데
      // 파일 트리는 이전 vault인 반쪽 상태로 남는다.
      if (previousId) contextStore._setActiveContextLocal(previousId);
      return;
    }

    try {
      await setVaultRoot(ctx.path);
    } catch (err) {
      // §333 거부를 삼키고 트리를 읽으면, 회수한 루트의 파일 목록이 "거부"를
      // 누른 직후에 그대로 뜬다. 거부는 오류가 아니라 사용자의 선택이다.
      if (reportApprovalFailure(err, ctx.path)) {
        if (previousId) contextStore._setActiveContextLocal(previousId);
        return;
      }
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
