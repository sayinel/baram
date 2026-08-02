/**
 * An untrusted string, made safe to print from a GitHub Actions step.
 *
 * §69 security review (LOW-1). The registry validators echo the id they are complaining
 * about, and they run inside workflows. Actions parses workflow commands out of step
 * OUTPUT, so an id containing a newline followed by `::error title=…::` writes a forged
 * annotation on the job, and `::stop-commands::` silences every real one after it.
 * Reproduced against the shipped script before this was added.
 *
 * Nothing worse than log spoofing is reachable — `::set-env::` and `::set-output::` are
 * disabled and `::add-mask::` cannot unmask a secret — but a gate whose whole purpose is to
 * TELL THE OPERATOR something must not let the document being judged write the verdict.
 *
 * Shared rather than copied: it lived in `validate-index.ts` alone until
 * `validate-registry-assets.ts` needed the same protection, and a security control that
 * exists in two hand-copied versions is one that will exist in one of them tomorrow.
 *
 * ‼️ Flat in `scripts/`, not `scripts/lib/`. The repo's `.gitignore` carries a bare `lib/`
 * rule, which silently swallows any such directory — the first version of this file was
 * untracked and would have reached CI as a missing import.
 */
export function label(raw: string): string {
  const flattened = raw
    .replaceAll(/[\n\r]/gu, "⏎")
    // The command prefix itself, so no reassembly survives the newline strip.
    .replaceAll("::", "∷");
  return flattened.length > 80 ? `${flattened.slice(0, 80)}…` : flattened;
}
