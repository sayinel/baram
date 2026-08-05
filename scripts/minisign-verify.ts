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

import type { KeyObject } from "node:crypto";

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

/**
 * base64-decode the way Rust's `decode_b64_text` does, or throw.
 *
 * Leading and trailing whitespace is trimmed (Rust trims too); anything else outside the
 * alphabet is a refusal rather than a silent skip.
 */
function decodeStrictBase64(value: string, what: string): Buffer {
  const trimmed = value.trim();
  if (!/^[A-Za-z0-9+/]*={0,2}$/u.test(trimmed) || trimmed.length % 4 !== 0) {
    throw new Error(`revocation ${what} is not base64`);
  }
  return Buffer.from(trimmed, "base64");
}

/** Parse a minisign `.pub` file's text: a comment line, then the key line. */
function parsePublicKey(text: string): ParsedPublicKey {
  // A bare key line is accepted as well as the two-line file, because `PublicKey::decode` is.
  const lines = text.trim().split("\n");
  const keyLine = lines.length > 1 ? lines[1] : lines[0];
  const raw = decodeStrictBase64(keyLine, "public key");
  if (raw.length !== ALGORITHM_BYTES + KEY_ID_BYTES + ED25519_PUBLIC_KEY_BYTES) {
    throw new Error(
      `revocation public key is ${raw.length} bytes, not ${
        ALGORITHM_BYTES + KEY_ID_BYTES + ED25519_PUBLIC_KEY_BYTES
      } — truncated, or not a minisign public key`,
    );
  }
  const algorithm = raw.subarray(0, ALGORITHM_BYTES).toString("latin1");
  if (algorithm !== LEGACY_ALGORITHM) {
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
  const lines = text.trim().split("\n");
  if (lines.length < 4) {
    throw new Error(
      `revocation signature has ${lines.length} lines, not 4 — the trusted comment or its global signature is missing`,
    );
  }
  const trustedCommentPrefix = "trusted comment: ";
  if (!lines[2].startsWith(trustedCommentPrefix)) {
    throw new Error("revocation signature has no trusted comment line");
  }
  const raw = decodeStrictBase64(lines[1], "signature");
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
 * Throw unless `body` is signed by `publicKeyB64`, and return the trusted comment.
 *
 * Same argument shape as the Rust `verify_revocation_signature(body, signature_b64,
 * public_key_b64)` on purpose: both the key and the signature arrive base64-WRAPPED around a
 * minisign block, which is what `tauri signer` emits and what the app stores and fetches. One
 * fewer difference between the two implementations to reason about.
 */
export function verifyRevocationSignature(
  body: Uint8Array,
  signatureB64: string,
  publicKeyB64: string,
): { trustedComment: string } {
  const { key, keyId } = parsePublicKey(
    decodeStrictBase64(publicKeyB64, "public key").toString("utf8"),
  );
  const parsed = parseSignature(
    decodeStrictBase64(signatureB64, "signature").toString("utf8"),
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
  return { trustedComment: parsed.trustedComment };
}

/**
 * The revocation key a build of the app verifies with, read out of its Rust source.
 *
 * ‼️ COUNT-ASSERTED, AND SHARED WITH THE TEST FOR THAT REASON. `REVOCATION_PUBLIC_KEY` also
 * appears in comments, at call sites and in Rust's own tests, so a scan that took the first
 * match could read a value that is not the one that ships — `dev/backlog.md` records four
 * separate times this feature made exactly that mistake. Exactly one DECLARATION must match.
 *
 * It is a function over source TEXT rather than a file reader so the gate script and its test
 * call the same code. Two copies of a scan is two scans that can disagree, and the one in the
 * test would be the one that stays green.
 */
export function shippedRevocationPublicKey(rustSource: string): string {
  const declarations = [
    ...rustSource.matchAll(/REVOCATION_PUBLIC_KEY: &str =\s*"([^"]*)"/gu),
  ];
  if (declarations.length !== 1) {
    throw new Error(
      `found ${declarations.length} declarations of REVOCATION_PUBLIC_KEY — refusing to guess which one ships`,
    );
  }
  return declarations[0][1];
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
