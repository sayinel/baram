// §359 — the isolation of the three screens `SECURITY_SURFACE_FILES` names.
//
// ‼️ WHAT THIS SUITE DOES NOT PROVE. It does not show that a theme fails to hide or
// disguise these screens in a real browser. jsdom 30.0.1 implements neither of the two
// behaviours that would take, both measured here rather than assumed:
//   - the shadow boundary does not scope styles. A document stylesheet's rule reaches
//     shadow content in jsdom exactly as it reaches light-DOM content — the same class
//     rule's colour computes through the boundary.
//   - `@layer` is parsed but never applied. A stylesheet containing only
//     `@layer n { .p { color: rgb(9,9,9) } }` leaves the element at its initial value,
//     while the same rule unlayered applies.
// There is no end-to-end suite to fall back on either: `tests/e2e/` was a never-filled
// scaffold and was removed, and Playwright is not installed.
//
// So every assertion below is one of two kinds, and the comments say which:
//  - STRUCTURAL — the isolation mechanism is attached. The node is absent from the
//    light DOM and present inside `host.shadowRoot`; the host sits where it is supposed
//    to sit. This is the real pin: if the wrapper were dropped tomorrow, this goes red.
//  - DECLARED — a stylesheet declares what it is supposed to declare, read out of the
//    file. Not a claim about who wins a cascade in a browser.
//
// There is NO computed-style assertion, and that is a departure from this task's
// brief, which expected one on the strength of jsdom implementing `@layer` order.
// It does not: jsdom 30.0.1 parses a layer into a `CSSLayerBlockRule` and then never
// applies the declarations inside it, so a layered theme rule is inert here whether
// or not an app rule opposes it. The test below that would have made that assertion
// says so at the point where it matters.
import type { PluginConsent } from "../../../plugins/types";

