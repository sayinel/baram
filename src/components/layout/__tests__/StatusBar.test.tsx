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
