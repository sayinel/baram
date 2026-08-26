// §312 — the task-delete confirmation is the first caller to put arbitrary-length,
// arbitrary-whitespace user text (a raw task line) into `.ai-prompt-label`. The other
// three callers (showPrompt, showAlert, field-dialog heading) only ever set short,
// app-authored strings, so this guard is safe to apply to the whole class rather than
// scoping a new one to the delete dialog — see cssRules() below finding one shared rule.
import { describe, expect, it } from "vitest";

import { cssDeclarations, cssRules } from "./css-rules";

const RULE = cssRules().find((rule) => rule.selector === ".ai-prompt-label");

describe(".ai-prompt-label", () => {
  it("names a rule that exists, so a renamed selector cannot pass silently", () => {
    expect(RULE).toBeDefined();
  });

  // A task line with no spaces (a long URL, a long identifier) has no break
  // opportunity under normal wrapping rules and stretches the dialog horizontally
  // instead of wrapping. `anywhere` — not `break-word` — also lets the text still
  // count toward min-content sizing, matching layout.css's identical guard.
  it("breaks an unbroken run of characters instead of widening the dialog", () => {
    const decl = cssDeclarations(RULE!.body).find(
      (d) => d.prop === "overflow-wrap",
    );
    expect(decl?.value).toBe("anywhere");
  });

  // Default `white-space: normal` collapses leading spaces/tabs, which is exactly
  // what makes an indented sub-item and its unindented parent read identically in
  // the delete confirmation. `pre-wrap` preserves the run without giving up wrapping.
  it("keeps whitespace runs (leading indentation) instead of collapsing them", () => {
    const decl = cssDeclarations(RULE!.body).find(
      (d) => d.prop === "white-space",
    );
    expect(decl?.value).toBe("pre-wrap");
  });
});
