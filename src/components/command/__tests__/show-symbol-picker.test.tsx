// §377 The picker's mount: settled once, focus handed back, nothing left behind.
import { act, fireEvent, screen } from "@testing-library/react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { ensureEmojiLoaded } from "../../../extensions/plugins/emoji-data";
import { useSettingsStore } from "../../../stores/settings/store";
import { showSymbolPicker } from "../show-symbol-picker";

const ANCHOR = { bottom: 20, left: 10, top: 4 };

// Loaded up front so no load lands mid-test outside act().
beforeAll(async () => {
  await ensureEmojiLoaded();
});

beforeEach(() => {
  useSettingsStore.setState({ locale: "en", recentSymbols: [] });
});

/** Elements a test put on the body, removed even when it fails midway. */
const added: HTMLElement[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const el of added.splice(0)) el.remove();
  // A test that failed before the picker settled leaves its overlay. Its React
  // root is local to showSymbolPicker and cannot be unmounted from here —
  // removing the element keeps the next test's queries off it.
  for (const el of document.querySelectorAll(".symbol-picker-overlay")) {
    el.remove();
  }
});

function open(): Promise<null | string> {
  let pending: Promise<null | string> | undefined;
  act(() => {
    pending = showSymbolPicker(ANCHOR);
  });
  if (!pending) throw new Error("showSymbolPicker returned nothing");
  return pending;
}

const overlay = () => document.querySelector(".symbol-picker-overlay");
const search = () => screen.getByRole("textbox");

describe("showSymbolPicker", () => {
  it("opens with the search box focused and hands focus back on Escape", async () => {
    const before = document.createElement("button");
    added.push(before);
    document.body.append(before);
    before.focus();
    const result = open();
    expect(document.activeElement).toBe(search());
    fireEvent.keyDown(search(), { key: "Escape" });
    await expect(result).resolves.toBeNull();
    expect(overlay()).toBeNull();
    expect(document.activeElement).toBe(before);
  });

  it("resolves with the clicked character and removes itself", async () => {
    const result = open();
    // Not `{ name: "left arrow" }`: the curated ← and the emoji ⬅️ share that
    // English label, so the query would match two cells (same for "right
    // arrow"). "rightwards double arrow" names only ⇒.
    fireEvent.click(
      screen.getByRole("option", { name: "rightwards double arrow" }),
    );
    await expect(result).resolves.toBe("⇒");
    expect(overlay()).toBeNull();
  });

  it("resolves with the highlighted character on Enter", async () => {
    const result = open();
    fireEvent.keyDown(search(), { key: "Enter" });
    await expect(result).resolves.toBe("→");
  });

  it("cancels on a mousedown outside the picker, not inside it", async () => {
    const result = open();
    fireEvent.mouseDown(screen.getByRole("dialog"));
    expect(overlay()).not.toBeNull();
    const backdrop = overlay();
    if (!backdrop) throw new Error("no overlay");
    fireEvent.mouseDown(backdrop);
    await expect(result).resolves.toBeNull();
    expect(overlay()).toBeNull();
  });

  it("places the picker under the anchor", async () => {
    const result = open();
    const popup = document.querySelector<HTMLElement>(".symbol-picker-popup");
    expect(popup?.style.left).toBe("10px");
    expect(popup?.style.top).toBe("24px"); // anchor bottom + 4 (positionPopup)
    fireEvent.keyDown(search(), { key: "Escape" });
    await result;
  });

  it("unmounts without a React warning", async () => {
    const error = vi.spyOn(console, "error");
    const result = open();
    fireEvent.keyDown(search(), { key: "Enter" });
    await result;
    expect(error).not.toHaveBeenCalled();
  });
});
