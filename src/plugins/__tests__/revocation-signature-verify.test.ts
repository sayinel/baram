// §69 — the publish gate's cryptographic check.
//
// WHY THIS FILE EXISTS: the workflow could not tell a good signature from a bad one. It
// byte-compared the served `.sig` against the one it had just committed and grepped the trusted
// comment for a filename — both PROVENANCE checks, both of which pass for a signature made over
// a different body or with a key that is not the one clients ship. The verifier those checks
// were standing in for is Rust, and this workflow has no minutes for a Rust build.
//
// So the check is a second implementation, and the risk a second implementation carries runs
// one way: anything it accepts that `minisign-verify` refuses publishes a list every client
// rejects, which presents as "revocations stopped working" with nothing red anywhere. The cases
// below are aimed at that direction — the frozen at-arming pair as a shared anchor with the Rust
// test, and forged signatures for the rules no fixture can express.
import { spawnSync } from "node:child_process";
import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  sign,
} from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { verifyRevocationSignature } from "../../../scripts/minisign-verify";
import {
  revocationByteCap,
  shippedRevocationPublicKey,
} from "../../../scripts/rust-constants";

const ROOT = resolve(__dirname, "../../..");
const RUST_SOURCE = resolve(ROOT, "src-tauri/src/plugin/mod.rs");
// ‼️ THE FROZEN PAIR, NOT `registry/revoked.json`. It is the list that was live when the key was
// armed, committed alongside the Rust test that reads the same two files — so both
// implementations are anchored to one known-good pair, and publishing a second revocation
// cannot make either test red.
const FIXTURE = resolve(
  ROOT,
  "src-tauri/src/plugin/testdata/revoked-at-arming.json",
);

const SHIPPED_KEY = shippedRevocationPublicKey(
  readFileSync(RUST_SOURCE, "utf8"),
);
const FROZEN_BODY = readFileSync(FIXTURE);
const FROZEN_SIG = readFileSync(`${FIXTURE}.sig`, "utf8");

interface Forged {
  /** Raw little-endian key id bytes, as they sit on the wire. */
  keyIdHex: string;
  publicKeyB64: string;
  signatureB64: string;
}

/**
 * Build a minisign pair from a freshly generated key, so rules that no committed fixture can
 * express are executable.
 *
 * ‼️ THE LEGACY ALGORITHM IS THE REASON THIS EXISTS. Rust passes `allow_legacy: false` and its
 * own comment says outright that the flag is not pinned by a test, because producing a legacy
 * signature needs the minisign CLI. Forging one here makes the rule executable in the repo for
 * the first time — and the `ED` case below is the control that proves a refusal is about the
 * algorithm rather than about this helper being broken.
 */
function forge(
  body: Uint8Array,
  {
    algorithm = "ED",
    commentAfterSigning,
    trustedComment = "timestamp:0\tfile:revoked.json",
  }: {
    algorithm?: string;
    commentAfterSigning?: string;
    trustedComment?: string;
  } = {},
): Forged {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  // 44-byte SPKI DER, of which the last 32 are the key.
  const rawPublicKey = publicKey
    .export({ format: "der", type: "spki" })
    .subarray(12);
  const keyId = randomBytes(8);
  const message =
    algorithm === "ED"
      ? createHash("blake2b512").update(body).digest()
      : Buffer.from(body);
  const signature = sign(null, message, privateKey);
  const globalSignature = sign(
    null,
    Buffer.concat([signature, Buffer.from(trustedComment)]),
    privateKey,
  );
  const sigFile = [
    "untrusted comment: forged for a test",
    Buffer.concat([Buffer.from(algorithm), keyId, signature]).toString(
      "base64",
    ),
    // Swapped AFTER the global signature is made, when a case asks for it — that is what a
    // tampered trusted comment looks like on the wire.
    `trusted comment: ${commentAfterSigning ?? trustedComment}`,
    globalSignature.toString("base64"),
    "",
  ].join("\n");
  const pubFile = [
    "untrusted comment: forged for a test",
    Buffer.concat([Buffer.from("Ed"), keyId, rawPublicKey]).toString("base64"),
    "",
  ].join("\n");
  return {
    keyIdHex: keyId.toString("hex"),
    publicKeyB64: Buffer.from(pubFile).toString("base64"),
    signatureB64: Buffer.from(sigFile).toString("base64"),
  };
}

