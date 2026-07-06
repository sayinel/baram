import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { generateZettelId, localIsoMinute } from "../zettel-id";

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

describe("localIsoMinute", () => {
  beforeEach(() => {
    // Fix the clock so id + iso are read at the exact same instant —
    // avoids flakiness from a minute boundary ticking between calls.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 5, 15, 30, 42)); // local: 2026-07-05T15:30:42
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns a LOCAL YYYY-MM-DDTHH:mm timestamp (no seconds, zero-padded)", () => {
    expect(localIsoMinute()).toBe("2026-07-05T15:30");
  });

  it("agrees with the local-time digits baked into the zettel id", () => {
    const id = generateZettelId(new Set());
    expect(localIsoMinute().replace(/[-T:]/g, "")).toBe(id);
  });
});
