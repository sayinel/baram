// §69 — 액션 세트가 `source`에서 파생되는지 행 단위로 고정한다.
import type { PluginRow } from "../../../plugins/plugin-sources";
import type { PluginManifest } from "../../../plugins/types";

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PluginRowView } from "../PluginRow";

function row(over: Partial<PluginRow>): PluginRow {
  return {
    enabled: true,
    manifest: {
      author: "T",
      capabilities: [],
      description: "d",
      engines: { baram: "*" },
      id: "x",
      license: "MIT",
      main: "index.mjs",
      name: "Ex",
      trust: "sandboxed",
      version: "1.0.0",
    } as PluginManifest,
    source: "community",
    ...over,
  };
}

/** `onSettings`는 의도적으로 빠져 있다 — optional prop이고, 넘기지 않는 것이 PR1의 상태다. */
const handlers = {
  onDetails: vi.fn(),
  onReload: vi.fn(),
  onRemove: vi.fn(),
  onToggle: vi.fn(),
  onUpdate: vi.fn(),
};

describe("PluginRowView (§69)", () => {
  it("gives a built-in a toggle and no remove button", () => {
    render(<PluginRowView row={row({ source: "builtin" })} {...handlers} />);
    expect(screen.getByRole("checkbox")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /remove/i })).toBeNull();
  });

  it("gives a community plugin a remove button", () => {
    render(<PluginRowView row={row({ source: "community" })} {...handlers} />);
    expect(screen.getByRole("button", { name: /remove/i })).toBeTruthy();
  });

  it("gives a dev plugin reload and no toggle", () => {
    render(<PluginRowView row={row({ source: "dev" })} {...handlers} />);
    expect(screen.getByRole("button", { name: /reload/i })).toBeTruthy();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("shows an update button only when a version is offered", () => {
    const { rerender } = render(<PluginRowView row={row({})} {...handlers} />);
    expect(screen.queryByRole("button", { name: /update/i })).toBeNull();
    rerender(
      <PluginRowView row={row({ updateVersion: "2.0.0" })} {...handlers} />,
    );
    expect(screen.getByRole("button", { name: /update/i })).toBeTruthy();
  });

  it("never offers a built-in an update, even if one is somehow set", () => {
    // canUpdate가 source에서 파생된다는 것을 고정한다 — updateVersion만 보고 그리면 안 된다.
    render(
      <PluginRowView
        row={row({ source: "builtin", updateVersion: "2.0.0" })}
        {...handlers}
      />,
    );
    expect(screen.queryByRole("button", { name: /update/i })).toBeNull();
  });

  it("omits the settings button when no onSettings is given", () => {
    // ‼️ PR1의 상태. 부재를 no-op 콜백으로 위장하지 않는다 (사용자 결정 2026-08-06).
    render(<PluginRowView row={row({})} {...handlers} />);
    expect(screen.queryByRole("button", { name: /settings/i })).toBeNull();
  });

  it("shows the settings button when onSettings is given", () => {
    const onSettings = vi.fn();
    render(
      <PluginRowView onSettings={onSettings} row={row({})} {...handlers} />,
    );
    expect(screen.getByRole("button", { name: /settings/i })).toBeTruthy();
  });

  it.each([
    ["a default community row (Details, Remove)", row({}), handlers],
    [
      "a row with an update offered (adds Update)",
      row({ updateVersion: "2.0.0" }),
      handlers,
    ],
    [
      "a row with onSettings passed (adds Settings)",
      row({}),
      { ...handlers, onSettings: vi.fn() },
    ],
  ])(
    "names the plugin in every rendered control's accessible name — %s",
    (_label, r, h) => {
      // ‼️ `named === all`, not `named > 0`: the weaker form would still pass if a
      // regression dropped the plugin's name from every button but one. Parametrised
      // over the row shapes that add more controls (update offered, settings wired up)
      // so the property holds as the row grows, not just for the two-button default.
      render(<PluginRowView row={r} {...h} />);
      const all = screen.getAllByRole("button").length;
      const named = screen.getAllByRole("button", { name: /Ex/ }).length;
      expect(all).toBeGreaterThan(0);
      expect(named).toBe(all);
    },
  );
});
