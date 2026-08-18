# Plugin Dev Environment — Phase E (Public Types + Examples + Docs) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. One fresh subagent per task.

**Goal:** Ship the plugin-author-facing surface that Phases A–D earned. Four deliverables: (1) a type-only public API **barrel** `src/plugins/public-api.ts` that re-exports the entire public plugin surface from `./types` (single source of truth); (2) a committed generated **`plugin-api.d.ts`** produced by `tsc --emitDeclarationOnly` via a dedicated `tsconfig.plugin-api.json` + an npm `types:plugin` script; (3) two **real, buildable, dev-loadable example plugins** under `examples/plugins/` — `word-count` (canonical/minimal) and `ai-summary` (advanced: Shadow-DOM panel + settings + ai + storage); (4) a full **rewrite of `docs/plugin-development.md`** matching the REAL shipped API (the current file documents a stale partial API — e.g. `showStatusBarItem(text, alignment?): Disposable`), including a mandated **trust-model / security section**.

Phase E is **types + docs + examples only**. No runtime code changes to the plugin system (Phases A–D already shipped `ai`/`network`/`storage`/`ui` panels — verified in `src/plugins/extension-context.ts` and `src/plugins/types.ts`). The single permitted runtime-adjacent change is one **additive** type in `types.ts` (`PluginEventName` union) so the barrel can re-export an event-name union that does not yet exist. The example plugins ARE the acceptance test for the public types: if they typecheck against the generated `plugin-api.d.ts` and build with esbuild, the surface is correct.

**Architecture:** `src/plugins/types.ts` is the definition site for every public interface (already complete post-Phase-D). `public-api.ts` is a thin type-only re-export barrel — it introduces no new declarations, only curates which of `types.ts`'s exports are "public". `tsconfig.plugin-api.json` (`emitDeclarationOnly`, `rootDir: src/plugins`, `outDir: examples/plugins`) compiles the barrel and emits a flat 2-file tree into `examples/plugins/`: the barrel's own `.d.ts` (renamed to `plugin-api.d.ts` by the npm script) plus its transitive `types.d.ts` dependency. Both example plugins' `src/index.ts` `import type` from `../../plugin-api`; esbuild erases those type-only imports so the bundle has zero runtime deps (`@tiptap/*` declared external per convention but unused by these examples). Each example commits a pre-built `dist/index.mjs` so it is dev-loadable immediately via the Phase A Developer section (folder load + Reload) with no build step. The docs rewrite is prose only.

**Tech Stack:** TypeScript 6 (`tsc --emitDeclarationOnly`), esbuild 0.28.1 (already at repo root — `node_modules/.bin/esbuild`), no new dependencies. Examples build/typecheck with the ROOT toolchain (`npx esbuild`, `npx tsc`) — no per-example `npm install`, no committed `examples/**/node_modules`.

## Key Design Decisions

These are binding for every task. Do not re-litigate 1–4 (they are USER/spec decisions).

1. **d.ts emit = `tsc --emitDeclarationOnly` (USER DECISION), NO bundler.** A dedicated `tsconfig.plugin-api.json` extends the base tsconfig and overrides `{ noEmit: false, declaration: true, emitDeclarationOnly: true, rootDir: "src/plugins", outDir: "examples/plugins", allowImportingTsExtensions: false }`, with `files: ["src/plugins/public-api.ts"]` and `include: []`. **Empirically verified** (scratchpad experiment, repo's own `tsc` 6.0.3): this emits a **2-file flat tree** — `examples/plugins/public-api.d.ts` (the barrel: literally `export type { … } from "./types";`) + `examples/plugins/types.d.ts` (the full transitive mirror of `types.ts`). The npm script renames the barrel to the deliverable name: `"types:plugin": "tsc -p tsconfig.plugin-api.json && mv examples/plugins/public-api.d.ts examples/plugins/plugin-api.d.ts"`. Committed artifacts: **`examples/plugins/plugin-api.d.ts` + `examples/plugins/types.d.ts`** (the barrel's `export … from "./types"` resolves to the sibling). Do NOT add api-extractor / dts-bundle-generator. See OPEN QUESTIONS for the single-file caveat.

2. **Example bundling = root esbuild, `@tiptap/*` external, dist committed (USER DECISION).** Build command (per example `package.json` `build` script): `esbuild src/index.ts --bundle --format=esm --outfile=dist/index.mjs --external:@tiptap/core --external:@tiptap/pm`. In-repo the implementer invokes it via the root binary (`npx esbuild …` or `node_modules/.bin/esbuild …`) — **verified to work with zero example install** because `import type` lines are erased (neither example imports anything at runtime). The committed `dist/index.mjs` makes each example dev-loadable without a build. Examples still LIST `esbuild` + `typescript` as `devDependencies` for external authors who clone one standalone (documentary; not installed in-repo).

3. **Single branch + single PR (USER DECISION).** `feature/plugin-dev-environment-phase-e` (already created off `main` @ `a81d693`). Stay on it.

4. **Trust-model doc content (from the Phase D final review — MUST appear verbatim-in-substance in the docs security section):** `network` grants **UNRESTRICTED egress** — loopback / private / cloud-metadata IPs are all reachable (deliberate no-hard-sandbox posture; enables local LLMs like Ollama and dev servers); only `http`/`https` schemes allowed; `network.fetch` is **text-only** (`body: string`, binary corrupted via `utf8-lossy`) with **last-wins** duplicate request headers; 30s timeout, 10 MiB response cap. `storage` is **app-global** (`~/.baram/plugin-data/<id>/`, NOT per-vault) and **NOT symlink-hardened** (only a single-path-segment key guard). `ai` consumes the **user's configured key/quota**; privacy mode gates `complete`/`stream` only — **`listModels()` may still hit the cloud under privacy mode**. Capabilities are **install-time-approved intent declarations + API gating, NOT a hard sandbox**; only Shadow-DOM isolates the UI CSS layer. Registry installs are SHA-256-checksum-verified; dev-folder loads skip checksums (local trust).

