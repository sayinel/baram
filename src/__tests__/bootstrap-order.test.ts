// §260 Phase 5 — invariants of the `main.tsx` bootstrap.
//
// Phase 5 turned `main.tsx` from "import App, render" into an async bootstrap, because a
// one-time data migration has to complete before any store is created. That bought two
// new ways to break the app which nothing else in the suite can see, and both were found
// in review rather than by a test:
//
//   1. The migration must be AWAITED and the app graph imported DYNAMICALLY after it.
//      React runs child effects before parent ones, so as a component effect the sweep
//      raced the stores it migrates; and a static `import App` evaluates every store
//      module in the graph, one of which rehydrates at module-eval time.
//   2. The stylesheet must be imported from the ENTRY module. Imported from `App`, it is
//      bound to a dynamically-imported chunk, so `dist/index.html` carries no
//      `<link rel="stylesheet">` and 320 KB of CSS cannot start loading until the
//      migration's IPC round trips and both dynamic imports have resolved — a blank,
//      unstyled window on every cold start.
//
// Source scans, because neither has a runtime moment to catch: the first only misbehaves
// against a populated localStorage on a real upgrade, and the second is invisible until
// someone watches a packaged build start.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = resolve(__dirname, "..");
const MAIN = readFileSync(join(SRC, "main.tsx"), "utf8");

