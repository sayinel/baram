// §69 Plugin status-bar slot — renders plugin-registered items for one alignment
import type { PluginStatusBarItem } from "../../plugins/plugin-ui-store";

import { useShallow } from "zustand/shallow";

import { executePluginCommand } from "../../plugins/extension-context";
import { usePluginUIStore } from "../../plugins/plugin-ui-store";
import { logger } from "../../utils/logger";

export function PluginStatusBarItems({
  align,
}: {
  align: PluginStatusBarItem["align"];
}) {
  const items = usePluginUIStore(
    useShallow((s) => s.statusBarItems.filter((i) => i.align === align)),
  );
  if (items.length === 0) return null;
  return (
    <>
      {items.map((item) => {
        // §260 Phase 4a — an item that declared a command is a button; one that did not
        // stays exactly as it was. A sandboxed plugin's item comes from its manifest and
        // is registered before its code runs (see `registerDeclaredStatusBar`), so this
        // is the tier's first UI presence.
        const { command } = item;
        if (!command) {
          return (
            <span
              className="status-plugin-item cursor-default"
              key={item.itemId}
              title={item.tooltip}
            >
              {item.text}
            </span>
          );
        }
        return (
          <button
            className="status-plugin-item btn-unstyled"
            // §260 Phase 4a — a declared item exists before its sandbox finishes
            // activating; clicking then would hit a handler that is not registered yet
            // and fail silently (re-review LOW-5).
            disabled={item.pending}
            key={item.itemId}
            onClick={() => {
              // The handler routes to `session.invokeCommand`, whose rejection is the
              // plugin's problem, not the status bar's — never let it escape into React.
              void executePluginCommand(command).catch((err: unknown) => {
                logger.error(
                  `[Plugin] status-bar command ${command} failed:`,
                  err,
                );
              });
            }}
            title={item.pending ? "Plugin is still starting…" : item.tooltip}
            type="button"
          >
            {item.text}
          </button>
        );
      })}
    </>
  );
}
