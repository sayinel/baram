// §69 §5.2 — 세 출처를 다 보는 매니페스트 조회. 내장이 `installedPlugins`에 없다는 사실이
// 조용한 `undefined`를 만들던 자리다.
import type { InstalledPlugin } from "../types";

import { describe, expect, it } from "vitest";

import { BUILTIN_PLUGINS } from "../builtin";
import { selectManifest } from "../plugin-sources";

function rec(id: string, version: string): InstalledPlugin {
  return {
    checksum: "c",
    enabled: true,
    installedAt: 0,
    installPath: `/p/${id}`,
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
      version,
    },
    updatedAt: 0,
  } as unknown as InstalledPlugin;
}

const EMPTY = { devPlugins: {}, installedPlugins: {} };

describe("selectManifest (§69 §5.2)", () => {
  it("resolves an installed plugin", () => {
    expect(
      selectManifest(
        { ...EMPTY, installedPlugins: { a: rec("a", "1.0.0") } },
        "a",
      )?.version,
    ).toBe("1.0.0");
  });

  it("resolves a dev plugin", () => {
    expect(
      selectManifest({ ...EMPTY, devPlugins: { d: rec("d", "9.9.9") } }, "d")
        ?.version,
    ).toBe("9.9.9");
  });

  it("resolves a BUILT-IN, which is in neither map", () => {
    // ‼️ 이 케이스가 이 함수의 존재 이유다. 실제 `BUILTIN_PLUGINS`로 확인한다 —
    // 픽스처로 하면 정작 앱이 쓰는 배열을 검사하지 않는다.
    const id = BUILTIN_PLUGINS[0]!.manifest.id;
    expect(selectManifest(EMPTY, id)?.id).toBe(id);
  });

  it("prefers installed over dev over builtin", () => {
    const id = BUILTIN_PLUGINS[0]!.manifest.id;
    expect(
      selectManifest(
        { devPlugins: { [id]: rec(id, "2.0.0") }, installedPlugins: {} },
        id,
      )?.version,
      "dev must win over builtin",
    ).toBe("2.0.0");
    expect(
      selectManifest(
        {
          devPlugins: { [id]: rec(id, "2.0.0") },
          installedPlugins: { [id]: rec(id, "3.0.0") },
        },
        id,
      )?.version,
      "installed must win over dev",
    ).toBe("3.0.0");
  });

  it("returns undefined for an id from no source", () => {
    expect(selectManifest(EMPTY, "nobody")).toBeUndefined();
  });
});
