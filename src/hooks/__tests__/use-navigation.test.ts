// §275.6 handleBlockRefNavigate — highlight ref → PDF navigation, with
// fallback to the ordinary block-reference destination.
import type { Editor } from "@tiptap/core";

import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// §275.6: use-navigation.ts imports readSidecar from pdf-highlight-store
// directly (not through a re-export facade) — the mock specifier below must
// resolve to that exact module or it silently no-ops (see
// pdf-highlight-store.test.ts's own note on ipc/fs vs ipc/invoke).
const { readSidecar } = vi.hoisted(() => ({
  readSidecar: vi.fn(),
}));
vi.mock("../../components/editor/pdf/pdf-highlight-store", () => ({
  readSidecar,
}));

// resolveWikilinkTarget owns its own resolution logic and has its own test
// suite (wikilink-nav.test.ts, including the §275.4 path-qualified fix this
// task's fallback depends on) — mocked here so this suite stays focused on
// the branching this task adds.
const { resolveWikilinkTarget } = vi.hoisted(() => ({
  resolveWikilinkTarget: vi.fn(),
}));
vi.mock("../../utils/editor/wikilink-nav", () => ({ resolveWikilinkTarget }));

const { logger } = vi.hoisted(() => ({
  logger: { error: vi.fn(), warn: vi.fn() },
}));
vi.mock("../../utils/logger", () => ({ logger }));

import { useLinkStore } from "../../stores/editor/link";
import { useFileStore } from "../../stores/file/file";
import { useNavigation } from "../use-navigation";

function renderNav(handleOpenFilePath = vi.fn().mockResolvedValue(undefined)) {
  const editor = stubEditor();
  const { result } = renderHook(() =>
    useNavigation({ editor, handleOpenFilePath }),
  );
  return { editor, handleOpenFilePath, result };
}

/** Minimal editor stub: enough for findBlockPosById's doc.descendants() call
 * to run without throwing, and for commands to be spyable — none of these
 * branches actually need a real ProseMirror doc, only that touching it
 * doesn't blow up the (unawaited) rAF continuation inside
 * openNoteAndScrollToBlock. */
function stubEditor(): Editor {
  return {
    commands: {
      scrollIntoView: vi.fn(),
      setTextSelection: vi.fn(),
    },
    state: { doc: { descendants: () => {} } },
  } as unknown as Editor;
}

beforeEach(() => {
  readSidecar.mockReset();
  resolveWikilinkTarget.mockReset();
  logger.error.mockClear();
  useFileStore.setState({ rootPath: "/vault" });
  useLinkStore.setState({
    pendingPdfHighlightId: null,
    pendingScrollBlockId: null,
  });
});

describe("handleBlockRefNavigate — §275.6 highlight ref → PDF", () => {
  it("opens the PDF and marks the highlight pending when the sidecar still has this block id", async () => {
    readSidecar.mockResolvedValue({
      companion: "highlights/papers/attention.md",
      highlights: [
        {
          color: "yellow",
          id: "h1",
          kind: "text",
          page: 3,
          rects: [{ h: 1, w: 1, x: 0, y: 0 }],
        },
      ],
      pdf: "papers/attention.pdf",
      version: 1,
    });
    const { handleOpenFilePath, result } = renderNav();

    result.current.handleBlockRefNavigate("highlights/papers/attention", "h1");

    await waitFor(() =>
      expect(handleOpenFilePath).toHaveBeenCalledWith(
        "/vault/papers/attention.pdf",
      ),
    );
    expect(useLinkStore.getState().pendingPdfHighlightId).toBe("h1");
    // The PDF branch never needs the note resolver at all.
    expect(resolveWikilinkTarget).not.toHaveBeenCalled();
  });

  it("falls back to opening the companion note when the block id is absent from the sidecar (deleted highlight — §277 leaves the paragraph in place)", async () => {
    readSidecar.mockResolvedValue({
      companion: "highlights/papers/attention.md",
      highlights: [], // h1 was deleted; the note paragraph is intentionally still there
      pdf: "papers/attention.pdf",
      version: 1,
    });
    resolveWikilinkTarget.mockReturnValue({
      name: "attention.md",
      path: "/vault/highlights/papers/attention.md",
    });
    const { handleOpenFilePath, result } = renderNav();

    result.current.handleBlockRefNavigate("highlights/papers/attention", "h1");

    await waitFor(() =>
      expect(handleOpenFilePath).toHaveBeenCalledWith(
        "/vault/highlights/papers/attention.md",
      ),
    );
    expect(resolveWikilinkTarget).toHaveBeenCalledWith(
      "highlights/papers/attention",
    );
    expect(useLinkStore.getState().pendingPdfHighlightId).toBeNull();
  });

  it("leaves ordinary (non-highlight) block references entirely unchanged", () => {
    resolveWikilinkTarget.mockReturnValue({
      name: "a.md",
      path: "/vault/notes/a.md",
    });
    const { handleOpenFilePath, result } = renderNav();

    result.current.handleBlockRefNavigate("notes/a", "b1");

    // No sidecar round trip at all for a target that was never highlights/*.
    expect(readSidecar).not.toHaveBeenCalled();
    expect(handleOpenFilePath).toHaveBeenCalledWith("/vault/notes/a.md");
  });

  it("falls back without throwing when the sidecar read rejects unexpectedly", async () => {
    readSidecar.mockRejectedValue(new Error("boom"));
    resolveWikilinkTarget.mockReturnValue({
      name: "attention.md",
      path: "/vault/highlights/papers/attention.md",
    });
    const { handleOpenFilePath, result } = renderNav();

    expect(() =>
      result.current.handleBlockRefNavigate(
        "highlights/papers/attention",
        "h1",
      ),
    ).not.toThrow();

    await waitFor(() =>
      expect(handleOpenFilePath).toHaveBeenCalledWith(
        "/vault/highlights/papers/attention.md",
      ),
    );
    expect(logger.error).toHaveBeenCalled();
  });

  it("falls back without a sidecar round trip when there is no open vault (single-file mode)", () => {
    useFileStore.setState({ rootPath: null });
    resolveWikilinkTarget.mockReturnValue({
      name: "attention.md",
      path: "/some/attention.md",
    });
    const { handleOpenFilePath, result } = renderNav();

    result.current.handleBlockRefNavigate("highlights/papers/attention", "h1");

    expect(readSidecar).not.toHaveBeenCalled();
    expect(handleOpenFilePath).toHaveBeenCalledWith("/some/attention.md");
  });
});
