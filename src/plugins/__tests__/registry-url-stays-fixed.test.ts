// §69 — DECISION 2026-08-06: the registry URL is not user-configurable, and stays that way.
//
// ‼️ WHY A TEST AND NOT JUST A COMMENT. `revocation-client.test.ts` proves the value cannot be
// RESTORED from disk, which is what bounds a `trusted` plugin's redirect to one session. But the
// reasoning it prints — "`setRegistryUrl` has no callers anywhere in the app and no UI field" —
// was only ever a comment. That premise is what makes the session bound acceptable: with a
// settings field, the same primitive becomes reachable by ordinary use, and the pressure to
// persist it (a URL that resets every launch is useless) comes straight back.
//
// So this file fails if someone wires it up. That is not a veto — it is a stop, so that adding a
// field is a decision taken with the security history in front of you rather than a small feature
// that quietly reopens it. If the answer is yes, the store's `DEFAULT_REGISTRY_URL` docstring
// lists the three things that have to be answered together.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** Every production `.ts`/`.tsx` under `src` — tests excluded, since they legitimately call it. */
function productionSources(dir = "src"): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return name === "__tests__" ? [] : productionSources(path);
    }
    return /\.tsx?$/u.test(name) ? [path] : [];
  });
}

describe("the registry URL stays fixed (§69)", () => {
  it("scans a plausible number of files, so the checks below are not vacuous", () => {
    // A broken walker returning [] would make every assertion here pass.
    expect(productionSources().length).toBeGreaterThan(200);
  });

  it("has no production caller of setRegistryUrl", () => {
    // ‼️ CALL SHAPE, not the bare name: the store declares and implements it, and several comments
    // name it. `setRegistryUrl(` matches neither `setRegistryUrl: (url) =>` nor prose.
    //
    // Known gap, stated rather than papered over: a dynamic `store["setRegistryUrl"](…)` evades
    // this. Nothing in this codebase reaches a store action that way.
    const callers = productionSources().filter((path) =>
      /setRegistryUrl\s*\(/u.test(readFileSync(path, "utf8")),
    );
    expect(callers).toEqual([]);
  });

  it("has no settings field for it", () => {
    // The other half of the premise. `settings-registry.ts` is the single source for what the
    // Settings UI offers, so a field would have to appear here.
    const registry = readFileSync(
      "src/components/settings/settings-registry.ts",
      "utf8",
    );
    expect(registry).not.toMatch(/registryUrl/u);
  });

  it("keeps the decision recorded where someone adding a field would look", () => {
    // The store constant is the first thing a would-be implementer opens. A test that only
    // blocked the change would leave them guessing why.
    const store = readFileSync("src/stores/system/plugin.ts", "utf8");
    expect(store).toMatch(/NOT USER-CONFIGURABLE, ON PURPOSE/u);
  });
});
