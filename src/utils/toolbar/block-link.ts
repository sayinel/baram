// src/utils/toolbar/block-link.ts

/** §4.8 Last path segment without a trailing `.md`. */
export function blockBasename(filePath: string): string {
  const last = filePath.split("/").pop() ?? filePath;
  return last.replace(/\.md$/i, "");
}

/** §4.8 Build a block link. `wikilink` → [[base#^id]], `ref` → ((base#^id)). */
export function buildBlockLink(
  basename: string,
  blockId: string,
  form: "ref" | "wikilink",
): string {
  return form === "wikilink"
    ? `[[${basename}#^${blockId}]]`
    : `((${basename}#^${blockId}))`;
}
