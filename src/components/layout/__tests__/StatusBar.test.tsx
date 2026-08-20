// §102 StatusBar favorite-toggle star for the active permanent Zettel note.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import { EditorState } from "@tiptap/pm/state";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock(
  "../../../stores/zettelkasten/zettel-favorites",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../../../stores/zettelkasten/zettel-favorites")
      >();
    return {
      ...actual,
      loadFavorites: vi.fn().mockResolvedValue(undefined),
      toggleFavorite: vi.fn().mockResolvedValue([]),
    };
  },
);

import type { Locale } from "../../../i18n";

import { createBaramExtensions } from "../../../extensions";
import { t } from "../../../i18n";
import { markdownToProsemirror } from "../../../pipeline/md-to-pm";
import { useEditorStore } from "../../../stores/editor/editor";
import { useFileStore } from "../../../stores/file/file";
import { useWorkspaceStore } from "../../../stores/file/workspace";
import { useSettingsStore } from "../../../stores/settings/store";
import {
  loadFavorites,
  toggleFavorite,
  useZettelFavoritesStore,
} from "../../../stores/zettelkasten/zettel-favorites";
import { markContentLoaded } from "../../../utils/editor/programmatic-update";
import { StatusBar } from "../StatusBar";

const mockedLoadFavorites = vi.mocked(loadFavorites);
const mockedToggleFavorite = vi.mocked(toggleFavorite);

const ZETTEL_DIR = "/vault/zettel";

function setActiveTab(filePath: string) {
  useEditorStore.setState({
    activeTabId: "tab-1",
    tabs: [
      {
        contextId: "ctx-1",
        filePath,
        id: "tab-1",
        isDirty: false,
        isPinned: false,
        title: "note",
        type: "file",
      },
    ],
  });
}

describe("StatusBar — Zettel favorite star", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSettingsStore.getState().setZettelkastenEnabled(true);
    useSettingsStore.getState().setZettelkastenDirectory(ZETTEL_DIR);
    useFileStore.getState().setRootPath("/vault");
    useZettelFavoritesStore.getState().setFavorites([]);
    useEditorStore.setState({ activeTabId: null, tabs: [] });
  });

  it("renders a Favorite button for a permanent note and toggles it on click", () => {
    setActiveTab(`${ZETTEL_DIR}/notes/202601010900 X.md`);

    render(<StatusBar editor={null} mode="wysiwyg" />);

    const btn = screen.getByRole("button", { name: /^favorite$/i });
    expect(btn).toBeInTheDocument();

    fireEvent.click(btn);
    expect(mockedToggleFavorite).toHaveBeenCalledWith(
      ZETTEL_DIR,
      "202601010900",
    );
  });

  it("does not render the favorite button for an inbox note", () => {
    setActiveTab(`${ZETTEL_DIR}/inbox/some-fleeting-note.md`);

    render(<StatusBar editor={null} mode="wysiwyg" />);

    expect(
      screen.queryByRole("button", { name: /favorite/i }),
    ).not.toBeInTheDocument();
  });

  it("does not render the favorite button for a non-zettel path", () => {
    setActiveTab("/vault/writing/essay.md");

    render(<StatusBar editor={null} mode="wysiwyg" />);

    expect(
      screen.queryByRole("button", { name: /favorite/i }),
    ).not.toBeInTheDocument();
  });

  it("shows the active/unfavorite state when the note is already a favorite", () => {
    setActiveTab(`${ZETTEL_DIR}/notes/202601010900 X.md`);
    useZettelFavoritesStore.getState().setFavorites(["202601010900"]);

    render(<StatusBar editor={null} mode="wysiwyg" />);

    const btn = screen.getByRole("button", { name: /unfavorite/i });
    expect(btn).toHaveClass("status-fav-active");
  });

  it("loads favorites for the zettel dir on mount when zettelkasten is enabled", () => {
    setActiveTab(`${ZETTEL_DIR}/notes/202601010900 X.md`);

    render(<StatusBar editor={null} mode="wysiwyg" />);

    expect(mockedLoadFavorites).toHaveBeenCalledWith(ZETTEL_DIR);
  });
});

