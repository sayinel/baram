// §380 gate 6 — the archive, read within the app's own bounds (plan 0105 Task 4).
//
// Every refusal has a twin that passes, as close to it as the rule allows, so each test says
// what makes it fail: the named defect and nothing else in the fixture.
import { describe, expect, it } from "vitest";

import { readPluginArchive, tailProblem } from "../../../scripts/community-zip";
import {
  craftZip,
  extraRecord,
  offsetToHidden,
  pluginZip,
  REAL_LIMITS,
  REAL_README_CAP,
  rewriteEnd,
  twoDirectories,
  unicodePath,
  validManifest,
} from "./community-gate-fixtures";

async function verdict(
  bytes: Uint8Array,
  limits = REAL_LIMITS,
  readmeCap = REAL_README_CAP,
): Promise<string> {
  const result = await readPluginArchive(bytes, limits, readmeCap);
  return result.ok ? "ok" : result.error;
}

/** The manifest's `name` the gate read, or its refusal. */
async function manifestName(bytes: Uint8Array): Promise<string> {
  const result = await readPluginArchive(bytes, REAL_LIMITS, REAL_README_CAP);
  return result.ok
    ? (result.archive.manifest as { name: string }).name
    : result.error;
}

const withExtra = (...extra: Parameters<typeof craftZip>[0]) =>
  pluginZip(validManifest(), extra);

/** A two-entry plugin archive whose manifest is named `name`; `extra` goes on the manifest. */
const named = (name: string, extra: Uint8Array = new Uint8Array()) => [
  {
    data: JSON.stringify(validManifest({ name })),
    extra,
    name: "baram-plugin.json",
  },
  { data: "export function activate() {}\n", name: "dist/index.mjs" },
];

/** The per-component name rule, spelled the way the refusals spell it. */
const NAME_RULE = "/^[A-Za-z0-9_-][A-Za-z0-9._-]*$/";
const rewritten = (name: string, why: string) =>
  `entry ${JSON.stringify(name)} has ${why} — the app rewrites such a name, or Windows aliases it, so it can land on another entry`;
const differently = (name: string, problem: string) =>
  `entry ${JSON.stringify(name)} ${problem} — the app's zip crate and the gate's reader can read such a field differently`;

const TWO_END_RECORDS =
  "holds the end-of-central-directory signature (50 4B 05 06) 2 times — the app's zip crate falls back to an earlier end record when it cannot read the last one, so the gate cannot know which files the app would install. Compressed data that happens to hold those four bytes is refused too: rare, and if it happens, re-zip at another compression level";
const MISPLACED_DIRECTORY =
  "says its central directory ends somewhere other than where its end record starts — the app's zip crate follows the stored offset and the gate's reader can move to the directory beside the end record, so the two can read different directories";
const TRAILING =
  "has an archive comment or bytes after its end-of-central-directory record — the app's zip crate and the gate's reader treat bytes there differently, so the gate accepts only an end record that ends the file, as zip -r writes it";
const ZIP64_PLACEHOLDER =
  "has a Zip64 placeholder (0xFFFF or 0xFFFFFFFF) in its end-of-central-directory record — that sends each reader looking for a Zip64 record, which they look for differently, and no archive within the app's size and entry caps needs one";
const spansDisks = (thisDisk: number, directoryDisk: number) =>
  `says it spans disks (this disk ${thisDisk}, central directory on disk ${directoryDisk}) — the app's zip crate and the gate's reader handle a multi-disk end record differently, and a single-file archive has only disk 0`;
const badTimestamp = (name: string, size: number) =>
  `entry ${JSON.stringify(name)} has an extended timestamp field (0x5455) of ${size} bytes, which the app's zip crate refuses (it accepts 5 bytes, or 1 plus 4 per flag bit set) — the app could not open the archive, so the install would fail`;

