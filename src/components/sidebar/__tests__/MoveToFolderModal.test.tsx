import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../hooks/use-file-tree-move", () => ({
  useFileTreeMove: () => ({
    moveEntries: vi.fn().mockResolvedValue(undefined),
  }),
}));

import { useFileStore } from "../../../stores/file/file";
import { MoveToFolderModal } from "../MoveToFolderModal";

beforeEach(() => {
  useFileStore.setState({
    rootPath: "/r",
    fileTree: [{ name: "a.md", path: "/r/a.md", isDir: false }],
  });
});

describe("MoveToFolderModal", () => {
  it("renders the overlay into document.body via portal (not a sidebar-nested subtree)", () => {
    const { container } = render(
      <MoveToFolderModal onClose={vi.fn()} sources={["/r/a.md"]} />,
    );
    // The portal target is document.body, so the render() container (which
    // testing-library appends to document.body) should NOT contain the overlay.
    expect(container.querySelector(".move-modal-overlay")).toBeNull();

    const overlay = document.body.querySelector(".move-modal-overlay");
    expect(overlay).not.toBeNull();
    expect(screen.getByText("Move 1 item to…")).toBeInTheDocument();
  });

  it("renders a folder icon for each folder row", () => {
    render(<MoveToFolderModal onClose={vi.fn()} sources={["/r/a.md"]} />);

    const items = document.body.querySelectorAll(".move-modal-item");
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.querySelector(".file-tree-icon svg")).not.toBeNull();
    }
  });

  it("marks the highlighted row with both base and selected classes as distinct tokens", () => {
    render(<MoveToFolderModal onClose={vi.fn()} sources={["/r/a.md"]} />);

    // Guards against the template-literal missing-space bug that merged the two
    // class names into one token ("move-modal-itemmove-modal-item-selected"),
    // which broke .move-modal-item styling on the active/hovered row.
    const selected = document.body.querySelector(".move-modal-item-selected");
    expect(selected).not.toBeNull();
    expect(selected!.classList.contains("move-modal-item")).toBe(true);
    expect(selected!.classList.contains("move-modal-item-selected")).toBe(true);
  });

  it("shows a muted empty-state message when the filter matches no folders", () => {
    render(<MoveToFolderModal onClose={vi.fn()} sources={["/r/a.md"]} />);

    const search = document.body.querySelector(
      ".move-modal-search",
    ) as HTMLInputElement;
    fireEvent.change(search, { target: { value: "no-such-folder-xyz" } });

    expect(document.body.querySelector(".move-modal-empty")).toHaveTextContent(
      "No folders match",
    );
    expect(document.body.querySelector(".move-modal-item")).toBeNull();
  });
});
