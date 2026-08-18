# Plugin Tier Manifest (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the `trust` tier (+ declarative `contributions`) to the plugin manifest, validate it, surface it in the install UI with a full-trust opt-in, and treat legacy (trust-less) plugins as "needs re-validation" — the data-model foundation for #260.

**Architecture:** Purely additive schema + validation + UI. This phase does **not** change plugin execution — plugins stay gated by #259's `arePluginsEnabled()` (`VITE_ENABLE_PLUGINS`). It establishes the `trust` discriminator that later phases (sandbox runtime, Rust broker) branch on.

**Tech Stack:** TypeScript 6 (strict, `verbatimModuleSyntax`), React 19, Rust (Tauri 2.0, serde), Vitest, cargo test.

## Global Constraints

- TypeScript strict mode; type-only imports MUST use `import type`.
- `npm run typecheck` checks app + node + test projects — test code is type-checked.
- Vitest only (`npm test` → `vitest run`); never `npx jest`.
- Zustand selectors in components MUST use `useShallow` (no bare `useStore()`); *pre-existing* bare calls in `PluginMarketplace` are out of scope — do not "fix" them.
- Conventional Commits, English messages, reference `§260` (e.g. `feat(§260): ...`).
- Rust IPC commands return `Result<T, String>`; keep `ipc-registry.json` in sync if a command signature changes (none change in this phase).
- Manifest is read/serialized on both sides — the Rust `PluginManifest` and TS `PluginManifest` must stay compatible.

---

### Task 1: Frontend manifest types + validator require `trust`

**Files:**
- Modify: `src/plugins/types.ts` (add `PluginTrust`, `PluginContributions`; extend `PluginManifest`, `RegistryEntry`)
- Modify: `src/plugins/manifest.ts` (validate `trust` + `contributions`)
- Test: `src/plugins/__tests__/manifest.test.ts`
- Fixture updates (add `trust`): `src/plugins/__tests__/plugin-loader.test.ts`, `src/plugins/__tests__/extension-context.ai.test.ts`

**Interfaces:**
- Produces: `type PluginTrust = "sandboxed" | "trusted"`; `interface PluginContributions`; `PluginManifest.trust: PluginTrust`, `PluginManifest.contributions?: PluginContributions`; `RegistryEntry.trust?: PluginTrust`. `validateManifest` now rejects a manifest whose `trust` is absent or not one of the two literals.

- [ ] **Step 1: Add the failing validator tests**

In `src/plugins/__tests__/manifest.test.ts`, add:

```ts
describe("validateManifest — trust tier (§260)", () => {
  const base = {
    id: "x",
    name: "X",
    description: "d",
    version: "1.0.0",
    author: "a",
    license: "MIT",
    main: "index.mjs",
    engines: { baram: "*" },
    capabilities: [],
  };

  it("rejects a manifest with no trust field", () => {
    const r = validateManifest(base);
    expect(r.valid).toBe(false);
    if (!r.valid) {
      expect(r.errors.some((e) => e.field === "trust")).toBe(true);
    }
  });

  it("rejects an invalid trust value", () => {
    const r = validateManifest({ ...base, trust: "full" });
    expect(r.valid).toBe(false);
  });

  it("accepts trust=sandboxed and trust=trusted", () => {
    expect(validateManifest({ ...base, trust: "sandboxed" }).valid).toBe(true);
    expect(validateManifest({ ...base, trust: "trusted" }).valid).toBe(true);
  });

  it("rejects a non-object contributions field", () => {
    const r = validateManifest({ ...base, trust: "sandboxed", contributions: [] });
    expect(r.valid).toBe(false);
    if (!r.valid) {
      expect(r.errors.some((e) => e.field === "contributions")).toBe(true);
    }
  });
});
```

