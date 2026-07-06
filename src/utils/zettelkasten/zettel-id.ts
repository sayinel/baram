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

function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}
