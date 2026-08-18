# CI/CD Optimization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Redesign Baram's CI/CD pipeline for maximum parallelism, expanded verification, secret detection, and supply-chain security.

**Architecture:** Replace monolithic lint+test jobs with 5 parallel jobs (path-filtered), add gitleaks security scanning, create one composite action (setup-node) for DRY, and make release.yml call CI first via workflow_call. Rust setup is inlined (only used once in CI).

**Tech Stack:** GitHub Actions, dorny/paths-filter, gitleaks, Swatinem/rust-cache

---

## Reference: Action Versions & SHAs

| Action | Tag | SHA (3rd-party only) |
|--------|-----|----------------------|
| `actions/checkout` | `v6` | — (1st-party) |
| `actions/setup-node` | `v6` | — (1st-party) |
| `actions/upload-artifact` | `v4` | — (1st-party, keep v4 for stability) |
| `actions/download-artifact` | `v4` | — (1st-party, keep v4 for stability) |
| `dorny/paths-filter` | `v3.0.2` | `de90cc6fb38fc0963ad72b210f1f284cd68cea36` |
| `gitleaks/gitleaks-action` | `v2.3.9` | `ff98106e4c7b2bc287b24eaf42907196329070c7` |
| `Swatinem/rust-cache` | `v2.8.2` | `779680da715d629ac1d338a641029a2f4372abb5` |
| `dtolnay/rust-toolchain` | `v1` | `efa25f7f19611383d5b0ccf2d1c8914531636bf9` |
| `softprops/action-gh-release` | `v2` | — (keep v2 tag) |

## Simplification Decisions

- **No setup-tauri composite** — only used in 1 CI job (rust-check). release.yml needs different `targets` per platform, so it can't reuse it either. Inline is simpler.
- **lint + typecheck merged** — both are fast single-command steps after setup-node. Separate jobs add ~10s startup overhead each for marginal failure isolation benefit.
- **5 jobs instead of 6** — changes, lint, test, rust-check, security.

---

### Task 1: Create composite action — setup-node

> **Note:** Composite actions do NOT include `actions/checkout`. GitHub requires
> the repo to be checked out BEFORE a local composite action (`uses: ./.github/...`)
> can be resolved. Each caller job must checkout first, then call the composite.

**Files:**
- Create: `.github/actions/setup-node/action.yml`

**Step 1: Create directory and write the composite action**

Run: `mkdir -p .github/actions/setup-node`

```yaml
# .github/actions/setup-node/action.yml
name: Setup Node.js
description: Install Node.js from .node-version and npm ci with cache. Caller must checkout first.

runs:
  using: composite
  steps:
    - uses: actions/setup-node@v6
      with:
        node-version-file: .node-version
        cache: npm

    - name: Install dependencies
      run: npm ci
      shell: bash
```

**Step 2: Verify valid YAML**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/actions/setup-node/action.yml'))"`

**Step 3: Commit**

```bash
git add .github/actions/setup-node/action.yml
git commit -m "ci: add setup-node composite action

setup-node (from .node-version) + npm ci with cache.
Caller must checkout first — local composite actions require repo on disk."
```

---

### Task 2: Rewrite ci.yml — 5 parallel jobs with path filtering and security

**Files:**
- Modify: `.github/workflows/ci.yml` (full rewrite)

**Step 1: Write the new ci.yml**

