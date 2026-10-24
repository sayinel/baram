// §56m v28 → v29 migration. A tag colour is keyed by the name the tag panel listed. The panel
// listed a front-matter tag spelled `"#solo"` as `#solo`, so a colour set on that row was keyed
// `#solo`; the panel now lists the tag by its name, `solo`, and that colour would never be read
// again. The migration moves it to the name.
//
// `FROM` is fixed at 28, for the reason `appearance-overrides-migration.test.ts` gives: a value
// derived from the current version would skip this `version < 29` gate once a later migration
// bumps the version again.
import { describe, expect, it } from "vitest";

import { useSettingsStore } from "../settings/store";

const FROM = 28;

function migrate(state: Record<string, unknown>): Record<string, unknown> {
  const fn = useSettingsStore.persist.getOptions().migrate!;
  return fn(state, FROM) as Record<string, unknown>;
}

describe("tagColors keyed by tag name (§56m)", () => {
  // What turns this red: leaving the key as it was — the colour stays under `#solo`, a row
  // the panel no longer lists.
  it("moves a colour keyed with # to the tag's name", () => {
    expect(
      migrate({ tagColors: { "##deep": "#3b82f6", "#solo": "#ef4444" } })
        .tagColors,
    ).toEqual({ deep: "#3b82f6", solo: "#ef4444" });
  });

  // What turns this red: letting the `#` key overwrite — the colour the user set on the
  // body tag's row would change to the one set on the front-matter row.
  it("keeps the colour already under the name, whichever key comes first", () => {
    expect(
      migrate({ tagColors: { "#solo": "#ef4444", solo: "#22c55e" } }).tagColors,
    ).toEqual({ solo: "#22c55e" });
    expect(
      migrate({ tagColors: { solo: "#22c55e", "#solo": "#ef4444" } }).tagColors,
    ).toEqual({ solo: "#22c55e" });
  });

  it("drops a colour keyed only with #s, which names no tag", () => {
    expect(
      migrate({ tagColors: { "#": "#ef4444", x: "#eab308" } }).tagColors,
    ).toEqual({ x: "#eab308" });
  });

  it("leaves other colours, and a store without colours, alone", () => {
    expect(
      migrate({ tagColors: { "a/b": "#8b5cf6", x: "#eab308" } }).tagColors,
    ).toEqual({ "a/b": "#8b5cf6", x: "#eab308" });
    expect(migrate({}).tagColors).toBeUndefined();
  });

  it("does not run again past its gate", () => {
    const current = useSettingsStore.persist.getOptions().version ?? 0;
    const fn = useSettingsStore.persist.getOptions().migrate!;
    const out = fn({ tagColors: { "#solo": "#ef4444" } }, current) as Record<
      string,
      unknown
    >;
    expect(out.tagColors).toEqual({ "#solo": "#ef4444" });
  });
});
