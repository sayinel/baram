import { createRef } from "react";

import type { SymbolSuggestionItem } from "../../../extensions/plugins/symbol-search";

import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SymbolMenuList, type SymbolMenuRef } from "../SymbolMenu";

const items: SymbolSuggestionItem[] = [
  { char: "→", id: "→", label: "right arrow" },
  { char: "←", id: "←", label: "left arrow" },
];

function setup() {
  const ref = createRef<SymbolMenuRef>();
  const command = vi.fn();
  render(<SymbolMenuList command={command} items={items} ref={ref} />);
  const press = (key: string) => {
    let handled = false;
    act(() => {
      handled =
        ref.current?.onKeyDown(new KeyboardEvent("keydown", { key })) ?? false;
    });
    return handled;
  };
  return { command, press };
}

describe("SymbolMenuList", () => {
  it("shows each character with its label", () => {
    setup();
    expect(screen.getByText("→")).toBeTruthy();
    expect(screen.getByText("right arrow")).toBeTruthy();
  });

  it("Enter picks the highlighted entry, starting at the first", () => {
    const { command, press } = setup();
    expect(press("Enter")).toBe(true);
    expect(command).toHaveBeenCalledWith(items[0]);
  });

  it("arrow keys move the highlight, wrapping around", () => {
    const { command, press } = setup();
    press("ArrowDown");
    press("Tab");
    expect(command).toHaveBeenLastCalledWith(items[1]);
    press("ArrowDown"); // wraps to the first
    press("Enter");
    expect(command).toHaveBeenLastCalledWith(items[0]);
  });

  it("leaves other keys to the editor", () => {
    const { press } = setup();
    expect(press("a")).toBe(false);
  });

  it("a click picks that entry", () => {
    const { command } = setup();
    fireEvent.click(screen.getByText("left arrow"));
    expect(command).toHaveBeenCalledWith(items[1]);
  });
});
