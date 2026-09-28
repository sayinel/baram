/**
 * §380 gate 6 — read a community plugin archive the way the app will, inside the app's bounds
 * (spec 0058 §7.2).
 *
 * The app extracts with Rust's `zip` crate 8.6.0 (`src-tauri/src/plugin/archive.rs` →
 * `crate::fs::archive`); this reads with `@zip.js/zip.js`. Two readers can disagree about one
 * archive. Spec 0058 accepted that because the app re-judges the manifest it extracted (G5) —
 * and that still holds for capabilities, tier and id: a disagreement cannot widen a grant.
 * ‼️ It does NOT hold for display fields. The install re-checks the manifest's id, tier,
 * capabilities and floor against the listing, not its `name`, `description` or `author`, so an
 * archive the two readers read differently can install a manifest nobody reviewed (plan 0105
 * P26 — measured with a Unicode Path extra field). So this module does not "keep disagreements
 * few"; it REFUSES every class of disagreement it knows:
 *
 * - an end of the archive the two readers can resolve to different directories, judged on the
 *   bytes before either parses them (`tailProblem`): the `zip` crate retries from an earlier
 *   end record when it cannot read the last one's directory, and follows an offset that zip.js
 *   corrects to the directory beside the end record
 * - what zip.js itself flags: it reads at `strictness: "strict"`, which throws on its ambiguity
 *   checks, and a warning it still records is refused like an error — on the reader
 *   (`ZipReader#warnings`) or on an entry as its data is read (`EntryMetaData#warnings`), the two
 *   places zip.js 2.18.2's types say a reader records one. Every entry is read, directories
 *   included, so every local header is checked (see `readPluginArchive`)
 * - extra fields other than the two `zip -r` writes (0x7075 renames an entry for one reader),
 *   and an extended timestamp (0x5455) the `zip` crate cannot parse
 * - names with non-ASCII bytes (CP437 versus a UTF-8 guess), and names the app rewrites or
 *   Windows aliases — refused, not skipped: `enclosed_name` rewrites them onto other entries
 * - names that fold together by case or Unicode form, duplicates, symbolic links, encryption,
 *   and entries zip.js calls directories while the crate, going by the name, calls them files
 * - CRC32 mismatches, which the `zip` crate refuses too (`checkSignature` turns on zip.js's CRC
 *   check; plan 0105 P1 records why fflate was rejected: it returned a corrupted entry without
 *   complaint), and declared-size mismatches, which zip.js always refuses and the crate does
 *   not check — the gate is the stricter reader there
 * - the root `README.md`, bounded by the same cap the app's own registry fetch enforces
 *   (`readmeByteCap` / `fetch.rs`'s `MAX_README_BYTES`) — a README that only exceeds this cap
 *   would publish beside the archive and then never render, because the fetch that shows it on
 *   the plugin's page refuses to read past that many bytes
 *
 * A class this list does not know stays open; the app-side second layer is a backlog item.
 *
 * The bounds are the app's own, scraped from `limits.rs`, and are enforced on bytes ACTUALLY
 * read — the sink throws past the cap — never on sizes the archive declares about itself. That
 * is `crate::fs::archive::extract_entry`'s rule, including its ratio floor.
 */
import type { PluginArchiveLimits } from "./rust-constants";
import type { Entry, FileEntry } from "@zip.js/zip.js";

import { configure, Uint8ArrayReader, ZipReader } from "@zip.js/zip.js";
import { posix } from "node:path";

// No workers: this runs in a CI step and under vitest, neither of which should spawn any.
configure({ useWebWorkers: false });

export type ArchiveVerdict =
  | { archive: PluginArchive; ok: true }
  | { error: string; ok: false };

export interface PluginArchive {
  /** Every file entry (directories excluded), in archive order. */
  files: string[];
  /** `baram-plugin.json`, parsed — not yet validated (gate 7 does that). */
  manifest: unknown;
  /** The root `README.md`'s bytes, published beside the archive; null when there is none. */
  readme: null | Uint8Array;
}

const MANIFEST = "baram-plugin.json";
const README = "README.md";
const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;

