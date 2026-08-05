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

import {
  keyIdLabel,
  shippedRevocationPublicKey,
  verifyRevocationSignature,
} from "../../../scripts/minisign-verify";

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
    publicKeyB64: Buffer.from(pubFile).toString("base64"),
    signatureB64: Buffer.from(sigFile).toString("base64"),
  };
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

    it("REFUSES a key mangled by whitespace that Node would decode anyway", () => {
      // ‼️ THE DIVERGENCE THIS GUARDS IS SILENT. `Buffer.from(value, "base64")` skips characters
      // outside the alphabet, so a key broken by a stray newline decodes to the SAME bytes here
      // and fails outright in Rust — CI green, every client refusing every list. Asserted rather
      // than described: the lenient decode is shown to succeed first.
      const mangled = `${SHIPPED_KEY.slice(0, 20)}\n${SHIPPED_KEY.slice(20)}`;
      expect(
        Buffer.from(mangled, "base64").equals(
          Buffer.from(SHIPPED_KEY, "base64"),
        ),
      ).toBe(true);
      expect(() =>
        verifyRevocationSignature(FROZEN_BODY, FROZEN_SIG, mangled),
      ).toThrow(/not base64/u);
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
      // The key that ships is the one the anchor above verified with, stated as an identity so a
      // scan that started matching a comment instead would fail here.
      expect(
        keyIdLabel(
          Buffer.from(
            Buffer.from(SHIPPED_KEY, "base64")
              .toString("utf8")
              .trim()
              .split("\n")[1],
            "base64",
          )
            .subarray(2, 10)
            .toString("hex"),
        ),
      ).toBe("16E6BEB0A78A3BB4");
    });
  },
);
