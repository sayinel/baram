// §380/§381 — inputs for the community gate and publish tests (plan 0105).
//
// Everything here BUILDS inputs; nothing here judges them. Expected values stay hand-written
// literals in the tests — a fixture that computed an expectation with the code under test
// would make an assertion agree with itself. Hashes of fixture bytes use node:crypto
// directly, never the module under test.
import type { PluginArchiveLimits } from "../../../scripts/rust-constants";

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { crc32, deflateRawSync } from "node:zlib";

import {
  pluginArchiveLimits,
  readmeByteCap,
} from "../../../scripts/rust-constants";

/** The bounds the app ships, read the way the gate reads them. Tests override single fields. */
export const REAL_LIMITS: PluginArchiveLimits = pluginArchiveLimits(
  readFileSync(
    resolve(__dirname, "../../../src-tauri/src/plugin/limits.rs"),
    "utf8",
  ),
);

/** The README byte cap the app's registry fetch enforces, read the way gate 6 reads it. */
export const REAL_README_CAP: number = readmeByteCap(
  readFileSync(
    resolve(__dirname, "../../../src-tauri/src/plugin/fetch.rs"),
    "utf8",
  ),
);

export interface CraftEntry {
  /** Overrides the CRC in both headers — a wrong one is what a corrupted entry looks like. */
  crc?: number;
  data?: string | Uint8Array;
  /** The MS-DOS attribute byte — the low byte of the external attributes (0x10 is "directory"). */
  dosAttributes?: number;
  /**
   * The raw extra-field bytes, written into BOTH headers. Both readers take an entry's name
   * from the CENTRAL header (`zip` crate: `central_header_to_zip_file_inner` → `parse_extra_field`;
   * zip.js: `entry.rawExtraField` is cut from the central record), so the central copy is the
   * one that decides; the local copy keeps the two headers consistent.
   */
  extra?: Uint8Array;
  /** The general-purpose bit flag, in both headers. Default 0x0800 (UTF-8 names). */
  flags?: number;
  /** The high byte of "version made by": 0 is MS-DOS, 3 (the default) is Unix. */
  host?: number;
  /** 8 deflates `data`; any other value stores it as-is under that method number. */
  method?: number;
  name: string;
  unixMode?: number;
}

/**
 * What `rewriteEnd` changes about an end-of-central-directory record: the fields it overwrites
 * and the bytes it appends after it. Every other byte stays.
 */
export interface EndFields {
  /** Appended after the record, its length written into the record. */
  comment?: Uint8Array;
  /** The comment-length field alone, with no comment bytes written. */
  commentLength?: number;
  directoryDisk?: number;
  entries?: number;
  entriesOnDisk?: number;
  offset?: number;
  size?: number;
  thisDisk?: number;
  /** Appended after the record and its comment; the record counts none of it. */
  trailing?: Uint8Array;
}

/**
 * A ZIP built byte by byte, so a test can write what no archiver would: a method the app
 * refuses, a symlink, a wrong CRC, a hostile name, an extra field. Made-by is Unix unless an
 * entry's `host` says otherwise, so the upper half of the external attributes is a mode the
 * reader can see. The UTF-8 flag is set on every entry whose `flags` do not replace it — which
 * is exactly the case where zip.js ignores a Unicode Path field and the `zip` crate does not
 * (plan 0105 P26).
 */
export function craftZip(entries: readonly CraftEntry[]): Uint8Array {
  const parts = craftParts(entries, 0);
  return new Uint8Array(
    Buffer.concat([
      parts.locals,
      parts.directory,
      endRecord(parts.count, parts.directory.length, parts.locals.length),
    ]),
  );
}

/** One extra-field record: little-endian id, little-endian length, data. */
export function extraRecord(id: number, data: Uint8Array): Uint8Array {
  const record = Buffer.alloc(4 + data.length);
  record.writeUInt16LE(id, 0);
  record.writeUInt16LE(data.length, 2);
  Buffer.from(data).copy(record, 4);
  return new Uint8Array(record);
}

