// Shared media-block chrome (§5.1/§5.5/§3.3): the unified hover toolbar
// (MediaToolbar) and the parent-controlled caption (BlockCaption). These are
// plain React components, so they render without an editor host.
import { act, fireEvent, render, screen } from "@testing-library/react";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import en from "../../../../i18n/en.json";
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

  // §294 fix (M4): the input must ALSO carry `media-caption-input` — the
  // class export-html.ts's chrome-stripping loop actually looks for. Kept
  // alongside `block-caption-input` (asserted above), not instead of it: that
  // class still owns this input's visual styling (media-block.css).
  it("also carries the shared media-caption-input class, so export can find it (§294 M4)", () => {
    const { container } = render(
      <BlockCaption
        editing
        onCommit={vi.fn()}
        onEditingChange={vi.fn()}
        value={null}
      />,
    );
    const input = container.querySelector(
      ".block-caption-input",
    ) as HTMLInputElement;
    expect(input.classList.contains("media-caption-input")).toBe(true);
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
  // The warm window is module state in tooltip-core, so a pill left showing by one test
  // would open the next one instantly and make its delay assertion vacuous. Jumping the
  // clock forward is enough — and the fake clock is installed ONCE, because
  // `vi.useFakeTimers()` resets "now" to the real time and would send it BACKWARDS past a
  // stamp an earlier test left (a negative age reads as warm). See tooltip.test.tsx.
  beforeAll(() => {
    vi.useFakeTimers();
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    vi.setSystemTime(Date.now() + 60_000);
  });

  it("renders its buttons and fires onClick", () => {
    const onClick = vi.fn();
    const { container } = render(
      <MediaToolbar>
        <MediaToolbarButton label={en["toolbar.ai.commands"]} onClick={onClick}>
          ai
        </MediaToolbarButton>
      </MediaToolbar>,
    );
    const toolbar = container.querySelector(".media-toolbar");
    expect(toolbar).not.toBeNull();
    const btn = container.querySelector(".media-toolbar-btn") as HTMLElement;
    // The label is the button's accessible name at ALL times, not only while the pill is
    // up: an icon-only button would otherwise be nameless to a screen reader whenever it
    // is not hovered.
    expect(btn.getAttribute("aria-label")).toBe(en["toolbar.ai.commands"]);
    // ‼️ And NOT a native `title`. Both at once means the browser's own label arrives a
    // second late, underneath the pill already on screen.
    expect(btn.getAttribute("title")).toBeNull();
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("shows the app's own pill on hover, not a browser tooltip", () => {
    const { container } = render(
      <MediaToolbar>
        <MediaToolbarButton label={en["blockChrome.caption"]} onClick={vi.fn()}>
          cap
        </MediaToolbarButton>
      </MediaToolbar>,
    );
    const btn = container.querySelector(".media-toolbar-btn") as HTMLElement;
    fireEvent.pointerEnter(btn);
    // Nothing yet: resting is what asks for a label. This is the assertion the native
    // `title` could never satisfy either way — its delay was the browser's to pick.
    expect(screen.queryByRole("tooltip")).toBeNull();
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(screen.getByRole("tooltip").textContent).toBe(
      en["blockChrome.caption"],
    );
    fireEvent.pointerLeave(btn);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("marks an active button with media-toolbar-btn-active", () => {
    const { container } = render(
      <MediaToolbar>
        <MediaToolbarButton
          active
          label={en["blockChrome.caption"]}
          onClick={vi.fn()}
        >
          cap
        </MediaToolbarButton>
      </MediaToolbar>,
    );
    const btn = container.querySelector(".media-toolbar-btn") as HTMLElement;
    expect(btn.classList.contains("media-toolbar-btn-active")).toBe(true);
  });
});