describe("StatusBar — Perspective launcher", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ activePresetId: null });
    useEditorStore.setState({ activeTabId: null, tabs: [] });
    useFileStore.getState().setRootPath("/vault");
  });

  function expectedLabel() {
    const locale = useSettingsStore.getState().locale;
    return t("statusbar.perspective", locale as Locale);
  }

  it("shows a fixed perspective label, not 'Default', when no preset is active", () => {
    render(<StatusBar editor={null} mode="wysiwyg" />);
    const launcher = screen.getByTestId("perspective-launcher");
    expect(launcher.textContent).toContain(expectedLabel());
    expect(launcher.textContent).not.toContain("Default");
  });

  it("keeps the fixed label even when a preset is active (no stale badge)", () => {
    useWorkspaceStore.setState({ activePresetId: "journal" });
    render(<StatusBar editor={null} mode="wysiwyg" />);
    const launcher = screen.getByTestId("perspective-launcher");
    expect(launcher.textContent).toContain(expectedLabel());
    expect(launcher.textContent).not.toContain("Journal");
  });

  it("opens a menu of all presets and applies one on click", () => {
    render(<StatusBar editor={null} mode="wysiwyg" />);
    fireEvent.click(screen.getByTestId("perspective-launcher"));
    const writingItem = screen.getByText("Writing");
    const journalItem = screen.getByText("Journal");
    expect(writingItem).toBeTruthy();
    expect(journalItem).toBeTruthy();
    // No stateful active highlight on menu items.
    expect(writingItem.closest("button")?.className).not.toContain(
      "status-space-menu-active",
    );
    fireEvent.click(writingItem);
    expect(useWorkspaceStore.getState().activePresetId).toBe("writing");
  });
});

describe("StatusBar — live word count", () => {
  let editor: Editor | null = null;

  beforeEach(() => {
    useEditorStore.setState({ activeTabId: null, tabs: [] });
    useFileStore.getState().setRootPath("/vault");
  });

  afterEach(() => {
    editor?.destroy();
    editor = null;
  });

  function makeEditor(content: string): Editor {
    return new Editor({ content, extensions: createBaramExtensions() });
  }

  it("shows the word count for the document the editor mounts with", () => {
    editor = makeEditor("alpha beta gamma");
    render(<StatusBar editor={editor} mode="wysiwyg" />);
    expect(screen.getByText("3 words")).toBeInTheDocument();
  });

  it("refreshes the word count on a content-loaded signal even when the swap bypasses editor events (tab switch)", () => {
    editor = makeEditor("one two");
    render(<StatusBar editor={editor} mode="wysiwyg" />);
    expect(screen.getByText("2 words")).toBeInTheDocument();

    // Reproduce a tab switch: content is installed via a direct view.updateState()
    // (fires no Tiptap update/selectionUpdate event) and then markContentLoaded()
    // is called — exactly what use-tab-switching does on the shared editor.
    const nextDoc = markdownToProsemirror(
      "alpha beta gamma delta epsilon",
      editor.schema,
    );
    const nextState = EditorState.create({
      doc: nextDoc,
      plugins: editor.state.plugins,
    });
    act(() => {
      editor!.view.updateState(nextState);
      markContentLoaded("tab-next");
    });

    expect(screen.getByText("5 words")).toBeInTheDocument();
    expect(screen.queryByText("2 words")).not.toBeInTheDocument();
  });
});

// §69 The mode indicator, and what it withholds.
//
// ‼️ The right-hand panel was gated on `mode !== "graph"` — an enumerated check, so every
// mode added after it inherited a panel confidently reporting "0 words, Ln 1, Col 1" about a
// tab holding no text. `DOCUMENT_MODES` inverts that to an allowlist; these tests pin both
// directions, because the negative alone also passes for a status bar that renders nothing.
describe("StatusBar — modes without a document", () => {
  beforeEach(() => {
    useEditorStore.setState({ activeTabId: null, tabs: [] });
  });

  it("names the plugin mode and withholds the word count", () => {
    render(<StatusBar editor={null} mode="plugin" />);

    expect(screen.getByText("Plugin")).toBeInTheDocument();
    expect(screen.queryByText(/words$/u)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Ln /u)).not.toBeInTheDocument();
  });

  it("withholds it for the graph mode too", () => {
    render(<StatusBar editor={null} mode="graph" />);

    expect(screen.getByText("Graph")).toBeInTheDocument();
    expect(screen.queryByText(/words$/u)).not.toBeInTheDocument();
  });

  it("still reports it for a document mode", () => {
    // The complement. Without it, the two tests above pass against an allowlist that
    // excludes everything.
    render(<StatusBar editor={null} mode="wysiwyg" />);

    expect(screen.getByText(/words$/u)).toBeInTheDocument();
    expect(screen.getByText(/^Ln /u)).toBeInTheDocument();
  });
});

