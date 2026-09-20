// §260 Phase 4c — the form is the only place a settings VALUE is created, so what it
// writes is what every later stage has to survive.
import type {
  InstalledPlugin,
  PluginSettingField,
} from "../../../plugins/types";

import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { usePluginStore } from "../../../stores/system/plugin";
import { PluginSettingsForm } from "../PluginSettingsForm";
import { SETTING_COLOR_SWATCHES } from "../setting-color-swatches";

const install = (
  settings: PluginSettingField[],
  capabilities: InstalledPlugin["manifest"]["capabilities"] = ["settings"],
): void => {
  usePluginStore.setState({
    installedPlugins: {
      "p-1": {
        checksum: "",
        enabled: true,
        installedAt: 0,
        installPath: "/p",
        manifest: {
          author: "",
          capabilities,
          contributions: { settings },
          description: "",
          engines: { baram: "*" },
          id: "p-1",
          license: "MIT",
          main: "index.mjs",
          name: "P",
          trust: "sandboxed",
          version: "1.0.0",
        },
        updatedAt: 0,
      },
    },
    pluginSettings: {},
  });
};

const valuesOf = (pluginId: string) =>
  usePluginStore.getState().pluginSettings[pluginId];

describe("PluginSettingsForm", () => {
  beforeEach(() => {
    usePluginStore.setState({
      devPlugins: {},
      installedPlugins: {},
      pluginSettings: {},
    });
  });

  it("renders one row per declared field, showing resolved values", () => {
    install([
      { default: true, key: "compact", label: "Compact", type: "boolean" },
      { default: 3, key: "depth", label: "Depth", type: "number" },
      { default: "»", key: "prefix", label: "Prefix", type: "string" },
    ]);
    render(<PluginSettingsForm pluginId="p-1" />);
    expect(screen.getByText("Settings")).toBeTruthy();
    expect((screen.getByLabelText("Compact") as HTMLInputElement).checked).toBe(
      true,
    );
    expect((screen.getByLabelText("Depth") as HTMLInputElement).value).toBe(
      "3",
    );
    expect((screen.getByLabelText("Prefix") as HTMLInputElement).value).toBe(
      "»",
    );
  });

  it("writes each type as its own type, not as a string", () => {
    // The whole value model depends on `typeof value === field.type`, and an
    // `e.target.value` straight from a number input is a string.
    install([
      { default: false, key: "compact", label: "Compact", type: "boolean" },
      { default: 3, key: "depth", label: "Depth", type: "number" },
    ]);
    render(<PluginSettingsForm pluginId="p-1" />);
    fireEvent.click(screen.getByLabelText("Compact"));
    fireEvent.change(screen.getByLabelText("Depth"), {
      target: { value: "12" },
    });
    expect(valuesOf("p-1")).toEqual({ compact: true, depth: 12 });
  });

  it("lets a number field be cleared and retyped without snapping back", () => {
    // A controlled input backed by the store would restore the old value the instant the
    // box went empty, so the field could never be retyped.
    install([{ default: 3, key: "depth", label: "Depth", type: "number" }]);
    render(<PluginSettingsForm pluginId="p-1" />);
    const input = screen.getByLabelText("Depth") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "" } });
    expect(input.value).toBe("");
    // …and an empty box commits nothing, so no `null` reaches the persisted record.
    expect(valuesOf("p-1")).toBeUndefined();
    fireEvent.change(input, { target: { value: "40" } });
    expect(valuesOf("p-1")).toEqual({ depth: 40 });
  });

  it("renders nothing without the settings capability", () => {
    // Same rule as the status bar: a manifest must not buy space in the app's chrome with
    // a permission the install dialog never showed — and the plugin could not read the
    // value anyway, so the control would be dead.
    install([{ key: "prefix", label: "Prefix", type: "string" }], ["commands"]);
    expect(
      render(<PluginSettingsForm pluginId="p-1" />).container.textContent,
    ).toBe("");
  });

  it("renders nothing for a plugin that is not installed or declares no fields", () => {
    expect(
      render(<PluginSettingsForm pluginId="absent" />).container.textContent,
    ).toBe("");
    install([]);
    expect(
      render(<PluginSettingsForm pluginId="p-1" />).container.textContent,
    ).toBe("");
  });

  it("shows a label that would otherwise break the row, flattened and capped", () => {
    // ‼️ The identity `normalizer` is what makes this test able to fail. Testing Library
    // collapses whitespace before matching, so `getByText("Two lines")` passes on the
    // UNSANITISED "Two\nlines" too — mutation-testing the sanitiser is what caught that.
    install([
      { key: "k", label: "Two\nlines", type: "string" },
      { key: "long", label: "L".repeat(200), type: "string" },
    ]);
    render(<PluginSettingsForm pluginId="p-1" />);
    expect(
      screen.getByText("Two lines", { normalizer: (s) => s }),
    ).toBeTruthy();
    expect(
      screen.getByText(/^L+…$/, { normalizer: (s) => s }).textContent,
    ).toHaveLength(80);
  });

  it("re-renders when the manifest is replaced (dev reload)", () => {
    // ‼️ dev 플러그인 "다시 로드"는 `addDevPlugin(fresh)`로 매니페스트를 갈아끼운다.
    // 비반응 `getState()` 조회였다면 열려 있는 폼이 낡은 필드를 계속 보여준다.
    install([{ default: "", key: "old", label: "Old Field", type: "string" }]);
    render(<PluginSettingsForm pluginId="p-1" />);
    expect(screen.getByText("Old Field")).toBeTruthy();

    act(() => {
      install([
        { default: "", key: "new", label: "New Field", type: "string" },
      ]);
    });
    expect(screen.getByText("New Field")).toBeTruthy();
    expect(screen.queryByText("Old Field")).toBeNull();
  });
});

