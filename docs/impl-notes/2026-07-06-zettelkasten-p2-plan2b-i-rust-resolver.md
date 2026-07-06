# Zettelkasten P2 — Plan 2b-i: Rust ID-based link resolver + backlinks (§95, backend)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Rust link index resolve `[[ID]]` wikilinks (target = a timestamp id) to the id-prefixed note file regardless of subfolder, and compute backlinks by id — so the existing backlinks panel + graph work for the Zettelkasten `[[ID]]` scheme (decision B).

**Architecture:** The in-memory `LinkIndex` (src-tauri/src/index/mod.rs) resolves targets via stem/relative maps. Add an `id_map` (id → absolute path) populated from note filename id-prefixes, consult it first when a target looks like an id, and union id-keyed backlinks. No IPC changes; no vaultType branching — id resolution only fires for `\d{12,14}` targets that match an id-prefixed file, so general vaults (no id-prefixed files) are unaffected.

**Tech Stack:** Rust (in-memory index, `cargo test`).

**Design spec:** `docs/design/part13-zettelkasten-space.md` §95 (resolver requirement) + §13.10 (Rust). Frontend live-title/autocomplete/B2/New-from-selection/export are Plan 2b-ii. Prereq: Plan 2a landed (notes are `notes/{id} {title}.md` / `inbox/{id}.md`; links will be `[[ID]]`).

## Global Constraints

- Rust: keep existing `#[serde]` derives; custom errors via `thiserror`; `cargo fmt` + `clippy -D warnings` clean.
- The id scheme: a note's id is the leading `\d{12,14}` run of its **filename stem** (permanent `202607051530 원자적 노트.md` → `202607051530`; fleeting `202607051530.md` → `202607051530`). A file whose stem has no such prefix has no id.
- id resolution must NOT change behavior for non-id targets or general vaults: for a target that is not a bare id-pattern, or when no id_map entry exists, resolution falls through to the existing stem/relative logic unchanged.
- Existing resolver tests (`normalizer.rs`, `mod.rs` tests) must stay green — behavior-preserving for `[[name]]`/`[[path/name]]`.
- Tests: `cd src-tauri && cargo test`. Baseline: cargo **269 passed | 4 ignored**, `cargo clippy -- -D warnings` + `cargo fmt --check` clean.
- Conventional Commits, lowercase imperative subject, ≤100 chars (commitlint), keep `§` refs.

---

## File Structure

**Modified:**
- `src-tauri/src/index/normalizer.rs` — add `extract_id_from_stem` / `is_id_target` helpers.
- `src-tauri/src/index/mod.rs` — add `id_map` field; populate in `register_file_path`; clear in `build`/`remove_file`; consult in `resolve_target_from_map`; union in `get_backlinks`.

No new files; no IPC/schema changes.

---

## Task 1: ID extraction helpers (normalizer)

**Files:**
- Modify: `src-tauri/src/index/normalizer.rs`
- Test: same file's `#[cfg(test)] mod tests`

**Interfaces:**
- Produces:
  - `pub(crate) fn extract_id_from_stem(stem: &str) -> Option<String>` — returns the leading `\d{12,14}` run of a filename stem (the part before the first space or end), else None. `"202607051530 원자적 노트"` → `Some("202607051530")`; `"202607051530"` → `Some("202607051530")`; `"architecture"` → `None`; `"2026"` (too short) → `None`.
  - `pub(crate) fn is_id_target(target_normalized: &str) -> bool` — true iff the whole normalized target is a `\d{12,14}` run (a bare id link like `[[202607051530]]`).

- [ ] **Step 1: Write the failing test**

Add to `normalizer.rs` `mod tests`:

```rust
#[test]
fn test_extract_id_from_stem() {
    assert_eq!(extract_id_from_stem("202607051530 원자적 노트"), Some("202607051530".to_string()));
    assert_eq!(extract_id_from_stem("202607051530"), Some("202607051530".to_string()));
    assert_eq!(extract_id_from_stem("20260705153012 note"), Some("20260705153012".to_string()));
    assert_eq!(extract_id_from_stem("architecture"), None);
    assert_eq!(extract_id_from_stem("2026 draft"), None); // too short
    assert_eq!(extract_id_from_stem(""), None);
}

#[test]
fn test_is_id_target() {
    assert!(is_id_target("202607051530"));
    assert!(is_id_target("20260705153012"));
    assert!(!is_id_target("202607051530 원자적 노트")); // has trailing text
    assert!(!is_id_target("architecture"));
    assert!(!is_id_target("2026")); // too short
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test index::normalizer`
Expected: FAIL — `extract_id_from_stem`/`is_id_target` not found.

