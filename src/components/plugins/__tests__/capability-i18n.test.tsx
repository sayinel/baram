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
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import en from "../../../i18n/en.json";
import ko from "../../../i18n/ko.json";
import { CAPABILITY_DESCRIPTIONS } from "../../../plugins/types";
import { useSettingsStore } from "../../../stores/settings/store";
import { PluginCapabilityBadge } from "../PluginCapabilityBadge";
import { PluginConsentDialog } from "../PluginConsentDialog";

/** Hangul syllables. Any match in the English UI is the bug this file is about. */
const HANGUL = /[가-힣]/;

const CAPS = Object.keys(CAPABILITY_DESCRIPTIONS) as PluginCapability[];

/**
 * What is left after removing every string that is legitimately Latin in Korean copy: the plugin
 * name, the product name, and the two acronyms the translations keep.
 *
 * The first version of this looked for `/[A-Za-z]{4,}\s+[A-Za-z]{4,}/` — two long adjacent words —
 * and the review showed it was hollow. React emits no whitespace between sibling elements, so
 * `textContent` is one unbroken run like `취소CancelInstall` with no space for `\s+` to match, and
 * 12 of the 24 rendered strings evade it even in isolation ("Read and edit the document" has no
 * adjacent pair both ≥4 letters). Re-hardcoding both buttons in English left all 30 tests green.
 *
 * So: strip the known-Latin tokens, then require that NO Latin run of 2+ letters survives. That
 * catches Cancel, Install, Update and NEW — and, at 2 rather than 3, also a Korean button
 * mislabelled `OK` / `On` / `No`, which the re-review pointed out slipped through at 3+. The
 * corpus passes at 2, so the tighter bound costs nothing.
 */
function latinLeftovers(text: string): null | string[] {
  return text
    .replace(/Demo/g, "")
    .replace(/Baram/g, "")
    .replace(/AI|LLM/g, "")
    .match(/[A-Za-z]{2,}/g);
}

/** Every shape the dialog can take, so no branch's copy goes unrendered. */
const SHAPES = [
  {
    intent: "install" as const,
    label: "install / trusted",
    trust: "trusted" as const,
  },
  {
    intent: "install" as const,
    label: "install / sandboxed",
    trust: "sandboxed" as const,
  },
  {
    intent: "update" as const,
    label: "update / trusted",
    trust: "trusted" as const,
  },
  {
    intent: "update" as const,
    label: "update / sandboxed",
    trust: "sandboxed" as const,
  },
];

function renderDialog(
  shape: { intent: "install" | "update"; trust: "sandboxed" | "trusted" } = {
    intent: "install",
    trust: "trusted",
  },
  caps: PluginCapability[] = CAPS,
  prior?: PluginCapability[],
): void {
  render(
    <PluginConsentDialog
      consent={{ capabilities: caps, trust: shape.trust }}
      intent={shape.intent}
      name="Demo"
      onCancel={vi.fn()}
      onConfirm={vi.fn()}
      prior={prior ? { capabilities: prior, trust: shape.trust } : undefined}
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

  it("does not leave a ko value identical to its en value for the plugin keys", () => {
    // A copy-paste translation is worse than a missing one: the coverage guard above passes
    // while the user still reads English. The app-wide version of this, plus the en/ko key-set
    // parity check that used to live here, are in `src/i18n/__tests__/locale-parity.test.ts` —
    // they are not plugin invariants and belong next to the files they constrain.
    const pluginKeys = Object.keys(en).filter((k) => k.startsWith("plugin."));
    expect(pluginKeys.length).toBeGreaterThan(20);
    const untranslated = pluginKeys.filter(
      (k) =>
        (en as Record<string, string>)[k] === (ko as Record<string, string>)[k],
    );
    expect(untranslated).toEqual([]);
  });
});

