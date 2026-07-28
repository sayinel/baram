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
