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
 * `singleTilde: false` and `["yaml"]` are part of the grammar, not defaults:
 * with `singleTilde` on, `~x~` is strikethrough and its bytes are not text;
 * without the `yaml` argument, front matter is not a node and a reference in
 * it would read as prose.
 */
export const markdownParser = unified()
  .use(remarkParse)
  .use(remarkGfm, { singleTilde: false })
  .use(remarkMath)
  .use(remarkFrontmatter, ["yaml"]);