/**
 * Two archives in one file and ONE end record, whose offset names `hidden`'s directory while
 * `visible`'s directory is the one that ends where the end record starts: `hidden`'s local
 * records, `visible`'s, `hidden`'s directory, `visible`'s directory, and the end record
 * (`visible`'s entry count and directory size). The `zip` crate follows the stored offset.
 * zip.js moves to the directory beside the end record and adds the distance it moved to every
 * offset in that directory — so `visible`'s offsets are written that much short, for zip.js to
 * land on `visible`'s local records.
 */
export function offsetToHidden(
  visible: readonly CraftEntry[],
  hidden: readonly CraftEntry[],
): Uint8Array {
  const other = craftParts(hidden, 0);
  const shown = craftParts(
    visible,
    other.locals.length - other.directory.length,
  );
  const otherAt = other.locals.length + shown.locals.length;
  return new Uint8Array(
    Buffer.concat([
      other.locals,
      shown.locals,
      other.directory,
      shown.directory,
      endRecord(shown.count, shown.directory.length, otherAt),
    ]),
  );
}

/**
 * A plugin archive with the entries `zip -r x.zip baram-plugin.json dist README.md` lists —
 * `baram-plugin.json`, `dist/`, `dist/index.mjs`, `README.md` — plus `extra` entries. It is
 * `craftZip`'s bytes, not zip's: every entry has the UTF-8 flag and no extra field, where a real
 * `zip -r` archive (the live first-party ones) has flags 0 and fields 0x5455 and 0x7875.
 */
export function pluginZip(
  manifest: Record<string, unknown> = validManifest(),
  extra: readonly CraftEntry[] = [],
): Uint8Array {
  return craftZip([
    { data: JSON.stringify(manifest), name: "baram-plugin.json" },
    { name: "dist/" },
    { data: "export function activate() {}\n", name: "dist/index.mjs" },
    { data: "# Hello Counter\n", name: "README.md" },
    ...extra,
  ]);
}

/** `archive`, whose end record is its last 22 bytes, with the named end-record fields overwritten. */
export function rewriteEnd(archive: Uint8Array, fields: EndFields): Uint8Array {
  const end = Buffer.from(archive.subarray(archive.length - 22));
  if (fields.thisDisk !== undefined) end.writeUInt16LE(fields.thisDisk, 4);
  if (fields.directoryDisk !== undefined) {
    end.writeUInt16LE(fields.directoryDisk, 6);
  }
  if (fields.entriesOnDisk !== undefined) {
    end.writeUInt16LE(fields.entriesOnDisk, 8);
  }
  if (fields.entries !== undefined) end.writeUInt16LE(fields.entries, 10);
  if (fields.size !== undefined) end.writeUInt32LE(fields.size, 12);
  if (fields.offset !== undefined) end.writeUInt32LE(fields.offset, 16);
  const comment = Buffer.from(fields.comment ?? new Uint8Array());
  if (fields.comment !== undefined) end.writeUInt16LE(comment.length, 20);
  if (fields.commentLength !== undefined) {
    end.writeUInt16LE(fields.commentLength, 20);
  }
  return new Uint8Array(
    Buffer.concat([
      archive.subarray(0, archive.length - 22),
      end,
      comment,
      fields.trailing ?? new Uint8Array(),
    ]),
  );
}

