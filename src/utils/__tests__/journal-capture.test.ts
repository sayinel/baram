/**
 * §56l Phase B — Daily Capture utility tests
 */
import { describe, expect, it } from "vitest";

import { CAPTURE_ICONS, CAPTURE_TYPES } from "../journal/journal-capture";

describe("§56l Capture types and constants", () => {
  it("has 4 capture types", () => {
    expect(CAPTURE_TYPES).toEqual(["idea", "link", "quote", "note"]);
  });

  it("maps types to icons", () => {
    expect(CAPTURE_ICONS.idea).toBe("✦");
    expect(CAPTURE_ICONS.link).toBe("↗");
    expect(CAPTURE_ICONS.quote).toBe("❝");
    expect(CAPTURE_ICONS.note).toBe("☰");
  });
});
