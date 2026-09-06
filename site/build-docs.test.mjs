import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { marked } from "marked";
import { slugify, extractToc, addHeadingIds, rewriteDocLinks, normalizeAnchorHrefs, DOCS } from "./build-docs.mjs";

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

// ─── anchor fragments must resolve to the ids we stamp ────────────────────────
//
// A heading with "&" or "/" in it produces a GitHub anchor with a doubled hyphen
// ("## Vault & Context System" → #vault--context-system), because GitHub replaces
// each space with one hyphen. slugify() here collapses whitespace runs instead, so
// the id it stamps is single-hyphenated. Links written for GitHub therefore missed
// their target on the built site — silently, since a dead fragment just does nothing.
// Every href that points at a page we generate is now put through the same slugify
// as the id, so the two cannot drift.

test("normalizeAnchorHrefs puts same-page fragments through slugify", () => {
  assert.equal(
    normalizeAnchorHrefs('<a href="#vault--context-system">x</a>'),
    '<a href="#vault-context-system">x</a>',
  );
  assert.equal(
    normalizeAnchorHrefs('<a href="#already-fine">x</a>'),
    '<a href="#already-fine">x</a>',
  );
});

test("normalizeAnchorHrefs leaves non-fragment hrefs alone", () => {
  const external = '<a href="https://example.com/page#some--frag">x</a>';
  assert.equal(normalizeAnchorHrefs(external), external);
  const page = '<a href="faq.html#a--b">x</a>';
  assert.equal(normalizeAnchorHrefs(page), page);
});

test("rewriteDocLinks normalizes the fragment for pages it generates", () => {
  assert.equal(
    rewriteDocLinks('<a href="user-guide.md#pdf-reading--highlights">'),
    '<a href="user-guide.html#pdf-reading-highlights">',
  );
});

test("rewriteDocLinks keeps the GitHub fragment verbatim for GitHub targets", () => {
  // github.com renders the markdown itself, so the anchor there is GitHub's own —
  // normalizing it to our id spelling would break a link that currently works.
  assert.equal(
    rewriteDocLinks('<a href="plugin-development.md#trust-model--security">'),
    '<a href="https://github.com/sayinel/baram/blob/main/docs/plugin-development.md#trust-model--security">',
  );
});

test("every in-page anchor in the shipped docs resolves to a heading id", () => {
  const docsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "docs");
  const pageIds = new Map();
  const pageHrefs = new Map();

  for (const doc of DOCS) {
    const md = readFileSync(join(docsDir, doc.src), "utf8");
    const html = addHeadingIds(normalizeAnchorHrefs(rewriteDocLinks(marked.parse(md))));
    pageIds.set(doc.out, new Set([...html.matchAll(/<h[23] id="([^"]+)"/g)].map((m) => m[1])));
    pageHrefs.set(doc.out, [...html.matchAll(/href="([^"]*#[^"]+)"/g)].map((m) => m[1]));
  }

  const dead = [];
  for (const [out, hrefs] of pageHrefs) {
    for (const href of hrefs) {
      if (/^https?:/.test(href)) continue;
      const [page, frag] = href.split("#");
      const target = page === "" ? out : page;
      const ids = pageIds.get(target);
      if (!ids) continue; // not a page we generate
      if (!ids.has(frag)) dead.push(`${out} -> ${href}`);
    }
  }
  assert.deepEqual(dead, [], `dead anchors on the built site:\n${dead.join("\n")}`);
});
