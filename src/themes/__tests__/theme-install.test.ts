// §360 — the hygiene pipeline wired to the install path (스펙 0049 §7·§9).
//
// ‼️ THE PROPOSITION UNDER TEST IS AN ORDERING, not a set of steps. Every suite below is
// written so that moving the commit earlier — or dropping a layer — turns it red:
//
//   - the happy path asserts on WHAT reached the commit (sanitized, inlined, verifiable),
//     not merely that a commit happened;
//   - every refusal asserts the commit was NEVER called and the stage WAS discarded;
//   - the call-order suite asserts it directly, because the two above could both pass
//     against an implementation that committed first and sanitized after.
import type { StoredThemeCssPayload } from "../../ipc/theme";
import type { RegistryEntry } from "../../plugins/types";

import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: string[] = [];
const themeInstallStage = vi.fn();
const themeInstallCommit = vi.fn();
const themeInstallDiscard = vi.fn();
const themeStageRead =
  vi.fn<(stageId: string, path: string) => Promise<Uint8Array>>();

vi.mock("../../ipc/theme", () => ({
  themeInstallCommit: (...a: unknown[]) => {
    calls.push("commit");
    return themeInstallCommit(...a);
  },
  themeInstallDiscard: (...a: unknown[]) => {
    calls.push("discard");
    return themeInstallDiscard(...a);
  },
  themeInstallStage: (...a: unknown[]) => {
    calls.push("stage");
    return themeInstallStage(...a);
  },
  themeReadStoredCss: vi.fn(),
  themeStageRead: (stageId: string, path: string) => {
    calls.push(`read:${path}`);
    return themeStageRead(stageId, path);
  },
}));

import { verifyStoredThemeCss } from "../../utils/theme-css/verify";
import {
  installTheme,
  MAX_STORED_THEME_CSS_BYTES,
  MAX_THEME_MANIFEST_BYTES,
  parseThemeManifestText,
} from "../theme-install";

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

function entry(over: Partial<RegistryEntry> = {}): RegistryEntry {
  return {
    author: "a",
    capabilities: [],
    checksum: "c".repeat(64),
    description: "d",
    downloadUrl: "https://reg.test/themes/dracula.zip",
    id: "dracula",
    kind: "theme",
    license: "MIT",
    name: "Dracula",
    version: "1.0.0",
    ...over,
  };
}

function manifestText(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    author: "a",
    description: "d",
    engines: { baram: ">=0.1.0" },
    id: "dracula",
    license: "MIT",
    modes: { light: { css: "light/theme.css" } },
    name: "Dracula",
    version: "1.0.0",
    ...over,
  });
}

/** Wire up a staged tree: `files` is the staged package, keyed by literal path. */
function stageWith(
  files: Record<string, Uint8Array>,
  manifest = manifestText(),
) {
  themeInstallStage.mockResolvedValue({
    checksum: "c".repeat(64),
    manifest,
    manifest_sha256: "d".repeat(64),
    stage_id: "stage-1",
  });
  themeStageRead.mockImplementation((_stageId: string, path: string) => {
    const found = files[path];
    return found === undefined
      ? Promise.reject(new Error(`no such file: ${path}`))
      : Promise.resolve(found);
  });
  themeInstallCommit.mockResolvedValue({
    id: "dracula",
    install_path: "/home/u/.baram/themes/dracula",
  });
}

const committedCss = (): StoredThemeCssPayload =>
  themeInstallCommit.mock.calls[0][3] as StoredThemeCssPayload;

beforeEach(() => {
  calls.length = 0;
  themeInstallStage.mockReset();
  themeInstallCommit.mockReset();
  themeInstallDiscard.mockReset();
  themeInstallDiscard.mockResolvedValue(undefined);
  themeStageRead.mockReset();
});

describe("parseThemeManifestText caps the raw text before it parses it (§360)", () => {
  // ‼️ THE ORDERING IS THE ASSERTION, not the refusal. The input below is oversized AND
  // unparseable; a cap applied after `JSON.parse` would report the syntax error, which is
  // exactly the version of this check that bounds nothing. Task 2's
  // `MAX_MANIFEST_JSON_CHARS` is the other one — it takes already-parsed data, so it
  // bounds the field walk rather than the parse, and both exist on purpose.
  it("refuses an oversized manifest by size, not by whatever JSON.parse would say", () => {
    const oversized = "{".repeat(MAX_THEME_MANIFEST_BYTES + 1);
    const result = parseThemeManifestText(oversized);
    expect(result.valid).toBe(false);
    expect(result.valid === false && result.errors[0].message).toMatch(
      /over the \d+-byte limit/u,
    );
  });

  // Bytes, not characters — the same distinction `readStagedThemeText` makes.
  it("measures bytes: a multi-byte manifest under the character count is still refused", () => {
    const body = "가".repeat(Math.floor(MAX_THEME_MANIFEST_BYTES / 2));
    expect(body.length).toBeLessThan(MAX_THEME_MANIFEST_BYTES);
    const result = parseThemeManifestText(`{"description":"${body}"}`);
    expect(result.valid === false && result.errors[0].message).toMatch(
      /over the \d+-byte limit/u,
    );
  });

  it("admits a well-formed manifest and hands back what the validator approved", () => {
    const result = parseThemeManifestText(manifestText());
    expect(result.valid).toBe(true);
    expect(result.valid === true && result.manifest.id).toBe("dracula");
  });

  it("reports unparseable JSON as such when it is under the cap", () => {
    const result = parseThemeManifestText("{not json");
    expect(result.valid === false && result.errors[0].message).toContain(
      "not valid JSON",
    );
  });
});