(If `validateManifest` is not yet imported in the file, add `import { validateManifest } from "../manifest";` — check the existing imports first and reuse them.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/plugins/__tests__/manifest.test.ts`
Expected: FAIL — the new trust cases fail (validator does not yet check `trust`); existing tests may also now need the field (fixed in Step 5).

- [ ] **Step 3: Add the types**

In `src/plugins/types.ts`, immediately before `export type PluginCapability =`:

```ts
export type PluginTrust = "sandboxed" | "trusted";

/**
 * §260 declarative contribution surface for sandboxed plugins. Populated in
 * the manifest; consumed by the sandbox runtime in later phases. Every field
 * is serializable (crosses the plugin/host boundary as data).
 */
export interface PluginContributions {
  commands?: Array<{ id: string; palette?: boolean; title: string }>;
  menu?: Array<{ command: string; id: string; title: string; when?: string }>;
  settings?: Array<{
    default?: boolean | number | string;
    key: string;
    label: string;
    type: "boolean" | "number" | "string";
  }>;
  statusBar?: Array<{
    command?: string;
    id: string;
    text: string;
    tooltip?: string;
  }>;
}
```

In the `PluginManifest` interface add (keep alphabetical order to satisfy the `perfectionist/sort-interfaces` lint rule — `contributions` after `capabilities`, `trust` after `tiptapExtensions`):

```ts
  capabilities: PluginCapability[];
  contributions?: PluginContributions;
```

and:

```ts
  tiptapExtensions?: TiptapExtensionDef[];
  trust: PluginTrust;
  version: string;
```

In the `RegistryEntry` interface add `trust` (optional — legacy registry entries lack it). Place it before `version` to keep sort order:

```ts
  repository?: string;
  trust?: PluginTrust;
  version: string;
```

- [ ] **Step 4: Implement the validator checks**

In `src/plugins/manifest.ts`, after the capabilities block (after line ~93, before the `tiptapExtensions` block), add:

```ts
  // Trust tier (§260) — required discriminator
  if (obj.trust !== "trusted" && obj.trust !== "sandboxed") {
    errors.push({
      field: "trust",
      message: 'trust is required and must be "trusted" or "sandboxed"',
    });
  }

  // Contributions (optional, sandboxed tier) — shallow shape check only
  if (
    obj.contributions !== undefined &&
    (typeof obj.contributions !== "object" ||
      obj.contributions === null ||
      Array.isArray(obj.contributions))
  ) {
    errors.push({
      field: "contributions",
      message: "contributions must be an object",
    });
  }
```

- [ ] **Step 5: Update existing manifest fixtures that flow through `validateManifest`**

`loadPlugin` calls `validateManifest`, so real-loader test fixtures now need `trust`.

In `src/plugins/__tests__/plugin-loader.test.ts`, in the `manifest` const (the object with `id: "dev-x"`), add `trust: "sandboxed",` (before `capabilities` or anywhere in the literal):

```ts
const manifest: PluginManifest = {
  id: "dev-x",
  name: "Dev X",
  description: "test",
  version: "1.0.0",
  author: "test",
  license: "MIT",
  main: "index.mjs",
  engines: { baram: ">=0.2.0" },
  capabilities: ["commands"],
  trust: "sandboxed",
};
```

In `src/plugins/__tests__/extension-context.ai.test.ts`, the `mf()` helper builds a manifest; add `trust: "sandboxed",` to its returned object literal:

```ts
function mf(caps: string[]): PluginManifest {
  return {
    id: "ai-plugin",
    name: "AI",
    description: "",
    version: "1.0.0",
    author: "",
    license: "MIT",
    main: "index.mjs",
    engines: { baram: ">=0.2.0" },
    capabilities: caps as PluginManifest["capabilities"],
    trust: "sandboxed",
  };
}
```

- [ ] **Step 6: Run the full frontend gate**

Run: `npx vitest run src/plugins/__tests__/manifest.test.ts src/plugins/__tests__/plugin-loader.test.ts src/plugins/__tests__/extension-context.ai.test.ts`
Expected: PASS (all).
Run: `npm run typecheck`
Expected: exit 0 (the required `trust` field now type-checks in every `PluginManifest` literal — if typecheck flags another literal, add `trust` there too).

- [ ] **Step 7: Commit**

```bash
git add src/plugins/types.ts src/plugins/manifest.ts src/plugins/__tests__/manifest.test.ts src/plugins/__tests__/plugin-loader.test.ts src/plugins/__tests__/extension-context.ai.test.ts
git commit -m "feat(§260): add plugin trust tier + contributions to manifest schema"
```

---

### Task 2: Rust manifest struct — `trust` + `contributions`

**Files:**
- Modify: `src-tauri/src/plugin/mod.rs` (`PluginManifest` struct + `PluginTrust` enum + tests)

**Interfaces:**
- Produces: `PluginManifest.trust: Option<PluginTrust>` (None for legacy manifests), `PluginManifest.contributions: Option<serde_json::Value>`. Rust round-trips both; it does not interpret `contributions` this phase.

- [ ] **Step 1: Add the failing deserialization tests**

In `src-tauri/src/plugin/mod.rs`, inside the existing `#[cfg(test)] mod tests { ... }` block (or add one if absent), add:

```rust
    #[test]
    fn manifest_parses_trust_sandboxed() {
        let json = r#"{"id":"x","name":"X","description":"d","version":"1.0.0","author":"a","license":"MIT","main":"index.mjs","engines":{"baram":"*"},"capabilities":[],"trust":"sandboxed"}"#;
        let m: PluginManifest = serde_json::from_str(json).unwrap();
        assert_eq!(m.trust, Some(PluginTrust::Sandboxed));
    }

    #[test]
    fn manifest_without_trust_is_none_for_legacy() {
        let json = r#"{"id":"x","name":"X","description":"d","version":"1.0.0","author":"a","license":"MIT","main":"index.mjs","engines":{"baram":"*"},"capabilities":[]}"#;
        let m: PluginManifest = serde_json::from_str(json).unwrap();
        assert_eq!(m.trust, None);
    }
```

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml plugin::tests::manifest_parses_trust`
Expected: FAIL — compile error (`PluginTrust` / `trust` field do not exist yet).

- [ ] **Step 3: Add the enum and fields**

In `src-tauri/src/plugin/mod.rs`, add the enum just before `pub struct PluginManifest {`:

```rust
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PluginTrust {
    Sandboxed,
    Trusted,
}
```

Inside `PluginManifest`, after the `keywords` field (before the closing `}`), add:

```rust
    #[serde(default)]
    pub trust: Option<PluginTrust>,
    #[serde(default)]
    pub contributions: Option<serde_json::Value>,
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml plugin::tests::manifest`
Expected: PASS (both new tests).

- [ ] **Step 5: Verify nothing else broke**

Run: `cargo check --manifest-path src-tauri/Cargo.toml --tests`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/plugin/mod.rs
git commit -m "feat(§260): add trust/contributions to Rust plugin manifest"
```

---

### Task 3: Legacy-detection helper

**Files:**
- Create: `src/plugins/plugin-trust.ts`
- Test: `src/plugins/__tests__/plugin-trust.test.ts`

**Interfaces:**
- Produces:
  - `pluginTrustOf(manifest: Pick<PluginManifest, "trust">): PluginTrust | null` — returns the declared tier, or `null` for a legacy manifest whose `trust` is absent.
  - `isLegacyManifest(manifest: Pick<PluginManifest, "trust">): boolean` — `true` when no valid tier is declared (needs re-validation).

- [ ] **Step 1: Write the failing test**

Create `src/plugins/__tests__/plugin-trust.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { isLegacyManifest, pluginTrustOf } from "../plugin-trust";

describe("pluginTrustOf (§260)", () => {
  it("returns the declared tier", () => {
    expect(pluginTrustOf({ trust: "sandboxed" })).toBe("sandboxed");
    expect(pluginTrustOf({ trust: "trusted" })).toBe("trusted");
  });

  it("returns null for a legacy manifest with no trust", () => {
    expect(pluginTrustOf({} as { trust: never })).toBeNull();
  });

  it("returns null for an unrecognized trust value", () => {
    expect(pluginTrustOf({ trust: "full" as unknown as "trusted" })).toBeNull();
  });
});

describe("isLegacyManifest (§260)", () => {
  it("is true only when no valid tier is declared", () => {
    expect(isLegacyManifest({ trust: "sandboxed" })).toBe(false);
    expect(isLegacyManifest({} as { trust: never })).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/plugins/__tests__/plugin-trust.test.ts`
Expected: FAIL with "Failed to resolve import ../plugin-trust" (file does not exist).

- [ ] **Step 3: Implement the helper**

Create `src/plugins/plugin-trust.ts`:

```ts
// §260 — plugin trust tier helpers. A manifest predating the tier model has no
// `trust`; such plugins must not run until re-validated by the user.
import type { PluginManifest, PluginTrust } from "./types";

const TIERS: readonly PluginTrust[] = ["sandboxed", "trusted"];

export function pluginTrustOf(
  manifest: Pick<PluginManifest, "trust">,
): PluginTrust | null {
  const t = (manifest as { trust?: unknown }).trust;
  return TIERS.includes(t as PluginTrust) ? (t as PluginTrust) : null;
}

export function isLegacyManifest(
  manifest: Pick<PluginManifest, "trust">,
): boolean {
  return pluginTrustOf(manifest) === null;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/plugins/__tests__/plugin-trust.test.ts`
Expected: PASS (5).

- [ ] **Step 5: Commit**

```bash
git add src/plugins/plugin-trust.ts src/plugins/__tests__/plugin-trust.test.ts
git commit -m "feat(§260): add plugin trust-tier / legacy-manifest helpers"
```

---

### Task 4: Install-UI tier badge + full-trust opt-in

**Files:**
- Create: `src/components/plugins/PluginTrustBadge.tsx`
- Modify: `src/components/plugins/PluginDetail.tsx` (render the badge; gate the Install button for `trusted`)
- Test: `src/components/plugins/__tests__/PluginTrustBadge.test.tsx`, `src/components/plugins/__tests__/PluginDetail.trust.test.tsx`

**Interfaces:**
- Consumes: `RegistryEntry.trust` (Task 1), `PluginTrust` (Task 1).
- Produces: `PluginTrustBadge({ trust }: { trust: PluginTrust | undefined })` — renders "Sandboxed", "Full trust", or "Legacy — needs re-validation". `PluginDetail` shows the badge and, for `trust === "trusted"`, requires a confirm step before invoking `onInstall`.

- [ ] **Step 1: Write the failing badge test**

Create `src/components/plugins/__tests__/PluginTrustBadge.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PluginTrustBadge } from "../PluginTrustBadge";

describe("PluginTrustBadge (§260)", () => {
  it("labels a sandboxed plugin", () => {
    render(<PluginTrustBadge trust="sandboxed" />);
    expect(screen.getByText(/sandboxed/i)).toBeInTheDocument();
  });

  it("labels a trusted plugin as full trust", () => {
    render(<PluginTrustBadge trust="trusted" />);
    expect(screen.getByText(/full trust/i)).toBeInTheDocument();
  });

  it("labels a legacy (undefined trust) plugin as needing re-validation", () => {
    render(<PluginTrustBadge trust={undefined} />);
    expect(screen.getByText(/re-validation/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/plugins/__tests__/PluginTrustBadge.test.tsx`
Expected: FAIL — cannot resolve `../PluginTrustBadge`.

- [ ] **Step 3: Implement the badge**

Create `src/components/plugins/PluginTrustBadge.tsx`:

```tsx
import type { PluginTrust } from "../../plugins/types";

// §260 — tier badge shown in the plugin install UI.
const LABEL: Record<PluginTrust, string> = {
  sandboxed: "Sandboxed",
  trusted: "Full trust",
};

const COLOR: Record<PluginTrust, string> = {
  sandboxed: "var(--color-accent-default)",
  trusted: "var(--color-status-danger)",
};

export function PluginTrustBadge({ trust }: { trust: PluginTrust | undefined }) {
  const label = trust ? LABEL[trust] : "Legacy — needs re-validation";
  const color = trust ? COLOR[trust] : "var(--color-text-muted)";
  return (
    <span
      style={{
        alignSelf: "flex-start",
        border: `1px solid ${color}`,
        borderRadius: "4px",
        color,
        fontSize: "12px",
        fontWeight: 500,
        padding: "2px 8px",
      }}
    >
      {label}
    </span>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/components/plugins/__tests__/PluginTrustBadge.test.tsx`
Expected: PASS (3).

- [ ] **Step 5: Write the failing PluginDetail opt-in test**

Create `src/components/plugins/__tests__/PluginDetail.trust.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { RegistryEntry } from "../../../plugins/types";

import { PluginDetail } from "../PluginDetail";

function entry(trust: RegistryEntry["trust"]): RegistryEntry {
  return {
    author: "a",
    capabilities: [],
    checksum: "c",
    description: "d",
    downloadUrl: "https://example.com/p.zip",
    engines: { baram: "*" },
    id: "p",
    license: "MIT",
    name: "P",
    trust,
    version: "1.0.0",
  };
}

const noop = () => {};

describe("PluginDetail trust gating (§260)", () => {
  it("installs a sandboxed plugin without an extra confirm", () => {
    const onInstall = vi.fn();
    render(
      <PluginDetail
        entry={entry("sandboxed")}
        onBack={noop}
        onInstall={onInstall}
        onToggleEnabled={noop}
        onUninstall={noop}
        onUpdate={noop}
        status="available"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^install$/i }));
    expect(onInstall).toHaveBeenCalledTimes(1);
  });

  it("requires a full-trust confirm before installing a trusted plugin", () => {
    const onInstall = vi.fn();
    render(
      <PluginDetail
        entry={entry("trusted")}
        onBack={noop}
        onInstall={onInstall}
        onToggleEnabled={noop}
        onUninstall={noop}
        onUpdate={noop}
        status="available"
      />,
    );
    // First click reveals the warning; it does NOT install yet.
    fireEvent.click(screen.getByRole("button", { name: /install/i }));
    expect(onInstall).not.toHaveBeenCalled();
    expect(screen.getByText(/full app access/i)).toBeInTheDocument();
    // Confirming the warning installs.
    fireEvent.click(screen.getByRole("button", { name: /install anyway/i }));
    expect(onInstall).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `npx vitest run src/components/plugins/__tests__/PluginDetail.trust.test.tsx`
Expected: FAIL — no trust badge / no confirm flow yet (the trusted test fails because `onInstall` fires immediately and no warning text exists).

- [ ] **Step 7: Wire the badge + opt-in into PluginDetail**

In `src/components/plugins/PluginDetail.tsx`:

Add imports at the top (after the existing `PluginCapabilityBadge` import; keep import sort order — `react` first, then local):

```tsx
import { useState } from "react";

import { PluginTrustBadge } from "./PluginTrustBadge";
```

Inside the component body, at the very top of `PluginDetail(...)` before `return (`, add:

```tsx
  const [showTrustWarning, setShowTrustWarning] = useState(false);
  const handleInstallClick = () => {
    if (entry.trust === "trusted" && !showTrustWarning) {
      setShowTrustWarning(true);
      return;
    }
    onInstall();
  };
```

In the header block, render the badge under the author/version row. Replace the closing of the header `<div>` metadata row — after the `{entry.license}` span's closing `</span>` and its wrapping `</div>` (the flex row), insert the badge before the header's outer `</div>`:

```tsx
            <span
              style={{
                fontSize: "12px",
                color: "var(--color-text-muted)",
              }}
            >
              {entry.license}
            </span>
          </div>
          <div style={{ marginTop: "6px" }}>
            <PluginTrustBadge trust={entry.trust} />
          </div>
        </div>
      </div>
```

Change the Install button's `onClick` from `onInstall` to `handleInstallClick`, and render the warning above it. Replace the final `else` branch (the bare Install button, lines ~211-227) with:

```tsx
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {showTrustWarning && (
              <div
                style={{
                  padding: "8px 12px",
                  borderRadius: "6px",
                  backgroundColor: "var(--color-status-error-bg)",
                  color: "var(--color-status-danger)",
                  fontSize: "13px",
                  border: "1px solid var(--color-status-error-border)",
                }}
              >
                This plugin runs with full app access and is not sandboxed.
                Install it only if you trust the author and source.
              </div>
            )}
            <button
              onClick={handleInstallClick}
              style={{
                alignSelf: "flex-start",
                padding: "8px 20px",
                borderRadius: "6px",
                fontSize: "13px",
                fontWeight: 500,
                backgroundColor: "var(--color-accent-default)",
                color: "#fff",
                border: "none",
                cursor: "pointer",
              }}
            >
              {showTrustWarning ? "Install anyway" : "Install"}
            </button>
          </div>
        )}
