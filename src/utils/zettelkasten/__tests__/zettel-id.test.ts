import { describe, expect, it } from "vitest";

import { generateZettelId } from "../zettel-id";

describe("generateZettelId", () => {
  it("returns a 12-digit YYYYMMDDHHmm id when no collision", () => {
    const id = generateZettelId(new Set());
    expect(id).toMatch(/^\d{12}$/);
  });

  it("appends seconds (14 digits) when the minute id already exists", () => {
    const minuteId = generateZettelId(new Set());
    const id = generateZettelId(new Set([minuteId]));
    expect(id).toMatch(/^\d{14}$/);
    expect(id).not.toBe(minuteId);
  });

  it("keeps incrementing until an unused id is found", () => {
    const minuteId = generateZettelId(new Set());
    // Pre-fill the minute id + the first ~5 second-slots
    const taken = new Set<string>([minuteId]);
    for (let s = 0; s < 5; s++) {
      taken.add(minuteId + String(s).padStart(2, "0"));
    }
    const id = generateZettelId(taken);
    expect(taken.has(id)).toBe(false);
    expect(id).toMatch(/^\d{14}$/);
  });
});
