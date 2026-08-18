# Baram Homepage (GitHub Pages) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a static product homepage for Baram at `https://sayinel.github.io/baram/`, built from a new `site/` directory and deployed by a new GitHub Actions Pages workflow, with docs pre-rendered from `docs/*.md` at deploy time.

**Architecture:** Pure static HTML/CSS + vanilla ES modules (no framework, no bundler). A single Node build script (`site/build-docs.mjs`, using `marked`) assembles the deployable site into `dist-site/` (gitignored): it copies the static landing page files and pre-renders `docs/user-guide.md`, `docs/keyboard-shortcuts.md`, `docs/faq.md` into shell-wrapped HTML pages with a sidebar TOC. GitHub Actions runs the script and uploads `dist-site/` as the Pages artifact.

**Tech Stack:** HTML/CSS, vanilla JS (browser ES modules), Node 24 (`node:test` for unit tests), `marked` (devDependency, deploy-time only), GitHub Actions Pages (`configure-pages`/`upload-pages-artifact`/`deploy-pages`).

**Spec:** `dev/superpowers/specs/2026-07-20-homepage-github-pages-design.md`

## Global Constraints

- All commit messages, PR title/body in **English**; Conventional Commits (`feat(site): ...`, `ci: ...`).
- GitHub Actions **pinned to commit SHA** with `# vN` comment (project CI contract).
- No new **runtime** dependencies; `marked` is a devDependency used only by the deploy-time build script.
- `site/` is plain JS — outside the TS projects; quality gates for it are `node --test site/*.test.mjs` + knip.
- Gate exit codes captured **without pipes**: `cmd > /tmp/log 2>&1; echo $?` (never `cmd | tail`).
- pre-push hook runs `cargo clippy --all-targets` + `npx knip` (5–7 min cold) → run `git push` in background.
- CSS variables follow app naming: `--color-{category}-{qualifier}`.
- Site must work with JS disabled (progressive enhancement): all content and fallback links live in static HTML (EN).
- Base path is `/baram/` → **all internal URLs relative** (no leading `/`).

**Post-review amendments to Task 4 code** (2026-07-20, review-driven; authoritative code = `site/build-docs.mjs`):
1. `slugify` strips HTML entities (`/&#?[a-z0-9]+;/gi`) so raw-md and marked-escaped-HTML slugs converge.
2. `extractToc`/`addHeadingIds` share GitHub-style duplicate-id disambiguation (`setup`, `setup-1`, …) via a first-come counter.
3. `rewriteDocLinks`: `.md` targets in `DOCS` → `.html`; all other relative `.md` targets (e.g. `plugin-development.md`, `../README.md`) → GitHub blob URL. External absolute URLs untouched.

**Approved spec deviations** (verified 2026-07-20):
1. `docs/*.md` contain **zero image references** → build script does not copy `docs/assets/` (spec said copy; nothing to copy).
2. Mobile nav: CSS flex-wrap instead of a JS hamburger (more minimal; spec allowed "최소 구현").
3. Favicon source: Tauri app icons `src-tauri/icons/{32x32,128x128}.png` (square), not the wordmark logo.

---

### Task 1: Site scaffold — assets, stylesheet, landing page

**Files:**
- Create: `site/index.html`, `site/style.css`
- Create (copies): `site/assets/baram-logo.png`, `site/assets/baram-logo-dark.png`, `site/assets/hero.png`, `site/assets/demo.gif`, `site/assets/favicon.png`, `site/assets/apple-touch-icon.png`
- Modify: `.gitignore` (append `/dist-site/`)

**Interfaces:**
- Produces: `index.html` with `data-i18n="<key>"` attributes (consumed by Task 2), element IDs `#lang-toggle`, `#download-primary`, `#download-os`, `#release-version`, `#asset-list` (consumed by Tasks 2–3), and CSS classes `.docs-layout`, `.docs-sidebar`, `.docs-content`, `.docs-toc`, `.toc-2`, `.toc-3`, `.docs-nav-link`, `.is-current` (consumed by Task 4).

- [ ] **Step 1: Create branch and scaffold directories**

```bash
cd /Users/donghoon.yoo/work/projects/baram
git checkout main && git pull
git checkout -b feature/homepage-github-pages
mkdir -p site/assets
cp src/assets/baram-logo.png src/assets/baram-logo-dark.png site/assets/
cp docs/assets/hero.png docs/assets/demo.gif site/assets/
cp src-tauri/icons/32x32.png site/assets/favicon.png
cp src-tauri/icons/128x128.png site/assets/apple-touch-icon.png
echo '/dist-site/' >> .gitignore
```

Expected: 6 files in `site/assets/`.

- [ ] **Step 2: Write `site/style.css`**

Complete file content:

