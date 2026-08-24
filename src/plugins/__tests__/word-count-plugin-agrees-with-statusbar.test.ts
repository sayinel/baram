// §4.8 THE reported bug: the Word Count plugin and the native status bar showed different
// word counts, side by side, in the same status bar. Both were wrong — the bar fused words
// across every block boundary, the plugin counted `#`, `-` and `|` as words.
//
// This closes the loop the two unit suites leave open. `word-count.test.ts` pins the app's
// policy and `reference-plugins.test.ts` pins that the plugin asks for `getText()`; neither
// asserts that the two NUMBERS agree, which is the only thing the user could see.
import { getSchema } from "@tiptap/core";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { createBaramExtensions } from "../../extensions";
import { markdownToProsemirror } from "../../pipeline/md-to-pm";
import { prosemirrorToMarkdown } from "../../pipeline/pm-to-md";
import { countDocumentWords, documentProseText } from "../../utils/word-count";

const schema = getSchema(createBaramExtensions());
const DIST = resolve(
  __dirname,
  "../../../examples/plugins/word-count/dist/index.mjs",
);

/**
 * The plugin's OWN tokenizer, lifted out of the shipped bundle rather than re-typed here.
 * Re-typing it would test a copy — the point is that the artifact users install agrees.
 */
function pluginCount(text: string): { chars: number; words: number } {
  const bundle = readFileSync(DIST, "utf8");
  const body = /function count\(text\) \{([\s\S]*?)\n\}/u.exec(bundle)?.[1];
  if (!body) throw new Error("could not lift count() out of the shipped dist");
  const fn = new Function("text", body) as (t: string) => {
    chars: number;
    words: number;
  };
  return fn(text);
}

/**
 * What the host stages for `ctx.editor.getText()` — the sandbox returns this string verbatim,
 * so it is exactly the plugin's input.
 */
const stagedForPlugin = (doc: Parameters<typeof documentProseText>[0]) =>
  documentProseText(doc);

describe("the Word Count plugin agrees with the native status bar", () => {
  // ‼️ A source-scan lift finds *a* match, not *the* match. A regex that grabbed the wrong
  // block would still return numbers and every agreement test below would pass on two wrong
  // implementations, so pin the lifted function to a known answer before trusting it.
  it("lifted the plugin's real count() out of the bundle", () => {
    expect(pluginCount("one two three")).toEqual({ chars: 13, words: 3 });
    expect(pluginCount("   ")).toEqual({ chars: 3, words: 0 });
  });

  const CASES: Array<[string, string]> = [
    ["two paragraphs", "Hello world\n\nSecond paragraph here\n"],
    [
      "headings, list, emphasis",
      "# Title Here\n\nSome **bold** text.\n\n- one item\n- two item\n\n## End\n\nDone.\n",
    ],
    [
      "code, table and math",
      "Intro.\n\n```js\nconst a = 1;\n```\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n$$\nx^2\n$$\n\nOutro.\n",
    ],
    [
      "frontmatter and wikilinks",
      "---\ntitle: My Note\n---\n\nSee [[Some Page]] and [[slug|An Alias]] today.\n",
    ],
    [
      "ten one-word paragraphs",
      "a\n\nb\n\nc\n\nd\n\ne\n\nf\n\ng\n\nh\n\ni\n\nj\n",
    ],
    ["empty document", ""],
  ];

  for (const [name, markdown] of CASES) {
    it(`reports the same number for ${name}`, () => {
      const doc = markdownToProsemirror(markdown, schema);
      const bar = countDocumentWords(doc);
      const plugin = pluginCount(stagedForPlugin(doc)).words;
      expect(plugin).toBe(bar);
    });
  }

  // The shipped docs, as the widest corpus available without inventing one. The magnitude is
  // the point: on `keyboard-shortcuts.md` the two used to differ by more than 1,000 words.
  for (const file of [
    "docs/user-guide.md",
    "docs/faq.md",
    "docs/keyboard-shortcuts.md",
  ]) {
    it(`reports the same number for ${file}`, () => {
      const doc = markdownToProsemirror(readFileSync(file, "utf8"), schema);
      expect(pluginCount(stagedForPlugin(doc)).words).toBe(
        countDocumentWords(doc),
      );
    });
  }

  // ‼️ The guard above is only meaningful if the OLD input would break it — otherwise it
  // passes for any two tokenizers that happen to match. `getMarkdown()` is what the plugin
  // used to read, and it must NOT produce the bar's number.
  it("would disagree if the plugin still read the markdown source", () => {
    const doc = markdownToProsemirror(
      readFileSync("docs/keyboard-shortcuts.md", "utf8"),
      schema,
    );
    const viaMarkdown = pluginCount(prosemirrorToMarkdown(doc)).words;
    expect(viaMarkdown).not.toBe(countDocumentWords(doc));
    expect(viaMarkdown).toBeGreaterThan(countDocumentWords(doc));
  });
});
