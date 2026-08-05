import type { KeyObject } from "node:crypto";

/**
 * Verify a detached minisign signature over the revocation list, in Node (§69).
 *
 * ‼️ WHY A SECOND IMPLEMENTATION OF SOMETHING THE APP ALREADY DOES. The publish workflow could
 * not check a signature at all. It compared the served `.sig` byte-for-byte against the one it
 * had just committed, and grepped the trusted comment for a filename. Both are about
 * PROVENANCE — "is this the file we pushed" — and neither can answer whether the bytes verify.
 * A signature made over a different body, or with a key that is not the one clients ship,
 * passes both checks. The real answer needs the app's `verify_revocation_signature`, which
 * needs a Rust build, which this workflow has no minutes for.
 *
 * So this is the same recipe against the same key, in the runtime the workflow already has. It
 * answers exactly one question: WILL AN ARMED CLIENT ACCEPT WHAT WE JUST PUBLISHED. It is
 * deliberately not reachable from the app — the app's verifier is Rust, and a second verifier
 * in the product would be a second thing to keep in agreement.
 *
 * ‼️ THE DANGEROUS DIRECTION IS BEING MORE PERMISSIVE THAN RUST, not less. Anything this
 * accepts that `minisign-verify` refuses publishes a list every client rejects — which
 * presents as "revocations stopped working" with nothing red anywhere, the exact failure the
 * check is being added to catch. Three places that would drift that way, all closed
 * deliberately:
 *
 * - base64 is decoded STRICTLY. `Buffer.from(value, "base64")` silently ignores characters
 *   Rust's decoder rejects, so a key mangled by a stray newline would verify here and fail on
 *   every client. Same rejections for embedded whitespace and non-multiple-of-4 length; not a
 *   bit-exact port of the `base64` crate (trailing-bit canonicality is not chased).
 * - the legacy non-prehashed algorithm is REFUSED, matching `allow_legacy: false`. The Rust
 *   side says outright that its own flag is not pinned by a test because producing a legacy
 *   signature needs the minisign CLI; here one is FORGED in the test from a generated key, so
 *   this is the only executable statement of that rule in the repo.
 * - the trusted comment's global signature is checked. The crate checks it, so a `.sig` that
 *   failed only there would otherwise pass CI and fail every client.
 *
 * Pinned by `revocation-signature-verify.test.ts`, which runs the frozen at-arming pair that
 * the Rust test uses — one anchor both implementations must agree on.
 */
import { Buffer } from "node:buffer";
import { createHash, createPublicKey, verify } from "node:crypto";

/** DER prelude for a raw Ed25519 public key, so `createPublicKey` will take 32 bytes. */
const SPKI_ED25519_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

/** `tauri signer sign` emits this: Ed25519 over BLAKE2b-512 of the body. */
const PREHASHED_ALGORITHM = "ED";

/** Raw Ed25519 over the body itself. Older tooling only; refused, as on the Rust side. */
const LEGACY_ALGORITHM = "Ed";

const ED25519_SIGNATURE_BYTES = 64;
const ED25519_PUBLIC_KEY_BYTES = 32;
const ALGORITHM_BYTES = 2;
const KEY_ID_BYTES = 8;

interface ParsedPublicKey {
  key: KeyObject;
  keyId: string;
}

interface ParsedSignature {
  algorithm: string;
  globalSignature: Buffer;
  keyId: string;
  signature: Buffer;
  trustedComment: string;
}

/** minisign prints key ids big-endian; the bytes on the wire are little-endian. */
export function keyIdLabel(keyIdHex: string): string {
  return (
    (keyIdHex.match(/../gu) ?? [])
      .reverse()
      .join("")
      .toUpperCase() || "unknown"
  );
}

/**
 * Throw unless `body` is signed by `publicKeyB64`; return the trusted comment and the key id.
 *
 * Same argument shape as the Rust `verify_revocation_signature(body, signature_b64,
 * public_key_b64)` on purpose: both the key and the signature arrive base64-WRAPPED around a
 * minisign block, which is what `tauri signer` emits and what the app stores and fetches. One
 * fewer difference between the two implementations to reason about.
 *
 * ‼️ IT RETURNS THE KEY ID SO NOBODY RE-DERIVES IT (code review LOW-8, security review LOW-5).
 * The gate script printed an id from its own second parse — lenient base64, and the LAST line
 * rather than line 2 — so the id offered as proof could come from a different line than the key
 * that actually verified. Three unshared scans of one value is the same shape as the mistake this
 * feature has made four times; one return value deletes two of them.
 */