```css
/* Baram homepage — tokens hand-excerpted from src/styles/generated/semantic-{light,dark}.css
   and src/styles/base.css (shadows). Deliberately NOT imported (spec: manual excerpt). */
:root {
  --color-bg-default: #fff;
  --color-bg-subtle: #f8f9fa;
  --color-bg-panel: #f1f3f5;
  --color-bg-elevated: #f0f0f3;
  --color-text-primary: #1a1a1a;
  --color-text-secondary: #6b7280;
  --color-text-muted: #9ca3af;
  --color-border-default: #e5e7eb;
  --color-border-subtle: #f3f4f6;
  --color-accent-default: #3b82f6;
  --color-accent-hover: #2563eb;
  --shadow-sm: 0 1px 2px rgb(0 0 0 / 10%);
  --shadow-md: 0 4px 12px rgb(0 0 0 / 15%);
  --shadow-lg: 0 8px 24px rgb(0 0 0 / 20%);
  --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
    "Apple SD Gothic Neo", "Noto Sans KR", sans-serif;
  --font-mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
}

@media (prefers-color-scheme: dark) {
  :root {
    --color-bg-default: #1a1a2e;
    --color-bg-subtle: #16213e;
    --color-bg-panel: #0f172a;
    --color-bg-elevated: #1e2a45;
    --color-text-primary: #e2e8f0;
    --color-text-secondary: #94a3b8;
    --color-text-muted: #64748b;
    --color-border-default: #334155;
    --color-border-subtle: #1e293b;
    --color-accent-default: #60a5fa;
    --color-accent-hover: #3b82f6;
  }
}

* { box-sizing: border-box; }

body {
  margin: 0;
  font-family: var(--font-sans);
  color: var(--color-text-primary);
  background: var(--color-bg-default);
  line-height: 1.6;
}

img { max-width: 100%; height: auto; }
a { color: var(--color-accent-default); text-decoration: none; }
a:hover { color: var(--color-accent-hover); }
code, kbd { font-family: var(--font-mono); font-size: 0.9em; }

.container { max-width: 960px; margin: 0 auto; padding: 0 1.25rem; }

/* ---- nav ---- */
.nav {
  position: sticky; top: 0; z-index: 10;
  background: var(--color-bg-default);
  border-bottom: 1px solid var(--color-border-default);
}
.nav-inner {
  display: flex; align-items: center; gap: 1.25rem;
  flex-wrap: wrap; padding-top: 0.6rem; padding-bottom: 0.6rem;
}
.nav-logo img { display: block; height: 26px; width: auto; }
.nav-links { display: flex; gap: 1rem; flex-wrap: wrap; flex: 1; }
.nav-links a, .nav-github { color: var(--color-text-secondary); font-size: 0.95rem; }
.nav-links a:hover, .nav-github:hover { color: var(--color-text-primary); }
.nav-actions { display: flex; align-items: center; gap: 0.75rem; }
.lang-toggle {
  border: 1px solid var(--color-border-default);
  background: var(--color-bg-subtle);
  color: var(--color-text-secondary);
  font: inherit; font-size: 0.8rem;
  padding: 0.15rem 0.55rem; border-radius: 6px; cursor: pointer;
}
.lang-toggle:hover { color: var(--color-text-primary); }

/* ---- hero ---- */
.hero { padding: 4rem 0 3rem; text-align: center; }
.hero h1 { font-size: 2.6rem; line-height: 1.2; margin: 0 0 1rem; }
.hero-sub {
  max-width: 620px; margin: 0 auto 2rem;
  color: var(--color-text-secondary); font-size: 1.15rem;
}
.hero-cta { display: flex; gap: 0.75rem; justify-content: center; flex-wrap: wrap; }
.btn {
  display: inline-block; padding: 0.65rem 1.4rem; border-radius: 8px;
  font-weight: 600; font-size: 1rem;
}
.btn-primary { background: var(--color-accent-default); color: #fff; box-shadow: var(--shadow-sm); }
.btn-primary:hover { background: var(--color-accent-hover); color: #fff; }
.btn-secondary {
  background: var(--color-bg-subtle); color: var(--color-text-primary);
  border: 1px solid var(--color-border-default);
}
.hero-meta { color: var(--color-text-muted); font-size: 0.85rem; margin-top: 1rem; }
.downloads-all { margin: 0.5rem auto 0; max-width: 420px; font-size: 0.9rem; }
.downloads-all summary { cursor: pointer; color: var(--color-text-secondary); }
.downloads-all ul { list-style: none; padding: 0.5rem 0 0; margin: 0; }
.downloads-all li { padding: 0.15rem 0; }
.hero-shot {
  margin-top: 2.5rem; border-radius: 12px;
  border: 1px solid var(--color-border-default);
  box-shadow: var(--shadow-lg);
}

/* ---- sections ---- */
.section { padding: 3.5rem 0; }
.section-alt { background: var(--color-bg-subtle); }
.section h2 { font-size: 1.8rem; margin: 0 0 1.5rem; }

/* ---- feature grid ---- */
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 1rem; }
.card {
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border-subtle);
  border-radius: 10px; padding: 1.1rem 1.2rem;
}
.card h3 { margin: 0 0 0.4rem; font-size: 1.05rem; }
.card p { margin: 0; color: var(--color-text-secondary); font-size: 0.92rem; }

/* ---- demo ---- */
.demo {
  display: block; margin: 1rem auto 0; border-radius: 12px;
  border: 1px solid var(--color-border-default); box-shadow: var(--shadow-md);
}

/* ---- shortcuts table ---- */
.sc-table { border-collapse: collapse; width: 100%; max-width: 640px; font-size: 0.95rem; }
.sc-table th, .sc-table td {
  text-align: left; padding: 0.45rem 0.8rem;
  border-bottom: 1px solid var(--color-border-subtle);
}
.sc-table th { color: var(--color-text-muted); font-weight: 600; font-size: 0.85rem; }
.sc-table kbd {
  background: var(--color-bg-panel);
  border: 1px solid var(--color-border-default);
  border-radius: 5px; padding: 0.1rem 0.4rem; white-space: nowrap;
}
.see-all { display: inline-block; margin-top: 1rem; }

/* ---- plugins ---- */
.plugin-links { display: flex; gap: 1.5rem; flex-wrap: wrap; margin-top: 0.75rem; }

/* ---- faq ---- */
.faq-item {
  border-bottom: 1px solid var(--color-border-subtle);
  padding: 0.6rem 0;
}
.faq-item summary { cursor: pointer; font-weight: 600; }
.faq-item p { color: var(--color-text-secondary); margin: 0.6rem 0 0.2rem; }

/* ---- footer ---- */
.footer {
  border-top: 1px solid var(--color-border-default);
  padding: 2rem 0; margin-top: 2rem;
  color: var(--color-text-muted); font-size: 0.9rem;
}
.footer .container { display: flex; justify-content: space-between; gap: 1rem; flex-wrap: wrap; }
.footer nav { display: flex; gap: 1.25rem; }

/* ---- docs pages (used by build-docs.mjs output) ---- */
.docs-layout {
  display: grid; grid-template-columns: 230px minmax(0, 1fr);
  gap: 2.5rem; align-items: start; padding: 2.5rem 0;
}
.docs-sidebar {
  position: sticky; top: 4rem;
  max-height: calc(100vh - 5rem); overflow-y: auto;
  font-size: 0.9rem;
}
.docs-sidebar summary {
  display: none; /* desktop: sidebar always open, not collapsible */
}
.docs-nav-link {
  display: block; padding: 0.25rem 0; color: var(--color-text-secondary); font-weight: 600;
}
.docs-nav-link.is-current { color: var(--color-accent-default); }
.docs-toc {
  margin-top: 1rem; padding-top: 1rem;
  border-top: 1px solid var(--color-border-subtle);
  display: flex; flex-direction: column;
}
.docs-toc a { color: var(--color-text-muted); padding: 0.15rem 0; }
.docs-toc a:hover { color: var(--color-text-primary); }
.docs-toc .toc-3 { padding-left: 1rem; font-size: 0.85rem; }
.docs-content { min-width: 0; }
.docs-content h1 { font-size: 2rem; }
.docs-content h2 {
  margin-top: 2.5rem; padding-bottom: 0.3rem;
  border-bottom: 1px solid var(--color-border-subtle);
}
.docs-content pre {
  background: var(--color-bg-panel); border-radius: 8px;
  padding: 0.9rem 1.1rem; overflow-x: auto;
}
.docs-content table { border-collapse: collapse; display: block; overflow-x: auto; }
.docs-content th, .docs-content td {
  border: 1px solid var(--color-border-default); padding: 0.4rem 0.8rem;
}
.docs-content blockquote {
  margin: 1rem 0; padding: 0.2rem 1rem;
  border-left: 3px solid var(--color-accent-default);
  background: var(--color-bg-subtle); border-radius: 0 8px 8px 0;
}

/* ---- responsive ---- */
@media (max-width: 720px) {
  .hero h1 { font-size: 2rem; }
  .docs-layout { grid-template-columns: 1fr; gap: 1rem; }
  .docs-sidebar { position: static; max-height: none; }
  .docs-sidebar summary {
    display: list-item; cursor: pointer;
    font-weight: 600; color: var(--color-text-secondary);
  }
}
```

- [ ] **Step 3: Write `site/index.html`**

