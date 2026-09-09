// issue 542 — the table toolbar's ⋯ button still toggles its popup after the
// menu's dismiss moved to the capture phase.
//
// MenuList used to close on the ⋯ mousedown (bubble) BEFORE the button's
// onClick, so the button remembered "was it open at mousedown" to avoid
// reopening. With a capture-phase dismiss that memory would race the close.
// The button is now the popup's `toggleRef`: its mousedown does not dismiss,
// and onClick flips the real state. This pins the contract from the outside:
// click opens, click closes (and does not reopen), click opens again, and a
// mousedown anywhere else closes.
import { cleanup, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  cleanupEditors,
  flush,
  mountTableWithToolbar,
} from "./table-toolbar-test-helpers";

afterEach(() => {
  cleanup();
  cleanupEditors();
});

function popupOpen(): boolean {
  return document.body.querySelector(".context-menu") !== null;
}

describe("the ⋯ overflow popup toggles from its button", () => {
  it("opens, closes without reopening, opens again", async () => {
    const { more } = await mountTableWithToolbar();

    fireEvent.mouseDown(more, { button: 0 });
    fireEvent.click(more);
    await flush();
    expect(popupOpen()).toBe(true);

    fireEvent.mouseDown(more, { button: 0 });
    fireEvent.click(more);
    await flush();
    expect(popupOpen()).toBe(false);

    fireEvent.mouseDown(more, { button: 0 });
    fireEvent.click(more);
    await flush();
    expect(popupOpen()).toBe(true);
  });

  it("closes on a mousedown anywhere else", async () => {
    const { more } = await mountTableWithToolbar();
    fireEvent.mouseDown(more, { button: 0 });
    fireEvent.click(more);
    await flush();
    expect(popupOpen()).toBe(true);

    fireEvent.mouseDown(document.body, { button: 0 });
    await flush();

    expect(popupOpen()).toBe(false);
  });
});