```

- [ ] **Step 8: Run to verify it passes**

Run: `npx vitest run src/components/plugins/__tests__/PluginDetail.trust.test.tsx src/components/plugins/__tests__/PluginTrustBadge.test.tsx`
Expected: PASS (5).

- [ ] **Step 9: Lint + typecheck + full plugin suite**

Run: `npx eslint src/ --fix && npm run lint:ts`
Expected: exit 0 (fixes import/prop sort order; re-run must be clean).
Run: `npm run typecheck`
Expected: exit 0.
Run: `npx vitest run src/components/plugins src/plugins`
Expected: PASS (all plugin UI + logic tests, including the pre-existing marketplace/card/dev-section suites).

- [ ] **Step 10: Commit**

```bash
git add src/components/plugins/PluginTrustBadge.tsx src/components/plugins/PluginDetail.tsx src/components/plugins/__tests__/PluginTrustBadge.test.tsx src/components/plugins/__tests__/PluginDetail.trust.test.tsx
git commit -m "feat(§260): show plugin trust tier + full-trust opt-in in install UI"
```

---

## Self-Review

**Spec coverage (against ADR §7 "manifest & migration" for phase 1):**
- Manifest `trust` (required) — Task 1 (TS) + Task 2 (Rust). ✅
- Manifest `contributions` (typed, sandboxed) — Task 1 type + validator, Task 2 round-trip. ✅
- Install-UI tier display — Task 4 badge. ✅
- Full-trust opt-in for trusted installs — Task 4. ✅
- Legacy (trust-less) treated as needs-revalidation — Task 3 helper + Task 4 badge label. ✅ (Wiring the helper into the loader/store to actually *block* legacy execution belongs to Phase 2, where the loader forks by tier; call this out to the user.)

**Placeholder scan:** none — every step carries full code and exact commands.

**Type consistency:** `PluginTrust = "sandboxed" | "trusted"` used identically in types.ts, plugin-trust.ts, PluginTrustBadge, PluginDetail, and (as `PluginTrust::Sandboxed/Trusted`, lowercase serde) in Rust. `pluginTrustOf`/`isLegacyManifest` signatures match Task 3 → consumers. `RegistryEntry.trust?: PluginTrust` optional; `PluginManifest.trust: PluginTrust` required.

**Known consequence to flag:** making `trust` required in the validator means the two live registry plugins (word-count, ai-summary) and any trust-less manifest fail install validation until ported. This is expected (plugins are gated OFF until the runtime lands) and matches the deferred reference-plugin port in ADR §7.

## Out of scope (later phases)

- Sandbox runtime (per-plugin WebviewWindow), `plugin_call` broker, `PluginOp`/authorizer — Phase 2/3.
- Loader forking by tier + actually blocking legacy/sandboxed execution — Phase 2.
- Release-gate transition (replacing `VITE_ENABLE_PLUGINS`) — Phase 5.