5. **The barrel is type-only and re-export-only.** `public-api.ts` contains ONLY `export type { … } from "./types";` (and `export type { PluginEventName } from "./types";`). No `import`, no runtime export, no new interface. TS strict + `verbatimModuleSyntax` mandates `export type`. The public surface is exactly the interfaces/aliases a plugin author references; the internal-only types (`InstalledPlugin`, `LoadedPlugin`, `PluginModule`, `PluginStatus`, `RegistryEntry`, `RegistryIndex`) are NOT re-exported (they physically remain in the sibling `types.d.ts` but are not part of the consumed surface). Task 1 Step 1 pins the exact public list.

6. **`PluginEventName` is the ONE additive change to `types.ts`.** The spec/task require re-exporting an "event-name union" that does not exist today. Add — additively, alphabetically — `export type PluginEventName = "editor:ready" | "file:open" | "file:save";` to `types.ts` (these are the three literals emitted by `emitPluginEvent` — verified in `plugin-lifecycle.ts:95,100,105`). Do NOT tighten `EventsAPI.on(event: string, …)` to the union (that would be a runtime-contract change and could break existing plugins passing custom `emit` topics). The union is documentary + re-exported for author reference only.

7. **No live content-change event exists.** The only host-emitted plugin events are `editor:ready` (no args), `file:open(filePath)`, `file:save(filePath)` (`plugin-lifecycle.ts`). There is NO per-keystroke / `editor:change` event. Therefore `word-count` recomputes on `editor:ready` + `file:open` + `file:save` (i.e. on load/open/save), NOT on every keystroke. The docs `events` section lists exactly these three and states the limitation. (Flagged in OPEN QUESTIONS as a future `editor:change` enhancement — do NOT invent a runtime event in Phase E.)

8. **`styles.css` is NOT auto-loaded.** No loader code reads a plugin `styles.css` (verified — only `ctx.ui.addStyle(css)` injects CSS, into `document.head` / light DOM). So: (a) each example still ships a `styles.css` (task requirement + authorship convention + forward-compat with the spec §2.3 aspiration), but (b) the plugin actually injects its light-DOM CSS via `ctx.ui.addStyle(\`…\`)` with an inline string, and (c) Shadow-DOM panel/tab content is styled by appending a `<style>` element inside the `onMount(el)` container (because `addStyle` cannot cross the shadow boundary — verified in `extension-context.ts:462-463` comment + Phase C decision 7). The example `styles.css` mirrors the injected CSS with a header comment saying so. Docs state the boundary explicitly.

9. **`ai-summary` needs `editor:readonly` — deviation from the task's stated cap list, with reason.** The task lists ai-summary caps as `sidebar + settings + ai + storage`. But "summarize the current doc" requires reading document content, which needs `editor` or `editor:readonly` (else `ctx.editor` is a denied proxy that throws). Resolution: ai-summary declares **`["ai", "editor:readonly", "settings", "sidebar", "storage"]`** (5 caps). This is the exact kind of "capabilities must match what the code uses" cross-check the Self-Review demands. Noted as a deliberate correction. (Alternative rejected: summarizing user-pasted text instead of the doc — less compelling demo, and the task explicitly says "summarize the current doc".)

10. **Generated d.ts + examples live entirely OUTSIDE every app gate.** `examples/plugins/**` is not in `tsconfig` `include` (`["src"]`), not in knip `project` (`src/**`), not in the eslint invocation (`lint:ts` = `eslint src/`), not in prettier's glob (`format:check` = `src/**`). Task 1 additionally adds `examples/` to eslint's `ignores` array as belt-and-suspenders (protects editor-integrated / bare `eslint .` runs). No example file is required to satisfy the app's prettier/eslint/stylelint/knip/typecheck gates — but each example MUST independently typecheck against `plugin-api.d.ts` (its own `tsconfig.json`) and BUILD with esbuild; that is the Phase E acceptance test.

## Global Constraints

