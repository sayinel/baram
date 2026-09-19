import type { Plugin, PluginKey } from "@tiptap/pm/state";

/**
 * A stand-in for Tiptap's Editor: the methods this module uses.
 *
 * The real `unregisterPlugin` removes by INTERNAL key prefix. This fake removes by
 * `PluginKey` identity, which is equivalent for our usage — the host mints one key per
 * contribution and passes that exact key back, and ProseMirror's `name$` terminator stops
 * one contribution's key from prefixing another's.
 *
 * `on`/`off`/`emit` are a minimal stand-in for Tiptap's real `EventEmitter` — just enough
 * to let a test fire `"destroy"`, assert what a listener registered via `on("destroy",
 * ...)` does, and check that the listener was taken off again. The real Editor invokes
 * destroy handlers with an event payload; callers here only ever pass zero-arg handlers,
 * so `emit` takes no payload either.
 */
export function fakeEditor() {
  const plugins: Plugin[] = [];
  const listeners = new Map<string, Set<() => void>>();
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
    on(event: string, handler: () => void) {
      let handlers = listeners.get(event);
      if (!handlers) {
        handlers = new Set();
        listeners.set(event, handlers);
      }
      handlers.add(handler);
    },
    off(event: string, handler: () => void) {
      listeners.get(event)?.delete(handler);
    },
    listenerCount: (event: string) => listeners.get(event)?.size ?? 0,
    emit(event: string) {
      for (const handler of listeners.get(event) ?? []) handler();
    },
  };
}
