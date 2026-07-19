// §71 Shared snapshot timestamp formatting helpers (VersionHistoryPanel + FileHistoryView)

/** Relative time label ("5m ago", "3d ago", ...) falling back to a locale date string. */
export function formatSnapshotTime(timestamp: string): string {
  const date = parseTimestamp(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString();
}

/**
 * Rust backend uses a filesystem-safe UTC format: "2026-03-07T10-00-00"
 * (hyphens instead of colons). Convert to standard ISO 8601 with a UTC
 * indicator: "2026-03-07T10:00:00Z".
 */
export function parseTimestamp(timestamp: string): Date {
  const iso = timestamp.replace(/T(\d{2})-(\d{2})-(\d{2})$/, "T$1:$2:$3Z");
  return new Date(iso);
}
