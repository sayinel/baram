// §close-guard: tests for the shared unsaved-changes confirmation modal.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ‼️ Partial mock: only the three save helpers are doubled. `isTabUnsaved` is the
// production predicate the modal counts with — replacing it with a stub would let a
// broken predicate pass every count assertion in this file.
vi.mock("../../../hooks/use-close-guard", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../hooks/use-close-guard")>();
  return {
    ...actual,
    saveAllDirtyForQuit: vi.fn(),
    saveDirtyTab: vi.fn(),
    saveDirtyTabsForContexts: vi.fn(),
  };
});

vi.mock("../../../services/close-context", () => ({
  closeContexts: vi.fn(async () => undefined),
}));

vi.mock("../../../ipc/invoke", () => ({
  confirmQuit: vi.fn().mockResolvedValue(undefined),
}));

const fileWindows = vi.hoisted(() => ({
  destroy: vi.fn(async () => undefined),
  saveFileWindows: vi.fn(async () => true),
}));
vi.mock("../../../services/file-windows", () => ({
  saveFileWindows: fileWindows.saveFileWindows,
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ destroy: fileWindows.destroy }),
}));

vi.mock("../../../services/app-update", () => ({
  installDownloadedUpdate: vi.fn(async () => undefined),
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
  saveDirtyTabsForContexts,
} from "../../../hooks/use-close-guard";
import { confirmQuit } from "../../../ipc/invoke";
import { installDownloadedUpdate } from "../../../services/app-update";
import { closeContexts } from "../../../services/close-context";
import { useContextStore } from "../../../stores/context/context";
import { useEditorStore } from "../../../stores/editor/editor";
import { useFileStore } from "../../../stores/file/file";
import { useFileWindowStore } from "../../../stores/system/file-windows";
import { useUIStore } from "../../../stores/ui/ui";
import { UnsavedChangesModal } from "../UnsavedChangesModal";

// ── helpers ──────────────────────────────────────────────────────────────────

const deps: CloseGuardDeps = {
  handleSave: vi.fn(async () => undefined),
};

function dirtyFileTab(
  id: string,
  title = `${id}.md`,
  contextId = "ctx",
): EditorTab {
  return {
    contextId,
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
  useFileWindowStore.setState({ unsaved: new Set() });
  fileWindows.saveFileWindows.mockResolvedValue(true);
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

  // ── file windows (§89) ─────────────────────────────────────────────────────
  //
  // Quitting and installing end the file windows too, so the main window's question answers for
  // them. Closing one asks in that window, about its one tab.
  describe.each(["quit", "installUpdate"] as const)(
    "%s with a file window holding unsaved work",
    (intent) => {
      const message = `unsavedChanges.${intent === "quit" ? "quitMessage" : "installUpdateMessage"}`;
      const primary = `unsavedChanges.${intent === "quit" ? "saveAndQuit" : "saveAndInstallUpdate"}`;

      beforeEach(() => {
        useEditorStore.setState({
          activeTabId: "a",
          tabs: [dirtyFileTab("a")],
        });
        useFileWindowStore.setState({ unsaved: new Set(["file-1"]) });
        useUIStore.setState({ unsavedModal: { intent } });
        vi.mocked(saveAllDirtyForQuit).mockResolvedValue(true);
      });

      // 이것을 실패시키는 것: 개수에 파일 창을 더하지 않으면 main 의 탭만 있는 것처럼 묻는다.
      it("counts it", () => {
        render(<UnsavedChangesModal {...deps} />);

        expect(
          screen.getByText(containing(message, '"count":"2"')),
        ).toBeInTheDocument();
      });

      // 이것을 실패시키는 것: 저장이 main 의 탭에서 멈추면 그 창의 글은 프로세스와 함께 사라진다.
      it("Save has it save too, and only then goes on", async () => {
        render(<UnsavedChangesModal {...deps} />);
        fireEvent.click(screen.getByRole("button", { name: primary }));

        await waitFor(() =>
          expect(fileWindows.saveFileWindows).toHaveBeenCalledOnce(),
        );
        await waitFor(() =>
          expect(useUIStore.getState().unsavedModal).toBeNull(),
        );
        const wentOn = () => [
          ...vi.mocked(confirmQuit).mock.invocationCallOrder,
          ...vi.mocked(installDownloadedUpdate).mock.invocationCallOrder,
        ];
        await waitFor(() => expect(wentOn()).toHaveLength(1));
        expect(
          fileWindows.saveFileWindows.mock.invocationCallOrder[0],
        ).toBeLessThan(wentOn()[0]);
      });

      it("Save stays open when it could not save", async () => {
        fileWindows.saveFileWindows.mockResolvedValue(false);

        render(<UnsavedChangesModal {...deps} />);
        fireEvent.click(screen.getByRole("button", { name: primary }));

        await waitFor(() =>
          expect(fileWindows.saveFileWindows).toHaveBeenCalledOnce(),
        );
        expect(useUIStore.getState().unsavedModal).toEqual({ intent });
        expect(confirmQuit).not.toHaveBeenCalled();
        expect(installDownloadedUpdate).not.toHaveBeenCalled();
      });
    },
  );

  // The pair: these take only this webview's tabs, so the file window is not their business.
  it("a reload does not count a file window", () => {
    useEditorStore.setState({ activeTabId: "a", tabs: [dirtyFileTab("a")] });
    useFileWindowStore.setState({ unsaved: new Set(["file-1"]) });
    useUIStore.setState({ unsavedModal: { intent: "reload" } });

    render(<UnsavedChangesModal {...deps} />);

    expect(
      screen.getByText(
        containing("unsavedChanges.reloadMessage", '"count":"1"'),
      ),
    ).toBeInTheDocument();
  });

  // 이것을 실패시키는 것: 저장을 모든 intent 에서 파일 창까지 넓히면 묻지 않은 파일을 쓴다.
  it("closing the workspace does not have a file window save", async () => {
    useEditorStore.setState({ activeTabId: "a", tabs: [dirtyFileTab("a")] });
    useFileWindowStore.setState({ unsaved: new Set(["file-1"]) });
    useUIStore.setState({ unsavedModal: { intent: "closeWorkspace" } });
    vi.mocked(saveAllDirtyForQuit).mockResolvedValue(true);

    render(<UnsavedChangesModal {...deps} />);
    fireEvent.click(
      screen.getByRole("button", {
        name: "unsavedChanges.saveAndCloseWorkspace",
      }),
    );

    await waitFor(() => expect(useUIStore.getState().unsavedModal).toBeNull());
    expect(fileWindows.saveFileWindows).not.toHaveBeenCalled();
  });

  describe("closing a file window", () => {
    beforeEach(() => {
      useEditorStore.setState({ activeTabId: "a", tabs: [dirtyFileTab("a")] });
      useUIStore.setState({
        unsavedModal: { intent: "closeWindow", tabId: "a" },
      });
    });

    it("names the file", () => {
      render(<UnsavedChangesModal {...deps} />);

      expect(
        screen.getByText(containing("unsavedChanges.closeMessage", "a.md")),
      ).toBeInTheDocument();
    });

    it("Save saves the tab, then closes the window", async () => {
      vi.mocked(saveDirtyTab).mockResolvedValue(true);

      render(<UnsavedChangesModal {...deps} />);
      fireEvent.click(
        screen.getByRole("button", { name: "unsavedChanges.saveAndClose" }),
      );

      await waitFor(() => expect(fileWindows.destroy).toHaveBeenCalledOnce());
      expect(saveDirtyTab).toHaveBeenCalledOnce();
    });

    it("Save that fails keeps the window", async () => {
      vi.mocked(saveDirtyTab).mockResolvedValue(false);

      render(<UnsavedChangesModal {...deps} />);
      fireEvent.click(
        screen.getByRole("button", { name: "unsavedChanges.saveAndClose" }),
      );

      await waitFor(() => expect(saveDirtyTab).toHaveBeenCalledOnce());
      expect(fileWindows.destroy).not.toHaveBeenCalled();
    });

    it("Don't Save closes it without saving", async () => {
      render(<UnsavedChangesModal {...deps} />);
      fireEvent.click(
        screen.getByRole("button", { name: "unsavedChanges.dontSave" }),
      );

      await waitFor(() => expect(fileWindows.destroy).toHaveBeenCalledOnce());
      expect(saveDirtyTab).not.toHaveBeenCalled();
    });

    it("Cancel keeps it", () => {
      render(<UnsavedChangesModal {...deps} />);
      fireEvent.click(
        screen.getByRole("button", { name: "unsavedChanges.cancel" }),
      );

      expect(fileWindows.destroy).not.toHaveBeenCalled();
      expect(useUIStore.getState().unsavedModal).toBeNull();
    });
  });

  // ── update install (§206) ──────────────────────────────────────────────────
  //
  // Installing ends the process on every platform, so like quit it answers for every dirty
  // tab. Cancel has no action of its own: the install simply never runs.
  describe("update install", () => {
    it("shows the dirty count and a Save & Install action", () => {
      useEditorStore.setState({
        activeTabId: "a",
        tabs: [dirtyFileTab("a"), dirtyFileTab("b")],
      });
      useUIStore.setState({ unsavedModal: { intent: "installUpdate" } });

      render(<UnsavedChangesModal {...deps} />);

      expect(
        screen.getByText(
          containing("unsavedChanges.installUpdateMessage", '"count":"2"'),
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", {
          name: "unsavedChanges.saveAndInstallUpdate",
        }),
      ).toBeInTheDocument();
    });

    it("Save & Install → saves every dirty tab, then installs", async () => {
      useEditorStore.setState({
        activeTabId: "a",
        tabs: [dirtyFileTab("a"), dirtyFileTab("b")],
      });
      useUIStore.setState({ unsavedModal: { intent: "installUpdate" } });
      const order: string[] = [];
      vi.mocked(saveAllDirtyForQuit).mockImplementation(async () => {
        order.push("save");
        return true;
      });
      vi.mocked(installDownloadedUpdate).mockImplementation(async () => {
        order.push("install");
      });

      render(<UnsavedChangesModal {...deps} />);
      fireEvent.click(
        screen.getByRole("button", {
          name: "unsavedChanges.saveAndInstallUpdate",
        }),
      );

      await waitFor(() => expect(order).toEqual(["save", "install"]));
      expect(useUIStore.getState().unsavedModal).toBeNull();
    });

    // 이것을 실패시키는 것: 저장 실패에도 proceed 로 가면 저장 안 된 문서를 둔 채 프로세스가 끝난다.
    it("Save & Install → stays open and does not install when a save does not finish", async () => {
      useEditorStore.setState({ activeTabId: "a", tabs: [dirtyFileTab("a")] });
      useUIStore.setState({ unsavedModal: { intent: "installUpdate" } });
      vi.mocked(saveAllDirtyForQuit).mockResolvedValue(false);

      render(<UnsavedChangesModal {...deps} />);
      fireEvent.click(
        screen.getByRole("button", {
          name: "unsavedChanges.saveAndInstallUpdate",
        }),
      );

      await waitFor(() => expect(saveAllDirtyForQuit).toHaveBeenCalledOnce());
      expect(installDownloadedUpdate).not.toHaveBeenCalled();
      expect(useUIStore.getState().unsavedModal).toEqual({
        intent: "installUpdate",
      });
    });

    it("Don't Save → installs without saving", async () => {
      useEditorStore.setState({ activeTabId: "a", tabs: [dirtyFileTab("a")] });
      useUIStore.setState({ unsavedModal: { intent: "installUpdate" } });

      render(<UnsavedChangesModal {...deps} />);
      fireEvent.click(
        screen.getByRole("button", { name: "unsavedChanges.dontSave" }),
      );

      await waitFor(() =>
        expect(installDownloadedUpdate).toHaveBeenCalledOnce(),
      );
      expect(saveAllDirtyForQuit).not.toHaveBeenCalled();
      expect(useUIStore.getState().unsavedModal).toBeNull();
    });

    it("Cancel → neither saves nor installs", () => {
      useEditorStore.setState({ activeTabId: "a", tabs: [dirtyFileTab("a")] });
      useUIStore.setState({ unsavedModal: { intent: "installUpdate" } });

      render(<UnsavedChangesModal {...deps} />);
      fireEvent.click(
        screen.getByRole("button", { name: "unsavedChanges.cancel" }),
      );

      expect(useUIStore.getState().unsavedModal).toBeNull();
      expect(installDownloadedUpdate).not.toHaveBeenCalled();
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

  // ── close-context flow (§82) ───────────────────────────────────────────────
  //
  // Closing one or more contexts: the tab bar's x, its context menu's Close and
  // Close Others, Settings > Vault's remove. What gets SAVED here must be scoped
  // to those contexts — saving everything would write files in folders the user
  // never touched.
  describe("close context", () => {
    beforeEach(() => {
      useContextStore.setState({
        activeContextId: "ctx",
        contexts: [
          { id: "ctx", label: "Notes", path: "/v/notes" },
          { id: "other", label: "Papers", path: "/v/papers" },
        ],
      } as never);
    });

    it("counts only the closing contexts' dirty tabs, and names them", () => {
      useEditorStore.setState({
        activeTabId: "a",
        tabs: [
          dirtyFileTab("a", "a.md", "ctx"),
          dirtyFileTab("z", "z.md", "other"),
        ],
      });
      useUIStore.setState({
        unsavedModal: { contextIds: ["ctx"], intent: "closeContext" },
      });

      render(<UnsavedChangesModal {...deps} />);

      // Discriminating: two dirty tabs exist, but only one is in scope. A global
      // count would read "2" here.
      expect(
        screen.getByText(
          containing(
            "unsavedChanges.closeContextMessage",
            '"count":"1"',
            "Notes",
          ),
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", {
          name: "unsavedChanges.saveAndCloseContext",
        }),
      ).toBeInTheDocument();
    });

    // §82 Closing the last context takes every tab with it, including an untitled one, which
    // belongs to no context. Saving only that context would leave the untitled text to die.
    // 이것을 실패시키는 것: `closesEveryTab` 검사를 지우면 그 탭을 세지도 저장하지도 않는다.
    it("the last context answers for every tab, not only its own", async () => {
      useContextStore.setState({
        contexts: [
          {
            addedAt: 0,
            color: "#fff",
            contextType: "vault",
            id: "ctx",
            label: "Notes",
            path: "/v",
          },
        ],
      } as never);
      useEditorStore.setState({
        activeTabId: "a",
        tabs: [
          dirtyFileTab("a"),
          { ...dirtyFileTab("u", "Untitled", ""), filePath: "" },
        ],
      });
      useUIStore.setState({
        unsavedModal: { contextIds: ["ctx"], intent: "closeContext" },
      });
      vi.mocked(saveAllDirtyForQuit).mockResolvedValue(true);

      render(<UnsavedChangesModal {...deps} />);

      expect(
        screen.getByText(
          containing("unsavedChanges.closeContextMessage", '"count":"2"'),
        ),
      ).toBeInTheDocument();
      fireEvent.click(
        screen.getByRole("button", {
          name: "unsavedChanges.saveAndCloseContext",
        }),
      );

      await waitFor(() => expect(saveAllDirtyForQuit).toHaveBeenCalledOnce());
      expect(saveDirtyTabsForContexts).not.toHaveBeenCalled();
    });

    it("Save & Close Folder → saves ONLY those contexts, then closes them", async () => {
      useEditorStore.setState({
        activeTabId: "a",
        tabs: [dirtyFileTab("a", "a.md", "ctx")],
      });
      useUIStore.setState({
        unsavedModal: { contextIds: ["ctx"], intent: "closeContext" },
      });
      vi.mocked(saveDirtyTabsForContexts).mockResolvedValue(true);

      render(<UnsavedChangesModal {...deps} />);
      fireEvent.click(
        screen.getByRole("button", {
          name: "unsavedChanges.saveAndCloseContext",
        }),
      );

      await waitFor(() => expect(closeContexts).toHaveBeenCalledWith(["ctx"]));
      expect(saveDirtyTabsForContexts).toHaveBeenCalledOnce();
      expect(vi.mocked(saveDirtyTabsForContexts).mock.calls[0][0]).toEqual([
        "ctx",
      ]);
      // The scope guarantee: a whole-surface save would touch "other" too.
      expect(saveAllDirtyForQuit).not.toHaveBeenCalled();
      expect(useUIStore.getState().unsavedModal).toBeNull();
    });

    it("Save & Close Folder → closes nothing when a Save As is cancelled", async () => {
      useEditorStore.setState({
        activeTabId: "a",
        tabs: [dirtyFileTab("a", "a.md", "ctx")],
      });
      useUIStore.setState({
        unsavedModal: { contextIds: ["ctx"], intent: "closeContext" },
      });
      vi.mocked(saveDirtyTabsForContexts).mockResolvedValue(false);

      render(<UnsavedChangesModal {...deps} />);
      fireEvent.click(
        screen.getByRole("button", {
          name: "unsavedChanges.saveAndCloseContext",
        }),
      );

      await waitFor(() =>
        expect(saveDirtyTabsForContexts).toHaveBeenCalledOnce(),
      );
      expect(closeContexts).not.toHaveBeenCalled();
      expect(useUIStore.getState().unsavedModal).toEqual({
        contextIds: ["ctx"],
        intent: "closeContext",
      });
    });

    it("Don't Save → closes every context it was asked about, without saving", async () => {
      useEditorStore.setState({
        activeTabId: "a",
        tabs: [dirtyFileTab("a", "a.md", "ctx")],
      });
      useUIStore.setState({
        unsavedModal: { contextIds: ["ctx", "other"], intent: "closeContext" },
      });

      render(<UnsavedChangesModal {...deps} />);
      fireEvent.click(
        screen.getByRole("button", { name: "unsavedChanges.dontSave" }),
      );

      await waitFor(() =>
        expect(closeContexts).toHaveBeenCalledWith(["ctx", "other"]),
      );
      expect(saveDirtyTabsForContexts).not.toHaveBeenCalled();
    });

    it("Cancel → keeps the contexts", () => {
      useEditorStore.setState({
        activeTabId: "a",
        tabs: [dirtyFileTab("a", "a.md", "ctx")],
      });
      useUIStore.setState({
        unsavedModal: { contextIds: ["ctx"], intent: "closeContext" },
      });

      render(<UnsavedChangesModal {...deps} />);
      fireEvent.click(
        screen.getByRole("button", { name: "unsavedChanges.cancel" }),
      );

      expect(useUIStore.getState().unsavedModal).toBeNull();
      expect(closeContexts).not.toHaveBeenCalled();
      expect(saveDirtyTabsForContexts).not.toHaveBeenCalled();
    });
  });
});
