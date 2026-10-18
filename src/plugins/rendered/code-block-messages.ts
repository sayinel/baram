// §394 spec 0073 §6 — the fixed refusals of `ctx.codeBlocks`, one home for both tiers (the trusted
// API and the sandbox client), so a plugin meets the same sentence whichever tier it runs in. A
// leaf: the sandbox realm imports it.

/** `register` / `invalidate` of a language the manifest does not declare. */
export function undeclaredLangMessage(
  method: "invalidate" | "register",
  lang: string,
): string {
  return `codeBlocks.${method}: "${lang}" is not declared in contributions.codeBlocks`;
}

/** `register` of a language a plugin loaded earlier draws (D5). */
export function drawnByMessage(lang: string, owner: string): string {
  return `codeBlocks.register: \`\`\`${lang} is drawn by ${owner}`;
}

/** A sandbox without `codeblocks` — the trusted tier's denied-proxy sentence, for the same call. */
export function codeBlocksDeniedMessage(method: string): string {
  return (
    `Plugin requires "codeblocks" capability to access codeBlocks.${method}. ` +
    `Add "codeblocks" to the capabilities array in baram-plugin.json.`
  );
}
