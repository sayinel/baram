/**
 * §56g Journal Stats Cache — .journal.json read/write utilities
 *
 * The cache file lives at {journalDir}/.journal.json and is already in
 * JOURNAL_HIDDEN_ENTRIES so it won't appear in the FileTree.
 */
import { listDir, readFile, writeFile } from "../../ipc/invoke";
import { extractFrontmatter } from "../frontmatter";

// ---- Types ----------------------------------------------------------------

export interface JournalEntryMeta {
  energy?: number;
  hasPhotos?: boolean;
  modifiedHour?: number; // 0-23, hour-of-day when the file was last modified
  mood?: string;
  tags?: string[];
  words: number;
}

export interface JournalStatsCache {
  entriesByDate: Record<string, JournalEntryMeta>;
  promptHistory?: {
    usedPromptIds: string[]; // recently used prompt IDs, oldest first (max 50)
  };
  stats: {
    currentStreak: number;
    lastFullScan: string; // ISO datetime
    longestStreak: number;
    totalEntries: number;
    totalWords: number;
  };
  version: 1;
}

// ---- Cache path -----------------------------------------------------------

interface ParsedFrontmatter {
  [key: string]: unknown;
  energy?: number;
  mood?: string;
  tags?: string[];
}

// ---- Public API -----------------------------------------------------------

/**
 * Full scan of the daily/ directory, parse all files, compute all stats.
 * Sets lastFullScan to now.
 */
export async function buildFullCache(
  journalDir: string,
): Promise<JournalStatsCache> {
  const baseDir = `${journalDir}/daily`;
  let entries;
  try {
    entries = await listDir(baseDir, true);
  } catch {
    // Flat layout fallback: list journalDir itself
    try {
      entries = await listDir(journalDir, false);
    } catch {
      return {
        ...createEmptyCache(),
        stats: {
          ...createEmptyCache().stats,
          lastFullScan: new Date().toISOString(),
        },
      };
    }
  }

  const mdFiles = entries.filter(
    (e) =>
      !e.isDir &&
      e.name.endsWith(".md") &&
      /^\d{4}-\d{2}-\d{2}\.md$/.test(e.name),
  );

  const entriesByDate: Record<string, JournalEntryMeta> = {};

  await Promise.all(
    mdFiles.map(async (file) => {
      const match = file.name.match(/^(\d{4}-\d{2}-\d{2})\.md$/);
      if (!match) return;
      try {
        const content = await readFile(file.path);
        const meta = parseEntryContent(content);
        if (file.modifiedAt !== undefined) {
          meta.modifiedHour = new Date(file.modifiedAt * 1000).getHours();
        }
        entriesByDate[match[1]] = meta;
      } catch {
        // Skip unreadable files
      }
    }),
  );

  const stats = recomputeStats(entriesByDate);

  return {
    version: 1,
    stats: {
      ...stats,
      lastFullScan: new Date().toISOString(),
    },
    entriesByDate,
  };
}

// ---- Prompt history helpers -----------------------------------------------

/** Create a fresh empty cache object. */
export function createEmptyCache(): JournalStatsCache {
  return {
    version: 1,
    stats: {
      currentStreak: 0,
      longestStreak: 0,
      totalEntries: 0,
      totalWords: 0,
      lastFullScan: new Date(0).toISOString(),
    },
    entriesByDate: {},
  };
}

// ---- Stats cache ----------------------------------------------------------

