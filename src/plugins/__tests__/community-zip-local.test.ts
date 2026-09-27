// §380 gate 6 — what the gate's reader says about an entry's LOCAL header, which it reads only
// as it reads that entry's data (plan 0105 Task 4). Every refusal has a twin that passes: the
// same archive with that one local header left as `craftZip` writes it.
import { describe, expect, it } from "vitest";

import { readPluginArchive } from "../../../scripts/community-zip";
import {
  craftZip,
  extraRecord,
  REAL_LIMITS,
  REAL_README_CAP,
  validManifest,
} from "./community-gate-fixtures";

async function verdict(bytes: Uint8Array): Promise<string> {
  const result = await readPluginArchive(bytes, REAL_LIMITS, REAL_README_CAP);
  return result.ok ? "ok" : result.error;
}

/** A plugin archive whose FIRST entry is `first`, so its local header starts at byte 0. */
const archiveLeading = (first: Parameters<typeof craftZip>[0][number]) =>
  craftZip([
    first,
    { data: JSON.stringify(validManifest()), name: "baram-plugin.json" },
    { data: "export function activate() {}\n", name: "dist/index.mjs" },
  ]);

/** The fixed part of a local file header — its name, then its extra field, follow it. */
const LOCAL_HEADER = 30;

describe("readPluginArchive — local headers", () => {
  it("refuses a warning its reader records on an entry while reading it — a local extended timestamp that runs past its field", async () => {
    const name = "stamp.txt";
    const stamped = () =>
      archiveLeading({
        data: "x",
        extra: extraRecord(0x5455, new Uint8Array([1, 0, 0, 0, 0])),
        name,
      });
    const bytes = stamped();
    // The LOCAL record's length: 9 where the field holds 5 bytes of data. The central copy,
    // which both readers name the entry from, keeps its 5.
    bytes[LOCAL_HEADER + name.length + 2] = 9;
    expect(await verdict(bytes)).toBe(
      'the gate\'s reader reports "malformed extra field" at entry "stamp.txt" — the gate refuses any archive its reader finds irregular, because the app\'s zip crate resolves irregularities by rules of its own',
    );
    expect(await verdict(stamped())).toBe("ok");
  });

  it("reads a directory entry's local header too — the app's zip crate opens every entry, directories included", async () => {
    const bytes = archiveLeading({ name: "dist/" });
    // "PK\x03\x04" → "PK\x03\x00": no local file header where the directory says one is.
    bytes[3] = 0;
    expect(await verdict(bytes)).toBe(
      'entry "dist/" could not be read (Error: Local file header not found) — the gate refuses an entry its reader cannot read cleanly: a missing local header or a CRC mismatch fails the app\'s install too, and a declared-size mismatch or a local header that disagrees with the central one the gate refuses on its own',
    );
    expect(await verdict(archiveLeading({ name: "dist/" }))).toBe("ok");
  });
});
