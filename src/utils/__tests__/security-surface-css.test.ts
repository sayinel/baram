// §359 — the stylesheet each security surface's shadow root receives.
//
// Two ways this can fail silently, and one test each. (1) A class added to a surface's
// JSX but not to `SECURITY_SURFACE_CLASSES` renders unstyled inside the shadow, where
// no type error and no other suite looks. (2) An extractor that matched nothing would
// produce an empty sheet, and the surfaces would render as unstyled markup — which the
// existing component tests, being about text and roles, would not notice at all.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { cssRules } from "../../styles/__tests__/css-rules";
import {
  SECURITY_SURFACE_CLASSES,
  type SecuritySurface,
  securitySurfaceCss,
} from "../security-surface-css";
import { SECURITY_SURFACE_FILES } from "../security-surfaces";

const ROOT = path.resolve(__dirname, "../../..");

/**
 * Which entry of `SECURITY_SURFACE_CLASSES` belongs to which file of
 * `SECURITY_SURFACE_FILES`. Hand-written — there is no derivation from a file path to
 * a record key — but it cannot drift unnoticed: the first test below asserts this map's
 * key set is exactly `SECURITY_SURFACE_FILES`, which `security-surfaces.test.ts`
 * rebuilds from an effect scan on every run. A fourth surface appearing there fails
 * here until someone gives it a class list.
 */
const SURFACE_OF_FILE: Record<string, SecuritySurface> = {
  "src/components/plugins/PluginConsentDialog.tsx": "consentDialog",
  "src/components/plugins/PluginRevokedNotice.tsx": "revokedNotice",
  "src/components/settings/tabs/ApprovedRootsSection.tsx": "approvedRoots",
};

/**
 * The class names a component's JSX puts in the DOM, read out of its source.
 *
 * Walks from each `className=` to the end of ITS value and takes the string literals
 * there, rather than taking every literal on a line that mentions `className` — the
 * first draft did the latter and swallowed `aria-modal="true"` and `role="dialog"`
 * from the same tag. The value is either a quoted string or a braced expression, and
 * the braced form is matched by counting braces because the ternaries in these files
 * (`stopped ? "plugin-revoked" : "plugin-revoked plugin-revoked--warn"`) run across
 * several lines: a line-at-a-time reader finds the `className={` line and none of the
 * literals under it.
 *
 * A `className` built from a variable would escape this, which is why the extraction
 * test does not lean on this scan alone.
 */
function classesInSource(file: string): Set<string> {
  const src = readFileSync(path.join(ROOT, file), "utf-8");
  const found = new Set<string>();
  const attribute = /className\s*=\s*/gu;
  for (let m = attribute.exec(src); m !== null; m = attribute.exec(src)) {
    const start = m.index + m[0].length;
    let end = start;
    if (src[start] === '"') {
      end = src.indexOf('"', start + 1) + 1;
    } else if (src[start] === "{") {
      let depth = 0;
      for (; end < src.length; end++) {
        if (src[end] === "{") depth++;
        else if (src[end] === "}" && --depth === 0) break;
      }
      end += 1;
    } else {
      continue;
    }
    for (const literal of src.slice(start, end).matchAll(/"([^"]*)"/gu)) {
      for (const token of literal[1].split(/\s+/u)) {
        if (token !== "") found.add(token);
      }
    }
  }
  return found;
}

/**
 * Does `css` contain a selector for exactly this class?
 *
 * ‼️ The boundary is the whole point, and its absence made this guard decorative for
 * three of the 32 classes. A plain `css.includes(".plugin-consent")` is satisfied by
 * `.plugin-consent__body`, so the guard could not fail for `plugin-consent`,
 * `plugin-revoked` or `settings-section` — each of which is a prefix of a sibling that
 * is always present. Deleting the real `.plugin-consent { … }` rule left it green,
 * which would ship the consent dialog with no width, padding, border or background.
 *
 * A class name continues over `[A-Za-z0-9_-]`, so requiring the next character to be
 * outside that set (or the string to end) matches the class and not its prefixes.
 */
function selectorPresent(css: string, className: string): boolean {
  const escaped = className.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`\\.${escaped}(?![\\w-])`, "u").test(css);
}

/** Selectors the extracted sheet actually emits, comments and bodies stripped. */
function selectorsIn(css: string): string {
  return css
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/\{[^{}]*\}/gu, "{}")
    .replace(/\s+/gu, " ");
}

