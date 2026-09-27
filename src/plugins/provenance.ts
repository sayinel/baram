// §382 — where a plugin's code comes from, as the UI states it. One pure function for the
// card, the Installed row, the detail view and the consent dialog, so no two of them can
// come to disagree about the same plugin.
import type { PluginConsent, RegistryChannel } from "./types";

import { isGithubLogin } from "./community-registry";

/**
 * A community plugin is shown with its publisher; a first-party one with Baram's name.
 * `previousPublisher` is the consent dialog's alone (`consentProvenance`).
 */
export type Provenance =
  | { channel: "community"; previousPublisher?: string; publisher: string }
  | { channel: "first-party" };

/** Anything that records a channel — a listing (`RegistryEntry`) or a consent record. */
interface ChannelSource {
  channel?: RegistryChannel;
  publisher?: string;
}

/**
 * The consent dialog's provenance: `provenanceOf(consent)`, plus — when a community plugin's
 * publisher ACCOUNT changed since `prior` was recorded — the login it replaces, for the
 * "@a → @b" line (spec 0058 §9.3). Keyed on the id, like `consentGaps`: a renamed login with
 * the same id is the same publisher and gets no line. `undefined` for a consent that names no
 * channel (a dev folder); the dialog then says nothing about provenance.
 */
export function consentProvenance(
  consent: PluginConsent,
  prior?: PluginConsent,
): Provenance | undefined {
  const provenance = provenanceOf(consent);
  if (provenance === null) return undefined;
  if (provenance.channel !== "community") return provenance;
  const previous = provenanceOf(prior);
  if (
    previous?.channel === "community" &&
    prior?.publisherId !== consent.publisherId
  ) {
    return { ...provenance, previousPublisher: previous.publisher };
  }
  return provenance;
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
