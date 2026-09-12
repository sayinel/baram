# Third-Party Notices

Baram bundles third-party open-source software. This file summarizes the
**principal runtime dependencies** and their licenses. All are distributed under
permissive open-source licenses (MIT, Apache-2.0, BSD, ISC, MPL-2.0, CC0-1.0,
or OFL-1.1).

This is a curated summary of the primary dependencies, **not** an exhaustive
transitive list. To generate a complete, authoritative report:

```bash
# JavaScript / npm
npx license-checker-rseidelsohn --production --summary

# Rust / Cargo
cargo install cargo-about && cargo about generate about.hbs   # or: cargo license
```

---

## Frontend (JavaScript / TypeScript)

### Editor engine

- **Tiptap** (`@tiptap/*`) — MIT
- **ProseMirror** (`@tiptap/pm`) — MIT

### Rendering & UI

- **React**, **React DOM** — MIT
- **CodeMirror 6** (`@codemirror/*`, `@codemirror/legacy-modes`, `codemirror-lang-latex`) — MIT
- **KaTeX** — MIT
- **Mermaid** — MIT
- **Cytoscape.js**, **cytoscape-fcose** — MIT
- **Lucide** (`lucide-react`) — ISC
- **Tailwind CSS** (`tailwindcss`, `@tailwindcss/vite`) — MIT
- **Floating UI** (`@floating-ui/dom`) — MIT
- **DOMPurify** — Apache-2.0 OR MPL-2.0

### Markdown pipeline (unified / remark / mdast)

- **unified**, **remark-parse**, **remark-stringify**, **remark-gfm**, **remark-math**, **remark-frontmatter** — MIT
- **mdast-util-\*** (`from-markdown`, `to-markdown`, `gfm`, `to-string`), **unist-util-visit** — MIT

### State & utilities

- **Zustand** — MIT
- **fast-diff** — Apache-2.0

### Desktop bridge

- **Tauri API & plugins** (`@tauri-apps/api`, `plugin-dialog`, `plugin-opener`, `plugin-clipboard-manager`) — MIT OR Apache-2.0

---

## Backend (Rust / Cargo)

- **Tauri** and plugins (`tauri`, `tauri-plugin-dialog`, `tauri-plugin-opener`, `tauri-plugin-clipboard-manager`) — MIT OR Apache-2.0
- **serde**, **serde_json** — MIT OR Apache-2.0
- **tokio** — MIT
- **futures** — MIT OR Apache-2.0
- **reqwest** — MIT OR Apache-2.0
- **thiserror** — MIT OR Apache-2.0
- **uuid** — MIT OR Apache-2.0
- **regex** — MIT OR Apache-2.0
- **git2** (libgit2 bindings) — MIT OR Apache-2.0
- **keyring** — MIT OR Apache-2.0
- **notify** — CC0-1.0
- **zip** — MIT
- **similar** — Apache-2.0
- **sha2** (RustCrypto) — MIT OR Apache-2.0
- **diffy** — MIT OR Apache-2.0
- **shlex** — MIT OR Apache-2.0
- **log** — MIT OR Apache-2.0
- **tempfile** — MIT OR Apache-2.0
- **headless_chrome** — MIT

---

## Fonts (bundled binaries)

Unlike the entries above, these are redistributed **inside** the application
bundle as font files. The SIL Open Font License 1.1 requires its copyright
notice and licence text to travel with every copy, so each licence is shipped
verbatim in `src/assets/fonts/` and shown in-app under
**Baram > About Baram > Bundled fonts > View font licenses**.

- **Pretendard Variable** (`PretendardVariable.woff2`) — OFL-1.1
  Copyright (c) 2021, Kil Hyung-jin, with Reserved Font Name 'Pretendard'.
  Includes work Copyright 2014-2021 Adobe. Licence: `src/assets/fonts/OFL-Pretendard.txt`
- **JetBrains Mono Variable** (`jetbrains-mono-latin-wght-normal.woff2`) — OFL-1.1
  Copyright 2020 The JetBrains Mono Project Authors.
  Licence: `src/assets/fonts/OFL-JetBrainsMono.txt`

---

Full license texts for each dependency are available in their respective source
repositories and within the installed `node_modules/` and Cargo registry
packages. If you believe an attribution is missing or incorrect, please
[open an issue](https://github.com/sayinel/baram/issues).
