import type { KeyringProvider } from "../../../ipc/keyring";
import type { AIProvider } from "../providers";

import { describe, expect, it } from "vitest";

import en from "../../../i18n/en.json";
import ko from "../../../i18n/ko.json";
import { AI_PROVIDER_IDS, AI_PROVIDERS, KEYRING_PROVIDERS } from "../providers";

// The provider table is the only enumeration of Baram's AI providers, and
// three things outside TypeScript's reach have to agree with it: the IPC
// keyring union, the Rust `Provider` enum behind it, and both i18n catalogues.
// These tests derive each expectation from the table rather than restating the
// provider list, so adding a provider cannot leave one surface behind.

describe("AI provider table", () => {
  it("derives the union from the table, with nothing left over", () => {
    // `AI_PROVIDER_IDS` is Object.keys(), so the only way this can disagree
    // with the union is a key that is not a string literal.
    const fromTable = Object.keys(AI_PROVIDERS).sort();
    expect([...AI_PROVIDER_IDS].sort()).toEqual(fromTable);
    expect(AI_PROVIDER_IDS).toHaveLength(fromTable.length);
  });

  it("gives every provider a default model", () => {
    for (const id of AI_PROVIDER_IDS) {
      expect(AI_PROVIDERS[id].defaultModel, id).not.toBe("");
    }
  });

  it("names each label key after its provider id", () => {
    // Derived rather than listed: a mistyped key would otherwise render the
    // raw key string in the settings select and nothing would fail.
    for (const id of AI_PROVIDER_IDS) {
      expect(AI_PROVIDERS[id].labelKey).toBe(`settings.ai.provider.${id}`);
    }
  });
});

describe("provider label translations", () => {
  // Locale parity only compares the two catalogues against each other, so a
  // key missing from BOTH is invisible to it. Deriving the expected keys from
  // the provider table is what catches a provider with no label at all.
  const catalogues: [string, Record<string, string>][] = [
    ["en", en as Record<string, string>],
    ["ko", ko as Record<string, string>],
  ];

  for (const [locale, catalogue] of catalogues) {
    it(`has a ${locale} label for every provider`, () => {
      for (const id of AI_PROVIDER_IDS) {
        const key = AI_PROVIDERS[id].labelKey;
        expect(catalogue[key], `${locale}: ${key}`).toBeTruthy();
      }
    });
  }
});

describe("keyring providers", () => {
  it("holds exactly the providers that need an API key", () => {
    const keyed = AI_PROVIDER_IDS.filter((id) => !AI_PROVIDERS[id].keyless);
    expect([...KEYRING_PROVIDERS].sort()).toEqual([...keyed].sort());
  });

  it("excludes the keyless providers", () => {
    const keyless = AI_PROVIDER_IDS.filter((id) => AI_PROVIDERS[id].keyless);
    // A keyless provider is real (Ollama) — if this list ever empties, the
    // assertion below stops discriminating and this test says so.
    expect(keyless.length).toBeGreaterThan(0);
    for (const id of keyless) {
      expect(KEYRING_PROVIDERS).not.toContain(id);
    }
  });

  it("matches the IPC keyring union in both directions", () => {
    // A type-level check, because the failure it guards against is a runtime
    // one: `KEYRING_PROVIDERS` narrows with a hand-written predicate, and the
    // names it yields are sent to a Rust enum that rejects anything it does
    // not know. Both directions matter — a keyed provider missing from the
    // IPC union would never have its key stored, and an IPC member missing
    // from the table would name a keyring entry the app never reads.
    type KeyedProvider = {
      [K in AIProvider]: (typeof AI_PROVIDERS)[K]["keyless"] extends false
        ? K
        : never;
    }[AIProvider];

    const keyedIsKeyring: KeyedProvider extends KeyringProvider ? true : never =
      true;
    const keyringIsKeyed: KeyringProvider extends KeyedProvider ? true : never =
      true;

    expect([keyedIsKeyring, keyringIsKeyed]).toEqual([true, true]);
  });
});
