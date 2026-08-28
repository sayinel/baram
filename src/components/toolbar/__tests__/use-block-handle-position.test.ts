// §298-followups (Codex TS review) — nextHandleState (BlockHandle.test.ts)
// pins the perf helper in isolation, so a regression that inlines
// `setHandle({ pos, top })` back into the mousemove handler (bypassing
// nextHandleState entirely) stays green there. Pin the PRODUCTION wiring
// itself: two mousemoves over the same block must yield the same `handle`
// object reference, or React can't bail out of re-rendering on every one of
// the ~60/s mousemove ticks (see use-block-handle-position.ts's perf note).
import { act, renderHook } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createBaramExtensions } from "../../../extensions";
import { useBlockHandlePosition } from "../use-block-handle-position";

const editors: Editor[] = [];
function makeEditor(): Editor {
  const editor = new Editor({
    content: "<p>hello</p>",
    extensions: createBaramExtensions(),
  });
  editors.push(editor);
  return editor;
}

function moveOverBlock(dom: HTMLElement): void {
  dom.dispatchEvent(
    new MouseEvent("mousemove", { bubbles: true, clientX: 0, clientY: 0 }),
  );
}

afterEach(() => {
  for (const e of editors.splice(0)) e.destroy();
  vi.restoreAllMocks();
});

describe("useBlockHandlePosition — production wiring (not just the nextHandleState helper)", () => {
  it("two mousemoves over the same block keep the same handle reference", () => {
    const editor = makeEditor();
    // Pin every mousemove to resolve inside the same paragraph so both
    // ticks target the identical block.
    vi.spyOn(editor.view, "posAtCoords").mockReturnValue({
      pos: 1,
      inside: -1,
    });

    const closeMenu = vi.fn();
    const { result } = renderHook(() =>
      useBlockHandlePosition(editor, false, closeMenu),
    );

    act(() => moveOverBlock(editor.view.dom));
    const first = result.current.handle;
    expect(first).not.toBeNull();

    act(() => moveOverBlock(editor.view.dom));
    const second = result.current.handle;

    // Object.is identity, not just deep equality — a fresh `{ pos, top }`
    // literal on every tick would fail this even though its fields match.
    expect(second).toBe(first);
  });
});
