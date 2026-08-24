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

import { useEditorStore } from "../../stores/editor/editor";
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

  it("§275.4 IMPORTANT opens the PDF with its original extension case, not the lowercase-coerced one, when the filename is uppercase (.PDF, e.g. on a case-sensitive filesystem)", async () => {
    // companionPathFor/pdfRelPathForHighlightTarget both strip/append ".pdf"
    // case-insensitively, so the target below round-trips to a lowercase
    // "papers/a.pdf" — but the real file (and sidecar.pdf, written verbatim
    // at highlight-creation time) is "papers/A.PDF". Opening the
    // lowercase-coerced path would fail on a case-sensitive filesystem.
    readSidecar.mockResolvedValue({
      companion: "highlights/papers/A.md",
      highlights: [
        {
          color: "yellow",
          id: "h1",
          kind: "text",
          page: 1,
          rects: [{ h: 1, w: 1, x: 0, y: 0 }],
        },
      ],
      pdf: "papers/A.PDF",
      version: 1,
    });
    const { handleOpenFilePath, result } = renderNav();

    result.current.handleBlockRefNavigate("highlights/papers/A", "h1");

    await waitFor(() =>
      expect(handleOpenFilePath).toHaveBeenCalledWith("/vault/papers/A.PDF"),
    );
    expect(handleOpenFilePath).not.toHaveBeenCalledWith("/vault/papers/a.pdf");
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

  it("§275.6 M3: does not produce an unhandled rejection when the fallback's resolver throws synchronously", async () => {
    // The sidecar resolves but has no matching highlight, so the branch
    // falls into openNoteAndScrollToBlock — which calls resolveWikilinkTarget
    // synchronously. A throw from there used to escape the async IIFE with
    // nothing awaiting it; main.tsx's global unhandledrejection handler
    // would downgrade that to a console.warn (§260 Phase 5 R4's trap).
    readSidecar.mockResolvedValue({
      companion: "highlights/papers/attention.md",
      highlights: [],
      pdf: "papers/attention.pdf",
      version: 1,
    });
    resolveWikilinkTarget.mockImplementation(() => {
      throw new Error("boom");
    });
    const { handleOpenFilePath, result } = renderNav();

    expect(() =>
      result.current.handleBlockRefNavigate(
        "highlights/papers/attention",
        "h1",
      ),
    ).not.toThrow();

    await waitFor(() => expect(logger.error).toHaveBeenCalled());
    expect(handleOpenFilePath).not.toHaveBeenCalled();
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

// §278.1 인라인 링크 `[label](target)` — 여기가 "앱에서 열까, OS에 넘길까"를
// 실제로 정하는 층이다. Extension은 스킴만 보고 이 함수의 반환값을 따른다.
//
// ‼️ 파일 트리는 진짜다(모킹하지 않는다). 이 기능의 전제가 "트리에 그 파일이
// 실제로 있는가"이므로, 트리를 스텁으로 덮으면 검증할 것이 남지 않는다.
describe("handleLocalLinkNavigate — §278.1 inline links to files", () => {
  function seedVault() {
    useFileStore.setState({
      fileTree: [
        { isDir: false, name: "guide.md", path: "/vault/notes/guide.md" },
        { isDir: false, name: "Paper.pdf", path: "/vault/notes/Paper.pdf" },
        {
          isDir: false,
          name: "My Paper.pdf",
          path: "/vault/notes/My Paper.pdf",
        },
        {
          children: [
            {
              isDir: false,
              name: "Attention.pdf",
              path: "/vault/papers/Attention.pdf",
            },
          ],
          isDir: true,
          name: "papers",
          path: "/vault/papers",
        },
      ],
      rootPath: "/vault",
    });
    useEditorStore.setState({
      activeTabId: "t1",
      tabs: [
        {
          contextId: "c1",
          filePath: "/vault/notes/source.md",
          id: "t1",
          isDirty: false,
          isPinned: false,
          title: "source.md",
        },
      ],
    });
  }

  beforeEach(() => {
    seedVault();
    // 파일 단위 beforeEach가 이 키는 비우지 않는다. 여기서 직접 비워야
    // "#fragment를 설정하지 않는다" 단정이 실행 순서에 기대지 않는다.
    useLinkStore.setState({ pendingScrollHeading: null });
  });

  it("opens a sibling PDF instead of declining to the OS opener", () => {
    const { handleOpenFilePath, result } = renderNav();

    expect(result.current.handleLocalLinkNavigate("Paper.pdf")).toBe(true);
    expect(handleOpenFilePath).toHaveBeenCalledWith("/vault/notes/Paper.pdf");
  });

  it("opens a PDF reached through ../", () => {
    const { handleOpenFilePath, result } = renderNav();

    expect(
      result.current.handleLocalLinkNavigate("../papers/Attention.pdf"),
    ).toBe(true);
    expect(handleOpenFilePath).toHaveBeenCalledWith(
      "/vault/papers/Attention.pdf",
    );
  });

  it("opens a percent-encoded name as written by other editors", () => {
    const { handleOpenFilePath, result } = renderNav();

    expect(result.current.handleLocalLinkNavigate("My%20Paper.pdf")).toBe(true);
    expect(handleOpenFilePath).toHaveBeenCalledWith(
      "/vault/notes/My Paper.pdf",
    );
  });

  it("declines a scheme-less external address so the OS opener still gets it", () => {
    const { handleOpenFilePath, result } = renderNav();

    expect(result.current.handleLocalLinkNavigate("www.example.com")).toBe(
      false,
    );
    expect(handleOpenFilePath).not.toHaveBeenCalled();
  });

  it("declines a non-markdown file that is not in the tree", () => {
    const { handleOpenFilePath, result } = renderNav();

    expect(result.current.handleLocalLinkNavigate("Missing.pdf")).toBe(false);
    expect(handleOpenFilePath).not.toHaveBeenCalled();
  });

  describe("markdown keeps its pre-§278.1 behaviour", () => {
    it("opens a markdown file that exists", () => {
      const { handleOpenFilePath, result } = renderNav();

      expect(result.current.handleLocalLinkNavigate("guide.md")).toBe(true);
      expect(handleOpenFilePath).toHaveBeenCalledWith("/vault/notes/guide.md");
    });

    it("still claims and attempts a markdown file that does NOT exist", () => {
      // 이 분기가 이 변경을 '추가만'으로 만든다. 여기서 false를 반환하면
      // 깨진 .md 링크가 OS opener로 새어 나간다 — 예전에는 없던 일이다.
      const { handleOpenFilePath, result } = renderNav();

      expect(result.current.handleLocalLinkNavigate("gone.md")).toBe(true);
      expect(handleOpenFilePath).toHaveBeenCalledWith("/vault/notes/gone.md");
    });

    it("normalises ../ rather than handing through a doubled path", () => {
      // 예전 코드는 "/vault/notes/../gone.md"를 넘겼다. 읽히기는 하지만
      // 이미 열린 탭과 문자열이 달라 같은 파일이 두 번 열린다.
      const { handleOpenFilePath, result } = renderNav();

      result.current.handleLocalLinkNavigate("../gone.md");
      expect(handleOpenFilePath).toHaveBeenCalledWith("/vault/gone.md");
    });

    it("claims a markdown href even with no source file to resolve against", () => {
      useEditorStore.setState({ activeTabId: null, tabs: [] });
      const { handleOpenFilePath, result } = renderNav();

      expect(result.current.handleLocalLinkNavigate("gone.md")).toBe(true);
      expect(handleOpenFilePath).not.toHaveBeenCalled();
    });
  });

  describe("#fragment handling", () => {
    it("sets a pending scroll heading for a markdown target", () => {
      const { result } = renderNav();

      result.current.handleLocalLinkNavigate("guide.md#my-section");

      expect(useLinkStore.getState().pendingScrollHeading).toBe("my section");
    });

    it("does NOT set one for a viewer target", () => {
      // ‼️ PDF 탭은 ProseMirror 문서를 싣지 않아 이 값을 소비하지 않는다.
      // 남겨 두면 그 다음에 열리는 마크다운 파일이 엉뚱하게 스크롤된다.
      const { result } = renderNav();

      result.current.handleLocalLinkNavigate("Paper.pdf#page=3");

      expect(useLinkStore.getState().pendingScrollHeading).toBe(null);
    });
  });
});
