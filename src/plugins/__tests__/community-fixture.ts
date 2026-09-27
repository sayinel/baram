// §382 — one `community.json` entry exactly as spec 0058 contract C1 shapes it: every
// `RegistryEntry` field plus `publisher` (a GitHub login), `publisherId`, `repoId` and
// `repository`. Shared so every suite that needs a community listing agrees on the wire.
// Values follow spec 0058 §7.1's example submission (`hello-counter` by `octocat`); any
// positive integers satisfy C1's two ids.
//
// NO `channel`: that is not on the wire. A suite that needs a listing as `fetchRegistryIndex`
// SERVES it passes `{ channel: "community" }`.
import type { RegistryEntry } from "../types";

export function communityEntry(
  over: Partial<RegistryEntry> = {},
): RegistryEntry {
  return {
    author: "Octo Cat",
    capabilities: ["events"],
    checksum: "b".repeat(64),
    description: "Counts things",
    downloadUrl:
      "https://sayinel.github.io/baram-plugins/plugins/hello-counter-1.2.0.zip",
    engines: { baram: ">=0.8.0" },
    id: "hello-counter",
    license: "MIT",
    name: "Hello Counter",
    publisher: "octocat",
    publisherId: 583231,
    repoId: 1296269,
    repository: "https://github.com/octocat/baram-hello-counter",
    trust: "sandboxed",
    version: "1.2.0",
    ...over,
  };
}
