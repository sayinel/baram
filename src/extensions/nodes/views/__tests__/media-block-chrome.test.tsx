// Shared media-block chrome (§5.1/§5.5/§3.3): the unified hover toolbar
// (MediaToolbar) and the parent-controlled caption (BlockCaption). These are
// plain React components, so they render without an editor host.
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { BlockCaption } from "../BlockCaption";
import { MediaToolbar, MediaToolbarButton } from "../MediaToolbar";

describe("BlockCaption", () => {
  it("renders nothing when there is no caption and not editing", () => {
    const { container } = render(
      <BlockCaption
        editing={false}
        onCommit={vi.fn()}
        onEditingChange={vi.fn()}
        value={null}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows the caption text and requests edit on click", () => {
    const onEditingChange = vi.fn();
    const { container } = render(
      <BlockCaption
        editing={false}
        onCommit={vi.fn()}
        onEditingChange={onEditingChange}
        value="A diagram"
      />,
    );
    const caption = container.querySelector(".block-caption") as HTMLElement;
    expect(caption.textContent).toBe("A diagram");
    fireEvent.click(caption);
    expect(onEditingChange).toHaveBeenCalledWith(true);
  });

  it("commits a changed, trimmed caption on Enter and leaves edit mode", () => {
    const onCommit = vi.fn();
    const onEditingChange = vi.fn();
    const { container } = render(
      <BlockCaption
        editing
        onCommit={onCommit}
        onEditingChange={onEditingChange}
        value={null}
      />,
    );
    const input = container.querySelector(
      ".block-caption-input",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "  new caption  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledWith("new caption");
    expect(onEditingChange).toHaveBeenCalledWith(false);
  });

  it("does not commit when the value is unchanged", () => {
    const onCommit = vi.fn();
    const onEditingChange = vi.fn();
    const { container } = render(
      <BlockCaption
        editing
        onCommit={onCommit}
        onEditingChange={onEditingChange}
        value="same"
      />,
    );
    const input = container.querySelector(
      ".block-caption-input",
    ) as HTMLInputElement;
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).not.toHaveBeenCalled();
    expect(onEditingChange).toHaveBeenCalledWith(false);
  });

  it("exits edit mode on Escape without committing", () => {
    const onCommit = vi.fn();
    const onEditingChange = vi.fn();
    const { container } = render(
      <BlockCaption
        editing
        onCommit={onCommit}
        onEditingChange={onEditingChange}
        value="orig"
      />,
    );
    const input = container.querySelector(
      ".block-caption-input",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "discarded" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onCommit).not.toHaveBeenCalled();
    expect(onEditingChange).toHaveBeenCalledWith(false);
  });
});

describe("MediaToolbar", () => {
  it("renders its buttons and fires onClick", () => {
    const onClick = vi.fn();
    const { container } = render(
      <MediaToolbar>
        <MediaToolbarButton onClick={onClick} title="AI Commands">
          ai
        </MediaToolbarButton>
      </MediaToolbar>,
    );
    const toolbar = container.querySelector(".media-toolbar");
    expect(toolbar).not.toBeNull();
    const btn = container.querySelector(".media-toolbar-btn") as HTMLElement;
    expect(btn.getAttribute("title")).toBe("AI Commands");
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("marks an active button with media-toolbar-btn-active", () => {
    const { container } = render(
      <MediaToolbar>
        <MediaToolbarButton active onClick={vi.fn()} title="Caption">
          cap
        </MediaToolbarButton>
      </MediaToolbar>,
    );
    const btn = container.querySelector(".media-toolbar-btn") as HTMLElement;
    expect(btn.classList.contains("media-toolbar-btn-active")).toBe(true);
  });
});
