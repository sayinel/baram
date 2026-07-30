// The consent dialog must speak ONE language — the app's.
//
// WHY: the last screen before running third-party code showed two languages at once, in either
// locale setting. Its title, danger copy and buttons were hardcoded English; the capability
// lines came from `CAPABILITY_DESCRIPTIONS`, which is written in Korean. The existing dialog
// test asserted those Korean strings, so the suite was green — the test encoded the bug.
//
// `CAPABILITY_DESCRIPTIONS` deliberately keeps its shape: `manifest.ts` derives
// `VALID_CAPABILITIES` from `Object.keys(...)` so the compiler refuses to let the allowlist fall
// behind the `PluginCapability` union, and it is part of the published plugin API. The text moved
// to i18n on top of it, which is why the coverage guard below exists — nothing structural forces
// a new union member to gain translations.
import type { PluginCapability } from "../../../plugins/types";

import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import en from "../../../i18n/en.json";
import ko from "../../../i18n/ko.json";
import { CAPABILITY_DESCRIPTIONS } from "../../../plugins/types";
import { useSettingsStore } from "../../../stores/settings/store";
import { PluginConsentDialog } from "../PluginConsentDialog";

/** Hangul syllables. Any match in the English UI is the bug this file is about. */
const HANGUL = /[가-힣]/;
/** A Latin letter run long enough to be prose rather than a capability id like `ai`. */
const ENGLISH_PROSE = /[A-Za-z]{4,}\s+[A-Za-z]{4,}/;

const CAPS = Object.keys(CAPABILITY_DESCRIPTIONS) as PluginCapability[];

function renderDialog(): void {
  render(
    <PluginConsentDialog
      consent={{ capabilities: CAPS, trust: "trusted" }}
      intent="install"
      name="Demo"
      onCancel={vi.fn()}
      onConfirm={vi.fn()}
    />,
  );
}

afterEach(() => {
  useSettingsStore.setState({ locale: "en" });
});

describe("every capability has translations in both locales", () => {
  it("ships at least a dozen capabilities, so the loops below are not vacuous", () => {
    expect(CAPS.length).toBeGreaterThanOrEqual(12);
  });

  it.each(CAPS)("%s has an en and a ko description", (cap) => {
    const key = `plugin.capability.${cap}`;
    // A missing key would silently fall back to `CAPABILITY_DESCRIPTIONS` — Korean prose in the
    // English UI, which is the original defect, reappearing for one capability instead of all.
    expect(en, `en.json is missing ${key}`).toHaveProperty([key]);
    expect(ko, `ko.json is missing ${key}`).toHaveProperty([key]);
  });

  it("keeps en.json and ko.json at identical key sets", () => {
    // No such guard existed, and the files were at exact parity by hand. Adding a key to one
    // file only is the easiest way to reintroduce a mixed-language screen.
    const enKeys = Object.keys(en).sort();
    const koKeys = Object.keys(ko).sort();
    expect(enKeys.filter((k) => !(k in ko))).toEqual([]);
    expect(koKeys.filter((k) => !(k in en))).toEqual([]);
  });

  it("does not leave a ko value identical to its en value for the new keys", () => {
    // A copy-paste translation is worse than a missing one: the coverage guard above passes
    // while the user still reads English. Applies to the prose keys, not to "NEW"/ids.
    const prose = Object.keys(en).filter(
      (k) => k.startsWith("plugin.capability.") || k === "plugin.consent.ack",
    );
    const untranslated = prose.filter(
      (k) =>
        (en as Record<string, string>)[k] === (ko as Record<string, string>)[k],
    );
    expect(untranslated).toEqual([]);
  });
});

describe("the dialog renders in the app's language", () => {
  it("shows no Korean anywhere when the locale is English", () => {
    useSettingsStore.setState({ locale: "en" });
    renderDialog();

    const dialog = screen.getByRole("dialog");
    const text = dialog.textContent ?? "";
    expect(text.length).toBeGreaterThan(100); // the dialog actually rendered
    const offending = text.match(
      new RegExp(`.{0,24}${HANGUL.source}.{0,24}`, "g"),
    );
    expect(offending, "Korean text in the English UI").toBeNull();
  });

  it("shows no English prose when the locale is Korean", () => {
    useSettingsStore.setState({ locale: "ko" });
    renderDialog();

    const text = screen.getByRole("dialog").textContent ?? "";
    expect(HANGUL.test(text)).toBe(true);
    // "Baram" and the capability ids are legitimately Latin, so this looks for PROSE — two
    // long Latin words in a row — which is what an untranslated sentence looks like.
    const leftovers = text
      .replace(/Baram/g, "")
      .replace(/AI|LLM/g, "")
      .match(new RegExp(ENGLISH_PROSE.source, "g"));
    expect(leftovers, "untranslated English prose in the Korean UI").toBeNull();
  });

  it("translates the title, including the plugin name, per locale", () => {
    useSettingsStore.setState({ locale: "ko" });
    renderDialog();
    const heading = screen.getByRole("heading").textContent ?? "";
    // The name is interpolated, not concatenated around a hardcoded verb.
    expect(heading).toContain("Demo");
    expect(heading).toMatch(/설치하시겠습니까/);
    expect(heading).not.toMatch(/Install/);
  });

  it("translates the trusted-tier warning, which is the copy that matters most", () => {
    useSettingsStore.setState({ locale: "ko" });
    renderDialog();
    const alert = screen.getByRole("alert").textContent ?? "";
    expect(alert).toMatch(/제한하지는 않습니다/);
    expect(alert).not.toMatch(/does not limit it/);
  });
});
