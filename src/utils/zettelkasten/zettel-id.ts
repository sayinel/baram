/** §94 Zettelkasten note ID = YYYYMMDDHHmm (local time), seconds appended on collision. */
export function generateZettelId(existingIds: Set<string>): string {
  const d = new Date();
  const stamp =
    `${d.getFullYear()}${pad(d.getMonth() + 1, 2)}${pad(d.getDate(), 2)}` +
    `${pad(d.getHours(), 2)}${pad(d.getMinutes(), 2)}`;
  if (!existingIds.has(stamp)) return stamp;
  // Collision within the same minute → append/scan seconds.
  for (let s = 0; s < 60; s++) {
    const withSec = stamp + pad(s, 2);
    if (!existingIds.has(withSec)) return withSec;
  }
  // Extremely unlikely: 60 notes in one minute — fall back to a longer suffix.
  let extra = 0;
  let candidate = stamp + "59" + pad(extra, 2);
  while (existingIds.has(candidate)) candidate = stamp + "59" + pad(++extra, 2);
  return candidate;
}

/**
 * LOCAL `YYYY-MM-DDTHH:mm` timestamp — mirrors the local-time logic used to
 * build zettel ids above, so a note's `created` frontmatter always agrees
 * with the local date/time baked into its id (avoids a UTC/local mismatch,
 * e.g. `new Date().toISOString()` which is UTC).
 */
export function localIsoMinute(): string {
  const d = new Date();
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1, 2)}-${pad(d.getDate(), 2)}` +
    `T${pad(d.getHours(), 2)}:${pad(d.getMinutes(), 2)}`
  );
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}
