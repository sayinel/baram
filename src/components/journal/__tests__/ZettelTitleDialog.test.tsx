import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useUIStore } from "../../../stores/ui/ui";
import { ZettelTitleDialog } from "../ZettelTitleDialog";

describe("ZettelTitleDialog", () => {
  beforeEach(() => useUIStore.getState().closeZettelTitleDialog());

  it("renders nothing when closed", () => {
    const { container } = render(<ZettelTitleDialog />);
    expect(container).toBeEmptyDOMElement();
  });

  it("submits the typed title and closes", () => {
    const onSubmit = vi.fn();
    useUIStore.getState().openZettelTitleDialog({
      onSubmit,
      title: "New Zettel",
      confirmLabel: "Create",
    });
    render(<ZettelTitleDialog />);
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "New Idea" },
    });
    fireEvent.click(screen.getByText("Create"));
    expect(onSubmit).toHaveBeenCalledWith("New Idea");
    expect(useUIStore.getState().zettelTitleDialog.open).toBe(false);
  });

  it("does not submit on Enter while an IME composition is in progress", () => {
    const onSubmit = vi.fn();
    useUIStore.getState().openZettelTitleDialog({
      onSubmit,
      title: "New Zettel",
      confirmLabel: "Create",
    });
    render(<ZettelTitleDialog />);
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "제목" },
    });
    fireEvent.keyDown(screen.getByRole("textbox"), {
      key: "Enter",
      isComposing: true,
    });
    expect(onSubmit).not.toHaveBeenCalled();
    expect(useUIStore.getState().zettelTitleDialog.open).toBe(true);
  });

  it("renders the action's title, description, confirm label, and prefill", () => {
    useUIStore.getState().openZettelTitleDialog({
      onSubmit: vi.fn(),
      title: "Promote to Permanent Note",
      description: "Move this fleeting note from inbox/ to notes/.",
      confirmLabel: "Promote",
      initialTitle: "First line",
    });
    render(<ZettelTitleDialog />);
    expect(screen.getByText("Promote to Permanent Note")).toBeInTheDocument();
    expect(screen.getByText(/move this fleeting note/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Promote" })).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveValue("First line");
  });
});
