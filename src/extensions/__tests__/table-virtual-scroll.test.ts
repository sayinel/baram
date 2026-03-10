// §5.5 M10 Table Virtual Scroll — unit tests
import { describe, expect, it } from "vitest";

import {
  shouldApplyVirtualScroll,
  VIRTUAL_SCROLL_THRESHOLD,
} from "../nodes/table-virtual-scroll";

describe("Table Virtual Scroll", () => {
  describe("VIRTUAL_SCROLL_THRESHOLD", () => {
    it("should be 50", () => {
      expect(VIRTUAL_SCROLL_THRESHOLD).toBe(50);
    });
  });

  describe("shouldApplyVirtualScroll", () => {
    it("returns false for tables with fewer than 50 rows", () => {
      expect(shouldApplyVirtualScroll(0)).toBe(false);
      expect(shouldApplyVirtualScroll(1)).toBe(false);
      expect(shouldApplyVirtualScroll(49)).toBe(false);
    });

    it("returns true for tables with exactly 50 rows", () => {
      expect(shouldApplyVirtualScroll(50)).toBe(true);
    });

    it("returns true for tables with more than 50 rows", () => {
      expect(shouldApplyVirtualScroll(51)).toBe(true);
      expect(shouldApplyVirtualScroll(100)).toBe(true);
      expect(shouldApplyVirtualScroll(1000)).toBe(true);
    });
  });
});
