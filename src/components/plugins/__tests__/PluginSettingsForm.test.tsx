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
