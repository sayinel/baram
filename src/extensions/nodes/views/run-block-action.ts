// Run an async toolbar/menu action of a diagram block, surfacing failure to
// the console AND a visible toast instead of swallowing it — a denied save
// dialog, a missing IPC command, a clipboard/rasterize error. A cancelled
// save dialog is not a failure: the download helpers resolve false for it.
// Shared by the mermaid and svg views and the mermaid block menu (issue 521).
import { useUIStore } from "../../../stores/ui/ui";
import { logger } from "../../../utils/logger";

export function runBlockAction(
  block: string,
  label: string,
  fn: () => Promise<unknown>,
): void {
  fn().catch((err: unknown) => {
    logger.error(`${block}: ${label} failed`, err);
    const msg = err instanceof Error ? err.message : String(err);
    useUIStore.getState().showToast(`${label} failed: ${msg}`);
  });
}