describe("installTheme stores only what the hygiene pipeline produced (§360)", () => {
  it("commits CSS that is sanitized, inlined and verifiable", async () => {
    stageWith({
      "assets/logo.png": new Uint8Array([1, 2, 3]),
      "light/theme.css": enc(
        'a{color:red !important;background:url("assets/logo.png")}',
      ),
    });

    const result = await installTheme(entry(), "https://reg.test/index.json");

    expect(result.ok).toBe(true);
    const stored = committedCss();
    // Layered, so it cannot outrank app CSS…
    expect(stored.light).toContain("@layer baram-theme");
    // …`!important` stripped, because layered `!important` beats unlayered (§359)…
    expect(stored.light).not.toContain("important");
    // …and the asset is a `data:` URI, so the served CSS reaches no network at all.
    expect(stored.light).toContain("data:image/png;base64,AQID");
    expect(stored.light).not.toContain("assets/logo.png");
    // The same predicate the load path will apply, applied to what we are about to store.
    expect(verifyStoredThemeCss(stored.light as string)).toBe(true);
  });

  it("records the modes it stored, and reads tokens for a mode that declares them", async () => {
    const colors = Object.fromEntries(
      (await import("../../types/theme")).THEME_COLOR_KEYS.map(({ key }) => [
        key,
        "#123456",
      ]),
    );
    stageWith(
      {
        "dark/theme.css": enc("a{color:#fff}"),
        "dark/tokens.json": enc(JSON.stringify(colors)),
        "light/theme.css": enc("a{color:#000}"),
      },
      manifestText({
        modes: {
          dark: { css: "dark/theme.css", tokens: "dark/tokens.json" },
          light: { css: "light/theme.css" },
        },
      }),
    );

    const result = await installTheme(entry(), "https://reg.test/index.json");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.installed.modes.light).toEqual({
      colors: undefined,
      css: true,
    });
    expect(result.installed.modes.dark?.css).toBe(true);
    expect(result.installed.modes.dark?.colors?.["--color-bg-default"]).toBe(
      "#123456",
    );
    expect(result.installed.installPath).toBe("/home/u/.baram/themes/dracula");
  });

  // ‼️ Extra keys are dropped by RECONSTRUCTION, not by inspection — the audit BLOCKER
  // `use-theme-import.ts` records: a `tokens.json` key that happens to be a real CSS
  // property name would otherwise reach `applyThemeVars` and be written into `<html>`'s
  // inline style, permanently.
  it("keeps only whitelisted token keys", async () => {
    const colors = Object.fromEntries(
      (await import("../../types/theme")).THEME_COLOR_KEYS.map(({ key }) => [
        key,
        "#abcdef",
      ]),
    );
    stageWith(
      {
        "light/tokens.json": enc(
          JSON.stringify({ ...colors, "--evil-position": "fixed" }),
        ),
      },
      manifestText({ modes: { light: { tokens: "light/tokens.json" } } }),
    );

    const result = await installTheme(entry(), "https://reg.test/index.json");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.installed.modes.light?.colors).not.toHaveProperty(
      "--evil-position",
    );
    // A mode with tokens and no CSS stores no CSS file.
    expect(result.installed.modes.light?.css).toBe(false);
    expect(committedCss().light).toBeUndefined();
  });
});

