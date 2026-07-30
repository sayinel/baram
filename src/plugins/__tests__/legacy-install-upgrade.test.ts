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

/** Loads `m` and returns the thrown message, or null if it loaded. */
async function loadError(m: PluginManifest): Promise<null | string> {
  const loader = new PluginLoader(async () => ({ activate: () => {} }));
  try {
    await loader.loadPlugin("/installed/legacy-x", m);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

describe("a plugin installed by v0.4.x tells the user what to do", () => {
  it("refuses a trust-less installed manifest with the remedy, not the schema", async () => {
    const legacy = { ...VALID };
    delete (legacy as { trust?: unknown }).trust;

    const message = await loadError(legacy);

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
    const message = legacyInstallMessage();
    expect(message).toMatch(/if it is still available/i);
  });
});

describe("built-in plugin manifests (§69) are validated by something", () => {
  // Until this suite existed, `MEDIA_VIEWER_MANIFEST` was referenced only by
  // `builtin/index.ts` and asserted by NO test — which is how it came to declare
  // `engines.baram: ">=0.4.0"` for a built-in that first ships in 0.5.0, naming two releases
  // that never contained it. That is the same false-floor class §260 Phase 6 fixed for
  // word-count; the sweep missed the built-ins because nothing read them.

  // A FIXED historical constant, not `package.json` (the trap `reference-plugins.test.ts`
  // documents one directory over): comparing against the live app version would make this
  // guard pass automatically on every future bump, asserting nothing.
  const LAST_RELEASE_WITHOUT_ANY_BUILTIN = [0, 4, 1];

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
    "%s declares a floor no earlier than the release that first contained it",
    (_id, manifest) => {
      const range = manifest.engines?.baram ?? "";
      const parsed = /^>=\s*(\d+)\.(\d+)\.(\d+)$/.exec(range);
      // A full X.Y.Z, so the comparison below cannot be defeated by a partial range.
      expect(
        parsed,
        `engines.baram "${range}" must be of the form ">=X.Y.Z"`,
      ).not.toBeNull();

      const floor = parsed!.slice(1).map(Number);
      const [lastMajor, lastMinor, lastPatch] =
        LAST_RELEASE_WITHOUT_ANY_BUILTIN;
      const isAbove =
        floor[0] !== lastMajor
          ? floor[0] > lastMajor
          : floor[1] !== lastMinor
            ? floor[1] > lastMinor
            : floor[2] > lastPatch;
      expect(
        isAbove,
        `engines.baram "${range}" names a release at or below v${lastMajor}.${lastMinor}.${lastPatch}, ` +
          `which shipped without this built-in`,
      ).toBe(true);
    },
  );
});
