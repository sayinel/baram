// §69 — 섹션 그룹. 단정은 섹션 안으로 스코핑한다: 전역 부재 단정은 같은 목록의 다른
// 섹션이 그 버튼을 갖고 있어서 결과가 뒤집힌다.
import type { PluginRow } from "../../../plugins/plugin-sources";
import type { PluginManifest } from "../../../plugins/types";

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PluginInstalledList } from "../PluginInstalledList";

function row(
  id: string,
  source: PluginRow["source"],
  over: Partial<PluginRow> = {},
): PluginRow {
  return {
    enabled: true,
    manifest: {
      author: "T",
      capabilities: [],
      description: "d",
      engines: { baram: "*" },
      id,
      license: "MIT",
      main: "index.mjs",
      name: id,
      trust: "sandboxed",
      version: "1.0.0",
    } as PluginManifest,
    source,
    ...over,
  };
}

/** `hasSettings`/`onSettings`는 빼 둔다 — optional이고, PR1은 넘기지 않는다. */
const handlers = {
  onDetails: vi.fn(),
  onReload: vi.fn(),
  onRemove: vi.fn(),
  onToggle: vi.fn(),
  onUpdate: vi.fn(),
};

const ROWS = [
  row("bi", "builtin"),
  row("cm", "community", { updateVersion: "2.0.0" }),
  row("dv", "dev"),
];

describe("PluginInstalledList (§69)", () => {
  it("renders the sections in order: builtin, community, dev", () => {
    render(<PluginInstalledList rows={ROWS} {...handlers} />);
    // ‼️ not /^plugin-section-/ alone — that also matches the count spans'
    // `plugin-section-count-{source}` testid, since it starts with the same prefix.
    const sections = screen.getAllByTestId(/^plugin-section-(?!count-)/);
    expect(sections.map((s) => s.dataset.testid)).toEqual([
      "plugin-section-builtin",
      "plugin-section-community",
      "plugin-section-dev",
    ]);
  });

  it("has no remove or update control INSIDE the built-in section", () => {
    // ‼️ 전역 queryByRole("button", {name:/remove/i}) 금지 — 커뮤니티 행이 갖고 있다.
    render(<PluginInstalledList rows={ROWS} {...handlers} />);
    const builtin = screen.getByTestId("plugin-section-builtin");
    expect(
      within(builtin).queryAllByRole("button", { name: /remove/i }),
    ).toHaveLength(0);
    expect(
      within(builtin).queryAllByRole("button", { name: /update/i }),
    ).toHaveLength(0);
    expect(within(builtin).getAllByRole("checkbox")).toHaveLength(1);
  });

  it("has exactly one remove and one update inside the community section", () => {
    render(<PluginInstalledList rows={ROWS} {...handlers} />);
    const community = screen.getByTestId("plugin-section-community");
    expect(
      within(community).getAllByRole("button", { name: /remove/i }),
    ).toHaveLength(1);
    expect(
      within(community).getAllByRole("button", { name: /update/i }),
    ).toHaveLength(1);
  });

  it("has no toggle inside the dev section", () => {
    render(<PluginInstalledList rows={ROWS} {...handlers} />);
    const dev = screen.getByTestId("plugin-section-dev");
    expect(within(dev).queryAllByRole("checkbox")).toHaveLength(0);
    expect(
      within(dev).getAllByRole("button", { name: /reload/i }),
    ).toHaveLength(1);
  });

  it("omits an empty builtin or community section", () => {
    render(<PluginInstalledList rows={[row("dv", "dev")]} {...handlers} />);
    expect(screen.queryByTestId("plugin-section-builtin")).toBeNull();
    expect(screen.queryByTestId("plugin-section-community")).toBeNull();
  });

  it("counts the rows in each section heading", () => {
    // ‼️ 카운트에는 자체 testid가 있다 (계획 수정, 2026-08-06). 앞선 초안은
    // `within(builtin).getByText(/1/)`이었는데, 섹션 안의 행이 `v1.0.0`을 포함하므로
    // 복수 매치로 던진다. 헤더 텍스트 전체를 보는 것도 안 된다 — textContent가
    // "▾Built-in1"로 붙어 `\b1\b`가 성립하지 않는다.
    render(<PluginInstalledList rows={ROWS} {...handlers} />);
    expect(screen.getByTestId("plugin-section-count-builtin").textContent).toBe(
      "1",
    );
    expect(
      screen.getByTestId("plugin-section-count-community").textContent,
    ).toBe("1");
  });

  it("shows no gear at all when the settings props are absent", () => {
    // ‼️ PR1의 상태 (사용자 결정 2026-08-06).
    render(<PluginInstalledList rows={ROWS} {...handlers} />);
    expect(screen.queryAllByRole("button", { name: /settings/i })).toHaveLength(
      0,
    );
  });

  it("shows a gear only for the rows hasSettings admits", () => {
    render(
      <PluginInstalledList
        hasSettings={(id) => id === "cm"}
        onSettings={vi.fn()}
        rows={ROWS}
        {...handlers}
      />,
    );
    expect(
      within(screen.getByTestId("plugin-section-community")).getAllByRole(
        "button",
        { name: /settings/i },
      ),
    ).toHaveLength(1);
    expect(
      within(screen.getByTestId("plugin-section-builtin")).queryAllByRole(
        "button",
        { name: /settings/i },
      ),
    ).toHaveLength(0);
  });
});