Complete file content. Static text = English defaults; every translatable element carries `data-i18n`. All fallback links point at GitHub (work without JS).

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Baram — Lightweight WYSIWYG Markdown Editor</title>
  <meta name="description" content="A lightweight, beautiful WYSIWYG markdown editor with AI integration. Free and open source." />
  <link rel="canonical" href="https://sayinel.github.io/baram/" />
  <meta property="og:type" content="website" />
  <meta property="og:title" content="Baram — Lightweight WYSIWYG Markdown Editor" />
  <meta property="og:description" content="Beautiful WYSIWYG · Lossless Markdown · AI-native Editing · Bidirectional Links" />
  <meta property="og:image" content="https://sayinel.github.io/baram/assets/hero.png" />
  <meta property="og:url" content="https://sayinel.github.io/baram/" />
  <meta name="twitter:card" content="summary_large_image" />
  <link rel="icon" type="image/png" href="assets/favicon.png" />
  <link rel="apple-touch-icon" href="assets/apple-touch-icon.png" />
  <link rel="stylesheet" href="style.css" />
  <script type="module" src="main.js"></script>
</head>
<body>
<header class="nav">
  <div class="container nav-inner">
    <a class="nav-logo" href="./">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="assets/baram-logo-dark.png" />
        <img src="assets/baram-logo.png" alt="Baram" />
      </picture>
    </a>
    <nav class="nav-links">
      <a href="#features" data-i18n="nav.features">Features</a>
      <a href="#shortcuts" data-i18n="nav.shortcuts">Shortcuts</a>
      <a href="#plugins" data-i18n="nav.plugins">Plugins</a>
      <a href="#faq" data-i18n="nav.faq">FAQ</a>
      <a href="docs/user-guide.html" data-i18n="nav.docs">Docs</a>
    </nav>
    <div class="nav-actions">
      <button id="lang-toggle" class="lang-toggle" type="button" aria-label="Switch language">KO</button>
      <a class="nav-github" href="https://github.com/sayinel/baram">GitHub</a>
    </div>
  </div>