/** `50 4B 05 06`, read little-endian: the end-of-central-directory signature. */
const END_SIGNATURE = 0x06054b50;
/** The end record's length with no comment. */
const END_LENGTH = 22;
/** `50 4B 06 07`, read little-endian: the Zip64 end-of-central-directory locator's signature. */
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
/** The Zip64 locator's length — both readers look for it this far before the end record. */
const ZIP64_LOCATOR_LENGTH = 20;

/**
 * @param readmeCap The app's `readmeByteCap` — required, not defaulted, so a caller that
 *   forgets it fails typecheck instead of silently reading an archive without the README bound.
 */
export async function readPluginArchive(
  bytes: Uint8Array,
  limits: PluginArchiveLimits,
  readmeCap: number,
): Promise<ArchiveVerdict> {
  const refuse = (error: string): ArchiveVerdict => ({ error, ok: false });
  const tail = tailProblem(bytes);
  if (tail !== null) return refuse(tail);
  // Two layers over zip.js's own judgement. "strict" makes it THROW where "balanced" would
  // read on and record a warning: prepended or appended data, trailing directory data, a
  // duplicate name, a mismatched Zip64 end record — and it refuses "." and empty path
  // components. An end record whose offset names a directory other than the one beside it
  // (which `tailProblem` already refuses) is one: zip.js moves to the directory beside it,
  // counts what it skipped as prepended data, and throws `Ambiguous archive`. The warnings
  // check below refuses what "strict" still only records — an unsorted directory, an unknown
  // version, compressed patched data, a malformed extra field, unknown Zip64 extensible data:
  // the warnings zip.js 2.18.2 documents under `ZipReader.warnings`, less the two "strict"
  // never records (a wrapped entry count, which it does not recover, and a prepended central
  // directory, which comes with prepended data and so throws first). An entry's LOCAL header is
  // read only with its data, and what "strict" records about it (a malformed extra field) lands
  // on `EntryMetaData.warnings` instead — refused after each read, below.
  const irregular = (reason: string, filename: string | undefined): ArchiveVerdict =>
    refuse(
      `the gate's reader reports ${JSON.stringify(reason)}${filename === undefined ? "" : ` at entry ${JSON.stringify(filename)}`} — the gate refuses any archive its reader finds irregular, because the app's zip crate resolves irregularities by rules of its own`,
    );
  const reader = new ZipReader(new Uint8ArrayReader(bytes), {
    checkOverlappingEntry: true,
    checkSignature: true,
    strictness: "strict",
  });
  try {
    let entries: Entry[];
    try {
      entries = await reader.getEntries();
    } catch (err) {
      // `Ambiguous archive` carries the check that tripped it in `reason`.
      const reason = (err as null | { reason?: unknown })?.reason;
      return refuse(
        `not a readable ZIP archive (${String(err)}${typeof reason === "string" ? `: ${reason}` : ""})`,
      );
    }
    const structural = structuralProblem(entries, limits);
    if (structural !== null) return refuse(structural);
    const [warning] = reader.warnings ?? [];
    if (warning !== undefined) return irregular(warning.reason, warning.filename);

    const allowance = Math.max(
      bytes.length * limits.maxCompressionRatio,
      limits.ratioFloorBytes,
    );
    const kept = new Map<string, Uint8Array>();
    let total = 0;
    // Directories too: the app's zip crate opens every entry (`by_index` reads its local header
    // first, directories included), so a directory whose local header is missing fails the
    // install. Reading the entry is how zip.js checks that header — zip.js 2.18.2 attaches
    // `getData` to every entry, though its types declare it on `FileEntry` alone.
    for (const entry of entries as FileEntry[]) {
      const byTotal = limits.maxTotalExpandedBytes - total;
      const byRatio = allowance - total;
      // Only bounds the root README — every other entry sees Infinity here, so it never wins
      // the `Math.min` below. Named first in the refusal below whenever it is the cap that
      // bound the read (equal to the minimum), because it is the one bound about this file
      // alone; the ratio and total messages are about the whole archive.
      const byReadme = entry.filename === README ? readmeCap : Infinity;
      const cap = Math.min(limits.maxEntryBytes, byTotal, byRatio, byReadme);
      const keep = entry.filename === MANIFEST || entry.filename === README;
      const chunks: Uint8Array[] = [];
      let written = 0;
      try {
        await entry.getData(
          new WritableStream<Uint8Array>({
            write(chunk) {
              written += chunk.length;
              if (written > cap) throw new Error("over the cap");
              if (keep) chunks.push(chunk.slice());
            },
          }),
        );
      } catch (err) {
        if (written > cap) {
          // Which ceiling bit, named the way `extract_entry` names it — ratio first among the
          // caps that mirror it, because at a shared boundary "this looks like a bomb" is the
          // useful thing to say. The README bound is the gate's own: the app's listing fetch
          // refuses a README over `MAX_README_BYTES` (`fetch.rs`, read by `readmeByteCap`).
          return refuse(
            cap === byReadme
              ? `${README} is over the ${readmeCap}-byte limit the app's registry fetch enforces — a larger README would publish beside the archive and never render`
              : cap === byRatio
                ? `expands past the ${allowance} bytes allowed for its ${bytes.length} bytes on the wire (${limits.maxCompressionRatio}:1, minimum ${limits.ratioFloorBytes})`
                : cap === byTotal
                  ? `expands past the ${limits.maxTotalExpandedBytes}-byte total limit`
                  : `entry ${JSON.stringify(entry.filename)} exceeds the ${limits.maxEntryBytes}-byte per-file limit`,
          );
        }
        return refuse(
          `entry ${JSON.stringify(entry.filename)} could not be read (${String(err)}) — the gate refuses an entry its reader cannot read cleanly: a missing local header or a CRC mismatch fails the app's install too, and a declared-size mismatch or a local header that disagrees with the central one the gate refuses on its own`,
        );
      }
      const [local] = entry.warnings ?? [];
      if (local !== undefined) return irregular(local.reason, entry.filename);
      total += written;
      if (keep) kept.set(entry.filename, concat(chunks, written));
    }

    const manifestBytes = kept.get(MANIFEST);
    if (manifestBytes === undefined) {
      return refuse(`no ${MANIFEST} at the archive root — the app requires it there`);
    }
    let manifest: unknown;
    try {
      manifest = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(manifestBytes));
    } catch {
      return refuse(`${MANIFEST} is not valid UTF-8 JSON`);
    }
    const files = entries.filter((entry) => !entry.directory).map((entry) => entry.filename);
    const main = (manifest as null | { main?: unknown })?.main;
    if (typeof main === "string" && !files.includes(posix.normalize(main))) {
      return refuse(`main ${JSON.stringify(main)} names no file in the archive`);
    }
    return { archive: { files, manifest, readme: kept.get(README) ?? null }, ok: true };
  } finally {
    await reader.close();
  }
}

