# Plugin Registry Hosting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a live plugin registry on GitHub Pages so the §69 marketplace works end-to-end (fetch → install → checksum verify → update check).

**Architecture:** A new public repo `sayinel/baram-plugins` serves `index.json` + plugin ZIPs via GitHub Pages (branch deploy, no CI of its own). A tag-triggered workflow in the main repo (`plugin-<dir>-v<version>`) builds the plugin from `examples/plugins/<dir>`, packages the ZIP, computes SHA-256, and pushes ZIP + upserted index to the registry repo over a deploy key. The app changes by one line (`DEFAULT_REGISTRY_URL`).

**Tech Stack:** GitHub Actions (SHA-pinned), GitHub Pages, plain-node `.mjs` script (no deps), `zip`/`sha256sum`, Vitest, cargo test.

**Spec:** `dev/superpowers/specs/2026-07-16-plugin-registry-hosting-design.md`

## Global Constraints

- Registry URL (exact, used in code, tests, docs): `https://sayinel.github.io/baram-plugins/index.json`
- Download URL base (exact): `https://sayinel.github.io/baram-plugins/plugins/<manifest.id>-<version>.zip`
- Actions pinned by commit SHA + `# vN` comment. Reuse the repo's existing pin: `actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0`. No `actions/setup-node` — existing CI uses the runner's preinstalled node; follow that.
- `ci.yml` and `release.yml` are contract-sensitive — DO NOT TOUCH. New workflow uses the `plugin-*` tag namespace which does not overlap `v*`.
- ZIP packaging contract (§5 of spec): `baram-plugin.json` at archive ROOT; include only `baram-plugin.json`, `dist/`, `README.md`.
- Conventional Commits in English. Never `git commit --no-verify`.
- Git push needs `-c core.sshCommand="ssh -i ~/.ssh/id_ed25519_macbook -o IdentitiesOnly=yes"` (default key has no repo access; never `git remote set-url`). Pre-push hook runs clippy+knip (5–7 min cold) — push in background.
- Branch: `feature/plugin-registry-hosting` (already created and checked out).
- Test gates: `npm test` (vitest run), `npm run typecheck`, cargo test. Capture exit codes without pipes (`cmd > /tmp/log; echo $?`).
- Tasks 1–6 are pre-merge (feature branch → PR). Tasks 7–9 run only after the PR is merged to main.

---

### Task 1: Create and initialize `sayinel/baram-plugins`

Outward-facing: creates a public repo, enables Pages, registers a deploy key + secret. Confirm with the user before starting this task if not already authorized in-session.

**Files:** none in the main repo. New repo content is authored in the scratchpad.