export function verifyRevocationSignature(
  body: Uint8Array,
  signatureB64: string,
  publicKeyB64: string,
): { keyId: string; trustedComment: string } {
  const { key, keyId } = parsePublicKey(
    decodeWrapper(publicKeyB64, "public key"),
  );
  const parsed = parseSignature(
    decodeWrapper(signatureB64, "signature"),
  );
  if (parsed.keyId !== keyId) {
    throw new Error(
      `revocation signature was made by key ${keyIdLabel(parsed.keyId)}, not ${keyIdLabel(keyId)} — this list was signed with a different key`,
    );
  }
  // ‼️ The legacy form is refused BEFORE it is verified, so a mathematically valid raw-Ed25519
  // signature still fails here. `allow_legacy: false` on the Rust side means clients refuse it,
  // and CI accepting what clients refuse is the one outcome this file exists to prevent.
  if (parsed.algorithm === LEGACY_ALGORITHM) {
    throw new Error(
      "revocation signature uses the legacy non-prehashed algorithm, which armed clients refuse",
    );
  }
  if (parsed.algorithm !== PREHASHED_ALGORITHM) {
    throw new Error(
      `revocation signature algorithm is "${parsed.algorithm}", which is neither ${PREHASHED_ALGORITHM} nor ${LEGACY_ALGORITHM}`,
    );
  }
  const prehashed = createHash("blake2b512").update(body).digest();
  if (!verify(null, prehashed, key, parsed.signature)) {
    throw new Error("revocation list signature does not verify");
  }
  // Covers the trusted comment, which is where the filename and timestamp live. Without this
  // the comment is unauthenticated text next to an authenticated body.
  if (
    !verify(
      null,
      Buffer.concat([parsed.signature, Buffer.from(parsed.trustedComment)]),
      key,
      parsed.globalSignature,
    )
  ) {
    throw new Error("revocation trusted comment's global signature does not verify");
  }
  return { keyId: keyIdLabel(keyId), trustedComment: parsed.trustedComment };
}

/**
 * `str::trim()`, restricted to ASCII whitespace.
 *
 * ‼️ JS `trim()` strips U+FEFF and Rust's White_Space property does not, so a BOM-prefixed wrapper
 * was accepted here and refused there (round-1 code review LOW-1). The set here is ASCII whitespace
 * PLUS U+000B — vertical tab is ASCII but `is_ascii_whitespace()` excludes it while `str::trim()`
 * trims it, and including it removes eight divergences a probe found (third-round LOW-7). One of
 * them was non-obvious: bumping the shipped key wrapper's last base64 character turns the block's
 * trailing 0x0A into 0x0B, which Rust trims.
 *
 * The remaining difference runs the other way — Rust also trims U+0085, U+00A0, U+2028 and friends,
 * which nothing emits — so it can only refuse a publish, never admit a bad pair.
 *
 * Applied at exactly the two places Rust applies it: the base64 wrapper (`decode_b64_text` trims)
 * and the whole public-key text (`PublicKey::decode(key_text.trim())`). NOT to the signature text,
 * and NOT to individual lines.
 */
function asciiTrim(value: string): string {
  return value.replace(/^[\t\n\v\f\r ]+|[\t\n\v\f\r ]+$/gu, "");
}

/**
 * base64-decode the way Rust does, or throw.
 *
 * ‼️ THE THREE RULES ARE NOT INDEPENDENT, and an earlier version of this line said they were
 * (third-round code review LOW-1). Canonicality subsumes the other two: a re-encoded string is
 * always canonical and always a multiple of 4, so it can never equal an input that breaks either.
 * Removing the alphabet check or the length check produces ZERO new divergences from Rust — they
 * survive as message-quality guards, not as behaviour. Keeping them is deliberate (an operator gets
 * "is not base64" instead of "is not canonical base64" for a mangled paste), but the tests below
 * pin their MESSAGES, not a behaviour only they provide.
 *
 * ‼️ THE CANONICALITY RULE IS THE REACHABLE ONE, and the first version of this file disclosed it
 * as if it were not (code review MEDIUM-1). Both Rust decoders refuse a final character whose
 * spare bits are non-zero — `base64`'s `decode_allow_trailing_bits: false` and
 * `minisign-verify/src/base64.rs`'s `(acc & mask) != 0`. Every minisign signature HAS spare bits:
 * the signature line decodes to 74 bytes (2 spare) and the global-signature line to 64 (4
 * spare), so bumping the last character of either leaves the decoded bytes identical, and a
 * verifier without this rule accepts a `.sig` every armed client refuses at decode. The original
 * docstring called the gap "not chased" and attributed it to the outer wrapper, which is the
 * half with no padding at all — a disclosure that pointed away from the live case.
 *
 * Re-encoding is the whole rule: Node emits canonical base64, so a round trip that does not
 * reproduce the input had non-zero spare bits or non-canonical padding.
 *
 * ‼️ TRIMMED WITH AN ASCII SET, NOT `String.prototype.trim()` (code review LOW-1). JS trims
 * U+FEFF; Rust's `str::trim()` uses the White_Space property, which does not — so a BOM-prefixed
 * key was accepted here and refused there. The remaining difference is the other way round
 * (Rust also trims U+00A0 and friends, which nothing emits), so it can only refuse a publish.
 */
