# Plugin Dev Environment — Phase F (Registry schema + seed) Implementation Plan

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal (spec §8):** Finalize the `RegistryEntry`/`RegistryIndex` schema so it round-trips correctly between Rust and TS, commit a valid seed `registry/index.json` (the two example plugins, `downloadUrl`/`checksum` marked TBD), keep `DEFAULT_REGISTRY_URL`, and document that an external `baram-community` registry repo is a non-goal. This is the FINAL phase (A–F) of the §69 plugin dev environment.

## Key Design Decisions

1. **Registry serde reconciliation = per-field `#[serde(rename)]` (USER DECISION), matching `PluginManifest`.** The Rust registry structs currently use snake_case field names with NO rename, but the TS types + marketplace read camelCase (`entry.downloadUrl`) — so a fetched registry today would give `downloadUrl === undefined` and break install (latent bug; never hit because `DEFAULT_REGISTRY_URL` points at a non-existent repo). The established repo convention (verified: `PluginManifest.tiptap_extensions` uses `#[serde(default, rename = "tiptapExtensions")]`; there is NO `rename_all` anywhere in `plugin/mod.rs`) is per-field rename. Apply it to the ONLY two camelCase-divergent fields: `RegistryEntry.download_url` → `#[serde(rename = "downloadUrl")]`; `RegistryIndex.updated_at` → `#[serde(default, rename = "updatedAt")]`. All other registry fields are single words (snake==camel). Wire format becomes camelCase — matching the TS contract + the `baram-plugin.json` manifest convention. NO TS change. (A struct-level `rename_all = "camelCase"` is behaviorally identical here but was rejected as a lone stylistic outlier vs the PluginManifest precedent.)
2. **Seed uses the examples' REAL ids.** `examples/plugins/word-count/baram-plugin.json` → `id: "baram-word-count"`; ai-summary → `id: "baram-ai-summary"`. The seed's per-entry fields (name/description/version/author/license/capabilities/engines/icon/keywords) are copied from those manifests. `downloadUrl` + `checksum` are PLACEHOLDERS (the plugins aren't published as downloadable ZIPs yet) — use `downloadUrl: "TBD"` and `checksum: "TBD"` (documented as placeholders; a real registry would host built ZIPs + real SHA-256).
3. **The seed must deserialize via the REAL path.** `pluginFetchRegistry` → Rust `fetch_registry` → `serde_json::from_str::<RegistryIndex>`. The acceptance test for the seed is a Rust test that reads the committed `registry/index.json` and parses it into `RegistryIndex` with both entries present and `download_url` populated from the `downloadUrl` JSON key (proving the rename works end-to-end on the actual committed file).
4. **`DEFAULT_REGISTRY_URL` unchanged** (`src/stores/system/plugin.ts:42` → the aspirational `baram-community/plugin-registry` URL). Documented as aspirational; local testing = point the `registryUrl` setting at the committed `registry/index.json` (file path / local server).
5. **External `baram-community` repo = non-goal.** Document only (in the registry section of `docs/plugin-development.md`), do NOT create/reference an external repo as required.

## Global Constraints

- Branch `feature/plugin-dev-environment-phase-f` (created off `main` @ `30c0d4e`). Stay on it.
- Rust: `Result<T, String>`; per-field `#[serde(rename)]` (NOT `rename_all`); cargo test + `cargo clippy -p baram --all-targets` clean; pre-push runs clippy + knip.
- No TS type change (RegistryEntry/RegistryIndex TS already camelCase). If a TS/marketplace tweak seems needed, STOP + report (it shouldn't be).
- `registry/index.json` is a data file at repo root; prettier may format it — let it. It is NOT under tsconfig/knip.
- Lint gate on any TS/config touched. NEVER `git commit --no-verify` (commitlint subject-case).
- Commits: Conventional Commits, English, `§69`.

## File Structure

- Modify: `src-tauri/src/plugin/mod.rs` — add `#[serde(rename=...)]` to `RegistryEntry.download_url` + `RegistryIndex.updated_at`; add a `mod tests` case deserializing the committed `registry/index.json` (or a camelCase fixture) into `RegistryIndex`.
- Create: `registry/index.json` — the seed (RegistryIndex, 2 entries, camelCase, TBD placeholders).
- Modify: `docs/plugin-development.md` — registry section (how the registry works, local-testing via `registryUrl`, `baram-community` non-goal, TBD placeholders). (The "Publishing to the Registry" section already exists — update it, don't duplicate.)

---

### Task 1: Reconcile registry serde naming (per-field rename) + Rust round-trip test

**Files:** Modify `src-tauri/src/plugin/mod.rs` (RegistryEntry @78, RegistryIndex @101, `mod tests`).

- [ ] **Step 1: Write the failing/again-green Rust test.** In `plugin/mod.rs`'s `mod tests`, add `test_registry_index_deserializes_camelcase`: a `const JSON: &str` with a camelCase `RegistryIndex` (one entry, `"downloadUrl": "https://x/p.zip"`, `"updatedAt": "2026-01-01"`, all required RegistryEntry fields), `serde_json::from_str::<RegistryIndex>(JSON).unwrap()`, assert `idx.plugins[0].download_url == "https://x/p.zip"` and `idx.updated_at == Some("2026-01-01")`. (Before the rename this FAILS — `download_url` would be empty/error since the JSON key is `downloadUrl`.)
- [ ] **Step 2: Run it — confirm it FAILS** (`cargo test -p baram plugin registry 2>&1 | tail`). Expected: deserialize error (missing field `download_url`) OR empty field.
- [ ] **Step 3: Add the per-field renames.** `RegistryEntry`: `#[serde(rename = "downloadUrl")] pub download_url: String,`. `RegistryIndex`: `#[serde(default, rename = "updatedAt")] pub updated_at: Option<String>,` (keep the existing `#[serde(default)]` behavior). Do NOT add `rename_all`. Do NOT touch other fields.
- [ ] **Step 4: Run tests + clippy.** `cargo test -p baram plugin 2>&1 | tail -20` (new test PASSES + existing pass), `cargo clippy -p baram --all-targets 2>&1 | tail` (clean).
- [ ] **Step 5: Commit.** `git commit -m "fix(§69): registry structs (de)serialize camelCase downloadUrl/updatedAt"`

---

### Task 2: Seed `registry/index.json` + verify it deserializes via the Rust path

**Files:** Create `registry/index.json`; Modify `src-tauri/src/plugin/mod.rs` (`mod tests` — add a test reading the committed seed).

- [ ] **Step 1: Write the seed** `registry/index.json` — a `RegistryIndex`:
  - `updatedAt`: a fixed ISO date string.
  - `plugins`: two `RegistryEntry` (camelCase keys), copying from the example manifests:
    - `baram-word-count`: name "Word Count", description/version/author/license/engines/icon/keywords from `examples/plugins/word-count/baram-plugin.json`; `capabilities: ["editor:readonly","events","statusbar"]`; `downloadUrl: "TBD"`; `checksum: "TBD"`.
    - `baram-ai-summary`: likewise from `examples/plugins/ai-summary/baram-plugin.json`; `capabilities: ["ai","editor:readonly","settings","sidebar","storage"]`; `downloadUrl: "TBD"`; `checksum: "TBD"`.
  - Every REQUIRED `RegistryEntry` field present (id/name/description/version/author/license/downloadUrl/checksum/capabilities/engines). Optional: icon/keywords included; downloads/repository/homepage omitted (serde default).
- [ ] **Step 2: Write the acceptance test** in `plugin/mod.rs` `mod tests`: `test_committed_registry_seed_deserializes` — read the repo file (`include_str!("../../../registry/index.json")` — verify the relative path from `plugin/mod.rs` to repo-root `registry/index.json`; adjust `../` depth as needed), `serde_json::from_str::<RegistryIndex>(SEED).unwrap()`, assert `plugins.len() == 2`, the two ids are `baram-word-count` + `baram-ai-summary`, and each `download_url == "TBD"` (proving the committed seed parses through the real deserializer with the rename applied).
- [ ] **Step 3: Run tests + clippy** (`cargo test -p baram plugin 2>&1 | tail -20` PASS incl. the seed test; clippy clean). Also `git add registry/index.json` and confirm it stages (not ignored).
- [ ] **Step 4: Commit.** `git commit -m "feat(§69): seed registry/index.json (word-count + ai-summary, TBD download)"`

---

### Task 3: Document the registry (local testing + baram-community non-goal) + keep DEFAULT_REGISTRY_URL

**Files:** Modify `docs/plugin-development.md` (the existing "Publishing to the Registry" section).

- [ ] **Step 1: Update the registry docs.** In `docs/plugin-development.md`'s registry/publishing section, document accurately: the `RegistryIndex`/`RegistryEntry` JSON shape (camelCase, incl. `downloadUrl`/`checksum`); that Baram fetches the registry from the `registryUrl` setting (default `DEFAULT_REGISTRY_URL` = the aspirational `baram-community/plugin-registry` — state it is NOT yet created, an explicit non-goal); how to TEST the marketplace locally by pointing `registryUrl` at the committed `registry/index.json` (file path / a local static server); that the in-repo seed's `downloadUrl`/`checksum` are `"TBD"` placeholders (a real published entry needs a hosted ZIP + real SHA-256, which registry install verifies). Reference `registry/index.json` as the canonical seed/example. Do NOT change `DEFAULT_REGISTRY_URL`.
- [ ] **Step 2: Verify.** `grep -niE "baram-community|registryUrl|TBD|downloadUrl|checksum|non-goal|not yet" docs/plugin-development.md` shows the new content; `npx prettier --write docs/plugin-development.md`; Husky passes.
- [ ] **Step 3: Commit.** `git commit -m "docs(§69): registry schema + seed + local-testing + baram-community non-goal"`

---

## Self-Review

**Spec §8 coverage:** schema finalized (per-field rename reconciles Rust↔TS — Task 1) ✓; valid seed `registry/index.json` with 2 entries + TBD downloads (Task 2) ✓; `DEFAULT_REGISTRY_URL` kept + local-testing documented (Task 3) ✓; `baram-community` external repo = documented non-goal (Task 3) ✓.
**Round-trip correctness:** the rename is proven by a Rust test on a camelCase fixture (Task 1) AND on the actual committed seed file (Task 2), through the real `serde_json::from_str::<RegistryIndex>` used by `fetch_registry`. TS unchanged (already camelCase; marketplace reads `entry.downloadUrl`).
**Consistency:** per-field `#[serde(rename)]` matches the existing `PluginManifest.tiptap_extensions` precedent; no `rename_all` introduced.
**Placeholder honesty:** `downloadUrl`/`checksum` = `"TBD"`, documented as placeholders (not fake URLs implying a live download).
**Out of scope:** creating the external `baram-community` repo; hosting real plugin ZIPs; wiring `registryUrl` file-load UI beyond what exists. Follow-ups carried from Phase E (CI drift-guard for `plugin-api.d.ts`) remain separate.