const BASE64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/**
 * Bump the last DATA character of a base64 line, setting spare bits without changing the bytes.
 *
 * The payloads minisign uses never fill their last base64 group: 74 bytes leaves 2 spare bits and
 * 64 leaves 4, so a decoder that ignores them reads exactly the same signature while Rust refuses
 * the input outright.
 */
function nonCanonical(line: string): string {
  const padding = /=*$/u.exec(line)?.[0] ?? "";
  const data = line.slice(0, line.length - padding.length);
  const last = BASE64_ALPHABET.indexOf(data[data.length - 1]);
  return `${data.slice(0, -1)}${BASE64_ALPHABET[last + 1]}${padding}`;
}

/** Re-wrap a minisign block's text the way the app fetches it. */
function wrap(text: string): string {
  return Buffer.from(text, "utf8").toString("base64");
}

// An explicit budget, for the same reason the publish-gate suite carries one: two cases spawn
// `npx tsx`, and vitest's 5 s default is not sized for that under a saturated suite. A ceiling,
// not a delay.
describe(
  "verifying a revocation list the way an armed client does",
  { timeout: 30_000 },
  () => {
    it("accepts the frozen at-arming pair with the key this build ships", () => {
      // The shared anchor. If this and the Rust test ever disagree, one of the two verifiers is
      // wrong and the workflow's answer means nothing.
      const { trustedComment } = verifyRevocationSignature(
        FROZEN_BODY,
        FROZEN_SIG,
        SHIPPED_KEY,
      );
      expect(trustedComment).toContain("file:revoked.json");
    });

    it("REFUSES a body altered by one byte", () => {
      // The whole point of signing: an attacker who can serve the origin cannot edit the list.
      const tampered = Buffer.concat([FROZEN_BODY, Buffer.from(" ")]);
      expect(() =>
        verifyRevocationSignature(tampered, FROZEN_SIG, SHIPPED_KEY),
      ).toThrow(/signature does not verify/u);
    });

    it("REFUSES a signature made by a different key", () => {
      // The failure an armed client hits when the signing secret and the shipped constant drift
      // apart — which is precisely what CI could not see before.
      const { signatureB64 } = forge(FROZEN_BODY);
      expect(() =>
        verifyRevocationSignature(FROZEN_BODY, signatureB64, SHIPPED_KEY),
      ).toThrow(/signed with a different key/u);
    });

    it("accepts a forged prehashed pair, so the refusals below are about their rules", () => {
      // The control. Without it, every negative case here would also pass against a helper that
      // simply produces garbage.
      const { publicKeyB64, signatureB64 } = forge(FROZEN_BODY);
      expect(() =>
        verifyRevocationSignature(FROZEN_BODY, signatureB64, publicKeyB64),
      ).not.toThrow();
    });

    it("REFUSES a mathematically valid legacy signature, as armed clients do", () => {
      // ‼️ The signature IS valid Ed25519 over the body — only the algorithm marker differs. Rust
      // refuses it via `allow_legacy: false`, so accepting it here would publish a pair every
      // client rejects, which is the one outcome the whole check exists to prevent.
      const { publicKeyB64, signatureB64 } = forge(FROZEN_BODY, {
        algorithm: "Ed",
      });
      expect(() =>
        verifyRevocationSignature(FROZEN_BODY, signatureB64, publicKeyB64),
      ).toThrow(/legacy/u);
    });

    it("REFUSES a trusted comment edited after signing", () => {
      // The comment carries the filename and timestamp an operator reads. Unauthenticated, it is
      // text an attacker writes next to an authenticated body — and the crate checks it, so
      // skipping it here would be a divergence in the permissive direction.
      const { publicKeyB64, signatureB64 } = forge(FROZEN_BODY, {
        commentAfterSigning: "timestamp:0\tfile:something-else.json",
      });
      expect(() =>
        verifyRevocationSignature(FROZEN_BODY, signatureB64, publicKeyB64),
      ).toThrow(/global signature does not verify/u);
    });

    it("REFUSES a bare key line, which the Rust crate refuses too", () => {
      // ‼️ FOUND BY BOTH REVIEWS INDEPENDENTLY, each with a probe against the vendored crate. This
      // used to be ACCEPTED, with a comment claiming `PublicKey::decode` accepts it as well — it
      // does not: it takes `lines.next()` twice and errors on the second. The edit that reaches this
      // is a key ROTATION pasting the key line alone, which would have gone green here and refused
      // every list on every armed client.
      const twoLine = Buffer.from(SHIPPED_KEY, "base64").toString("utf8");
      const bare = Buffer.from(
        `${twoLine.trim().split("\n")[1]}\n`,
        "utf8",
      ).toString("base64");
      expect(() =>
        verifyRevocationSignature(FROZEN_BODY, FROZEN_SIG, bare),
      ).toThrow(/no key line/u);
    });

    it("REFUSES non-canonical base64 in the signature's inner lines", () => {
      // ‼️ THE REACHABLE HALF OF THE CANONICALITY GAP (both reviews, MEDIUM-1). Every minisign
      // signature has spare bits — the signature line decodes to 74 bytes and the global-signature
      // line to 64 — so bumping the final data character of either leaves the decoded bytes
      // IDENTICAL. Rust refuses it at decode; a verifier without this rule publishes a pair every
      // client rejects. Asserted, not described: the bytes are shown to be unchanged first.
      const text = Buffer.from(FROZEN_SIG.trim(), "base64").toString("utf8");
      const lines = text.split("\n");
      for (const index of [1, 3]) {
        const mangled = [...lines];
        mangled[index] = nonCanonical(lines[index]);
        expect(mangled[index]).not.toBe(lines[index]);
        expect(
          Buffer.from(mangled[index], "base64").equals(
            Buffer.from(lines[index], "base64"),
          ),
          "the mutation must not change the decoded bytes, or it proves something else",
        ).toBe(true);
        expect(() =>
          verifyRevocationSignature(
            FROZEN_BODY,
            Buffer.from(mangled.join("\n")).toString("base64"),
            SHIPPED_KEY,
          ),
        ).toThrow(/not canonical base64/u);
      }
    });

    it("REFUSES a key whose base64 length is not a multiple of 4, alphabet clean", () => {
      // ‼️ ONE RULE AT A TIME (code review HIGH-2). The single case that used to cover base64
      // strictness tripped BOTH the alphabet check and the length check at once — the reviewer ran
      // each mutation separately and both SURVIVED. Neither rule was pinned by a passing suite.
      const shortened = SHIPPED_KEY.slice(0, -1);
      expect(shortened.length % 4).not.toBe(0);
      expect(/^[A-Za-z0-9+/]*={0,2}$/u.test(shortened)).toBe(true);
      expect(() =>
        verifyRevocationSignature(FROZEN_BODY, FROZEN_SIG, shortened),
      ).toThrow(/not a multiple of 4/u);
    });

    it("REFUSES a key mangled by whitespace that Node would decode anyway", () => {
      // ‼️ THE DIVERGENCE THIS GUARDS IS SILENT. `Buffer.from(value, "base64")` skips characters
      // outside the alphabet, so a key broken by a stray newline decodes to the SAME bytes here
      // and fails outright in Rust — CI green, every client refusing every list. Asserted rather
      // than described: the lenient decode is shown to succeed first.
      //
      // ‼️ FOUR NEWLINES, NOT ONE (code review HIGH-2). One made the length 153, which trips the
      // multiple-of-4 rule as well, so this case passed no matter which of the two rules survived
      // a mutation — and the reviewer showed both surviving. Four keeps the length a multiple of 4
      // so the alphabet rule is the only thing that can refuse it.
      const mangled = `${SHIPPED_KEY.slice(0, 20)}\n\n\n\n${SHIPPED_KEY.slice(20)}`;
      expect(mangled.length % 4).toBe(0);
      expect(
        Buffer.from(mangled, "base64").equals(
          Buffer.from(SHIPPED_KEY, "base64"),
        ),
      ).toBe(true);
      expect(() =>
        verifyRevocationSignature(FROZEN_BODY, FROZEN_SIG, mangled),
      ).toThrow(/not base64/u);
    });

    it("REFUSES a BOM-prefixed wrapper, which Rust also refuses", () => {
      // ‼️ JS `trim()` strips U+FEFF and Rust's does not (code review LOW-1), so a BOM left by an
      // editor made a wrapper CI-green and client-refused. The trim here is an explicit ASCII set
      // for exactly this reason.
      expect(() =>
        verifyRevocationSignature(
          FROZEN_BODY,
          FROZEN_SIG,
          `\uFEFF${SHIPPED_KEY}`,
        ),
      ).toThrow(/not base64/u);
    });

    it("ACCEPTS a CRLF signature, as Rust's str::lines() does", () => {
      // The other direction: stricter than Rust blocks a publish rather than admitting a bad pair,
      // but it told an operator repairing a `.sig` on Windows that the signature did not verify
      // (code review LOW-2). `\r` is stripped where the crate strips it.
      const text = Buffer.from(FROZEN_SIG.trim(), "base64").toString("utf8");
      expect(() =>
        verifyRevocationSignature(
          FROZEN_BODY,
          wrap(text.replaceAll("\n", "\r\n")),
          SHIPPED_KEY,
        ),
      ).not.toThrow();
    });

    it("REFUSES payloads of the wrong length, each with its own message", () => {
      // Three length rules, none of which had a case: a 42-byte public key, a 74-byte signature
      // payload and a 64-byte global signature. Each is a plausible one-line permissive edit, and
      // dropping any of them lets a truncated file reach `crypto.verify` as a shape it cannot
      // report on usefully.
      const keyText = Buffer.from(SHIPPED_KEY, "base64").toString("utf8");
      const keyLines = keyText.trim().split("\n");
      const shortKey = Buffer.from(keyLines[1], "base64").subarray(0, 38);
      expect(() =>
        verifyRevocationSignature(
          FROZEN_BODY,
          FROZEN_SIG,
          wrap(`${keyLines[0]}\n${shortKey.toString("base64")}\n`),
        ),
      ).toThrow(/public key is 38 bytes/u);

      const sigLines = Buffer.from(FROZEN_SIG.trim(), "base64")
        .toString("utf8")
        .split("\n");
      const shortSignature = [...sigLines];
      shortSignature[1] = Buffer.from(sigLines[1], "base64")
        .subarray(0, 70)
        .toString("base64");
      expect(() =>
        verifyRevocationSignature(
          FROZEN_BODY,
          wrap(shortSignature.join("\n")),
          SHIPPED_KEY,
        ),
      ).toThrow(/signature payload is 70 bytes/u);

      const shortGlobal = [...sigLines];
      shortGlobal[3] = Buffer.from(sigLines[3], "base64")
        .subarray(0, 60)
        .toString("base64");
      expect(() =>
        verifyRevocationSignature(
          FROZEN_BODY,
          wrap(shortGlobal.join("\n")),
          SHIPPED_KEY,
        ),
      ).toThrow(/global signature is 60 bytes/u);
    });

    it("REFUSES a public key whose algorithm marker is neither Ed nor ED", () => {
      // Unreachable with real tooling, and the only rule in `parsePublicKey` that had no case.
      const keyLines = Buffer.from(SHIPPED_KEY, "base64")
        .toString("utf8")
        .trim()
        .split("\n");
      const raw = Buffer.from(keyLines[1], "base64");
      raw.write("XX", 0, "latin1");
      expect(() =>
        verifyRevocationSignature(
          FROZEN_BODY,
          FROZEN_SIG,
          wrap(`${keyLines[0]}\n${raw.toString("base64")}\n`),
        ),
      ).toThrow(/algorithm is "XX"/u);
    });

    it("REFUSES a signature missing its global signature line", () => {
      // A truncated `.sig` — a partial upload, a mangled copy — must be a named refusal rather
      // than an exception from indexing past the end of an array.
      const truncated = Buffer.from(
        Buffer.from(FROZEN_SIG.trim(), "base64")
          .toString("utf8")
          .split("\n")
          .slice(0, 3)
          .join("\n"),
      ).toString("base64");
      expect(() =>
        verifyRevocationSignature(FROZEN_BODY, truncated, SHIPPED_KEY),
      ).toThrow(/lines, not 4/u);
    });

    it("exits 0 through the CLI the workflow actually calls", () => {
      // ‼️ THE WORKFLOW'S ONLY INTERFACE IS THE EXIT CODE. Everything above tests the function; a
      // `process.exit(1)` dropped from the script's catch block would leave all of it green while
      // the gate reported success for a list no client accepts — the "logic in a run: block"
      // failure one layer up.
      const { status } = spawnSync(
        "npx",
        [
          "tsx",
          "scripts/verify-revocation-signature.ts",
          FIXTURE,
          `${FIXTURE}.sig`,
        ],
        { cwd: ROOT, encoding: "utf8" },
      );
      expect(status).toBe(0);
    });

    it("exits 1 through the CLI when the pair does not verify", () => {
      const dir = mkdtempSync(join(tmpdir(), "baram-sig-"));
      const body = join(dir, "revoked.json");
      writeFileSync(body, Buffer.concat([FROZEN_BODY, Buffer.from(" ")]));
      const { status, stderr } = spawnSync(
        "npx",
        [
          "tsx",
          "scripts/verify-revocation-signature.ts",
          body,
          `${FIXTURE}.sig`,
        ],
        { cwd: ROOT, encoding: "utf8" },
      );
      expect(status).toBe(1);
      // The message an operator sees in the Actions log, and it has to name the consequence.
      expect(stderr).toContain("would be REFUSED by every armed client");
    });

    it("reads exactly one shipped key declaration, and refuses to guess", () => {
      // ‼️ The scan is the same code the gate script runs, and its failure mode is reading *a*
      // match rather than *the* one. Two declarations must stop it, not silently pick the first.
      const rust = readFileSync(RUST_SOURCE, "utf8");
      expect(SHIPPED_KEY).not.toBe("");
      expect(() => shippedRevocationPublicKey(`${rust}\n${rust}`)).toThrow(
        /found 2 declarations/u,
      );
      // ‼️ The key id comes from the VERIFIER, not from a parse written here (code review LOW-8).
      // A third hand-rolled copy of this extraction is the same "scans *a* value" shape the scan
      // above exists to avoid — and the id it produced could differ from the key that verified,
      // which is precisely what the gate script printed as its proof.
      expect(
        verifyRevocationSignature(FROZEN_BODY, FROZEN_SIG, SHIPPED_KEY).keyId,
      ).toBe("16E6BEB0A78A3BB4");
    });

    it("returns the key id it actually verified with, not a fixed one", () => {
      // ‼️ THE CASE THAT KILLS A HARDCODED RETURN (round-2 mutation R9 survived without it).
      // Asserting the shipped id alone cannot tell a computed value from the literal
      // "16E6BEB0A78A3BB4", and that id is what the gate prints as its proof. A forged key has a
      // random id, so only a computed value can match it.
      const { keyIdHex, publicKeyB64, signatureB64 } = forge(FROZEN_BODY);
      const expected = Buffer.from(Buffer.from(keyIdHex, "hex"))
        .reverse()
        .toString("hex")
        .toUpperCase();
      expect(
        verifyRevocationSignature(FROZEN_BODY, signatureB64, publicKeyB64)
          .keyId,
      ).toBe(expected);
      expect(expected).not.toBe("16E6BEB0A78A3BB4");
    });

    it("reads the byte cap clients apply, and refuses an ambiguous source", () => {
      // ‼️ TESTABLE ONLY BECAUSE THE SCRAPE TAKES TEXT (round-2 mutation R13 survived while it read
      // the file itself: with no way to feed it two declarations, loosening `!== 1` to `< 1`
      // changed nothing any test could see).
      const rust = readFileSync(RUST_SOURCE, "utf8");
      expect(revocationByteCap(rust)).toBe(1024 * 1024);
      expect(() => revocationByteCap(`${rust}\n${rust}`)).toThrow(
        /found 2 declarations/u,
      );
      expect(() => revocationByteCap("nothing here")).toThrow(
        /found 0 declarations/u,
      );
      // A product is the only accepted form: anything else must throw rather than read as a
      // smaller number.
      expect(() =>
        revocationByteCap("const MAX_REVOCATION_BYTES: usize = 0;"),
      ).toThrow(/cannot read/u);
    });

    it("tolerates the &'static str spelling of the declaration", () => {
      // ‼️ Counting stops a declaration being ADDED; it cannot stop the real one being respelled so
      // the pattern misses it while a planted comment matches (security review HIGH-2). The
      // spellings a formatter or a reviewer might produce stay counted; the rest is closed in the
      // gate script, which checks the scraped key against the frozen pair.
      expect(
        shippedRevocationPublicKey(
          'pub const REVOCATION_PUBLIC_KEY: &\'static str =\n    "abc";',
        ),
      ).toBe("abc");
      expect(
        shippedRevocationPublicKey('REVOCATION_PUBLIC_KEY : &str = "abc";'),
      ).toBe("abc");
    });
  },
);