function decodeStrictBase64(value: string, what: string): Buffer {
  // ‼️ NO TRIM HERE (code review + security review HIGH, found independently and each proved
  // end-to-end). The character SET was never the divergence — WHERE a trim happens is. The crate
  // decodes each line with no trim at all, and its base64 decoder stops at the first non-alphabet
  // byte and then demands the rest be padding, so ONE TRAILING SPACE on the signature payload line
  // is `InvalidInput` in Rust. Trimming per line accepted exactly that, and the reviewer walked it
  // through the real gate step: `publish=false`, both new verification steps green, every armed
  // client refusing every list — with no re-sign, because the gate had declared the pair healthy.
  // Rust's two trims are reproduced at their own call sites, and nowhere else.
  const trimmed = value;
  if (!/^[A-Za-z0-9+/]*={0,2}$/u.test(trimmed)) {
    throw new Error(`revocation ${what} is not base64`);
  }
  if (trimmed.length % 4 !== 0) {
    throw new Error(
      `revocation ${what} is ${trimmed.length} base64 characters, not a multiple of 4`,
    );
  }
  const decoded = Buffer.from(trimmed, "base64");
  if (decoded.toString("base64") !== trimmed) {
    throw new Error(`revocation ${what} is not canonical base64`);
  }
  return decoded;
}

/**
 * Decode a wrapper the way `decode_b64_text` does — base64 AND `String::from_utf8`.
 *
 * ‼️ THE UTF-8 HALF WAS NEVER PORTED (third-round code review HIGH-2). `decode_b64_text` is two
 * steps and only the first was reproduced: `Buffer.toString("utf8")` substitutes U+FFFD and never
 * throws, while `String::from_utf8` is a hard error. So one invalid byte anywhere the parser does
 * not read — the untrusted comment, or trailing garbage after the block — was silently repaired
 * here and refused on every client. Worse for the signature side than the key side: the frozen-pair
 * Rust test catches a non-UTF-8 KEY, and nothing anywhere catches a non-UTF-8 `.sig`, so this
 * script was the only thing between one and Pages.
 */
function decodeWrapper(value: string, what: string): string {
  const raw = decodeStrictBase64(asciiTrim(value), `${what} wrapper`);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(raw);
  } catch {
    throw new Error(`revocation ${what} is not UTF-8`);
  }
}

/**
 * Parse a minisign `.pub` file's text: a comment line, then the key line.
 *
 * ‼️ THE KEY LINE IS LINE 2, UNCONDITIONALLY (code review + security review HIGH-1, found
 * independently). This used to fall back to line 1 for a single-line input, with a comment
 * claiming `PublicKey::decode` does the same. It does not: `minisign-verify-0.2.5/src/lib.rs`
 * `decode` calls `lines.next()` twice and `ok_or(InvalidEncoding)?` on the second, so a bare key
 * line is refused. `from_base64` is the method that accepts one, and `mod.rs` calls `decode`.
 *
 * The edit that would have hit it is a key ROTATION pasting the key line alone — natural, since
 * the constant is an opaque blob. Both gate steps would have gone green and every armed client
 * would have refused every list with "public key is unusable", which is verbatim the outcome
 * this file exists to prevent.
 */
function parsePublicKey(text: string): ParsedPublicKey {
  const lines = rustLines(asciiTrim(text));
  if (lines.length < 2) {
    throw new Error(
      "revocation public key has no key line — a minisign public key is a comment line followed by the key",
    );
  }
  const raw = decodeStrictBase64(lines[1], "public key line");
  if (raw.length !== ALGORITHM_BYTES + KEY_ID_BYTES + ED25519_PUBLIC_KEY_BYTES) {
    throw new Error(
      `revocation public key is ${raw.length} bytes, not ${
        ALGORITHM_BYTES + KEY_ID_BYTES + ED25519_PUBLIC_KEY_BYTES
      } — truncated, or not a minisign public key`,
    );
  }
  // ‼️ BOTH CASINGS, because `from_base64` accepts `Ed` and `ED` for a public key (code review
  // LOW-3). Requiring one was stricter than Rust — it can only block a publish, never admit a bad
  // pair, but a refusal whose message reads "not Ed25519" for a key Rust loads fine would send
  // whoever hits it looking in the wrong place.
  const algorithm = raw.subarray(0, ALGORITHM_BYTES).toString("latin1");
  if (algorithm !== LEGACY_ALGORITHM && algorithm !== PREHASHED_ALGORITHM) {
    throw new Error(
      `revocation public key algorithm is "${algorithm}", not Ed25519`,
    );
  }
  return {
    key: createPublicKey({
      format: "der",
      key: Buffer.concat([
        SPKI_ED25519_PREFIX,
        raw.subarray(ALGORITHM_BYTES + KEY_ID_BYTES),
      ]),
      type: "spki",
    }),
    keyId: raw.subarray(ALGORITHM_BYTES, ALGORITHM_BYTES + KEY_ID_BYTES).toString("hex"),
  };
}

