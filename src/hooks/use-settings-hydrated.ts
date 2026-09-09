// Whether the persisted settings store has finished rehydrating (§296).
//
// ‼️ Why this exists at all: `tauriStorage` rehydrates ASYNCHRONOUSLY (Rust
// IPC), so between first paint and hydration every selector reads the SLICE
// DEFAULT, not what the user saved. The repo already documents that window —
// see `plugins/plugin-loader.ts`, where a startup load beating rehydration
// reads the initial `locale: "en"`.
//
// For almost every setting that window is harmless: `locale`, `fontSize`,
// `virtualizeLargeDocs` and friends are re-read on the re-render hydration
// triggers, and nothing outside the app observed the wrong value. The
// exception is a setting whose default does something IRREVERSIBLE and
// OUTWARD-FACING before it can be corrected — `autoLoadVideoEmbeds` mounts a
// provider iframe, and that request has already left when hydration lands and
// swaps the card back in. The user who opted out sees a correct-looking card
// and no evidence that anything was sent.
//
// So: gate that kind of setting on this hook and treat "not yet known" as the
// safe value, rather than as the default.
//
// ‼️ Deliberately NOT ended by a failed read. The startup restore's barrier
// (`stores/system/hydration.ts`) is released by `noteHydrationFailure` so a
// corrupt config cannot hang the app; this gate is not, because what it guards
// is that outward request, and on a read that failed "not yet known" stays the
// safe answer for the session. The two gates disagree on purpose.
import { useEffect, useState } from "react";

import { useSettingsStore } from "../stores/settings/store";

export function useSettingsHydrated(): boolean {
  const [hydrated, setHydrated] = useState(() =>
    useSettingsStore.persist.hasHydrated(),
  );

  useEffect(() => {
    // ‼️ Re-check before subscribing. `onFinishHydration` fires once, so
    // hydration landing between this component's render and this effect
    // would never be observed and the gate would stay shut for the whole
    // session — the exact shape that turns a safety gate into a dead switch.
    if (useSettingsStore.persist.hasHydrated()) {
      setHydrated(true);
      return;
    }
    return useSettingsStore.persist.onFinishHydration(() => {
      setHydrated(true);
    });
  }, []);

  return hydrated;
}
