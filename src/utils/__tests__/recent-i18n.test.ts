import { describe, expect, it } from "vitest";

import { t } from "../../i18n";

describe("recent-items i18n keys", () => {
  it("resolves Korean labels", () => {
    expect(t("recent.folders", "ko")).toBe("최근 폴더");
    expect(t("recent.files", "ko")).toBe("최근 파일");
    expect(t("recent.clear", "ko")).toBe("최근 항목 지우기");
    expect(t("recent.vaultBadge", "ko")).toBe("볼트");
  });

  it("resolves English labels and interpolates notFound", () => {
    expect(t("recent.folders", "en")).toBe("Recent Folders");
    expect(t("recent.notFound", "en", { name: "notes.md" })).toContain(
      "notes.md",
    );
  });

  it("resolves the Open Recent menu label", () => {
    expect(t("menu.file.openRecent", "en")).toBe("Open Recent");
    expect(t("menu.file.openRecent", "ko")).toBe("최근 항목");
  });
});