- [ ] **Step 3: Implement (no regex crate — hand-rolled digit scan)**

Add to `normalizer.rs`:

```rust
/// Extract the leading timestamp-id run (12–14 digits) from a filename stem.
/// The id is the run of leading ASCII digits before the first space (or end),
/// accepted only when its length is 12–14.
pub(crate) fn extract_id_from_stem(stem: &str) -> Option<String> {
    let head = stem.split(' ').next().unwrap_or(stem);
    if head.len() >= 12 && head.len() <= 14 && head.bytes().all(|b| b.is_ascii_digit()) {
        Some(head.to_string())
    } else {
        None
    }
}

/// True iff the whole normalized target is a bare 12–14 digit id (e.g. `[[202607051530]]`).
pub(crate) fn is_id_target(target_normalized: &str) -> bool {
    target_normalized.len() >= 12
        && target_normalized.len() <= 14
        && target_normalized.bytes().all(|b| b.is_ascii_digit())
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src-tauri && cargo test index::normalizer`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/index/normalizer.rs
git commit -m "feat(zettelkasten §95): add id-extraction helpers to the link normalizer"
```

---

## Task 2: id_map field + lifecycle (populate / clear)

**Files:**
- Modify: `src-tauri/src/index/mod.rs`
- Test: `mod.rs` `#[cfg(test)] mod tests`

**Interfaces:**
- Consumes: `extract_id_from_stem`, `normalize_file_path` (Task 1 + existing).
- Produces: a private field `id_map: HashMap<String, String>` (id → absolute path), populated in `register_file_path`, cleared in `build` and maintained in `remove_file`. Add a test-visible accessor `#[cfg(test)] pub(crate) fn id_map_len(&self) -> usize`.

- [ ] **Step 1: Write the failing test**

Add to `mod.rs` `mod tests`:

```rust
#[test]
fn test_id_map_populated_and_cleared() {
    let mut index = LinkIndex::new();
    index.root_path = Some("/z".to_string());
    index.register_file_path("/z/notes/202607051530 원자적 노트.md", "/z");
    index.register_file_path("/z/inbox/202607051531.md", "/z");
    index.register_file_path("/z/notes/architecture.md", "/z"); // no id
    assert_eq!(index.id_map_len(), 2);
    // resolve helper sees the id
    assert_eq!(
        index.resolve_target_from_map("202607051530"),
        Some("/z/notes/202607051530 원자적 노트.md".to_string())
    );
    index.remove_file("/z/notes/202607051530 원자적 노트.md");
    assert_eq!(index.id_map_len(), 1);
}
```

