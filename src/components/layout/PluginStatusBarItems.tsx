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
      {items.map((item) =>
        // §260 Phase 4a — an item that declared a command is a button; one that did not
        // stays exactly as it was. A sandboxed plugin's item is registered from the
        // manifest before any of its code runs, so this is the tier's first UI presence.
        item.command ? (
          <button
            className="status-plugin-item btn-unstyled"
            key={item.itemId}
            onClick={() => {
              // The handler routes to `session.invokeCommand`, whose rejection is the
              // plugin's problem, not the status bar's — never let it escape into React.
              void executePluginCommand(item.command!).catch((err: unknown) => {
                logger.error(
                  `[Plugin] status-bar command ${item.command} failed:`,
                  err,
                );
              });
            }}
            title={item.tooltip}
            type="button"
          >
            {item.text}
          </button>
        ) : (
          <span
            className="status-plugin-item cursor-default"
            key={item.itemId}
            title={item.tooltip}
          >
            {item.text}
          </span>
        ),
      )}
    </>
  );
}
