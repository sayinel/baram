// App startup side effects — migration, onLaunch restore, file open events
import { useEffect, useRef } from "react";

import { listen } from "@tauri-apps/api/event";

import { type Locale, t } from "../i18n";
import {
  isApprovalDeniedError,
  isPathApproved,
  isPathUnresolvableError,
} from "../ipc/approval";
import { getConfig, setConfig } from "../ipc/config";
import {
  setActiveContext as reActivateInRust,
  addContext as reRegisterInRust,
} from "../ipc/context";
import { getOpenedUrls } from "../ipc/invoke";
import { openFolder } from "../services/vault-context-loader";
import { getSpace } from "../spaces";
import { useContextStore } from "../stores/context/context";
import { useSettingsStore } from "../stores/settings/store";
import { useUIStore } from "../stores/ui/ui";
import { logger } from "../utils/logger";

interface UseAppStartupParams {
  handleNewFile: () => void;
  handleOpenFilePath: (path: string) => Promise<void>;
}

/** §89 Track whether queued file-open URLs have been processed (prevents double-open). */
let openedUrlsProcessed = false;

export function useAppStartup({
  handleOpenFilePath,
  handleNewFile,
}: UseAppStartupParams): void {
  // §3.2 The localStorage → Tauri-config migration used to run here. It moved to
  // `main.tsx` (§260 Phase 5 code review, H1): as a child effect it raced the very
  // stores it migrates, and by effect time a module-eval rehydration had already read.

  // onLaunch — restore folder/file on startup
  const onLaunchDone = useRef(false);
  // Capture latest handleNewFile in a ref so the mount-only effect does not need
  // it as a dep (handleNewFile changes identity when `tabs` changes, which would
  // incorrectly re-run the startup restore logic on every tab mutation).
  const handleNewFileRef = useRef(handleNewFile);
  handleNewFileRef.current = handleNewFile;
  useEffect(() => {
    if (onLaunchDone.current) return;
    onLaunchDone.current = true;

    const { onLaunch, lastOpenedFolder, lastOpenedFile } =
      useSettingsStore.getState();

    (async () => {
      // §333 The Rust approval dialog picks its language from `uiLocale`, and this is
      // the last moment before a dialog can appear. See `mirrorUiLocale`.
      await mirrorUiLocale();

      // §81 Re-register persisted contexts in Rust backend BEFORE any file operations.
      // After app restart, Rust ContextManager is empty while Zustand has persisted
      // contexts. Without this, check_vault (via validate_path_any) would fail because
      // no contexts are registered in Rust.
      const contextStore = useContextStore.getState();
      /** §330 결정 2 — 활성 컨텍스트를 사용자가 거부했을 때 그 경로. */
      let deniedActivePath: null | string = null;
      if (contextStore.contexts.length > 0) {
        // §89 Clean up persisted FileContexts — they should not survive restart
        const fileCtxIds = contextStore.contexts
          .filter((c) => c.contextType === "file")
          .map((c) => c.id);
        for (const id of fileCtxIds) {
          await contextStore.removeContext(id).catch(() => {});
        }

        const activeId = useContextStore.getState().activeContextId;
        const staleIds: string[] = [];
        for (const ctx of useContextStore.getState().contexts) {
          const isActive = ctx.id === activeId;

          // §334 컨텍스트가 N개일 때 **시작하자마자 N번 물으면 안 된다.** 확인
          // 다이얼로그는 활성 컨텍스트에서만 뜬다. 나머지는 이미 승인된 것만 조용히
          // 등록하고, 미승인은 건너뛴다 — 사용자가 실제로 그 탭으로 전환할 때
          // `switchContext`가 묻는다.
          //
          // ‼️ "활성 하나만 등록"이 아니라 "승인된 것은 전부 등록"인 이유: Rust의
          // `validate_path_any`(교차 컨텍스트 파일 읽기 — vault B가 활성인데 vault A의
          // 탭이 자기 파일을 읽는 경우)와 `resolve_cross_vault_link`(§87 별칭 표)가
          // **등록된 컨텍스트 전부**를 본다. 활성만 등록하면 승인이 이미 끝난
          // 사용자에게서 그 둘이 조용히 죽는다.
          //
          // ‼️ 판정을 여기서 재구현하지 않는다 — `covers`는 컴포넌트 단위 prefix +
          // canonicalize이고 심링크 해석은 웹뷰에서 불가능하다. Rust에 묻는다.
          if (!isActive) {
            const approved = await isPathApproved(ctx.path).catch((err) => {
              logger.warn("§334 approval probe failed, skipping context", err);
              return false;
            });
            if (!approved) continue;
          }

          try {
            await reRegisterInRust(ctx);
          } catch (err) {
            // §330 결정 2 — 거부는 **세션 한정**이다. 다음 실행에 다시 묻는다.
            // stale로 분류해 지우면 오클릭 한 번에 라벨·색·별칭까지 영속 목록에서
            // 사라진다. 되돌릴 길도 없고 남는 건 로그 한 줄뿐이다.
            if (isApprovalDeniedError(err)) {
              logger.info(
                `§330 Approval denied — context kept for next launch: ${ctx.label} (${ctx.path})`,
              );
              if (isActive) deniedActivePath = ctx.path;
              continue;
            }
            // §90 stale 판정은 **allow-list**다 — "해석 불가"로 확인된 경우에만
            // 지운다. "거부가 아니면 전부 stale"(deny-list)이었을 때는 `approve()`가
            // approved-roots.json을 못 쓰는 무관한 실패(디스크 풀·권한·future
            // ContextManager::add 변경)까지 stale로 분류해 라벨·색·별칭을 영속
            // 목록에서 지워버렸다 — 되돌릴 길 없는 오탐(M3 재검토).
            if (isPathUnresolvableError(err)) {
              logger.warn(
                `§90 Stale context removed: ${ctx.label} (${ctx.path})`,
              );
              staleIds.push(ctx.id);
              continue;
            }
            logger.warn(
              `§90 Context kept — registration failed for a reason unrelated ` +
                `to path validity, not stale: ${ctx.label} (${ctx.path})`,
              err,
            );
          }
        }
        // §90 Remove stale contexts whose paths are no longer valid
        for (const id of staleIds) {
          await contextStore.removeContext(id).catch(() => {});
        }
        // Re-activate the active context in Rust
        const activeIdNow = useContextStore.getState().activeContextId;
        if (activeIdNow) {
          await reActivateInRust(activeIdNow).catch(() => {
            logger.warn("§81 Startup re-activation of active context failed");
          });
        }
      }

      // §330 결정 2 — 활성 컨텍스트를 거부했으면 복원을 여기서 멈춘다. 그대로
      // openFolder로 내려가면 `set_vault_root`가 **같은 경로로 두 번째 다이얼로그**를
      // 띄운다 (§333 — 거부는 기록되지 않으므로 다시 미승인 상태다). 컨텍스트 탭은
      // 그대로 남아 있으니 사용자는 탭을 눌러 다시 시도할 수 있다.
      if (deniedActivePath) {
        const { locale } = useSettingsStore.getState();
        useUIStore.getState().showToast(
          t("approval.denied.toast", locale as Locale, {
            path: deniedActivePath,
          }),
          "info",
        );
        await processOpenedUrls(handleOpenFilePath);
        return;
      }

      // §81 Migration: if contextStore has persisted contexts from previous session,
      // restore them in the backend. If not, fall through to lastOpenedFolder.
      // §81 Restore contexts only if there are vault/folder contexts remaining
      // (FileContexts were already cleaned up above)
      const remainingContexts = useContextStore.getState().contexts;
      if (
        remainingContexts.length > 0 &&
        useContextStore.getState().activeContextId
      ) {
        const activeCtx = useContextStore.getState().activeContext();
        if (activeCtx) {
          try {
            await openFolder(activeCtx.path);
            // Restore last opened file if it's inside the vault (not external)
            if (lastOpenedFile) {
              const parentCtx = useContextStore
                .getState()
                .getContextForPath(lastOpenedFile);
              if (parentCtx && parentCtx.contextType !== "file") {
                await handleOpenFilePath(lastOpenedFile);
              }
            }
            // §85/§92 M2b: Journal startup behavior (registry-driven, self-guarded)
            await getSpace("journal")?.startup?.();
            // §98 Zettelkasten startup behavior (registry-driven, self-guarded)
            await getSpace("zettelkasten")?.startup?.();

            // §89 Process queued file-open requests AFTER vault restoration
            await processOpenedUrls(handleOpenFilePath);
            return; // Done — context restored
          } catch {
            // Path may be invalid; fall through to legacy restore
            logger.warn(
              "§81 Context restore failed, falling back to lastOpenedFolder",
            );
          }
        }
      }

      // Legacy restore path (also serves as first-run migration)
      // §90 Auto-migrate lastOpenedFolder to context if no contexts exist
      if (onLaunch === "restoreLastFolder" && lastOpenedFolder) {
        try {
          await openFolder(lastOpenedFolder);
          useSettingsStore.getState().addRecentFolder(lastOpenedFolder);

          // §90 Migration: create context from legacy lastOpenedFolder
          if (useContextStore.getState().contexts.length === 0) {
            const { getVaultConfigByPath } = await import("../ipc/context");
            try {
              const config = await getVaultConfigByPath(lastOpenedFolder);
              // .baram/config.json exists → VaultContext
              const alias =
                config.vault?.alias ??
                lastOpenedFolder.split("/").pop() ??
                "vault";
              await useContextStore
                .getState()
                .addContext("vault", lastOpenedFolder, { alias });
            } catch {
              // No .baram/config.json → FolderContext
              await useContextStore
                .getState()
                .addContext("folder", lastOpenedFolder);
            }
          }
        } catch {
          /* folder may have been deleted */
        }
      } else if (onLaunch === "restoreLastFile" && lastOpenedFile) {
        try {
          if (lastOpenedFolder) {
            await openFolder(lastOpenedFolder);
            useSettingsStore.getState().addRecentFolder(lastOpenedFolder);
          }
          await handleOpenFilePath(lastOpenedFile);
        } catch {
          /* ignore */
        }
      } else if (onLaunch === "newFile") {
        handleNewFileRef.current();
      }

      // §89 Process any remaining queued file-open URLs (legacy/no-vault path)
      await processOpenedUrls(handleOpenFilePath);
    })();
  }, [handleOpenFilePath]);

  // Listen for file open events from macOS (Finder "Open With" while app is running)
  useEffect(() => {
    // Cold start URLs are now handled inside the first useEffect via
    // processOpenedUrls() — called AFTER vault restoration completes.
    // This effect only handles hot-open events (file opened while running).
    const unlisten = listen<string>("file:open-request", (event) => {
      handleOpenFilePath(event.payload);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [handleOpenFilePath]);
}

/**
 * §333 Rust의 승인 다이얼로그에는 i18n이 없다 — `uiLocale` **플랫** 설정 키에서 언어를
 * 고른다. 그런데 그 미러를 쓰는 곳이 `setLocale`뿐이고, `locale`은 설정 blob 안에
 * 저장되지 플랫 키가 아니다. 그래서 한국어로 쓰던 기존 사용자에게는 `config.json`에
 * `uiLocale`이 아예 없고, 언어를 껐다 켜기 전까지 **영어 다이얼로그**를 본다 —
 * 다이얼로그가 가장 중요한 바로 그 업그레이드 실행에서 (§333 리뷰 I4).
 *
 * 다이얼로그를 띄울 수 있는 첫 IPC보다 **먼저** 한 번 맞춘다.
 *
 * 값이 같으면 쓰지 않는다: `set_config`은 config.json 읽기-수정-쓰기라, 매 실행 무조건
 * 쓰면 아무것도 바뀌지 않는 디스크 쓰기가 된다.
 */
async function mirrorUiLocale(): Promise<void> {
  const { locale } = useSettingsStore.getState();
  try {
    if ((await getConfig("uiLocale")) === locale) return;
    await setConfig("uiLocale", locale);
  } catch (e) {
    logger.warn("§333 startup uiLocale mirror failed", e);
  }
}

/** §89 Process queued file-open requests from macOS file association. */
async function processOpenedUrls(
  handleOpenFilePath: (path: string) => Promise<void>,
): Promise<void> {
  if (openedUrlsProcessed) return;
  openedUrlsProcessed = true;

  let paths: string[];
  try {
    paths = await getOpenedUrls();
  } catch {
    return;
  }
  if (!paths.length) return;

  for (const path of paths) {
    await handleOpenFilePath(path);
  }
}
