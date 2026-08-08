// §69 — 세 출처를 하나의 행 모델로 파생한다. 순서와 액션 세트를 순수 함수로 고정하는 것이
// 요점: DOM 순서 테스트보다 결정적이고, 다음 탭이 같은 판단을 되풀이할 수 없게 만든다.
import type { InstalledPlugin, PluginManifest } from "../types";

import { describe, expect, it } from "vitest";

import { actionsFor, buildPluginRows } from "../plugin-sources";

function installed(id: string, enabled: boolean): InstalledPlugin {
  return {
    checksum: "c",
    enabled,
    installedAt: 0,
    installPath: `/p/${id}`,
    manifest: manifest(id),
    updatedAt: 0,
  } as unknown as InstalledPlugin;
}

function manifest(id: string, over: Partial<PluginManifest> = {}) {
  return {
    author: "T",
    capabilities: [],
    description: "d",
    engines: { baram: "*" },
    id,
    license: "MIT",
    main: "index.mjs",
    name: id.toUpperCase(),
    trust: "sandboxed",
    version: "1.0.0",
    ...over,
  } as PluginManifest;
}

const EMPTY = {
  builtinDisabled: [],
  builtins: [],
  devPlugins: {},
  installedPlugins: {},
  pluginErrors: {},
  revocations: null,
  updateAvailable: {},
};

describe("actionsFor (§69 §3.1)", () => {
  it("gives a built-in a toggle but no removal and no update", () => {
    expect(actionsFor("builtin")).toEqual({
      canReload: false,
      canRemove: false,
      canToggle: true,
      canUpdate: false,
    });
  });

  it("gives a community plugin everything except reload", () => {
    expect(actionsFor("community")).toEqual({
      canReload: false,
      canRemove: true,
      canToggle: true,
      canUpdate: true,
    });
  });

  it("gives a dev plugin reload and removal but no toggle", () => {
    // dev 플러그인은 Rust가 매 실행마다 무조건 로드하므로 `enabled`를 영속화할 자리가 없다.
    expect(actionsFor("dev")).toEqual({
      canReload: true,
      canRemove: true,
      canToggle: false,
      canUpdate: false,
    });
  });
});

describe("buildPluginRows (§69)", () => {
  it("orders builtin, then community, then dev", () => {
    const rows = buildPluginRows({
      ...EMPTY,
      builtins: [{ manifest: manifest("bi"), module: {} }],
      devPlugins: { dv: installed("dv", true) },
      installedPlugins: { cm: installed("cm", true) },
    });
    expect(rows.map((r) => r.source)).toEqual(["builtin", "community", "dev"]);
    expect(rows.map((r) => r.manifest.id)).toEqual(["bi", "cm", "dv"]);
  });

  it("marks a built-in in builtinDisabled as disabled", () => {
    const rows = buildPluginRows({
      ...EMPTY,
      builtinDisabled: ["bi"],
      builtins: [{ manifest: manifest("bi"), module: {} }],
    });
    expect(rows[0]?.enabled).toBe(false);
  });

  it("enables a built-in that is not in the list", () => {
    const rows = buildPluginRows({
      ...EMPTY,
      builtinDisabled: ["other"],
      builtins: [{ manifest: manifest("bi"), module: {} }],
    });
    expect(rows[0]?.enabled).toBe(true);
  });

  it("reports a dev plugin as always enabled", () => {
    const rows = buildPluginRows({
      ...EMPTY,
      devPlugins: { dv: installed("dv", false) },
    });
    expect(rows[0]?.enabled).toBe(true);
  });

  it("carries the community plugin's own enabled flag, error and update", () => {
    const rows = buildPluginRows({
      ...EMPTY,
      installedPlugins: { cm: installed("cm", false) },
      pluginErrors: { cm: "boom" },
      updateAvailable: { cm: "2.0.0" },
    });
    expect(rows[0]).toMatchObject({
      enabled: false,
      error: "boom",
      source: "community",
      updateVersion: "2.0.0",
    });
    expect(rows[0]?.installed?.installPath).toBe("/p/cm");
  });

  it("leaves installed undefined for a built-in", () => {
    // §5.2 — 내장은 `installedPlugins`에 들어가지 않는다. 이 필드가 채워지면
    // 삭제·업데이트 코드 경로가 내장에 닿을 수 있다는 뜻이다.
    const rows = buildPluginRows({
      ...EMPTY,
      builtins: [{ manifest: manifest("bi"), module: {} }],
    });
    expect(rows[0]?.installed).toBeUndefined();
  });
});