- Branch `feature/plugin-dev-environment-phase-e` (off `main` @ `a81d693`). Stay on it. NEVER `git commit --no-verify` (Husky `commit-msg` runs commitlint; `pre-commit` runs lint-staged; `pre-push` runs `cargo clippy --all-targets` + `npx knip`).
- **Repo `src/`/`scripts/` TS you touch** (only `src/plugins/public-api.ts` + `src/plugins/types.ts` in this phase) obeys the lint gate: `npx prettier --write <files>` + `npx eslint --fix --max-warnings=0 <files>` clean. TS strict + `verbatimModuleSyntax` (type-only `export type`/`import type`); perfectionist sorts interface/union members + exports **alphabetically/naturally** (see `eslint.config.js` — `perfectionist/sort-*`). kebab-case files.
- **Example plugin code is NOT under the app lint/typecheck** (Decision 10) — but it MUST typecheck against `plugin-api.d.ts` in its OWN `tsconfig.json` (`npx tsc -p examples/plugins/<name>/tsconfig.json --noEmit`) and BUILD (`esbuild …`). Verify BOTH per example.
- `npm run typecheck` (the 3-project chain: app `tsconfig.json` + `tsconfig.node.json` + `tsconfig.test.json`) must stay green and MUST NOT pick up `tsconfig.plugin-api.json` or `examples/**` (it doesn't — verify once).
- `npx knip` (pre-push) must stay clean: `public-api.ts` is auto-covered by the existing `entry: ["src/plugins/*.ts"]` glob (its re-exports count as entry roots). Do NOT introduce a `scripts/*.ts` helper for the emit (it would be flagged unused) — the npm command is a bare `tsc … && mv …` (Decision 1). Verify knip after Task 1.
- Commits: Conventional Commits, English, reference `§69`. Docs/git messages in English (repo policy).
- Generated d.ts are committed artifacts: after any future `types.ts` change, `npm run types:plugin` must be re-run + the diff committed (drift risk — see Task 5 + OPEN QUESTIONS).

## File Structure

- Create: `src/plugins/public-api.ts` — type-only re-export barrel (Decision 5).
- Modify: `src/plugins/types.ts` — add `PluginEventName` union ONLY (Decision 6).
- Create: `tsconfig.plugin-api.json` — emit config (Decision 1).
- Modify: `package.json` — add `"types:plugin"` script.
- Modify: `eslint.config.js` — add `"examples/"` to `ignores`.
- Modify: `.gitignore` — append example-dist negations (override global `dist/`).
- Create (generated, committed): `examples/plugins/plugin-api.d.ts` + `examples/plugins/types.d.ts`.
- Create: `examples/plugins/word-count/{baram-plugin.json,src/index.ts,package.json,tsconfig.json,styles.css,README.md,dist/index.mjs}`.
- Create: `examples/plugins/ai-summary/{baram-plugin.json,src/index.ts,package.json,tsconfig.json,styles.css,README.md,dist/index.mjs}`.
- Rewrite: `docs/plugin-development.md`.
- Create: `examples/plugins/README.md`.
- Preserve untouched: `examples/*.md` (Bellman-Ford, Dijkstra's Algorithm, Graph Theory, Priority Queue, README.md — the demo-vault notes).

---

### Task 1: Public API barrel + `plugin-api.d.ts` emit + npm script + CI wiring

**Files:**
- Create: `src/plugins/public-api.ts`
- Modify: `src/plugins/types.ts` (add `PluginEventName` — additive, alphabetical)
- Create: `tsconfig.plugin-api.json`
- Modify: `package.json` (add `types:plugin` script)
- Modify: `eslint.config.js` (`ignores` += `"examples/"`)
- Modify: `.gitignore` (append example-dist negations)
- Generated+committed: `examples/plugins/plugin-api.d.ts`, `examples/plugins/types.d.ts`

**Interfaces:**
- Produces: the public type surface as a single import specifier `../../plugin-api` (or `@/plugins/public-api` in-app). No runtime export.
- Consumed by: Tasks 2 & 3 (examples `import type … from "../../plugin-api"`), Task 4 (docs reference).

> **Why no vitest here:** the barrel is type-only — there is nothing to assert at runtime. Acceptance = `npm run types:plugin` emits the expected files, `npm run typecheck` + `npx knip` + `eslint src/` stay green, and the exact public export list matches `types.ts` (Step 1 checklist). The examples in Tasks 2–3 are the executable proof.

- [ ] **Step 1: Pin the exact public export list** (checklist — cross-check against `src/plugins/types.ts`)

Public (re-export through the barrel), grouped for review — final file sorts them per perfectionist:
```
AIAPI, AICompleteOptions, AIModel,
CommandRegisterOptions, CommandsAPI,
Disposable,
EditorAPI, EventsAPI, ExtensionContext,
FilesAPI,
NetworkAPI,
PluginCapability, PluginEventName, PluginFetchInit, PluginFetchResponse,
PluginManifest, PluginSettingsTabOptions, PluginSidebarPanelOptions,
StatusBarItem, StorageAPI,
TiptapExtensionDef,
UIAPI
```
Deliberately NOT public (internal — remain in `types.d.ts` sibling, not re-exported): `InstalledPlugin`, `LoadedPlugin`, `PluginModule`, `PluginStatus`, `RegistryEntry`, `RegistryIndex`, and the runtime const `CAPABILITY_DESCRIPTIONS` (a value, not a type — the barrel is type-only).
> Rationale notes: `TiptapExtensionDef` + `PluginSettingsTabOptions`/`PluginSidebarPanelOptions` ARE public (authors reference them when declaring `tiptapExtensions` or building panels/tabs). `PluginModule` is internal — authors write `export function activate(ctx)` directly and never import the module type.

- [ ] **Step 2: Add `PluginEventName` to `types.ts`** (Decision 6)

Insert alphabetically (near `PluginFetchInit`), additive only:
```ts
export type PluginEventName = "editor:ready" | "file:open" | "file:save";
```
Do NOT change `EventsAPI`. Run `npm run typecheck 2>&1 | tail -5` → still clean (additive).

- [ ] **Step 3: Write `src/plugins/public-api.ts`**

```ts
// §69 Plugin public API — type-only re-export barrel (single source of truth).
// Generated into examples/plugins/plugin-api.d.ts via `npm run types:plugin`.
// Type-only: verbatimModuleSyntax requires `export type`.
export type {
  AIAPI,
  AICompleteOptions,
  AIModel,
  CommandRegisterOptions,
  CommandsAPI,
  Disposable,
  EditorAPI,
  EventsAPI,
  ExtensionContext,
  FilesAPI,
  NetworkAPI,
  PluginCapability,
  PluginEventName,
  PluginFetchInit,
  PluginFetchResponse,
  PluginManifest,
  PluginSettingsTabOptions,
  PluginSidebarPanelOptions,
  StatusBarItem,
  StorageAPI,
  TiptapExtensionDef,
  UIAPI,
} from "./types";
```
Then `npx prettier --write src/plugins/public-api.ts src/plugins/types.ts` + `npx eslint --fix --max-warnings=0 src/plugins/public-api.ts src/plugins/types.ts`.

- [ ] **Step 4: Create `tsconfig.plugin-api.json`** (Decision 1 — verified layout)

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "declaration": true,
    "emitDeclarationOnly": true,
    "allowImportingTsExtensions": false,
    "rootDir": "src/plugins",
    "outDir": "examples/plugins"
  },
  "files": ["src/plugins/public-api.ts"],
  "include": []
}
```
> `include: []` + `files` override the base's `include: ["src"]` (child replaces, not merges). `rootDir` flattens output (else TS5011 + nested `emit/src/plugins/`). `emitDeclarationOnly` satisfies the base's `allowImportingTsExtensions` constraint even though we set it false here for the extensionless `./types` import.

- [ ] **Step 5: Add the npm script** (`package.json` scripts, alphabetical-ish near `tokens:*`)

```json
"types:plugin": "tsc -p tsconfig.plugin-api.json && mv examples/plugins/public-api.d.ts examples/plugins/plugin-api.d.ts",
```
> Bare `tsc … && mv …` — no `scripts/*.ts` helper (knip). `mv` is fine on macOS/Linux/CI-ubuntu (repo has no Windows dev target; noted in OPEN QUESTIONS).

- [ ] **Step 6: Generate + inspect the committed d.ts**

Run: `npm run types:plugin 2>&1 | tail -20`
Expected files: `examples/plugins/plugin-api.d.ts` (barrel: `export type { … } from "./types";`) + `examples/plugins/types.d.ts` (full mirror). Verify:
```
ls -la examples/plugins/*.d.ts
grep -c "export" examples/plugins/plugin-api.d.ts   # the curated re-export line(s)
```
Confirm `plugin-api.d.ts` re-exports exactly the Step-1 public names and `public-api.d.ts` no longer exists (renamed).

- [ ] **Step 7: Wire eslint ignore** (`eslint.config.js`)

Change the ignores block to include `examples/`:
```js
  {
    ignores: ["dist/", "examples/", "src-tauri/", "node_modules/"],
  },
```
> Belt-and-suspenders: `lint:ts` is `eslint src/` (already excludes examples), but this protects bare `eslint .` / editor integrations from choking on example code that imports EXTERNAL `@tiptap/*` and uses browser globals absent from the app resolver. Run `npx prettier --write eslint.config.js` + `npx eslint --fix --max-warnings=0 eslint.config.js`.

- [ ] **Step 8: Wire `.gitignore` negation** (CRITICAL — verified: global `dist/` at line ~506 silently drops `examples/plugins/*/dist/index.mjs`)

Append at the END of `.gitignore` (later patterns win — must be AFTER the `dist/` line):
```gitignore
# §69 Phase E: committed example plugin bundles (override global dist/ ignore)
!examples/plugins/**/dist/
!examples/plugins/**/dist/index.mjs
```
> Git rule: cannot re-include a file whose parent dir is excluded — hence the dir negation FIRST, then the file. Verify with `git add -n examples/plugins/word-count/dist/index.mjs` after Task 2 builds (must print `add '…'`). Belt-and-suspenders: `git add -f` the dist files on first commit if any doubt.

- [ ] **Step 9: Verify no app gate breaks**

Capture exit codes without a pipe (CLAUDE.md rule — `cmd > /tmp/x.log 2>&1; echo $?`):
- `npm run typecheck` → clean (proves `tsconfig.plugin-api.json` / examples are NOT in the chain).
- `npx knip --reporter compact > /tmp/knip.log 2>&1; echo $?` → clean (proves `public-api.ts` entry-covered, no new unused).
- `npx eslint src/ --max-warnings=0 > /tmp/esl.log 2>&1; echo $?` → clean.
- `npx prettier --check 'src/**/*.{ts,tsx,css}' > /tmp/pr.log 2>&1; echo $?` → clean.

- [ ] **Step 10: Commit**

```bash
git add src/plugins/public-api.ts src/plugins/types.ts tsconfig.plugin-api.json package.json eslint.config.js .gitignore examples/plugins/plugin-api.d.ts examples/plugins/types.d.ts
git commit -m "feat(§69): public plugin API barrel + plugin-api.d.ts emit + CI wiring"
```

---

### Task 2: `word-count` example plugin (canonical / minimal)

**Files (all under `examples/plugins/word-count/`):** `baram-plugin.json`, `src/index.ts`, `package.json`, `tsconfig.json`, `styles.css`, `README.md`, `dist/index.mjs` (committed).

**Interfaces:**
- Consumes: `../../plugin-api` types (Task 1). Capabilities `["editor:readonly", "events", "statusbar"]`.
- Behavior: registers a right-aligned status-bar item; recomputes word/char count from `ctx.editor.getContent()` on `editor:ready` / `file:open` / `file:save` (Decision 7 — no live change event).

- [ ] **Step 1: `baram-plugin.json`**

```json
{
  "id": "baram-word-count",
  "name": "Word Count",
  "description": "Shows the current document's word and character count in the status bar.",
  "version": "1.0.0",
  "author": "Baram",
  "license": "Apache-2.0",
  "main": "dist/index.mjs",
  "engines": { "baram": ">=0.3.0" },
  "capabilities": ["editor:readonly", "events", "statusbar"],
  "icon": "🔢",
  "keywords": ["word", "count", "statistics"]
}
```
> `main` points at the COMMITTED `dist/index.mjs` (dev-loadable without a build). `engines.baram >=0.3.0` (current app version, package.json). Caps EXACTLY match what the code uses (Self-Review cross-check).

- [ ] **Step 2: `src/index.ts`** (typechecks against `plugin-api.d.ts`)

```ts
import type { ExtensionContext, StatusBarItem } from "../../plugin-api";

