// The Formatting category of the keybindings tab rendered its raw i18n keys — every row read
// `keybindings.formatting.bold` instead of a command name. The registry labels its entries
// `keybindings.formatting.*`; the locale files defined `keybindings.fmt.*`, referenced by
// nothing. `t()` falls back to the key when neither locale has it, so the defect was visible
// in both languages and silent to the en↔ko parity guard.
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { KEYBINDING_REGISTRY } from "../../../keybindings/keybinding-registry";
import { useSettingsStore } from "../../../stores/settings/store";
import { KeybindingsTab } from "../tabs/KeybindingsTab";

const originalLocale = useSettingsStore.getState().locale;

afterEach(() => {
  useSettingsStore.setState({ locale: originalLocale });
});

describe("KeybindingsTab — Formatting category", () => {
  it("renders no raw i18n key for any registry entry", () => {
    for (const locale of ["en", "ko"]) {
      useSettingsStore.setState({ locale });
      const { unmount } = render(<KeybindingsTab />);

      const rendered = [...document.querySelectorAll(".keybinding-label")].map(
        (n) => n.textContent ?? "",
      );
      expect(rendered.length).toBe(KEYBINDING_REGISTRY.length);
      expect(
        rendered.filter((text) => text.startsWith("keybindings.")),
      ).toEqual([]);
      unmount();
    }
  });

  it("names the Formatting commands in Korean", () => {
    useSettingsStore.setState({ locale: "ko" });
    render(<KeybindingsTab />);

    expect(screen.getByText("서식")).toBeInTheDocument(); // section header
    for (const label of [
      "굵게",
      "기울임",
      "인용문",
      "표 셀 병합",
      "토글 블록",
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });
});
