// §69 / 0090 final review (M1) — the engines floor, asked of the RUNNING APP.
//
// ‼️ SPLIT FROM `engines.ts` ON PURPOSE. That file is pure comparison logic and
// `scripts/validate-index.ts` imports it to run the same grammar at publish time, in plain
// Node with no webview: giving it a `@tauri-apps/api` import would make the publish gate
// depend on the app runtime. Everything that needs to ask the backend what version it is
// lives here instead, and only app code imports it.
//
// Both wrappers used to live in `components/plugins/install-transaction.ts`, beside the
// plugin install transaction — which also pulls in `pluginLoader` and the plugin consent
// machinery, so the theme path could not reach them without dragging all of that with it.

import { getVersion } from "@tauri-apps/api/app";

import { logger } from "../utils/logger";
import { parseBaramFloor, unmetBaramFloor } from "./engines";

/** The running app version, or null when it cannot be read. */
export async function currentAppVersion(): Promise<null | string> {
  try {
    return (await getVersion()) ?? null;
  } catch (err) {
    // Not an install failure. Nothing about the package is known to be wrong, so the
    // caller proceeds — the direction-of-doubt note is in `engines.ts`'s header.
    logger.warn("[engines] could not read the app version:", err);
    return null;
  }
}

/**
 * The floor and the version that fails it, or null when the install may proceed.
 *
 * The app version is read only once a floor has actually been parsed — most manifests state
 * either no floor this can evaluate or one that is met, and there is no reason to ask the
 * backend for our own version to answer a question with no floor in it.
 *
 * Read per call rather than once on mount: a `null` window during the first frames would
 * silently skip the check for precisely the impatient click the gate exists to stop.
 */
export async function unmetFloorAgainstApp(
  engines: undefined | { baram: string },
): Promise<null | { appVersion: string; floor: string }> {
  if (parseBaramFloor(engines?.baram) === null) return null;
  const appVersion = await currentAppVersion();
  // `unmetBaramFloor` treats an unreadable version as "no opinion" too; narrowing it here
  // is what lets a caller's message name the version the reader is actually on.
  if (appVersion === null) return null;
  const floor = unmetBaramFloor(appVersion, engines);
  return floor === null ? null : { appVersion, floor };
}
