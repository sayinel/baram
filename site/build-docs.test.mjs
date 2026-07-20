import { test } from "node:test";
import assert from "node:assert/strict";
import { slugify, extractToc, addHeadingIds, rewriteDocLinks } from "./build-docs.mjs";

test("slugify lowercases, strips punctuation, inline markup, and tags", () => {
  assert.equal(slugify("What is Baram?"), "what-is-baram");
  assert.equal(slugify("Math & `Code` Blocks"), "math-code-blocks");
  assert.equal(slugify("Themes <code>&amp;</code> Appearance"), "themes-amp-appearance");
});

test("extractToc collects h2/h3, skipping fenced code blocks", () => {
  const md = [
    "# Title", "## General", "### What is Baram?",
    "```", "## not a heading", "```", "## Editing",
  ].join("\n");
  assert.deepEqual(extractToc(md), [
    { level: 2, text: "General", id: "general" },
    { level: 3, text: "What is Baram?", id: "what-is-baram" },
    { level: 2, text: "Editing", id: "editing" },
  ]);
});

test("addHeadingIds stamps slug ids on h2/h3 only", () => {
  assert.equal(addHeadingIds("<h2>General</h2>"), '<h2 id="general">General</h2>');
  assert.equal(
    addHeadingIds("<h3>Use <code>Cmd+K</code></h3>"),
    '<h3 id="use-cmdk">Use <code>Cmd+K</code></h3>',
  );
  assert.equal(addHeadingIds("<h1>Title</h1>"), "<h1>Title</h1>");
});

test("rewriteDocLinks converts local .md hrefs to .html, leaves externals", () => {
  assert.equal(rewriteDocLinks('<a href="faq.md">'), '<a href="faq.html">');
  assert.equal(rewriteDocLinks('<a href="user-guide.md#editing">'), '<a href="user-guide.html#editing">');
  assert.equal(
    rewriteDocLinks('<a href="https://example.com/x.md">'),
    '<a href="https://example.com/x.md">',
  );
});
