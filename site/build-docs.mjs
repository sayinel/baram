#!/usr/bin/env node
// Assembles the deployable GitHub Pages site into dist-site/:
// copies site/ static files and pre-renders docs/*.md via marked.
// Spec: dev/superpowers/specs/2026-07-20-homepage-github-pages-design.md
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { marked } from "marked";

const SITE_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SITE_DIR, "..");
const OUT = join(ROOT, "dist-site");

export const DOCS = [
  { src: "user-guide.md", out: "user-guide.html", title: "User Guide" },
  { src: "keyboard-shortcuts.md", out: "keyboard-shortcuts.html", title: "Keyboard Shortcuts" },
  { src: "faq.md", out: "faq.html", title: "FAQ" },
];

export function slugify(text) {
  return text
    .replace(/<[^>]+>/g, "")
    .replace(/&#?[a-z0-9]+;/gi, "")
    .replace(/[`*_~]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-");
}

export function extractToc(md) {
  const toc = [];
  let inFence = false;
  for (const line of md.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const m = /^(#{2,3})\s+(.+?)\s*$/.exec(line);
    if (m) {
      const text = m[2].replace(/`/g, "");
      toc.push({ level: m[1].length, text, id: slugify(m[2]) });
    }
  }
  return toc;
}

export function addHeadingIds(html) {
  return html.replace(
    /<h([23])>([\s\S]*?)<\/h\1>/g,
    (_, level, inner) => `<h${level} id="${slugify(inner)}">${inner}</h${level}>`,
  );
}

export function rewriteDocLinks(html) {
  return html.replace(/href="([a-z0-9-]+)\.md(#[^"]*)?"/g, 'href="$1.html$2"');
}

export function renderDocPage({ title, bodyHtml, tocHtml, current }) {
  const docLinks = DOCS.map(
    (d) => `<a class="docs-nav-link${d.out === current ? " is-current" : ""}" href="${d.out}">${d.title}</a>`,
  ).join("\n          ");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title} — Baram</title>
  <meta name="description" content="Baram documentation — ${title}." />
  <link rel="icon" type="image/png" href="../assets/favicon.png" />
  <link rel="stylesheet" href="../style.css" />
</head>
<body>
<header class="nav">
  <div class="container nav-inner">
    <a class="nav-logo" href="../index.html">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="../assets/baram-logo-dark.png" />
        <img src="../assets/baram-logo.png" alt="Baram" />
      </picture>
    </a>
    <nav class="nav-links">
      <a href="../index.html#features">Features</a>
      <a href="../index.html#shortcuts">Shortcuts</a>
      <a href="../index.html#plugins">Plugins</a>
      <a href="../index.html#faq">FAQ</a>
    </nav>
    <div class="nav-actions">
      <a class="nav-github" href="https://github.com/sayinel/baram">GitHub</a>
    </div>
  </div>
</header>
<main>
  <div class="container docs-layout">
    <details class="docs-sidebar" open>
      <summary>Contents</summary>
      <nav>
          ${docLinks}
      </nav>
      <nav class="docs-toc">
${tocHtml}
      </nav>
    </details>
    <article class="docs-content">
${bodyHtml}
    </article>
  </div>
</main>
<footer class="footer">
  <div class="container">
    <span>Free &amp; open source, Apache-2.0 licensed.</span>
    <nav>
      <a href="https://github.com/sayinel/baram">GitHub</a>
      <a href="https://github.com/sayinel/baram/releases">Releases</a>
    </nav>
  </div>
</footer>
</body>
</html>
`;
}

export function buildSite() {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(join(OUT, "docs"), { recursive: true });
  for (const file of ["index.html", "style.css", "main.js", "i18n.js"]) {
    cpSync(join(SITE_DIR, file), join(OUT, file));
  }
  cpSync(join(SITE_DIR, "assets"), join(OUT, "assets"), { recursive: true });
  marked.setOptions({ gfm: true });
  for (const doc of DOCS) {
    const md = readFileSync(join(ROOT, "docs", doc.src), "utf8");
    const toc = extractToc(md);
    const body = addHeadingIds(rewriteDocLinks(marked.parse(md)));
    const tocHtml = toc
      .map((t) => `        <a class="toc-${t.level}" href="#${t.id}">${t.text}</a>`)
      .join("\n");
    writeFileSync(
      join(OUT, "docs", doc.out),
      renderDocPage({ title: doc.title, bodyHtml: body, tocHtml, current: doc.out }),
    );
  }
  console.log(`Built site → ${OUT}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  buildSite();
}