describe("§359 표면별 클래스 목록", () => {
  it("클래스 목록의 키가 보안 표면 파일 목록과 정확히 일치한다", () => {
    expect(Object.keys(SURFACE_OF_FILE).sort()).toEqual(
      [...SECURITY_SURFACE_FILES].sort(),
    );
    expect(Object.values(SURFACE_OF_FILE).sort()).toEqual(
      Object.keys(SECURITY_SURFACE_CLASSES).sort(),
    );
  });

  it("컴포넌트 소스에서 스캔한 클래스를 목록이 전부 담는다", () => {
    for (const [file, surface] of Object.entries(SURFACE_OF_FILE)) {
      const listed = new Set(SECURITY_SURFACE_CLASSES[surface]);
      // `security-surface-host`/`security-surface-content` are the wrapper's own, and
      // live in the light DOM or carry no rules; everything else on a `className` in
      // these files is a surface class.
      const missing = [...classesInSource(file)].filter(
        (c) => !listed.has(c) && !c.startsWith("security-surface"),
      );
      expect([file, missing]).toEqual([file, []]);
    }
  });

  it("스캐너가 실제로 클래스를 찾아낸다", () => {
    // Without this the assertion above is `expect([]).toEqual([])` forever. The floors
    // are per file so a scanner that silently stopped matching one shape cannot hide
    // behind another file's classes.
    expect(
      classesInSource("src/components/plugins/PluginConsentDialog.tsx").size,
    ).toBeGreaterThanOrEqual(16);
    expect(
      classesInSource("src/components/plugins/PluginRevokedNotice.tsx").size,
    ).toBeGreaterThanOrEqual(6);
    expect(
      classesInSource("src/components/settings/tabs/ApprovedRootsSection.tsx")
        .size,
    ).toBeGreaterThanOrEqual(10);
  });
});

