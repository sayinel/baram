import { describe, expect, it } from "vitest";

import { isLegacyManifest, pluginTrustOf } from "../plugin-trust";

describe("pluginTrustOf (§260)", () => {
  it("returns the declared tier", () => {
    expect(pluginTrustOf({ trust: "sandboxed" })).toBe("sandboxed");
    expect(pluginTrustOf({ trust: "trusted" })).toBe("trusted");
  });

  it("returns null for a legacy manifest with no trust", () => {
    expect(pluginTrustOf({} as { trust: never })).toBeNull();
  });

  it("returns null for an unrecognized trust value", () => {
    expect(pluginTrustOf({ trust: "full" as unknown as "trusted" })).toBeNull();
  });
});

describe("isLegacyManifest (§260)", () => {
  it("is true only when no valid tier is declared", () => {
    expect(isLegacyManifest({ trust: "sandboxed" })).toBe(false);
    expect(isLegacyManifest({} as { trust: never })).toBe(true);
  });
});
