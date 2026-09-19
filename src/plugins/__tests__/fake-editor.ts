import type { Plugin, PluginKey } from "@tiptap/pm/state";

/**
 * A stand-in for Tiptap's Editor: the two methods this module uses.
 *
 * The real `unregisterPlugin` removes by INTERNAL key prefix. This fake removes by
 * `PluginKey` identity, which is equivalent for our usage — the host mints one key per
 * contribution and passes that exact key back, and ProseMirror's `name$` terminator stops
 * one contribution's key from prefixing another's.
 */
export function fakeEditor() {
  const plugins: Plugin[] = [];
  return {
    plugins,
    keys: () => plugins.map((p) => p.spec.key),
    registerPlugin(plugin: Plugin) {
      plugins.push(plugin);
    },
    unregisterPlugin(key: PluginKey) {
      const i = plugins.findIndex((p) => p.spec.key === key);
      if (i >= 0) plugins.splice(i, 1);
    },
  };
}
