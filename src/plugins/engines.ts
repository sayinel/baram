// §69 — the app-version floor a plugin declares, actually evaluated.
//
// `engines.baram` has been a required manifest field since §69 and nothing ever compared
// it to the running app: `manifest.ts` checks only that it is a non-empty string. The
// publish workflow DOES compare it (`plugin-release.yml`, "app version does not satisfy
// this plugin's engines.baram"), so the floor was enforced for first-party releases and
// ignored on every user's machine. The workflow's own comment names the consequence:
// an enabled Install for something that throws on activate — and on the UPDATE path the
// working older copy is deleted first, because an update is uninstall-then-install.
//
// GRAMMAR: `>=X.Y.Z`, and only that. Identical to the regex the publish gate uses, on
// purpose. Two gates understanding different grammars would disagree about the same
// manifest, and that disagreement lands on a user instead of on the author at publish
// time.
//
// DIRECTION OF DOUBT: an install is refused only when this can positively show the app is
// below a stated floor. An absent floor, a grammar it cannot parse, an app version it
// cannot read — all mean "no opinion", and the install proceeds. That is the OPPOSITE of
// `matchesRange`, which fails closed, and the asymmetry is deliberate: a revocation that
// mis-parses should still block, but an engines check that mis-parses would deny someone
// a plugin over a field the app cannot read and the user cannot fix.

import { compareVersions } from "./version-range";

/** The floor `raw` states, or null when it states none this can evaluate. */
export function parseBaramFloor(raw: string | undefined): null | string {
  if (raw === undefined) return null;
  const match = MINIMUM_RE.exec(raw.trim());
  return match === null ? null : match[1];
}

/**
 * The floor, when the running app is BELOW it. Null means the install may proceed.
 *
 * A prerelease app is below the release it precedes (`0.6.0-beta.1` < `0.6.0`), so it does
 * not satisfy a `>=0.6.0` floor. That is plain semver precedence, and it is the same
 * answer the publish gate gives — it refuses to publish against a prerelease app version
 * for the same reason: a prerelease is not the release that ships the floor.
 */
export function unmetBaramFloor(
  appVersion: null | string | undefined,
  engines: undefined | { baram: string },
): null | string {
  if (appVersion === null || appVersion === undefined || appVersion === "") {
    return null;
  }
  const floor = parseBaramFloor(engines?.baram);
  if (floor === null) return null;
  const cmp = compareVersions(appVersion, floor);
  // null = one side is not a version `compareVersions` can order. No opinion.
  if (cmp === null) return null;
  return cmp < 0 ? floor : null;
}

/**
 * `">=X.Y.Z"` and nothing else — anchored, no prerelease or build metadata on the floor.
 *
 * `\s*` after the operator only because `">= 0.5.0"` is the same statement to a human
 * writing it by hand. Everything else (`^0.5.0`, `~0.5`, `0.5.0`, `>0.5.0`, a range with
 * two bounds) is "no floor this can evaluate" rather than an error, per the header.
 */
const MINIMUM_RE = /^>=\s*(\d+\.\d+\.\d+)$/u;