describe("the dialog renders in the app's language", () => {
  it.each(SHAPES)(
    "shows no Korean in the English UI — $label",
    ({ intent, trust }) => {
      useSettingsStore.setState({ locale: "en" });
      renderDialog({ intent, trust });

      const text = screen.getByRole("dialog").textContent ?? "";
      expect(text.length).toBeGreaterThan(60); // the dialog actually rendered
      const offending = text.match(
        new RegExp(`.{0,24}${HANGUL.source}.{0,24}`, "g"),
      );
      expect(offending, "Korean text in the English UI").toBeNull();
    },
  );

  it.each(SHAPES)(
    "shows no untranslated English in the Korean UI — $label",
    ({ intent, trust }) => {
      useSettingsStore.setState({ locale: "ko" });
      renderDialog({ intent, trust });

      const text = screen.getByRole("dialog").textContent ?? "";
      expect(HANGUL.test(text)).toBe(true);
      expect(
        latinLeftovers(text),
        "untranslated English in the Korean UI",
      ).toBeNull();
    },
  );

  it("translates the NEW marker, which only an update renders", () => {
    // `prior` is what makes the marker appear, so no other case in this file reaches it — and
    // `PluginConsentDialog.test.tsx` asserts the literal "NEW" under `en`, which would keep a
    // hardcoded marker invisible twice over.
    useSettingsStore.setState({ locale: "ko" });
    renderDialog(
      { intent: "update", trust: "sandboxed" },
      ["editor", "ai"],
      ["editor"],
    );

    const rows = screen.getAllByRole("listitem");
    expect(rows[1].textContent).toContain("추가");
    expect(latinLeftovers(rows[1].textContent ?? "")).toBeNull();
  });

  it("translates the no-capabilities line, which only an empty list renders", () => {
    useSettingsStore.setState({ locale: "ko" });
    renderDialog({ intent: "install", trust: "sandboxed" }, []);

    const text = screen.getByRole("dialog").textContent ?? "";
    expect(text).toMatch(/요청하는 권한이 없습니다/);
    expect(latinLeftovers(text)).toBeNull();
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

describe("the decision stays on screen", () => {
  // ‼️ LIMIT OF THIS GUARD, stated so nobody reads it as more than it is: jsdom has no layout, so
  // no unit test here can detect that a button fell below the fold. The regression it exists for
  // was measured in a browser — with the scroll on the dialog, seven capabilities pushed Cancel
  // out of view at 1280x800 and thirteen hid 288px, with macOS overlay scrollbars giving no hint.
  //
  // So this asserts the STRUCTURE that fixes it: the dialog is not the scroll container, the body
  // is, and the ack/actions are the dialog's own children rather than the body's. Moving the
  // scroll back fails here; a subtler layout regression will not, and would need the Playwright
  // suite.
  const css = readFileSync(
    resolve(__dirname, "../../../styles/plugins.css"),
    "utf8",
  );

  /**
   * The declarations of EVERY rule whose selector list contains `selector`, concatenated.
   *
   * Two traps had to be closed here, both the same shape — a naive search finds *a* match, not
   * *the* match:
   *   • The first version failed on the baseline, because it kept comments and a rule's own
   *     comment explains that `overflow-y: auto` is deliberately absent. Comments are stripped.
   *   • The second matched `.plugin-consent__cancel, .plugin-consent__confirm { … }` when asked
   *     for `.plugin-consent__confirm`, since that shared rule's text also ends in
   *     `.plugin-consent__confirm {` and comes first in the file. It reported the confirm button
   *     had lost its background while the background was right there in its own rule.
   *
   * Collecting ALL matching rules is also the correct model: declarations for a selector cascade
   * across rules, so "does this surface declare a background" is a question about the union.
   */
  const declarationsFor = (selector: string): string => {
    const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const found: string[] = [];
    for (const rule of bare.split("}")) {
      const brace = rule.indexOf("{");
      if (brace === -1) continue;
      const selectors = rule
        .slice(0, brace)
        .split(",")
        .map((s) => s.trim());
      if (selectors.includes(selector)) found.push(rule.slice(brace + 1));
    }
    expect(found.length, `no rule for ${selector}`).toBeGreaterThan(0);
    return found.join("\n");
  };
  const block = declarationsFor;

  it("does not make the dialog itself scroll", () => {
    expect(block(".plugin-consent")).toContain("overflow: hidden");
    expect(block(".plugin-consent")).not.toContain("overflow-y: auto");
  });

  it("makes the body the scroll container", () => {
    // `overflow-y: auto` is the whole fix, and it is also what makes the body shrinkable:
    // flexbox's automatic minimum size applies only to items whose `overflow` is `visible`, so
    // a scroll container already resolves `min-height: auto` to 0.
    //
    // An earlier version of this test also asserted `min-height: 0` and called it load-bearing.
    // The re-review overrode it at runtime and measured NO change — the assertion was inert and
    // the comment overstated it. The declaration is kept in the CSS as belt-and-braces should
    // the overflow ever change, but it is not asserted here, because a guard that cannot fail
    // for the reason it claims is worse than no guard.
    expect(block(".plugin-consent__body")).toContain("overflow-y: auto");
  });

  it("keeps the acknowledgement and the buttons outside the scrolled body", () => {
    useSettingsStore.setState({ locale: "en" });
    renderDialog({ intent: "install", trust: "trusted" });

    const body = screen
      .getByRole("dialog")
      .querySelector(".plugin-consent__body");
    expect(body).not.toBeNull();
    expect(body?.querySelector(".plugin-consent__ack")).toBeNull();
    expect(body?.querySelector(".plugin-consent__actions")).toBeNull();
    // …and they exist at all, so the assertions above are not satisfied by absence.
    expect(screen.getByRole("checkbox")).toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(2);
  });

  // The OTHER half of the original report — "it looked unstyled" — had no guard at all. The
  // re-review demonstrated it: overriding `.plugin-consent__cancel, .plugin-consent__confirm`
  // to `background: none; border: 0; padding: 0` turns both into bare text in the corner with
  // zero button affordance, and all 3773 tests stay green. `audit:css-vars` cannot see it (it
  // reports only UNDEFINED variables, and deleting a rule deletes its usages too) and stylelint
  // checks syntax and order, not presence.
  //
  // These assert that the load-bearing declarations EXIST. That is a weaker claim than "it looks
  // right" and is not a substitute for looking — but it is what stops the surfaces from being
  // silently flattened again.
  it.each([
    [".plugin-consent__danger", ["background:", "border:"]],
    [".plugin-consent__caps", ["background:", "border:"]],
    [".plugin-consent__cap::before", ["background:"]],
    [".plugin-consent__ack", ["background:", "border:"]],
    [".plugin-consent__confirm", ["background:", "border:"]],
    [".plugin-consent__cancel", ["border:"]],
  ])("%s keeps the declarations that make it a surface", (selector, props) => {
    const rule = block(selector);
    for (const prop of props) {
      expect(rule, `${selector} lost ${prop}`).toContain(prop);
    }
  });

  it.each([".plugin-consent__cancel", ".plugin-consent__confirm"])(
    "%s stays sized like a button",
    (selector) => {
      // `min-width` and `padding` are what stop them collapsing to their text. Both come from
      // the shared rule, which `declarationsFor` now finds for either selector.
      const rule = block(selector);
      expect(rule).toContain("min-width:");
      expect(rule).toContain("padding:");
    },
  );
});

describe("the capability badge renders in the app's language too", () => {
  // This had NO locale coverage: reverting `PluginCapabilityBadge`'s call site to
  // `CAPABILITY_DESCRIPTIONS` left all 90 tests in the plugin component directory green. The
  // badge shows these descriptions in the marketplace, so the defect was visible on a screen
  // the user reaches before the dialog.
  it("shows the English description, and no Korean, under en", () => {
    useSettingsStore.setState({ locale: "en" });
    render(<PluginCapabilityBadge capability="editor" showDescription />);

    const badge = screen.getByTitle(/Read and edit the document/);
    expect(HANGUL.test(badge.textContent ?? "")).toBe(false);
  });

  it("shows the Korean description under ko, in both the text and the tooltip", () => {
    useSettingsStore.setState({ locale: "ko" });
    render(<PluginCapabilityBadge capability="editor" showDescription />);

    // The tooltip is the half a reader never sees in a screenshot, so it is asserted explicitly.
    const badge = screen.getByTitle(/문서를 읽고 수정할 수 있습니다/);
    expect(badge.textContent).toMatch(/문서를 읽고 수정할 수 있습니다/);
  });
});
