// §69 / §260 — archive extraction and network fetch size bounds.
//
// One home for the caps `install.rs`, `archive.rs`, `origin.rs` and `fetch.rs` each need to
// stay honest about how much untrusted data they will read. Kept together (rather than beside
// each consumer) because several of them are read from more than one of those files, and a
// bound duplicated per-consumer is a bound that can drift.

/// Response body cap for `http_fetch` (§69 Phase D network API).
pub(super) const MAX_FETCH_BYTES: usize = 10 * 1024 * 1024; // 10 MiB

/// Largest plugin archive we will download.
///
/// This is a MEMORY bound, not a policy about plugin size: `extract_zip_bytes` reads the
/// archive from a slice, so whatever arrives is held whole regardless. Without a cap a
/// hostile or compromised registry can name a `downloadUrl` that allocates until the
/// process dies — and it is reached before the checksum can say anything, because there is
/// nothing to hash until the download ends.
///
/// 32 MiB is far above anything legitimate. A sandboxed plugin is an ESM bundle and cannot
/// ship native code at all; the entire Baram binary targets under 15 MiB.
pub(super) const MAX_PLUGIN_ARCHIVE_BYTES: usize = 32 * 1024 * 1024;

// ‼️ THE DOWNLOAD CAP ABOVE DOES NOT BOUND THE EXTRACTION (#261). DEFLATE's theoretical
// ceiling is about 1032:1, so 32 MiB on the wire can become roughly 33 GB on disk — and
// `extract_zip_bytes` read each entry with `read_to_end` into an unbounded `Vec`, so memory
// went first. §69's earlier "guard the plugin download too" work bounded the wire and left
// this open; the two are different limits and only one of them existed.
//
// Every bound below is enforced on bytes ACTUALLY read, never on the sizes the archive
// declares about itself — those are written by whoever built the archive.

/// Most files one plugin archive may contain.
///
/// A sandboxed plugin is a bundle: a manifest, one or a few ESM chunks, a README, maybe
/// icons. Two thousand leaves enormous room while bounding the per-entry syscall storm that
/// a million-empty-file archive would otherwise buy for a few kilobytes on the wire.
pub(super) const MAX_ARCHIVE_ENTRIES: usize = 2_000;

/// Largest single file an archive may expand to.
pub(super) const MAX_ENTRY_BYTES: u64 = 64 * 1024 * 1024;

/// Largest total an archive may expand to across all entries.
///
/// Generous on purpose. The one published plugin expands to tens of kilobytes, but a plugin
/// bundling a dictionary, a font or a WASM module is a legitimate future shape, and a limit
/// that forbids those buys nothing — a bomb is orders of magnitude past this, not just over.
pub(super) const MAX_TOTAL_EXPANDED_BYTES: u64 = 256 * 1024 * 1024;

/// Largest expanded:compressed ratio tolerated once the output is big enough to judge.
///
/// Text and JS compress at roughly 3–10:1, so 100:1 is well clear of anything real while a
/// zip bomb needs hundreds or thousands to one to be worth building.
pub(super) const MAX_COMPRESSION_RATIO: u64 = 100;

/// The only compression methods a plugin archive may use.
///
/// ‼️ THIS IS A MEMORY BOUND, NOT A FORMAT PREFERENCE, and it closes the one hole every
/// other limit in this module is blind to (§69 security review, HIGH).
///
/// `zip = "8"` takes default features, so the crate compiles LZMA, PPMd, zstd, xz and bzip2
/// decoders. The LZMA decoder is built lazily on the FIRST READ of an entry — after
/// `by_index`, inside the very `read` that `take` wraps — and it sizes its dictionary from a
/// `dict_size` field in the entry payload, clamped only to ~4 GiB. The allocation therefore
/// happens BEFORE the first output byte exists, which is the only thing the four byte
/// ceilings can see. Measured: a 114-byte archive drove a single 512 MiB allocation straight
/// through `take(64 MiB + 1)` — 4.7M:1 against a documented 100:1 — and a failed
/// `alloc_zeroed` aborts the process rather than unwinding, so `spawn_blocking` cannot even
/// turn it into an error.
///
/// An ALLOWLIST rather than a denylist of the exotic methods, per this project's own rule:
/// a denylist admits the next decoder the crate gains by default. Plugin archives are built
/// by `zip -r` in `plugin-release.yml`, which emits Deflated, and `Stored` covers entries
/// too small to gain from compression. Nothing legitimate needs more.
///
/// Refusing the METHOD, not the declared size, is deliberate: the size is the attacker's
/// number, while the method is what decides whether a decoder that allocates from attacker
/// numbers is constructed at all.
pub(super) const ALLOWED_COMPRESSION: [zip::CompressionMethod; 2] = [
    zip::CompressionMethod::Stored,
    zip::CompressionMethod::Deflated,
];

/// Deepest path any entry may carry.
///
/// ‼️ Directories cost nothing the BYTE bounds can see (review M2). An entry contributes no
/// expanded bytes for its parents, so 2,000 entries each ~400 components deep fit in a
/// 3.2 MiB download and buy 800,000 `mkdir` calls — measured at ~57 s of blocking-pool time
/// to create and ~104 s to clean up. Every byte ceiling saw zero.
///
/// Counted in PATH COMPONENTS including the filename, so `dist/chunks/x.mjs` is 3. Sixteen
/// is far past anything real and takes the worst case to 2,000 × 16, which is seconds rather
/// than minutes.
///
/// Forward note: `stage_plugin` requires `baram-plugin.json` at the staged ROOT, so a
/// GitHub-style wrapper folder (`repo-v1.0.0/…`) already fails for an unrelated reason. If
/// a wrapper is ever tolerated, the budget here silently becomes 15.
pub(super) const MAX_PATH_DEPTH: usize = 16;

/// Below this much output the ratio is not evidence of anything.
///
/// Without a floor a 2 KiB archive of highly compressible text trips 100:1 at 200 KiB —
/// a plausible plugin refused for a statistic computed on too little data. A bomb has to
/// clear this floor before the ratio applies, which costs it nothing it can exploit: the
/// absolute totals above still bound it.
pub(super) const RATIO_FLOOR_BYTES: u64 = 1024 * 1024;
