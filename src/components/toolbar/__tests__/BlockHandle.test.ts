import { describe, expect, it } from "vitest";

import { nextHandleState } from "../use-block-handle-position";

// Pin: mousemove fires ~60/s and calls nextHandleState on every tick. If it
// always returned a fresh object, React couldn't bail out of re-rendering
// BlockHandle while the cursor sits over the same block — see BlockHandle.tsx.
describe("nextHandleState", () => {
  it("returns the same reference when pos and top are unchanged", () => {
    const prev = { pos: 5, top: 100 };
    expect(nextHandleState(prev, 100, 5)).toBe(prev);
  });

  it("returns a new object when top changes", () => {
    const prev = { pos: 5, top: 100 };
    const next = nextHandleState(prev, 120, 5);
    expect(next).not.toBe(prev);
    expect(next).toEqual({ pos: 5, top: 120 });
  });

  it("returns a new object when pos changes", () => {
    const prev = { pos: 5, top: 100 };
    const next = nextHandleState(prev, 100, 9);
    expect(next).not.toBe(prev);
    expect(next).toEqual({ pos: 9, top: 100 });
  });

  it("returns a new object when prev is null", () => {
    const next = nextHandleState(null, 100, 5);
    expect(next).toEqual({ pos: 5, top: 100 });
  });
});
