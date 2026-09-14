// issue 631 — the export dialog says up front what the notice would say
// afterwards: a note that was never saved has no folder for its relative
// images to resolve against, so a Pandoc export cannot embed them — and
// neither can a saved note that no open vault or folder holds.
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../ipc/invoke", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../ipc/invoke")>()),
  detectPandoc: vi.fn(async () => ({
    available: false,
    path: "",
    version: "",
  })),
}));

import type { ContextInfo } from "../../../ipc/types";

import { useContextStore } from "../../../stores/context/context";
import { useEditorStore } from "../../../stores/editor/editor";
import { useUIStore } from "../../../stores/ui/ui";
import { ExportDialog } from "../ExportDialog";

const tab = (filePath: string) => ({
  content: "",
  contextId: "ctx-vault",
  filePath,
  id: "tab-1",
  isDirty: false,
  isPinned: false,
  title: "note",
});

const context = (
  id: string,
  path: string,
  contextType: ContextInfo["contextType"],
): ContextInfo => ({
  addedAt: 0,
  color: "",
  contextType,
  id,
  label: id,
  path,
});

afterEach(() => {
  useEditorStore.setState({ activeTabId: null, tabs: [] });
  useUIStore.setState({ exportDialogOpen: false });
  useContextStore.setState({ activeContextId: null, contexts: [] });
});

describe("ExportDialog", () => {
  it("tells the user before a Pandoc export that an unsaved note cannot embed its relative images", () => {
    useEditorStore.setState({ activeTabId: "tab-1", tabs: [tab("")] });
    useUIStore.setState({ exportDialogOpen: true, exportFormat: "docx" });
    render(<ExportDialog editor={null} />);
    expect(screen.getByText(/not saved yet/)).toBeTruthy();
  });

  it("shows it for every format that embeds images, and for none that does not", () => {
    useEditorStore.setState({ activeTabId: "tab-1", tabs: [tab("")] });
    for (const format of ["docx", "epub"] as const) {
      useUIStore.setState({ exportDialogOpen: true, exportFormat: format });
      const view = render(<ExportDialog editor={null} />);
      expect(screen.getByText(/not saved yet/)).toBeTruthy();
      view.unmount();
    }
    // LaTeX and RST write the reference and open no file: saving the note
    // would change nothing for them, so the hint would be a false promise.
    for (const format of ["latex", "rst", "html", "pdf", "notion"] as const) {
      useUIStore.setState({ exportDialogOpen: true, exportFormat: format });
      const view = render(<ExportDialog editor={null} />);
      expect(screen.queryByText(/not saved yet/)).toBeNull();
      view.unmount();
    }
  });

  it("tells the user that a saved note no open vault or folder holds cannot embed them either", () => {
    // File > Open on a lone .md: saved, so "not saved yet" would be wrong,
    // but no directory context owns it — the policy will refuse every
    // relative image, and the export would only say so afterwards.
    useContextStore.setState({
      contexts: [
        context("ctx-file", "/Users/me/solo.md", "file"),
        context("ctx-other", "/elsewhere", "vault"),
      ],
    });
    useEditorStore.setState({
      activeTabId: "tab-1",
      tabs: [tab("/Users/me/solo.md")],
    });
    useUIStore.setState({ exportDialogOpen: true, exportFormat: "docx" });
    render(<ExportDialog editor={null} />);
    expect(screen.getByText(/not inside an open vault or folder/)).toBeTruthy();
    expect(screen.queryByText(/not saved yet/)).toBeNull();
  });

  it("says nothing of the kind for a saved note inside an open vault, or for a format that does not embed", () => {
    useContextStore.setState({
      contexts: [context("ctx-vault", "/vault", "vault")],
    });
    useEditorStore.setState({
      activeTabId: "tab-1",
      tabs: [tab("/vault/notes/today.md")],
    });
    useUIStore.setState({ exportDialogOpen: true, exportFormat: "docx" });
    const saved = render(<ExportDialog editor={null} />);
    expect(screen.queryByText(/not saved yet/)).toBeNull();
    expect(screen.queryByText(/not inside an open vault or folder/)).toBeNull();
    saved.unmount();
    useEditorStore.setState({ activeTabId: "tab-1", tabs: [tab("")] });
    useUIStore.setState({ exportDialogOpen: true, exportFormat: "html" });
    render(<ExportDialog editor={null} />);
    expect(screen.queryByText(/not saved yet/)).toBeNull();
  });
});