const STYLE = `
.baram-word-count-item { font-variant-numeric: tabular-nums; opacity: 0.85; }
`;

function count(text: string): { chars: number; words: number } {
  const trimmed = text.trim();
  const words = trimmed ? trimmed.split(/\s+/).length : 0;
  return { chars: text.length, words };
}

export function activate(ctx: ExtensionContext): void {
  ctx.ui.addStyle(STYLE); // light-DOM (status bar); addStyle cannot reach Shadow-DOM
  const item: StatusBarItem = ctx.ui.showStatusBarItem("0 words", "right");

  const update = (): void => {
    const { chars, words } = count(ctx.editor.getContent());
    item.setText(`${words} words · ${chars} chars`);
  };

  update();
  // No live "change" event exists — recompute on load/open/save (see docs).
  ctx.events.on("editor:ready", update);
  ctx.events.on("file:open", update);
  ctx.events.on("file:save", update);
}

export function deactivate(): void {
  // Disposables (style + status-bar item + event listeners) auto-clean on unload.
}
```

- [ ] **Step 3: `tsconfig.json`** (self-contained, references the committed d.ts)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src", "../plugin-api.d.ts", "../types.d.ts"]
}
```
> `../plugin-api.d.ts` = `examples/plugins/plugin-api.d.ts` (one level up from `word-count/`). `DOM` lib covers `document`/`HTMLElement`; no `@types/node` → no example install needed.