**Interfaces:**
- Produces: public repo `sayinel/baram-plugins` (branch `main`: `index.json` with empty `plugins` array, `.nojekyll`, `README.md`), Pages site at `https://sayinel.github.io/baram-plugins/`, deploy key with write access, secret `PLUGINS_DEPLOY_KEY` on `sayinel/baram` (consumed by Task 3's workflow).

- [ ] **Step 1: Author initial registry content in scratchpad**

```bash
REG_DIR="$SCRATCHPAD/baram-plugins"   # use the session scratchpad path
mkdir -p "$REG_DIR" && cd "$REG_DIR"
git init -b main
printf '{\n  "plugins": [],\n  "updatedAt": "2026-07-16"\n}\n' > index.json
touch .nojekyll
cat > README.md <<'EOF'
# Baram Plugin Registry

Plugin registry and distribution channel for [Baram](https://github.com/sayinel/baram),
served via GitHub Pages.

- `index.json` — the registry index the app's marketplace fetches
- `plugins/*.zip` — plugin packages (SHA-256 verified at install time)

## Policy

This registry currently hosts **first-party Baram plugins only**. Community
submissions are not accepted yet. Do not open PRs adding plugin entries;
they will be closed.

## How it is updated

Content is pushed exclusively by the `plugin-release.yml` workflow in the
main Baram repo: pushing a tag `plugin-<dir>-v<version>` there builds the
plugin, packages the ZIP, computes its SHA-256, and commits the ZIP plus an
updated `index.json` here. Manual commits are reserved for maintenance.
EOF
git add -A
git commit -m "chore: initialize plugin registry"
```

- [ ] **Step 2: Create the public repo and push**

```bash
cd "$REG_DIR"
gh repo create sayinel/baram-plugins --public --source . --push \
  --description "Plugin registry and distribution for Baram, served via GitHub Pages"
```
Expected: repo created, `main` pushed.

- [ ] **Step 3: Enable GitHub Pages (branch deploy from main root)**

```bash
gh api -X POST repos/sayinel/baram-plugins/pages \
  -f "build_type=legacy" -f "source[branch]=main" -f "source[path]=/"
```
Expected: JSON response with `"status": "building"` (or similar). If it errors with "already exists", verify with `gh api repos/sayinel/baram-plugins/pages`.

- [ ] **Step 4: Verify the Pages URL serves index.json**

```bash
for i in $(seq 1 20); do
  curl -fsS https://sayinel.github.io/baram-plugins/index.json && break
  sleep 15
done
```
Expected (within ~2–5 min): `{ "plugins": [], "updatedAt": "2026-07-16" }`

- [ ] **Step 5: Generate deploy key, register it, store the secret, then delete local copies**

```bash
ssh-keygen -t ed25519 -N "" -C "plugin-release@sayinel/baram" -f "$SCRATCHPAD/plugins_deploy"
gh repo deploy-key add "$SCRATCHPAD/plugins_deploy.pub" -R sayinel/baram-plugins \
  --allow-write --title "plugin-release (sayinel/baram Actions)"
gh secret set PLUGINS_DEPLOY_KEY -R sayinel/baram < "$SCRATCHPAD/plugins_deploy"
rm "$SCRATCHPAD/plugins_deploy" "$SCRATCHPAD/plugins_deploy.pub"
```
Expected: deploy key listed by `gh repo deploy-key list -R sayinel/baram-plugins` (read/write); secret listed by `gh secret list -R sayinel/baram`.

---

### Task 2: `scripts/update-registry-index.mjs` (index upsert)

**Files:**
- Create: `scripts/update-registry-index.mjs`

**Interfaces:**
- Produces: CLI `node scripts/update-registry-index.mjs --index <path> --manifest <path> --zip-name <file> --checksum <64hex> --base-url <url>` — upserts one `RegistryEntry` (keyed by manifest `id`) into the index, sets `updatedAt` to today (YYYY-MM-DD), writes 2-space-indented JSON + trailing newline. Exits 1 with a message on any validation failure. Consumed by Task 3's workflow and Task 3's local dry run.
- Entry field mapping (allowlist — never spread the manifest): `id,name,description,version,author,license,capabilities,engines` from manifest; `downloadUrl = <base-url>plugins/<zip-name>`; `checksum` from arg; `icon`/`keywords` copied only if present. The manifest's `main` field is intentionally dropped (not part of `RegistryEntry`).

Note: knip's `project` glob only covers `src/**` and tsconfig.node.json only includes `scripts/**/*.ts`, so a `.mjs` script (matching the existing `scripts/check-version-sync.mjs` precedent) needs no knip/tsconfig changes.

- [ ] **Step 1: Write the script**

```js
#!/usr/bin/env node
/**
 * Upsert a plugin entry into a registry index.json.
 * Called by .github/workflows/plugin-release.yml (§69 registry hosting).
 *
 * Usage:
 *   node scripts/update-registry-index.mjs \
 *     --index path/to/index.json \
 *     --manifest examples/plugins/word-count/baram-plugin.json \
 *     --zip-name baram-word-count-1.0.0.zip \
 *     --checksum <64-hex sha256> \
 *     --base-url https://sayinel.github.io/baram-plugins/
 */
import { readFileSync, writeFileSync } from "node:fs";

function fail(msg) {
  console.error(`update-registry-index: ${msg}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key?.startsWith("--") || value === undefined) {
      fail(`bad argument pair: ${key ?? ""} ${value ?? ""}`);
    }
    args[key.slice(2)] = value;
  }
  for (const required of ["index", "manifest", "zip-name", "checksum", "base-url"]) {
    if (!args[required]) fail(`missing --${required}`);
  }
  return args;
}

const MANIFEST_REQUIRED = [
  "id",
  "name",
  "description",
  "version",
  "author",
  "license",
  "capabilities",
  "engines",
];

const args = parseArgs(process.argv.slice(2));

if (!/^[0-9a-f]{64}$/.test(args.checksum)) {
  fail("checksum must be 64 lowercase hex chars");
}

const manifest = JSON.parse(readFileSync(args.manifest, "utf8"));
for (const field of MANIFEST_REQUIRED) {
  if (manifest[field] === undefined) fail(`manifest missing required field: ${field}`);
}

const baseUrl = args["base-url"].endsWith("/") ? args["base-url"] : `${args["base-url"]}/`;

const entry = {
  id: manifest.id,
  name: manifest.name,
  description: manifest.description,
  version: manifest.version,
  author: manifest.author,
  license: manifest.license,
  downloadUrl: `${baseUrl}plugins/${args["zip-name"]}`,
  checksum: args.checksum,
  capabilities: manifest.capabilities,
  engines: manifest.engines,
};
if (manifest.icon !== undefined) entry.icon = manifest.icon;
if (manifest.keywords !== undefined) entry.keywords = manifest.keywords;

const index = JSON.parse(readFileSync(args.index, "utf8"));
if (!Array.isArray(index.plugins)) fail("index.json has no plugins array");

const at = index.plugins.findIndex((p) => p.id === entry.id);
if (at >= 0) index.plugins[at] = entry;
else index.plugins.push(entry);
index.updatedAt = new Date().toISOString().slice(0, 10);

const serialized = `${JSON.stringify(index, null, 2)}\n`;
JSON.parse(serialized); // self-check: output must round-trip before we write it
writeFileSync(args.index, serialized);
console.log(`upserted ${entry.id}@${entry.version} -> ${entry.downloadUrl}`);
```

- [ ] **Step 2: Exercise the script against a temp index (insert, update, and rejection paths)**

```bash
T="$SCRATCHPAD/registry-test"; mkdir -p "$T"
printf '{\n  "plugins": [],\n  "updatedAt": "2026-01-01"\n}\n' > "$T/index.json"
CS="$(printf 'x%.0s' {1..64} | tr 'x' 'a')"   # 64 chars of 'a'

# insert
node scripts/update-registry-index.mjs --index "$T/index.json" \
  --manifest examples/plugins/word-count/baram-plugin.json \
  --zip-name baram-word-count-1.0.0.zip --checksum "$CS" \
  --base-url https://sayinel.github.io/baram-plugins/
node -e "
const i = require('$T/index.json');
const p = i.plugins[0];
if (i.plugins.length !== 1) throw new Error('expected 1 entry');
if (p.id !== 'baram-word-count') throw new Error('bad id');
if (p.downloadUrl !== 'https://sayinel.github.io/baram-plugins/plugins/baram-word-count-1.0.0.zip') throw new Error('bad downloadUrl');
if (p.main !== undefined) throw new Error('manifest main must be dropped');
console.log('insert OK');
"

# upsert (same id twice must not duplicate)
node scripts/update-registry-index.mjs --index "$T/index.json" \
  --manifest examples/plugins/word-count/baram-plugin.json \
  --zip-name baram-word-count-1.0.0.zip --checksum "$CS" \
  --base-url https://sayinel.github.io/baram-plugins/
node -e "
const i = require('$T/index.json');
if (i.plugins.length !== 1) throw new Error('upsert duplicated the entry');
console.log('upsert OK');
"

# rejection: bad checksum must exit 1
node scripts/update-registry-index.mjs --index "$T/index.json" \
  --manifest examples/plugins/word-count/baram-plugin.json \
  --zip-name x.zip --checksum notahash \
  --base-url https://sayinel.github.io/baram-plugins/ > /tmp/reject.log 2>&1
echo "exit=$?"
```
Expected: `insert OK`, `upsert OK`, then `exit=1` with a checksum message in `/tmp/reject.log`.

- [ ] **Step 3: Commit**

```bash
git add scripts/update-registry-index.mjs
git commit -m "feat(scripts): add registry index upsert script for plugin releases (§69)"
```

---

### Task 3: `plugin-release.yml` workflow + example-plugin lockfiles

**Files:**
- Create: `.github/workflows/plugin-release.yml`
- Create: `examples/plugins/word-count/package-lock.json` (generated)
- Create: `examples/plugins/ai-summary/package-lock.json` (generated)

**Interfaces:**
- Consumes: `scripts/update-registry-index.mjs` (Task 2), secret `PLUGINS_DEPLOY_KEY` (Task 1).
- Produces: on `plugin-<dir>-v<semver>` tag push — a commit on `sayinel/baram-plugins` `main` adding `plugins/<manifest.id>-<version>.zip` and the upserted `index.json`.

- [ ] **Step 1: Generate lockfiles so the workflow can use `npm ci`**

```bash
(cd examples/plugins/word-count && npm install --package-lock-only)
(cd examples/plugins/ai-summary && npm install --package-lock-only)
```
Expected: both `package-lock.json` files exist; no `node_modules/` created.

- [ ] **Step 2: Write the workflow**

```yaml
name: Plugin Release

# Publishes a first-party plugin to the sayinel/baram-plugins registry
# (GitHub Pages). Trigger: push a tag `plugin-<dir>-v<version>` where <dir>
# is the directory under examples/plugins/ and <version> matches that
# plugin's baram-plugin.json. Spec: dev plugin-registry-hosting design.
on:
  push:
    tags: ['plugin-*']

# Serialize releases: two plugin tags at once must not race on the
# registry-repo push.
concurrency:
  group: plugin-release
  cancel-in-progress: false

permissions:
  contents: read

env:
  TZ: Asia/Seoul
  REGISTRY_REPO: sayinel/baram-plugins
  BASE_URL: https://sayinel.github.io/baram-plugins/

jobs:
  release:
    runs-on: ubuntu-24.04
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0
        with:
          fetch-depth: 0

      - name: Parse and verify tag
        id: meta
        run: |
          fail() { echo "::error::$1"; exit 1; }
          TAG="${GITHUB_REF_NAME}"
          [[ "$TAG" =~ ^plugin-(.+)-v([0-9]+\.[0-9]+\.[0-9]+)$ ]] \
            || fail "tag $TAG does not match plugin-<dir>-v<semver>"
          DIR="${BASH_REMATCH[1]}"; VERSION="${BASH_REMATCH[2]}"
          MANIFEST="examples/plugins/$DIR/baram-plugin.json"
          [[ -f "$MANIFEST" ]] || fail "no manifest at $MANIFEST"
          MANIFEST_VERSION="$(node -p "require('./$MANIFEST').version")"
          [[ "$VERSION" == "$MANIFEST_VERSION" ]] \
            || fail "tag version $VERSION != manifest version $MANIFEST_VERSION"
          PLUGIN_ID="$(node -p "require('./$MANIFEST').id")"
          git merge-base --is-ancestor "$GITHUB_SHA" origin/main \
            || fail "tag commit $GITHUB_SHA is not on main"
          {
            echo "dir=$DIR"
            echo "version=$VERSION"
            echo "plugin_id=$PLUGIN_ID"
            echo "zip_name=$PLUGIN_ID-$VERSION.zip"
          } >> "$GITHUB_OUTPUT"

      - name: Build plugin
        working-directory: examples/plugins/${{ steps.meta.outputs.dir }}
        run: |
          npm ci
          npm run build

      # Packaging contract: baram-plugin.json at the archive ROOT — zip the
      # directory CONTENTS, never a wrapping folder. Runtime files only.
      - name: Package ZIP
        working-directory: examples/plugins/${{ steps.meta.outputs.dir }}
        run: |
          zip -r "$RUNNER_TEMP/${{ steps.meta.outputs.zip_name }}" \
            baram-plugin.json dist README.md

      - name: Compute checksum
        id: sum
        run: |
          CHECKSUM="$(sha256sum "$RUNNER_TEMP/${{ steps.meta.outputs.zip_name }}" | cut -d' ' -f1)"
          echo "checksum=$CHECKSUM" >> "$GITHUB_OUTPUT"

      - name: Push ZIP + updated index to registry repo
        env:
          DEPLOY_KEY: ${{ secrets.PLUGINS_DEPLOY_KEY }}
        run: |
          mkdir -p ~/.ssh
          echo "$DEPLOY_KEY" > ~/.ssh/plugins_deploy
          chmod 600 ~/.ssh/plugins_deploy
          ssh-keyscan github.com >> ~/.ssh/known_hosts 2>/dev/null
          export GIT_SSH_COMMAND="ssh -i ~/.ssh/plugins_deploy -o IdentitiesOnly=yes"
          git clone --depth 1 "git@github.com:${REGISTRY_REPO}.git" "$RUNNER_TEMP/registry"
          mkdir -p "$RUNNER_TEMP/registry/plugins"
          cp "$RUNNER_TEMP/${{ steps.meta.outputs.zip_name }}" "$RUNNER_TEMP/registry/plugins/"
          node scripts/update-registry-index.mjs \
            --index "$RUNNER_TEMP/registry/index.json" \
            --manifest "examples/plugins/${{ steps.meta.outputs.dir }}/baram-plugin.json" \
            --zip-name "${{ steps.meta.outputs.zip_name }}" \
            --checksum "${{ steps.sum.outputs.checksum }}" \
            --base-url "$BASE_URL"
          cd "$RUNNER_TEMP/registry"
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add "plugins/${{ steps.meta.outputs.zip_name }}" index.json
          git commit -m "release: ${{ steps.meta.outputs.plugin_id }} ${{ steps.meta.outputs.version }}"
          git push origin main
```

- [ ] **Step 3: Local dry run of the full build→zip→checksum→upsert chain (word-count)**

```bash
(cd examples/plugins/word-count && npm install && npm run build)
(cd examples/plugins/word-count && zip -r "$SCRATCHPAD/baram-word-count-1.0.0.zip" \
  baram-plugin.json dist README.md)
unzip -l "$SCRATCHPAD/baram-word-count-1.0.0.zip"
```
Expected: listing shows `baram-plugin.json` at the archive root (no wrapping folder), `dist/index.mjs`, `README.md` — and nothing else (no `src/`, no `styles.css`).

```bash
CS="$(shasum -a 256 "$SCRATCHPAD/baram-word-count-1.0.0.zip" | cut -d' ' -f1)"
printf '{\n  "plugins": [],\n  "updatedAt": "2026-01-01"\n}\n' > "$SCRATCHPAD/dryrun-index.json"
node scripts/update-registry-index.mjs --index "$SCRATCHPAD/dryrun-index.json" \
  --manifest examples/plugins/word-count/baram-plugin.json \
  --zip-name baram-word-count-1.0.0.zip --checksum "$CS" \
  --base-url https://sayinel.github.io/baram-plugins/
cat "$SCRATCHPAD/dryrun-index.json"
```
Expected: entry with real checksum, `version: "1.0.0"`, correct `downloadUrl`. Clean up `examples/plugins/word-count/node_modules` afterwards (`rm -rf`); `dist/` changes, if any, must NOT be committed in this task.

- [ ] **Step 4: Restore the working tree except intended files, then commit**

```bash
git status --short   # expect ONLY: plugin-release.yml + 2 package-lock.json
git checkout -- examples/plugins/word-count/dist 2>/dev/null || true
git add .github/workflows/plugin-release.yml \
  examples/plugins/word-count/package-lock.json \
  examples/plugins/ai-summary/package-lock.json
git commit -m "ci: add plugin-release workflow publishing to baram-plugins registry (§69)"
```

---

### Task 4: Swap `DEFAULT_REGISTRY_URL` (TDD)

**Files:**
- Modify: `src/stores/system/plugin.ts:42-43`
- Test: `src/plugins/__tests__/plugin-store.test.ts:205-209`

**Interfaces:**
- Produces: `DEFAULT_REGISTRY_URL === "https://sayinel.github.io/baram-plugins/index.json"` — the value Task 5's docs and Task 8's seed test must match.

- [ ] **Step 1: Update the test to expect the new URL**

In `src/plugins/__tests__/plugin-store.test.ts`, replace:

```ts
    test("has default registry URL", () => {
      expect(usePluginStore.getState().registryUrl).toContain(
        "baram-community",
      );
    });
```

with:

```ts
    test("has default registry URL", () => {
      expect(usePluginStore.getState().registryUrl).toBe(
        "https://sayinel.github.io/baram-plugins/index.json",
      );
    });
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/plugins/__tests__/plugin-store.test.ts > /tmp/t4.log 2>&1; echo $?
tail -20 /tmp/t4.log
```
Expected: exit 1; "has default registry URL" fails (still the old raw.githubusercontent URL).

- [ ] **Step 3: Swap the constant**

In `src/stores/system/plugin.ts`, replace:

```ts
const DEFAULT_REGISTRY_URL =
  "https://raw.githubusercontent.com/baram-community/plugin-registry/main/index.json";
```

with:

```ts
const DEFAULT_REGISTRY_URL =
  "https://sayinel.github.io/baram-plugins/index.json";
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run src/plugins/__tests__/plugin-store.test.ts > /tmp/t4.log 2>&1; echo $?
```
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/stores/system/plugin.ts src/plugins/__tests__/plugin-store.test.ts
git commit -m "feat(plugins): point default registry URL at the live baram-plugins registry (§69)"
```

---

### Task 5: Update `docs/plugin-development.md`

**Files:**
- Modify: `docs/plugin-development.md` (registry sections, ~lines 553–600)

**Interfaces:**
- Consumes: the new URL from Task 4; workflow behavior from Task 3.

- [ ] **Step 1: Replace the default-URL code block and the "aspirational" paragraph**

Find (in "How Baram loads the registry"):

```
https://raw.githubusercontent.com/baram-community/plugin-registry/main/index.json
```

Replace with:

```
https://sayinel.github.io/baram-plugins/index.json
```

Find the paragraph starting `` `baram-community/plugin-registry` is an **aspirational** external repository `` (ends `…This is expected, not a bug to chase.`) and replace it with:

```markdown
The registry lives at
[`sayinel/baram-plugins`](https://github.com/sayinel/baram-plugins) — a
public repo served via GitHub Pages that hosts `index.json` plus the plugin
ZIPs under `plugins/`. It accepts **first-party plugins only** for now;
community submissions are a future consideration.

Publishing is driven from this repo's CI: pushing a tag
`plugin-<dir>-v<version>` (e.g. `plugin-word-count-v1.0.0`, where `<dir>` is
the directory under `examples/plugins/` and the version must match that
plugin's `baram-plugin.json`) runs `.github/workflows/plugin-release.yml`,
which builds the plugin, packages the ZIP per the contract above, computes
its SHA-256, and pushes the ZIP plus an updated `index.json` to the registry
repo.
```

- [ ] **Step 2: Sanity-check the surrounding "Local testing" section still reads correctly**

It describes pointing `registryUrl` at the committed seed — still valid; no change needed. Verify no other `baram-community` mentions remain:

```bash
grep -rn "baram-community" docs/ src/ .github/ registry/ | grep -v node_modules
```
Expected: no matches outside `registry/index.json` history (i.e., zero matches; the seed never contained the URL).

- [ ] **Step 3: Commit**

```bash
git add docs/plugin-development.md
git commit -m "docs(plugins): document the live baram-plugins registry and release workflow (§69)"
```

---

### Task 6: Gates, push, PR

**Files:** none (verification + PR only).

- [ ] **Step 1: Run the full frontend gates**

```bash
npm test > /tmp/gate-test.log 2>&1; echo $?
npm run typecheck > /tmp/gate-tsc.log 2>&1; echo $?
npm run lint:frontend > /tmp/gate-lint.log 2>&1; echo $?
```
Expected: all exit 0. (Rust untouched so far — cargo runs in PR CI.)

- [ ] **Step 2: Push in background (pre-push hook: clippy+knip, 5–7 min cold)**

```bash
git -c core.sshCommand="ssh -i ~/.ssh/id_ed25519_macbook -o IdentitiesOnly=yes" \
  push -u origin feature/plugin-registry-hosting
```
Run with `run_in_background: true`; wait for completion before creating the PR.

- [ ] **Step 3: Create the PR (English, house PR style: motivation / design & architecture diagram / implementation / test results / checklist)**

Fill the two `<paste …>` slots with real command output from Step 1 before submitting.

````bash
gh pr create --title "feat(plugins): live plugin registry on GitHub Pages (§69 follow-up)" --body "$(cat <<'EOF'
## Motivation

The §69 marketplace client is complete (registry fetch, ZIP install with
SHA-256 verification, update checker, capability approval) but had no real
registry to talk to: `DEFAULT_REGISTRY_URL` pointed at an aspirational
`baram-community/plugin-registry` repo that was never created, and the seed
`registry/index.json` still carries `"TBD"` download URLs (Phase F deferred
item). This PR ships the live registry and distribution channel.

## Design

Registry and ZIPs are served from a new public repo
[`sayinel/baram-plugins`](https://github.com/sayinel/baram-plugins) via
GitHub Pages (branch deploy, no CI of its own):

```
sayinel/baram (private, source)              sayinel/baram-plugins (public)
├── examples/plugins/                        ├── index.json          ← registry
│   ├── word-count/     ── plugin-release ─▶ ├── plugins/
│   └── ai-summary/        (on tag push:     │   └── <id>-<version>.zip
├── .github/workflows/      build → zip →    ├── README.md
│   └── plugin-release.yml  sha256 → push)   └── .nojekyll
└── registry/index.json (seed/schema fixture)      │
                                             GitHub Pages
                                                   │
                        https://sayinel.github.io/baram-plugins/index.json
```

Key decisions:

| Decision | Rationale |
| --- | --- |
| Separate public repo + Pages | Main repo is private, so its raw URLs / Release assets are not publicly fetchable. A dedicated repo also insulates the registry URL from however the main repo goes public later, and preserves the main repo's single Pages slot. |
| index + ZIPs on the same Pages site | One deploy updates both atomically — no index/ZIP version-skew window. |
| Deploy-key push from main-repo CI | Plugin sources stay in `examples/plugins/` (no source duplication); the registry repo receives build artifacts only. |
| First-party only | Community submission pipeline is YAGNI until there is demand (stated in the registry README). |
| No store migration | Previously shipped builds were not official distributions, so the one-line `DEFAULT_REGISTRY_URL` swap suffices. |

## Implementation

- `scripts/update-registry-index.mjs` — dependency-free upsert of a
  `RegistryEntry` (allowlisted manifest fields + computed
  `downloadUrl`/`checksum`); validates checksum shape, required manifest
  fields, and round-trips its own output before writing. Exits 1 on any
  violation so the workflow fails before pushing a broken index.
- `.github/workflows/plugin-release.yml` — triggered by
  `plugin-<dir>-v<semver>` tags (namespace disjoint from the `v*` app
  release rules; `ci.yml`/`release.yml` untouched). Verifies tag↔manifest
  version and tag-on-main, builds with `npm ci`, zips per the packaging
  contract (`baram-plugin.json` at archive root; `dist/` + README only),
  computes SHA-256, and pushes to the registry repo. Actions SHA-pinned;
  `concurrency: plugin-release` serializes concurrent tags.
- `package-lock.json` added to both example plugins so CI builds are
  reproducible via `npm ci`.
- `DEFAULT_REGISTRY_URL` → `https://sayinel.github.io/baram-plugins/index.json`
  (TDD: `plugin-store.test.ts` updated first).
- `docs/plugin-development.md` — replaced the "aspirational registry"
  passage with the real registry location, policy, and release flow.

## Test results

- `npm test` — <paste summary line, e.g. "2739 passed | 6 skipped">
- `npm run typecheck` / `npm run lint:frontend` — <paste exit status>
- Local dry run: built word-count, zipped, verified `baram-plugin.json` at
  archive root via `unzip -l`, ran the upsert script against a scratch
  index (insert / idempotent upsert / bad-checksum rejection all verified).

## Follow-ups (after merge)

- [ ] Tag `plugin-word-count-v1.0.0` + `plugin-ai-summary-v1.0.0`; verify both workflow runs and the live Pages content
- [ ] Fill `registry/index.json` seed TBDs from the live index + tighten the Rust drift-guard test (separate small PR)
- [ ] App E2E: marketplace fetch → install → capability approval → status-bar output; checksum-tamper negative test

## Checklist

- [ ] Workflow uses SHA-pinned actions with `# vN` comments
- [ ] `ci.yml` / `release.yml` untouched
- [ ] No secrets in code; deploy key scoped to `baram-plugins` only
- [ ] All frontend gates green
EOF
)"
````

---

### Task 7 (post-merge): First releases

Run only after the PR from Task 6 is merged to main.

- [ ] **Step 1: Tag both plugins from the merge commit on main**

```bash
git checkout main
git -c core.sshCommand="ssh -i ~/.ssh/id_ed25519_macbook -o IdentitiesOnly=yes" pull
git tag plugin-word-count-v1.0.0
git tag plugin-ai-summary-v1.0.0
git -c core.sshCommand="ssh -i ~/.ssh/id_ed25519_macbook -o IdentitiesOnly=yes" \
  push origin plugin-word-count-v1.0.0 plugin-ai-summary-v1.0.0
```
(Push tags in background; pre-push hook runs.)

- [ ] **Step 2: Watch both workflow runs**

```bash
gh run list --workflow=plugin-release.yml --limit 2
gh run watch <run-id> --exit-status
```
Expected: both runs green. The `concurrency` group serializes them.

- [ ] **Step 3: Verify the live registry**

```bash
curl -fsS https://sayinel.github.io/baram-plugins/index.json
```
Expected: 2 entries, real `downloadUrl`/`checksum` (allow ~10 min Pages CDN lag).

```bash
curl -fsSL -o /tmp/wc.zip "https://sayinel.github.io/baram-plugins/plugins/baram-word-count-1.0.0.zip"
shasum -a 256 /tmp/wc.zip   # must equal the checksum in index.json
unzip -l /tmp/wc.zip        # baram-plugin.json at root
```

---

### Task 8 (post-merge): Fill the seed's TBDs + update the drift-guard test (TDD)

**Files:**
- Modify: `registry/index.json`
- Test: `src-tauri/src/plugin/mod.rs:884-893` (`test_committed_registry_seed_deserializes`)

New branch off updated main: `chore/registry-seed-live-values`.

- [ ] **Step 1: Update the Rust test to require live values**

Replace the body of `test_committed_registry_seed_deserializes` (currently asserting `entry.download_url == "TBD"`) with:

```rust
    #[test]
    fn test_committed_registry_seed_deserializes() {
        const SEED: &str = include_str!("../../../registry/index.json");
        let idx: RegistryIndex = serde_json::from_str(SEED).unwrap();
        assert_eq!(idx.plugins.len(), 2);
        let ids: Vec<&str> = idx.plugins.iter().map(|p| p.id.as_str()).collect();
        assert_eq!(ids, vec!["baram-word-count", "baram-ai-summary"]);
        for entry in &idx.plugins {
            assert!(
                entry
                    .download_url
                    .starts_with("https://sayinel.github.io/baram-plugins/plugins/"),
                "downloadUrl should point at the live registry: {}",
                entry.download_url
            );
            assert_eq!(entry.checksum.len(), 64, "checksum must be sha256 hex");
            assert!(entry.checksum.chars().all(|c| c.is_ascii_hexdigit()));
        }
    }
```

- [ ] **Step 2: Run it to verify it fails (seed still has TBD)**

```bash
cargo test --manifest-path src-tauri/Cargo.toml test_committed_registry_seed_deserializes > /tmp/t8.log 2>&1; echo $?
```
Expected: exit non-zero, downloadUrl assertion failure.

- [ ] **Step 3: Replace the seed with the live index verbatim**

```bash
curl -fsS https://sayinel.github.io/baram-plugins/index.json > registry/index.json
git diff registry/index.json   # eyeball: same 2 ids, real URLs + 64-hex checksums
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cargo test --manifest-path src-tauri/Cargo.toml test_committed_registry_seed_deserializes > /tmp/t8.log 2>&1; echo $?
```
Expected: exit 0.

- [ ] **Step 5: Commit + PR**

```bash
git add registry/index.json src-tauri/src/plugin/mod.rs
git commit -m "chore(registry): fill seed index with live registry values (§69 Phase F deferred)"
```
Push (background, Rust touched → clippy warm-up applies) and open a small PR.

---

### Task 9 (post-merge): App E2E + checksum-defense verification

Manual, with the user driving the app; assistant prepares the negative test.

- [ ] **Step 1: Marketplace E2E on the default URL**

`npm run tauri dev` → Settings → Plugins → Browse: both plugins listed → install word-count → approve capabilities → status bar shows word/char count.

- [ ] **Step 2: Update-checker check (optional, needs a 1.0.1 release)**

Bump word-count to `1.0.1` (manifest + a trivial change), merge, tag `plugin-word-count-v1.0.1`; app should surface the update.

- [ ] **Step 3: Checksum-defense negative test**

Serve a tampered index locally and point `registryUrl` at it (docs "Local testing" section describes the config-file edit):

```bash
mkdir -p "$SCRATCHPAD/tampered" && cd "$SCRATCHPAD/tampered"
curl -fsS https://sayinel.github.io/baram-plugins/index.json \
  | sed 's/"checksum": "[0-9a-f]\{64\}"/"checksum": "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef"/' > index.json
python3 -m http.server 8000
```
Install attempt in-app must fail with a checksum-mismatch error. Restore `registryUrl` afterwards.

- [ ] **Step 4: Record results** — report evidence (screens/logs) before declaring §8 of the spec verified.