</header>
<main>
  <section class="hero">
    <div class="container">
      <h1 data-i18n="hero.title">Like the wind, light and free.</h1>
      <p class="hero-sub" data-i18n="hero.sub">A lightweight, beautiful WYSIWYG markdown editor with AI integration — syntax disappears as you type, and your files stay 100% standard markdown.</p>
      <div class="hero-cta">
        <a id="download-primary" class="btn btn-primary" href="https://github.com/sayinel/baram/releases/latest"><span data-i18n="hero.download">Download</span><span id="download-os"></span></a>
        <a class="btn btn-secondary" href="https://github.com/sayinel/baram" data-i18n="hero.github">View on GitHub</a>
      </div>
      <p class="hero-meta"><span id="release-version">Latest release</span> · macOS · Windows · Linux · Apache-2.0</p>
      <details class="downloads-all">
        <summary data-i18n="hero.allDownloads">All downloads</summary>
        <ul id="asset-list">
          <li><a href="https://github.com/sayinel/baram/releases/latest" data-i18n="hero.releasesPage">Browse all releases on GitHub →</a></li>
        </ul>
      </details>
      <img class="hero-shot" src="assets/hero.png" alt="Baram editor — a beautiful WYSIWYG markdown workspace" width="1600" />
    </div>
  </section>

  <section id="features" class="section">
    <div class="container">
      <h2 data-i18n="features.title">Features</h2>
      <div class="grid">
        <article class="card">
          <h3 data-i18n="features.wysiwyg.t">Disappearing syntax</h3>
          <p data-i18n="features.wysiwyg.d">Markdown delimiters show only when your cursor enters the range — and vanish when you leave. What remains is beautifully styled text.</p>
        </article>
        <article class="card">
          <h3 data-i18n="features.roundtrip.t">Lossless roundtrip</h3>
          <p data-i18n="features.roundtrip.d">MD → editor → MD preserves your document exactly. 100% standard markdown — no proprietary format, no lock-in.</p>
        </article>
        <article class="card">
          <h3 data-i18n="features.ai.t">AI-native editing</h3>
          <p data-i18n="features.ai.d">Inline AI edits (Cmd+J), Ghost Text autocomplete, and AI chat — powered by Claude, OpenAI, Gemini, or local Ollama.</p>
        </article>
        <article class="card">
          <h3 data-i18n="features.links.t">Wikilinks &amp; graph</h3>
          <p data-i18n="features.links.d">[[links]] with autocomplete, backlinks, block references, tags — and a visual graph of your knowledge.</p>
        </article>
        <article class="card">
          <h3 data-i18n="features.rich.t">Math, code &amp; diagrams</h3>
          <p data-i18n="features.rich.d">KaTeX math, code blocks with highlighting for 14+ languages, Mermaid diagrams, and advanced tables with cell merge.</p>
        </article>
        <article class="card">
          <h3 data-i18n="features.vault.t">Vaults &amp; workspaces</h3>
          <p data-i18n="features.vault.d">Open multiple vaults and folders side by side — each with its own tree, tabs, settings, journal, and Zettelkasten space.</p>
        </article>
        <article class="card">
          <h3 data-i18n="features.plugins.t">Plugins</h3>
          <p data-i18n="features.plugins.d">Install community plugins from a built-in, capability-gated marketplace — or build your own with the plugin API.</p>
        </article>
        <article class="card">
          <h3 data-i18n="features.light.t">Featherweight</h3>
          <p data-i18n="features.light.d">~10MB binary, instant startup, low memory. A desktop app that feels like the wind.</p>
        </article>
      </div>
    </div>
  </section>

  <section id="action" class="section section-alt">
    <div class="container">
      <h2 data-i18n="action.title">In Action</h2>
      <p data-i18n="action.desc">Syntax melts away as you type — watch Baram in action.</p>
      <img class="demo" src="assets/demo.gif" alt="Baram live editing demo — markdown syntax disappearing as you type" loading="lazy" />
    </div>
  </section>

  <section id="shortcuts" class="section">
    <div class="container">
      <h2 data-i18n="shortcuts.title">Shortcuts</h2>
      <table class="sc-table">
        <thead>
          <tr>
            <th data-i18n="shortcuts.hAction">Action</th>
            <th>macOS</th>
            <th>Windows / Linux</th>
          </tr>
        </thead>
        <tbody>
          <tr><td data-i18n="sc.quickSwitcher">Quick Switcher</td><td><kbd>Cmd+K</kbd></td><td><kbd>Ctrl+K</kbd></td></tr>
          <tr><td data-i18n="sc.commandPalette">Command Palette</td><td><kbd>Cmd+P</kbd></td><td><kbd>Ctrl+P</kbd></td></tr>
          <tr><td data-i18n="sc.inlineAi">Inline AI Edit</td><td><kbd>Cmd+J</kbd></td><td><kbd>Ctrl+J</kbd></td></tr>
          <tr><td data-i18n="sc.sourceMode">Source Mode</td><td><kbd>Cmd+/</kbd></td><td><kbd>Ctrl+/</kbd></td></tr>
          <tr><td data-i18n="sc.save">Save</td><td><kbd>Cmd+S</kbd></td><td><kbd>Ctrl+S</kbd></td></tr>
          <tr><td data-i18n="sc.find">Find</td><td><kbd>Cmd+F</kbd></td><td><kbd>Ctrl+F</kbd></td></tr>
          <tr><td data-i18n="sc.bold">Bold</td><td><kbd>Cmd+B</kbd></td><td><kbd>Ctrl+B</kbd></td></tr>
          <tr><td data-i18n="sc.toggleFold">Toggle Fold</td><td><kbd>Cmd+Shift+[</kbd></td><td><kbd>Ctrl+Shift+[</kbd></td></tr>
          <tr><td data-i18n="sc.export">Export</td><td><kbd>Cmd+Shift+E</kbd></td><td><kbd>Ctrl+Shift+E</kbd></td></tr>
          <tr><td data-i18n="sc.settings">Settings</td><td><kbd>Cmd+,</kbd></td><td><kbd>Ctrl+,</kbd></td></tr>
        </tbody>
      </table>
      <a class="see-all" href="docs/keyboard-shortcuts.html" data-i18n="shortcuts.seeAll">Full shortcut reference →</a>
    </div>
  </section>

  <section id="plugins" class="section section-alt">
    <div class="container">
      <h2 data-i18n="plugins.title">Plugins &amp; Ecosystem</h2>
      <p data-i18n="plugins.desc">Browse community plugins in the built-in, capability-gated marketplace — themes, tools, and editor extensions installed in one click. Want to build your own? Start with the development guide.</p>
      <div class="plugin-links">
        <a href="https://github.com/sayinel/baram-plugins" data-i18n="plugins.registry">Plugin registry →</a>
        <a href="https://github.com/sayinel/baram/blob/main/docs/plugin-development.md" data-i18n="plugins.devGuide">Plugin development guide →</a>
      </div>
    </div>
  </section>

  <section id="faq" class="section">
    <div class="container">
      <h2 data-i18n="faq.title">FAQ</h2>
      <details class="faq-item">
        <summary data-i18n="faq.q1">What is Baram?</summary>
        <p data-i18n="faq.a1">Baram(바람) is a lightweight desktop WYSIWYG markdown editor built with Tauri 2.0, React, and Tiptap/ProseMirror. It combines Typora-style "disappearing syntax" WYSIWYG editing with bidirectional links and AI-powered writing assistance.</p>
      </details>
      <details class="faq-item">
        <summary data-i18n="faq.q2">What platforms does Baram support?</summary>
        <p data-i18n="faq.a2">Baram runs on macOS (Apple Silicon and Intel), Windows (x64 and ARM), and Linux (x64).</p>
      </details>
      <details class="faq-item">
        <summary data-i18n="faq.q3">Is Baram free?</summary>
        <p data-i18n="faq.a3">Yes. Baram is free and open source software, licensed under the Apache License 2.0.</p>
      </details>
      <details class="faq-item">
        <summary data-i18n="faq.q4">Does Baram preserve my markdown exactly?</summary>
        <p data-i18n="faq.a4">Yes. Baram's core principle is lossless roundtrip fidelity. When you open a markdown file, edit it, and save it, the formatting and structure of the original file are preserved exactly. No proprietary format, no hidden changes.</p>
      </details>
      <details class="faq-item">
        <summary data-i18n="faq.q5">Can I customize keyboard shortcuts?</summary>
        <p data-i18n="faq.a5">Yes. Open Settings &gt; Keybindings to see all shortcuts organized by category. Click Edit on any shortcut, press the new key combination, and click Apply.</p>
      </details>
      <details class="faq-item">
        <summary data-i18n="faq.q6">What languages does Baram support?</summary>
        <p data-i18n="faq.a6">Baram currently supports English and Korean for the entire user interface — menus, dialogs, settings, and all UI elements.</p>
      </details>
      <a class="see-all" href="docs/faq.html" data-i18n="faq.seeAll">All questions →</a>
    </div>
  </section>
</main>
<footer class="footer">
  <div class="container">
    <span data-i18n="footer.tagline">Free &amp; open source, Apache-2.0 licensed.</span>
    <nav>
      <a href="https://github.com/sayinel/baram">GitHub</a>
      <a href="https://github.com/sayinel/baram/releases" data-i18n="footer.releases">Releases</a>
      <a href="docs/user-guide.html" data-i18n="footer.docs">Docs</a>
    </nav>
  </div>
</footer>
</body>
</html>
```

- [ ] **Step 4: Render check**

```bash
python3 -m http.server 8080 -d site &
sleep 1
curl -s http://localhost:8080/ > /tmp/landing.html; echo $?
grep -c 'data-i18n' /tmp/landing.html
grep -c 'class="card"' /tmp/landing.html
kill %1
```

Expected: exit `0`; `data-i18n` count ≥ 55; card count = 8. Note: `main.js` doesn't exist yet — a 404 for it in server logs is expected and fine (static HTML must stand alone). The `docs/…` links 404 until Task 4.

- [ ] **Step 5: Commit**

```bash
git add site/ .gitignore
git commit -m "feat(site): add static homepage landing page for GitHub Pages"
```

---

### Task 2: i18n dictionaries + language toggle

**Files:**
- Create: `site/i18n.js`, `site/main.js`
- Test: `site/site.test.mjs`

**Interfaces:**
- Consumes: `data-i18n` attributes, `#lang-toggle` from Task 1.
- Produces: `MESSAGES` (`{ en: Record<string,string>, ko: Record<string,string> }`) from `i18n.js`; `pickLanguage(stored, navLang): "en"|"ko"` exported from `main.js`. Task 3 will extend `main.js` — keep the `init()` + `if (typeof document !== "undefined") init();` structure at the bottom.

- [ ] **Step 1: Write the failing test**

Create `site/site.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MESSAGES } from "./i18n.js";
import { pickLanguage } from "./main.js";

const SITE = dirname(fileURLToPath(import.meta.url));

test("en and ko dictionaries have identical key sets", () => {
  assert.deepEqual(Object.keys(MESSAGES.ko).sort(), Object.keys(MESSAGES.en).sort());
});

test("every data-i18n key in index.html exists in both dictionaries", () => {
  const html = readFileSync(join(SITE, "index.html"), "utf8");
  const keys = [...html.matchAll(/data-i18n="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(keys.length >= 55, `expected >=55 keys, got ${keys.length}`);
  for (const key of keys) {
    assert.ok(MESSAGES.en[key], `missing en: ${key}`);
    assert.ok(MESSAGES.ko[key], `missing ko: ${key}`);
  }
});

test("pickLanguage prefers stored value, then navigator language", () => {
  assert.equal(pickLanguage("ko", "en-US"), "ko");
  assert.equal(pickLanguage("en", "ko-KR"), "en");
  assert.equal(pickLanguage(null, "ko-KR"), "ko");
  assert.equal(pickLanguage(null, "ko"), "ko");
  assert.equal(pickLanguage(null, "en-US"), "en");
  assert.equal(pickLanguage(null, undefined), "en");
  assert.equal(pickLanguage("garbage", "fr-FR"), "en");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test site/*.test.mjs > /tmp/site-test.log 2>&1; echo $?; tail -5 /tmp/site-test.log`
Expected: exit `1`, `Cannot find module .../i18n.js`.

- [ ] **Step 3: Write `site/i18n.js`**

Complete file content (keys must cover every `data-i18n` in Task 1's HTML; EN values mirror the static HTML text):

```js
// EN/KO string dictionaries for the landing page. Docs pages are EN-only (spec).
export const MESSAGES = {
  en: {
    "nav.features": "Features",
    "nav.shortcuts": "Shortcuts",
    "nav.plugins": "Plugins",
    "nav.faq": "FAQ",
    "nav.docs": "Docs",
    "hero.title": "Like the wind, light and free.",
    "hero.sub": "A lightweight, beautiful WYSIWYG markdown editor with AI integration — syntax disappears as you type, and your files stay 100% standard markdown.",
    "hero.download": "Download",
    "hero.github": "View on GitHub",
    "hero.allDownloads": "All downloads",
    "hero.releasesPage": "Browse all releases on GitHub →",
    "features.title": "Features",
    "features.wysiwyg.t": "Disappearing syntax",
    "features.wysiwyg.d": "Markdown delimiters show only when your cursor enters the range — and vanish when you leave. What remains is beautifully styled text.",
    "features.roundtrip.t": "Lossless roundtrip",
    "features.roundtrip.d": "MD → editor → MD preserves your document exactly. 100% standard markdown — no proprietary format, no lock-in.",
    "features.ai.t": "AI-native editing",
    "features.ai.d": "Inline AI edits (Cmd+J), Ghost Text autocomplete, and AI chat — powered by Claude, OpenAI, Gemini, or local Ollama.",
    "features.links.t": "Wikilinks & graph",
    "features.links.d": "[[links]] with autocomplete, backlinks, block references, tags — and a visual graph of your knowledge.",
    "features.rich.t": "Math, code & diagrams",
    "features.rich.d": "KaTeX math, code blocks with highlighting for 14+ languages, Mermaid diagrams, and advanced tables with cell merge.",
    "features.vault.t": "Vaults & workspaces",
    "features.vault.d": "Open multiple vaults and folders side by side — each with its own tree, tabs, settings, journal, and Zettelkasten space.",
    "features.plugins.t": "Plugins",
    "features.plugins.d": "Install community plugins from a built-in, capability-gated marketplace — or build your own with the plugin API.",
    "features.light.t": "Featherweight",
    "features.light.d": "~10MB binary, instant startup, low memory. A desktop app that feels like the wind.",
    "action.title": "In Action",
    "action.desc": "Syntax melts away as you type — watch Baram in action.",
    "shortcuts.title": "Shortcuts",
    "shortcuts.hAction": "Action",
    "sc.quickSwitcher": "Quick Switcher",
    "sc.commandPalette": "Command Palette",
    "sc.inlineAi": "Inline AI Edit",
    "sc.sourceMode": "Source Mode",
    "sc.save": "Save",
    "sc.find": "Find",
    "sc.bold": "Bold",
    "sc.toggleFold": "Toggle Fold",
    "sc.export": "Export",
    "sc.settings": "Settings",
    "shortcuts.seeAll": "Full shortcut reference →",
    "plugins.title": "Plugins & Ecosystem",
    "plugins.desc": "Browse community plugins in the built-in, capability-gated marketplace — themes, tools, and editor extensions installed in one click. Want to build your own? Start with the development guide.",
    "plugins.registry": "Plugin registry →",
    "plugins.devGuide": "Plugin development guide →",
    "faq.title": "FAQ",
    "faq.q1": "What is Baram?",
    "faq.a1": "Baram(바람) is a lightweight desktop WYSIWYG markdown editor built with Tauri 2.0, React, and Tiptap/ProseMirror. It combines Typora-style \"disappearing syntax\" WYSIWYG editing with bidirectional links and AI-powered writing assistance.",
    "faq.q2": "What platforms does Baram support?",
    "faq.a2": "Baram runs on macOS (Apple Silicon and Intel), Windows (x64 and ARM), and Linux (x64).",
    "faq.q3": "Is Baram free?",
    "faq.a3": "Yes. Baram is free and open source software, licensed under the Apache License 2.0.",
    "faq.q4": "Does Baram preserve my markdown exactly?",
    "faq.a4": "Yes. Baram's core principle is lossless roundtrip fidelity. When you open a markdown file, edit it, and save it, the formatting and structure of the original file are preserved exactly. No proprietary format, no hidden changes.",
    "faq.q5": "Can I customize keyboard shortcuts?",
    "faq.a5": "Yes. Open Settings > Keybindings to see all shortcuts organized by category. Click Edit on any shortcut, press the new key combination, and click Apply.",
    "faq.q6": "What languages does Baram support?",
    "faq.a6": "Baram currently supports English and Korean for the entire user interface — menus, dialogs, settings, and all UI elements.",
    "faq.seeAll": "All questions →",
    "footer.tagline": "Free & open source, Apache-2.0 licensed.",
    "footer.releases": "Releases",
    "footer.docs": "Docs",
  },
  ko: {
    "nav.features": "기능",
    "nav.shortcuts": "단축키",
    "nav.plugins": "플러그인",
    "nav.faq": "FAQ",
    "nav.docs": "문서",
    "hero.title": "바람처럼, 가볍고 자유롭게.",
    "hero.sub": "AI를 품은 가볍고 아름다운 WYSIWYG 마크다운 에디터 — 타이핑하면 문법 기호는 사라지고, 파일은 100% 표준 마크다운으로 유지됩니다.",
    "hero.download": "다운로드",
    "hero.github": "GitHub에서 보기",
    "hero.allDownloads": "모든 다운로드",
    "hero.releasesPage": "GitHub에서 전체 릴리스 보기 →",
    "features.title": "기능",
    "features.wysiwyg.t": "사라지는 문법",
    "features.wysiwyg.d": "커서가 들어갈 때만 마크다운 기호가 나타나고, 벗어나면 사라집니다. 남는 것은 아름답게 스타일된 텍스트뿐입니다.",
    "features.roundtrip.t": "무손실 라운드트립",
    "features.roundtrip.d": "MD → 에디터 → MD 변환이 문서를 정확히 보존합니다. 100% 표준 마크다운 — 독점 포맷도, 종속도 없습니다.",
    "features.ai.t": "AI 네이티브 편집",
    "features.ai.d": "인라인 AI 편집(Cmd+J), Ghost Text 자동완성, AI 챗 — Claude, OpenAI, Gemini, 로컬 Ollama를 지원합니다.",
    "features.links.t": "위키링크 & 그래프",
    "features.links.d": "자동완성되는 [[링크]], 백링크, 블록 참조, 태그 — 그리고 지식의 연결을 보여주는 그래프 뷰.",
    "features.rich.t": "수식, 코드 & 다이어그램",
    "features.rich.d": "KaTeX 수식, 14개 이상 언어를 하이라이팅하는 코드 블록, Mermaid 다이어그램, 셀 병합을 지원하는 고급 테이블.",
    "features.vault.t": "Vault & 워크스페이스",
    "features.vault.d": "여러 vault와 폴더를 나란히 열 수 있습니다 — 각각 고유한 트리, 탭, 설정, 저널, 제텔카스텐 공간을 갖습니다.",
    "features.plugins.t": "플러그인",
    "features.plugins.d": "권한 제어(capability-gated)형 내장 마켓플레이스에서 커뮤니티 플러그인을 설치하거나, 플러그인 API로 직접 만들어 보세요.",
    "features.light.t": "깃털처럼 가볍게",
    "features.light.d": "~10MB 바이너리, 즉시 시작, 낮은 메모리. 바람처럼 가벼운 데스크톱 앱.",
    "action.title": "직접 보기",
    "action.desc": "타이핑하는 순간 문법이 녹아 사라집니다 — Baram의 실제 동작을 확인하세요.",
    "shortcuts.title": "단축키",
    "shortcuts.hAction": "동작",
    "sc.quickSwitcher": "퀵 스위처",
    "sc.commandPalette": "커맨드 팔레트",
    "sc.inlineAi": "인라인 AI 편집",
    "sc.sourceMode": "소스 모드",
    "sc.save": "저장",
    "sc.find": "찾기",
    "sc.bold": "굵게",
    "sc.toggleFold": "접기 토글",
    "sc.export": "내보내기",
    "sc.settings": "설정",
    "shortcuts.seeAll": "전체 단축키 레퍼런스 →",
    "plugins.title": "플러그인 & 생태계",
    "plugins.desc": "권한 제어형 내장 마켓플레이스에서 커뮤니티 플러그인을 찾아보세요 — 테마, 도구, 에디터 확장을 클릭 한 번으로 설치합니다. 직접 만들고 싶다면 개발 가이드로 시작하세요.",
    "plugins.registry": "플러그인 레지스트리 →",
    "plugins.devGuide": "플러그인 개발 가이드 →",
    "faq.title": "자주 묻는 질문",
    "faq.q1": "Baram은 무엇인가요?",
    "faq.a1": "Baram(바람)은 Tauri 2.0, React, Tiptap/ProseMirror로 만든 경량 데스크톱 WYSIWYG 마크다운 에디터입니다. Typora 스타일의 '사라지는 문법' WYSIWYG 편집에 양방향 링크와 AI 글쓰기 지원을 결합했습니다.",
    "faq.q2": "어떤 플랫폼을 지원하나요?",
    "faq.a2": "macOS(Apple Silicon·Intel), Windows(x64·ARM), Linux(x64)에서 동작합니다.",
    "faq.q3": "무료인가요?",
    "faq.a3": "네. Baram은 Apache License 2.0으로 배포되는 무료 오픈소스 소프트웨어입니다.",
    "faq.q4": "마크다운이 정확히 보존되나요?",
    "faq.a4": "네. Baram의 핵심 원칙은 무손실 라운드트립입니다. 파일을 열고 편집하고 저장해도 원본의 형식과 구조가 정확히 유지됩니다. 독점 포맷도, 숨은 변경도 없습니다.",
    "faq.q5": "단축키를 바꿀 수 있나요?",
    "faq.a5": "네. 설정 > 키바인딩에서 카테고리별로 정리된 모든 단축키를 확인할 수 있습니다. 원하는 단축키에서 Edit을 누르고 새 키 조합을 입력한 뒤 Apply를 누르면 됩니다.",
    "faq.q6": "어떤 언어를 지원하나요?",
    "faq.a6": "현재 영어와 한국어 UI를 지원합니다 — 메뉴, 대화상자, 설정을 포함한 모든 UI 요소 전부.",
    "faq.seeAll": "모든 질문 보기 →",
    "footer.tagline": "무료 오픈소스, Apache-2.0 라이선스.",
    "footer.releases": "릴리스",
    "footer.docs": "문서",
  },
};
```

- [ ] **Step 4: Write `site/main.js`**

Complete file content (Task 3 will extend it — keep structure):

```js
import { MESSAGES } from "./i18n.js";

// --- pure helpers (unit-tested via node:test) ---

export function pickLanguage(stored, navLang) {
  if (stored === "en" || stored === "ko") return stored;
  return (navLang || "").toLowerCase().startsWith("ko") ? "ko" : "en";
}

// --- DOM wiring (browser only) ---

function applyLanguage(lang) {
  const dict = MESSAGES[lang];
  document.documentElement.lang = lang;
  for (const el of document.querySelectorAll("[data-i18n]")) {
    const msg = dict[el.dataset.i18n];
    if (msg) el.textContent = msg;
  }
  const toggle = document.getElementById("lang-toggle");
  if (toggle) toggle.textContent = lang === "en" ? "KO" : "EN";
}

function init() {
  const lang = pickLanguage(localStorage.getItem("baram-lang"), navigator.language);
  applyLanguage(lang);
  document.getElementById("lang-toggle")?.addEventListener("click", () => {
    const next = document.documentElement.lang === "en" ? "ko" : "en";
    localStorage.setItem("baram-lang", next);
    applyLanguage(next);
  });
}

if (typeof document !== "undefined") init();
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test site/*.test.mjs > /tmp/site-test.log 2>&1; echo $?; tail -5 /tmp/site-test.log`
Expected: exit `0`, `# pass 3`.

- [ ] **Step 6: Browser sanity check**

```bash
python3 -m http.server 8080 -d site &
sleep 1
curl -s http://localhost:8080/main.js | head -3
kill %1
```

Expected: JS source served. (Full toggle behavior is visually verified in Task 6.)

- [ ] **Step 7: Commit**

```bash
git add site/i18n.js site/main.js site/site.test.mjs
git commit -m "feat(site): add EN/KO i18n dictionaries and language toggle"
```

---

### Task 3: Dynamic download button (latest release fetch + OS detection)

**Files:**
- Modify: `site/main.js`
- Test: `site/site.test.mjs` (append tests)

**Interfaces:**
- Consumes: `#download-primary`, `#download-os`, `#release-version`, `#asset-list` from Task 1; `init()` structure from Task 2.
- Produces: `detectOS(platformString): "mac"|"win"|"linux"|"unknown"` and `pickPrimaryAsset(assets, os): {name, browser_download_url} | null` exported from `main.js`.

- [ ] **Step 1: Append failing tests to `site/site.test.mjs`**

```js
import { detectOS, pickPrimaryAsset } from "./main.js";

test("detectOS maps platform strings", () => {
  assert.equal(detectOS("MacIntel"), "mac");
  assert.equal(detectOS("macOS"), "mac");
  assert.equal(detectOS("Win32"), "win");
  assert.equal(detectOS("Windows"), "win");
  assert.equal(detectOS("Linux x86_64"), "linux");
  assert.equal(detectOS(""), "unknown");
  assert.equal(detectOS(undefined), "unknown");
});

test("pickPrimaryAsset prefers universal dmg, falls back to aarch64 (v0.3.0 layout)", () => {
  const v040 = [
    { name: "Baram_0.4.0_universal.dmg", browser_download_url: "u" },
    { name: "Baram_0.4.0_x64-setup.exe", browser_download_url: "w" },
    { name: "Baram_0.4.0_amd64.AppImage", browser_download_url: "l" },
  ];
  assert.equal(pickPrimaryAsset(v040, "mac").browser_download_url, "u");
  assert.equal(pickPrimaryAsset(v040, "win").browser_download_url, "w");
  assert.equal(pickPrimaryAsset(v040, "linux").browser_download_url, "l");

  const v030 = [
    { name: "Baram_0.3.0_aarch64.dmg", browser_download_url: "a" },
    { name: "Baram_0.3.0_x64_en-US.msi", browser_download_url: "m" },
    { name: "Baram_0.3.0_amd64.deb", browser_download_url: "d" },
  ];
  assert.equal(pickPrimaryAsset(v030, "mac").browser_download_url, "a");
  assert.equal(pickPrimaryAsset(v030, "win").browser_download_url, "m");
  assert.equal(pickPrimaryAsset(v030, "linux").browser_download_url, "d");
  assert.equal(pickPrimaryAsset(v030, "unknown"), null);
  assert.equal(pickPrimaryAsset([], "mac"), null);
});

test("pickPrimaryAsset picks the primary pattern when both candidates are present", () => {
  // fallback assets listed FIRST so a reversed pattern order would fail this test
  const both = [
    { name: "Baram_0.4.0_aarch64.dmg", browser_download_url: "a" },
    { name: "Baram_0.4.0_universal.dmg", browser_download_url: "u" },
    { name: "Baram_0.4.0_x64_en-US.msi", browser_download_url: "m" },
    { name: "Baram_0.4.0_x64-setup.exe", browser_download_url: "w" },
    { name: "Baram_0.4.0_amd64.deb", browser_download_url: "d" },
    { name: "Baram_0.4.0_amd64.AppImage", browser_download_url: "l" },
  ];
  assert.equal(pickPrimaryAsset(both, "mac").browser_download_url, "u");
  assert.equal(pickPrimaryAsset(both, "win").browser_download_url, "w");
  assert.equal(pickPrimaryAsset(both, "linux").browser_download_url, "l");
});
```

Note: `import` statements are hoisted — placing this import at the end of the file is valid ESM, but keep imports tidy by merging into the existing `import { pickLanguage } from "./main.js";` line instead: `import { pickLanguage, detectOS, pickPrimaryAsset } from "./main.js";`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test site/*.test.mjs > /tmp/site-test.log 2>&1; echo $?; tail -5 /tmp/site-test.log`
Expected: exit `1`, `does not provide an export named 'detectOS'`.

- [ ] **Step 3: Implement in `site/main.js`**

Add below `pickLanguage` (pure helpers section):

```js
export function detectOS(platformString) {
  const p = (platformString || "").toLowerCase();
  if (p.includes("mac")) return "mac";
  if (p.includes("win")) return "win";
  if (p.includes("linux") || p.includes("x11")) return "linux";
  return "unknown";
}

const PRIMARY_ASSET_PATTERNS = {
  mac: [/_universal\.dmg$/, /_aarch64\.dmg$/],
  win: [/_x64-setup\.exe$/, /\.msi$/],
  linux: [/_amd64\.AppImage$/, /_amd64\.deb$/],
};

export function pickPrimaryAsset(assets, os) {
  for (const pattern of PRIMARY_ASSET_PATTERNS[os] || []) {
    const hit = (assets || []).find((a) => pattern.test(a.name));
    if (hit) return hit;
  }
  return null;
}
```

Add to the DOM section:

```js
const OS_LABELS = { mac: "macOS", win: "Windows", linux: "Linux" };

async function initDownload() {
  const os = detectOS(navigator.userAgentData?.platform || navigator.platform);
  const osLabel = document.getElementById("download-os");
  if (osLabel && OS_LABELS[os]) osLabel.textContent = ` · ${OS_LABELS[os]}`;
  try {
    const res = await fetch("https://api.github.com/repos/sayinel/baram/releases/latest");
    if (!res.ok) return; // static fallback links keep working
    const release = await res.json();
    const versionEl = document.getElementById("release-version");
    if (versionEl && release.tag_name) versionEl.textContent = release.tag_name;
    const primary = pickPrimaryAsset(release.assets, os);
    const btn = document.getElementById("download-primary");
    if (btn && primary) btn.href = primary.browser_download_url;
    const list = document.getElementById("asset-list");
    if (list && release.assets?.length) {
      list.textContent = "";
      for (const asset of release.assets) {
        const li = document.createElement("li");
        const link = document.createElement("a");
        link.href = asset.browser_download_url;
        link.textContent = asset.name;
        li.appendChild(link);
        list.appendChild(li);
      }
    }
  } catch {
    // network/rate-limit failure: leave static fallback links untouched
  }
}
```

And call `initDownload();` as the last line of `init()`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test site/*.test.mjs > /tmp/site-test.log 2>&1; echo $?; tail -5 /tmp/site-test.log`
Expected: exit `0`, `# pass 5`.

- [ ] **Step 5: Commit**

```bash
git add site/main.js site/site.test.mjs
git commit -m "feat(site): resolve latest release assets into download buttons"
```

---

### Task 4: Docs pre-rendering build script (`build-docs.mjs`)

**Files:**
- Create: `site/build-docs.mjs`
- Test: `site/build-docs.test.mjs`
- Modify: `package.json` (devDependency `marked`, scripts `site:build`/`site:test`), `knip.json`

**Interfaces:**
- Consumes: `site/index.html`, `site/style.css` (docs CSS classes), `site/main.js`, `site/i18n.js`, `site/assets/` from Tasks 1–2; `docs/user-guide.md`, `docs/keyboard-shortcuts.md`, `docs/faq.md` (read-only).
- Produces: `dist-site/` tree (`index.html`, `style.css`, `main.js`, `i18n.js`, `assets/`, `docs/{user-guide,keyboard-shortcuts,faq}.html`); exports `slugify(text)`, `extractToc(md)`, `addHeadingIds(html)`, `rewriteDocLinks(html)`, `renderDocPage({title, bodyHtml, tocHtml, current})`, `buildSite()`, `DOCS`.

- [ ] **Step 1: Install marked and add npm scripts**

```bash
npm install -D marked
```

In `package.json` `"scripts"`, add:

```json
"site:build": "node site/build-docs.mjs",
"site:test": "node --test site/*.test.mjs"
```

- [ ] **Step 2: Update `knip.json`** so knip scans site JS (and sees `marked` used):

```json
"entry": [
  "src/extensions/index.ts",
  "src/extensions/marks/index.ts",
  "src/extensions/nodes/index.ts",
  "src/pipeline/index.ts",
  "src/plugins/*.ts",
  "src/extensions/plugins/*.ts",
  "src/keybindings/*.ts",
  "src/stores/**/*.ts",
  "src/**/__tests__/**/*.{ts,tsx}",
  "src/**/*.test.{ts,tsx}",
  "site/main.js",
  "site/build-docs.mjs",
  "site/*.test.mjs"
],
"project": ["src/**/*.{ts,tsx}", "site/**/*.{js,mjs}"],
```

(Keep every other key unchanged.)

- [ ] **Step 3: Write the failing tests**

Create `site/build-docs.test.mjs`:

```js
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

test("rewriteDocLinks converts local .md hrefs to .html, leaves externals", () => {
  assert.equal(rewriteDocLinks('<a href="faq.md">'), '<a href="faq.html">');
  assert.equal(rewriteDocLinks('<a href="user-guide.md#editing">'), '<a href="user-guide.html#editing">');
  assert.equal(
    rewriteDocLinks('<a href="https://example.com/x.md">'),
    '<a href="https://example.com/x.md">',
  );
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `node --test site/*.test.mjs > /tmp/site-test.log 2>&1; echo $?; tail -5 /tmp/site-test.log`
Expected: exit `1`, `Cannot find module .../build-docs.mjs`.

- [ ] **Step 5: Write `site/build-docs.mjs`**

Complete file content:

```js
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
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `node --test site/*.test.mjs > /tmp/site-test.log 2>&1; echo $?; tail -5 /tmp/site-test.log`
Expected: exit `0`, `# pass 9`.

- [ ] **Step 7: Run the build and verify output**

```bash
npm run site:build
ls dist-site dist-site/docs
grep -c 'class="toc-2"' dist-site/docs/user-guide.html
grep -c 'href="faq.html"' dist-site/docs/user-guide.html
grep -c '\.md"' dist-site/docs/faq.html
python3 -m http.server 8080 -d dist-site &
sleep 1
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8080/docs/keyboard-shortcuts.html
kill %1
```

Expected: `dist-site/docs/` has 3 HTML files; toc-2 count ≥ 5; `faq.html` link present (rewritten); zero remaining local `.md"` hrefs in faq.html; HTTP 200.

- [ ] **Step 8: Run knip to confirm no new findings**

Run: `npx knip > /tmp/knip.log 2>&1; echo $?; tail -20 /tmp/knip.log`
Expected: exit `0` (marked recognized as used; no unused-export noise from site files).

- [ ] **Step 9: Commit**

```bash
git add site/build-docs.mjs site/build-docs.test.mjs package.json package-lock.json knip.json
git commit -m "feat(site): pre-render docs pages with marked at deploy time"
```

---

### Task 5: Pages deploy workflow + README link

**Files:**
- Create: `.github/workflows/pages.yml`
- Modify: `README.md` (add homepage link in the top nav line)

**Interfaces:**
- Consumes: `npm run site:build` → `dist-site/` from Task 4; composite action `./.github/actions/setup-node` (existing; installs Node from `.node-version` + `npm ci`).

- [ ] **Step 1: Write `.github/workflows/pages.yml`**

Complete file content (SHA pins fetched 2026-07-20):

```yaml
name: Deploy Pages

on:
  push:
    branches: [main]
    paths:
      - "site/**"
      - "docs/**"
      - ".github/workflows/pages.yml"
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0
      - uses: ./.github/actions/setup-node
      - name: Build site
        run: npm run site:build
      - name: Test site
        run: npm run site:test
      - uses: actions/configure-pages@45bfe0192ca1faeb007ade9deae92b16b8254a0d # v6.0.0
      - uses: actions/upload-pages-artifact@fc324d3547104276b827a68afc52ff2a11cc49c9 # v5.0.0
        with:
          path: dist-site

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@cd2ce8fcbc39b97be8ca5fce6e763baed58fa128 # v5.0.0
```

- [ ] **Step 2: Validate YAML parses**

Run: `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/pages.yml')); print('ok')"`
Expected: `ok`. (If PyYAML is missing, use `node -e "require('js-yaml')..."` or visual review — the file is short.)

- [ ] **Step 3: Add homepage link to README**

In `README.md`, in the `<p align="center">` nav links block (the one starting with `<a href="#installation">Installation</a>`), prepend:

```html
  <a href="https://sayinel.github.io/baram/">Homepage</a> &nbsp;|&nbsp;
```

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/pages.yml README.md
git commit -m "ci: add GitHub Pages deploy workflow for homepage"
```

---

### Task 6: Full verification, push, PR

**Files:** none (verification only)

- [ ] **Step 1: Run all gates without pipes**

```bash
node --test site/*.test.mjs > /tmp/g1.log 2>&1; echo "site-tests: $?"
npm run site:build > /tmp/g2.log 2>&1; echo "site-build: $?"
npx knip > /tmp/g3.log 2>&1; echo "knip: $?"
npm run audit:css-vars > /tmp/g4.log 2>&1; echo "css-vars: $?"
npm run typecheck > /tmp/g5.log 2>&1; echo "typecheck: $?"
```

Expected: all `0`. If `audit:css-vars` scans `site/style.css` and reports undefined vars, every var used there is defined in the same file — investigate before touching the audit script config.

- [ ] **Step 2: Visual verification (4 combinations)**

```bash
npm run site:build
python3 -m http.server 8080 -d dist-site &
```

Open `http://localhost:8080/` in a browser (or drive Playwright): check light/dark (OS toggle) × EN/KO (button toggle); download button shows `v0.3.0` + `· macOS` after fetch; `Docs` nav opens user-guide with sidebar TOC; mobile width 375px (sidebar collapses to `<details>`, nav wraps). Then `kill %1`.

- [ ] **Step 3: Push (background — pre-push hook runs clippy cold, 5–7 min)**

```bash
git push -u origin feature/homepage-github-pages   # run_in_background
```

- [ ] **Step 4: Open PR (English; project PR style: motivation, design, architecture diagram, implementation, tests, checklist)**

```bash
gh pr create --title "feat: add project homepage on GitHub Pages" --body-file /tmp/pr-body.md
```

PR body must cover: motivation (public repo, no product page), design decisions (pure static, token excerpt, deploy-time docs rendering, single-source docs/), architecture (mermaid: site/ + docs/ → build-docs.mjs → dist-site → Pages artifact), implementation details per task, test results (node --test 9 pass, knip/typecheck/audit clean), checklist. Validate any mermaid with `mermaid.parse()` per [[github-pr-mermaid-gotchas]] before submitting.

---

### Task 7: Post-merge deployment (needs user action)

- [ ] **Step 1 (USER): Merge PR**, then **Settings → Pages → Build and deployment → Source = "GitHub Actions"** (one-time).
- [ ] **Step 2: Trigger & watch**

```bash
gh workflow run pages.yml
gh run watch --exit-status $(gh run list --workflow=pages.yml --limit 1 --json databaseId --jq '.[0].databaseId')
```

Expected: build + deploy green.

- [ ] **Step 3: Verify live site**

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://sayinel.github.io/baram/
curl -s -o /dev/null -w "%{http_code}\n" https://sayinel.github.io/baram/docs/user-guide.html
curl -s https://sayinel.github.io/baram/ | grep -o 'og:image[^>]*'
```

Expected: `200`, `200`, og:image absolute URL. Manually confirm the download button resolves a real asset URL on the live page.
