// Run an async toolbar/menu action of a diagram block, surfacing failure to
// the console AND a visible toast instead of swallowing it — a denied save
// dialog, a missing IPC command, a clipboard/rasterize error. A cancelled
// save dialog is not a failure: the download helpers resolve false for it.
// Shared by the mermaid and svg views and the mermaid block menu (issue 521).
import type { Locale } from "../../../i18n";

import { t } from "../../../i18n";
import { useSettingsStore } from "../../../stores/settings/store";
import { useUIStore } from "../../../stores/ui/ui";
import { logger } from "../../../utils/logger";

export function runBlockAction(
  block: string,
  /**
   * i18n key for the action's name, NOT the name itself — the toast is UI.
   *
   * A key rather than an already-translated string because two of the call sites are inside
   * `onClick` closures in components that have a `t`, and one is not; passing the key keeps all
   * of them identical and lets the log line stay locale-independent (a translated log entry is
   * unsearchable). `label-key-coverage.test.ts` checks every key here resolves.
   */
  actionKey: string,
  fn: () => Promise<unknown>,
): void {
  fn().catch((err: unknown) => {
    logger.error(`${block}: ${actionKey} failed`, err);
    const msg = err instanceof Error ? err.message : String(err);
    // ‼️ The store, not `useTranslation`: this is called from click handlers and from the
    // mermaid block menu, and it is not a component. Same pattern as `nodeview-ai-menu.ts`.
    const locale = useSettingsStore.getState().locale as Locale;
    useUIStore.getState().showToast(
      t("blockChrome.actionFailed", locale, {
        action: t(actionKey, locale),
        message: msg,
      }),
    );
  });
}