/**
 * Parse a minisign `.sig` file's text: untrusted comment, signature, trusted comment, global
 * signature. All four lines are required, as `Signature::decode` requires them.
 */
function parseSignature(text: string): ParsedSignature {
  // ‼️ CRLF IS STRIPPED, as `str::lines()` strips it (code review LOW-2). Splitting on "\n" alone
  // left the `\r` inside the trusted comment, which then went into the global-signature message —
  // so a CRLF `.sig` that Rust accepts was refused here with "the global signature does not
  // verify", i.e. an operator repairing a signature on Windows was told it was forged.
  // ‼️ NOT TRIMMED, because `mod.rs` hands `Signature::decode` the text untouched — see
  // `decodeStrictBase64`. One leading newline shifts every line by one and the crate then tries to
  // base64-decode "untrusted comment: …", so a block with a blank first line is refused there and
  // must be refused here.
  const lines = rustLines(text);
  if (lines.length < 4) {
    throw new Error(
      `revocation signature has ${lines.length} lines, not 4 — the trusted comment or its global signature is missing`,
    );
  }
  const trustedCommentPrefix = "trusted comment: ";
  if (!lines[2].startsWith(trustedCommentPrefix)) {
    throw new Error("revocation signature has no trusted comment line");
  }
  const raw = decodeStrictBase64(lines[1], "signature payload");
  if (raw.length !== ALGORITHM_BYTES + KEY_ID_BYTES + ED25519_SIGNATURE_BYTES) {
    throw new Error(
      `revocation signature payload is ${raw.length} bytes, not ${
        ALGORITHM_BYTES + KEY_ID_BYTES + ED25519_SIGNATURE_BYTES
      } — truncated`,
    );
  }
  const globalSignature = decodeStrictBase64(lines[3], "global signature");
  if (globalSignature.length !== ED25519_SIGNATURE_BYTES) {
    throw new Error(
      `revocation global signature is ${globalSignature.length} bytes, not ${ED25519_SIGNATURE_BYTES}`,
    );
  }
  return {
    algorithm: raw.subarray(0, ALGORITHM_BYTES).toString("latin1"),
    globalSignature,
    keyId: raw.subarray(ALGORITHM_BYTES, ALGORITHM_BYTES + KEY_ID_BYTES).toString("hex"),
    signature: raw.subarray(ALGORITHM_BYTES + KEY_ID_BYTES),
    trustedComment: lines[2].slice(trustedCommentPrefix.length),
  };
}

/**
 * Split like Rust's `str::lines()`: on "\n", dropping one trailing "\r" per line, and without a
 * trailing empty line when the text ends in a newline.
 *
 * That last part is why `lines()` tolerates a final newline while refusing a LEADING one, and it
 * is the behaviour both the 4-line count and the line indices depend on.
 */
function rustLines(text: string): string[] {
  // ‼️ `\r` COMES OFF ONLY A `\n`-TERMINATED SEGMENT (third-round code review HIGH-1, proven against
  // a rustc probe over all 1,092 strings of `{a,\n,\r}` up to length 6 — 364 diverged). `LinesMap`
  // is `strip_suffix('\n')?` and only then `strip_suffix('\r')`, so a text NOT ending in a newline
  // keeps its trailing `\r`. Stripping unconditionally accepted a block ending in a bare `\r` — what
  // a `$(cat …)` round trip of a CRLF `.sig` produces, since it drops trailing newlines and not the
  // `\r` — while the crate refuses it at base64 decode. Dangerous direction, and the CRLF case that
  // already existed could not see it: it built `\r\n` endings, which both sides accept.
  if (text === "") return [];
  const segments = text.split("\n");
  const lines = segments.map((line, index) =>
    index < segments.length - 1 ? line.replace(/\r$/u, "") : line,
  );
  // `"a\n".lines()` yields one line, not two. The last segment is dropped only when it is the empty
  // remainder after a final newline.
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}
