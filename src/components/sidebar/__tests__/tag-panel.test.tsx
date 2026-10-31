// §56m The tag panel, through the real IPC wrapper: what rows it lists and what a rename sends.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Every command the panel and the persisted stores it imports send goes through `invoke`.
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import { useFileStore } from "../../../stores/file/file";
import { TagPanel } from "../TagPanel";

/** Index rows as `get_vault_tags` lists a front-matter `"#solo"` beside the body's `solo`. */
const ROWS = [
  { count: 2, tag: "solo" },
  { count: 1, tag: "#solo" },
];

describe("TagPanel (§56m)", () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockImplementation((command: string) => {
      if (command === "get_vault_tags") return Promise.resolve(ROWS);
      if (command === "rename_tag") {
        return Promise.resolve({ filesModified: 1, occurrencesReplaced: 1 });
      }
      return Promise.resolve(null);
    });
    useFileStore.setState({ rootPath: "/vault" });
  });

  // What turns this red: listing the rows as the index spells them — a second row `##solo`.
  it("lists a #-spelled front-matter tag and the body's tag as one row", async () => {
    render(<TagPanel />);
    expect(await screen.findByTitle("#solo (3)")).toBeTruthy();
    expect(screen.queryByTitle("##solo (1)")).toBeNull();
  });

  // What turns this red: stripping one `#` from the filter — `##so` looked for `#so`.
  it("filters by the typed name without its leading #s", async () => {
    render(<TagPanel />);
    await screen.findByTitle("#solo (3)");
    fireEvent.change(screen.getByPlaceholderText("Filter tags..."), {
      target: { value: "##so" },
    });
    expect(screen.queryByTitle("#solo (3)")).not.toBeNull();
  });

  // What turns this red: renaming to a name a body tag cannot spell — `rename_tag` would
  // write `#my tag` into every note, which reads back as the tag `my`.
  it("refuses a new name a body tag could not spell, and keeps the box open", async () => {
    render(<TagPanel />);
    fireEvent.contextMenu(await screen.findByTitle("#solo (3)"));
    fireEvent.click(screen.getByText("Rename tag..."));
    const input = screen.getByDisplayValue("solo");
    fireEvent.change(input, { target: { value: "my tag" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await Promise.resolve();
    expect(screen.getByDisplayValue("my tag")).toBeTruthy();
    expect(invoke).not.toHaveBeenCalledWith("rename_tag", expect.anything());
  });

  // What turns this red: stripping one `#` from the new name — `##focus` became `#focus`,
  // which the rename writes into the body as `##focus`, not a tag.
  it("renames to the typed name without its leading #s", async () => {
    render(<TagPanel />);
    fireEvent.contextMenu(await screen.findByTitle("#solo (3)"));
    fireEvent.click(screen.getByText("Rename tag..."));
    const input = screen.getByDisplayValue("solo");
    fireEvent.change(input, { target: { value: "##focus" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("rename_tag", {
        newTag: "focus",
        oldTag: "solo",
        rootPath: "/vault",
      }),
    );
  });
});
