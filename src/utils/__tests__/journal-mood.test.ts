/**
 * §56e Phase B — Mood/Energy utility tests
 * TDD Red Phase: all tests should FAIL before implementation
 */
import { describe, it, expect } from "vitest";
import {
  MOOD_VALUES,
  MOOD_LABELS,
  parseMoodFromFrontmatter,
  parseEnergyFromFrontmatter,
  updateFrontmatterMood,
  updateFrontmatterEnergy,
} from "../journal-mood";

describe("§56e Mood types and constants", () => {
  it("MOOD_VALUES has 5 entries", () => {
    expect(MOOD_VALUES).toEqual(["deep", "calm", "neutral", "warm", "bright"]);
  });

  it("MOOD_LABELS maps all mood values", () => {
    expect(MOOD_LABELS.deep).toBe("Deep");
    expect(MOOD_LABELS.calm).toBe("Calm");
    expect(MOOD_LABELS.neutral).toBe("Neutral");
    expect(MOOD_LABELS.warm).toBe("Warm");
    expect(MOOD_LABELS.bright).toBe("Bright");
  });
});

describe("§56e parseMoodFromFrontmatter", () => {
  it("parses mood value from frontmatter", () => {
    const content = `---
date: 2026-02-28
mood: warm
energy: 4
---

# Journal`;
    expect(parseMoodFromFrontmatter(content)).toBe("warm");
  });

  it("returns undefined when mood field is absent", () => {
    const content = `---
date: 2026-02-28
---

# Journal`;
    expect(parseMoodFromFrontmatter(content)).toBeUndefined();
  });

  it("returns undefined for invalid mood value", () => {
    const content = `---
mood: happy
---`;
    expect(parseMoodFromFrontmatter(content)).toBeUndefined();
  });

  it("returns undefined for empty content", () => {
    expect(parseMoodFromFrontmatter("")).toBeUndefined();
  });
});

describe("§56e parseEnergyFromFrontmatter", () => {
  it("parses energy value 1-5", () => {
    const content = `---
energy: 3
---`;
    expect(parseEnergyFromFrontmatter(content)).toBe(3);
  });

  it("returns undefined when energy is absent", () => {
    const content = `---
date: 2026-02-28
---`;
    expect(parseEnergyFromFrontmatter(content)).toBeUndefined();
  });

  it("returns undefined for out-of-range values", () => {
    expect(parseEnergyFromFrontmatter("---\nenergy: 0\n---")).toBeUndefined();
    expect(parseEnergyFromFrontmatter("---\nenergy: 6\n---")).toBeUndefined();
  });
});

describe("§56e updateFrontmatterMood", () => {
  it("adds mood to existing frontmatter", () => {
    const content = `---
date: 2026-02-28
---

# Journal`;
    const result = updateFrontmatterMood(content, "warm");
    expect(result).toContain("mood: warm");
    expect(result).toContain("date: 2026-02-28");
    expect(result).toContain("# Journal");
  });

  it("updates existing mood value", () => {
    const content = `---
date: 2026-02-28
mood: calm
---

# Journal`;
    const result = updateFrontmatterMood(content, "bright");
    expect(result).toContain("mood: bright");
    expect(result).not.toContain("mood: calm");
  });

  it("removes mood field when value is undefined", () => {
    const content = `---
date: 2026-02-28
mood: warm
---

# Journal`;
    const result = updateFrontmatterMood(content, undefined);
    expect(result).not.toContain("mood:");
    expect(result).toContain("date: 2026-02-28");
  });
});

describe("§56e updateFrontmatterEnergy", () => {
  it("adds energy to existing frontmatter", () => {
    const content = `---
date: 2026-02-28
---

# Journal`;
    const result = updateFrontmatterEnergy(content, 4);
    expect(result).toContain("energy: 4");
  });

  it("updates existing energy value", () => {
    const content = `---
energy: 2
---`;
    const result = updateFrontmatterEnergy(content, 5);
    expect(result).toContain("energy: 5");
    expect(result).not.toContain("energy: 2");
  });

  it("removes energy field when value is undefined", () => {
    const content = `---
energy: 3
---

# Body`;
    const result = updateFrontmatterEnergy(content, undefined);
    expect(result).not.toContain("energy:");
  });
});
