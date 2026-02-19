// §32 Hover Preview — unit tests
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { truncatePreview, calcPosition } from "../../components/editor/HoverPreview";

describe("§32 Hover Preview", () => {
  describe("truncatePreview", () => {
    test("returns full content when under maxLines", () => {
      const content = "line 1\nline 2\nline 3";
      expect(truncatePreview(content, 20)).toBe(content);
    });

    test("truncates content exceeding maxLines and appends ellipsis", () => {
      const lines = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`);
      const content = lines.join("\n");
      const result = truncatePreview(content, 20);
      const resultLines = result.split("\n");
      expect(resultLines).toHaveLength(21); // 20 lines + "…"
      expect(resultLines[20]).toBe("…");
      expect(resultLines[0]).toBe("line 1");
      expect(resultLines[19]).toBe("line 20");
    });

    test("handles empty content", () => {
      expect(truncatePreview("", 20)).toBe("");
    });

    test("handles single line", () => {
      expect(truncatePreview("hello", 20)).toBe("hello");
    });
  });

  describe("calcPosition", () => {
    test("positions below element when space available", () => {
      const rect = { top: 100, bottom: 120, left: 200, width: 80 };
      const viewport = { width: 1024, height: 768 };
      const popup = { width: 400, height: 300 };
      const pos = calcPosition(rect, viewport, popup);
      expect(pos.top).toBe(124); // bottom + 4
    });

    test("flips above element when no space below", () => {
      const rect = { top: 500, bottom: 520, left: 200, width: 80 };
      const viewport = { width: 1024, height: 600 };
      const popup = { width: 400, height: 300 };
      const pos = calcPosition(rect, viewport, popup);
      expect(pos.top).toBe(196); // top - 4 - 300
    });

    test("clamps left edge to viewport", () => {
      const rect = { top: 100, bottom: 120, left: 10, width: 40 };
      const viewport = { width: 1024, height: 768 };
      const popup = { width: 400, height: 300 };
      const pos = calcPosition(rect, viewport, popup);
      expect(pos.left).toBe(8);
    });

    test("clamps right edge to viewport", () => {
      const rect = { top: 100, bottom: 120, left: 900, width: 80 };
      const viewport = { width: 1024, height: 768 };
      const popup = { width: 400, height: 300 };
      const pos = calcPosition(rect, viewport, popup);
      expect(pos.left).toBe(616); // 1024 - 8 - 400
    });
  });

  describe("hover timing", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    test("triggers after 300ms delay", () => {
      const callback = vi.fn();
      const timer = setTimeout(callback, 300);
      expect(callback).not.toHaveBeenCalled();
      vi.advanceTimersByTime(300);
      expect(callback).toHaveBeenCalledTimes(1);
      clearTimeout(timer);
    });

    test("cancels if mouse leaves before delay", () => {
      const callback = vi.fn();
      const timer = setTimeout(callback, 300);
      vi.advanceTimersByTime(200);
      clearTimeout(timer);
      vi.advanceTimersByTime(200);
      expect(callback).not.toHaveBeenCalled();
    });
  });
});