/**
 * Why the end of the archive is refused, or null — judged on the bytes, before either reader
 * parses them.
 *
 * The `zip` crate 8.6.0 finds its end record by scanning back from the end of the file for the
 * signature, and when it cannot read the directory that record describes — ANY error, from a
 * disk number to an extra field it rejects — it scans on to the next earlier signature and
 * tries again (`read/zip_archive.rs` `get_metadata`, `spec.rs` `find_central_directory`). zip.js
 * picks its end record by rules of its own (`findEndOfCentralDirectory`). So the signature must
 * occur exactly once: a second one, wherever it sits, is a record the crate may settle on.
 *
 * With one record, the rest pins down which directory both readers read:
 * - it ends the file with no comment, as `zip -r` writes it: the crate accepts bytes after the
 *   record, zip.js at "strict" refuses them, and a comment is where a second record can hide
 * - disk 0 in both disk fields: the crate refuses a record whose two disk numbers differ
 *   (`read_central_header`); zip.js refuses a "this disk" other than 0 and, reading one buffer,
 *   places the directory's disk at offset 0 whatever number it has (`getDiskOffset`)
 * - one entry count: the crate reads the count on this disk (`CentralDirectoryInfo::try_from`),
 *   zip.js the total
 * - no Zip64 placeholder — 0xFFFF entries, a 0xFFFFFFFF size or offset, the three the crate's
 *   `may_be_zip64` reads; zip.js's `requiresZip64` reads those and 0xFFFF as the directory's
 *   disk, which the disk rule above already refuses. Only a placeholder sends either reader to
 *   the Zip64 locator, and both look for it exactly `ZIP64_LOCATOR_LENGTH` bytes before the end
 *   record — then follow it differently. A locator signature there is refused too, placeholder
 *   or not
 * - the directory ends where the end record starts: otherwise zip.js moves to the directory
 *   beside the end record while the crate follows the stored offset
 */
