// §385 spec 0061 §7 — one rule set for three layers (gate, sandbox pre-check, host validator).
import { describe, expect, it } from "vitest";

import {
  inputBoxProblem,
  promptFrameProblem,
  quickPickProblem,
} from "../prompt-shape";
import { PROMPT_LIMITS } from "../sandbox/protocol";

const item = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  label: `L${id}`,
  ...extra,
});
const over = (n: number) => "x".repeat(n + 1);

describe("quickPickProblem", () => {
  it("accepts a request that sits exactly on every limit", () => {
    const items = Array.from({ length: PROMPT_LIMITS.items }, (_, i) =>
      item(String(i).padStart(PROMPT_LIMITS.idChars, "0"), {
        description: "d".repeat(PROMPT_LIMITS.stringChars),
      }),
    );
    expect(
      quickPickProblem(items, {
        placeholder: "p".repeat(PROMPT_LIMITS.stringChars),
        title: "t",
      }),
    ).toBeNull();
  });

  it.each([
    ["not an array", "x", undefined, /items must be an array/],
    ["an empty list", [], undefined, /must not be empty/],
    [
      "one item too many",
      Array.from({ length: PROMPT_LIMITS.items + 1 }, (_, i) =>
        item(String(i)),
      ),
      undefined,
      /items: at most 5000/,
    ],
    [
      "an id one over",
      [item(over(PROMPT_LIMITS.idChars))],
      undefined,
      /items\[0\]: id: at most 100/,
    ],
    [
      "a duplicate id",
      [item("a"), item("a")],
      undefined,
      /items\[1\]: id "a" appears twice/,
    ],
    [
      "a non-string label",
      [{ id: "a", label: 3 }],
      undefined,
      /label must be a string/,
    ],
    [
      "a label over the string bound",
      [item("a", { label: over(PROMPT_LIMITS.stringChars) })],
      undefined,
      /label: at most 4096/,
    ],
    [
      "a non-string description",
      [item("a", { description: 1 })],
      undefined,
      /description must be a string/,
    ],
    [
      "opts that are not an object",
      [item("a")],
      "opts",
      /opts must be an object/,
    ],
    [
      "a title over the string bound",
      [item("a")],
      { title: over(PROMPT_LIMITS.stringChars) },
      /opts\.title: at most 4096/,
    ],
  ])("refuses %s", (_name, items, opts, reason) => {
    expect(quickPickProblem(items, opts)).toMatch(reason);
  });
});

describe("inputBoxProblem", () => {
  it("accepts no options, and a value exactly at the limit", () => {
    expect(inputBoxProblem(undefined)).toBeNull();
    expect(
      inputBoxProblem({ value: "v".repeat(PROMPT_LIMITS.valueChars) }),
    ).toBeNull();
  });

  it("refuses a value one over, and a value that is not a string", () => {
    expect(inputBoxProblem({ value: over(PROMPT_LIMITS.valueChars) })).toMatch(
      /opts\.value: at most 1000/,
    );
    expect(inputBoxProblem({ value: 5 })).toMatch(
      /opts\.value must be a string/,
    );
  });
});

describe("promptFrameProblem", () => {
  it("flags a lone surrogate anywhere, even right after another hit", () => {
    // Guards the `g`-flag trap: a global regex's `test` keeps `lastIndex` and misses the next hit.
    const bad = {
      items: [{ id: "a", label: "0123456789\uD800" }],
      kind: "prompt_quick_pick" as const,
    };
    const worse = {
      items: [{ id: "\uD800", label: "a" }],
      kind: "prompt_quick_pick" as const,
    };
    expect(promptFrameProblem(bad)).toMatch(/lone surrogate/);
    expect(promptFrameProblem(worse)).toMatch(/lone surrogate/);
    expect(
      promptFrameProblem({
        items: [{ id: "a", label: "😀" }],
        kind: "prompt_quick_pick",
      }),
    ).toBeNull();
  });
});
