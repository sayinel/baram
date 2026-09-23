// §29 The one remark stack the app reads markdown with.
//
// The literal analysis in the Rust backend (`src-tauri/src/md/literal/`) is a
// re-implementation of what THIS stack reads, measured rule by rule (issue
// 620). "This stack" therefore has to be one thing: when the plugin list or
// its options were copied, the copies were what the measurement was taken
// against in one place and not the other, and nothing would have said so.
//
// ‼️ Parsing only. `parseMdast` normalizes empty task items afterwards and
// `enrichWithEmptyParagraphs` adds nodes for blank lines; both are the
// pipeline's own business, downstream of the grammar. A reader that wants to
// know what the parser SAW — the literal ranges, the parity oracle of issue
// 669 — must not get them.
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import { unified } from "unified";

/**
 * The parser the pipeline, the text-path rename and the parity oracle share.
 *
 * ‼️ The options are grammar, but what makes them worth sharing is not that
 * each one is observable downstream. `["yaml"]` is: drop it and front matter
 * stops being a node, so a reference in it reads as prose (measured — the
 * parity corpus holds six such markers). `singleTilde: false` is not: `delete`
 * is not a literal type, and flipping the option moved the classification in
 * none of nine probed strikethrough shapes. A copy of this stack drifts on
 * either, and the corpus would only notice one — which is the gap the version
 * sentinel (`literal-measured-stack.test.ts`) covers.
 */
export const markdownParser = unified()
  .use(remarkParse)
  .use(remarkGfm, { singleTilde: false })
  .use(remarkMath)
  .use(remarkFrontmatter, ["yaml"]);
