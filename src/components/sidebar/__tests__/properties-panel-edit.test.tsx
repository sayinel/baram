// §72 The Properties panel's edits, through the real component: what reaches the file.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The persisted stores read and write their storage through `invoke`.
const invoke = vi.hoisted(() => vi.fn().mockResolvedValue(null));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
const showPrompt = vi.hoisted(() => vi.fn());
vi.mock("../../../utils/ai-commands", () => ({ showPrompt }));

import { useEditorStore } from "../../../stores/editor/editor";
import { useFileStore } from "../../../stores/file/file";
import { useUIStore } from "../../../stores/ui/ui";
import { PropertiesPanel } from "../PropertiesPanel";

const PATH = "/vault/note.md";
const NOTE = [
  "---",
  "title: old",
  "tags:",
  "  - a # kept",
  "meta:",
  "  nested: 1",
  "---",
  "body",
].join("\r\n");

function fileContent(): string {
  return useFileStore.getState().openFiles.get(PATH)!;
}

describe("PropertiesPanel edits (§72)", () => {
  beforeEach(() => {
    showPrompt.mockReset();
    useFileStore.setState({ openFiles: new Map([[PATH, NOTE]]) });
    useEditorStore.setState({
      activeTabId: "t1",
      tabs: [
        {
          contextId: "",
          filePath: PATH,
          id: "t1",
          isDirty: false,
          isPinned: false,
          title: "note.md",
        },
      ],
    });
    useUIStore.setState({ rightPanelMode: "properties", rightPanelOpen: true });
  });

  // What turns this red: rebuilding the note from the panel's entries — the block list's
  // comment, the nested map, the CRLF breaks and the line break after the closing `---` were
  // lost (`---body`).
  it("rewrites the edited property's line and nothing else", () => {
    render(<PropertiesPanel />);
    fireEvent.change(screen.getByDisplayValue("old"), {
      target: { value: "Plan: v2" },
    });
    expect(fileContent()).toBe(NOTE.replace("title: old", 'title: "Plan: v2"'));
  });

  // What turns this red: adding the typed text as it is — `my tag` is a tag only in front
  // matter, which the body's `#` cannot reach.
  it("adds a tags chip only for a name a body tag can spell", async () => {
    render(<PropertiesPanel />);
    showPrompt.mockResolvedValueOnce("my tag");
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Add item"));
    });
    expect(fileContent()).toBe(NOTE);

    showPrompt.mockResolvedValueOnce("#new");
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Add item"));
    });
    expect(fileContent()).toBe(
      NOTE.replace("  - a # kept", "  - a # kept\r\n  - new"),
    );
  });
});