- [ ] **Step 4: `package.json`** (documentary for external authors; not installed in-repo)

```json
{
  "name": "baram-word-count",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "esbuild src/index.ts --bundle --format=esm --outfile=dist/index.mjs --external:@tiptap/core --external:@tiptap/pm",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": { "esbuild": "^0.28.1", "typescript": "^6.0.3" }
}
```

- [ ] **Step 5: `styles.css`** (Decision 8 — mirrors the `addStyle` CSS; not auto-loaded)

```css
/* Not auto-loaded by Baram (no styles.css loader yet). The plugin injects this
   via ctx.ui.addStyle() in src/index.ts; kept here for reference/authorship. */
.baram-word-count-item {
  font-variant-numeric: tabular-nums;
  opacity: 0.85;
}
```

- [ ] **Step 6: `README.md`** — one-paragraph what/why + "Build: `npm run build`" + "Dev-load: Settings → Plugins → Developer → load this folder" + caps table.

- [ ] **Step 7: Build the committed `dist/index.mjs` + typecheck (root toolchain, no install)**

```
cd examples/plugins/word-count
../../../node_modules/.bin/esbuild src/index.ts --bundle --format=esm --outfile=dist/index.mjs --external:@tiptap/core --external:@tiptap/pm 2>&1 | tail -5
../../../node_modules/.bin/tsc -p tsconfig.json --noEmit 2>&1 | tail -10 && echo TYPECHECK_CLEAN
```
Expected: `dist/index.mjs` written (exports `activate`, `deactivate`); typecheck clean. If typecheck fails, the public d.ts is missing a type → fix Task 1's export list (this IS the acceptance test).

- [ ] **Step 8: Confirm the dist is git-trackable** (Task 1 Step 8 negation)

`git add -n examples/plugins/word-count/dist/index.mjs` → must print `add '…'`. If ignored, re-check `.gitignore` negation order.

- [ ] **Step 9: Commit**

```bash
git add examples/plugins/word-count
git commit -m "feat(§69): word-count example plugin (editor:readonly + statusbar + events)"
```

---

### Task 3: `ai-summary` example plugin (advanced: Shadow-DOM panel + settings + ai + storage)

**Files (all under `examples/plugins/ai-summary/`):** same 7-file set as Task 2.

**Interfaces:**
- Consumes: `../../plugin-api` types. Capabilities `["ai", "editor:readonly", "settings", "sidebar", "storage"]` (Decision 9 — `editor:readonly` added, noted).
- Behavior: a sidebar panel (Shadow-DOM `onMount(el)`) with a "Summarize" button → `ctx.ai.complete()` over `ctx.editor.getContent()`, renders the result, caches via `ctx.storage.write("last-summary.txt", …)`; on mount, shows the cached summary via `ctx.storage.read`. A settings tab (Shadow-DOM) persists a prompt-prefix/config via `ctx.storage.write("config.json", …)`.

- [ ] **Step 1: `baram-plugin.json`**

```json
{
  "id": "baram-ai-summary",
  "name": "AI Summary",
  "description": "Summarizes the current document with AI, in a sidebar panel; caches the last summary.",
  "version": "1.0.0",
  "author": "Baram",
  "license": "Apache-2.0",
  "main": "dist/index.mjs",
  "engines": { "baram": ">=0.3.0" },
  "capabilities": ["ai", "editor:readonly", "settings", "sidebar", "storage"],
  "icon": "✨",
  "keywords": ["ai", "summary", "llm"]
}
```

- [ ] **Step 2: `src/index.ts`** — key structural requirements (implementer writes full, lint-free TS):
  - `import type { ExtensionContext } from "../../plugin-api";`
  - Shadow-DOM styling: inside each `onMount(el)`, append a `<style>` element to `el` (NOT `addStyle` — Decision 8). CSS may use app tokens (`var(--color-text-default)` etc.) since custom properties inherit across the shadow boundary.
  - `addSidebarPanel({ id: "summary", title: "AI Summary", icon: "✨", onMount(el) { … }, onUnmount(el) { … } })`:
    - build DOM in `el`: a `<button>Summarize</button>`, a status `<div>`, an output `<div>`;
    - on mount: `const cached = await ctx.storage.read("last-summary.txt"); if (cached) output.textContent = cached;`
    - button click handler: read config prefix (`await ctx.storage.read("config.json")` → JSON.parse with try/catch, default prompt); `const doc = ctx.editor.getContent();` `const summary = await ctx.ai.complete(\`${prefix}\n\n${doc}\`, { maxTokens: 512 });` render + `await ctx.storage.write("last-summary.txt", summary);` wrap in try/catch → on error `ctx.ui`? (no `statusbar`/notification cap here — render error into the output div instead; do NOT call `showNotification` unless a `ui` cap is present — ai-summary HAS `sidebar` so `ui` object exists and `showNotification` is generic/un-gated per Phase C decision 4; using `ctx.ui.showNotification(msg, "error")` IS valid here — use it).
    - keep event listeners / DOM within `el`; the panel auto-disposes on unload.
  - `addSettingsTab({ id: "config", title: "AI Summary", onMount(el) { … } })`:
    - a labeled `<textarea>`/`<input>` for the prompt prefix + a Save button; Save → `await ctx.storage.write("config.json", JSON.stringify({ prefix }))`; load current value on mount via `ctx.storage.read`.
  - `export function activate(ctx)` registers both; `export function deactivate()` no-op (auto-clean).
  - CLAUDE.md: `ctx.ai.complete` is already buffered (no stream cleanup needed by the author); if the implementer chooses `ctx.ai.stream`, it must be inside try/catch (the host already does the `try/finally` cleanup internally).