export function tailProblem(bytes: Uint8Array): null | string {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let count = 0;
  let at = -1;
  for (let i = bytes.indexOf(0x50); i !== -1 && i + 4 <= bytes.length; i = bytes.indexOf(0x50, i + 1)) {
    if (view.getUint32(i, true) === END_SIGNATURE) {
      count += 1;
      at = i;
    }
  }
  if (count === 0) return "not a readable ZIP archive (no end-of-central-directory record)";
  if (count > 1) {
    return `holds the end-of-central-directory signature (50 4B 05 06) ${count} times — the app's zip crate falls back to an earlier end record when it cannot read the last one, so the gate cannot know which files the app would install. Compressed data that happens to hold those four bytes is refused too: rare, and if it happens, re-zip at another compression level`;
  }
  if (at !== bytes.length - END_LENGTH || view.getUint16(at + 20, true) !== 0) {
    return "has an archive comment or bytes after its end-of-central-directory record — the app's zip crate and the gate's reader treat bytes there differently, so the gate accepts only an end record that ends the file, as zip -r writes it";
  }
  const thisDisk = view.getUint16(at + 4, true);
  const directoryDisk = view.getUint16(at + 6, true);
  if (thisDisk !== 0 || directoryDisk !== 0) {
    return `says it spans disks (this disk ${thisDisk}, central directory on disk ${directoryDisk}) — the app's zip crate and the gate's reader handle a multi-disk end record differently, and a single-file archive has only disk 0`;
  }
  const onThisDisk = view.getUint16(at + 8, true);
  const entries = view.getUint16(at + 10, true);
  if (onThisDisk !== entries) {
    return `says ${onThisDisk} entries on this disk but ${entries} in all — the app's zip crate reads the first count and the gate's reader the second`;
  }
  const size = view.getUint32(at + 12, true);
  const offset = view.getUint32(at + 16, true);
  if (entries === 0xffff || size === 0xffffffff || offset === 0xffffffff) {
    return "has a Zip64 placeholder (0xFFFF or 0xFFFFFFFF) in its end-of-central-directory record — that sends each reader looking for a Zip64 record, which they look for differently, and no archive within the app's size and entry caps needs one";
  }
  if (offset + size !== at) {
    return "says its central directory ends somewhere other than where its end record starts — the app's zip crate follows the stored offset and the gate's reader can move to the directory beside the end record, so the two can read different directories";
  }
  if (at >= ZIP64_LOCATOR_LENGTH && view.getUint32(at - ZIP64_LOCATOR_LENGTH, true) === ZIP64_LOCATOR_SIGNATURE) {
    return "has a Zip64 locator signature (50 4B 06 07) right before its end record — the gate refuses anything that could send a reader down the Zip64 path, which the app's zip crate and the gate's reader walk differently";
  }
  return null;
}

