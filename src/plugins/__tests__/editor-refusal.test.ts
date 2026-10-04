import type { EditorRefusalCode } from "../types";

// §388 spec 0067 §10 — the refusal codes: the union and the runtime list must not drift.
import { describe, expect, it } from "vitest";

import { isEditorRefusalCode } from "../editor-refusal";
import { EDITOR_REFUSAL_CODES } from "../types";

// A missing or extra key here is a type error, so the union cannot grow without this file.
const all: Record<EditorRefusalCode, true> = {
  budget: true,
  "cannot-insert-here": true,
  "document-changed": true,
  "no-editor": true,
  "not-permitted": true,
  "ref-other-document": true,
  "ref-range-changed": true,
  "ref-unknown": true,
  "surface-blocked": true,
};

describe("refusal codes", () => {
  it("the runtime list is exactly the union", () => {
    expect(Object.keys(all).sort()).toEqual([...EDITOR_REFUSAL_CODES].sort());
  });

  it("isEditorRefusalCode accepts each code and nothing else", () => {
    for (const code of EDITOR_REFUSAL_CODES) {
      expect(isEditorRefusalCode(code)).toBe(true);
    }
    expect(isEditorRefusalCode("nope")).toBe(false);
    expect(isEditorRefusalCode(undefined)).toBe(false);
    expect(isEditorRefusalCode(42)).toBe(false);
  });
});
