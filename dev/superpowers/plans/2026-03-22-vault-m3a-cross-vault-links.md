# Vault M3a: Cross-Vault Links Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable `[[alias::filename]]` cross-vault wikilinks that link between open contexts with autocomplete, resolution, rendering, and graph support.

**Architecture:** Extend the existing wikilink node with a `vaultAlias` attribute. The `::` delimiter separates the vault alias from the target. Resolution uses `contextStore.resolve_alias` to find the target context, then resolves the target within that context's file tree. The Rust link index adds `target_vault_alias` to `LinkEntry` for backlink tracking. Autocomplete shows cross-vault suggestions when `[[alias::` is typed.

**Tech Stack:** Rust (regex, HashMap LinkIndex), TypeScript (ProseMirror Extension, Zustand, React)

**Design doc:** `dev/design/part12-vault-system.md` §12.7

---

## File Structure

### Rust (modify)
- `src-tauri/src/index/extractor.rs` — Extend wikilink regex to capture `alias::` prefix
- `src-tauri/src/index/mod.rs` — Add `target_vault_alias` to `LinkEntry`, update graph building
- `src-tauri/src/commands/context_cmd.rs` — Add `resolve_cross_vault_link` IPC command

### Frontend (modify)
- `src/extensions/nodes/wikilink.ts` — Add `vaultAlias` attr, update InputRule regex
- `src/pipeline/transformers/wikilink-transformer.ts` — Parse/serialize `alias::` prefix
- `src/utils/editor/wikilink-nav.ts` — Cross-vault target resolution
- `src/extensions/plugins/wikilink-suggest.ts` — Cross-vault autocomplete
- `src/extensions/plugins/wikilink-suggest-utils.ts` — Helper for cross-vault file listing
- `src/components/sidebar/graph-utils.ts` — Multi-vault graph rendering with vault colors + dashed edges

---

## Chunk 1: Parsing Layer — `[[alias::target]]` Syntax

### Task 1: Wikilink node vaultAlias attribute

**Files:**
- Modify: `src/extensions/nodes/wikilink.ts` — Add `vaultAlias` attr
- Modify: `src/pipeline/transformers/wikilink-transformer.ts` — Parse/serialize alias prefix

- [ ] **Step 1: Add vaultAlias attr to wikilink node**

In `src/extensions/nodes/wikilink.ts`, add to the attrs definition:
```typescript
vaultAlias: { default: null },  // §87 cross-vault link alias
```

- [ ] **Step 2: Extend InputRule regex for `[[alias::target]]`**

Current regex: `/\[\[([^\]|#^]+)(?:#([^\]|^]+))?(?:\^([^\]|]+))?(?:\|([^\]]+))?\]\]$/`

New regex that captures optional `alias::` prefix:
```typescript
/\[\[(?:([a-zA-Z][\w-]*)::)?([^\]|#^]+)(?:#([^\]|^]+))?(?:\^([^\]|]+))?(?:\|([^\]]+))?\]\]$/
```

Capture groups shift:
- Group 1: `vaultAlias` (optional, alphanumeric + hyphens, before `::`)
- Group 2: `target` (was group 1)
- Group 3: `heading` (was group 2)
- Group 4: `blockId` (was group 3)
- Group 5: `display` (was group 4)

Update the InputRule and `parseWikilinkMatch` accordingly.

- [ ] **Step 3: Update pipeline transformer**

In `src/pipeline/transformers/wikilink-transformer.ts`:
- Update `WIKILINK_RE` with the new regex
- `parseWikilinkMatch`: extract `vaultAlias` from group 1
- `serializeWikilink`: if `vaultAlias` is set, serialize as `[[alias::target...]]`

