// §377 The picker's keys, search, sections and tabs, against the real data.
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  _resetEmojiCache,
  ensureEmojiLoaded,
} from "../../../extensions/plugins/emoji-data";
import { SYMBOL_CATEGORIES } from "../../../extensions/plugins/symbol-data";
import { EMOJI_SECTIONS } from "../../../extensions/plugins/symbol-sections";
import enCatalog from "../../../i18n/en.json";
import koCatalog from "../../../i18n/ko.json";
import { useSettingsStore } from "../../../stores/settings/store";
import { SymbolPicker } from "../SymbolPicker";

// Loaded before every test, so no load lands mid-test outside act() — the one
// test that starts without it resets the cache itself.
beforeEach(async () => {
  await ensureEmojiLoaded();
  useSettingsStore.setState({ locale: "en", recentSymbols: [] });
});

function setup() {
  const onCancel = vi.fn();
  const onPick = vi.fn();
  render(<SymbolPicker onCancel={onCancel} onPick={onPick} />);
  const search = screen.getByRole("textbox");
  const press = (
    key: string,
    init: KeyboardEventInit & { keyCode?: number } = {},
  ) => fireEvent.keyDown(search, { key, ...init });
  const selectedElement = () =>
    screen
      .queryAllByRole("option")
      .find((o) => o.getAttribute("aria-selected") === "true");
  const selected = () => selectedElement()?.textContent;
  return { onCancel, onPick, press, search, selected, selectedElement };
}

const titles = () =>
  [...document.querySelectorAll(".symbol-picker-section-title")].map(
    (el) => el.textContent,
  );