describe("main.tsx bootstrap (§260 Phase 5)", () => {
  it("awaits the localStorage migration before importing the app graph", () => {
    // Counts asserted, not just positions (§260 Phase 5 re-review, F2). Every hollow guard
    // this phase produced was a source scan that found *a* match rather than *the* match,
    // so `indexOf` is only safe once the match is known to be unique.
    expect(occurrences(MAIN, "await migrateFromLocalStorage()")).toBe(1);
    expect(occurrences(MAIN, 'import("./App")')).toBe(1);

    const awaited = MAIN.indexOf("await migrateFromLocalStorage()");
    const appImport = MAIN.indexOf('import("./App")');

    expect(awaited, "main.tsx must await the migration").toBeGreaterThan(-1);
    expect(
      appImport,
      "App must be imported dynamically, after it",
    ).toBeGreaterThan(-1);
    expect(
      awaited,
      "the migration must be awaited BEFORE the app graph loads",
    ).toBeLessThan(appImport);
    expect(MAIN, "a static App import defeats the ordering").not.toMatch(
      /^import App from/m,
    );
  });

  it("calls the migration from exactly one place", () => {
    // Matches a CALL, not a mention, so a comment naming the function is not a violation
    // (§260 Phase 5 re-review, R8 — the first version of this counted mentions and passed
    // only because a replacement comment happened not to use the identifier).
    const CALL = /\bmigrateFromLocalStorage\s*\(/;
    const callers = sources(SRC)
      .map((f) => f.slice(SRC.length + 1))
      .filter(
        (rel) =>
          rel !== "main.tsx" &&
          rel !== "stores/system/tauri-storage.ts" &&
          CALL.test(readFileSync(join(SRC, rel), "utf8")),
      );

    expect(
      callers,
      "the ordering above is one extra caller away from moot",
    ).toEqual([]);
  });

  it("imports the stylesheet from the entry module, not from App", () => {
    // §260 Phase 5 re-review (R3). Verified against the build at the time: with the import
    // in App.tsx, `dist/index.html` had ZERO `<link rel="stylesheet">` and the 320 KB
    // stylesheet was bound to the dynamically-imported App chunk.
    expect(MAIN, "main.tsx must import the stylesheet").toMatch(
      /^import "\.\/styles\/index\.css";$/m,
    );

    const app = readFileSync(join(SRC, "App.tsx"), "utf8");
    expect(
      app,
      "a stylesheet imported from App never reaches index.html's <head>, because App " +
        "is dynamically imported — the app starts unstyled",
    ).not.toMatch(/^import ".*styles\/index\.css";$/m);
  });

  it("renders a message when the app graph fails to load", () => {
    // §260 Phase 5 re-review (R4). `void bootstrap()` discards the rejection and the
    // `unhandledrejection` handler in this same file preventDefaults it, so an uncaught
    // chunk-load failure is a blank white window with nothing logged to the user.
    // Asserted on positions rather than one regex: `/try \{[\s\S]*import\("\.\/App"\)/`
    // spans the migration's OWN try/catch, so it matched even with the import moved
    // outside — a hollow guard, caught by mutating exactly that (§260 Phase 5 re-review).
    const appIdx = MAIN.indexOf('import("./App")');
    const enclosingTry = [...MAIN.matchAll(/try \{/g)]
      .map((m) => m.index)
      .filter((i) => i < appIdx)
      .pop();

    expect(appIdx, "App must be imported dynamically").toBeGreaterThan(-1);
    expect(enclosingTry, "the App import must follow a `try {`").toBeDefined();
    expect(
      MAIN.slice(enclosingTry, appIdx),
      "that try already closed before the import — the import is NOT guarded",
    ).not.toContain("} catch");
    expect(
      MAIN.indexOf("} catch", appIdx),
      "and the try must close after it",
    ).toBeGreaterThan(appIdx);
    expect(MAIN, "the failure must reach the DOM").toContain("showFatalError");
  });
});

// §260 Phase 5 round 4 (G1) — dev-ness is a DECLARED parameter now, which trades a wrong
// inference for a thing four call sites must remember. This is the guard for that trade.
//
// Windowed and count-asserted per the rule the earlier hollow guards taught: every scan
// bounds its region and checks how many matches it found, so it cannot pass by finding
// none or by finding one somewhere else.
describe("dev-folder loads declare isDev (§260 Phase 5)", () => {
  const DEV_ACTIONS = "components/plugins/use-dev-plugin-actions.ts";
  const DEV_PLUGINS = "plugins/dev-plugins.ts";
  const LIFECYCLE = "plugins/plugin-lifecycle.ts";

  it("every load the Developer section starts is a dev load carrying its consent", () => {
    // §379 — the section's loads live in its actions hook; the component renders only.
    expect(
      loaderCalls(
        readFileSync(
          join(SRC, "components/plugins/PluginDeveloperSection.tsx"),
          "utf8",
        ),
      ),
      "the section component must not load plugins itself",
    ).toEqual([]);
    const calls = loaderCalls(readFileSync(join(SRC, DEV_ACTIONS), "utf8"));
    expect(calls.length, "the actions hook must load plugins").toBeGreaterThan(
      0,
    );
    expect(
      calls.filter((c) => !c.includes("isDev")),
      "a dev load without `isDev` gets the installed plugin's consent applied to it",
    ).toEqual([]);
    expect(calls.filter((c) => !c.includes("devConsent"))).toEqual([]);
  });

  it("every load in dev-plugins is a dev load carrying the consent Rust recorded (§379)", () => {
    // Every load in this module is a dev-folder load, so the count of calls, of `isDev` and
    // of `devConsent` must match. A missing `devConsent` is refused in a release build.
    const calls = loaderCalls(readFileSync(join(SRC, DEV_PLUGINS), "utf8"));
    expect(calls.length, "dev-plugins must load plugins").toBeGreaterThan(0);
    expect(calls.filter((c) => !c.includes("isDev"))).toEqual([]);
    expect(calls.filter((c) => !c.includes("devConsent"))).toEqual([]);
  });

  it("the lifecycle loads only installed plugins and hands dev folders to dev-plugins", () => {
    const src = readFileSync(join(SRC, LIFECYCLE), "utf8");
    expect(occurrences(src, "refreshDevPlugins()"), "one dev hand-off").toBe(1);
    expect(
      occurrences(src, "pluginListDev"),
      "the lifecycle no longer lists dev folders itself",
    ).toBe(0);
    const installedCalls = loaderCalls(src);
    expect(
      installedCalls.length,
      "the installed loop must load plugins",
    ).toBeGreaterThan(0);
    expect(
      installedCalls.filter((c) => c.includes("isDev")),
      "an installed load marked isDev would be treated as a dev load instead — unbounded " +
        "only in a dev build; a release build refuses it without a devConsent or narrows " +
        "it to one instead of the installed record's (§379)",
    ).toEqual([]);
  });

  // §379 (F5) — `setDevMode` is R2's write into the store (`developer_mode_active`'s
  // frontend mirror): every OTHER production call must go through the dev-plugins loop
  // above, or a caller could flip the store without the load/unload it implies. Same shape
  // as "calls the migration from exactly one place" above: a CALL, not a mention, so a
  // comment naming the setter is not a violation, and the file that DEFINES it is excluded
  // the same way `main.tsx` excludes itself above.
  it("setDevMode has exactly one production caller besides its own store", () => {
    const DEFINITION = "stores/system/plugin.ts";
    const CALL = /\bsetDevMode\s*\(/;
    const callers = sources(SRC)
      .map((f) => f.slice(SRC.length + 1))
      .filter(
        (rel) =>
          rel !== DEFINITION && CALL.test(readFileSync(join(SRC, rel), "utf8")),
      );

    expect(
      callers,
      "setDevMode must be called only from plugins/dev-plugins.ts — a second caller can " +
        "desync the store from what actually got loaded or unloaded",
    ).toEqual([DEV_PLUGINS]);
  });
});

/** The text of each `pluginLoader.loadPlugin(...)` / `.reloadPlugin(...)` call in `src`. */
function loaderCalls(src: string): string[] {
  return [
    ...src.matchAll(/pluginLoader\s*\n?\s*\.(?:re)?loadPlugin\(([\s\S]*?)\);/g),
  ].map((m) => m[1]);
}

/** How many times `needle` appears in `haystack` — a literal count, not a regex. */
function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/** Every non-test `.ts`/`.tsx` file under `dir`, recursively. */
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