/** Read the cache from disk. Returns null if not found or parse fails. */
export async function readStatsCache(
  journalDir: string,
): Promise<JournalStatsCache | null> {
  try {
    const raw = await readFile(cachePath(journalDir));
    const parsed = JSON.parse(raw) as JournalStatsCache;
    if (parsed.version !== 1) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Parse a single journal file's content and update the cache for its date.
 * Also recomputes aggregate stats (streak, totals).
 *
 * @param cache - The current cache object (not mutated; a new object is returned)
 * @param date  - "YYYY-MM-DD" string for this entry
 * @param content - Raw markdown content of the file
 */
export function updateCacheEntry(
  cache: JournalStatsCache,
  date: string,
  content: string,
): JournalStatsCache {
  const meta = parseEntryContent(content);

  const newEntriesByDate: Record<string, JournalEntryMeta> = {
    ...cache.entriesByDate,
    [date]: meta,
  };

  const stats = recomputeStats(newEntriesByDate);

  return {
    version: 1,
    stats: {
      ...stats,
      lastFullScan: cache.stats.lastFullScan,
    },
    entriesByDate: newEntriesByDate,
  };
}

/** Write the cache to disk. */
export async function writeStatsCache(
  journalDir: string,
  cache: JournalStatsCache,
): Promise<void> {
  await writeFile(cachePath(journalDir), JSON.stringify(cache, null, 2));
}

// ---- Internal helpers -----------------------------------------------------

function addDays(dateStr: string, n: number): string {
  const d = parseDate(dateStr);
  d.setDate(d.getDate() + n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function cachePath(journalDir: string): string {
  return `${journalDir}/.journal.json`;
}

function daysDiff(a: string, b: string): number {
  return (parseDate(b).getTime() - parseDate(a).getTime()) / 86400000;
}

function formatToday(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/**
 * Parse a journal file's content to extract word count and frontmatter fields.
 */
function parseEntryContent(content: string): JournalEntryMeta {
  const fmResult = extractFrontmatter(content);
  const frontmatter = fmResult ? parseRawYaml(fmResult.yaml) : {};
  const body = fmResult ? fmResult.rest : content;

  // Word count: body text only, strip headings (#…) and count tokens
  const bodyText = body
    .split("\n")
    .filter((line) => !line.startsWith("#"))
    .join(" ");
  const words = bodyText.split(/\s+/).filter(Boolean).length;

  const hasPhotos = content.includes("![");

  return {
    words,
    mood: frontmatter.mood,
    energy:
      frontmatter.energy !== undefined ? Number(frontmatter.energy) : undefined,
    hasPhotos: hasPhotos || undefined,
    tags: frontmatter.tags,
  };
}

/**
 * Parse the raw YAML string (without --- delimiters) into a ParsedFrontmatter.
 * Only handles simple key: value and tags as YAML list.
 */
function parseRawYaml(rawYaml: string): ParsedFrontmatter {
  const fm: ParsedFrontmatter = {};

  // Parse simple key: value pairs
  const lines = rawYaml.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const kvMatch = line.match(/^(\w[\w-]*):\s*(.*)$/);
    if (!kvMatch) {
      i++;
      continue;
    }
    const key = kvMatch[1];
    const val = kvMatch[2].trim();

    if (val === "" || val === "[]") {
      // Possible YAML list on following lines
      const items: string[] = [];
      i++;
      while (i < lines.length && /^\s+-\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s+-\s+/, "").trim());
        i++;
      }
      if (items.length > 0) {
        fm[key] = items;
      }
      continue;
    }

    // Inline list: [a, b, c]
    if (val.startsWith("[") && val.endsWith("]")) {
      const inner = val.slice(1, -1);
      fm[key] = inner
        .split(",")
        .map((s) => s.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
      i++;
      continue;
    }

    // Numeric
    const num = Number(val);
    if (!isNaN(num) && val !== "") {
      fm[key] = num;
      i++;
      continue;
    }

    // String (strip quotes)
    fm[key] = val.replace(/^["']|["']$/g, "");
    i++;
  }

  return {
    mood: typeof fm.mood === "string" ? fm.mood : undefined,
    energy: typeof fm.energy === "number" ? fm.energy : undefined,
    tags: Array.isArray(fm.tags)
      ? (fm.tags as string[]).filter((t): t is string => typeof t === "string")
      : undefined,
  };
}

/**
 * Recompute aggregate stats from the full entriesByDate map.
 * Today is computed at call time so streaks are always fresh.
 */
function recomputeStats(
  entriesByDate: Record<string, JournalEntryMeta>,
): Omit<JournalStatsCache["stats"], "lastFullScan"> {
  const dates = Object.keys(entriesByDate).sort();
  const totalEntries = dates.length;
  const totalWords = dates.reduce(
    (sum, d) => sum + (entriesByDate[d].words ?? 0),
    0,
  );

  if (totalEntries === 0) {
    return {
      currentStreak: 0,
      longestStreak: 0,
      totalEntries: 0,
      totalWords: 0,
    };
  }

  // Longest streak
  let longestStreak = 1;
  let runLen = 1;
  for (let i = 1; i < dates.length; i++) {
    if (daysDiff(dates[i - 1], dates[i]) === 1) {
      runLen++;
      if (runLen > longestStreak) longestStreak = runLen;
    } else {
      runLen = 1;
    }
  }

  // Current streak (backwards from today)
  const today = formatToday();
  const dateSet = new Set(dates);
  let currentStreak = 0;
  let cursor = today;
  while (dateSet.has(cursor)) {
    currentStreak++;
    cursor = addDays(cursor, -1);
  }

  if (currentStreak > longestStreak) longestStreak = currentStreak;

  return { currentStreak, longestStreak, totalEntries, totalWords };
}
