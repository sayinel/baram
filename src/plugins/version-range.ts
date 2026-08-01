// §69 version comparison for plugin revocation — semver 2.0.0 precedence rules.
//
// No library. This repo has no semver dependency on either the JS or the Rust side,
// and what a revocation list needs is not the semver range GRAMMAR (carets, tildes,
// x-ranges, `||`) but the comparison of two versions. So the grammar is not parsed at
// all: a range arrives as a structure. That is deliberate — the revocation file is
// hand-edited under time pressure after a malware report, and `^2.0.0` is exactly the
// kind of shorthand whose meaning someone has to stop and recall.
//
// The comparison itself is written to spec rather than approximated. `2.0.10 > 2.0.9`
// (string comparison says otherwise), `1.0.0-alpha < 1.0.0`, and
// `1.0.0-alpha.1 < 1.0.0-alpha.2` are where a shortened implementation gets it wrong.

/**
 * A version range. `"*"` is every version.
 *
 * An object ANDs every bound it carries. An object with NO bounds (`{}`) does not mean
 * "everything" — it matches nothing. See {@link matchesRange}.
 */
export type VersionRange =
  | "*"
  | {
      eq?: string;
      gt?: string;
      gte?: string;
      lt?: string;
      lte?: string;
    };

/**
 * semver 2.0.0 precedence: negative when `a < b`, 0 when equal, positive when greater.
 *
 * Build metadata (`+…`) is excluded from precedence, as the spec requires. Null when
 * either side is not a version this can compare.
 */
export function compareVersions(a: string, b: string): null | number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (pa === null || pb === null) return null;

  for (let i = 0; i < 3; i++) {
    if (pa.main[i] !== pb.main[i]) return pa.main[i] - pb.main[i];
  }

  // A prerelease is lower than the release it precedes.
  if (pa.pre === null && pb.pre === null) return 0;
  if (pa.pre === null) return 1;
  if (pb.pre === null) return -1;

  return comparePre(pa.pre, pb.pre);
}

/**
 * Whether `version` falls in `range`.
 *
 * An unparseable version or bound fails every explicit bound, so such a range matches
 * nothing; `"*"` matches without parsing anything at all. The direction matters: one typo in
 * the revocation list blocking every plugin is far worse than one bad entry being
 * ignored. An attacker who controls the list could simply delete entries anyway, so
 * ignoring costs nothing against them. Validating the file's shape is the registry
 * CI's job, not this function's.
 */
export function matchesRange(version: string, range: VersionRange): boolean {
  if (range === "*") return true;
  const bounds: [keyof typeof range, (cmp: number) => boolean][] = [
    ["eq", (c) => c === 0],
    ["gt", (c) => c > 0],
    ["gte", (c) => c >= 0],
    ["lt", (c) => c < 0],
    ["lte", (c) => c <= 0],
  ];
  let checked = 0;
  for (const [key, ok] of bounds) {
    const bound = range[key];
    if (bound === undefined) continue;
    const cmp = compareVersions(version, bound);
    if (cmp === null || !ok(cmp)) return false;
    checked++;
  }
  // A bound-less object is not "everything". Use `"*"` to mean that, explicitly.
  return checked > 0;
}

/** Precedence between two prerelease identifier lists. */
function comparePre(a: (number | string)[], b: (number | string)[]): number {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i];
    const y = b[i];
    if (x === y) continue;
    const xNum = typeof x === "number";
    const yNum = typeof y === "number";
    // A numeric identifier always ranks below an alphanumeric one.
    if (xNum && !yNum) return -1;
    if (!xNum && yNum) return 1;
    if (xNum && yNum) return (x as number) - (y as number);
    return (x as string) < (y as string) ? -1 : 1;
  }
  // All shared identifiers equal: more identifiers ranks higher.
  return a.length - b.length;
}

/** `1.2.3`, `1.2.3-beta.1`, `1.2.3+build` → a comparable form, or null. */
function parseVersion(
  raw: string,
): null | { main: number[]; pre: (number | string)[] | null } {
  const match =
    /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/u.exec(
      raw.trim(),
    );
  if (match === null) return null;
  const main = [
    Number.parseInt(match[1], 10),
    Number.parseInt(match[2], 10),
    Number.parseInt(match[3], 10),
  ];
  if (match[4] === undefined) return { main, pre: null };
  const pre = match[4]
    .split(".")
    // Only a purely numeric identifier counts as numeric. `01` is invalid per spec;
    // here it falls through as a string so comparison still works — this function
    // orders versions, it does not validate them.
    .map((id) => (/^\d+$/u.test(id) ? Number.parseInt(id, 10) : id));
  return { main, pre };
}
