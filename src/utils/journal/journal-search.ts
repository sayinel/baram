// §56k Journal Search utilities — categorize, group, and highlight journal search results
import { extractFrontmatter } from "../markdown/frontmatter";
import { JOURNAL_FILENAME_COMPACT_RE, JOURNAL_FILENAME_RE } from "./journal";

export type JournalCategory =
  | "daily"
  | "monthly"
  | "notes"
  | "other"
  | "weekly"
  | "yearly";

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

  const relative = normalizedPath
    .slice(normalizedDir.length)
    .replace(/^\//, "");

  if (relative.startsWith("daily/")) return "daily";
  if (relative.startsWith("weekly/")) return "weekly";
  if (relative.startsWith("monthly/")) return "monthly";
  if (relative.startsWith("yearly/")) return "yearly";
  if (relative.startsWith("notes/")) return "notes";

  // Flat layout: YYYY-MM-DD.md directly in journalDir
  const flatDaily =
    JOURNAL_FILENAME_RE.test(relative) ||
    JOURNAL_FILENAME_COMPACT_RE.test(relative);
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

export interface JournalSearchFilters {
  dateFrom?: string; // YYYY-MM-DD
  dateTo?: string; // YYYY-MM-DD
  energyMin?: number; // 1-5, undefined = no filter
  hasPhotos?: boolean; // true = only entries with photos
  moodFilter?: string[]; // ["warm", "bright"] — empty = all
  tagsFilter?: string[]; // ["여행", "운동"] — empty = no filter
}

// ── §56k Frontmatter filter types and utilities ────────────────────────────

/** Extract YYYY-MM-DD from a file path (e.g. daily/2026/02/2026-02-28.md). */
export function extractDateFromPath(path: string): null | string {
  const m = path.match(/(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

/** Extract frontmatter scalar fields from raw markdown content. */
export function extractFrontmatterFields(content: string): {
  date?: string;
  energy?: number;
  hasPhotos: boolean;
  mood?: string;
  tags?: string[];
} {
  const hasPhotos = content.includes("![");
  const fm = extractFrontmatter(content);
  if (!fm) return { hasPhotos };

  const yaml = fm.yaml;
  const date = yaml.match(/^date:\s*(\d{4}-\d{2}-\d{2})/m)?.[1];
  const mood = yaml.match(/^mood:\s*(\w+)/m)?.[1];
  const energyStr = yaml.match(/^energy:\s*(\d)/m)?.[1];
  const energy = energyStr !== undefined ? parseInt(energyStr) : undefined;

  // Inline tags: tags: [tag1, tag2]
  const tagsInline = yaml.match(/^tags:\s*\[([^\]]*)\]/m)?.[1];
  const tags: string[] = tagsInline
    ? tagsInline
        .split(",")
        .map((t) => t.trim().replace(/['"]/g, ""))
        .filter(Boolean)
    : [];

  // Block tags: tags:\n  - tag1
  if (tags.length === 0) {
    const blockTagMatch = yaml.match(/^tags:\s*\n((?:\s+-\s+.+\n?)*)/m);
    if (blockTagMatch) {
      for (const line of blockTagMatch[1].split("\n")) {
        const m = line.match(/^\s+-\s+(.+)/);
        if (m) tags.push(m[1].trim().replace(/['"]/g, ""));
      }
    }
  }

  return { date, mood, energy, tags, hasPhotos };
}

/** Filter an array of {path, content} results by frontmatter criteria. */
export function filterByFrontmatter(
  results: Array<{ content: string; path: string }>,
  filters: JournalSearchFilters,
): Array<{ content: string; path: string }> {
  return results.filter((r) => {
    const fields = extractFrontmatterFields(r.content);

    // Date range (frontmatter date takes priority; fall back to filename)
    if (filters.dateFrom || filters.dateTo) {
      const date = fields.date ?? extractDateFromPath(r.path);
      if (!date) return false;
      if (filters.dateFrom && date < filters.dateFrom) return false;
      if (filters.dateTo && date > filters.dateTo) return false;
    }

    // Mood — must match one of the selected moods
    if (filters.moodFilter && filters.moodFilter.length > 0) {
      if (!fields.mood || !filters.moodFilter.includes(fields.mood))
        return false;
    }

    // Energy minimum
    if (filters.energyMin !== undefined) {
      if (fields.energy === undefined || fields.energy < filters.energyMin)
        return false;
    }

    // Tags — ANY match (OR logic)
    if (filters.tagsFilter && filters.tagsFilter.length > 0) {
      if (
        !fields.tags ||
        !filters.tagsFilter.some((t) => fields.tags!.includes(t))
      )
        return false;
    }

    // Photos
    if (filters.hasPhotos && !fields.hasPhotos) return false;

    return true;
  });
}

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

/** Returns true when at least one filter field is active. */
export function hasActiveFilters(filters: JournalSearchFilters): boolean {
  return !!(
    filters.dateFrom ||
    filters.dateTo ||
    (filters.moodFilter && filters.moodFilter.length > 0) ||
    filters.energyMin !== undefined ||
    (filters.tagsFilter && filters.tagsFilter.length > 0) ||
    filters.hasPhotos
  );
}

// ── Text highlight ───────────────────────────────────────────────────────────

/**
 * Wrap all occurrences of `query` in the text with `<mark>` tags.
 * Returns the modified string. Case-insensitive match.
 * If query starts with `#`, treats it as a tag search (still highlights).
 * Text is HTML-escaped before wrapping to prevent XSS.
 */
export function highlightSearchMatch(text: string, query: string): string {
  if (!query.trim()) return escapeHtml(text);

  // Strip leading `#` for tag search matching
  const searchTerm = query.startsWith("#") ? query.slice(1) : query;
  if (!searchTerm.trim()) return escapeHtml(text);

  // Escape regex special chars in the search term
  const escapedTerm = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(${escapedTerm})`, "gi");

  // HTML-escape the text first, then apply highlight
  const escapedText = escapeHtml(text);
  return escapedText.replace(re, "<mark>$1</mark>");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&(?!amp;|lt;|gt;|quot;|#\d+;|#x[\da-fA-F]+;)/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
