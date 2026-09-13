// issue 631 — the export dialog says up front what the notice would say
// afterwards: a note that was never saved has no folder for its relative
// images to resolve against, so a Pandoc export cannot embed them.
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

afterEach(() => {
  useEditorStore.setState({ activeTabId: null, tabs: [] });
  useUIStore.setState({ exportDialogOpen: false });
});

describe("ExportDialog", () => {
  it("tells the user before a Pandoc export that an unsaved note cannot embed its relative images", () => {
    useEditorStore.setState({ activeTabId: "tab-1", tabs: [tab("")] });
    useUIStore.setState({ exportDialogOpen: true, exportFormat: "docx" });
    render(<ExportDialog editor={null} />);
    expect(screen.getByText(/not saved yet/)).toBeTruthy();
  });

  it("says nothing of the kind for a saved note, or for a format that does not embed", () => {
    useEditorStore.setState({
      activeTabId: "tab-1",
      tabs: [tab("/vault/notes/today.md")],
    });
    useUIStore.setState({ exportDialogOpen: true, exportFormat: "docx" });
    const saved = render(<ExportDialog editor={null} />);
    expect(screen.queryByText(/not saved yet/)).toBeNull();
    saved.unmount();
    useEditorStore.setState({ activeTabId: "tab-1", tabs: [tab("")] });
    useUIStore.setState({ exportDialogOpen: true, exportFormat: "html" });
    render(<ExportDialog editor={null} />);
    expect(screen.queryByText(/not saved yet/)).toBeNull();
  });
});
