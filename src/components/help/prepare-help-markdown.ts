// Preprocess docs/*.md for the 360px Help Panel
// Keeps docs as single source of truth, transforms for panel display

/** Map of doc filenames → help tab IDs */
const DOC_TO_TAB: Record<string, string> = {
  "user-guide.md": "help:guide",
  "keyboard-shortcuts.md": "help:shortcuts",
  "faq.md": "help:faq",
};

/**
 * Preprocess raw markdown for display in the Help Panel.
 *
 * 1. Remove H1 title (duplicates tab label)
 * 2. Remove Table of Contents section
 * 3. Remove ASCII art code blocks (box-drawing chars)
 * 4. Convert inter-doc links to help: scheme
 * 5. Remove parent-path links (../README.md etc.) — keep text only
 */
export function prepareHelpMarkdown(raw: string): string {
  let md = raw;

  // 1. Remove first H1 line
  md = md.replace(/^# .+\n+/, "");

  // 2. Remove ToC section: "## Table of Contents" through next "---"
  md = md.replace(
    /## Table of Contents\n[\s\S]*?\n---\n*/,
    "",
  );

  // 3. Remove code blocks containing box-drawing characters (┌ └ │ ─)
  md = md.replace(/```[^\n]*\n[^`]*[┌└│─][^`]*```\n*/g, "");

  // 4. Convert inter-doc links: [text](keyboard-shortcuts.md) → [text](help:shortcuts)
  md = md.replace(
    /\[([^\]]+)\]\(([^)]+\.md(?:#[^)]*)?)\)/g,
    (_match, text: string, href: string) => {
      // Split off any #anchor
      const [filename, anchor] = href.split("#");
      const tabId = DOC_TO_TAB[filename];
      if (tabId) {
        return anchor ? `[${text}](${tabId}#${anchor})` : `[${text}](${tabId})`;
      }
      // Parent-path or unknown doc links → plain text
      if (filename.includes("/") || filename.startsWith("..")) {
        return text;
      }
      return `[${text}](${href})`;
    },
  );

  // 5. Remove remaining parent-path links: [text](../anything) → text
  md = md.replace(/\[([^\]]+)\]\(\.\.\/[^)]+\)/g, "$1");

  return md;
}