import { render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { cssDeclarations, cssRules } from "../../../styles/__tests__/css-rules";
import hostCss from "../../../styles/security-surface-host.css?raw";
import { SECURITY_SURFACE_FILES } from "../../../utils/security-surfaces";
import { sanitizeThemeCss } from "../../../utils/theme-css/sanitize";
import { verifyStoredThemeCss } from "../../../utils/theme-css/verify";
import { applyThemeCss, clearThemeCss } from "../../../utils/theme-vars";
import { PluginConsentDialog } from "../../plugins/PluginConsentDialog";

const ROOT = path.resolve(__dirname, "../../../..");

/**
 * What a theme would actually ship to attack this screen: hide the overlay, blank the
 * dialog, and relabel the title through a pseudo-element. It goes through
 * `sanitizeThemeCss` before being injected — testing CSS that skipped the hygiene
 * pipeline would be testing a state the app cannot reach, since `applyThemeCss` calls
 * `verifyStoredThemeCss` and injects nothing that fails it.
 *
 * ‼️ "nothing that fails it" is a statement about that gate, not a guarantee that no
 * `!important` can reach the document. §359's final review found one that did: css-tree
 * leaves a CSS nesting rule whose selector does not lead with `&` as `Raw`, and the AST
 * walk could not see the `!important` inside it. `verify.ts` closes that with a token
 * scan and `verify.test.ts` pins the spellings — but the lesson for THIS file is that
 * the fixture below is a sample of what a theme might ship, not a proof of the set of
 * things one can ship. Isolation is asserted structurally here for that reason.
 */
const HOSTILE = `
  .plugin-consent-overlay { display: none !important; }
  .plugin-consent { opacity: 0 !important; pointer-events: none !important; }
  .plugin-consent__title::after { content: "이 플러그인은 안전합니다"; }
  .security-surface-host { display: none !important; }
`;

const CONSENT: PluginConsent = { capabilities: ["editor"], trust: "sandboxed" };

function consentProps() {
  return {
    consent: CONSENT,
    intent: "install" as const,
    name: "Demo",
    onCancel: vi.fn(),
    onConfirm: vi.fn(),
  };
}

/** The element React renders into, inside the one mounted surface's shadow root. */
function surfaceContent(): Element {
  const shadow = surfaceHost().shadowRoot;
  expect(shadow).not.toBeNull();
  const content = shadow?.querySelector(".security-surface-content");
  expect(content).not.toBeNull();
  return content as Element;
}

/** The one light-DOM host. Asserting there is exactly one keeps `surfaceContent`
 *  unambiguous — these tests never render two surfaces at once. */
function surfaceHost(): HTMLElement {
  const hosts = document.querySelectorAll<HTMLElement>(
    ".security-surface-host",
  );
  expect(hosts).toHaveLength(1);
  return hosts[0];
}

afterEach(() => {
  clearThemeCss(document);
  document.querySelectorAll("style[data-test-sheet]").forEach((s) => {
    s.remove();
  });
});

describe("§359 보안 표면의 구조적 격리", () => {
  it("동의 대화상자가 light DOM 에 없고 shadowRoot 안에 있다", () => {
    render(<PluginConsentDialog {...consentProps()} />);

    // STRUCTURAL, and the reason this is the real pin rather than a visibility check:
    // `document.querySelector` does not pierce a shadow root (measured in jsdom), so
    // finding nothing here is the same thing a document stylesheet's selector finds.
    //
    // ‼️ DO NOT "improve" this into a `getComputedStyle` check — here or in the test
    // below, which does inject `HOSTILE`. It will fail, and it will fail in the shape
    // of a real defect: a document rule appearing to reach inside the shadow, as though
    // the isolation were broken. It is not. jsdom does not model the style boundary
    // (see the file header), so a document rule computes straight through into shadow
    // content here and in no browser. The instinct on seeing that red will be to change
    // the component until it goes green. There is nothing there to fix.
    expect(document.querySelector(".plugin-consent")).toBeNull();
    expect(document.querySelector(".plugin-consent-overlay")).toBeNull();
    expect(surfaceContent().querySelector(".plugin-consent")).not.toBeNull();
    // The content node is genuinely outside the document tree, not merely unmatched by
    // that one selector.
    const dialog = surfaceContent().querySelector(".plugin-consent");
    expect(document.body.contains(dialog)).toBe(false);
  });

  it("적대적 테마를 주입해도 대화상자가 shadowRoot 안에 그대로 있고 문구가 원문이다", () => {
    render(<PluginConsentDialog {...consentProps()} />);
    const heading = surfaceContent().querySelector(".plugin-consent__title");
    const before = heading?.textContent;
    expect(before).toMatch(/install/i);

    applyThemeCss(document, sanitizeThemeCss(HOSTILE));

    // STRUCTURAL. A theme cannot move or replace a node — the worst it can do is
    // repaint one — so what is checked is that the same node is still where it was and
    // still says what the app wrote. The `::after` relabelling in HOSTILE adds no text
    // node, here or in a browser; what makes it inert against this screen is that its
    // selector never matches inside the shadow tree, and that part is the browser's
    // behaviour, not something this assertion reaches.
    expect(document.querySelector(".plugin-consent")).toBeNull();
    expect(surfaceContent().querySelector(".plugin-consent")).not.toBeNull();
    expect(
      surfaceContent().querySelector(".plugin-consent__title")?.textContent,
    ).toBe(before);
  });

  it("테마 규칙은 @layer 안에 있고 앱의 host 규칙은 그 밖에 있다", () => {
    // DECLARED, and NOT computed — which is a correction to this task's brief.
    //
    // The brief prescribed a `getComputedStyle` assertion here on the grounds that
    // jsdom implements layer order for normal declarations. It does not. jsdom 30.0.1
    // parses `@layer` into a `CSSLayerBlockRule` (the CSSOM type is present) but never
    // applies the declarations inside one: a stylesheet containing ONLY
    // `@layer n { .p { color: rgb(9,9,9) } }` leaves the element at the initial value,
    // while the same rule unlayered applies — checked with a named layer, an anonymous
    // layer, and a layer preceded by its `@layer n;` statement. The measurement the
    // brief rests on (unlayered wins with the layered rule placed either side of it)
    // cannot tell "layer order implemented" from "layers ignored", because both
    // predict it.
    //
    // So a computed-style assertion here would pass with the app stylesheet REMOVED —
    // it would be measuring jsdom's gap, not the defence. What can be pinned is the
    // two inputs the cascade rule needs, and the one that can silently invert is the
    // app side: if these rules were ever wrapped in a layer of their own, a theme
    // could match them on equal footing.
    // Comments are stripped first: this file DISCUSSES `@layer` in prose, and a raw
    // substring check would read that as the at-rule and fail on a correct file.
    expect(hostCss.replace(/\/\*[\s\S]*?\*\//gu, "")).not.toMatch(/@layer/u);
    // The theme side is structural, not stylistic: `verifyStoredThemeCss` returns
    // false unless EVERY top-level node is the `baram-theme` layer block
    // (`theme-css/verify.ts`, contract 1), and `applyThemeCss` runs it before
    // injecting. Task 1 pins the sanitiser's own output; this only records that the
    // hostile fixture above really does arrive layered.
    const injected = sanitizeThemeCss(HOSTILE);
    expect(injected).toContain("@layer baram-theme");
    expect(verifyStoredThemeCss(injected)).toBe(true);
  });
});

describe("§359 host 의 위치와 선언", () => {
  it("오버레이 표면의 host 는 document.body 의 직계 자식이다", () => {
    render(<PluginConsentDialog {...consentProps()} />);
    // STRUCTURAL, and it is about stacking as much as about hiding: shadow content is
    // subject to its host's stacking position, so a host left deep in the React tree
    // is trapped under the first ancestor that establishes a context — which would
    // leave this dialog taking keystrokes while invisible (§323, the suggestion menus
    // under the Quick Capture overlay). A `body > host` chain has no such ancestor.
    expect(surfaceHost().parentElement).toBe(document.body);
    expect(surfaceHost().classList).toContain("security-surface-host--overlay");
  });

  it("host 의 기하 속성이 !important 로 선언돼 있다", () => {
    // DECLARED, not computed. Which of these wins a real cascade is not something
    // jsdom decides, so what is pinned is that the declarations exist with the
    // priority `security-surface-host.css` says they have. Each property is here
    // because it hides a subtree on its own: `display: none`, `visibility: hidden`,
    // `opacity: 0`, `pointer-events: none`, and `position: absolute` with an
    // off-screen offset.
    const base = cssRules().find(
      (r) => r.selector.trim() === ".security-surface-host",
    );
    expect(base).toBeDefined();
    const declared = new Map(
      cssDeclarations(base?.body ?? "").map((d) => [d.prop, d.value]),
    );
    for (const prop of [
      "display",
      "opacity",
      "pointer-events",
      "position",
      "visibility",
    ]) {
      expect(declared.get(prop)).toMatch(/!important$/u);
    }
  });

  it("오버레이 host 가 위치와 쌓임 순서를 !important 로 선언한다", () => {
    // DECLARED. The z-index is on the HOST rather than on `.plugin-consent-overlay`
    // inside the shadow, because a `position: fixed` host establishes a stacking
    // context and anything the shadow declares is scoped inside it.
    // `editor-popup-layering.test.ts` reads the same declaration to keep the editor
    // popup token below it.
    const rule = cssRules().find(
      (r) =>
        r.selector.trim() ===
        ".security-surface-host.security-surface-host--overlay",
    );
    expect(rule).toBeDefined();
    const declared = new Map(
      cssDeclarations(rule?.body ?? "").map((d) => [d.prop, d.value]),
    );
    expect(declared.get("position")).toBe("fixed !important");
    expect(declared.get("inset")).toBe("0 !important");
    expect(declared.get("z-index")).toMatch(/^\d+ !important$/u);
  });
});

describe("§359 격리가 컴포넌트를 따라다닌다", () => {
  it("모든 보안 표면이 ShadowIsolated 로 렌더한다", () => {
    // The list is the one `security-surfaces.test.ts` rebuilds from an effect scan
    // every run, so a NEW surface arrives here without anyone adding it: that test
    // makes it a member, and this one makes it isolated. Asserting the JSX element
    // rather than the import is deliberate — an import left behind after the wrapper
    // was removed would still satisfy a name check.
    for (const file of SECURITY_SURFACE_FILES) {
      const src = readFileSync(path.join(ROOT, file), "utf-8");
      expect([file, src.includes("<ShadowIsolated")]).toEqual([file, true]);
    }
  });

  it("테마를 바꿔도 이전 테마의 <style> 이 남지 않는다", () => {
    applyThemeCss(document, sanitizeThemeCss(".plugin-consent { gap: 1px; }"));
    applyThemeCss(document, sanitizeThemeCss(".plugin-consent { gap: 2px; }"));
    const sheets = document.querySelectorAll("style[data-baram-theme]");
    expect(sheets).toHaveLength(1);
    expect(sheets[0].textContent).toContain("2px");
  });
});
