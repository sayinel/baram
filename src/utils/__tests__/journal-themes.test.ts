import { describe, it, expect } from "vitest";
import { JOURNAL_THEMES, getJournalTheme, getStreakIcon } from "../journal-themes";

describe("JOURNAL_THEMES", () => {
  it("has exactly 5 themes", () => {
    expect(JOURNAL_THEMES).toHaveLength(5);
  });

  it("first theme is 'default'", () => {
    expect(JOURNAL_THEMES[0].id).toBe("default");
  });

  it("all themes have required fields", () => {
    for (const theme of JOURNAL_THEMES) {
      expect(theme.id).toBeTruthy();
      expect(theme.name).toBeTruthy();
      expect(theme.streakIcon).toBeTruthy();
      expect(typeof theme.calendarBg).toBe("string");
      expect(typeof theme.headerColor).toBe("string");
      expect(typeof theme.accentColor).toBe("string");
      expect(typeof theme.dotColor).toBe("string");
    }
  });

  it("all themes have valid typography", () => {
    for (const theme of JOURNAL_THEMES) {
      expect(theme.typography).toBeDefined();
      expect(typeof theme.typography.fontFamily).toBe("string");
      expect(theme.typography.fontFamily.length).toBeGreaterThan(0);
      expect(theme.typography.lineHeight).toBeGreaterThanOrEqual(1.0);
      expect(theme.typography.lineHeight).toBeLessThanOrEqual(3.0);
      expect(/^\d+px$/.test(theme.typography.maxWidth) || theme.typography.maxWidth === "inherit").toBe(true);
    }
  });

  it("non-default themes have px maxWidth", () => {
    for (const theme of JOURNAL_THEMES.filter((t) => t.id !== "default")) {
      expect(/^\d+px$/.test(theme.typography.maxWidth)).toBe(true);
    }
  });

  it("all themes have headerBg, promptBg, promptBorder", () => {
    for (const theme of JOURNAL_THEMES) {
      expect(typeof theme.headerBg).toBe("string");
      expect(theme.headerBg.length).toBeGreaterThan(0);
      expect(typeof theme.promptBg).toBe("string");
      expect(theme.promptBg.length).toBeGreaterThan(0);
      expect(typeof theme.promptBorder).toBe("string");
      expect(theme.promptBorder.length).toBeGreaterThan(0);
    }
  });

  it("contains nature, ocean, sunset, minimal themes", () => {
    const ids = JOURNAL_THEMES.map((t) => t.id);
    expect(ids).toContain("nature");
    expect(ids).toContain("ocean");
    expect(ids).toContain("sunset");
    expect(ids).toContain("minimal");
  });
});

describe("getJournalTheme", () => {
  it("returns correct theme by id", () => {
    const nature = getJournalTheme("nature");
    expect(nature.id).toBe("nature");
    expect(nature.accentColor).toBe("#4A7C2E");
    expect(nature.streakIcon).toBe("🌿");
  });

  it("returns ocean theme correctly", () => {
    const ocean = getJournalTheme("ocean");
    expect(ocean.id).toBe("ocean");
    expect(ocean.accentColor).toBe("#2B6CB0");
  });

  it("returns sunset theme correctly", () => {
    const sunset = getJournalTheme("sunset");
    expect(sunset.id).toBe("sunset");
    expect(sunset.accentColor).toBe("#DD6B20");
  });

  it("returns minimal theme correctly", () => {
    const minimal = getJournalTheme("minimal");
    expect(minimal.id).toBe("minimal");
    expect(minimal.accentColor).toBe("#6B7280");
  });

  it("returns default for unknown id", () => {
    const fallback = getJournalTheme("nonexistent");
    expect(fallback.id).toBe("default");
  });

  it("returns default theme for 'default' id", () => {
    const def = getJournalTheme("default");
    expect(def.id).toBe("default");
    expect(def.streakIcon).toBe("🔥");
  });
});

describe("getStreakIcon", () => {
  it("returns 🔥 for default theme", () => {
    expect(getStreakIcon("default")).toBe("🔥");
  });

  it("returns 🌿 for nature theme", () => {
    expect(getStreakIcon("nature")).toBe("🌿");
  });

  it("returns 🌊 for ocean theme", () => {
    expect(getStreakIcon("ocean")).toBe("🌊");
  });

  it("returns 🌅 for sunset theme", () => {
    expect(getStreakIcon("sunset")).toBe("🌅");
  });

  it("returns ✦ for minimal theme", () => {
    expect(getStreakIcon("minimal")).toBe("✦");
  });

  it("returns 🔥 for unknown theme (falls back to default)", () => {
    expect(getStreakIcon("unknown-id")).toBe("🔥");
  });
});
