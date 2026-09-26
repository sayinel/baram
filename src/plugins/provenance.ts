// §382 — where a plugin's code comes from, as the UI states it. One pure function for the
// card, the Installed row, the detail view and the consent dialog, so no two of them can
// come to disagree about the same plugin.
import type { RegistryChannel } from "./types";

import { isGithubLogin } from "./community-registry";

/** A community plugin is shown with its publisher; a first-party one with Baram's name. */
export type Provenance =
  { channel: "community"; publisher: string } | { channel: "first-party" };

/** Anything that records a channel — a listing (`RegistryEntry`) or a consent record. */
interface ChannelSource {
  channel?: RegistryChannel;
  publisher?: string;
}

/**
 * `null` when nothing says where the code came from: an install recorded before §382, a dev
 * folder, a built-in — spec 0058 §9.3 gives those no badge rather than a guess.
 *
 * A community source whose publisher is not a GitHub login is `null` too. An installed
 * plugin's provenance is its consent record, which comes back from `config.json` — a file
 * the webview can write — so the login grammar the ingest applied (`isGithubLogin`) is
 * applied again here, the last step before the string reaches the screen.
 */
export function provenanceOf(
  source: ChannelSource | undefined,
): null | Provenance {
  if (source?.channel === "first-party") return { channel: "first-party" };
  if (source?.channel === "community" && isGithubLogin(source.publisher)) {
    return { channel: "community", publisher: source.publisher };
  }
  return null;
}

/** The publisher's GitHub profile: always https, always github.com, login already checked. */
export function publisherProfileUrl(login: string): string {
  return `https://github.com/${login}`;
}
