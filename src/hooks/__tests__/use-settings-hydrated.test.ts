// §296 hydration gate for settings that cannot take back a wrong default.
//
// ‼️ The store is mocked down to its `persist` surface on purpose. The point
// under test is the ORDER this hook observes zustand's persist API in, not
// whether tauriStorage round-trips — driving it through the real store would
// make the one interesting case (hydration landing between render and effect)
// unreproducible, because nothing lets a test place a real IPC reply there.
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const persistState = vi.hoisted(() => ({
  /** Overridable per test — the default just reports `hydrated`. */
  hasHydrated: null as (() => boolean) | null,
  hydrated: false,
  listeners: [] as Array<() => void>,
}));

vi.mock("../../stores/settings/store", () => ({
  useSettingsStore: {
    persist: {
      hasHydrated: () =>
        persistState.hasHydrated
          ? persistState.hasHydrated()
          : persistState.hydrated,
      onFinishHydration: (cb: () => void) => {
        persistState.listeners.push(cb);
        return () => {
          persistState.listeners = persistState.listeners.filter(
            (l) => l !== cb,
          );
        };
      },
    },
  },
}));

import { useSettingsHydrated } from "../use-settings-hydrated";

/** What zustand does when the stored state finally arrives. */
function finishHydration(): void {
  persistState.hydrated = true;
  for (const l of [...persistState.listeners]) l();
}

beforeEach(() => {
  persistState.hydrated = false;
  persistState.hasHydrated = null;
  persistState.listeners = [];
});

describe("useSettingsHydrated (§296)", () => {
  it("reports true immediately when hydration already finished before mount", () => {
    persistState.hydrated = true;
    const { result } = renderHook(() => useSettingsHydrated());
    expect(result.current).toBe(true);
  });

  it("reports false until hydration lands, then flips", () => {
    const { result } = renderHook(() => useSettingsHydrated());
    expect(result.current).toBe(false);

    act(() => {
      finishHydration();
    });
    expect(result.current).toBe(true);
  });

  // The gap that turns a safety gate into a dead switch: `onFinishHydration`
  // fires ONCE. If hydration completes after the initializer read false but
  // before the effect subscribes, the callback has already been and gone, and
  // a hook that only subscribes would report false for the whole session —
  // every embed stuck on the card, for everyone, forever.
  it("still reports true when hydration lands between the initial render and the effect", () => {
    let call = 0;
    persistState.hasHydrated = () => {
      call += 1;
      // 1st call = useState initializer (not yet), 2nd = the effect's
      // re-check (by now it has landed, and no listener ever fires).
      return call > 1;
    };

    const { result } = renderHook(() => useSettingsHydrated());
    expect(result.current).toBe(true);
    expect(persistState.listeners).toHaveLength(0);
  });

  it("unsubscribes on unmount, so a late hydration cannot set state on a dead component", () => {
    const { unmount } = renderHook(() => useSettingsHydrated());
    expect(persistState.listeners).toHaveLength(1);
    unmount();
    expect(persistState.listeners).toHaveLength(0);
  });
});