```yaml
name: CI

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]
  workflow_call:

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: read

env:
  CARGO_TERM_COLOR: always

jobs:
  # ── Path Filtering ──────────────────────────────────────────────
  changes:
    runs-on: ubuntu-latest
    outputs:
      frontend: ${{ steps.filter.outputs.frontend }}
      rust: ${{ steps.filter.outputs.rust }}
    steps:
      - uses: actions/checkout@v6
      - uses: dorny/paths-filter@de90cc6fb38fc0963ad72b210f1f284cd68cea36  # v3.0.2
        id: filter
        with:
          filters: |
            frontend:
              - 'src/**'
              - 'package.json'
              - 'package-lock.json'
              - 'tsconfig.json'
              - '*.config.*'
            rust:
              - 'src-tauri/**'

  # ── Frontend: Lint + Type Check ─────────────────────────────────
  lint:
    needs: changes
    if: needs.changes.outputs.frontend == 'true' || github.event_name == 'workflow_call'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: ./.github/actions/setup-node
      - name: Prettier
        run: npx prettier --check 'src/**/*.{ts,tsx,css}'
      - name: ESLint
        run: npx eslint src/ --max-warnings=0
      - name: Stylelint
        run: npx stylelint 'src/**/*.css'
      - name: TypeScript
        run: npx tsc --noEmit
      - name: Knip (dead code)
        run: npx knip --reporter compact

  # ── Frontend: Test ──────────────────────────────────────────────
  test:
    needs: changes
    if: needs.changes.outputs.frontend == 'true' || github.event_name == 'workflow_call'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: ./.github/actions/setup-node
      - name: Vitest
        run: npx vitest run

  # ── Rust: Check + Test ──────────────────────────────────────────
  rust-check:
    needs: changes
    if: needs.changes.outputs.rust == 'true' || github.event_name == 'workflow_call'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6

      - uses: dtolnay/rust-toolchain@efa25f7f19611383d5b0ccf2d1c8914531636bf9  # v1
        with:
          toolchain: stable
          components: clippy, rustfmt

      - uses: Swatinem/rust-cache@779680da715d629ac1d338a641029a2f4372abb5  # v2.8.2
        with:
          workspaces: src-tauri -> target

      - name: Install Tauri system deps
        run: |
          sudo apt-get update
          sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf

      - name: Format check
        run: cargo fmt --check
        working-directory: src-tauri

      - name: Build frontend (needed by generate_context macro)
        uses: ./.github/actions/setup-node
      - run: npm run build

      - name: Clippy
        run: cargo clippy -- -D warnings
        working-directory: src-tauri

      - name: Cargo test
        run: cargo test
        working-directory: src-tauri

  # ── Security: Secret Detection ──────────────────────────────────
  security:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0
      - uses: gitleaks/gitleaks-action@ff98106e4c7b2bc287b24eaf42907196329070c7  # v2.3.9
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

**Step 2: Verify YAML syntax**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))"`

**Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: rewrite ci.yml with 5 parallel jobs, path filtering, and gitleaks

- 5 jobs: changes, lint (+ typecheck), test, rust-check, security
- Path filtering via dorny/paths-filter (frontend/rust split)
- workflow_call bypass ensures full CI on release tags
- gitleaks secret detection on every push/PR
- concurrency: cancel-in-progress for superseded runs
- permissions: contents read (least privilege)
- Actions upgraded: checkout v6, setup-node v6
- Third-party actions SHA-pinned for supply-chain security"
```

---

### Task 3: Rewrite release.yml — CI-first, then 3-platform build

**Files:**
- Modify: `.github/workflows/release.yml` (full rewrite)

**Step 1: Write the new release.yml**

```yaml
name: Release

on:
  push:
    tags: ['v*']

permissions:
  contents: write

concurrency:
  group: release-${{ github.ref }}
  cancel-in-progress: false

env:
  CARGO_TERM_COLOR: always