describe("SymbolPicker", () => {
  it("focuses the search box and highlights the first symbol", () => {
    const { search, selected } = setup();
    expect(document.activeElement).toBe(search);
    expect(selected()).toBe("→");
    expect(screen.getByText("right arrow")).toBeTruthy(); // footer
  });

  it("draws the symbol headings, then the emoji groups", () => {
    setup();
    expect(titles()).toEqual([
      "Arrows",
      "Math",
      "Currency",
      "Punctuation",
      "Marks & shapes",
      "Other symbols",
      "Smileys & emotion",
      "People & body",
      "Animals & nature",
      "Food & drink",
      "Travel & places",
      "Activities",
      "Objects",
      "Emoji symbols",
      "Flags",
    ]);
  });

  it("puts recent picks first, skipping characters the data does not have", () => {
    useSettingsStore.setState({ recentSymbols: ["😄", "not-a-symbol", "→"] });
    setup();
    expect(titles()[0]).toBe("Recently used");
    const chars = screen.getAllByRole("option").map((o) => o.textContent);
    expect(chars.slice(0, 2)).toEqual(["😄", "→"]);
  });

  it("labels headings and cells in Korean for a Korean interface", () => {
    useSettingsStore.setState({ locale: "ko" });
    setup();
    expect(titles()[0]).toBe("화살표");
    expect(screen.getByText("오른쪽 화살표")).toBeTruthy();
  });

  it("moves with the arrow keys and picks with Enter", () => {
    const { onPick, press, selected, selectedElement } = setup();
    press("ArrowRight");
    expect(selected()).toBe("←");
    // The highlight is a real class, not just a footer update — regression
    // pin for the template-literal bug prettier-plugin-tailwindcss
    // introduced (it strips the leading space before an interpolated class).
    expect(
      selectedElement()?.classList.contains("symbol-picker-cell-selected"),
    ).toBe(true);
    expect(selectedElement()?.classList.contains("btn-unstyled")).toBe(true);
    press("ArrowDown"); // arrows fill one row of 8; the next row is Math's
    expect(selected()).toBe("≥");
    press("ArrowUp");
    expect(selected()).toBe("←");
    press("ArrowLeft");
    press("ArrowLeft"); // at the first cell: stays
    expect(selected()).toBe("→");
    press("Enter");
    expect(onPick).toHaveBeenCalledWith("→");
  });

  it("leaves an arrow with a modifier to the search box, and stops it there", () => {
    // Positive twins: "x" below reaches the window listener, so the "never
    // reaches it" assertion can fail; and a plain ArrowRight, last, moves the
    // highlight (as in "moves with the arrow keys and picks with Enter").
    const { press, selected } = setup();
    const outside = vi.fn();
    window.addEventListener("keydown", outside);
    const prevented = (
      ["altKey", "ctrlKey", "metaKey", "shiftKey"] as const
    ).map((modifier) => !press("ArrowRight", { [modifier]: true }));
    const afterModified = selected();
    press("x"); // not the picker's key — reaches the window
    press("ArrowRight");
    window.removeEventListener("keydown", outside);
    expect(prevented).toEqual([false, false, false, false]);
    // No modified arrow reaches the window — where use-global-keyboard.ts's
    // listener would navigate back/forward on Alt+←/→ behind the picker.
    expect(outside.mock.calls.map(([e]) => (e as KeyboardEvent).key)).toEqual([
      "x",
    ]);
    expect(afterModified).toBe("→");
    expect(selected()).toBe("←");
  });

  it("leaves Enter to an IME that is composing, and picks once it is not", () => {
    const { onPick, press } = setup();
    press("Enter", { isComposing: true });
    press("Enter", { keyCode: 229 });
    expect(onPick).not.toHaveBeenCalled();
    press("Enter");
    expect(onPick).toHaveBeenCalledTimes(1);
  });

  it("cancels on Escape, and a key it used goes no further", () => {
    const { onCancel, press } = setup();
    const outside = vi.fn();
    window.addEventListener("keydown", outside);
    press("x"); // not the picker's key — reaches the window
    press("Escape");
    window.removeEventListener("keydown", outside);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(outside.mock.calls.map(([e]) => (e as KeyboardEvent).key)).toEqual([
      "x",
    ]);
  });

  it("keeps Tab in the search box", () => {
    const { onPick, press } = setup();
    expect(press("Tab")).toBe(false); // default prevented
    expect(onPick).not.toHaveBeenCalled();
  });

  it("replaces the sections with ranked results while searching", () => {
    const { search, selected } = setup();
    fireEvent.change(search, { target: { value: "heart" } });
    expect(titles()).toEqual([]);
    expect(selected()).toBe("❤️");
    const tabs = [
      ...document.querySelectorAll<HTMLButtonElement>(".symbol-picker-tab"),
    ];
    expect(tabs).toHaveLength(11);
    expect(
      tabs.every((tab) => tab.getAttribute("aria-disabled") === "true"),
    ).toBe(true);
    // A disabled tab's click does nothing — the selection stays on the
    // search result, not the section the tab would otherwise jump to.
    fireEvent.click(screen.getByRole("button", { name: "Flags" }));
    expect(selected()).toBe("❤️");
  });

  it("says so when nothing matches, and Enter picks nothing", () => {
    const { onPick, press, search } = setup();
    fireEvent.change(search, { target: { value: "zzzq" } });
    expect(screen.getByText("No matching symbols")).toBeTruthy();
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    press("Enter");
    expect(onPick).not.toHaveBeenCalled();
  });

  it("jumps to a section from its tab", () => {
    const { selected } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Flags" }));
    expect(selected()).toBe("🏁");
  });

  it("disables the recent tab while nothing was picked", () => {
    setup();
    expect(
      screen
        .getByRole("button", { name: "Recently used" })
        .getAttribute("aria-disabled"),
    ).toBe("true");
  });

  it("enables the recent tab once something was picked", () => {
    useSettingsStore.setState({ recentSymbols: ["→"] });
    setup();
    expect(
      screen
        .getByRole("button", { name: "Recently used" })
        .getAttribute("aria-disabled"),
    ).toBe("false");
  });

  it("keeps focus in the search box on mousedown anywhere else in the dialog", () => {
    const { search } = setup();
    const title = document.querySelector(".symbol-picker-section-title")!;
    const disabledTab = screen.getByRole("button", { name: "Recently used" });
    expect(fireEvent.mouseDown(title)).toBe(false); // default prevented
    expect(fireEvent.mouseDown(disabledTab)).toBe(false); // default prevented
    expect(fireEvent.mouseDown(search)).toBe(true); // not prevented
  });

  it("highlights the cell under the pointer and picks the one clicked", () => {
    const { onPick, selected } = setup();
    // The curated ← and the generated emoji ⬅️ (group 8, emojibase-data
    // 17.0.0) share the English label "left arrow" — real data, not a
    // component defect. Curated sections render before emoji sections (see
    // "draws the symbol headings, then the emoji groups" above), so [0] is
    // always ←.
    const [left] = screen.getAllByRole("option", { name: "left arrow" });
    fireEvent.mouseEnter(left);
    expect(selected()).toBe("←");
    fireEvent.click(left);
    expect(onPick).toHaveBeenCalledWith("←");
  });

  it("has a label for every section in both catalogs", () => {
    const ids = [
      "recent",
      ...SYMBOL_CATEGORIES,
      ...EMOJI_SECTIONS.map((s) => s.id),
    ];
    const en = enCatalog as Record<string, string>;
    const ko = koCatalog as Record<string, string>;
    for (const id of ids) {
      expect(en[`symbolPicker.section.${id}`], id).toBeTruthy();
      expect(ko[`symbolPicker.section.${id}`], id).toBeTruthy();
    }
  });

  it("shows the emoji once the table has loaded", async () => {
    _resetEmojiCache();
    setup();
    expect(titles()).not.toContain("Smileys & emotion");
    expect(await screen.findByText("Smileys & emotion")).toBeTruthy();
  });
});
