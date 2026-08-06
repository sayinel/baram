// §69 — 내장 매니페스트도 출하 검증기를 통과해야 한다.
//
// 이것이 없어서 Media Viewer가 `engines: ">=0.4.0"`으로 출하됐다: 그 built-in을 담은 적
// 없는 두 릴리스를 가리키는 거짓 floor였고, 아무것도 내장 매니페스트를 검증하지 않아
// 통과했다. 픽스처가 아니라 실제 `BUILTIN_PLUGINS`를 순회해야 의미가 있다.
import { describe, expect, it } from "vitest";

import { BUILTIN_PLUGINS } from "../builtin";
import { validateManifest } from "../manifest";

describe("built-in manifests (§69)", () => {
  it("ships at least one built-in", () => {
    // 배열이 비면 아래 루프가 0회 돌면서 통과한다 — 그 공백을 막는다.
    expect(BUILTIN_PLUGINS.length).toBeGreaterThan(0);
  });

  it.each(BUILTIN_PLUGINS.map((b) => [b.manifest.id, b.manifest] as const))(
    "%s passes the shipping validator",
    (_id, manifest) => {
      const result = validateManifest(manifest);
      // ‼️ 성공 시 `errors` 키가 없다 — `toEqual([])`로 단정하면 항상 실패한다.
      expect(result.valid, `invalid: ${JSON.stringify(result)}`).toBe(true);
    },
  );

  it("declares a baram floor this app can evaluate", () => {
    // `engines.baram`이 있는 것만으로는 부족하다: `"*"`나 `^0.5.0`은 두 floor 검사 모두에게
    // "의견 없음"이고, 그러면 거짓 floor를 잡지 못한다.
    for (const { manifest } of BUILTIN_PLUGINS) {
      expect(
        manifest.engines.baram,
        `${manifest.id} must declare a >=X.Y.Z floor`,
      ).toMatch(/^>=\d+\.\d+\.\d+$/);
    }
  });

  // ‼️ 사용자 결정 2026-08-06 — 위 세 건은 현재 코드에서 처음부터 통과한다. 통과하는
  // 방향만 있는 가드는 단정이 죽어 있어도 초록이므로, 거부 방향을 레포지토리에 남긴다.
  // Step 3의 mutation은 여전히 수행하지만 그것은 수사업이고 증거가 남지 않는다.
  describe("the guard's rejecting direction", () => {
    const good = BUILTIN_PLUGINS[0]!.manifest;

    it("rejects a floor this app cannot evaluate", () => {
      // media-viewer가 `>=0.4.0`으로 출하된 것과 같은 계열의 결함: floor를 말하지 않는
      // 매니페스트는 위 세 번째 테스트가 잡아야 한다.
      expect(
        /^>=\d+\.\d+\.\d+$/.test("*"),
        "a '*' floor must not satisfy the floor assertion",
      ).toBe(false);
      expect(/^>=\d+\.\d+\.\d+$/.test("^0.5.0")).toBe(false);
      expect(/^>=\d+\.\d+\.\d+$/.test(">=0.5.0")).toBe(true);
    });

    it("rejects a built-in-shaped manifest with an empty license", () => {
      expect(validateManifest({ ...good, license: "" }).valid).toBe(false);
    });

    it("rejects a built-in-shaped manifest with no engines", () => {
      // Deleted from a copy rather than destructured away: this project's lint ignores `^_`
      // for arguments only, so `const { engines: _x, ...rest }` is an error here.
      const noEngines = { ...good };
      delete (noEngines as { engines?: unknown }).engines;
      expect(validateManifest(noEngines).valid).toBe(false);
    });

    it("rejects a built-in-shaped manifest with no trust tier", () => {
      const noTrust = { ...good };
      delete (noTrust as { trust?: unknown }).trust;
      expect(validateManifest(noTrust).valid).toBe(false);
    });
  });
});
