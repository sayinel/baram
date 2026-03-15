// §11.6 Agent Risk Detector — analyze original vs modified content to determine risk level

import type { RiskLevel } from "../stores/agent-store";

/**
 * Detect the risk level of a content modification.
 *
 * - high: >50% of content changed (with no structural explanation)
 * - medium: >50% of headings changed OR frontmatter fields added/removed
 * - low: minor text change
 */
export function detectRisk(original: string, modified: string): RiskLevel {
  let isMedium = false;

  // Check for medium risk: heading structure changes
  const origHeadings = extractHeadings(original);
  const modHeadings = extractHeadings(modified);
  if (origHeadings.length > 0) {
    let headingChanges = 0;
    const maxLen = Math.max(origHeadings.length, modHeadings.length);
    for (let i = 0; i < maxLen; i++) {
      if (origHeadings[i] !== modHeadings[i]) headingChanges++;
    }
    if (headingChanges / origHeadings.length > 0.5) {
      isMedium = true;
    }
  }

  // Check for medium risk: frontmatter field changes
  const origKeys = extractFrontmatterKeys(original);
  const modKeys = extractFrontmatterKeys(modified);
  if (origKeys.length > 0 || modKeys.length > 0) {
    const origSet = new Set(origKeys);
    const modSet = new Set(modKeys);
    const added = modKeys.filter((k) => !origSet.has(k));
    const removed = origKeys.filter((k) => !modSet.has(k));
    if (added.length > 0 || removed.length > 0) {
      isMedium = true;
    }
  }

  if (isMedium) return "medium";

  // Check for high risk: >50% content change with no structural explanation
  if (contentChangeRatio(original, modified) > 0.5) {
    return "high";
  }

  return "low";
}

/**
 * Calculate the ratio of changed lines between two strings.
 * Uses a simple line-level diff approach.
 */
function contentChangeRatio(original: string, modified: string): number {
  const origLines = original.split("\n");
  const modLines = modified.split("\n");
  const origSet = new Set(origLines);
  const modSet = new Set(modLines);

  let changed = 0;
  for (const line of origLines) {
    if (!modSet.has(line)) changed++;
  }
  for (const line of modLines) {
    if (!origSet.has(line)) changed++;
  }

  const totalLines = origLines.length + modLines.length;
  if (totalLines === 0) return 0;
  return changed / totalLines;
}

/**
 * Extract frontmatter field keys from markdown content.
 * Returns empty array if no frontmatter block found.
 */
function extractFrontmatterKeys(content: string): string[] {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return [];
  return match[1]
    .split("\n")
    .map((line) => line.split(":")[0]?.trim())
    .filter(Boolean);
}

/**
 * Extract heading lines from markdown content.
 */
function extractHeadings(content: string): string[] {
  return content
    .split("\n")
    .filter((line) => /^#{1,6}\s/.test(line))
    .map((line) => line.trim());
}