describe("readPluginArchive — gate 6", () => {
  it("reads a well-formed plugin archive", async () => {
    const result = await readPluginArchive(
      pluginZip(),
      REAL_LIMITS,
      REAL_README_CAP,
    );
    if (!result.ok) throw new Error(result.error);
    expect(result.archive.files).toEqual([
      "baram-plugin.json",
      "dist/index.mjs",
      "README.md",
    ]);
    expect((result.archive.manifest as { id: string }).id).toBe(
      "hello-counter",
    );
    expect(
      new TextDecoder().decode(result.archive.readme ?? new Uint8Array()),
    ).toBe("# Hello Counter\n");
  });

  it("refuses bytes that are not a ZIP", async () => {
    expect(await verdict(new Uint8Array([1, 2, 3]))).toContain(
      "not a readable ZIP archive",
    );
  });

  it("refuses a second end record hidden in the comment — the app's zip crate reads that one", async () => {
    // Measured (zip 8.6.0, 2026-09-27): the crate reads "Evil Counter" from these bytes.
    expect(
      await verdict(
        twoDirectories(named("Hello Counter"), named("Evil Counter")),
      ),
    ).toBe(TWO_END_RECORDS);
    // The twin: the same bytes with an empty comment — one end record, read as the visible archive.
    expect(
      await manifestName(
        twoDirectories(named("Hello Counter"), named("Evil Counter"), false),
      ),
    ).toBe("Hello Counter");
  });

  // Measured (zip 8.6.0, 2026-09-27): the crate reads "Evil Counter" from the first three rows —
  // it cannot read the last record's directory (disk 1; a 0x5455 field it rejects), so it
  // retries from the earlier end record. From the last two it reads "Hello Counter": two end
  // records are refused whatever the last one says, because the gate cannot tell which the
  // crate will settle on.
  it.each([
    [
      "the last end record names disk 1",
      rewriteEnd(
        twoDirectories(named("Hello Counter"), named("Evil Counter"), "before"),
        { directoryDisk: 1 },
      ),
    ],
    [
      "an empty 0x5455 field",
      twoDirectories(
        named("Hello Counter", extraRecord(0x5455, new Uint8Array())),
        named("Evil Counter"),
        "before",
      ),
    ],
    [
      "a 3-byte 0x5455 field",
      twoDirectories(
        named("Hello Counter", extraRecord(0x5455, new Uint8Array([7, 0, 0]))),
        named("Evil Counter"),
        "before",
      ),
    ],
    [
      "nothing the crate rejects (disk 0)",
      twoDirectories(named("Hello Counter"), named("Evil Counter"), "before"),
    ],
    [
      "nothing the crate rejects (a 5-byte 0x5455 field)",
      twoDirectories(
        named(
          "Hello Counter",
          extraRecord(0x5455, new Uint8Array([1, 0, 0, 0, 0])),
        ),
        named("Evil Counter"),
        "before",
      ),
    ],
  ])(
    "refuses an earlier end record the app's zip crate can fall back to — %s",
    async (_label, bytes) => {
      expect(await verdict(bytes)).toBe(TWO_END_RECORDS);
      // The twin: the same two archives with no earlier end record and nothing the crate
      // rejects — read as the visible archive. It cannot be one field away: an earlier record
      // is refused whatever the last one holds, and a last record the crate rejects is refused
      // on its own (disk 1 by `tailProblem`, a bad 0x5455 field by the extra-field rule).
      expect(
        await manifestName(
          twoDirectories(
            named(
              "Hello Counter",
              extraRecord(0x5455, new Uint8Array([1, 0, 0, 0, 0])),
            ),
            named("Evil Counter"),
            false,
          ),
        ),
      ).toBe("Hello Counter");
    },
  );

  it("refuses an end record whose offset names a directory other than the one beside it", async () => {
    // Measured (zip 8.6.0, 2026-09-27): the crate follows the offset and reads "Evil Counter";
    // zip.js below "strict" moves to the directory beside the end record and reads "Hello Counter".
    expect(
      await verdict(
        offsetToHidden(named("Hello Counter"), named("Evil Counter")),
      ),
    ).toBe(MISPLACED_DIRECTORY);
    // The twin: the same two archives laid out plainly — `visible` first with its true offsets,
    // the end record naming the directory beside it.
    expect(
      await manifestName(
        twoDirectories(named("Hello Counter"), named("Evil Counter"), false),
      ),
    ).toBe("Hello Counter");
  });

  it("refuses more entries than the app extracts", async () => {
    expect(await verdict(pluginZip(), { ...REAL_LIMITS, maxEntries: 3 })).toBe(
      "declares 4 entries, over the 3 limit",
    );
    expect(await verdict(pluginZip(), { ...REAL_LIMITS, maxEntries: 4 })).toBe(
      "ok",
    );
  });

  it("refuses a compression method outside the app's allowlist", async () => {
    expect(
      await verdict(withExtra({ data: "abc", method: 14, name: "x.bin" })),
    ).toBe(
      'entry "x.bin" uses compression method 14; the app allows only 0 and 8',
    );
    expect(
      await verdict(withExtra({ data: "abc", method: 0, name: "x.bin" })),
    ).toBe("ok");
  });

  // plan 0105 P26. The UTF-8 flag is set (craftZip sets it on every entry), so zip.js ignores
  // the Unicode Path field and reads "notes.json"; the app's `zip` crate applies it, reads a
  // second "baram-plugin.json", and the later entry wins — the Evil manifest would install
  // while the gate judged the benign one.
  it("refuses a Unicode Path extra field — it renames the entry for the app and not for zip.js", async () => {
    const evil = {
      data: JSON.stringify(validManifest({ name: "Evil" })),
      name: "notes.json",
    };
    expect(
      await verdict(
        withExtra({
          ...evil,
          extra: unicodePath("notes.json", "baram-plugin.json"),
        }),
      ),
    ).toBe(
      differently(
        "notes.json",
        "carries extra field 0x7075, which a plain `zip -r` does not write",
      ),
    );
    // The twin: the same archive without the field.
    expect(await verdict(withExtra(evil))).toBe("ok");
  });

  it("accepts the two extra fields zip -r writes (measured on the live first-party archives)", async () => {
    // Their central 0x5455 is 5 bytes with flags 0x03 (two bits set, which alone would call for
    // 9 bytes): the `zip` crate accepts a 5-byte field whatever its flags say.
    const extra = new Uint8Array([
      ...extraRecord(0x5455, new Uint8Array([3, 0, 0, 0, 0])),
      ...extraRecord(
        0x7875,
        new Uint8Array([1, 4, 0xe8, 3, 0, 0, 4, 0xe8, 3, 0, 0]),
      ),
    ]);
    expect(
      await verdict(withExtra({ data: "x", extra, name: "stamped.txt" })),
    ).toBe("ok");
  });

  // The `zip` crate accepts a 0x5455 field of 5 bytes, or of 1 plus 4 per flag bit set in its
  // first byte, and refuses the rest (`ExtendedTimestamp::try_from_reader`). Each row: a field
  // the crate refuses, then its twin at a length it accepts — with the same flags byte, where
  // the refused field has one.
  it.each([
    [new Uint8Array(), new Uint8Array([1, 0, 0, 0, 0])],
    [new Uint8Array([7, 0, 0]), new Uint8Array([7, ...new Uint8Array(12)])],
    [
      new Uint8Array([1, ...new Uint8Array(8)]),
      new Uint8Array([1, 0, 0, 0, 0]),
    ],
  ])(
    "refuses an extended timestamp field the app's zip crate cannot parse (%s)",
    async (refused, accepted) => {
      expect(
        await verdict(
          withExtra({
            data: "x",
            extra: extraRecord(0x5455, refused),
            name: "stamp.txt",
          }),
        ),
      ).toBe(badTimestamp("stamp.txt", refused.length));
      expect(
        await verdict(
          withExtra({
            data: "x",
            extra: extraRecord(0x5455, accepted),
            name: "stamp.txt",
          }),
        ),
      ).toBe("ok");
    },
  );

  it.each([
    ["a record running past the field", new Uint8Array([0x55, 0x54, 9, 0, 1])],
    [
      "bytes left over after the last record",
      new Uint8Array([0x55, 0x54, 1, 0, 0, 1, 2, 3]),
    ],
  ])("refuses an extra field with %s", async (_label, extra) => {
    expect(
      await verdict(withExtra({ data: "x", extra, name: "short.txt" })),
    ).toBe(differently("short.txt", "has a truncated extra field"));
  });

  // zip.js 2.18.2 with `strictness: "strict"` (which sets `filenameValidation` to "strict")
  // refuses these while it reads the central directory — before the gate's own rule runs.
  it.each(["../escape.js", "/abs.js", "C:/x.js", "./x.js", "dist//x.js"])(
    "refuses %s already at getEntries",
    async (name) => {
      expect(await verdict(withExtra({ data: "x", name }))).toBe(
        "not a readable ZIP archive (Error: Unsafe filename)",
      );
    },
  );

  // Names zip.js lets through, which the app's `zip` crate rewrites (`a\b.js` → `a/b.js`) or
  // Windows aliases (a trailing ".", an 8.3 short name, a data stream, a device name).
  it.each([
    [
      "a\\b.js",
      `a component outside ${NAME_RULE} (${JSON.stringify("a\\b.js")})`,
    ],
    [
      "baram-plugin.json.",
      'a component ending in "." ("baram-plugin.json."), which Windows drops',
    ],
    [
      "baram-plugin.json::$DATA",
      `a component outside ${NAME_RULE} ("baram-plugin.json::$DATA")`,
    ],
    ["BARAM-~1.JSO", `a component outside ${NAME_RULE} ("BARAM-~1.JSO")`],
    ["con.json", 'the Windows device name "con.json"'],
    ["dist/LPT1", 'the Windows device name "LPT1"'],
  ])("refuses the entry name %s", async (name, why) => {
    expect(await verdict(withExtra({ data: "x", name }))).toBe(
      rewritten(name, why),
    );
  });

  it.each([
    "escape.js",
    "baram-plugin.json.bak",
    "baram-plugin.json-DATA",
    "BARAM-1.JSO",
    "console.json",
    "dist/LPT10",
  ])("accepts the twin %s", async (name) => {
    expect(await verdict(withExtra({ data: "x", name }))).toBe("ok");
  });

  // Refused on the RAW bytes, before any folding: without the UTF-8 flag the `zip` crate
  // decodes CP437 and zip.js guesses UTF-8.
  it.each([
    ["baram-plugin.j\u017Fon"], // U+017F LONG S — case folding maps it to "s"
    ["caf\u00e9.txt"], // NFC
    ["cafe\u0301.txt"], // NFD
  ])("refuses the non-ASCII name %s", async (name) => {
    expect(await verdict(withExtra({ data: "x", name }))).toBe(
      `entry ${JSON.stringify(name)} has a byte outside ASCII in its name — the app's zip crate and the gate's reader can decode it differently`,
    );
  });

  it("accepts the ASCII twin", async () => {
    expect(await verdict(withExtra({ data: "x", name: "cafe.txt" }))).toBe(
      "ok",
    );
  });

  it("refuses a duplicated name — zip.js's strict reading refuses it first", async () => {
    expect(
      await verdict(withExtra({ data: "again", name: "dist/index.mjs" })),
    ).toBe(
      "not a readable ZIP archive (Error: Ambiguous archive: duplicate filename)",
    );
  });

  // The app writes `output_dir.join(name)`, and on macOS and Windows two names that differ
  // only in letter case are ONE file — the later entry wins.
  it.each([
    ["readme.md", '"readme.md" collides with "README.md"'],
    [
      "Baram-Plugin.json",
      '"Baram-Plugin.json" collides with "baram-plugin.json"',
    ],
    ["DIST/index.mjs", '"DIST/index.mjs" collides with "dist/index.mjs"'],
  ])("refuses %s beside the name it folds onto", async (name, collision) => {
    expect(await verdict(withExtra({ data: "{}", name }))).toBe(
      `entry ${collision} where names fold case or Unicode form (macOS, Windows) — the app would write one over the other`,
    );
  });

  it("accepts a name that stays distinct after folding — the twin", async () => {
    expect(await verdict(withExtra({ data: "x", name: "readme2.md" }))).toBe(
      "ok",
    );
  });

  it("refuses an encrypted entry, and accepts the same entry unencrypted", async () => {
    expect(
      await verdict(
        withExtra({ data: "x", flags: 0x0801, name: "secret.txt" }),
      ),
    ).toBe(
      'entry "secret.txt" is encrypted — the app\'s zip crate will not read it without a password, so the install would fail',
    );
    expect(
      await verdict(
        withExtra({ data: "x", flags: 0x0800, name: "secret.txt" }),
      ),
    ).toBe("ok");
  });

  it("refuses a symbolic link, and accepts the same entry as a regular file", async () => {
    expect(
      await verdict(
        withExtra({
          data: "dist/index.mjs",
          name: "link.mjs",
          unixMode: 0o120777,
        }),
      ),
    ).toBe(
      'entry "link.mjs" is a symbolic link — the app writes it as a regular file',
    );
    expect(
      await verdict(
        withExtra({
          data: "dist/index.mjs",
          name: "link.mjs",
          unixMode: 0o100644,
        }),
      ),
    ).toBe("ok");
  });

  // zip.js calls an entry a directory by its Unix mode, its upper attribute bits, the MS-DOS
  // directory bit (only when made by MS-DOS) or a trailing "/"; the app's `zip` crate by the
  // name alone. Measured (zip 8.6.0, 2026-09-27): the crate extracts both refused entries below
  // as files, with the bytes the gate never read.
  const DIRECTORY_TO_THE_GATE =
    "entry \"dist/extra.mjs\" is a directory to the gate's reader and a file to the app's zip crate, which goes by the name alone — the app would install a file the gate never read";

  it("refuses a file whose Unix mode says directory, and accepts it with a file mode", async () => {
    const entry = { data: "globalThis.evil = 1;\n", name: "dist/extra.mjs" };
    expect(await verdict(withExtra({ ...entry, unixMode: 0o040755 }))).toBe(
      DIRECTORY_TO_THE_GATE,
    );
    expect(await verdict(withExtra({ ...entry, unixMode: 0o100644 }))).toBe(
      "ok",
    );
  });

  it("refuses a file an MS-DOS host marked as a directory, and accepts the bit from a Unix host", async () => {
    const entry = {
      data: "globalThis.evil = 1;\n",
      dosAttributes: 0x10,
      name: "dist/extra.mjs",
    };
    expect(await verdict(withExtra({ ...entry, host: 0 }))).toBe(
      DIRECTORY_TO_THE_GATE,
    );
    // zip.js reads the MS-DOS attribute byte only when "version made by" names MS-DOS.
    expect(await verdict(withExtra({ ...entry, host: 3 }))).toBe("ok");
  });

  it("refuses an archive its reader has a warning about", async () => {
    // General-purpose flag bit 5, "compressed patched data": zip.js records a warning and
    // reads on; the gate refuses on the warning.
    expect(
      await verdict(
        withExtra({ data: "x", flags: 0x0820, name: "patched.txt" }),
      ),
    ).toBe(
      'the gate\'s reader reports "compressed patched data" at entry "patched.txt" — the gate refuses any archive its reader finds irregular, because the app\'s zip crate resolves irregularities by rules of its own',
    );
    expect(
      await verdict(
        withExtra({ data: "x", flags: 0x0800, name: "patched.txt" }),
      ),
    ).toBe("ok");
  });

  it("refuses a path deeper than the app creates", async () => {
    const limits = { ...REAL_LIMITS, maxPathDepth: 2 };
    expect(
      await verdict(withExtra({ data: "x", name: "a/b/c.js" }), limits),
    ).toBe('entry "a/b/c.js" has 3 path components, over the 2 limit');
    expect(
      await verdict(withExtra({ data: "x", name: "a/c.js" }), limits),
    ).toBe("ok");
  });

  it("stops reading an entry at the per-file cap", async () => {
    const limits = { ...REAL_LIMITS, maxEntryBytes: 1000 };
    expect(
      await verdict(
        withExtra({ data: "x".repeat(2000), name: "big.txt" }),
        limits,
      ),
    ).toBe('entry "big.txt" exceeds the 1000-byte per-file limit');
    expect(
      await verdict(
        withExtra({ data: "x".repeat(900), name: "big.txt" }),
        limits,
      ),
    ).toBe("ok");
  });

  it("stops at the total expanded cap", async () => {
    const limits = { ...REAL_LIMITS, maxTotalExpandedBytes: 2000 };
    const big = (size: number) => [
      { data: "y".repeat(size), name: "one.txt" },
      { data: "z".repeat(size), name: "two.txt" },
    ];
    expect(await verdict(withExtra(...big(1000)), limits)).toBe(
      "expands past the 2000-byte total limit",
    );
    expect(await verdict(withExtra(...big(700)), limits)).toBe("ok");
  });

  it("stops at the compression ratio, and not below its floor", async () => {
    const zeros = { data: new Uint8Array(100_000), name: "zeros.bin" };
    expect(
      await verdict(withExtra(zeros), {
        ...REAL_LIMITS,
        maxCompressionRatio: 10,
        ratioFloorBytes: 1024,
      }),
    ).toContain("bytes on the wire (10:1, minimum 1024)");
    expect(
      await verdict(withExtra(zeros), {
        ...REAL_LIMITS,
        maxCompressionRatio: 1000,
        ratioFloorBytes: 1024,
      }),
    ).toBe("ok");
  });

  it("refuses an entry whose CRC does not match, as the app's reader does", async () => {
    expect(
      await verdict(withExtra({ crc: 0x12345678, data: "x", name: "bad.txt" })),
    ).toContain('entry "bad.txt" could not be read');
    expect(await verdict(withExtra({ data: "x", name: "bad.txt" }))).toBe("ok");
  });

  it("requires baram-plugin.json at the root", async () => {
    const nested = craftZip([
      { data: JSON.stringify(validManifest()), name: "sub/baram-plugin.json" },
      { data: "x", name: "dist/index.mjs" },
    ]);
    expect(await verdict(nested)).toBe(
      "no baram-plugin.json at the archive root — the app requires it there",
    );
  });

  it("requires main to name a file in the archive", async () => {
    expect(
      await verdict(pluginZip(validManifest({ main: "dist/missing.mjs" }))),
    ).toBe('main "dist/missing.mjs" names no file in the archive');
  });

  it("refuses a manifest that is not JSON", async () => {
    expect(
      await verdict(craftZip([{ data: "{", name: "baram-plugin.json" }])),
    ).toBe("baram-plugin.json is not valid UTF-8 JSON");
  });

  // The app's listing fetch refuses a README over `MAX_README_BYTES` (`fetch.rs`, read by
  // `readmeByteCap`), so a larger one would publish beside the archive and never render.
  const withReadme = (readme: string) =>
    craftZip([
      { data: JSON.stringify(validManifest()), name: "baram-plugin.json" },
      { data: "export function activate() {}\n", name: "dist/index.mjs" },
      { data: readme, name: "README.md" },
    ]);

  it("accepts a README of exactly the app's fetch cap", async () => {
    expect(await verdict(withReadme("#".repeat(REAL_README_CAP)))).toBe("ok");
  });

  it("refuses a README one byte over the app's fetch cap", async () => {
    expect(await verdict(withReadme("#".repeat(REAL_README_CAP + 1)))).toBe(
      "README.md is over the 262144-byte limit the app's registry fetch enforces — a larger README would publish beside the archive and never render",
    );
  });

  it("uses the readmeCap parameter, not a baked-in constant", async () => {
    // A small cap passed explicitly refuses the fixture's 16-byte README, proving the
    // parameter is the one actually enforced rather than `REAL_README_CAP`.
    expect(await verdict(pluginZip(), REAL_LIMITS, 4)).toBe(
      "README.md is over the 4-byte limit the app's registry fetch enforces — a larger README would publish beside the archive and never render",
    );
  });
});

