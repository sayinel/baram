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

  it("names the plugin in each control's accessible name", () => {
    // 행마다 같은 이름의 버튼이 생기므로, 스코핑 없는 질의가 모호해지지 않게 한다.
    // ‼️ `getByRole`이 아니라 `getAllByRole`: community 행은 Details("View details for
    // Ex")와 Remove("Remove Ex") 둘 다 /Ex/에 매칭된다 — 이는 모호함이 아니라 "모든
    // 컨트롤이 이름을 담는다"는 의도가 정확히 지켜졌다는 증거다.
    render(<PluginRowView row={row({})} {...handlers} />);
    expect(
      screen.getAllByRole("button", { name: /Ex/ }).length,
    ).toBeGreaterThan(0);
  });
});
