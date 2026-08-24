// §69 — 액션 세트가 `source`에서 파생되는지 행 단위로 고정한다.
import type { PluginRow } from "../../../plugins/plugin-sources";
import type { PluginManifest } from "../../../plugins/types";

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PluginRowView } from "../PluginRow";

/** 철회 목록의 한 항목. `malicious`라야 알림이 제거 버튼까지 그린다. */
const REVOKED = {
  id: "x",
  reason: "steals things",
  severity: "malicious" as const,
  versions: "*" as const,
};

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

/**
 * 행이 그린 모든 조작 요소를, ARIA role 목록이 아니라 SELECTOR로 모은다.
 *
 * ‼️ 아래 "every rendered control" 속성이 썩은 원인이 정확히 role 목록이었다:
 * `getAllByRole("button")`은 `<input type="checkbox">`를 조용히 제외하므로, 이름이 없던
 * 유일한 조작 요소인 토글이 애초에 검사 대상 집합에 든 적이 없었다. role 목록은 다음에
 * 추가될 조작 요소를 기본값으로 통과시키는 denylist다. 셀렉터는 아무것도 통과시키지 않는다.
 */
const CONTROLS = "a[href], button, input, select, textarea";

/**
 * 이 행이 실제로 쓰는 두 형태의 접근 가능한 이름: 명시적 `aria-label`, 그리고 감싸는
 * `<label>`의 텍스트(체크박스의 "On"/"Off"가 여기서 나왔다). accname 알고리즘 전체가
 * 아니라, 두 형태를 모두 비교한다는 점이 핵심이다 — `getAllByRole` 질의가 못 하던 것이다.
 */
function accessibleName(el: Element): string {
  return (
    el.getAttribute("aria-label") ??
    el.closest("label")?.textContent ??
    el.textContent ??
    ""
  );
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
  // `handlers`가 모듈 스코프에서 공유되므로 호출 횟수 단정이 실행 순서에 걸리지 않게 한다.
  beforeEach(() => {
    vi.clearAllMocks();
  });

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

  it("warns a built-in about a withdrawal without offering to remove it", () => {
    // ‼️ 오늘 도달할 수 없는 조합이고, 그것이 바로 요점이다: `buildPluginRows`가 내장 행에
    // `revocation`을 붙이지 않는다는 사실과 알림이 null을 반환한다는 사실, 그 두 우연이
    // 규칙을 대신 지키고 있었다. 여기서는 `actionsFor`가 지킨다.
    //
    // 경고 자체는 남는다 — 제거할 수 없다는 것이 알 필요가 없다는 뜻은 아니다.
    render(
      <PluginRowView
        row={row({ revocation: REVOKED, source: "builtin" })}
        {...handlers}
      />,
    );
    expect(
      screen.getByText("This plugin has been withdrawn and is not running."),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Remove it" })).toBeNull();
  });

  it("offers it to a community plugin, which can remove", () => {
    // 보완 단정: 위 단정만으로는 알림에서 버튼을 통째로 지운 구현도 통과한다.
    render(
      <PluginRowView
        row={row({ revocation: REVOKED, source: "community" })}
        {...handlers}
      />,
    );
    const button = screen.getByRole("button", { name: "Remove it" });
    fireEvent.click(button);
    expect(handlers.onRemove).toHaveBeenCalledTimes(1);
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
    ["a built-in row (Details, toggle)", row({ source: "builtin" }), handlers],
    ["a dev row (Details, Reload, Remove)", row({ source: "dev" }), handlers],
  ])(
    "names the plugin in every rendered control's accessible name — %s",
    (_label, r, h) => {
      // ‼️ `unnamed === []`, not `named > 0`: the weaker form would still pass if a
      // regression dropped the plugin's name from every control but one. Parametrised
      // over the row shapes that add more controls (update offered, settings wired up,
      // each source's own set) so the property holds as the row grows.
      const { container } = render(<PluginRowView row={r} {...h} />);
      const controls = Array.from(container.querySelectorAll(CONTROLS));
      expect(controls.length).toBeGreaterThan(0);
      // Reported as the list of offenders, so a failure names the control it found.
      expect(
        controls
          .filter((el) => !/Ex/.test(accessibleName(el)))
          .map((el) => el.tagName.toLowerCase() + ": " + accessibleName(el)),
      ).toEqual([]);
    },
  );
});