// §4.8 WHICH document the right-hand numbers describe.
//
// ‼️ They come from the shared Tiptap editor, and `use-tab-switching` returns BEFORE
// ProseMirror for a non-markdown file (see its `if (!isMarkdownFile(...))` branch), so the
// editor keeps holding the last markdown document while a PDF / image / HTML preview / code
// file is on screen. The mode alone cannot gate this: `source` covers both a markdown source
// view (the editor does hold it) and a code file (it holds something else entirely).
describe("StatusBar — whose words are these", () => {
  let editor: Editor | null = null;

  beforeEach(() => {
    useEditorStore.setState({ activeTabId: null, tabs: [] });
    useFileStore.getState().setRootPath("/vault");
    useSettingsStore.getState().setZoomLevel(1);
  });

  afterEach(() => {
    editor?.destroy();
    editor = null;
    useSettingsStore.getState().setZoomLevel(1);
  });

  function editorHolding(markdown: string): Editor {
    return new Editor({
      content: markdown,
      extensions: createBaramExtensions(),
    });
  }

  it("withholds words/Ln/Col on a PDF tab, though the editor still holds a markdown document", () => {
    editor = editorHolding("alpha beta gamma");
    setActiveTab("/vault/paper.pdf");

    render(<StatusBar editor={editor} mode="preview" />);

    expect(screen.queryByText(/words$/u)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Ln /u)).not.toBeInTheDocument();
  });

  it("withholds them for a code file, whose text lives in CodeMirror and not in the editor", () => {
    editor = editorHolding("alpha beta gamma");
    setActiveTab("/vault/main.ts");

    render(<StatusBar editor={editor} mode="source" />);

    expect(screen.queryByText(/words$/u)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Ln /u)).not.toBeInTheDocument();
  });

  it("still reports them for a markdown file shown as source — the editor does hold that one", () => {
    // The complement. Without it, the two above also pass for a panel that reports nothing.
    editor = editorHolding("alpha beta gamma");
    setActiveTab("/vault/note.md");

    render(<StatusBar editor={editor} mode="source" />);

    expect(screen.getByText("3 words")).toBeInTheDocument();
    expect(screen.getByText(/^Ln /u)).toBeInTheDocument();
  });

  // A synthetic combination App does not produce today — every preview surface is a
  // non-markdown extension, so the allowlist's exclusion of `preview` is invisible to real
  // data and no assertion over real tabs can pin it (the file check alone already answers
  // those). Injecting it anyway is what stops a future surface that PREVIEWS a markdown file
  // — a reading mode, a diff view — from silently opting itself back into these numbers.
  it("withholds them for a preview surface even over a markdown file", () => {
    editor = editorHolding("alpha beta gamma");
    setActiveTab("/vault/note.md");

    render(<StatusBar editor={editor} mode="preview" />);

    expect(screen.queryByText(/words$/u)).not.toBeInTheDocument();
  });

  it("still reports them for an untitled buffer, which has no path yet", () => {
    editor = editorHolding("alpha beta gamma");
    setActiveTab("");

    render(<StatusBar editor={editor} mode="wysiwyg" />);

    expect(screen.getByText("3 words")).toBeInTheDocument();
  });

  // The zoom level is applied to `.editor-area-scroll`, which is what a PDF renders inside —
  // PdfPreview even multiplies its raster scale by it. Withholding the word count must not
  // take this live, pinch-changeable readout down with it.
  it("keeps the zoom indicator on a PDF tab, with no stray separator before it", () => {
    editor = editorHolding("alpha beta gamma");
    setActiveTab("/vault/paper.pdf");
    useSettingsStore.getState().setZoomLevel(1.2);

    render(<StatusBar editor={editor} mode="preview" />);

    expect(screen.getByText("120%")).toBeInTheDocument();
    expect(screen.queryAllByText("|")).toHaveLength(0);
  });
});
