import { describe, expect, it } from "vitest";

import { GENERIC_FAMILIES } from "../editor/quote-font-family";
import { BUNDLED_FONTS } from "../font/bundled-fonts";
import {
  getJournalTheme,
  getStreakIcon,
  JOURNAL_THEMES,
} from "../journal/journal-themes";

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

// §353 — 저널 테마의 서체는 "번들이거나, 폴백이 명시된 체인"이어야 한다.
//
// 오늘의 상태: 6개 테마가 Noto Serif KR·D2Coding·Nanum Pen Script 등을
// 하드코딩하고 번들은 하나도 없어서 대부분 serif/monospace/cursive 로 떨어진다.
// 스펙에 적힌 모습과 실제 렌더가 다르고, 아무도 그걸 볼 수 없었다.
describe("§353 journal theme typography", () => {
  // BUNDLED·GENERICS 는 §347/§349 의 단일 출처에서 끌어온다 — 로컬 사본은
  // 그쪽이 한 항목 늘 때 여기서 조용히 갈라진다.
  const BUNDLED = BUNDLED_FONTS.map((f) => f.family);

  // 번들로 설계된 4개 테마와 의도적으로 비번들인 2개(classic-diary·
  // watercolor)의 고정된 분류 — 값이 아니라 소속 자체를 단정해야 어느 한
  // 테마가 조용히 번들을 잃어도(또는 의도치 않게 얻어도) 잡힌다.
  const EXPECTED_BUNDLED_THEME_IDS = new Set([
    "moleskine",
    "muji",
    "night-owl",
    "vintage",
  ]);

  it("ends every stack in a generic family", () => {
    for (const theme of JOURNAL_THEMES) {
      const last = theme.typography.fontFamily.split(",").at(-1)?.trim() ?? "";
      expect(GENERIC_FAMILIES.has(last), `${theme.id} ends in ${last}`).toBe(
        true,
      );
    }
  });

  // 체인이 한 칸이면 폴백이 아니라 희망이다.
  it("names at least one concrete family before the generic", () => {
    for (const theme of JOURNAL_THEMES) {
      const parts = theme.typography.fontFamily.split(",").map((p) => p.trim());
      expect(
        parts.length,
        `${theme.id} has no fallback chain`,
      ).toBeGreaterThanOrEqual(2);
    }
  });

  it("quotes every multi-word family name", () => {
    for (const theme of JOURNAL_THEMES) {
      const parts = theme.typography.fontFamily.split(",").map((p) => p.trim());
      for (const part of parts) {
        if (GENERIC_FAMILIES.has(part)) continue;
        if (part.includes(" ")) {
          expect(part.startsWith('"'), `${theme.id}: ${part} unquoted`).toBe(
            true,
          );
        }
      }
    }
  });

  it("routes exactly the bundled-by-design themes through a bundled family", () => {
    for (const theme of JOURNAL_THEMES) {
      const routesBundled = BUNDLED.some((b) =>
        theme.typography.fontFamily.includes(b),
      );
      expect(routesBundled, theme.id).toBe(
        EXPECTED_BUNDLED_THEME_IDS.has(theme.id),
      );
    }
  });
});