describe("installTheme installs nothing when any layer refuses (§360)", () => {
  const refuses = async () => {
    const result = await installTheme(entry(), "https://reg.test/index.json");
    expect(result.ok).toBe(false);
    expect(themeInstallCommit).not.toHaveBeenCalled();
    expect(themeInstallDiscard).toHaveBeenCalledWith("stage-1");
    return result;
  };

  it("refuses a stylesheet that reaches the network", async () => {
    stageWith({
      "light/theme.css": enc("a{background:url(https://evil.test/x.png)}"),
    });
    const result = await refuses();
    expect(result.ok === false && result.reason).toBe("cssRejected");
    expect(result.ok === false && result.detail).toBe("absoluteUrl");
  });

  // ‼️ `detail` IS PART OF THE ASSERTION, and mutation is why. The three layers overlap on
  // purpose — each refuses things the others also catch — so "the install failed" is
  // satisfied by any one of them and says nothing about which ran. Measured: swallowing
  // every `sanitizeThemeCss` throw left this whole file green, because `inlineThemeAssets`
  // re-refuses a remote URL and `verifyStoredThemeCss` re-refuses anything that is not
  // `@layer`-wrapped. What that costs is not safety but DIAGNOSIS: the author is told the
  // stored CSS failed to parse when the actual repair is to delete an `@import`. Only
  // `sanitizeThemeCss` produces this code, so this assertion is the one that notices.
  it("refuses an `@import`, naming the rule the author broke", async () => {
    stageWith({ "light/theme.css": enc('@import "other.css";a{color:red}') });
    const result = await refuses();
    expect(result.ok === false && result.reason).toBe("cssRejected");
    expect(result.ok === false && result.detail).toBe("importNotAllowed");
  });

  // The inline layer's own code, for the same reason: "the asset you named is not in the
  // package" is a different repair from either of the above.
  it("names the missing asset rather than a parse failure", async () => {
    stageWith({
      "light/theme.css": enc('a{background:url("assets/nope.png")}'),
    });
    const result = await refuses();
    expect(result.ok === false && result.detail).toBe("assetNotFound");
  });

  it("refuses a manifest the validator rejects", async () => {
    stageWith({}, manifestText({ modes: {} }));
    const result = await refuses();
    expect(result.ok === false && result.reason).toBe("manifestInvalid");
  });

  // A hostile listing must not aim a download at another installed theme's directory. Rust
  // checks it too (`expected_id`); this is the layer that compares the listing against the
  // manifest THIS function validated.
  it("refuses an archive whose manifest declares a different id", async () => {
    stageWith(
      { "light/theme.css": enc("a{color:red}") },
      manifestText({ id: "other" }),
    );
    const result = await refuses();
    expect(result.ok === false && result.reason).toBe("idMismatch");
  });

  // ‼️ THE CAP THAT CANNOT BE DERIVED FROM THE ASSET BUDGET, demonstrated rather than
  // asserted: ONE 2 MiB asset (the whole budget, and `inlineThemeAssets` counts a path
  // once) referenced TWICE produces ~5.6 MiB of stored CSS. The budget is satisfied; the
  // output is not bounded by it. That is why `MAX_STORED_THEME_CSS_BYTES` exists.
  it("refuses stored CSS over its own cap even when the asset budget was satisfied", async () => {
    const asset = new Uint8Array(2 * 1024 * 1024);
    stageWith({
      "assets/big.png": asset,
      "light/theme.css": enc(
        'a{background:url("assets/big.png")}b{background:url("assets/big.png")}',
      ),
    });
    const result = await refuses();
    expect(result.ok === false && result.reason).toBe("cssRejected");
    expect(result.ok === false && result.detail).toBe("tooLarge");
    // The premise of the test, stated so a future change to either number cannot make it
    // pass for the wrong reason.
    expect(asset.byteLength).toBeLessThanOrEqual(2 * 1024 * 1024);
    expect(Math.ceil(asset.byteLength / 3) * 4 * 2).toBeGreaterThan(
      MAX_STORED_THEME_CSS_BYTES,
    );
  });
});

describe("installTheme commits last (§360)", () => {
  // ‼️ Asserted directly, because every other test in this file would also pass against an
  // implementation that committed the raw CSS first and sanitized afterwards — they check
  // WHAT was committed, not WHEN. Sanitising after the commit leaves unverified CSS at the
  // install path for as long as the pipeline runs.
  it("reads everything it needs before it commits anything", async () => {
    stageWith({
      "assets/logo.png": new Uint8Array([1]),
      "light/theme.css": enc('a{background:url("assets/logo.png")}'),
    });

    await installTheme(entry(), "https://reg.test/index.json");

    expect(calls[0]).toBe("stage");
    expect(calls.at(-1)).toBe("commit");
    expect(calls).toContain("read:light/theme.css");
    expect(calls).toContain("read:assets/logo.png");
    expect(calls.indexOf("commit")).toBeGreaterThan(
      calls.lastIndexOf("read:assets/logo.png"),
    );
    // And a successful commit is not followed by a discard — the stage belongs to it now.
    expect(themeInstallDiscard).not.toHaveBeenCalled();
  });

  it("hands the commit the digest staging pinned, so the file it installs is the one we validated", async () => {
    stageWith({ "light/theme.css": enc("a{color:red}") });
    await installTheme(entry(), "https://reg.test/index.json");
    expect(themeInstallCommit).toHaveBeenCalledWith(
      "stage-1",
      "dracula",
      "d".repeat(64),
      expect.anything(),
    );
  });

  it("reports a commit failure without claiming the theme is installed", async () => {
    stageWith({ "light/theme.css": enc("a{color:red}") });
    themeInstallCommit.mockRejectedValue(
      "the staged manifest changed after it was checked",
    );
    const result = await installTheme(entry(), "https://reg.test/index.json");
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe("commitFailed");
    expect(themeInstallDiscard).toHaveBeenCalledWith("stage-1");
  });

  it("does not try to discard a stage that was never created", async () => {
    themeInstallStage.mockRejectedValue(new Error("network unreachable"));
    const result = await installTheme(entry(), "https://reg.test/index.json");
    expect(result.ok === false && result.reason).toBe("downloadFailed");
    expect(themeInstallDiscard).not.toHaveBeenCalled();
  });
});