jobs:
  # ── Run full CI first ───────────────────────────────────────────
  ci:
    uses: ./.github/workflows/ci.yml
    permissions:
      contents: read

  # ── Build on 3 platforms ────────────────────────────────────────
  build:
    needs: ci
    strategy:
      fail-fast: false
      matrix:
        include:
          - os: macos-14
            target: aarch64-apple-darwin
            artifact: baram-macos
          - os: ubuntu-latest
            target: x86_64-unknown-linux-gnu
            artifact: baram-linux
          - os: windows-latest
            target: x86_64-pc-windows-msvc
            artifact: baram-windows
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v6

      - uses: actions/setup-node@v6
        with:
          node-version-file: .node-version
          cache: npm

      - run: npm ci

      - uses: dtolnay/rust-toolchain@efa25f7f19611383d5b0ccf2d1c8914531636bf9  # v1
        with:
          toolchain: stable
          targets: ${{ matrix.target }}

      - uses: Swatinem/rust-cache@779680da715d629ac1d338a641029a2f4372abb5  # v2.8.2
        with:
          workspaces: src-tauri -> target

      - name: Install Tauri system deps (Linux)
        if: runner.os == 'Linux'
        run: |
          sudo apt-get update
          sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf

      - name: Build Tauri app
        run: npm run tauri build
        env:
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}

      - name: Upload macOS artifacts
        if: runner.os == 'macOS'
        uses: actions/upload-artifact@v4
        with:
          name: ${{ matrix.artifact }}
          path: src-tauri/target/release/bundle/dmg/*.dmg

      - name: Upload Linux artifacts
        if: runner.os == 'Linux'
        uses: actions/upload-artifact@v4
        with:
          name: ${{ matrix.artifact }}
          path: |
            src-tauri/target/release/bundle/deb/*.deb
            src-tauri/target/release/bundle/appimage/*.AppImage

      - name: Upload Windows artifacts
        if: runner.os == 'Windows'
        uses: actions/upload-artifact@v4
        with:
          name: ${{ matrix.artifact }}
          path: src-tauri/target/release/bundle/nsis/*.exe

  # ── Create GitHub Release ───────────────────────────────────────
  release:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6

      - name: Download all artifacts
        uses: actions/download-artifact@v4
        with:
          path: artifacts/

      - name: Create GitHub Release
        uses: softprops/action-gh-release@v2
        with:
          draft: true
          generate_release_notes: true
          files: |
            artifacts/baram-macos/**/*
            artifacts/baram-linux/**/*
            artifacts/baram-windows/**/*
```

**Step 2: Verify YAML syntax**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/release.yml'))"`

**Step 3: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci: rewrite release.yml to call CI workflow before building

- Uses workflow_call to run full CI verification first
- Build only starts after CI passes (needs: ci)
- 3-platform matrix: macOS, Linux, Windows
- Actions upgraded: checkout v6, setup-node v6, rust-cache v2 (SHA-pinned)
- concurrency: cancel-in-progress false (protect release builds)
- Draft release with auto-generated release notes"
```

---

### Task 4: Final verification

**Step 1: Validate all YAML files**

Run:
```bash
python3 -c "
import yaml, pathlib
for f in pathlib.Path('.github').rglob('*.yml'):
    try:
        yaml.safe_load(f.read_text())
        print(f'OK: {f}')
    except Exception as e:
        print(f'FAIL: {f} — {e}')
"
```
Expected: All files show OK

**Step 2: Verify composite action does NOT contain checkout**

Run: `grep -c 'actions/checkout' .github/actions/setup-node/action.yml`
Expected: `0`

**Step 3: Verify every job using composite action has checkout first**

Run: `grep -B1 'uses: ./.github/actions/' .github/workflows/ci.yml`
Expected: Every composite action usage is preceded by `actions/checkout@v6`

**Step 4: Verify rust-check step ordering**

Run: `grep -A30 'rust-check:' .github/workflows/ci.yml | grep -E 'name:|run:|uses:'`
Expected order: checkout → rust-toolchain → rust-cache → apt deps → fmt → setup-node → npm run build → clippy → cargo test

**Step 5: Verify workflow_call bypass on all conditional jobs**

Run: `grep 'workflow_call' .github/workflows/ci.yml`
Expected: 4 occurrences — `on: workflow_call` + 3 job `if:` conditions (lint, test, rust-check)

**Step 6: Verify SHA pins**

Run: `grep -rn '@[a-f0-9]\{40\}' .github/`
Expected SHA-pinned references:
- `dorny/paths-filter@de90cc6f...` (v3.0.2) — ci.yml
- `gitleaks/gitleaks-action@ff98106e...` (v2.3.9) — ci.yml
- `Swatinem/rust-cache@779680da...` (v2.8.2) — ci.yml + release.yml
- `dtolnay/rust-toolchain@efa25f7f...` (v1) — ci.yml + release.yml

**Step 7: Verify no hardcoded secrets**

Run: `grep -rn 'password\|api_key\|secret_key\|private_key' .github/ || echo "Clean"`
Expected: "Clean"
