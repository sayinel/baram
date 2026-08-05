/**
 * Verify a published revocation list against the key the APP actually ships (§69).
 *
 * ‼️ THE KEY IS READ OUT OF THE RUST SOURCE, and that is the point of the script rather than an
 * implementation detail. Verifying with a key passed in on the command line, or with the one
 * the signing secret happens to match, answers "did we sign this correctly" — a question that
 * cannot fail in a way anybody cares about. The question that matters is whether an ARMED
 * CLIENT will accept the bytes, and only the constant compiled into the app decides that. Get
 * the pair right and the key wrong and every client refuses the real list while CI is green,
 * which is the failure mode this whole gate exists for.
 *
 * ‼️ THE SCAN IS COUNT-ASSERTED. `REVOCATION_PUBLIC_KEY` also appears in comments, in call
 * sites and in Rust's own tests, so a search that took the first match could read a value that
 * is not the one that ships — this feature has already made that mistake four times, and
 * `dev/backlog.md` records the class. Exactly one DECLARATION must match, or this refuses to
 * proceed instead of guessing.
 *
 * Exits 0 when an armed client would accept the list, 1 when it would not, 2 on misuse.
 *
 * Run: npx tsx scripts/verify-revocation-signature.ts <revoked.json> <revoked.json.sig>
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  keyIdLabel,
  shippedRevocationPublicKey,
  verifyRevocationSignature,
} from "./minisign-verify";

const RUST_SOURCE = resolve(
  import.meta.dirname,
  "../src-tauri/src/plugin/mod.rs",
);

const [bodyPath, signaturePath] = process.argv.slice(2);
if (bodyPath === undefined || signaturePath === undefined) {
  console.error(
    "usage: verify-revocation-signature.ts <revoked.json> <revoked.json.sig>",
  );
  process.exit(2);
}

let publicKey: string;
try {
  publicKey = shippedRevocationPublicKey(readFileSync(RUST_SOURCE, "utf8"));
} catch (error) {
  console.error(
    `::error::cannot read the shipped key from ${RUST_SOURCE}: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(2);
}

if (publicKey === "") {
  // Not a permissive skip. An unarmed build ignores signatures, so nothing user-visible breaks
  // today — but publishing a pair nobody has ever verified is how a broken signing step stays
  // invisible until the arming release makes it everyone's problem at once.
  console.error(
    "::error::REVOCATION_PUBLIC_KEY is empty — signature enforcement is not armed, so there is no key to verify what clients will accept.",
  );
  process.exit(1);
}

try {
  const { trustedComment } = verifyRevocationSignature(
    readFileSync(bodyPath),
    readFileSync(signaturePath, "utf8"),
    publicKey,
  );
  const keyText = Buffer.from(publicKey, "base64").toString("utf8");
  const keyId = keyIdLabel(
    Buffer.from(keyText.trim().split("\n").at(-1) ?? "", "base64")
      .subarray(2, 10)
      .toString("hex"),
  );
  console.log(
    `signature verifies with the key this build ships (${keyId}) — trusted comment: ${trustedComment}`,
  );
} catch (error) {
  console.error(
    `::error::${bodyPath} would be REFUSED by every armed client: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
}