// The end of the archive, judged on the bytes before either reader parses them. Each row
// changes one thing about `pluginZip()`, which passes.
describe("tailProblem — the end record both readers start from", () => {
  it("passes a plain archive", () => {
    expect(tailProblem(pluginZip())).toBeNull();
  });

  it("refuses bytes with no end record", () => {
    expect(tailProblem(new Uint8Array([1, 2, 3]))).toBe(
      "not a readable ZIP archive (no end-of-central-directory record)",
    );
  });

  it("refuses a second end-record signature anywhere, even inside an entry's data", () => {
    const stored = (data: number[]) =>
      withExtra({ data: new Uint8Array(data), method: 0, name: "sig.bin" });
    expect(tailProblem(stored([0x50, 0x4b, 0x05, 0x06]))).toBe(TWO_END_RECORDS);
    expect(tailProblem(stored([0x50, 0x4b, 0x05, 0x07]))).toBeNull();
  });

  it.each([
    ["a comment", { comment: new Uint8Array([0x68, 0x69]) }],
    ["a comment length with no comment", { commentLength: 2 }],
    ["bytes after the end record", { trailing: new Uint8Array([0]) }],
  ])("refuses %s", (_label, fields) => {
    expect(tailProblem(rewriteEnd(pluginZip(), fields))).toBe(TRAILING);
  });

  it.each([
    [{ thisDisk: 1 }, spansDisks(1, 0)],
    [{ directoryDisk: 1 }, spansDisks(0, 1)],
  ])(
    "refuses an end record that names another disk (%o)",
    (fields, message) => {
      expect(tailProblem(rewriteEnd(pluginZip(), fields))).toBe(message);
    },
  );

  it("refuses entry counts that differ between this disk and the whole archive", () => {
    expect(tailProblem(rewriteEnd(pluginZip(), { entriesOnDisk: 3 }))).toBe(
      "says 3 entries on this disk but 4 in all — the app's zip crate reads the first count and the gate's reader the second",
    );
  });

  it.each([
    [{ entries: 0xffff, entriesOnDisk: 0xffff }],
    [{ size: 0xffffffff }],
    [{ offset: 0xffffffff }],
  ])("refuses a Zip64 placeholder (%o)", (fields) => {
    expect(tailProblem(rewriteEnd(pluginZip(), fields))).toBe(
      ZIP64_PLACEHOLDER,
    );
  });

  it("refuses a directory that does not end where the end record starts", () => {
    expect(tailProblem(rewriteEnd(pluginZip(), { offset: 0 }))).toBe(
      MISPLACED_DIRECTORY,
    );
  });

  it("refuses a Zip64 locator signature right before the end record", () => {
    // The last central record ends with this entry's 20-byte 0x7875 field, so the field's
    // first four bytes sit exactly 20 bytes before the end record.
    const lastField = (first: number[]) =>
      withExtra({
        data: "x",
        extra: extraRecord(
          0x7875,
          new Uint8Array([...first, ...new Uint8Array(16)]),
        ),
        name: "z.txt",
      });
    expect(tailProblem(lastField([0x50, 0x4b, 0x06, 0x07]))).toBe(
      "has a Zip64 locator signature (50 4B 06 07) right before its end record — the gate refuses anything that could send a reader down the Zip64 path, which the app's zip crate and the gate's reader walk differently",
    );
    expect(tailProblem(lastField([0x50, 0x4b, 0x06, 0x08]))).toBeNull();
  });
});