export function sha(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Two archives in one file: `visible`'s local records, `hidden`'s, `hidden`'s directory, then
 * `visible`'s directory and the end record that ends the file and points at it. `decoy` adds a
 * second end record, pointing at `hidden`'s directory:
 * - `"comment"` (the default) writes it as the real record's COMMENT, ending exactly at the end
 *   of the file — so a reader that scans back from the end for the signature meets it first;
 * - `"before"` writes it between the two directories, where the `zip` crate reaches it when it
 *   cannot read the directory the last record points at (`get_metadata` retries with the next
 *   earlier signature);
 * - `false` writes no second record — the twin.
 */
export function twoDirectories(
  visible: readonly CraftEntry[],
  hidden: readonly CraftEntry[],
  decoy: "before" | "comment" | false = "comment",
): Uint8Array {
  const shown = craftParts(visible, 0);
  const other = craftParts(hidden, shown.locals.length);
  const otherAt = shown.locals.length + other.locals.length;
  const otherEnd = endRecord(other.count, other.directory.length, otherAt);
  const before = decoy === "before" ? otherEnd : Buffer.alloc(0);
  const comment = decoy === "comment" ? otherEnd : Buffer.alloc(0);
  const shownAt = otherAt + other.directory.length + before.length;
  return new Uint8Array(
    Buffer.concat([
      shown.locals,
      other.locals,
      other.directory,
      before,
      shown.directory,
      endRecord(shown.count, shown.directory.length, shownAt, comment),
    ]),
  );
}

/** Info-ZIP Unicode Path (0x7075): version 1, the CRC32 of the RAW name it replaces, the new name. */
export function unicodePath(rawName: string, path: string): Uint8Array {
  const name = Buffer.from(path, "utf8");
  const data = Buffer.alloc(5 + name.length);
  data.writeUInt8(1, 0);
  data.writeUInt32LE(crc32(Buffer.from(rawName, "utf8")), 1);
  name.copy(data, 5);
  return extraRecord(0x7075, new Uint8Array(data));
}

/** A sandboxed manifest the app's `validateManifest` accepts — spec 0058 §7.1's example. */
export function validManifest(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    author: "Octo Cat",
    capabilities: ["editor:readonly", "events", "statusbar"],
    description: "Counts characters in the status bar.",
    engines: { baram: ">=0.6.1" },
    id: "hello-counter",
    license: "MIT",
    main: "dist/index.mjs",
    name: "Hello Counter",
    trust: "sandboxed",
    version: "1.2.0",
    ...overrides,
  };
}

/** The records `craftZip` joins: local headers and data from offset `base`, and the directory that points at them. */
function craftParts(
  entries: readonly CraftEntry[],
  base: number,
): { count: number; directory: Buffer; locals: Buffer } {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = base;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const raw =
      typeof entry.data === "string"
        ? Buffer.from(entry.data, "utf8")
        : Buffer.from(entry.data ?? new Uint8Array());
    const method = entry.method ?? (entry.name.endsWith("/") ? 0 : 8);
    const body = method === 8 ? deflateRawSync(raw) : raw;
    const crc = entry.crc ?? crc32(raw);
    const mode =
      entry.unixMode ?? (entry.name.endsWith("/") ? 0o040755 : 0o100644);
    const extra = Buffer.from(entry.extra ?? new Uint8Array());

    const flags = entry.flags ?? 0x0800;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0x0021, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(extra.length, 28);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(((entry.host ?? 3) << 8) | 0x14, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(0x0021, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(extra.length, 30);
    central.writeUInt32LE(
      ((mode << 16) | (entry.dosAttributes ?? 0)) >>> 0,
      38,
    );
    central.writeUInt32LE(offset, 42);

    locals.push(local, name, extra, body);
    centrals.push(central, name, extra);
    offset += local.length + name.length + extra.length + body.length;
  }
  return {
    count: entries.length,
    directory: Buffer.concat(centrals),
    locals: Buffer.concat(locals),
  };
}

/** An end-of-central-directory record: `count` entries, a directory of `size` bytes at `offset`. */
function endRecord(
  count: number,
  size: number,
  offset: number,
  comment: Buffer = Buffer.alloc(0),
): Buffer {
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(count, 8);
  end.writeUInt16LE(count, 10);
  end.writeUInt32LE(size, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(comment.length, 20);
  return Buffer.concat([end, comment]);
}
