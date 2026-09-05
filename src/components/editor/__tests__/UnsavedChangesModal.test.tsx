// §close-guard: tests for the shared unsaved-changes confirmation modal.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../hooks/use-close-guard", () => ({
  saveAllDirtyForQuit: vi.fn(),
  saveDirtyTab: vi.fn(),
}));

vi.mock("../../../ipc/invoke", () => ({
  confirmQuit: vi.fn().mockResolvedValue(undefined),
}));

// Echo the i18n key (+ interpolated params) so assertions stay locale-agnostic.
vi.mock("../../../i18n/useTranslation", () => ({
  useTranslation: () => ({
    locale: "en",
    t: (key: string, params?: Record<string, string>) =>
      params ? `${key} ${JSON.stringify(params)}` : key,
  }),
}));

import type { CloseGuardDeps } from "../../../hooks/use-close-guard";
import type { EditorTab } from "../../../stores/editor/editor";

import {
  saveAllDirtyForQuit,
  saveDirtyTab,
} from "../../../hooks/use-close-guard";
import { confirmQuit } from "../../../ipc/invoke";
import { useEditorStore } from "../../../stores/editor/editor";
import { useFileStore } from "../../../stores/file/file";
import { useUIStore } from "../../../stores/ui/ui";
import { UnsavedChangesModal } from "../UnsavedChangesModal";

// ── helpers ──────────────────────────────────────────────────────────────────

const deps: CloseGuardDeps = {
  handleSave: vi.fn(async () => undefined),
};

function dirtyFileTab(id: string, title = `${id}.md`): EditorTab {
  return {
    contextId: "ctx",
    filePath: `/v/${id}.md`,
    id,
    isDirty: true,
    isPinned: false,
    title,
    type: "file",
  };
}

const containing =
  (...needles: string[]) =>
  (text: string) =>
    needles.every((n) => text.includes(n));

beforeEach(() => {
  vi.clearAllMocks();
  useEditorStore.setState({ activeTabId: null, mruOrder: [], tabs: [] });
  useUIStore.setState({ unsavedModal: null });
});

// ── rendering ────────────────────────────────────────────────────────────────

