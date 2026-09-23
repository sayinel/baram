// §370 — a reformatting-stable substitute for asserting the exact shape of the two
// ternaries that gate StatusBar/TabBar in App.tsx and ActivityBar in AppLayout.tsx.
//
// App.tsx is 분리 금지 (CLAUDE.md's useEditor stability contract) and nothing in the repo
// renders it directly — the closest precedent for pinning an invariant in it without a
// render is `bootstrap-order.test.ts`'s source scan on main.tsx, which this follows.
// Asserting the literal `rootPath && statusBarVisible ? … : undefined` text would fail on
// a `prettier` rewrap far more often than it would ever catch a real regression, and four
// more tasks in this plan (0096) still touch App.tsx, so that shape WILL move.
//
// What this pins instead, at the level a reformat cannot disturb:
//   1. each of the three §370 visibility flags is at least REFERENCED by the two files
//      that are supposed to gate on it;
//   2. none of the three is consumed through `style=`/`display:` anywhere under `src/` —
//      the CSS-hiding regression §370 explicitly forbids (ui.ts's §370 comment, the
//      render-gate test's header comment, task-2-brief.md's ‼️ item), because a
//      DOM-present-but-invisible surface still sits in the focus order and the
//      screen-reader tree.
//
// ‼️ What this does NOT catch: an inverted condition (`!activityBarVisible &&
// <ActivityBar />`), a condition that reads the flag but never reaches a `return`, or the
// flag being read and then discarded. A mere reference is a weak but reformat-proof
// signal; `chrome-visibility-render-gate.test.tsx` is what actually renders AppLayout and
// checks the DOM for the activity-bar case. This file's job is only to keep App.tsx and
// AppLayout.tsx from losing the reference entirely, and to keep the CSS-hiding regression
// from creeping back in anywhere in `src/`.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = resolve(__dirname, "..");
const UI_STORE = readFileSync(join(SRC, "stores/ui/ui.ts"), "utf8");
const APP = readFileSync(join(SRC, "App.tsx"), "utf8");
const APP_LAYOUT = readFileSync(
  join(SRC, "components/layout/AppLayout.tsx"),
  "utf8",
);

/** The `*Visible` flags declared in ui.ts — derived from the source, not hand-copied, so
 *  a renamed or removed flag changes this list instead of silently going unchecked. */
function chromeVisibilityFlags(): string[] {
  const names = new Set<string>();
  for (const m of UI_STORE.matchAll(/(\w+Visible): boolean;/g)) {
    names.add(m[1]);
  }
  return [...names];
}

/** Every non-test `.ts`/`.tsx` file under `dir`, recursively (same shape as
 *  bootstrap-order.test.ts's `sources()`, duplicated rather than imported — that helper
 *  is a private, unexported function of that file). */
function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name !== "__tests__" && name !== "node_modules") sources(full, out);
    } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

describe("§370 chrome-visibility flags", () => {
  const flags = chromeVisibilityFlags();

  it("has exactly the three flags this plan introduced, so the checks below are not vacuous", () => {
    expect(flags.sort()).toEqual([
      "activityBarVisible",
      "statusBarVisible",
      "tabBarVisible",
    ]);
  });

  it.each(flags)("%s is referenced by App.tsx or AppLayout.tsx", (flag) => {
    const referenced = APP.includes(flag) || APP_LAYOUT.includes(flag);
    expect(
      referenced,
      `${flag} must gate a render in one of the two files`,
    ).toBe(true);
  });

  it.each(flags)(
    "%s is never consumed through style= or display: anywhere under src/",
    (flag) => {
      const offenders: string[] = [];
      for (const file of sources(SRC)) {
        const content = readFileSync(file, "utf8");
        for (const m of content.matchAll(new RegExp(flag, "g"))) {
          const start = Math.max(0, m.index - 150);
          const window = content.slice(start, m.index + flag.length + 150);
          if (/style=|display:/.test(window)) {
            offenders.push(`${file.slice(SRC.length + 1)}: …${window}…`);
          }
        }
      }
      expect(
        offenders,
        "hiding a §370 surface with CSS leaves it in the focus order and the " +
          "screen-reader tree — it must not render instead",
      ).toEqual([]);
    },
  );
});
