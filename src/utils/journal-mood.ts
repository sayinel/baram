/**
 * §56e — Mood/Energy types and frontmatter helpers
 */

export type MoodValue = "deep" | "calm" | "neutral" | "warm" | "bright";
export type EnergyValue = 1 | 2 | 3 | 4 | 5;

export const MOOD_VALUES: MoodValue[] = ["deep", "calm", "neutral", "warm", "bright"];

export const MOOD_LABELS: Record<MoodValue, string> = {
  deep: "Deep",
  calm: "Calm",
  neutral: "Neutral",
  warm: "Warm",
  bright: "Bright",
};

/** Parse mood value from frontmatter content */
export function parseMoodFromFrontmatter(content: string): MoodValue | undefined {
  if (!content.trim()) return undefined;

  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return undefined;

  const moodMatch = fmMatch[1].match(/^mood:\s*(\S+)\s*$/m);
  if (!moodMatch) return undefined;

  const value = moodMatch[1];
  if (MOOD_VALUES.includes(value as MoodValue)) {
    return value as MoodValue;
  }
  return undefined;
}

/** Parse energy value (1-5) from frontmatter content */
export function parseEnergyFromFrontmatter(content: string): EnergyValue | undefined {
  if (!content.trim()) return undefined;

  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return undefined;

  const energyMatch = fmMatch[1].match(/^energy:\s*(\d+)\s*$/m);
  if (!energyMatch) return undefined;

  const value = parseInt(energyMatch[1], 10);
  if (value >= 1 && value <= 5) {
    return value as EnergyValue;
  }
  return undefined;
}

/** Update or add mood field in frontmatter. Pass undefined to remove. */
export function updateFrontmatterMood(content: string, mood: MoodValue | undefined): string {
  return updateFrontmatterField(content, "mood", mood);
}

/** Update or add energy field in frontmatter. Pass undefined to remove. */
export function updateFrontmatterEnergy(content: string, energy: EnergyValue | undefined): string {
  return updateFrontmatterField(content, "energy", energy !== undefined ? String(energy) : undefined);
}

/** Generic frontmatter field updater */
function updateFrontmatterField(content: string, field: string, value: string | undefined): string {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return content;

  const frontmatter = fmMatch[1];
  const rest = content.slice(fmMatch[0].length);
  const fieldRegex = new RegExp(`^${field}:\\s*.*$`, "m");
  const hasField = fieldRegex.test(frontmatter);

  let newFrontmatter: string;
  if (value === undefined) {
    // Remove field
    newFrontmatter = frontmatter.replace(fieldRegex, "").replace(/\n{2,}/g, "\n").trim();
  } else if (hasField) {
    // Update existing field
    newFrontmatter = frontmatter.replace(fieldRegex, `${field}: ${value}`);
  } else {
    // Add new field
    newFrontmatter = frontmatter.trim() + `\n${field}: ${value}`;
  }

  return `---\n${newFrontmatter}\n---${rest}`;
}