describe("§359 shadow 안으로 들어가는 CSS", () => {
  it("규칙이 있는 클래스는 전부 추출된 시트에 나타난다", () => {
    // The corpus for "has a rule" is `cssRules()`, which walks every stylesheet under
    // `src/styles` outside `generated/` — the same reader the other CSS guards use. A
    // listed class with no rule anywhere is skipped rather than failed, because that
    // is a real state: `settings-section-title` is applied by
    // `ApprovedRootsSection.tsx` and defined by nothing (checked, 0 rules), so moving
    // it into a shadow root changes nothing about it.
    const defined = new Set<string>();
    for (const rule of cssRules()) {
      for (const match of rule.selector.matchAll(/\.([\w-]+)/gu)) {
        defined.add(match[1]);
      }
    }
    for (const [surface, classes] of Object.entries(SECURITY_SURFACE_CLASSES)) {
      const css = selectorsIn(securitySurfaceCss(surface as SecuritySurface));
      const absent = classes.filter(
        (c) => defined.has(c) && !selectorPresent(css, c),
      );
      expect([surface, absent]).toEqual([surface, []]);
    }
  });

  it("클래스 존재 검사가 접두사에 속지 않는다", () => {
    // Guards the guard above. Its predicate used to be `css.includes(".p" + c)`, and
    // three of the 32 classes are prefixes of siblings that are always present, so for
    // those three it could not fail — a review deleted the real `.plugin-consent` rule
    // and it stayed green, which would ship the dialog with no width, padding, border
    // or background.
    //
    // The mutation below is the isolating one. Deleting the rule from `plugins.css`
    // does NOT test this: `defined` is rebuilt from the same stylesheets, so the class
    // leaves both sides at once and the guard skips it. What has to be simulated is the
    // class going missing from the OUTPUT while its rule still exists — a selector that
    // gains a foreign class, or a class list that loses an entry.
    for (const [surface, className] of [
      ["consentDialog", "plugin-consent"],
      ["revokedNotice", "plugin-revoked"],
      ["approvedRoots", "settings-section"],
    ] as [SecuritySurface, string][]) {
      const css = selectorsIn(securitySurfaceCss(surface));
      expect([className, selectorPresent(css, className)]).toEqual([
        className,
        true,
      ]);
      const without = css.replace(`.${className}{}`, "");
      // The prefix siblings are still there, which is exactly why the old predicate
      // could not see the difference…
      expect([className, without.includes(`.${className}`)]).toEqual([
        className,
        true,
      ]);
      // …and why this one has to.
      expect([className, selectorPresent(without, className)]).toEqual([
        className,
        false,
      ]);
    }
  });

  it("경계가 떨어뜨리는 앱 전역 규칙을 함께 싣는다", () => {
    // These three are the ones no surface class can pull in, and each is a real
    // dependency rather than a precaution: the focus outline is how a keyboard user
    // sees where they are in a consent dialog, the reduced-motion reset is what
    // `plugins.css` points at instead of guarding its own two animations, and the
    // keyframes are named by `.plugin-consent-overlay` and `.plugin-consent`.
    const consent = securitySurfaceCss("consentDialog");
    expect(consent).toContain("*:focus-visible");
    expect(consent).toContain("prefers-reduced-motion");
    expect(consent).toContain("@keyframes plugin-consent-fade");
    expect(consent).toContain("@keyframes plugin-consent-rise");
    // Tailwind's preflight is not readable from source (`base.css:8` imports the
    // package and the build expands it), so `security-surfaces.css` restates the two
    // declarations these rules depend on. Neither property is inherited, which is why
    // neither crosses the boundary on its own.
    expect(consent).toContain("box-sizing: border-box");
    expect(consent).toContain("font: inherit");
  });

  it("shadow 밖 조상에 기대는 규칙은 싣지 않는다", () => {
    // A rule like `[data-theme="dark"] .plugin-consent` would be extracted as a rule
    // about a surface class and then match NOTHING inside the shadow, because its
    // ancestor is `<html>`. There is no such rule today; this fails the day someone
    // writes one, which is the moment to decide what to do about it rather than
    // shipping a silently dead declaration. Theme values arrive by inheritance
    // instead — custom properties cross the boundary — so a token block on `:root` is
    // correctly not extracted.
    for (const surface of Object.keys(SECURITY_SURFACE_CLASSES)) {
      const css = selectorsIn(securitySurfaceCss(surface as SecuritySurface));
      expect([surface, /data-theme|\bhtml\b|:root/u.test(css)]).toEqual([
        surface,
        false,
      ]);
    }
  });

  it("표면 클래스를 언급하는 규칙 중 버려지는 것은 열거된 것뿐이다", () => {
    // The complement of the test above, and the one that catches a REAL loss. A
    // selector like `.plugin-row .plugin-revoked { … }` mentions a surface class but
    // also a foreign one, so the extractor drops it — and it could not have worked
    // inside the shadow anyway, since the ancestor is in the light DOM. Either way the
    // styling silently disappears, so the day someone writes one this must fail and
    // make them choose, rather than shipping a rule that reaches nothing.
    //
    // Exactly one is dropped today, and it is inert here: `.text-truncate` is a shared
    // base.css utility and `zettelkasten.css` narrows it under a hub-list row, an
    // ancestor no security surface has. Not a competing definition — a different rule
    // for a different place.
    const allowed = new Set([".zettel-hub-list-row > .text-truncate"]);
    for (const [surface, classes] of Object.entries(SECURITY_SURFACE_CLASSES)) {
      const wanted = new Set<string>(classes);
      const dropped: string[] = [];
      for (const rule of cssRules()) {
        for (const selector of rule.selector.split(",")) {
          const names = [...selector.matchAll(/\.([\w-]+)/gu)].map((m) => m[1]);
          if (!names.some((n) => wanted.has(n))) continue;
          if (names.every((n) => wanted.has(n))) continue;
          const text = selector.trim().replace(/\s+/gu, " ");
          if (!allowed.has(text)) dropped.push(`${text} (${rule.file})`);
        }
      }
      expect([surface, dropped]).toEqual([surface, []]);
    }
  });

  it("표면마다 자기 클래스만 받는다", () => {
    // The revoked notice is an inline strip; handing it the modal's stylesheet would
    // be harmless but would make the sheets untraceable to their surface.
    // Comments stripped: the boundary stylesheet's header names `.plugin-consent`
    // while explaining what it restates, and a raw substring check reads that as a
    // selector.
    expect(selectorsIn(securitySurfaceCss("revokedNotice"))).not.toContain(
      ".plugin-consent",
    );
    expect(selectorsIn(securitySurfaceCss("approvedRoots"))).not.toContain(
      ".plugin-revoked",
    );
  });
});