- [ ] **Step 3: `tsconfig.json`** — identical to Task 2 Step 3 (include `src`, `../plugin-api.d.ts`, `../types.d.ts`).

- [ ] **Step 4: `package.json`** — identical shape to Task 2 Step 4 (`name: baram-ai-summary`).

- [ ] **Step 5: `styles.css`** — the shadow-injected CSS mirrored, with the Decision-8 header comment noting it is injected via a `<style>` in `onMount`, not auto-loaded.

- [ ] **Step 6: `README.md`** — what/why + "requires an AI provider configured in Settings → AI" + build/dev-load + caps table (explicitly note `editor:readonly` is needed to read the doc; `ai` + `network`? — NO network cap: `ai.complete` routes through the app's own LLM plumbing, not `network.fetch`; do NOT declare `network`).

- [ ] **Step 7: Build committed `dist/index.mjs` + typecheck** (root toolchain, as Task 2 Step 7). Expected clean. This exercises `ai`/`storage`/`sidebar`/`settings`/`editor:readonly` types → second acceptance test for the barrel.

- [ ] **Step 8: Confirm dist git-trackable** (`git add -n examples/plugins/ai-summary/dist/index.mjs`).

- [ ] **Step 9: Commit**

```bash
git add examples/plugins/ai-summary
git commit -m "feat(§69): ai-summary example plugin (sidebar Shadow-DOM + settings + ai + storage)"
```

---

### Task 4: Rewrite `docs/plugin-development.md` to the REAL API + trust-model section

**Files:** Rewrite `docs/plugin-development.md` (currently 257 lines, documents a stale partial API).

**Interfaces:** Prose only. Must match `src/plugins/types.ts` + `extension-context.ts` exactly. NOTE: `docs/**/*.md` is NOT in the prettier/eslint globs (no gate) but keep Markdown clean; `docs/user-guide.md` etc. are `?raw`-bundled — `plugin-development.md` is NOT bundled (safe to restructure freely).

- [ ] **Step 1: Fix the stale-API landmines** (delete/replace — verify NONE survive):
  - `context.ui` block currently shows `showStatusBarItem(text, alignment?): Disposable` → REPLACE with the real signatures (below). No `alignment` param name (it's `align`), status-bar returns `StatusBarItem` (`{ setText, dispose }`), NOT `Disposable`.
  - Add the missing methods: `addStyle`, `addSidebarPanel`, `addSettingsTab`, and `showNotification(message, type?)`.
  - Add the missing APIs entirely: `context.ai`, `context.network`, `context.storage`.

- [ ] **Step 2: Write the new structure** (sections, in order):
  1. **Overview** — what a Baram plugin is (dir + `baram-plugin.json` + ESM bundle); same-context Obsidian-style model (link the spec rationale briefly).
  2. **Quick Start** — template-based: copy `examples/plugins/word-count/` as a starting point; the file tree; `import type { ExtensionContext } from "./plugin-api";` (authors copy `plugin-api.d.ts` + `types.d.ts` next to their code — point at `examples/plugins/plugin-api.d.ts`); `npm run build` (esbuild); dev-load via the Developer section.
  3. **Manifest reference** — required/optional field tables (keep the accurate parts of the current doc); `main` may point at `dist/index.mjs`.
  4. **Capabilities** — full table of ALL 12 (`ai`, `commands`, `editor`, `editor:readonly`, `events`, `files`, `files:readonly`, `network`, `settings`, `sidebar`, `statusbar`, `storage`) with the real `CAPABILITY_DESCRIPTIONS` meanings; mark **`ai`, `network`** (and note `storage`, `files`) as sensitive; state accessing an undeclared API throws (denied proxy).
  5. **ExtensionContext API** — the REAL surface (types verbatim from `types.ts`):
     - `commands` — `register(id, handler, opts?: { title?; paletteVisible? }): Disposable` + `execute`; **Command Palette integration**: `paletteVisible: true` or a `title` exposes the command in the palette (namespaced `${pluginId}.${id}`).
     - `editor` — `getContent` / `setContent` (editor only) / `getSelection` / `insertText` (editor only). Note `getContent()` returns plain text.
     - `files` — `readFile` / `writeFile` (files only) / `listDir`.
     - `events` — `on(event, handler): Disposable` / `emit`. Available events: **`editor:ready`, `file:open`, `file:save` ONLY** (Decision 7) — explicitly state there is no per-keystroke change event yet; also mention `PluginEventName`.
     - `ui` — `showNotification(message, type?: "error" | "info" | "warning"): void`; `showStatusBarItem(text, align?: "left" | "right"): StatusBarItem` where `StatusBarItem = { setText(t): void; dispose(): void }`; `addStyle(css): Disposable` (light DOM only — **cannot reach Shadow-DOM panels**); `addSidebarPanel(opts): Disposable` and `addSettingsTab(opts): Disposable` (both Shadow-DOM `onMount(el)`/`onUnmount(el)`). Per-method gating: `showStatusBarItem`→`statusbar`, `addSidebarPanel`→`sidebar`, `addSettingsTab`→`settings`; `showNotification`/`addStyle` available whenever any `ui` cap exists.
     - `ai` — `complete(prompt, opts?: { maxTokens?; systemPrompt? }): Promise<string>`; `stream(prompt, opts, onToken): Promise<void>`; `listModels(): Promise<AIModel[]>`. Uses the user's configured provider/model/key.
     - `network` — `fetch(url, init?: { body?; headers?; method? }): Promise<{ body; headers; status }>`. http/https only, text-only body.
     - `storage` — `read(key)` / `write(key, value)` / `list()` / `remove(key)`; app-global per-plugin dir.
     - `subscriptions` — auto-disposed on unload.
  6. **Shadow-DOM UI isolation** — panels/tabs mount into an open shadow root; style shadow content by appending a `<style>` inside the `onMount(el)` element (NOT `addStyle`); CSS custom properties (app tokens) inherit across the boundary.
  7. **Command Palette integration** — how contributed commands appear + dispatch.
  8. **Tiptap Extension plugins** — keep; note app restart required (schema rebuild) + Reload won't apply schema-contributing plugins (spec §6.3).
  9. **Local development loop** — the Developer section (load local folder via `@tauri-apps/plugin-dialog`, Reload, open-folder, remove); dev folders skip checksums; restart needed for `tiptapExtensions`.
  10. **Using the public types** — `plugin-api.d.ts` (generated from `public-api.ts` via `npm run types:plugin`); copy it + `types.d.ts` next to your source; `import type { … } from "./plugin-api"`.
  11. **Bundling** — esbuild single-ESM, `@tiptap/core`/`@tiptap/pm` external.
  12. **Publishing to the registry** — keep but soften: the community registry repo is not yet live (Phase F); example `RegistryEntry` shape.
  13. **Trust model & security** — **MANDATED content (Decision 4)**: no hard sandbox (capabilities = install-time-approved intent + API gating, only Shadow-DOM isolates UI CSS); `network` unrestricted egress incl. loopback/private/metadata IPs, http/https only, text-only body, last-wins duplicate headers, 30s/10 MiB; `storage` app-global `~/.baram/plugin-data/<id>/`, not per-vault, not symlink-hardened; `ai` uses the user's key/quota, privacy mode gates `complete`/`stream` only (`listModels` may hit the cloud); SHA-256 checksums for registry installs, dev folders skip; "only install plugins you trust".
  14. **Timeouts & error handling** — keep (activate 5s, lifecycle 1s, error boundaries, console logs).

- [ ] **Step 3: Verify no stale strings survive**

```
grep -nE "alignment|showStatusBarItem\(text, align.*Disposable" docs/plugin-development.md   # expect NO alignment; StatusBarItem not Disposable
grep -n "storage" docs/plugin-development.md   # capability table + API present
grep -niE "trust|sandbox|loopback|metadata|privacy" docs/plugin-development.md   # trust-model present
```

- [ ] **Step 4: Commit**

```bash
git add docs/plugin-development.md
git commit -m "docs(§69): rewrite plugin-development guide to the real API + trust model"
```

---

### Task 5: `examples/plugins/README.md` + regen/drift note (+ optional CI smoke)

**Files:** Create `examples/plugins/README.md`.

- [ ] **Step 1: Write `examples/plugins/README.md`** — index of the two examples (what each demonstrates + caps), the shared `plugin-api.d.ts`/`types.d.ts` (regenerate with `npm run types:plugin` after any `src/plugins/types.ts` change — commit the diff), build instructions (`npm run build` per example, or root `npx esbuild …`), and dev-load instructions (Settings → Plugins → Developer). State that `dist/index.mjs` is committed on purpose (immediate dev-load) and is exempted from the global `dist/` gitignore.

- [ ] **Step 2: (OPTIONAL — flag, do not force) CI smoke + drift guard.** Spec §10 wants a CI check that `examples/plugins/word-count` builds. If added, keep it minimal and out of the Rust/knip gates: e.g. a `package.json` script `"types:plugin:check": "npm run types:plugin && git diff --exit-code examples/plugins/*.d.ts"` (fails if the committed d.ts is stale) and an example-build step. **Editing `.github/workflows/ci.yml` is a risk** (see OPEN QUESTIONS) — if the executor is not confident, DEFER and document the manual regen step in the README instead. Do NOT let this task break the existing CI contract.

- [ ] **Step 3: Final full verification** (evidence before completion)

Capture exit codes without pipes:
- `npm run typecheck` → clean.
- `npx knip --reporter compact` → clean.
- `npx eslint src/ --max-warnings=0` → clean.
- `npx prettier --check 'src/**/*.{ts,tsx,css}'` → clean.
- Rebuild both examples + typecheck each against the d.ts → clean; `git status` shows committed `dist/index.mjs` for both.
- `npm test > /tmp/e.log 2>&1; echo $?` → existing suite still green (Phase E touches no runtime, so no test delta expected; confirm no accidental breakage from the `PluginEventName` add).

- [ ] **Step 4: Commit + open PR**

```bash
git add examples/plugins/README.md package.json
git commit -m "docs(§69): examples/plugins index + type-regen note"
```
Then open the single PR `feature/plugin-dev-environment-phase-e` → `main` with the standard PR body (motivation, design decisions incl. the 2-file d.ts tree + gitignore negation, architecture, implementation, test results, checklist). Push in the background (pre-push cargo cold ~5–7 min).

---

## Self-Review

**Spec §7 coverage (§7.1 types / §7.2 examples / §7.3 docs) + §11 row E:**
- §7.1 `public-api.ts` barrel (single source) + `plugin-api.d.ts` emit via `tsc --emitDeclarationOnly` + npm script — Task 1. ✓
- §7.2 `examples/plugins/word-count/` (editor:readonly + statusbar + events, dist committed) + `examples/plugins/ai-summary/` (sidebar Shadow-DOM + settings + ai + storage [+ editor:readonly]) — Tasks 2, 3. Existing `examples/*.md` demo notes preserved. ✓
- §7.3 `docs/plugin-development.md` rewrite incl. every real API + trust model — Task 4. ✓

**Public-api barrel exports EVERY public type an author needs (cross-checked against `types.ts`):** `ExtensionContext`, `PluginManifest`, `PluginCapability`, `Disposable`, all 8 `*API` interfaces (`CommandsAPI`/`EditorAPI`/`EventsAPI`/`FilesAPI`/`UIAPI`/`AIAPI`/`NetworkAPI`/`StorageAPI`), option/record types (`AICompleteOptions`, `AIModel`, `CommandRegisterOptions`, `PluginFetchInit`, `PluginFetchResponse`, `StatusBarItem`, `PluginSidebarPanelOptions`, `PluginSettingsTabOptions`, `TiptapExtensionDef`), and the event-name union (`PluginEventName`, newly added). Internal types (`InstalledPlugin`/`LoadedPlugin`/`PluginModule`/`PluginStatus`/`RegistryEntry`/`RegistryIndex`) deliberately excluded from the barrel. The two examples' typecheck against the emitted d.ts is the executable proof.

**Examples BUILD + manifest caps match code:** word-count caps `["editor:readonly","events","statusbar"]` ↔ uses `editor.getContent`, `events.on`, `ui.showStatusBarItem` (`ui` exists via `statusbar`). ai-summary caps `["ai","editor:readonly","settings","sidebar","storage"]` ↔ uses `ai.complete`, `editor.getContent`, `ui.addSettingsTab` (settings), `ui.addSidebarPanel` (sidebar), `storage.*`; `ui.showNotification` is generic (available via any `ui` cap). Both build committed `dist/index.mjs` with root esbuild (no install) and typecheck against `plugin-api.d.ts`.

**Docs match the REAL current API (no stale surface):** `showStatusBarItem` returns `StatusBarItem` (not `Disposable`), param is `align` (not `alignment`); `addStyle`/`addSidebarPanel`/`addSettingsTab`/`showNotification(type)` documented; `ai`/`network`/`storage` documented; capability table has all 12 incl. `storage`; events limited to the 3 real ones; trust-model section complete per Decision 4. Task 4 Step 3 greps enforce this.

**CI-integration items all handled:** eslint — `examples/` added to `ignores` (belt-and-suspenders; real gate `lint:ts`/`lint-staged` is already `src/`-scoped). knip — `public-api.ts` auto-covered by `src/plugins/*.ts` entry; NO `scripts/*.ts` helper (bare `tsc && mv`); `examples/**` out of `project`. tsconfig — `tsconfig.plugin-api.json` is a standalone emit config NOT in the `typecheck` chain; `examples/**` out of app `include`; `npm run typecheck` unaffected (verified path). prettier/stylelint — examples out of the `src/**` globs; committed `dist/` prettier-ignored via global `dist/`; examples formatted for cleanliness but ungated. **`.gitignore` negation** for `examples/plugins/**/dist/index.mjs` (the critical, empirically-confirmed catch — global `dist/` would otherwise silently drop the committed bundle).

**Placeholder scan:** No TODO/stub placeholders. Every code block is concrete and verified (tsc emit tree, esbuild bundle, example typecheck, gitignore negation all tested in scratchpad). ai-summary `src/index.ts` is specified structurally (Task 3 Step 2) rather than as a full literal — the executor writes the complete lint-clean TS; the structure + type usage is fully pinned.

**Trust-model doc completeness:** network unrestricted egress + http/https + text-only + last-wins headers + 30s/10 MiB; storage app-global + not-symlink-hardened; ai user-key/quota + privacy gates complete/stream only (listModels may hit cloud); capabilities ≠ sandbox; Shadow-DOM = UI CSS isolation only; checksums for registry, dev skips. All present (Task 4 Step 2.13, Decision 4).

## OPEN QUESTIONS (flagged — not guessed)

1. **Single-file `plugin-api.d.ts` is not achievable without a bundler.** Verified: `tsc --emitDeclarationOnly` on the re-export barrel emits `plugin-api.d.ts` (curated re-exports) + a sibling `types.d.ts` (full mirror, incl. internal types). The barrel's `export … from "./types"` REQUIRES the sibling. A truly self-contained single file needs `dts-bundle-generator`/`api-extractor` (a new dep — out of scope per Decision 1). **Recommendation:** ship the 2-file tree and point authors at the barrel (the plan does this). Internal types physically present in `types.d.ts` are NOT surfaced through the barrel; curating them out would require inverting the source-of-truth (define public types in `public-api.ts`) — a larger change than "types/docs/examples only". Confirm this 2-file outcome is acceptable, else authorize a bundler dep.
2. **`mv` in the npm script is POSIX-only.** Fine for macOS/Linux/CI-ubuntu (this repo's targets). If a Windows dev environment is ever required, the rename needs a `node -e` one-liner (which would then be a knip/lint consideration). Confirm no Windows dev target (assumed none).
3. **d.ts drift guard.** The committed `plugin-api.d.ts`/`types.d.ts` will silently go stale if a future phase edits `src/plugins/types.ts` without re-running `npm run types:plugin`. Task 5 documents the manual regen; an optional CI `git diff --exit-code` guard is proposed but deferred to avoid editing `ci.yml`. Decide whether the CI drift-guard is in-scope for Phase E or a follow-up.
4. **No `editor:change` event.** word-count cannot live-update on typing (Decision 7). Confirm updating on `editor:ready`/`file:open`/`file:save` is acceptable for the canonical example, or whether a host `editor:change` event should be added (that would be a runtime change → NOT Phase E; likely a small Phase A/B follow-up).
5. **CI smoke for example build (spec §10).** Deferred/optional in Task 5. If wanted in Phase E, it requires touching `.github/workflows/ci.yml` (contract-sensitive per CLAUDE.md). Confirm in-scope vs Phase F.