```typescript
export function serializeWikilink(attrs: {
  target: string;
  heading?: string | null;
  blockId?: string | null;
  display?: string | null;
  vaultAlias?: string | null;
}): string {
  let s = "[[";
  if (attrs.vaultAlias) s += `${attrs.vaultAlias}::`;
  s += attrs.target;
  if (attrs.heading) s += `#${attrs.heading}`;
  if (attrs.blockId) s += `^${attrs.blockId}`;
  if (attrs.display) s += `|${attrs.display}`;
  s += "]]";
  return s;
}
```

- [ ] **Step 4: Update roundtrip tests**

Add test cases for `[[journal::2026-03-22]]`, `[[work::skills/analyzer]]`, `[[work::file#heading|display]]`.

- [ ] **Step 5: Run tests**

Run: `npx vitest run src/extensions/__tests__/wikilink.test.ts src/pipeline/__tests__/`
Expected: all pass including new cross-vault roundtrip tests

- [ ] **Step 6: Commit**

```
feat(§87): add vaultAlias attr and [[alias::target]] parsing to wikilink
```

---

### Task 2: Rust link extractor for cross-vault links

**Files:**
- Modify: `src-tauri/src/index/extractor.rs` — Extend wikilink regex
- Modify: `src-tauri/src/index/mod.rs` — Add target_vault_alias to LinkEntry

- [ ] **Step 1: Add target_vault_alias to LinkEntry**

In `src-tauri/src/index/mod.rs`, add to `LinkEntry`:
```rust
pub target_vault_alias: Option<String>,  // §87 cross-vault alias
```

- [ ] **Step 2: Extend wikilink extraction regex**

In `src-tauri/src/index/extractor.rs`, update the wikilink regex to capture the optional alias prefix:
```rust
// BEFORE:
static ref WIKILINK_RE: Regex = Regex::new(r"\[\[([^\]|#^]+)...

// AFTER (with optional alias:: prefix):
static ref WIKILINK_RE: Regex = Regex::new(
    r"\[\[(?:([a-zA-Z][\w-]*)::)?([^\]|#^]+)(?:#[^\]|^]+)?(?:\^[^\]|]+)?(?:\|[^\]]+)?\]\]"
).unwrap();
```

Update extraction logic to read group 1 as `target_vault_alias` (None if not present), group 2 as `target`.

- [ ] **Step 3: Update LinkIndex graph building for cross-vault edges**

In `mod.rs`, when building the link graph, if `target_vault_alias` is Some, prefix the edge target with `{alias}::` to distinguish from intra-vault edges.

- [ ] **Step 4: Run Rust tests**

Run: `cd src-tauri && cargo test index`
Expected: all existing tests pass, plus new cross-vault extraction tests

- [ ] **Step 5: Commit**

```
feat(§87): add cross-vault alias extraction to Rust link index
```

---

## Chunk 2: Resolution + IPC

### Task 3: Cross-vault link resolution

**Files:**
- Modify: `src/utils/editor/wikilink-nav.ts` — Resolve [[alias::target]]
- Modify: `src-tauri/src/commands/context_cmd.rs` — resolve_cross_vault_link IPC

- [ ] **Step 1: Add resolve_cross_vault_link IPC**

In `src-tauri/src/commands/context_cmd.rs`:
```rust
#[tauri::command]
pub async fn resolve_cross_vault_link(
    alias: String,
    target: String,
    state: tauri::State<'_, ContextManager>,
) -> Result<Option<String>, String> {
    // Find context by alias
    let context_id = state.resolve_alias(&alias).await;
    // ... resolve target within that context's file tree
}
```

Register in lib.rs invoke_handler.

- [ ] **Step 2: Add frontend IPC wrapper**

In `src/ipc/context.ts`:
```typescript
export async function resolveCrossVaultLink(alias: string, target: string): Promise<string | null> {
  return invoke("resolve_cross_vault_link", { alias, target });
}
```

- [ ] **Step 3: Update resolveWikilinkTarget for cross-vault**

In `src/utils/editor/wikilink-nav.ts`, add a pre-check for `vaultAlias`:

```typescript
// At the beginning of resolveWikilinkTarget:
// §87 Cross-vault: if target has alias prefix, resolve in that context
if (vaultAlias) {
  const ctx = useContextStore.getState().contexts.find(
    (c) => c.alias === vaultAlias
  );
  if (!ctx) return null; // Dangling — vault not open
  // Search that context's file tree (need to load it)
  // ... resolve target within ctx.path
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run && cd src-tauri && cargo test`

- [ ] **Step 5: Commit**

```
feat(§87): cross-vault link resolution with alias lookup
```

---

## Chunk 3: Autocomplete + Rendering

### Task 4: Cross-vault autocomplete

**Files:**
- Modify: `src/extensions/plugins/wikilink-suggest.ts`
- Modify: `src/extensions/plugins/wikilink-suggest-utils.ts`

- [ ] **Step 1: Detect `[[alias::` trigger**

When user types `[[journal::`, detect the alias prefix and switch to cross-vault mode. Filter file suggestions from the alias context's file tree.

- [ ] **Step 2: Add cross-vault hint at bottom of suggestion list**

When typing `[[` (no alias), show a hint at the bottom:
```
💡 Cross-vault: type alias:: (e.g., journal::)
```

- [ ] **Step 3: List context aliases for completion**

After typing `[[`, if query contains no `::`, offer vault aliases as top-level completions.

- [ ] **Step 4: Commit**

```
feat(§87): cross-vault wikilink autocomplete with alias detection
```

---

### Task 5: Cross-vault link rendering + dangling display

**Files:**
- Modify: `src/extensions/nodes/wikilink.ts` — WikilinkView rendering

- [ ] **Step 1: Render cross-vault links with vault color badge**

In the WikilinkView component, when `vaultAlias` is set:
- Show a small colored dot (matching context color) before the link text
- Use the format: `● alias::target` or just `● target` with alias as tooltip

- [ ] **Step 2: Dangling cross-vault link display**

When the alias vault is not open:
- Render in gray with dashed underline
- Hover tooltip: "{alias} vault is not open. [Open]"
- The link text is preserved for roundtrip fidelity

- [ ] **Step 3: Commit**

```
feat(§87): cross-vault link rendering with vault color and dangling state
```

---

## Chunk 4: Graph View + Integration

### Task 6: Graph View multi-vault support

**Files:**
- Modify: `src/components/sidebar/graph-utils.ts` — Multi-vault node/edge generation
- Modify: `src/components/sidebar/GraphView.tsx` — Scope selector UI

- [ ] **Step 1: Add scope selector to GraphView**

Add a scope toggle (similar to GlobalSearch): "Current Vault" / "All Vaults"

- [ ] **Step 2: Multi-vault graph rendering**

When scope is "All Vaults":
- Fetch link graphs from all vault contexts
- Prefix node IDs with `{alias}::` to prevent collisions
- Color nodes by context color
- Cross-vault edges rendered as dashed lines

- [ ] **Step 3: Commit**

```
feat(§87): Graph View multi-vault scope with context-colored nodes
```

---

## Chunk 5: Vault Alias Management + Verification

### Task 7: Vault alias population and management

**Files:**
- Modify: `src/stores/file/file.ts` — Auto-populate alias when adding vault context
- Modify: `src/components/settings/tabs/VaultTab.tsx` — Alias editing UI
- Modify: `src/components/layout/ContextTabBar.tsx` — Show alias in context menu

- [ ] **Step 1: Auto-set alias from folder name on context creation**

In `openFolder` and `addFolder`, when adding a vault context, auto-set alias to the folder name (lowercase, kebab-case).

- [ ] **Step 2: Alias editing in Vault settings tab and context menu**

- [ ] **Step 3: crossVaultHints in .baram/config.json**

When a cross-vault link is created, save the alias → lastKnownPath mapping in the source vault's config for portability.

- [ ] **Step 4: Run full test suite**

Run: `npx vitest run && cd src-tauri && cargo test && cargo clippy -- -D warnings && npx tsc --noEmit`

- [ ] **Step 5: Commit**

```
feat(§87): auto-populate vault alias + crossVaultHints persistence
```

### Task 8: Final regression test

- [ ] **Step 1: Full test suite**
- [ ] **Step 2: Roundtrip test for [[alias::target]] variations**
- [ ] **Step 3: Update design doc M3 status**
