// §394 spec 0073 D4 — what the user approved includes WHERE the `codeblocks` power reaches: the
// languages. ① an update is judged against the previous record's languages, ② a record without
// them (first install, or written before §394) accepts the manifest's, ③ the record is rewritten
// to the committed manifest's — an update that drops a language narrows it.
import type { PluginConsent, PluginManifest } from "../types";

import { describe, expect, it } from "vitest";

import { devConsentToAsk } from "../dev-plugins";
import {
  carryCodeBlocks,
  codeBlockReask,
  consentGaps,
  consentRequired,
  newCodeBlockLangs,
  recordedConsent,
} from "../plugin-consent";

const RECORD: PluginConsent = {
  capabilities: ["codeblocks"],
  codeBlocks: ["backlinks"],
  trust: "sandboxed",
};

function manifest(
  langs: string[],
  capabilities = ["codeblocks"],
): PluginManifest {
  return {
    author: "a",
    capabilities: capabilities as PluginManifest["capabilities"],
    contributions: { codeBlocks: langs.map((lang) => ({ lang })) },
    description: "d",
    engines: { baram: ">=0.7.7" },
    id: "p",
    license: "MIT",
    main: "dist/index.mjs",
    name: "P",
    trust: "sandboxed",
    version: "1.0.0",
  };
}

describe("consentGaps — languages", () => {
  /** What fails this: no language rule — an update could add ```chart silently. */
  it("is a gap when the request adds a language the record lacks", () => {
    const next = {
      capabilities: RECORD.capabilities,
      codeBlocks: ["backlinks", "chart"],
      trust: "sandboxed" as const,
    };
    expect(newCodeBlockLangs(RECORD, next)).toEqual(["chart"]);
    expect(consentGaps(RECORD, next).join("\n")).toMatch(
      /code blocks that were not approved: chart/,
    );
  });

  /** ② and the claim — the two cases with nothing to compare: no gap. The pair of the row above. */
  it("is no gap when either side names no languages, or the request narrows them", () => {
    const withoutLangs: PluginConsent = {
      capabilities: RECORD.capabilities,
      trust: RECORD.trust,
    };
    const next = {
      capabilities: RECORD.capabilities,
      codeBlocks: ["chart"],
      trust: "sandboxed" as const,
    };
    expect(consentGaps(withoutLangs, next)).toEqual([]);
    expect(
      consentGaps(RECORD, {
        capabilities: RECORD.capabilities,
        trust: "sandboxed",
      }),
    ).toEqual([]);
    expect(consentGaps(RECORD, { ...next, codeBlocks: [] })).toEqual([]);
  });
});

describe("recordedConsent and carryCodeBlocks", () => {
  /** ③ — what fails this: carrying the approved consent's languages forward instead of the
   *  committed manifest's (a dropped language would stay granted), or recording languages for a
   *  manifest without the capability. */
  it("records the committed manifest's languages, and none without the capability", () => {
    expect(recordedConsent(RECORD, manifest(["chart"])).codeBlocks).toEqual([
      "chart",
    ]);
    expect(
      recordedConsent(RECORD, manifest(["x"], [])).codeBlocks,
    ).toBeUndefined();
    expect(
      recordedConsent(
        { capabilities: [], trust: "sandboxed" },
        manifest(["b", "a"]),
      ).codeBlocks,
    ).toEqual(["a", "b"]);
  });

  /** ① — the claim takes the record's languages so the post-download check has a base; ② a
   *  record without them gives the claim none. */
  it("carries the record's languages onto a claim, and nothing from a record without them", () => {
    const claim: PluginConsent = {
      capabilities: ["codeblocks"],
      trust: "sandboxed",
    };
    expect(carryCodeBlocks(claim, RECORD).codeBlocks).toEqual(["backlinks"]);
    expect(
      carryCodeBlocks(claim, { capabilities: [], trust: "sandboxed" })
        .codeBlocks,
    ).toBeUndefined();
    expect(carryCodeBlocks(claim, undefined)).toBe(claim);
  });

  /** ① — the re-ask lists what the version in hand draws. What fails this: joining the record's
   *  languages to the download's — `backlinks`, which the new version dropped, would be shown
   *  under "Code blocks it draws". NEW is against the approved consent, so only `timeline`. */
  it("re-asks with the download's languages, diffed against the approved consent", () => {
    const approved: PluginConsent = {
      capabilities: ["codeblocks"],
      codeBlocks: ["backlinks", "chart"],
      trust: "sandboxed",
    };
    const { consent, prior } = codeBlockReask(approved, ["chart", "timeline"]);
    expect(consent).toEqual({ ...approved, codeBlocks: ["chart", "timeline"] });
    expect(prior).toBe(approved);
    expect(newCodeBlockLangs(prior, consent)).toEqual(["timeline"]);
  });
});

describe("devConsentToAsk — a folder's manifest is in hand", () => {
  /** What fails this: a request without `codeBlocks` — the dialog would not show the languages
   *  and a Reload that adds one would not ask. */
  it("asks with the languages, and again when a Reload adds one", () => {
    expect(
      devConsentToAsk(false, null, manifest(["backlinks"]))?.codeBlocks,
    ).toEqual(["backlinks"]);
    expect(devConsentToAsk(false, RECORD, manifest(["backlinks"]))).toBeNull();
    expect(
      devConsentToAsk(false, RECORD, manifest(["backlinks", "chart"]))
        ?.codeBlocks,
    ).toEqual(["backlinks", "chart"]);
    expect(
      consentRequired(RECORD, {
        capabilities: RECORD.capabilities,
        codeBlocks: ["backlinks"],
        trust: "sandboxed",
      }),
    ).toBeNull();
  });
});
