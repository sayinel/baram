// The v0.4.x → v0.5.0 upgrade path, and the built-in manifests nothing validated.
//
// WHY THIS FILE EXISTS — the v0.5.0 release review disproved a premise the code stated as
// fact. `backfillConsent` claimed installed-plugin records "can only exist in a dev build at
// all, because release had plugins gated off (#259)". They can't have been: the #259 gate
// merged 2026-07-23, two days AFTER v0.4.1 was tagged, so it shipped in no release. v0.4.0
// and v0.4.1 both had the plugins tab open, no `trust` requirement in `validateManifest`, and
// `DEFAULT_REGISTRY_URL` already pointing at the live index — which listed two installable
// plugins. So trust-less installs exist on real users' disks.
//
// In v0.5.0 `validateManifest` requires `trust`, so each of those throws on EVERY startup,
// and `checkForUpdates` skips trust-less registry entries — there is no update to offer as
// the fix. The user's only way out is Uninstall, and the message said nothing about it.
import type { PluginManifest } from "../types";

import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => `asset://localhost/${p}`,
}));

import { BUILTIN_PLUGINS } from "../builtin";
import { validateManifest } from "../manifest";
import { PluginLoader } from "../plugin-loader";
import { legacyInstallMessage } from "../plugin-trust";

/** A manifest that loads, so each test can break exactly one thing. */
const VALID: PluginManifest = {
  author: "test",
  capabilities: ["commands"],
  description: "test",
  engines: { baram: ">=0.5.0" },
  id: "legacy-x",
  license: "MIT",
  main: "index.mjs",
  name: "Legacy X",
  trust: "trusted",
  version: "1.0.0",
};

/**
 * Loads `m` and returns the thrown message, or null if it loaded.
 *
 * `opts` is threaded through because `isDev` DISCRIMINATES here (re-review MEDIUM-1) and every
 * case in the first draft of this file omitted it — so `isDev` was `undefined` throughout and
 * the dev branch was structurally untestable.
 */
