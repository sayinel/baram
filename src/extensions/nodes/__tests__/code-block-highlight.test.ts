// §5.4 / §5.12 — the two highlight styles stay tag-parallel, because the export
// maps between them BY POSITION.
//
// `lightHighlightDeclarations` exists so an export never carries the editor's
// theme: it turns whichever highlight class CodeMirror rendered into the LIGHT
// style's declarations. That mapping is positional, and positional mapping is
// only correct while the two `HighlightStyle.define` calls list the same tags in
// the same order. This file is what makes that an enforced invariant instead of
// a coincidence.
//
// ‼️ A colour→colour map was measured and rejected: the dark style reuses 9
// colours where the light style uses many, so `#e06c75` alone stands for #30a,
// #00c AND #256 depending on the tag. Anyone tempted to "simplify" this into a
// colour lookup should read that sentence twice.
import { HighlightStyle } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { describe, expect, it } from "vitest";

import {
  darkHighlightStyle,
  lightHighlightDeclarations,
  lightHighlightStyle,
} from "../code-block-highlight";

/** `.ͼp {color: #708;}` → [["ͼp", "color: #708;"], …] in spec order. */
function rules(style: HighlightStyle): Array<[string, string]> {
  const css = style.module?.getRules() ?? "";
  return [...css.matchAll(/\.([^\s{]+)\s*\{([^}]*)\}/g)].map((m) => [
    m[1],
    m[2].trim(),
  ]);
}

describe("the light and dark styles are positionally comparable", () => {
  it("emit the same number of rules", () => {
    const light = rules(lightHighlightStyle);
    const dark = rules(darkHighlightStyle);
    expect(light.length).toBeGreaterThan(10);
    expect(dark.length).toBe(light.length);
  });

  it("use disjoint class names, so the map needs both halves", () => {
    // Discriminating: if the two styles shared class names the positional map
    // would be unnecessary — and if they shared them PARTIALLY it would be
    // silently wrong.
    const light = new Set(rules(lightHighlightStyle).map(([c]) => c));
    const dark = rules(darkHighlightStyle).map(([c]) => c);
    expect(dark.some((c) => light.has(c))).toBe(false);
  });

  it("emit one rule per spec, in spec order", () => {
    // ‼️ The load-bearing assumption, checked against the installed
    // @codemirror/language rather than trusted. Two throwaway styles built from
    // one tag list must come back in that same order.
    const order = [tags.keyword, tags.string, tags.number, tags.comment];
    const build = (colors: string[]) =>
      HighlightStyle.define(order.map((tag, i) => ({ color: colors[i], tag })));
    const a = rules(build(["#a01", "#a02", "#a03", "#a04"]));

    expect(a).toHaveLength(order.length);
    a.forEach(([, decl], i) => {
      expect(decl).toContain(`#a0${i + 1}`);
    });
  });
});

describe("lightHighlightDeclarations", () => {
  const light = rules(lightHighlightStyle);
  const dark = rules(darkHighlightStyle);

  it("maps a DARK class to the light declarations for the same spec", () => {
    // The whole point: a token rendered under the dark theme prints in the
    // light palette.
    dark.forEach(([darkClass], i) => {
      expect(lightHighlightDeclarations([darkClass])).toBe(light[i][1]);
    });
  });

  it("maps a light class to itself", () => {
    // So a light-theme export takes the same code path — no branch that only
    // dark-theme users ever execute.
    light.forEach(([lightClass, decl]) => {
      expect(lightHighlightDeclarations([lightClass])).toBe(decl);
    });
  });

  it("actually changes the colour, i.e. is not a no-op", () => {
    // Vacuity guard. If the map ever collapsed to identity this whole file
    // would still pass the two checks above.
    const [darkClass] = dark[0];
    const darkDecl = dark[0][1];
    expect(lightHighlightDeclarations([darkClass])).not.toBe(darkDecl);
  });

  it("ignores classes it does not know", () => {
    // CodeMirror puts non-highlight classes on spans too.
    expect(lightHighlightDeclarations(["cm-matchingBracket"])).toBeNull();
    expect(lightHighlightDeclarations([])).toBeNull();
  });

  it("concatenates declarations when a token carries several classes", () => {
    const [a, b] = [dark[0][0], dark[1][0]];
    expect(lightHighlightDeclarations([a, b])).toBe(light[0][1] + light[1][1]);
  });
});
