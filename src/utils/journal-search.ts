// §56k Journal Search utilities — categorize, group, and highlight journal search results

export type JournalCategory = "daily" | "weekly" | "monthly" | "yearly" | "notes" | "other";

/**
 * Categorize a search result path relative to the journal root directory.
 * Expects hierarchical layout:
 *   {journalDir}/daily/YYYY/YYYY-MM-DD.md   → "daily"
 *   {journalDir}/weekly/YYYY/YYYY-WNN.md    → "weekly"
 *   {journalDir}/monthly/YYYY/YYYY-MM.md    → "monthly"
 *   {journalDir}/yearly/YYYY.md             → "yearly"
 *   {journalDir}/notes/...                  → "notes"
 * Also handles flat layout (daily files directly in journalDir).
 */
export function categorizeJournalResult(
  path: string,
  journalDir: string,
): JournalCategory {
  // Normalize separators
  const normalizedPath = path.replace(/\\/g, "/");
  const normalizedDir = journalDir.replace(/\\/g, "/").replace(/\/$/, "");

  if (!normalizedPath.startsWith(normalizedDir)) return "other";

  const relative = normalizedPath.slice(normalizedDir.length).replace(/^\//, "");

  if (relative.startsWith("daily/")) return "daily";
  if (relative.startsWith("weekly/")) return "weekly";
  if (relative.startsWith("monthly/")) return "monthly";
  if (relative.startsWith("yearly/")) return "yearly";
  if (relative.startsWith("notes/")) return "notes";

  // Flat layout: YYYY-MM-DD.md directly in journalDir
  const flatDaily = /^\d{4}-\d{2}-\d{2}\.md$/.test(relative) ||
                    /^\d{8}\.md$/.test(relative);
  if (flatDaily) return "daily";

  return "other";
}

/** Human-readable label for each category */
export const CATEGORY_LABELS: Record<JournalCategory, string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  yearly: "Yearly",
  notes: "Notes",
  other: "Other",
};

/** Canonical display order for categories */
export const CATEGORY_ORDER: JournalCategory[] = [
  "daily",
  "weekly",
  "monthly",
  "yearly",
  "notes",
  "other",
];

/**
 * Group search results by journal category.
 * Returns a Map keyed by category in CATEGORY_ORDER order.
 * Categories with no results are omitted.
 */
export function groupSearchResults<T extends { path: string }>(
  results: T[],
  journalDir: string,
): Map<JournalCategory, T[]> {
  const map = new Map<JournalCategory, T[]>();

  for (const result of results) {
    const category = categorizeJournalResult(result.path, journalDir);
    const existing = map.get(category);
    if (existing) {
      existing.push(result);
    } else {
      map.set(category, [result]);
    }
  }

  // Return in canonical order
  const ordered = new Map<JournalCategory, T[]>();
  for (const cat of CATEGORY_ORDER) {
    const items = map.get(cat);
    if (items && items.length > 0) {
      ordered.set(cat, items);
    }
  }
  return ordered;
}

/**
 * Wrap all occurrences of `query` in the text with `<mark>` tags.
 * Returns the modified string. Case-insensitive match.
 * If query starts with `#`, treats it as a tag search (still highlights).
 */
export function highlightSearchMatch(text: string, query: string): string {
  if (!query.trim()) return text;

  // Strip leading `#` for tag search matching
  const searchTerm = query.startsWith("#") ? query.slice(1) : query;
  if (!searchTerm.trim()) return text;

  // Escape regex special chars
  const escaped = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(${escaped})`, "gi");
  return text.replace(re, "<mark>$1</mark>");
}
