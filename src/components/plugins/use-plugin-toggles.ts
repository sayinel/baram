// §69 — enable/disable, for an installed plugin and for a built-in one. Split out of
// `usePluginActions.ts`, which composes it and returns both handlers unchanged: that file had
// passed the ~500-line threshold (§394), and this half shares no ref or state with its
// install/consent half — `togglingRef` guards these two handlers and nothing else.
//
// A `.ts` for the reason its parent is one: no JSX, only store writes and side effects.
import { useCallback, useRef } from "react";

import { useShallow } from "zustand/shallow";

import {
  activateBuiltin,
  deactivateBuiltin,
} from "../../plugins/plugin-lifecycle";
import { pluginLoader } from "../../plugins/plugin-loader";
import { usePluginStore } from "../../stores/system/plugin";

export function usePluginToggles() {
  const { installedPlugins, setBuiltinEnabled, setEnabled, setError } =
    usePluginStore(
      useShallow((s) => ({
        installedPlugins: s.installedPlugins,
        setBuiltinEnabled: s.setBuiltinEnabled,
        setEnabled: s.setEnabled,
        setError: s.setError,
      })),
    );

  /** Plugin ids whose enable/disable is in flight — see `handleToggleEnabled`. */
  const togglingRef = useRef<Set<string>>(new Set());

  const handleToggleEnabled = useCallback(
    (id: string) => {
      const plugin = installedPlugins[id];
      if (!plugin) return;
      // §260 3c-3 review (M5) — one toggle at a time. The store flips immediately, so
      // a second click read the ALREADY-flipped value and called `unloadPlugin` while
      // the load was still in flight; that unload early-returned (nothing in `loaded`
      // yet), the load then completed, and the session ended with a running, granted
      // sandbox that the UI showed as disabled and nothing would ever tear down.
      if (togglingRef.current.has(id)) return;
      togglingRef.current.add(id);
      const done = () => togglingRef.current.delete(id);

      const newEnabled = !plugin.enabled;
      setEnabled(id, newEnabled);
      if (newEnabled) {
        pluginLoader
          .loadPlugin(plugin.installPath, plugin.manifest)
          .then(
            // Clear the previous failure once the plugin loads. Same defect as the
            // dev-plugin card: the error was written on failure and never removed, so
            // a plugin the user has since fixed kept displaying why it once failed.
            () => setError(id, null),
            (err: unknown) => {
              setError(id, String(err));
              setEnabled(id, false);
            },
          )
          .finally(done);
      } else {
        // `unloadPlugin` swallows a failed teardown by design (`unloadAll` must keep
        // going) and reports it through `pluginErrors` itself — see the loader. This
        // catch covers what still propagates: a synchronous throw from `teardown()`
        // or from the UI sweep. Roll `enabled` back then, so the store never claims
        // a plugin is off while it is still loaded (M3/L4).
        pluginLoader
          .unloadPlugin(id)
          .catch((err: unknown) => {
            setError(id, String(err));
            setEnabled(id, true);
          })
          .finally(done);
      }
    },
    [installedPlugins, setEnabled, setError],
  );

  /**
   * §69 — 내장 토글. 설치본 토글과 같은 형태(스토어 먼저, 그다음 런타임)이지만
   * 로더를 거치지 않는다: 내장은 디스크에 없고 `activateBuiltin`/`deactivateBuiltin`이
   * 그 수명을 소유한다.
   */
  const handleToggleBuiltin = useCallback(
    (id: string, nextEnabled: boolean) => {
      if (togglingRef.current.has(id)) return;
      togglingRef.current.add(id);
      setBuiltinEnabled(id, nextEnabled);
      const run = nextEnabled ? activateBuiltin(id) : deactivateBuiltin(id);
      void run
        .then(
          () => setError(id, null),
          (err: unknown) => {
            setError(id, String(err));
            setBuiltinEnabled(id, !nextEnabled);
          },
        )
        .finally(() => togglingRef.current.delete(id));
    },
    [setBuiltinEnabled, setError],
  );

  return { handleToggleBuiltin, handleToggleEnabled };
}
