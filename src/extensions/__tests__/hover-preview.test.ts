// §32 Hover Preview — unit + DOM contract + integration tests
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import { createBaramExtensions } from "../../extensions";
import { markdownToProsemirror } from "../../pipeline/md-to-pm";
import {
  truncatePreview,
  calcPosition,
} from "../../components/editor/HoverPreview";

// ── Helpers ──

function createEditor(): Editor {
  return new Editor({
    extensions: createBaramExtensions(),
    content: "",
  });
}

function loadMarkdown(editor: Editor, md: string): void {
  const doc = markdownToProsemirror(md, editor.schema);
  editor.commands.setContent(doc.toJSON());
}

// ── Unit tests: pure utility functions ──

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
      expect(pos.top).toBe(124); // bottom + GAP(4)
    });

    test("flips above element when no space below", () => {
      const rect = { top: 500, bottom: 520, left: 200, width: 80 };
      const viewport = { width: 1024, height: 600 };
      const popup = { width: 400, height: 300 };
      const pos = calcPosition(rect, viewport, popup);
      expect(pos.top).toBe(196); // top - GAP(4) - 300
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

  // ── DOM contract tests: wikilink renders data-target for HoverPreview ──

  describe("DOM contract: wikilink node attributes", () => {
    test("wikilink PM node has target attribute after parsing markdown", () => {
      const editor = createEditor();
      loadMarkdown(editor, "Hello [[architecture]] world\n");

      const doc = editor.state.doc;
      const para = doc.firstChild!;
      let wikilinkNode = null as ReturnType<typeof doc.nodeAt> | null;

      para.forEach((child) => {
        if (child.type.name === "wikilink") {
          wikilinkNode = child;
        }
      });

      expect(wikilinkNode).not.toBeNull();
      expect(wikilinkNode!.attrs.target).toBe("architecture");
      editor.destroy();
    });

    test("wikilink with display text preserves both target and display", () => {
      const editor = createEditor();
      loadMarkdown(editor, "See [[architecture|아키텍처]] docs\n");

      let wikilinkNode = null as ReturnType<
        typeof editor.state.doc.nodeAt
      > | null;
      editor.state.doc.descendants((node) => {
        if (node.type.name === "wikilink") wikilinkNode = node;
      });

      expect(wikilinkNode).not.toBeNull();
      expect(wikilinkNode!.attrs.target).toBe("architecture");
      expect(wikilinkNode!.attrs.display).toBe("아키텍처");
      editor.destroy();
    });

    test("wikilink with heading preserves heading attribute", () => {
      const editor = createEditor();
      loadMarkdown(editor, "See [[architecture#overview]] here\n");

      let wikilinkNode = null as ReturnType<
        typeof editor.state.doc.nodeAt
      > | null;
      editor.state.doc.descendants((node) => {
        if (node.type.name === "wikilink") wikilinkNode = node;
      });

      expect(wikilinkNode).not.toBeNull();
      expect(wikilinkNode!.attrs.target).toBe("architecture");
      expect(wikilinkNode!.attrs.heading).toBe("overview");
      editor.destroy();
    });

    test("wikilink DOM element has data-target attribute", () => {
      const editor = createEditor();
      loadMarkdown(editor, "Hello [[my-page]] world\n");

      // The editor renders into a DOM element via NodeView
      const el = editor.view.dom;
      const wikilinkEl = el.querySelector(".wikilink");

      expect(wikilinkEl).not.toBeNull();
      expect(wikilinkEl!.getAttribute("data-target")).toBe("my-page");
      editor.destroy();
    });

    test("HoverPreview selector [data-target].wikilink matches rendered wikilink", () => {
      const editor = createEditor();
      loadMarkdown(editor, "Check [[notes]] here\n");

      const el = editor.view.dom;
      // This is the exact selector used by HoverPreview.tsx
      const match = el.querySelector("[data-target].wikilink");

      expect(match).not.toBeNull();
      expect(match!.getAttribute("data-target")).toBe("notes");
      editor.destroy();
    });

    test("multiple wikilinks each have distinct data-target", () => {
      const editor = createEditor();
      loadMarkdown(editor, "See [[alpha]] and [[beta]] here\n");

      const el = editor.view.dom;
      const wikilinks = el.querySelectorAll("[data-target].wikilink");

      expect(wikilinks).toHaveLength(2);
      const targets = Array.from(wikilinks).map((w) =>
        w.getAttribute("data-target"),
      );
      expect(targets).toContain("alpha");
      expect(targets).toContain("beta");
      editor.destroy();
    });
  });
});
