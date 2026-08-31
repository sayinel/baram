// §316 A date mention is a VALUE, not a pointer.
//
// Clicking one opens the calendar and rewrites the day in place. Reaching the
// journal entry for that day is `[[2026-08-30]]`'s job — and that syntax is the
// one `extractor.rs` collects, so it is the one that appears in backlinks and
// the graph. `@` never did, which is why it stopped pretending to be a link.
import type { NodeViewProps } from "@tiptap/react";

import { fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { askDateValue } = vi.hoisted(() => ({ askDateValue: vi.fn() }));
vi.mock("../../../utils/editor/ask-date", () => ({ askDateValue }));

vi.mock("../../../utils/editor/mutation-tasks", () => ({
  awaitBoundToEditor: (_view: unknown, pending: Promise<unknown>) => pending,
}));

// NodeViewWrapper needs a live NodeView context in the real package; a plain
// span carries the props this component sets and is what the assertions read.
vi.mock("@tiptap/react", () => ({
  NodeViewWrapper: ({
    children,
    ...rest
  }: {
    [k: string]: unknown;
    children: React.ReactNode;
  }) => <span {...(rest as object)}>{children}</span>,
}));

import { MentionView } from "../mention-view";

function setup(
  over: { editable?: boolean; type?: string; value?: string } = {},
) {
  const { editable = true, type = "date", value = "2026-08-30" } = over;
  const onNavigate = vi.fn();
  const updateAttributes = vi.fn();
  const props = {
    editor: { isEditable: editable, view: {} },
    extension: { options: { onNavigate } },
    node: { attrs: { type, value } },
    selected: false,
    updateAttributes,
  } as unknown as NodeViewProps;

  const { container } = render(<MentionView {...props} />);
  const el = container.querySelector("[data-mention-type]") as HTMLElement;
  return { el, onNavigate, updateAttributes };
}

/** Let the click handler's async continuation run. */
async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  vi.clearAllMocks();
  askDateValue.mockResolvedValue("2026-09-15");
});

describe("§316 clicking a date mention edits the date", () => {
  it("rewrites the value with what the calendar answers", async () => {
    const { el, updateAttributes } = setup();

    fireEvent.click(el);
    await settle();

    expect(updateAttributes).toHaveBeenCalledWith({ value: "2026-09-15" });
  });

  it("does not navigate", async () => {
    // The behaviour this replaces: a single click used to open — and create —
    // that day's journal entry.
    const { el, onNavigate } = setup();

    fireEvent.click(el);
    await settle();

    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("leaves the document alone when cancelled", async () => {
    askDateValue.mockResolvedValue(null);
    const { el, updateAttributes } = setup();

    fireEvent.click(el);
    await settle();

    expect(updateAttributes).not.toHaveBeenCalled();
  });

  it("writes nothing when the answer is the date it already had", async () => {
    // An unchanged value would still be a transaction: a dirty buffer and an
    // undo step for a dialog the user effectively cancelled.
    askDateValue.mockResolvedValue("2026-08-30");
    const { el, updateAttributes } = setup({ value: "2026-08-30" });

    fireEvent.click(el);
    await settle();

    expect(updateAttributes).not.toHaveBeenCalled();
  });

  it("does not open the calendar in a read-only view", async () => {
    // Previews and export renders mount the same NodeView.
    const { el, updateAttributes } = setup({ editable: false });

    fireEvent.click(el);
    await settle();

    expect(askDateValue).not.toHaveBeenCalled();
    expect(updateAttributes).not.toHaveBeenCalled();
  });

  it("opens the calendar holding the current date", async () => {
    const { el } = setup({ value: "2026-03-01" });

    fireEvent.click(el);
    await settle();

    expect(askDateValue).toHaveBeenCalledWith(
      expect.objectContaining({ value: "2026-03-01" }),
    );
  });
});

describe("§316 a page mention already in a document keeps working", () => {
  // New ones cannot be authored — `@` offers dates only — but parsing and
  // rendering stay, so documents that hold them do not silently change.
  it("navigates on Cmd+click, as before", () => {
    const { el, onNavigate } = setup({ type: "page", value: "My Note" });

    fireEvent.click(el, { metaKey: true });

    expect(onNavigate).toHaveBeenCalledWith("page", "My Note");
  });

  it("does not open the calendar", async () => {
    const { el, updateAttributes } = setup({ type: "page", value: "My Note" });

    fireEvent.click(el);
    await settle();

    expect(askDateValue).not.toHaveBeenCalled();
    expect(updateAttributes).not.toHaveBeenCalled();
  });
});
