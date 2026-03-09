import { describe, it, expect } from "vitest";
import {
  JOURNAL_THEMES,
  getJournalTheme,
  getStreakIcon,
} from "../journal-themes";

describe("JOURNAL_THEMES", () => {
  it("has exactly 6 themes", () => {
    expect(JOURNAL_THEMES).toHaveLength(6);
  });

  it("first theme is 'classic-diary'", () => {
    expect(JOURNAL_THEMES[0].id).toBe("classic-diary");
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
      expect(
        /^\d+px$/.test(theme.typography.maxWidth) ||
          theme.typography.maxWidth === "inherit",
      ).toBe(true);
    }
  });

  it("non-classic-diary themes have px maxWidth", () => {
    for (const theme of JOURNAL_THEMES.filter(
      (t) => t.id !== "classic-diary",
    )) {
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

  it("contains all 6 spec themes", () => {
    const ids = JOURNAL_THEMES.map((t) => t.id);
    expect(ids).toContain("classic-diary");
    expect(ids).toContain("moleskine");
    expect(ids).toContain("muji");
    expect(ids).toContain("night-owl");
    expect(ids).toContain("vintage");
    expect(ids).toContain("watercolor");
  });
});

describe("getJournalTheme", () => {
  it("returns correct theme by id — moleskine", () => {
    const moleskine = getJournalTheme("moleskine");
    expect(moleskine.id).toBe("moleskine");
    expect(moleskine.accentColor).toBe("#6B5B4F");
    expect(moleskine.streakIcon).toBe("✦");
  });

  it("returns muji theme correctly", () => {
    const muji = getJournalTheme("muji");
    expect(muji.id).toBe("muji");
    expect(muji.accentColor).toBe("#6B7280");
  });

  it("returns night-owl theme correctly", () => {
    const nightOwl = getJournalTheme("night-owl");
    expect(nightOwl.id).toBe("night-owl");
    expect(nightOwl.accentColor).toBe("#4299E1");
  });

  it("returns vintage theme correctly", () => {
    const vintage = getJournalTheme("vintage");
    expect(vintage.id).toBe("vintage");
    expect(vintage.accentColor).toBe("#8B6F47");
  });

  it("returns watercolor theme correctly", () => {
    const watercolor = getJournalTheme("watercolor");
    expect(watercolor.id).toBe("watercolor");
    expect(watercolor.accentColor).toBe("#7EB5A6");
  });

  it("returns classic-diary for unknown id", () => {
    const fallback = getJournalTheme("nonexistent");
    expect(fallback.id).toBe("classic-diary");
  });

  it("returns classic-diary theme for 'classic-diary' id", () => {
    const def = getJournalTheme("classic-diary");
    expect(def.id).toBe("classic-diary");
    expect(def.streakIcon).toBe("🔥");
  });
});

describe("getStreakIcon", () => {
  it("returns 🔥 for classic-diary theme", () => {
    expect(getStreakIcon("classic-diary")).toBe("🔥");
  });

  it("returns ✦ for moleskine theme", () => {
    expect(getStreakIcon("moleskine")).toBe("✦");
  });

  it("returns · for muji theme", () => {
    expect(getStreakIcon("muji")).toBe("·");
  });

  it("returns 🌙 for night-owl theme", () => {
    expect(getStreakIcon("night-owl")).toBe("🌙");
  });

  it("returns 🖋️ for vintage theme", () => {
    expect(getStreakIcon("vintage")).toBe("🖋️");
  });

  it("returns 🎨 for watercolor theme", () => {
    expect(getStreakIcon("watercolor")).toBe("🎨");
  });

  it("returns 🔥 for unknown theme (falls back to classic-diary)", () => {
    expect(getStreakIcon("unknown-id")).toBe("🔥");
  });
});
