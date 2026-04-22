import { describe, expect, it } from "vitest";

import { preprocessNotionFormula } from "../notion-katex-compat";

describe("preprocessNotionFormula — substitutions outside protected regions", () => {
  it("replaces bare Greek letters", () => {
    expect(preprocessNotionFormula("alpha + beta")).toBe("\\alpha + \\beta");
  });

  it("replaces Notion shortcuts", () => {
    expect(preprocessNotionFormula("oo")).toBe("\\infty");
    expect(preprocessNotionFormula("a <= b")).toBe("a \\leq b");
    expect(preprocessNotionFormula("x xx y")).toBe("x \\times y");
  });

  it("prefers longest shortcut match", () => {
    expect(preprocessNotionFormula("a <=> b")).toBe("a \\Leftrightarrow b");
    expect(preprocessNotionFormula("a <-> b")).toBe("a \\leftrightarrow b");
  });

  it("skips substitution when preceded by backslash", () => {
    expect(preprocessNotionFormula("\\alpha")).toBe("\\alpha");
    expect(preprocessNotionFormula("\\infty")).toBe("\\infty");
  });
});

describe("preprocessNotionFormula — \\text{...} protects content (regression)", () => {
  it("does not rewrite `oo` inside \\text{headroom}", () => {
    const input = "\\text{headroom}_i(t)";
    expect(preprocessNotionFormula(input)).toBe(input);
  });

  it("does not rewrite shortcuts inside \\text{}", () => {
    expect(preprocessNotionFormula("\\text{max xx min}")).toBe(
      "\\text{max xx min}",
    );
    expect(preprocessNotionFormula("\\text{a <= b}")).toBe("\\text{a <= b}");
  });

  it("does not rewrite bare Greek words inside \\text{}", () => {
    expect(preprocessNotionFormula("\\text{the alpha release}")).toBe(
      "\\text{the alpha release}",
    );
  });

  it("protects common text-mode variants", () => {
    expect(preprocessNotionFormula("\\textrm{room}")).toBe("\\textrm{room}");
    expect(preprocessNotionFormula("\\textbf{book}")).toBe("\\textbf{book}");
    expect(preprocessNotionFormula("\\textit{too}")).toBe("\\textit{too}");
    expect(preprocessNotionFormula("\\texttt{pool}")).toBe("\\texttt{pool}");
  });

  it("protects mathrm and operatorname identifier wrappers", () => {
    expect(preprocessNotionFormula("\\mathrm{headroom}")).toBe(
      "\\mathrm{headroom}",
    );
    expect(preprocessNotionFormula("\\operatorname{loo}")).toBe(
      "\\operatorname{loo}",
    );
  });

  it("handles nested braces inside \\text{}", () => {
    const input = "\\text{a {inner oo} b}";
    expect(preprocessNotionFormula(input)).toBe(input);
  });

  it("handles escaped braces inside \\text{}", () => {
    const input = "\\text{oo \\{ oo \\} oo}";
    expect(preprocessNotionFormula(input)).toBe(input);
  });

  it("tolerates whitespace between command and opening brace", () => {
    const input = "\\text {headroom}";
    expect(preprocessNotionFormula(input)).toBe(input);
  });
});

describe("preprocessNotionFormula — mixed contexts", () => {
  it("substitutes outside while preserving inside \\text{}", () => {
    expect(preprocessNotionFormula("alpha + \\text{headroom}_i(t)")).toBe(
      "\\alpha + \\text{headroom}_i(t)",
    );
  });

  it("handles multiple \\text{} blocks independently", () => {
    expect(
      preprocessNotionFormula("\\text{foo oo}_\\alpha + \\text{bar xx}_\\beta"),
    ).toBe("\\text{foo oo}_\\alpha + \\text{bar xx}_\\beta");
  });

  it("substitutes outside a \\text{} that is followed by shortcuts", () => {
    expect(preprocessNotionFormula("\\text{room} + oo")).toBe(
      "\\text{room} + \\infty",
    );
  });

  it("substitutes before and after without touching protected region", () => {
    expect(preprocessNotionFormula("oo + \\text{headroom} + xx")).toBe(
      "\\infty + \\text{headroom} + \\times",
    );
  });

  it("protects tail when braces are unbalanced (mid-typing)", () => {
    // Missing closing brace — user is likely mid-typing. We protect from the
    // opening command through end-of-string so partial content isn't mangled;
    // KaTeX still surfaces the missing-brace error to the user.
    expect(preprocessNotionFormula("alpha + \\text{headroom + oo")).toBe(
      "\\alpha + \\text{headroom + oo",
    );
  });

  it("protects full document example from the bug report", () => {
    expect(preprocessNotionFormula("\\text{headroom}_i(t)")).toBe(
      "\\text{headroom}_i(t)",
    );
  });
});