// §0054 — the controls the new field shapes call for.
describe("PluginSettingsForm — field affordances (§0054)", () => {
  beforeEach(() => {
    usePluginStore.setState({
      devPlugins: {},
      installedPlugins: {},
      pluginSettings: {},
    });
  });

  it("shows a field's description under its label", () => {
    // The sentence that used to be exiled to the plugin's README, where the person
    // changing the value never sees it.
    install([
      {
        default: "»",
        description: "Shown before every line",
        key: "prefix",
        label: "Prefix",
        type: "string",
      },
    ]);
    render(<PluginSettingsForm pluginId="p-1" />);
    expect(screen.getByText("Shown before every line")).toBeTruthy();
  });

  it("puts min and max on a number input", () => {
    // Not a gate — a typed value outside the range still reaches the resolver, which is
    // what refuses it. These are what make the stepper obey the range and what a screen
    // reader announces.
    install([
      {
        default: 2,
        key: "w",
        label: "Width",
        max: 8,
        min: 0.5,
        type: "number",
      },
    ]);
    render(<PluginSettingsForm pluginId="p-1" />);
    const input = screen.getByRole("spinbutton") as HTMLInputElement;
    expect(input.min).toBe("0.5");
    expect(input.max).toBe("8");
  });

  it("renders an enum as a select over its declared options", () => {
    install([
      {
        default: "halo",
        key: "m",
        label: "Marker",
        options: [
          { label: "Halo", value: "halo" },
          { label: "Filled", value: "filled" },
        ],
        type: "enum",
      },
    ]);
    render(<PluginSettingsForm pluginId="p-1" />);
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.value).toBe("halo");
    expect([...select.options].map((o) => o.textContent)).toEqual([
      "Halo",
      "Filled",
    ]);

    act(() => {
      fireEvent.change(select, { target: { value: "filled" } });
    });
    expect(valuesOf("p-1")).toEqual({ m: "filled" });
  });

  it("offers recommended colours as swatches that write a THEME TOKEN", () => {
    // ‼️ The stored value is `var(--color-…)`, not a resolved hex. That is the entire
    // point of the swatch: a hex would stop following the theme, which is also why there
    // is no `<input type="color">` beside it — that control cannot hold a token.
    install([
      {
        default: "var(--color-accent-default)",
        key: "c",
        label: "Colour",
        type: "color",
      },
    ]);
    render(<PluginSettingsForm pluginId="p-1" />);
    const swatches = screen.getAllByRole("button");
    expect(swatches.length).toBe(SETTING_COLOR_SWATCHES.length);
    // The one holding the current value reports itself as pressed…
    expect(
      swatches.filter((b) => b.getAttribute("aria-pressed") === "true").length,
    ).toBe(1);

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /danger/iu }));
    });
    expect(valuesOf("p-1")).toEqual({ c: "var(--color-status-danger)" });
  });

  it("selects no swatch for a hand-typed colour", () => {
    // Correct rather than tidy: none of the eight is what the field holds.
    install([{ default: "#123456", key: "c", label: "Colour", type: "color" }]);
    render(<PluginSettingsForm pluginId="p-1" />);
    expect(
      screen
        .getAllByRole("button")
        .filter((b) => b.getAttribute("aria-pressed") === "true"),
    ).toEqual([]);
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe(
      "#123456",
    );
  });
});

