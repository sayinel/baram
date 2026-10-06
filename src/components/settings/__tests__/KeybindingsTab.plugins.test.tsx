// §391 spec 0070 §8 · §10 — plugin commands in Settings > Keybindings. Task 5 rows: the conflict
// note and the swap for a key a plugin command holds while it is not in the list.
import { fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../utils/confirm-dialog", () => ({
  showAlert: vi.fn(async () => undefined),
  showConfirm: vi.fn(async () => true),
}));

import en from "../../../i18n/en.json";
import { usePluginUIStore } from "../../../plugins/plugin-ui-store";
import { useSettingsStore } from "../../../stores/settings/store";
import { KeybindingsTab } from "../tabs/KeybindingsTab";

/** No registry entry has this default (Task 0 Step 2). jsdom is not a Mac: Mod is Ctrl. */
const FREE = "Mod+Alt+K";
const PRESS_FREE: KeyboardEventInit = {
  altKey: true,
  code: "KeyK",
  ctrlKey: true,
  key: "k",
};

beforeEach(() => {
  useSettingsStore.setState({ keybindingOverrides: {}, locale: "en" });
  usePluginUIStore.setState({ contributions: {} });
});
afterEach(() => vi.clearAllMocks());

/** The row whose label text — the first text node of `.keybinding-label` — is `label`. */
function row(label: string): HTMLElement {
  const found = [
    ...document.querySelectorAll<HTMLElement>(".keybinding-row"),
  ].find(
    (r) =>
      r.querySelector(".keybinding-label")?.firstChild?.textContent?.trim() ===
      label,
  );
  if (!found) throw new Error(`no row "${label}"`);
  return found;
}

/** Click the row's Edit, then press `init` — the tab's capture listener is on window. */
function capture(label: string, init: KeyboardEventInit = PRESS_FREE): void {
  fireEvent.click(row(label).querySelector(".keybinding-edit-btn")!);
  fireEvent.keyDown(window, init);
}

const note = (label: string) =>
  row(label).querySelector(".keybinding-conflict")?.textContent;

describe("the conflict note (§391 §8)", () => {
  it("a core↔core conflict reads as it did before", () => {
    render(<KeybindingsTab />);
    capture("Save", { code: "KeyN", ctrlKey: true, key: "n" });
    expect(note("Save")).toBe(
      en["keybindings.conflict"].replace(
        "{command}",
        en["keybindings.file.new"],
      ),
    );
  });

  it("a core command meeting the key of a plugin command not in the list: names the plugin, says confirming removes it, and does", () => {
    useSettingsStore.setState({
      keybindingOverrides: { "plugin:gone.cmd": FREE },
    });
    render(<KeybindingsTab />);
    capture("Save");
    expect(note("Save")).toBe(
      `${en["keybindings.conflict.absent"].replace("{plugin}", "gone")} ${en["keybindings.conflict.absentRemoves"]}`,
    );
    fireEvent.click(row("Save").querySelector(".keybinding-confirm-btn")!);
    expect(useSettingsStore.getState().keybindingOverrides).toEqual({
      "file.save": FREE,
    });
  });

  it("a free key shows no note and is simply assigned (the positive half)", () => {
    render(<KeybindingsTab />);
    capture("Save");
    expect(note("Save")).toBeUndefined();
    fireEvent.click(row("Save").querySelector(".keybinding-confirm-btn")!);
    expect(useSettingsStore.getState().keybindingOverrides).toEqual({
      "file.save": FREE,
    });
  });
});
