/**
 * Prints the revocation floor compiled into this build (§69).
 *
 * ‼️ IMPORTED, NOT REGEX'D. The sibling drift guard in `revocation-client.test.ts` has to scan
 * Rust source and therefore has to assert a match COUNT; here the value is a TypeScript export,
 * so reading it directly removes the class of mistake where a scan finds *a* number rather than
 * *the* number.
 *
 * Exists for the publish gate: with the high-water mark session-scoped (see `partialize` and
 * `merge` in `stores/system/plugin.ts`), this constant is the only cross-restart replay defence,
 * so a release that forgets to raise it silently gives that defence up. Nothing failed when that
 * happened, which is what the gate fixes.
 *
 * Run: npx tsx scripts/revocation-floor.ts
 */
import { MINIMUM_REVOCATION_SEQUENCE } from "../src/plugins/revocation";

console.log(MINIMUM_REVOCATION_SEQUENCE);
