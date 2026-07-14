// §69 Plugin status-bar slot — renders plugin-registered items for one alignment
import type { PluginStatusBarItem } from "../../plugins/plugin-ui-store";

import { useShallow } from "zustand/shallow";

import { usePluginUIStore } from "../../plugins/plugin-ui-store";

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
      {items.map((item) => (
        <span className="status-plugin-item cursor-default" key={item.itemId}>
          {item.text}
        </span>
      ))}
    </>
  );
}
