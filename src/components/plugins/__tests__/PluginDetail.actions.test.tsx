// §69 — 상세 화면의 액션 세트도 `actionsFor(source)` 하나에서 나온다.
//
// ‼️ 여기 있는 `source="dev"`는 오늘 도달할 수 없다 — 이 화면에 닿는 경로는 내장과
// 커뮤니티뿐이고 둘 다 토글할 수 있다. 그것이 이 파일이 있는 이유다: 세 판단 중 토글만
// `status` 분기에서 읽고 있었고(`canUpdate`·`canRemove`는 `can`을 통과한다), 그 차이는
// dev 행이 이 모델에 들어오는 순간 — 계획된 후속 작업이다 — 아무 일도 하지 않는 컨트롤로
// 도착한다. 도달 불가능한 상태를 지금 고정해 두는 것이 그 도착을 막는 유일한 방법이다.
import type { RegistryEntry } from "../../../plugins/types";

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PluginDetail } from "../PluginDetail";

const ENTRY: RegistryEntry = {
  author: "a",
  capabilities: [],
  checksum: "c",
  description: "d",
  downloadUrl: "https://example.com/p.zip",
  engines: { baram: "*" },
  id: "p",
  license: "MIT",
  name: "P",
  trust: "sandboxed",
  version: "1.0.0",
};

const noop = () => {};

function detail(source: "builtin" | "community" | "dev") {
  return render(
    <PluginDetail
      entry={ENTRY}
      onBack={noop}
      onInstall={noop}
      onToggleEnabled={noop}
      onUninstall={noop}
      onUpdate={noop}
      source={source}
      status="enabled"
      updateAvailable="2.0.0"
    />,
  );
}

describe("PluginDetail action set (§69)", () => {
  it("withholds the enable/disable button from a source that cannot toggle", () => {
    detail("dev");
    expect(screen.queryByRole("button", { name: "Enabled" })).toBeNull();
  });

  it.each(["builtin", "community"] as const)(
    "offers it to %s, which can",
    (source) => {
      // 보완 단정: 위 단정만으로는 토글을 통째로 지운 구현도 통과한다.
      detail(source);
      expect(screen.getByRole("button", { name: "Enabled" })).toBeTruthy();
    },
  );

  it.each([
    ["community", 1],
    ["builtin", 0],
  ] as const)(
    "offers Update and Uninstall to %s — %i of each",
    (source, count) => {
      // 이미 `can`을 통과하던 두 이웃. 토글이 이제 같은 자리에서 결정된다는 것을 보이려면
      // 그 이웃들이 무엇을 하는지도 같은 파일에서 보여야 한다.
      //
      // ‼️ `within(container)`로 스코핑한다: 두 source를 한 테스트에서 렌더하면 두 번째
      // 단정이 첫 번째가 남긴 DOM을 세고도 통과한다.
      const scope = within(detail(source).container);
      expect(
        scope.queryAllByRole("button", { name: "Update to v2.0.0" }),
      ).toHaveLength(count);
      expect(
        scope.queryAllByRole("button", { name: "Uninstall" }),
      ).toHaveLength(count);
    },
  );
});