async function loadError(
  m: PluginManifest,
  opts: { isDev?: boolean } = {},
): Promise<null | string> {
  const loader = new PluginLoader(async () => ({ activate: () => {} }));
  try {
    await loader.loadPlugin("/installed/legacy-x", m, opts);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

/** A manifest with `trust` removed, as a v0.4.x install has. */
function withoutTrust(): PluginManifest {
  const m = { ...VALID };
  delete (m as { trust?: unknown }).trust;
  return m;
}

describe("a plugin installed by v0.4.x tells the user what to do", () => {
  it("refuses a trust-less installed manifest with the remedy, not the schema", async () => {
    const message = await loadError(withoutTrust());

    // Removing it is the ONLY way out, so the message has to name that control — by the label
    // that actually exists on the Installed tab ("Remove"), which is where such a plugin is
    // listed. Asserted by the word the user acts on rather than the whole sentence, which
    // would pin the copy. `installed-error-text.test.tsx` pins the pairing to the real button.
    expect(message).toContain("Remove");
    // …and it must NOT be the schema text. This is the assertion that fails if the special
    // case is removed: `validateManifest`'s own message is what shipped before, and it
    // describes the field rather than the fix.
    expect(message).not.toContain("trust is required");
  });

  it("still reports a genuinely malformed manifest as malformed", async () => {
    // The complement — without it, routing EVERY validation failure to the legacy message
    // would pass the test above while hiding every real manifest defect behind advice to
    // uninstall. A trust-BEARING manifest with a broken field must keep the schema text.
    const broken = { ...VALID, capabilities: ["not-a-capability"] } as never;

    const message = await loadError(broken);

    expect(message).toContain("Invalid manifest for legacy-x");
    expect(message).not.toContain("Use Remove");
  });

  it("loads a well-formed manifest, so neither branch is a blanket refusal", async () => {
    expect(await loadError(VALID)).toBeNull();
  });

  it("does not promise a reinstall that may not exist", () => {
    // `baram-ai-summary` was withdrawn in §260 Phase 6 — no republished version will ever
    // carry a `trust`, and the live registry entry is being deleted outright. So the copy is
    // conditional ("if it is still available"), and an unconditional promise is a defect.
    const message = legacyInstallMessage(withoutTrust());
    expect(message).toMatch(/if it is still available/i);
  });

  it("returns null for a manifest whose tier is real, so it cannot mask a schema error", () => {
    // The gate that keeps the complement case above working now that the discrimination lives
    // inside this function rather than at the call site.
    expect(legacyInstallMessage(VALID)).toBeNull();
  });

  it("keeps the schema text for a DEV folder, whose author needs the field name", async () => {
    // Re-review MEDIUM-1. A dev load is the author's own working copy: never installed, not on
    // the Installed tab (dev plugins are a separate store), not in the marketplace — so every
    // clause of the remedy is false for it. And this throw is the author's ONLY feedback about
    // a missing tier, because the dev-add path validates in Rust, which does not check `trust`.
    const message = await loadError(withoutTrust(), { isDev: true });

    expect(message).toContain("trust is required");
    expect(message).not.toContain("Use Remove");
  });

  it("still gives an INSTALLED plugin the remedy, so the dev carve-out is not blanket", async () => {
    // The complement of the case above — `!opts.isDev` must narrow, not disable.
    const message = await loadError(withoutTrust(), { isDev: false });

    expect(message).toContain("Use Remove");
  });

  it.each([
    ["null", null],
    ["an empty string", ""],
    ["a number", 42],
    ["false", false],
  ])(
    "gives the schema text when trust is %s — present, but not a declaration",
    async (_label, trust) => {
      // The sixth defect, found by probing the fix for the case below: all of these were told
      // to "Update Baram", which is a dead end — no version will ever accept `trust: null`.
      // Present-but-meaningless is a malformed manifest, and the schema text names the field
      // and the two legal values, so it is the only actionable message.
      const message = await loadError({ ...VALID, trust: trust as never });

      expect(message).toContain("trust is required");
      expect(message).not.toContain("Update Baram");
      expect(message).not.toContain("Use Remove");
    },
  );

  it("tells an UNRECOGNIZED tier to update Baram, not that it is ancient", async () => {
    // Re-review MEDIUM-2, the fifth mutation. `isLegacyManifest` is
    // `pluginTrustOf(...) === null`, so a tier introduced by a LATER Baram is "legacy" too —
    // and telling the user a manifest from the future "predates the trust model" sends them to
    // the author when the fix is to update the app. This is the conflation `demotedBecause`
    // exists to prevent on the registry side.
    //
    // It is also the assertion that kills the surviving mutation: swapping
    // `isLegacyManifest(rawManifest)` for `rawManifest.trust === undefined` leaves every other
    // case in this file green, because none of them passes a non-empty unknown tier.
    const message = await loadError({ ...VALID, trust: "isolated" as never });

    expect(message).toContain("Update Baram");
    expect(message).not.toContain("predates");
    expect(message).not.toContain("Use Remove");
  });
});

describe("built-in plugin manifests (§69) are validated by something", () => {
  // Until this suite existed, `MEDIA_VIEWER_MANIFEST` was referenced only by
  // `builtin/index.ts` and asserted by NO test — which is how it came to declare
  // `engines.baram: ">=0.4.0"` for a built-in that first ships in 0.5.0, naming two releases
  // that never contained it. That is the same false-floor class §260 Phase 6 fixed for
  // word-count; the sweep missed the built-ins because nothing read them.

  // PER BUILT-IN, not one global floor (re-review LOW-1). The first draft asserted "above
  // v0.4.1" for everything, which is the last release without ANY built-in — so a built-in
  // first shipping in 0.7.0 could declare `>=0.5.0` and pass, which is the very false-floor
  // class this guard exists to catch. A map states the release each built-in actually shipped
  // in, and an unlisted built-in fails rather than being waved through.
  //
  // FIXED historical values, never `package.json` (the trap `reference-plugins.test.ts`
  // documents one directory over): comparing against the live app version would make this
  // guard pass automatically on every future bump, asserting nothing.
  const FIRST_RELEASE_CONTAINING: Record<string, string> = {
    "baram-media-viewer": ">=0.5.0",
  };

  it("ships at least one built-in, so the loop below is not vacuous", () => {
    expect(BUILTIN_PLUGINS.length).toBeGreaterThan(0);
  });

  it.each(BUILTIN_PLUGINS.map((p) => [p.manifest.id, p.manifest] as const))(
    "%s validates like any third-party manifest",
    (_id, manifest) => {
      const result = validateManifest(manifest);
      // `validateManifest` returns a discriminated union with no `errors` on the valid arm,
      // so the errors are surfaced through the assertion itself — a bare `.valid` check
      // would report only "expected false to be true" and hide which field is wrong.
      expect(result.valid ? [] : result.errors).toEqual([]);
    },
  );

  it.each(BUILTIN_PLUGINS.map((p) => [p.manifest.id, p.manifest] as const))(
    "%s declares the floor of the release that first contained it",
    (id, manifest) => {
      const expected = FIRST_RELEASE_CONTAINING[id];
      // An unlisted built-in FAILS rather than being skipped: a `?? pass` here would let the
      // next built-in added to `BUILTIN_PLUGINS` bypass the guard entirely, which is how the
      // media-viewer floor went unchecked in the first place.
      expect(
        expected,
        `add "${id}" to FIRST_RELEASE_CONTAINING with the release it first shipped in`,
      ).toBeDefined();
      // Equality, not "above some constant" — the map states the exact release, so an
      // under-claiming floor (0.7.0 built-in declaring >=0.5.0) is caught too.
      expect(manifest.engines?.baram).toBe(expected);
    },
  );

  it("requires a full X.Y.Z floor, so a partial range cannot satisfy the check above", () => {
    // Guards the map itself: `>=0.5` would be pinned happily by `toBe`, yet it is not a range
    // the plugin-release workflow's comparator accepts (`/^>=\s*(\d+)\.(\d+)\.(\d+)$/`).
    for (const range of Object.values(FIRST_RELEASE_CONTAINING)) {
      expect(range, `"${range}" must be of the form ">=X.Y.Z"`).toMatch(
        /^>=\s*\d+\.\d+\.\d+$/,
      );
    }
  });
});
