---
title: "The registry JSON shape"
---


## The registry JSON shape

The marketplace fetches a single JSON document — a `RegistryIndex` — and
deserializes it on the Rust side (`fetch_registry`), entry by entry:

```typescript
interface RegistryIndex {
  plugins: RegistryEntry[];
  updatedAt?: string;
}

interface RegistryEntry {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  license: string;
  downloadUrl: string; // URL of a hosted plugin ZIP
  checksum: string; // SHA-256 of that ZIP, hex-encoded
  capabilities: PluginCapability[];
  trust: "sandboxed" | "trusted"; // required — see below
  engines: { baram: string };
  icon?: string;
  keywords?: string[];
  downloads?: number;
  repository?: string;
  homepage?: string;
}
```

All keys are camelCase on the wire (matching `baram-plugin.json` and the TS
types in `src/plugins/types.ts`). `downloadUrl` must point at a hosted ZIP
containing the plugin (same contents as the packaging step below); `checksum`
is that ZIP's SHA-256, hex-encoded. Registry installs verify `checksum`
before extracting the ZIP — the host refuses to install a package whose hash
doesn't match.

### Archive limits

The download and the extraction are bounded separately, because a small archive
can expand to an enormous one:

| Limit | Value |
| --- | --- |
| Compression method | `Stored` or `Deflated` only |
| Archive size on the wire | 32 MiB |
| Files in the archive | 2,000 |
| Path components in any entry | 16 (`dist/chunks/x.mjs` is 3) |
| Any single file, expanded | 64 MiB |
| All files together, expanded | 256 MiB |
| Expanded ÷ compressed ratio | 100:1, or 1 MiB, whichever is larger |

These are set far above anything a real plugin needs — the published reference
plugin expands to tens of kilobytes, and `dist/chunks/index.mjs` is depth 3 —
and exist to stop a hostile archive from exhausting memory or disk. If you have
a legitimate reason to exceed one (a bundled dictionary, a font, a WASM module),
open an issue; the ratio limit in particular is deliberately loose enough for
ordinary compressible assets, and the 1 MiB allowance means small archives are
never judged on a ratio computed from too little output.

Extraction stops at the first limit reached, **while unpacking** rather than
afterwards, so an archive that would exceed one never gets to write the excess.

Every byte limit is enforced on bytes actually read, not on the sizes the
archive declares in its own headers, so a mis-stated size will not get you past
them. The compression allowlist is separate and stricter for a reason: LZMA and
PPMd size their internal buffers from the archive *before* producing a single
byte, so no read limit can bound them — `zip -r`, which is what the release
pipeline runs, produces `Deflated`.

### A malformed entry costs only itself

Every field above without a `?` is required **of you**, but Baram does not fail
the whole document when one is missing. An entry it cannot read is dropped and
the rest of the index is served, so one contributor's typo cannot empty the
marketplace for everyone. `engines` is looser still: it may be absent on the
wire, because a missing floor already means "no opinion" to the version gate,
and deleting an installable plugin over it would be the worse answer.

That tolerance is the reader being liberal, not the requirements going soft —
and it is silent, which is the trade. A dropped entry looks exactly like an
entry nobody published. The signal lives at publish time instead:
`scripts/validate-index.ts` reads the index with the app's own parsers and
refuses anything the app would quietly prune, demote, or stop protecting. It
runs in `npm run lint:frontend`, in `plugin-release.yml`, and on every pull
request to `sayinel/baram-plugins` itself, against the entire index rather than
only the entry being added.

It judges the *document*, though — it has never opened an archive, because in
this repository there are none. `scripts/validate-registry-assets.ts` is the
other half: given a checkout of the registry, it resolves each entry's
`downloadUrl` the way GitHub Pages will, requires a regular file to be there,
and hashes it against the declared checksum. An entry naming a missing file, or
carrying a stale checksum, otherwise deploys cleanly and 404s or fails
integrity for every user.

Run both before proposing a registry change:

```bash
npx tsx scripts/validate-index.ts path/to/index.json
npx tsx scripts/validate-registry-assets.ts path/to/registry-checkout
```

### `trust` and `capabilities` are a claim the install verifies

`trust` is **required**. An entry without it is shown with a "Legacy" badge and its
Install button is disabled: the manifest inside the ZIP must declare a tier, so
offering the install would only download first and fail second.

`trust` and `capabilities` here are what the user is asked to approve **before** the
download — the consent dialog is built from the registry entry, because that is all the
app knows at that point. After the ZIP is fetched, the manifest inside it is checked
against what was approved, and the install is rolled back if it asks for more:

- a manifest declaring `trust: "trusted"` where the entry said `"sandboxed"`
- a manifest requesting a capability the entry did not list
- a manifest whose `id` differs from the entry's

Nothing is written to the plugin store until all three pass, so a registry that
advertises one thing and ships another fails the install rather than escalating it.
Listing _fewer_ capabilities in the manifest than in the entry is fine — the check is
"does not exceed", not "matches exactly" — and `files` covers `files:readonly`, as does
`editor` for `editor:readonly`.

Keep the entry in step with the manifest you ship. A mismatch is not a warning.
