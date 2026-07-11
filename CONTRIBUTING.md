# Contributing to Baram

Thanks for your interest in contributing to Baram! This guide covers how to set up your development environment, run the tests, and submit changes.

## Development Setup

**Prerequisites:**

- [Node.js](https://nodejs.org/) v20+
- [Rust](https://rustup.rs/) (latest stable)
- [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your platform

```bash
# Clone and install dependencies
git clone https://github.com/sayinel/baram.git
cd baram
npm install

# Start the dev server (frontend only)
npm run dev

# Start the full Tauri desktop app in dev mode
npm run tauri dev
```

## Testing & Quality

```bash
# Run tests
npm test                          # Vitest (frontend)
npm run rust:test                 # Rust backend
npm run rust:check                # fmt + frontend build + clippy + cargo test

# Lint & format
npm run lint
npm run check                     # frontend lint + tests
npm run verify:ci                 # local equivalent of CI gates
npm run format
```

Please run `npm run verify:ci` before opening a pull request — it mirrors the checks that run in CI.

## Tech Stack

| Layer | Technology |
|-------|------------|
| Desktop Framework | Tauri 2.0 |
| Backend | Rust |
| Frontend | React 19 + TypeScript |
| Bundler | Vite 6 |
| Styling | Tailwind CSS 4 |
| Editor Engine | Tiptap / ProseMirror |
| Math | KaTeX |
| Code | CodeMirror 6 |
| Diagrams | Mermaid.js |
| State | Zustand |

## Architecture

The React frontend (Tiptap / ProseMirror) communicates with the Rust backend — file system, LLM proxy, link index, tantivy search, Git, snapshots, and export — over Tauri IPC and events.

The markdown pipeline is bidirectional and lossless:

```
Forward:  remark-parse → mdast → ProseMirror Document
Reverse:  ProseMirror Document → mdast → remark-stringify
```

## Pull Requests

- Use [Conventional Commits](https://www.conventionalcommits.org/) for commit messages: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`.
- **Preserve lossless roundtrip** — MD → editor → MD must reproduce documents exactly. Add roundtrip tests for any pipeline or extension changes.
- Make sure `npm run verify:ci` passes before requesting review.