(This test also depends on Task 3's resolver change; if running Task 2 alone, split the resolve assertion into Task 3. Keep the `id_map_len` assertions here.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test test_id_map_populated_and_cleared`
Expected: FAIL — no `id_map` / `id_map_len`.

- [ ] **Step 3: Add the field + lifecycle**

In `mod.rs`:
1. Add to the `LinkIndex` struct (after `relative_map`):
   ```rust
   /// Note id (12–14 digit filename prefix) → absolute file path (Zettelkasten `[[ID]]` links)
   id_map: HashMap<String, String>,
   ```
2. In `build`, add to the clear block: `self.id_map.clear();`
3. In `register_file_path`, after the relative_map block, add:
   ```rust
   // Register id → path for [[ID]] resolution (Zettelkasten)
   let stem = normalize_file_path(file_path);
   if let Some(id) = extract_id_from_stem(&stem) {
       self.id_map.insert(id, file_path.to_string());
   }
   ```
   (Note: `normalize_file_path` lowercases, but ids are digits so case is irrelevant. `stem` may already be computed at the top of `register_file_path` — reuse it, do not shadow-recompute if a binding exists.)
4. In `remove_file`, add: `self.id_map.retain(|_, v| v != file_path);`
5. Add the test accessor at the bottom of the `impl LinkIndex` (or in the tests-only area):
   ```rust
   #[cfg(test)]
   pub(crate) fn id_map_len(&self) -> usize {
       self.id_map.len()
   }
   ```
6. Import the helper: ensure `use ...normalizer::{... extract_id_from_stem ...}` (add to the existing normalizer import list in mod.rs).

- [ ] **Step 4: Run test (id_map_len parts) to verify it passes**

Run: `cd src-tauri && cargo test test_id_map_populated_and_cleared`
Expected: the `id_map_len` assertions PASS. (The `resolve_target_from_map` assertion passes after Task 3 — if it fails now, that line belongs to Task 3; move it there.)

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/index/mod.rs
git commit -m "feat(zettelkasten §95): index note ids (id_map) for wikilink resolution"
```

---

## Task 3: id-based resolution in resolve_target_from_map

**Files:**
- Modify: `src-tauri/src/index/mod.rs` (`resolve_target_from_map`)
- Test: `mod.rs` `mod tests`

**Interfaces:**
- Consumes: `is_id_target` (Task 1), `id_map` (Task 2).
- Behavior: when `target_normalized` is a bare id and `id_map` has it, return that path FIRST (before relative/stem lookup). Otherwise unchanged.

- [ ] **Step 1: Write the failing test**

Add to `mod.rs` `mod tests`:

```rust
#[test]
fn test_resolve_id_target_across_subfolders() {
    let mut index = LinkIndex::new();
    index.root_path = Some("/z".to_string());
    index.register_file_path("/z/notes/202607051530 원자적 노트.md", "/z");
    // [[202607051530]] resolves to the id-prefixed file in the subfolder
    assert_eq!(
        index.resolve_target_from_map("202607051530"),
        Some("/z/notes/202607051530 원자적 노트.md".to_string())
    );
    // a non-id target is unaffected (existing stem/relative behavior)
    index.register_file_path("/z/architecture.md", "/z");
    assert_eq!(
        index.resolve_target_from_map("architecture"),
        Some("/z/architecture.md".to_string())
    );
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test test_resolve_id_target_across_subfolders`
Expected: FAIL — `[[202607051530]]` currently returns None (stem is `"202607051530 원자적 노트"`, not `"202607051530"`).

- [ ] **Step 3: Add id lookup as the first resolution step**

In `resolve_target_from_map`, insert BEFORE the relative_map step:

```rust
        // 0) Zettelkasten [[ID]] — bare timestamp id resolves via id_map (subfolder-agnostic)
        if is_id_target(target_normalized) {
            if let Some(path) = self.id_map.get(target_normalized) {
                return Some(path.clone());
            }
        }
```

Import `is_id_target` (add to the normalizer `use` in mod.rs).

- [ ] **Step 4: Run test to verify it passes + existing resolver tests green**

Run: `cd src-tauri && cargo test index::`
Expected: PASS — new test passes; `test_backlinks_lookup` and existing resolver/graph tests still pass (non-id targets unchanged).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/index/mod.rs
git commit -m "feat(zettelkasten §95): resolve [[ID]] wikilinks to id-prefixed notes"
```

---

## Task 4: id-based backlinks in get_backlinks

**Files:**
- Modify: `src-tauri/src/index/mod.rs` (`get_backlinks`)
- Test: `mod.rs` `mod tests`

**Interfaces:**
- Consumes: `extract_id_from_stem` (Task 1), `normalize_file_path` (existing), the `incoming` map (keyed by `normalize_target`).
- Behavior: backlinks for a note file are the union of `incoming[stem]` (existing) and `incoming[id]` (new) where `id = extract_id_from_stem(stem)`. Because zettel links are `[[ID]]`, they land in `incoming[id]`; existing `[[name]]` links land in `incoming[stem]`. Dedup by (source_path, line).

- [ ] **Step 1: Write the failing test**

Add to `mod.rs` `mod tests`:

```rust
#[test]
fn test_backlinks_by_id() {
    let mut index = LinkIndex::new();
    index.root_path = Some("/z".to_string());
    index.register_file_path("/z/notes/202607051530 원자적 노트.md", "/z");
    index.register_file_path("/z/notes/202607051600 다른 노트.md", "/z");
    // "다른 노트" links to the first note via [[202607051530]]
    index.update_file_from_content(
        "/z/notes/202607051600 다른 노트.md",
        "본문 [[202607051530]] 참조",
    );
    let backlinks = index.get_backlinks("/z/notes/202607051530 원자적 노트.md");
    assert_eq!(backlinks.len(), 1);
    assert_eq!(backlinks[0].source_path, "/z/notes/202607051600 다른 노트.md");
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test test_backlinks_by_id`
Expected: FAIL — `get_backlinks` looks up `incoming["202607051530 원자적 노트"]` (stem), but the link is in `incoming["202607051530"]` (id), so 0 backlinks.

- [ ] **Step 3: Union id-keyed backlinks**

Rewrite `get_backlinks` to gather from both the stem key and the id key, deduping:

```rust
    pub fn get_backlinks(&self, file_path: &str) -> Vec<BacklinkResult> {
        let stem = normalize_file_path(file_path);
        let mut keys = vec![stem.clone()];
        if let Some(id) = extract_id_from_stem(&stem) {
            keys.push(id);
        }

        let mut seen = std::collections::HashSet::new();
        let mut results = Vec::new();
        for key in keys {
            if let Some(entries) = self.incoming.get(&key) {
                for e in entries {
                    if seen.insert((e.source_path.clone(), e.line)) {
                        results.push(BacklinkResult {
                            source_path: e.source_path.clone(),
                            target_path: file_path.to_string(),
                            context: e.context.clone(),
                            line: e.line,
                            link_type: e.link_type.clone(),
                            block_id: e.block_id.clone(),
                        });
                    }
                }
            }
        }
        results
    }
```

- [ ] **Step 4: Run test to verify it passes + full index tests green**

Run: `cd src-tauri && cargo test index::`
Expected: PASS — new test passes; `test_backlinks_lookup` (stem-based) still passes (dedup + stem key preserved).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/index/mod.rs
git commit -m "feat(zettelkasten §95): compute backlinks by note id as well as by stem"
```

---

## Task 5: Full backend verification

**Files:** none (verification only)

- [ ] **Step 1: cargo test (full)**

Run: `cd src-tauri && cargo test`
Expected: all pass, count >= baseline 269 + the 5 new tests (~274), 0 failed.

- [ ] **Step 2: clippy + fmt**

Run: `cd src-tauri && cargo clippy -- -D warnings && cargo fmt --check`
Expected: clean (no warnings, no format diffs).

- [ ] **Step 3: No commit** (verification only; nothing changed). If clippy/fmt flag something introduced by Tasks 1–4, fix it and commit `fix(zettelkasten §95): clippy/fmt cleanup for id resolver`.

---

## Self-Review

- **Spec coverage (§95 resolver requirement, backend half):** id-target resolution → Task 3; id-prefix indexing → Task 2; helpers → Task 1; backlink parity → Task 4. The graph (`get_link_graph`) already routes through `resolve_target_from_map`, so Task 3 fixes graph edges for `[[ID]]` too (no separate task needed). **Frontend half (live-title render, autocomplete title→id, B2 normalization, New-from-selection, export ID→title) is Plan 2b-ii.**
- **R2 (resolver blast radius) mitigation:** id resolution only triggers for bare `\d{12,14}` targets with an `id_map` hit; general vaults have no id-prefixed files → `id_map` empty → zero behavior change. Existing `[[name]]`/`[[path/name]]` tests are the regression gate (Task 3/4 Step 4 re-run `index::`).
- **Placeholder scan:** none — all code + tests concrete. The Task 2 note about the resolve assertion "belonging to Task 3" is a sequencing clarification, not deferred work.
- **Type consistency:** `extract_id_from_stem(&str)->Option<String>`, `is_id_target(&str)->bool`, `id_map: HashMap<String,String>` used consistently across Tasks 1–4. `BacklinkResult` fields (source_path/target_path/context/line/link_type/block_id) match the existing struct.
- **Data/no-schema:** in-memory index only; no SQLite/IPC/serialization change; no migration.
