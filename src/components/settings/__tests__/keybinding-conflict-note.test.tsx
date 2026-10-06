import type { MergedKeybinding } from "../../../keybindings/use-keybindings";

// §391 plan 0118 P13 — the conflict note puts a plugin's title into the message template as text.
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import en from "../../../i18n/en.json";
import { pluginKeybindingEntries } from "../../../keybindings/plugin-keybindings";
import { KeybindingConflictNote } from "../tabs/keybinding-conflict-note";

const t = (key: string) => (en as Record<string, string>)[key] ?? key;

describe("KeybindingConflictNote — plugin titles are text, not replacement patterns (P13)", () => {
  // `$'` in a string replacement means "the text after the match" — a function replacer keeps it.
  const [entry] = pluginKeybindingEntries({
    cite: {
      commands: [{ id: "a", title: "$'" }],
      menu: [],
      name: "Cite",
      pluginId: "cite",
      slash: [],
    },
  });
  const conflict = {
    entry: { ...entry, activeKey: "Mod+Alt+K", isOverridden: true },
    kind: "entry",
  } as { entry: MergedKeybinding; kind: "entry" };

  it("draws the title literally", () => {
    const { container } = render(
      <KeybindingConflictNote conflict={conflict} refused={false} t={t} />,
    );
    expect(container.textContent).toBe(
      en["keybindings.conflict"].replace("{command}", () => "$'"),
    );
    expect(container.textContent).toContain(`"$'"`);
  });

  it("does the same in the refusal template", () => {
    const { container } = render(
      <KeybindingConflictNote conflict={conflict} refused t={t} />,
    );
    expect(container.textContent).toContain(`"$'"`);
  });
});
