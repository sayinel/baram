// §260 Phase 5 — `localStorage` is a CROSS-REALM surface in this app, not private state.
//
// `sandbox-host.ts` creates every `plugin-*` webview with a RELATIVE url
// (`sandbox.html?label=…`), so each sandbox shares an origin with the main window and
// therefore shares `localStorage` with it. Anything the app leaves there is readable —
// and writable — by a sandboxed plugin holding ZERO capabilities, straight past the Rust
// broker that authorizes everything else.
//
// Bookmarks were the live instance: `baram:bookmarks:{vaultRoot}` held the vault root
// path, file paths and heading text. Persist through `tauriStorage` (Rust
// `config.json`) instead, which crosses no origin.
//
// A source scan rather than a runtime assertion, because the defect is "someone adds a
// convenient `localStorage.setItem` in a later feature" — there is no runtime moment to
// catch that, and it would go unnoticed exactly as bookmarks did.
//
// The ORDERING half (the migration must finish before anything reads or writes) lives in
// `bootstrap-order.test.ts`, next to the other `main.tsx` invariants.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = resolve(__dirname, "..");

/**
 * The migration has to read `localStorage` in order to drain it. Nothing else may.
 * Paths are relative to `src/`.
 */
const ALLOWED = ["stores/system/tauri-storage.ts"];

/**
 * Actual USE — a property access or an index — rather than any mention of the word, so
 * that a comment explaining why the app avoids `localStorage` is not itself a violation.
 *
 * The dot must be followed by an identifier: a sentence ending "…not localStorage."
 * inside a comment is prose, not a property read.
 */
const USE = /\blocalStorage\s*(\[|\.\s*\w)/;

describe("localStorage is not a shared surface (§260 Phase 5)", () => {
  it("is used only by the adapter that drains it", () => {
    const offenders = sources(SRC)
      .map((file) => file.slice(SRC.length + 1))
      .filter(
        (rel) =>
          !ALLOWED.includes(rel) &&
          USE.test(readFileSync(join(SRC, rel), "utf8")),
      );

    expect(
      offenders,
      "every plugin sandbox shares an origin with the main window, so localStorage is " +
        "readable and writable by a plugin with no capabilities — persist through " +
        "tauriStorage (src/stores/system/tauri-storage.ts) instead",
    ).toEqual([]);
  });

  it("has no zustand store persisting to the default (localStorage) backend", () => {
    // The scan above cannot see this one: `persist(…, { name })` with no `storage`
    // silently defaults to localStorage, and the file never types the word. That is
    // exactly how `journal-layout.ts` came to share its state with every plugin.
    const offenders = sources(join(SRC, "stores"))
      .filter((file) => {
        const src = readFileSync(file, "utf8");
        return /\bpersist\s*\(/.test(src) && !src.includes("tauriStorage");
      })
      .map((file) => file.slice(SRC.length + 1));

    expect(
      offenders,
      "a persisted store with no `storage:` writes to localStorage, which every " +
        "plugin sandbox can read — pass `createJSONStorage(() => tauriStorage)`",
    ).toEqual([]);
  });

  it("scans a plausible number of files — a broken walker would pass vacuously", () => {
    // Without this, a typo in the walk (wrong root, over-eager skip) turns the guard
    // above into a test that asserts nothing at all and still goes green.
    expect(sources(SRC).length).toBeGreaterThan(300);
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
