import type { Plugin, PluginKey } from "@tiptap/pm/state";

/**
 * Hooks that stand in for the part of Tiptap's register/unregister that runs AFTER the
 * plugin list has already changed.
 *
 * Both of Tiptap's methods are two steps: `state.reconfigure({ plugins })` first, then
 * `view.updateState(state)` — and `updateState` assigns `view.state` before it renders.
 * So a throw out of the rendering half leaves the new plugin list already in force. A
 * test that throws from a hook here gets that exact shape (the change landed AND the
 * call threw), which is the shape a `registerPlugin` that just pushed could never
 * produce. The fields are read at call time, so a test may arm them after construction.
 */
export interface FakeEditorHooks {
  /** Stands in for the `view.updateState` inside `registerPlugin`. */
  afterRegister?: (plugin: Plugin) => void;
  /**
   * Stands in for the `view.updateState` inside `unregisterPlugin` — which the real one
   * reaches only when the filter actually removed something.
   */
  afterUnregister?: (key: PluginKey) => void;
}

/**
 * A stand-in for Tiptap's Editor: the methods this module uses.
 *
 * The real `unregisterPlugin` removes by INTERNAL key prefix. This fake removes by
 * `PluginKey` identity, which is equivalent for our usage — the host mints one key per
 * contribution and passes that exact key back, and ProseMirror's `name$` terminator stops
 * one contribution's key from prefixing another's. Registering refuses a second plugin
 * carrying a key already present, for the same reason ProseMirror's `Configuration` does:
 * that RangeError is what a plugin left behind by a failed install produces on the next
 * load, so a fake that accepted the duplicate would make a stuck plugin look harmless.
 *
 * `on`/`off`/`emit` are a minimal stand-in for Tiptap's real `EventEmitter` — just enough
 * to let a test fire `"destroy"`, assert what a listener registered via `on("destroy",
 * ...)` does, and check that the listener was taken off again. The real Editor invokes
 * destroy handlers with an event payload; callers here only ever pass zero-arg handlers,
 * so `emit` takes no payload either.
 */
export function fakeEditor(hooks: FakeEditorHooks = {}) {
  const plugins: Plugin[] = [];
  const listeners = new Map<string, Set<() => void>>();
  return {
    hooks,
    plugins,
    keys: () => plugins.map((p) => p.spec.key),
    registerPlugin(plugin: Plugin) {
      if (
        plugin.spec.key &&
        plugins.some((p) => p.spec.key === plugin.spec.key)
      ) {
        const name =
          (plugin.spec.key as unknown as { key?: string }).key ?? "plugin";
        throw new RangeError(
          `Adding different instances of a keyed plugin (${name})`,
        );
      }
      plugins.push(plugin);
      hooks.afterRegister?.(plugin);
    },
    unregisterPlugin(key: PluginKey) {
      const i = plugins.findIndex((p) => p.spec.key === key);
      // The real one returns before touching the view when its filter removed nothing,
      // so removing a key the editor never had cannot fail — not even on an editor
      // whose rendering is broken. Recording a key that may not have landed is safe
      // only because of this, so the fake has to model it.
      if (i < 0) return;
      plugins.splice(i, 1);
      hooks.afterUnregister?.(key);
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
