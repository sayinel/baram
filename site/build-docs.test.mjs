import { test } from "node:test";
import assert from "node:assert/strict";
import { slugify, extractToc, addHeadingIds, rewriteDocLinks } from "./build-docs.mjs";

test("slugify lowercases, strips punctuation, inline markup, and tags", () => {
  assert.equal(slugify("What is Baram?"), "what-is-baram");
  assert.equal(slugify("Math & `Code` Blocks"), "math-code-blocks");
  assert.equal(slugify("Themes <code>&amp;</code> Appearance"), "themes-appearance");
});

test("slugify yields identical ids for raw markdown and marked-escaped HTML", () => {
  assert.equal(slugify("Vault & Context System"), "vault-context-system");
  assert.equal(slugify("Vault &amp; Context System"), "vault-context-system");
  assert.equal(slugify("a key that's already in use"), slugify("a key that&#39;s already in use"));
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

test("extractToc and addHeadingIds disambiguate duplicate heading texts identically", () => {
  const md = "## Setup\n\ntext\n\n## Setup\n\n### Setup\n";
  assert.deepEqual(extractToc(md).map((t) => t.id), ["setup", "setup-1", "setup-2"]);
  assert.equal(
    addHeadingIds("<h2>Setup</h2><h2>Setup</h2><h3>Setup</h3>"),
    '<h2 id="setup">Setup</h2><h2 id="setup-1">Setup</h2><h3 id="setup-2">Setup</h3>',
  );
});

test("rewriteDocLinks converts local .md hrefs to .html, leaves externals", () => {
  assert.equal(rewriteDocLinks('<a href="faq.md">'), '<a href="faq.html">');
  assert.equal(rewriteDocLinks('<a href="user-guide.md#editing">'), '<a href="user-guide.html#editing">');
  assert.equal(
    rewriteDocLinks('<a href="https://example.com/x.md">'),
    '<a href="https://example.com/x.md">',
  );
});

test("rewriteDocLinks sends non-rendered md targets to GitHub", () => {
  assert.equal(
    rewriteDocLinks('<a href="plugin-development.md">'),
    '<a href="https://github.com/sayinel/baram/blob/main/docs/plugin-development.md">',
  );
  assert.equal(
    rewriteDocLinks('<a href="../README.md#build-from-source">'),
    '<a href="https://github.com/sayinel/baram/blob/main/README.md#build-from-source">',
  );
});