function concat(chunks: readonly Uint8Array[], length: number): Uint8Array {
  const out = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

/**
 * The checks that need no decompression. Entry count is checked before this loop runs, matching
 * `check_entry_count` in the app's `crate::fs::archive` — the app's own first defense. Method
 * and path depth, at the end of the loop below, mirror `extract_entry`'s next two checks there,
 * in the same relative order (method before depth). Encryption mirrors the `zip` crate itself:
 * `by_index` refuses an encrypted entry without a password. Everything else here is the GATE'S
 * OWN, with no counterpart in the app — extra fields, non-ASCII name bytes, the component name
 * rule and Windows device names, case/Unicode-form folding and duplicates, symbolic links, and
 * the directory-or-file agreement. Extra fields run first because every later check reads
 * `entry.filename`, and an extra field is exactly how the two readers can end up disagreeing
 * about what that name is (plan 0105 P26).
 */
function structuralProblem(entries: readonly Entry[], limits: PluginArchiveLimits): null | string {
  if (entries.length > limits.maxEntries) {
    return `declares ${entries.length} entries, over the ${limits.maxEntries} limit`;
  }
  // Keyed by the name AS A FILE SYSTEM SEES IT (plan 0105 P7): the app writes
  // `output_dir.join(name)`, and APFS and NTFS fold case. Two names that fold together are one
  // file there — the later entry overwrites the earlier. Behind the ASCII rule below only case
  // is left to fold, but the NFC + upper-then-lower key stays as defense in depth: if that rule
  // is ever widened, NFD spellings and the pairs `toLowerCase` alone misses (`ſ`→`s`, `ß`→`ss`,
  // measured in Node 24) still meet. Which folding table each file system applies is NOT
  // verified here; folding wider only refuses more.
  const seen = new Map<string, string>();
  for (const entry of entries) {
    const name = JSON.stringify(entry.filename);
    // FIRST, because every later check reads `entry.filename`, and an extra field is how the
    // two readers come to disagree about what that name is (plan 0105 P26).
    const extra = extraFieldProblem(entry.rawExtraField);
    if (extra !== null) return `entry ${name} ${extra}`;
    // Raw bytes, not the decoded name: without the UTF-8 flag the `zip` crate decodes CP437 and
    // zip.js guesses UTF-8. ASCII bytes decode the same way under both, so past this line
    // `entry.filename` is the name the app will see.
    if (entry.rawFilename.some((byte) => byte >= 0x80)) {
      return `entry ${name} has a byte outside ASCII in its name — the app's zip crate and the gate's reader can decode it differently`;
    }
    const unsafe = unsafeName(entry.filename);
    if (unsafe !== null) {
      return `entry ${name} has ${unsafe} — the app rewrites such a name, or Windows aliases it, so it can land on another entry`;
    }
    const folded = entry.filename.normalize("NFC").toUpperCase().toLowerCase();
    const earlier = seen.get(folded);
    // zip.js at "strict" refuses an exact duplicate before this runs; the `zip` crate keeps
    // the later of two records with one name (`SharedBuilder::build` inserts into an IndexMap).
    if (earlier === entry.filename) {
      return `entry ${name} appears twice — the app's zip crate keeps only the later record, so the earlier copy is never installed`;
    }
    if (earlier !== undefined) {
      return `entry ${name} collides with ${JSON.stringify(earlier)} where names fold case or Unicode form (macOS, Windows) — the app would write one over the other`;
    }
    seen.set(folded, entry.filename);
    if (entry.encrypted) {
      return `entry ${name} is encrypted — the app's zip crate will not read it without a password, so the install would fail`;
    }
    if (entry.symlink || ((entry.externalFileAttributes >>> 16) & S_IFMT) === S_IFLNK) {
      return `entry ${name} is a symbolic link — the app writes it as a regular file`;
    }
    // zip.js calls an entry a directory by its Unix mode, its upper attribute bits, the MS-DOS
    // directory bit (when made by MS-DOS) or a trailing "/"; the `zip` crate by a trailing "/"
    // or "\" alone (`is_dir`). A "\" never reaches this line (the name rule refuses it), and
    // zip.js calls every name ending in "/" a directory — so only this direction can differ.
    if (entry.directory !== entry.filename.endsWith("/")) {
      return `entry ${name} is a directory to the gate's reader and a file to the app's zip crate, which goes by the name alone — the app would install a file the gate never read`;
    }
    if (!limits.allowedMethods.includes(entry.compressionMethod)) {
      return `entry ${name} uses compression method ${entry.compressionMethod}; the app allows only ${limits.allowedMethods.join(" and ")}`;
    }
    const depth = entry.filename.replace(/\/$/u, "").split("/").length;
    if (depth > limits.maxPathDepth) {
      return `entry ${name} has ${depth} path components, over the ${limits.maxPathDepth} limit`;
    }
  }
  return null;
}

/**
 * The extra-field records a plain `zip -r` writes — MEASURED on all eight live first-party
 * archives (plan 0105 Task 4 Step 7, 2026-09-27; `baram-ai-summary`, `baram-bullet-threading`
 * 2.0.0/2.0.1/2.1.0, `baram-word-count` 1.0.0/1.0.1/2.0.0/2.1.0): 0x5455 (extended timestamp)
 * and 0x7875 (Info-ZIP UID/GID), in both headers, and nothing else.
 *
 * ‼️ AN ALLOWLIST, not a list of the dangerous ids. The `zip` crate applies 0x7075 (Info-ZIP
 * Unicode Path) whenever it is present and zip.js only when the UTF-8 flag is clear, so one
 * archive can name an entry `notes.json` for the gate and `baram-plugin.json` for the app
 * (plan 0105 P26). The next field either reader learns to interpret would be the next such
 * difference; refusing everything `zip -r` does not write closes the class. 0x0001 (Zip64) is
 * left out on purpose: nothing under the 32 MiB cap needs it.
 */
const ALLOWED_EXTRA_FIELDS: readonly number[] = [0x5455, 0x7875];

const DIFFERENTLY = "the app's zip crate and the gate's reader can read such a field differently";

/**
 * Walks the CENTRAL header's extra field (both readers name entries from it; the `zip` crate
 * never parses the local copy — `find_data_start` reads only its length).
 *
 * Of the two allowed records, the crate parses one: 0x7875 is not an id it knows, so it reads
 * the declared length and ignores it (`parse_single_extra_field`), and only a record that runs
 * past the field can make it fail. 0x5455 goes to `ExtendedTimestamp::try_from_reader`, which refuses a
 * length of 0, and any length other than 5 or 1 plus 4 per bit set in the flags byte. A refusal
 * there fails `ZipArchive::new`: the archive would publish and never install (plan 0105 P7).
 */
function extraFieldProblem(raw: Uint8Array): null | string {
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  for (let at = 0; at < raw.length; ) {
    // A record that runs past the field: the `zip` crate errors when it reads that record, and
    // zip.js marks the field malformed and reads on. Bytes left over after the last record: the
    // crate stops there or errors, depending on the bytes, and zip.js marks the field malformed.
    if (at + 4 > raw.length) return `has a truncated extra field — ${DIFFERENTLY}`;
    const id = view.getUint16(at, true);
    const size = view.getUint16(at + 2, true);
    if (at + 4 + size > raw.length) return `has a truncated extra field — ${DIFFERENTLY}`;
    if (!ALLOWED_EXTRA_FIELDS.includes(id)) {
      return `carries extra field 0x${id.toString(16).padStart(4, "0")}, which a plain \`zip -r\` does not write — ${DIFFERENTLY}`;
    }
    if (id === 0x5455) {
      const flagBits = size === 0 ? 0 : view.getUint8(at + 4).toString(2).replaceAll("0", "").length;
      // A length of 0 has no flags byte, so no flag bits: neither 5 nor 1 matches it.
      if (size !== 5 && size !== 1 + 4 * flagBits) {
        return `has an extended timestamp field (0x5455) of ${size} bytes, which the app's zip crate refuses (it accepts 5 bytes, or 1 plus 4 per flag bit set) — the app could not open the archive, so the install would fail`;
      }
    }
    at += 4 + size;
  }
  return null;
}

/** One path component the gate lets through (plan 0105 P7). */
const COMPONENT_RE = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/u;

/** Windows device names, with or without an extension, in any case. */
const DEVICE_RE = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu;

/**
 * Why a name is refused, or null. The app's `zip` crate 8.6.0 does not skip such names: its
 * `enclosed_name` REWRITES them (`/abs.js`→`abs.js`, `C:/x.js`→`x.js`, `a\b.js`→`a/b.js`,
 * `dist/../x` and `./x`→`x`; only a leading `..` is dropped), and Windows aliases others (a
 * trailing `.` is removed, `BARAM-~1.JSO` is an 8.3 short name, `x::$DATA` a data stream, `CON`
 * a device). A rewritten or aliased name can land on another entry.
 *
 * The component rule excludes `~`, `:`, `$`, `\`, spaces and every leading `.` (so `.` and `..`)
 * by construction; the trailing `.` and the device names need their own lines.
 */
function unsafeName(name: string): null | string {
  if (name === "") return "an empty name";
  for (const part of name.replace(/\/$/u, "").split("/")) {
    if (!COMPONENT_RE.test(part)) return `a component outside /${COMPONENT_RE.source}/ (${JSON.stringify(part)})`;
    if (part.endsWith(".")) return `a component ending in "." (${JSON.stringify(part)}), which Windows drops`;
    if (DEVICE_RE.test(part)) return `the Windows device name ${JSON.stringify(part)}`;
  }
  return null;
}
