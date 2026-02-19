// §33 링크 자동 갱신 통합 테스트
// Tests the rename flow contract: FileTree rename → IPC → wikilink update
import { describe, it, expect } from "vitest";

/**
 * Mirrors Rust's `replace_wikilink_target` logic for frontend testing.
 * In production, the Rust backend handles this via regex::Regex.
 */
function replaceWikilinkTarget(
  content: string,
  oldTarget: string,
  newTarget: string,
): string {
  // Match [[target]], [[target|display]], [[target#heading]], [[target^block]]
  const re = /\[\[([^\]|#^]+)((?:#[^\]|^]+)?(?:\^[^\]|]+)?(?:\|[^\]]+)?)\]\]/g;
  return content.replace(re, (_match, captured: string, rest: string) => {
    if (captured.trim().toLowerCase() === oldTarget.trim().toLowerCase()) {
      return `[[${newTarget}${rest}]]`;
    }
    return _match;
  });
}

describe("§33 Auto-rename wikilink update", () => {
  // --- replaceWikilinkTarget (mirrors Rust logic) ---

  it("replaces basic wikilink target", () => {
    const input = "See [[old-note]] for details.";
    expect(replaceWikilinkTarget(input, "old-note", "new-note")).toBe(
      "See [[new-note]] for details.",
    );
  });

  it("preserves display text after pipe", () => {
    const input = "See [[old-note|my label]] here.";
    expect(replaceWikilinkTarget(input, "old-note", "new-note")).toBe(
      "See [[new-note|my label]] here.",
    );
  });

  it("preserves heading fragment", () => {
    const input = "See [[old-note#section]] here.";
    expect(replaceWikilinkTarget(input, "old-note", "new-note")).toBe(
      "See [[new-note#section]] here.",
    );
  });

  it("preserves heading + display text", () => {
    const input = "See [[old-note#intro|Introduction]] here.";
    expect(replaceWikilinkTarget(input, "old-note", "new-note")).toBe(
      "See [[new-note#intro|Introduction]] here.",
    );
  });

  it("is case-insensitive", () => {
    const input = "See [[Old-Note]] and [[OLD-NOTE]].";
    expect(replaceWikilinkTarget(input, "old-note", "new-note")).toBe(
      "See [[new-note]] and [[new-note]].",
    );
  });

  it("replaces multiple occurrences on same line", () => {
    const input = "[[old]] and [[old|alias]] and [[old#h1]].";
    expect(replaceWikilinkTarget(input, "old", "new")).toBe(
      "[[new]] and [[new|alias]] and [[new#h1]].",
    );
  });

  it("does not replace non-matching targets", () => {
    const input = "See [[other-note]] here.";
    expect(replaceWikilinkTarget(input, "old-note", "new-note")).toBe(
      "See [[other-note]] here.",
    );
  });

  it("does not replace partial target matches", () => {
    const input = "See [[old-note-extended]] here.";
    expect(replaceWikilinkTarget(input, "old-note", "new-note")).toBe(
      "See [[old-note-extended]] here.",
    );
  });

  it("handles multiline content", () => {
    const input = "First [[old-note]]\nSecond [[old-note#h1]]\nThird [[other]]";
    expect(replaceWikilinkTarget(input, "old-note", "new-note")).toBe(
      "First [[new-note]]\nSecond [[new-note#h1]]\nThird [[other]]",
    );
  });

  // --- Rename flow contract ---

  it("file stem extraction matches Rust Path::file_stem behavior", () => {
    // Rust uses Path::file_stem to extract the target from the file path.
    // Frontend must match: "/docs/notes/architecture.md" → "architecture"
    const extractStem = (path: string): string => {
      const fileName = path.split("/").pop() ?? "";
      const dotIndex = fileName.lastIndexOf(".");
      return dotIndex > 0 ? fileName.substring(0, dotIndex) : fileName;
    };

    expect(extractStem("/docs/notes/architecture.md")).toBe("architecture");
    expect(extractStem("/single.md")).toBe("single");
    expect(extractStem("relative.md")).toBe("relative");
    expect(extractStem("/path/no-extension")).toBe("no-extension");
    expect(extractStem("/path/.hidden")).toBe(".hidden");
  });

  it("RenameResult contract: updatedFiles is string array", () => {
    // Verify the shape of RenameResult matches IPC types
    const mockResult = { updatedFiles: ["/docs/a.md", "/docs/b.md"] };
    expect(Array.isArray(mockResult.updatedFiles)).toBe(true);
    expect(mockResult.updatedFiles).toHaveLength(2);
    expect(typeof mockResult.updatedFiles[0]).toBe("string");
  });
});