// §0054 code review (MEDIUM) — the number draft against a bounded field.
//
// The existing draft tests use a field with no `min`/`max`, so neither case below was pinned.
// Both are Bullet Threading's real `lineWidth`: min 0.5, max 8, default 2.
describe("PluginSettingsForm — a bounded number field", () => {
  const bounded = () =>
    install([
      {
        default: 2,
        key: "w",
        label: "Width",
        max: 8,
        min: 0.5,
        type: "number",
      },
    ]);

  beforeEach(() => {
    usePluginStore.setState({
      devPlugins: {},
      installedPlugins: {},
      pluginSettings: {},
    });
  });

  it("lets a value below the minimum be typed THROUGH on the way to a valid one", () => {
    // ‼️ `0.5` starts with `0`, which is below the minimum. Committing that intermediate
    // made the resolver fall back to the default, which CHANGED the resolved value, which
    // fired the resync effect and rewrote the box to "2" under the user's fingers — so the
    // next keystrokes produced "2.5" and 0.5 was unreachable. State-dependent, too: from the
    // default it worked, because the resolved value never moved.
    bounded();
    usePluginStore.getState().setPluginSetting("p-1", "w", 3);
    render(<PluginSettingsForm pluginId="p-1" />);
    const input = screen.getByRole("spinbutton") as HTMLInputElement;

    act(() => {
      fireEvent.change(input, { target: { value: "0" } });
    });
    expect(input.value, "the box was rewritten mid-typing").toBe("0");

    act(() => {
      fireEvent.change(input, { target: { value: "0.5" } });
    });
    expect(valuesOf("p-1")).toEqual({ w: 0.5 });
  });

  it("never persists a value the resolver would refuse", () => {
    // Otherwise the box reads 9, the store holds 9, the plugin is told 2, and nothing says
    // so — the disagreement is only visible by reopening the pane.
    bounded();
    render(<PluginSettingsForm pluginId="p-1" />);
    const input = screen.getByRole("spinbutton") as HTMLInputElement;

    act(() => {
      fireEvent.change(input, { target: { value: "9" } });
    });
    expect(usePluginStore.getState().pluginSettings["p-1"]?.w).not.toBe(9);
    // …and the control says it is refusing, rather than looking accepted.
    expect(input.getAttribute("aria-invalid")).toBe("true");

    act(() => {
      fireEvent.change(input, { target: { value: "8" } });
    });
    expect(valuesOf("p-1")).toEqual({ w: 8 }); // inclusive, and the flag clears
    expect(input.getAttribute("aria-invalid")).toBe("false");
  });
});