describe("UnsavedChangesModal", () => {
  it("renders nothing when no modal is requested", () => {
    const { container } = render(<UnsavedChangesModal {...deps} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("quit intent → shows the dirty count and a Save & Quit action", () => {
    useEditorStore.setState({
      activeTabId: "a",
      tabs: [dirtyFileTab("a"), dirtyFileTab("b")],
    });
    useUIStore.setState({ unsavedModal: { intent: "quit" } });

    render(<UnsavedChangesModal {...deps} />);

    expect(screen.getByText("unsavedChanges.title")).toBeInTheDocument();
    expect(
      screen.getByText(containing("unsavedChanges.quitMessage", '"count":"2"')),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "unsavedChanges.saveAndQuit" }),
    ).toBeInTheDocument();
  });

  it("closeTab intent → shows the tab name and a Save & Close action", () => {
    const tab = dirtyFileTab("t-close", "notes.md");
    useEditorStore.setState({ activeTabId: "t-close", tabs: [tab] });
    useUIStore.setState({
      unsavedModal: { intent: "closeTab", tabId: "t-close" },
    });

    render(<UnsavedChangesModal {...deps} />);

    expect(
      screen.getByText(containing("unsavedChanges.closeMessage", "notes.md")),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "unsavedChanges.saveAndClose" }),
    ).toBeInTheDocument();
  });

  // ── quit flow ────────────────────────────────────────────────────────────

  it("Save & Quit → saves all dirty tabs, confirms the quit, and closes the modal", async () => {
    useEditorStore.setState({ activeTabId: "a", tabs: [dirtyFileTab("a")] });
    useUIStore.setState({ unsavedModal: { intent: "quit" } });
    vi.mocked(saveAllDirtyForQuit).mockResolvedValue(true);

    render(<UnsavedChangesModal {...deps} />);
    fireEvent.click(
      screen.getByRole("button", { name: "unsavedChanges.saveAndQuit" }),
    );

    await waitFor(() => expect(confirmQuit).toHaveBeenCalledOnce());
    expect(saveAllDirtyForQuit).toHaveBeenCalledOnce();
    expect(useUIStore.getState().unsavedModal).toBeNull();
  });

  it("Save & Quit → stays open and does not quit when a Save As is cancelled", async () => {
    useEditorStore.setState({ activeTabId: "a", tabs: [dirtyFileTab("a")] });
    useUIStore.setState({ unsavedModal: { intent: "quit" } });
    vi.mocked(saveAllDirtyForQuit).mockResolvedValue(false);

    render(<UnsavedChangesModal {...deps} />);
    fireEvent.click(
      screen.getByRole("button", { name: "unsavedChanges.saveAndQuit" }),
    );

    await waitFor(() => expect(saveAllDirtyForQuit).toHaveBeenCalledOnce());
    expect(confirmQuit).not.toHaveBeenCalled();
    expect(useUIStore.getState().unsavedModal).toEqual({ intent: "quit" });
  });

  it("Don't Save (quit) → confirms the quit without saving", async () => {
    useEditorStore.setState({ activeTabId: "a", tabs: [dirtyFileTab("a")] });
    useUIStore.setState({ unsavedModal: { intent: "quit" } });

    render(<UnsavedChangesModal {...deps} />);
    fireEvent.click(
      screen.getByRole("button", { name: "unsavedChanges.dontSave" }),
    );

    await waitFor(() => expect(confirmQuit).toHaveBeenCalledOnce());
    expect(saveAllDirtyForQuit).not.toHaveBeenCalled();
    expect(useUIStore.getState().unsavedModal).toBeNull();
  });

  it("Cancel → closes the modal and takes no action", () => {
    useEditorStore.setState({ activeTabId: "a", tabs: [dirtyFileTab("a")] });
    useUIStore.setState({ unsavedModal: { intent: "quit" } });

    render(<UnsavedChangesModal {...deps} />);
    fireEvent.click(
      screen.getByRole("button", { name: "unsavedChanges.cancel" }),
    );

    expect(useUIStore.getState().unsavedModal).toBeNull();
    expect(confirmQuit).not.toHaveBeenCalled();
    expect(saveAllDirtyForQuit).not.toHaveBeenCalled();
  });

  // ── close-tab flow ─────────────────────────────────────────────────────────

  it("Save & Close → saves the single tab then closes it", async () => {
    const tab = dirtyFileTab("t-close", "notes.md");
    useEditorStore.setState({ activeTabId: "t-close", tabs: [tab] });
    useUIStore.setState({
      unsavedModal: { intent: "closeTab", tabId: "t-close" },
    });
    vi.mocked(saveDirtyTab).mockResolvedValue(true);
    const closeSpy = vi
      .spyOn(useEditorStore.getState(), "closeTab")
      .mockImplementation(() => {});

    render(<UnsavedChangesModal {...deps} />);
    fireEvent.click(
      screen.getByRole("button", { name: "unsavedChanges.saveAndClose" }),
    );

    await waitFor(() => expect(saveDirtyTab).toHaveBeenCalledOnce());
    expect(closeSpy).toHaveBeenCalledWith("t-close");
    expect(useUIStore.getState().unsavedModal).toBeNull();
    closeSpy.mockRestore();
  });

  it("Don't Save (closeTab) → closes the tab without saving", async () => {
    const tab = dirtyFileTab("t-x", "draft.md");
    useEditorStore.setState({ activeTabId: "t-x", tabs: [tab] });
    useUIStore.setState({ unsavedModal: { intent: "closeTab", tabId: "t-x" } });
    const closeSpy = vi
      .spyOn(useEditorStore.getState(), "closeTab")
      .mockImplementation(() => {});

    render(<UnsavedChangesModal {...deps} />);
    fireEvent.click(
      screen.getByRole("button", { name: "unsavedChanges.dontSave" }),
    );

    await waitFor(() => expect(closeSpy).toHaveBeenCalledWith("t-x"));
    expect(saveDirtyTab).not.toHaveBeenCalled();
    expect(useUIStore.getState().unsavedModal).toBeNull();
    closeSpy.mockRestore();
  });

  // ── reload flow (§479) ───────────────────────────────────────────────────

  describe("reload intent", () => {
    const originalLocation = window.location;
    let reload: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      reload = vi.fn();
      // jsdom's `window.location.reload` is non-configurable, so the property
      // itself must be replaced rather than spied on.
      Object.defineProperty(window, "location", {
        configurable: true,
        value: { ...originalLocation, reload },
      });
    });

    afterEach(() => {
      Object.defineProperty(window, "location", {
        configurable: true,
        value: originalLocation,
      });
    });

    it("reload intent → shows the dirty count and a Save & Reload action", () => {
      useEditorStore.setState({
        activeTabId: "a",
        tabs: [dirtyFileTab("a"), dirtyFileTab("b")],
      });
      useUIStore.setState({ unsavedModal: { intent: "reload" } });

      render(<UnsavedChangesModal {...deps} />);

      expect(
        screen.getByText(
          containing("unsavedChanges.reloadMessage", '"count":"2"'),
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "unsavedChanges.saveAndReload" }),
      ).toBeInTheDocument();
    });

    it("Save & Reload → saves all dirty tabs, reloads, and closes the modal", async () => {
      useEditorStore.setState({ activeTabId: "a", tabs: [dirtyFileTab("a")] });
      useUIStore.setState({ unsavedModal: { intent: "reload" } });
      vi.mocked(saveAllDirtyForQuit).mockResolvedValue(true);

      render(<UnsavedChangesModal {...deps} />);
      fireEvent.click(
        screen.getByRole("button", { name: "unsavedChanges.saveAndReload" }),
      );

      await waitFor(() => expect(reload).toHaveBeenCalledOnce());
      expect(saveAllDirtyForQuit).toHaveBeenCalledOnce();
      expect(useUIStore.getState().unsavedModal).toBeNull();
    });

    it("Save & Reload → stays open and does not reload when a Save As is cancelled", async () => {
      useEditorStore.setState({ activeTabId: "a", tabs: [dirtyFileTab("a")] });
      useUIStore.setState({ unsavedModal: { intent: "reload" } });
      vi.mocked(saveAllDirtyForQuit).mockResolvedValue(false);

      render(<UnsavedChangesModal {...deps} />);
      fireEvent.click(
        screen.getByRole("button", { name: "unsavedChanges.saveAndReload" }),
      );

      await waitFor(() => expect(saveAllDirtyForQuit).toHaveBeenCalledOnce());
      expect(reload).not.toHaveBeenCalled();
      expect(useUIStore.getState().unsavedModal).toEqual({ intent: "reload" });
    });

    it("Don't Save (reload) → reloads without saving", async () => {
      useEditorStore.setState({ activeTabId: "a", tabs: [dirtyFileTab("a")] });
      useUIStore.setState({ unsavedModal: { intent: "reload" } });

      render(<UnsavedChangesModal {...deps} />);
      fireEvent.click(
        screen.getByRole("button", { name: "unsavedChanges.dontSave" }),
      );

      await waitFor(() => expect(reload).toHaveBeenCalledOnce());
      expect(saveAllDirtyForQuit).not.toHaveBeenCalled();
      expect(useUIStore.getState().unsavedModal).toBeNull();
    });

    it("Cancel (reload) → closes the modal and takes no action", () => {
      useEditorStore.setState({ activeTabId: "a", tabs: [dirtyFileTab("a")] });
      useUIStore.setState({ unsavedModal: { intent: "reload" } });

      render(<UnsavedChangesModal {...deps} />);
      fireEvent.click(
        screen.getByRole("button", { name: "unsavedChanges.cancel" }),
      );

      expect(useUIStore.getState().unsavedModal).toBeNull();
      expect(reload).not.toHaveBeenCalled();
      expect(saveAllDirtyForQuit).not.toHaveBeenCalled();
    });
  });

  // ── close-workspace flow (§81) ─────────────────────────────────────────────
  //
  // File > Close Workspace drops every tab AND every context. Before it went
  // through this modal, `closeAllTabs()` discarded unsaved tabs with no prompt.
  describe("close workspace", () => {
    /** The modal calls `useFileStore.getState().closeFolder()` — spy on that. */
    function spyCloseFolder() {
      return vi
        .spyOn(useFileStore.getState(), "closeFolder")
        .mockImplementation(() => {});
    }

    it("closeWorkspace intent → shows the dirty count, not a single tab name", () => {
      useEditorStore.setState({
        activeTabId: "a",
        tabs: [dirtyFileTab("a"), dirtyFileTab("b"), dirtyFileTab("c")],
      });
      useUIStore.setState({ unsavedModal: { intent: "closeWorkspace" } });

      render(<UnsavedChangesModal {...deps} />);

      expect(
        screen.getByText(
          containing("unsavedChanges.closeWorkspaceMessage", '"count":"3"'),
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", {
          name: "unsavedChanges.saveAndCloseWorkspace",
        }),
      ).toBeInTheDocument();
    });

    it("Save & Close Workspace → saves EVERY dirty tab, then clears the workspace", async () => {
      useEditorStore.setState({
        activeTabId: "a",
        tabs: [dirtyFileTab("a"), dirtyFileTab("b")],
      });
      useUIStore.setState({ unsavedModal: { intent: "closeWorkspace" } });
      vi.mocked(saveAllDirtyForQuit).mockResolvedValue(true);
      const closeFolder = spyCloseFolder();

      render(<UnsavedChangesModal {...deps} />);
      fireEvent.click(
        screen.getByRole("button", {
          name: "unsavedChanges.saveAndCloseWorkspace",
        }),
      );

      await waitFor(() => expect(closeFolder).toHaveBeenCalledOnce());
      // The whole surface goes away, so it must save all of them — not just the
      // active tab, which is what `saveDirtyTab` alone would have done.
      expect(saveAllDirtyForQuit).toHaveBeenCalledOnce();
      expect(saveDirtyTab).not.toHaveBeenCalled();
      expect(useUIStore.getState().unsavedModal).toBeNull();
      closeFolder.mockRestore();
    });

    it("Save & Close Workspace → keeps the workspace when a Save As is cancelled", async () => {
      useEditorStore.setState({ activeTabId: "a", tabs: [dirtyFileTab("a")] });
      useUIStore.setState({ unsavedModal: { intent: "closeWorkspace" } });
      vi.mocked(saveAllDirtyForQuit).mockResolvedValue(false);
      const closeFolder = spyCloseFolder();

      render(<UnsavedChangesModal {...deps} />);
      fireEvent.click(
        screen.getByRole("button", {
          name: "unsavedChanges.saveAndCloseWorkspace",
        }),
      );

      await waitFor(() => expect(saveAllDirtyForQuit).toHaveBeenCalledOnce());
      expect(closeFolder).not.toHaveBeenCalled();
      expect(useUIStore.getState().unsavedModal).toEqual({
        intent: "closeWorkspace",
      });
      closeFolder.mockRestore();
    });

    it("Don't Save (closeWorkspace) → clears the workspace without saving", async () => {
      useEditorStore.setState({ activeTabId: "a", tabs: [dirtyFileTab("a")] });
      useUIStore.setState({ unsavedModal: { intent: "closeWorkspace" } });
      const closeFolder = spyCloseFolder();

      render(<UnsavedChangesModal {...deps} />);
      fireEvent.click(
        screen.getByRole("button", { name: "unsavedChanges.dontSave" }),
      );

      await waitFor(() => expect(closeFolder).toHaveBeenCalledOnce());
      expect(saveAllDirtyForQuit).not.toHaveBeenCalled();
      expect(useUIStore.getState().unsavedModal).toBeNull();
      closeFolder.mockRestore();
    });

    it("Cancel (closeWorkspace) → keeps the workspace open", () => {
      useEditorStore.setState({ activeTabId: "a", tabs: [dirtyFileTab("a")] });
      useUIStore.setState({ unsavedModal: { intent: "closeWorkspace" } });
      const closeFolder = spyCloseFolder();

      render(<UnsavedChangesModal {...deps} />);
      fireEvent.click(
        screen.getByRole("button", { name: "unsavedChanges.cancel" }),
      );

      expect(useUIStore.getState().unsavedModal).toBeNull();
      expect(closeFolder).not.toHaveBeenCalled();
      expect(saveAllDirtyForQuit).not.toHaveBeenCalled();
      closeFolder.mockRestore();
    });
  });
});
