# §260 Phase 5 — Release-gate lift Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make sandboxed plugins work in packaged release builds, behind a real install-consent step that cannot be bypassed by a lying registry.

**Architecture:** Consent is a snapshot of `(trust, capabilities)` recorded on the installed-plugin record. It is collected before download against the registry's *claim*, then re-checked against the downloaded manifest before anything is persisted. The release gate is removed only after every hole it was covering is closed, so task order is load-bearing.

**Tech Stack:** TypeScript 6 (strict, `verbatimModuleSyntax`), React 19, Zustand (persist + `useShallow`), Vitest, Rust/Tauri 2.11.

Design doc: `dev/superpowers/specs/2026-07-28-plugin-release-gate-lift-phase5-design.md`

## Global Constraints

- Conventional Commits with the section tag: `feat(§260): …`, `fix(§260): …`.
- Never `git commit --no-verify`.
- Type-only imports must use `import type`.
- Components must use `useShallow` selectors — no bare `useStore()` calls.
- Single source file target ~300 lines; split past ~500.
- Run `npm test`, `npm run typecheck`, `npx prettier --check`, and `cargo clippy --all-targets` before each commit. Capture gate exit codes **without a pipe** (`cmd > /tmp/log; echo $?`).
- Every new guard test must be mutation-verified: break the code it guards, confirm the test fails, restore. Three tests written in Phase 4c passed against unfixed code.
- New user-facing dialog copy is English (matches `PluginDetail.tsx`); capability text reuses the existing Korean `CAPABILITY_DESCRIPTIONS`.

---

### Task 1: The consent rule (pure)

**Files:**
- Create: `src/plugins/plugin-consent.ts`
- Create: `src/plugins/__tests__/plugin-consent.test.ts`
- Modify: `src/plugins/types.ts` (add `PluginConsent`, add `consent?` to `InstalledPlugin` at line 75-83)

**Interfaces:**
- Consumes: `PluginCapability`, `PluginTrust` from `src/plugins/types.ts`.
- Produces: `PluginConsent`, `ConsentReason`, `consentGaps(consented, next): string[]`, `consentRequired(consented, next): ConsentReason | null`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";

import type { PluginConsent } from "../plugin-consent";

import { consentGaps, consentRequired } from "../plugin-consent";

const sandboxed = (...caps: string[]): PluginConsent => ({
  capabilities: caps as PluginConsent["capabilities"],
  trust: "sandboxed",
});

describe("consentRequired (§260 Phase 5)", () => {
  it("asks on a first install", () => {
    expect(consentRequired(undefined, { capabilities: [], trust: "sandboxed" })).toBe(
      "first-install",
    );
  });

  it("asks when the tier escalates to trusted", () => {
    expect(
      consentRequired(sandboxed("editor"), { capabilities: ["editor"], trust: "trusted" }),
    ).toBe("escalation");
  });

  it("asks when a capability is added", () => {
    expect(
      consentRequired(sandboxed("editor"), {
        capabilities: ["editor", "network"],
        trust: "sandboxed",
      }),
    ).toBe("escalation");
  });

  it("stays silent when nothing changed", () => {
    expect(
      consentRequired(sandboxed("editor", "network"), {
        capabilities: ["network", "editor"],
        trust: "sandboxed",
      }),
    ).toBeNull();
  });

  // The false positive an ordinary subset test produces: `files` already covers
  // `files:readonly`, so narrowing a grant must not prompt.
  it("stays silent when a grant NARROWS", () => {
    expect(
      consentRequired(sandboxed("files"), {
        capabilities: ["files:readonly"],
        trust: "sandboxed",
      }),
    ).toBeNull();
    expect(
      consentRequired(sandboxed("editor"), {
        capabilities: ["editor:readonly"],
        trust: "sandboxed",
      }),
    ).toBeNull();
  });

  it("still asks when a readonly grant WIDENS", () => {
    expect(
      consentRequired(sandboxed("files:readonly"), {
        capabilities: ["files"],
        trust: "sandboxed",
      }),
    ).toBe("escalation");
  });

  it("does not ask when the tier narrows to sandboxed", () => {
    expect(
      consentRequired(
        { capabilities: ["editor"], trust: "trusted" },
        { capabilities: ["editor"], trust: "sandboxed" },
      ),
    ).toBeNull();
  });
});

describe("consentGaps", () => {
  it("names the tier and every uncovered capability", () => {
    const gaps = consentGaps(sandboxed("editor"), {
      capabilities: ["editor", "network", "files"],
      trust: "trusted",
    });
    expect(gaps).toHaveLength(2);
    expect(gaps[0]).toContain("trusted");
    expect(gaps[1]).toContain("network");
    expect(gaps[1]).toContain("files");
  });

  it("is empty when the consent covers the request", () => {
    expect(consentGaps(sandboxed("files"), {
      capabilities: ["files:readonly"],
      trust: "sandboxed",
    })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/plugins/__tests__/plugin-consent.test.ts`
Expected: FAIL — cannot resolve `../plugin-consent`.

- [ ] **Step 3: Write the implementation**

```ts
// §260 Phase 5 — what the user agreed to, and whether a later version exceeds it.
//
// One rule serves two callers, deliberately: the pre-download prompt decision
// (`consentRequired`) and the post-download verification that the downloaded manifest
// matches what the registry claimed. If those two ever diverge, a registry could
// advertise one shape and ship another — which is precisely what the verification exists
// to catch, so it must not be a second implementation of "covered".
import type { PluginCapability, PluginTrust } from "./types";

export interface PluginConsent {
  /** Exactly what was shown, so a later diff is against the displayed list. */
  capabilities: PluginCapability[];
  trust: PluginTrust;
}

export type ConsentReason = "escalation" | "first-install";

/** What the plugin is asking for now — a registry claim or a downloaded manifest. */
interface CapabilityRequest {
  capabilities: readonly PluginCapability[];
  trust: PluginTrust;
}

/**
 * Capabilities are ORDERED, not merely a set: holding the key implies holding the
 * readonly form. Rust already encodes the same relationship as
 * `CapabilityRequirement::AnyOf` on each brokered op; this is the UI-side half.
 *
 * Without it a plain subset test prompts on an update that NARROWS a grant
 * (`files` → `files:readonly`), which teaches users that the consent dialog is noise.
 */
const IMPLIED_BY: Partial<Record<PluginCapability, PluginCapability>> = {
  "editor:readonly": "editor",
  "files:readonly": "files",
};

/**
 * Every way `next` exceeds what was consented to, as sentences fit for a user-facing
 * error. Empty means covered.
 */
export function consentGaps(
  consented: PluginConsent,
  next: CapabilityRequest,
): string[] {
  const gaps: string[] = [];
  if (next.trust === "trusted" && consented.trust !== "trusted") {
    gaps.push(
      `it declares trust "trusted" (full access to the app), but "${consented.trust}" was approved`,
    );
  }
  const held = new Set(consented.capabilities);
  const extra = next.capabilities.filter((cap) => !isCovered(cap, held));
  if (extra.length > 0) {
    gaps.push(`it requests capabilities that were not approved: ${extra.join(", ")}`);
  }
  return gaps;
}

/** `null` means the recorded consent still covers this; otherwise, why to ask again. */
export function consentRequired(
  consented: PluginConsent | undefined,
  next: CapabilityRequest,
): ConsentReason | null {
  if (!consented) return "first-install";
  return consentGaps(consented, next).length > 0 ? "escalation" : null;
}

function isCovered(
  needed: PluginCapability,
  held: ReadonlySet<PluginCapability>,
): boolean {
  if (held.has(needed)) return true;
  const stronger = IMPLIED_BY[needed];
  return stronger !== undefined && held.has(stronger);
}
```

- [ ] **Step 4: Add `consent` to the installed-plugin record**

In `src/plugins/types.ts`, extend the interface at line 75 (keep the alphabetical field order the file uses):

```ts
export interface InstalledPlugin {
  checksum: string;
  /**
   * §260 Phase 5 — the (trust, capabilities) the user approved at install. Absent for
   * dev-folder plugins (choosing a directory is its own act of consent) and for records
   * written before Phase 5.
   */
  consent?: PluginConsent;
  enabled: boolean;
  installedAt: number;
  installPath: string;
  isDev?: boolean;
  manifest: PluginManifest;
  updatedAt: number;
}
```

Add the import at the top of `types.ts`: `import type { PluginConsent } from "./plugin-consent";`

- [ ] **Step 5: Run the tests and the type check**

Run: `npx vitest run src/plugins/__tests__/plugin-consent.test.ts > /tmp/t1.log; echo $?`
Expected: exit 0, 9 tests pass.
Run: `npm run typecheck > /tmp/tc1.log; echo $?`
Expected: exit 0.

- [ ] **Step 6: Mutation-verify the implication table**

Delete the `IMPLIED_BY` lookup from `isCovered` (`return held.has(needed);`). Re-run the test file: the two "stays silent when a grant NARROWS" assertions must fail. Restore.

- [ ] **Step 7: Commit**

```bash
git add src/plugins/plugin-consent.ts src/plugins/__tests__/plugin-consent.test.ts src/plugins/types.ts
git commit -m "feat(§260): add the install-consent rule (Phase 5)"
```

---

### Task 2: Persist the consent record

**Files:**
- Modify: `src/stores/system/plugin.ts` (migration at line 58-73, `version: 2` at line 217)
- Modify: `src/stores/system/__tests__/plugin-store.test.ts` (create if absent)

**Interfaces:**
- Consumes: `PluginConsent` from Task 1.
- Produces: persist version `3`; `migratePluginPersistedState` synthesises `consent` for pre-Phase-5 records.

- [ ] **Step 1: Write the failing test**

Append to the store's test file:

```ts
import { describe, expect, it } from "vitest";

import { migratePluginPersistedState } from "../plugin";

describe("plugin store migration v2 -> v3 (§260 Phase 5)", () => {
  const record = (manifest: Record<string, unknown>) => ({
    installedPlugins: {
      demo: { checksum: "sha256:x", enabled: true, installedAt: 0, installPath: "/p", manifest, updatedAt: 0 },
    },
  });

  it("synthesises consent from the manifest already installed", () => {
    const out = migratePluginPersistedState(
      record({ capabilities: ["editor", "network"], id: "demo", trust: "sandboxed" }),
      2,
    ) as { installedPlugins: Record<string, { consent?: unknown }> };
    expect(out.installedPlugins.demo.consent).toEqual({
      capabilities: ["editor", "network"],
      trust: "sandboxed",
    });
  });

  it("leaves a legacy (trust-less) manifest without consent — there is no tier to record", () => {
    const out = migratePluginPersistedState(
      record({ capabilities: ["editor"], id: "demo" }),
      2,
    ) as { installedPlugins: Record<string, { consent?: unknown }> };
    expect(out.installedPlugins.demo.consent).toBeUndefined();
  });

  it("does not overwrite a consent that is already recorded", () => {
    const state = record({ capabilities: ["editor"], id: "demo", trust: "sandboxed" }) as {
      installedPlugins: Record<string, Record<string, unknown>>;
    };
    state.installedPlugins.demo.consent = { capabilities: [], trust: "trusted" };
    const out = migratePluginPersistedState(state, 2) as typeof state;
    expect(out.installedPlugins.demo.consent).toEqual({ capabilities: [], trust: "trusted" });
  });

  it("returns malformed state untouched rather than throwing", () => {
    expect(migratePluginPersistedState(null, 2)).toBeNull();
    expect(migratePluginPersistedState({ installedPlugins: 7 }, 2)).toEqual({ installedPlugins: 7 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/stores/system/__tests__/plugin-store.test.ts`
Expected: FAIL — `consent` is `undefined` in the first test.

- [ ] **Step 3: Extend the migration**

In `src/stores/system/plugin.ts`, after the existing v1→v2 block inside `migratePluginPersistedState`:

```ts
  // v2 -> v3: §260 Phase 5 records what the user approved. Existing records predate
  // the consent step but were installed through the old capability confirm, and can
  // only exist in a dev build (release had plugins gated off), so the manifest they
  // already hold is the honest baseline. A legacy manifest has no tier to record, and
  // cannot load anyway — leaving it unconsented makes the next update ask.
  if (version < 3) {
    const installed = state.installedPlugins;
    if (installed !== null && typeof installed === "object") {
      for (const entry of Object.values(installed as Record<string, unknown>)) {
        if (entry === null || typeof entry !== "object") continue;
        const record = entry as Record<string, unknown>;
        if (record.consent !== undefined) continue;
        const manifest = record.manifest as
          | undefined
          | { capabilities?: unknown; trust?: unknown };
        const trust = manifest?.trust;
        if (trust !== "sandboxed" && trust !== "trusted") continue;
        record.consent = {
          capabilities: Array.isArray(manifest?.capabilities)
            ? [...(manifest.capabilities as string[])]
            : [],
          trust,
        };
      }
    }
  }
```

Update the doc comment above the function to describe both migrations, and change `version: 2` (line 217) to `version: 3`.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/stores/system/__tests__/plugin-store.test.ts > /tmp/t2.log; echo $?`
Expected: exit 0.

- [ ] **Step 5: Mutation-verify**

Change `if (version < 3)` to `if (version < 2)`. The synthesis test must fail. Restore.

- [ ] **Step 6: Commit**

```bash
git add src/stores/system/plugin.ts src/stores/system/__tests__/plugin-store.test.ts
git commit -m "feat(§260): persist the install consent record (Phase 5)"
```

---

### Task 3: The consent dialog

**Files:**
- Create: `src/components/plugins/PluginConsentDialog.tsx`
- Create: `src/components/plugins/__tests__/PluginConsentDialog.test.tsx`

**Interfaces:**
- Consumes: `PluginConsent`, `ConsentReason` (Task 1); `CAPABILITY_DESCRIPTIONS` from `src/plugins/types.ts`.
- Produces:

```ts
interface PluginConsentDialogProps {
  /** What is being asked for now. */
  consent: PluginConsent;
  name: string;
  onCancel: () => void;
  onConfirm: () => void;
  /** Recorded consent, when this is an update — drives the "new" markers. */
  prior?: PluginConsent;
  reason: ConsentReason;
}
export function PluginConsentDialog(props: PluginConsentDialogProps): JSX.Element;
```

- [ ] **Step 1: Write the failing test**

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PluginConsentDialog } from "../PluginConsentDialog";

const base = {
  name: "Demo",
  onCancel: vi.fn(),
  onConfirm: vi.fn(),
  reason: "first-install" as const,
};

describe("PluginConsentDialog (§260 Phase 5)", () => {
  it("lists every requested capability", () => {
    render(
      <PluginConsentDialog
        {...base}
        consent={{ capabilities: ["editor", "network"], trust: "sandboxed" }}
      />,
    );
    expect(screen.getByText(/문서를 읽고 수정할 수 있습니다/)).toBeTruthy();
    expect(screen.getByText(/네트워크 요청을 보낼 수 있습니다/)).toBeTruthy();
  });

  it("gates a trusted install behind an explicit acknowledgement", () => {
    const onConfirm = vi.fn();
    render(
      <PluginConsentDialog
        {...base}
        consent={{ capabilities: [], trust: "trusted" }}
        onConfirm={onConfirm}
      />,
    );
    const confirm = screen.getByRole("button", { name: /install/i });
    expect(confirm.hasAttribute("disabled")).toBe(true);
    fireEvent.click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("checkbox"));
    expect(confirm.hasAttribute("disabled")).toBe(false);
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("needs no acknowledgement for a sandboxed install", () => {
    const onConfirm = vi.fn();
    render(
      <PluginConsentDialog
        {...base}
        consent={{ capabilities: ["editor"], trust: "sandboxed" }}
        onConfirm={onConfirm}
      />,
    );
    expect(screen.queryByRole("checkbox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /install/i }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("marks only the capabilities the update adds", () => {
    render(
      <PluginConsentDialog
        {...base}
        consent={{ capabilities: ["editor", "network"], trust: "sandboxed" }}
        prior={{ capabilities: ["editor"], trust: "sandboxed" }}
        reason="escalation"
      />,
    );
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).not.toContain("NEW");
    expect(rows[1].textContent).toContain("NEW");
  });

  it("cancels without confirming", () => {
    const onCancel = vi.fn();
    render(
      <PluginConsentDialog
        {...base}
        consent={{ capabilities: [], trust: "sandboxed" }}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/plugins/__tests__/PluginConsentDialog.test.tsx`
Expected: FAIL — cannot resolve `../PluginConsentDialog`.

- [ ] **Step 3: Implement the component**

Key requirements the test pins: a `<ul>` of `<li>` capability rows (so `getAllByRole("listitem")` works), a `NEW` marker only on capabilities absent from `prior`, a checkbox rendered **only** for `trust === "trusted"` which gates the Install button, and buttons whose accessible names contain "Install"/"Cancel".

```tsx
import { useState } from "react";

import type { ConsentReason, PluginConsent } from "../../plugins/plugin-consent";
import type { PluginCapability } from "../../plugins/types";

import { CAPABILITY_DESCRIPTIONS } from "../../plugins/types";

interface PluginConsentDialogProps {
  consent: PluginConsent;
  name: string;
  onCancel: () => void;
  onConfirm: () => void;
  prior?: PluginConsent;
  reason: ConsentReason;
}

/**
 * §260 Phase 5 — the grant step the ADR listed as a residual: until now the install
 * UI *displayed* capabilities in a `window.confirm` and the loader passed
 * `manifest.capabilities` straight through.
 *
 * The acknowledgement checkbox exists only for the trusted tier because that is the
 * only tier where the capability list is not the boundary — a trusted plugin runs in
 * the app's own realm and holds everything regardless of what it declared.
 */
export function PluginConsentDialog({
  consent,
  name,
  onCancel,
  onConfirm,
  prior,
  reason,
}: PluginConsentDialogProps) {
  const [acknowledged, setAcknowledged] = useState(false);
  const trusted = consent.trust === "trusted";
  const held = new Set(prior?.capabilities ?? []);
  const blocked = trusted && !acknowledged;

  return (
    <div className="plugin-consent" role="dialog" aria-modal="true">
      <h2>
        {reason === "first-install" ? "Install" : "Update"} “{name}”?
      </h2>

      {trusted && (
        <div className="plugin-consent__danger">
          <strong>This plugin asks for full trust.</strong> It runs inside Baram itself
          with no sandbox: it can read and write any file your account can reach, contact
          any network host, and use every credential the app holds. The capability list
          below does not limit it.
        </div>
      )}

      <ul className="plugin-consent__caps">
        {consent.capabilities.map((cap) => (
          <li key={cap}>
            {CAPABILITY_DESCRIPTIONS[cap as PluginCapability] ?? cap}
            {prior && !held.has(cap) ? <span> — NEW</span> : null}
          </li>
        ))}
      </ul>

      {trusted && (
        <label>
          <input
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
            type="checkbox"
          />
          I understand this plugin is not sandboxed.
        </label>
      )}

      <div className="plugin-consent__actions">
        <button onClick={onCancel} type="button">
          Cancel
        </button>
        <button disabled={blocked} onClick={onConfirm} type="button">
          {reason === "first-install" ? "Install" : "Update and install"}
        </button>
      </div>
    </div>
  );
}
```

Note for the implementer: the update button's label contains "install", which is what the test's `/install/i` matcher finds in both modes — keep it that way or update the matcher.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/plugins/__tests__/PluginConsentDialog.test.tsx > /tmp/t3.log; echo $?`
Expected: exit 0.

- [ ] **Step 5: Mutation-verify the trusted gate**

Change `const blocked = trusted && !acknowledged;` to `const blocked = false;`. The trusted test must fail on the `disabled` assertion. Restore.

- [ ] **Step 6: Style it**

Add `.plugin-consent*` rules to the plugin stylesheet that already carries `.plugin-detail` (find it with `grep -rn "plugin-detail" src/styles/`). Use existing tokens only — `--color-bg-default`, `--color-text-muted`, `--color-status-danger`, `--shadow-lg`. Then run `npm run audit:css-vars` and confirm exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/components/plugins/PluginConsentDialog.tsx src/components/plugins/__tests__/PluginConsentDialog.test.tsx src/styles/
git commit -m "feat(§260): add the plugin install-consent dialog (Phase 5)"
```

---

### Task 4: Wire consent + registry cross-check into install and update

**Files:**
- Modify: `src/components/plugins/PluginMarketplace.tsx` (`handleInstall` ~292-332, `handleUpdate` ~349-377, render at ~485)
- Modify: `src/components/plugins/PluginDetail.tsx` (remove the `showTrustWarning` two-click at lines 39-46; disable Install for a legacy entry)
- Create: `src/components/plugins/__tests__/plugin-install-consent.test.tsx`

**Interfaces:**
- Consumes: `consentGaps`, `consentRequired`, `PluginConsent` (Task 1); `PluginConsentDialog` (Task 3); `validateManifest` from `src/plugins/manifest.ts`; `pluginTrustOf` from `src/plugins/plugin-trust.ts`; `pluginInstall`, `pluginUninstall` from `src/ipc/plugin-invoke`.
- Produces: `handleInstall(entry, preApproved?: PluginConsent)`.

- [ ] **Step 1: Write the failing test**

Mock `../../../ipc/plugin-invoke` and `../../../plugins/plugin-loader`, render `PluginMarketplace`, and assert on the store. Four behaviours:

```tsx
it("persists nothing when the download's trust exceeds what was approved", async () => {
  // registry claims sandboxed; the ZIP declares trusted
  mocks.pluginInstall.mockResolvedValue({
    checksum: "sha256:x",
    install_path: "/p",
    manifest: { ...validManifest, trust: "trusted" },
  });
  // …click Install, confirm the dialog…
  await waitFor(() => expect(mocks.pluginUninstall).toHaveBeenCalledWith("demo"));
  expect(usePluginStore.getState().installedPlugins.demo).toBeUndefined();
  expect(usePluginStore.getState().pluginErrors.demo).toContain("trusted");
});

it("persists nothing when the downloaded manifest fails validation", async () => {
  mocks.pluginInstall.mockResolvedValue({
    checksum: "sha256:x",
    install_path: "/p",
    manifest: { ...validManifest, trust: undefined },
  });
  // …click Install, confirm…
  await waitFor(() => expect(mocks.pluginUninstall).toHaveBeenCalled());
  expect(usePluginStore.getState().installedPlugins.demo).toBeUndefined();
});

it("records the consent alongside the plugin on success", async () => {
  // …click Install, confirm…
  await waitFor(() =>
    expect(usePluginStore.getState().installedPlugins.demo?.consent).toEqual({
      capabilities: ["editor"],
      trust: "sandboxed",
    }),
  );
});

it("installs nothing when the dialog is cancelled", async () => {
  // …click Install, then Cancel…
  expect(mocks.pluginInstall).not.toHaveBeenCalled();
});

it("refuses to install a legacy entry with no trust field", async () => {
  // entry without `trust`
  expect(screen.getByRole("button", { name: /install/i }).hasAttribute("disabled")).toBe(true);
  expect(mocks.pluginInstall).not.toHaveBeenCalled();
});
```

Fill in the elided click sequences using the marketplace's existing test helpers — copy the mock scaffolding from `src/components/plugins/__tests__/plugin-marketplace-toggle.test.tsx`, dropping its `vi.stubEnv("VITE_ENABLE_PLUGINS", "1")` (Task 7 removes that env entirely; until then the stub is harmless, but do not add new ones).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/plugins/__tests__/plugin-install-consent.test.tsx`
Expected: FAIL — `window.confirm` is still the prompt and nothing rolls back.

- [ ] **Step 3: Replace `handleInstall`**

```tsx
  const handleInstall = useCallback(
    async (entry: RegistryEntry, preApproved?: PluginConsent) => {
      // §260 Phase 5 — an entry predating the tier model cannot be installed at all:
      // `validateManifest` rejects a trust-less manifest, so without this the user
      // downloads first and meets a validation error second.
      if (!entry.trust) {
        setError(entry.id, LEGACY_ENTRY_MESSAGE);
        return;
      }
      // What the REGISTRY claims. The manifest inside the ZIP is the truth, and the
      // two are compared below — otherwise consent is theatre, because a registry
      // could advertise "sandboxed" and ship "trusted".
      const claimed: PluginConsent = {
        capabilities: [...entry.capabilities].sort(),
        trust: entry.trust,
      };
      const consent = preApproved ?? (await askConsent(entry.name, claimed, "first-install"));
      if (!consent) return;

      setInstalling(entry.id, true);
      try {
        const result = await pluginInstall(entry.downloadUrl, entry.checksum);
        const installedId = result.manifest.id;
        const reject = async (why: string) => {
          // Roll back before anything is persisted. Uses the id the ZIP actually
          // installed under, which is where the files landed.
          await pluginUninstall(installedId).catch(() => {});
          throw new Error(why);
        };

        const validation = validateManifest(result.manifest);
        if (!validation.valid) {
          await reject(
            `the downloaded manifest is invalid: ${validation.errors
              .map((e) => `${e.field}: ${e.message}`)
              .join("; ")}`,
          );
        }
        if (installedId !== entry.id) {
          await reject(
            `the download declares id "${installedId}" but the registry listed "${entry.id}"`,
          );
        }
        const gaps = consentGaps(consent, {
          capabilities: result.manifest.capabilities,
          trust: result.manifest.trust,
        });
        if (gaps.length > 0) {
          await reject(`the download does not match the registry listing — ${gaps.join("; ")}`);
        }

        addPlugin({
          checksum: result.checksum,
          consent,
          enabled: true,
          installedAt: Date.now(),
          installPath: result.install_path,
          manifest: result.manifest,
          updatedAt: Date.now(),
        });
        setError(entry.id, null);

        if (!result.manifest.tiptapExtensions?.length) {
          await pluginLoader.loadPlugin(result.install_path, result.manifest);
        }
      } catch (err) {
        setError(entry.id, String(err));
      } finally {
        setInstalling(entry.id, false);
      }
    },
    [addPlugin, askConsent, setError, setInstalling],
  );
```

Add near the other module constants:

```tsx
const LEGACY_ENTRY_MESSAGE =
  "This plugin predates Baram's plugin trust model and cannot be installed. " +
  "Ask the author to publish a manifest that declares a trust tier.";
```

- [ ] **Step 4: Add the dialog plumbing**

```tsx
  const [pendingConsent, setPendingConsent] = useState<null | {
    consent: PluginConsent;
    name: string;
    prior?: PluginConsent;
    reason: ConsentReason;
  }>(null);
  const consentResolver = useRef<null | ((v: PluginConsent | null) => void)>(null);

  const askConsent = useCallback(
    (name: string, consent: PluginConsent, reason: ConsentReason, prior?: PluginConsent) =>
      new Promise<PluginConsent | null>((resolve) => {
        consentResolver.current = resolve;
        setPendingConsent({ consent, name, prior, reason });
      }),
    [],
  );

  const settleConsent = useCallback((value: PluginConsent | null) => {
    setPendingConsent(null);
    consentResolver.current?.(value);
    consentResolver.current = null;
  }, []);
```

Render it above the existing return's root content:

```tsx
      {pendingConsent && (
        <PluginConsentDialog
          consent={pendingConsent.consent}
          name={pendingConsent.name}
          onCancel={() => settleConsent(null)}
          onConfirm={() => settleConsent(pendingConsent.consent)}
          prior={pendingConsent.prior}
          reason={pendingConsent.reason}
        />
      )}
```

- [ ] **Step 5: Replace `handleUpdate`**

```tsx
  const handleUpdate = useCallback(
    async (entry: RegistryEntry) => {
      if (!entry.trust) {
        setError(entry.id, LEGACY_ENTRY_MESSAGE);
        return;
      }
      const prior = installedPlugins[entry.id]?.consent;
      const claimed: PluginConsent = {
        capabilities: [...entry.capabilities].sort(),
        trust: entry.trust,
      };
      const reason = consentRequired(prior, claimed);
      // Record what is actually being installed, not the older (possibly wider)
      // grant — an update that narrows must narrow the record too.
      const consent =
        reason === null ? claimed : await askConsent(entry.name, claimed, reason, prior);
      if (!consent) return;

      // §260 Phase 5 — the consent is captured BEFORE the uninstall, because
      // `handleUninstall` calls `removePlugin`, which deletes the record we compare against.
      await handleUninstall(entry.id);
      await handleInstall(entry, consent);
      clearUpdateAvailable(entry.id);
    },
    [installedPlugins, askConsent, handleInstall, handleUninstall, clearUpdateAvailable, setError],
  );
```

- [ ] **Step 6: Simplify `PluginDetail`**

Delete `showTrustWarning`/`handleInstallClick` (lines 39-46) and call `onInstall` directly — the dialog now owns the warning. Disable the Install button and show `LEGACY_ENTRY_MESSAGE` when `entry.trust` is undefined. Keep `PluginTrustBadge`.

- [ ] **Step 7: Run the tests**

Run: `npx vitest run src/components/plugins > /tmp/t4.log; echo $?`
Expected: exit 0. Existing marketplace tests that relied on `window.confirm` must be updated to drive the dialog instead — do not delete their assertions.

- [ ] **Step 8: Mutation-verify the cross-check**

Comment out the `gaps.length > 0` branch. The "trust exceeds what was approved" test must fail. Restore.

- [ ] **Step 9: Commit**

```bash
git add src/components/plugins/
git commit -m "feat(§260): gate installs behind consent + verify the registry claim (Phase 5)"
```

---

### Task 5: Remove `localStorage` as a cross-realm surface

**Files:**
- Modify: `src/stores/ui/journal-layout.ts`
- Modify: `src/stores/file/bookmark.ts` (`loadBookmarks`/`saveBookmarks` at lines 79-96)
- Modify: `src/stores/system/tauri-storage.ts` (`MIGRATION_KEYS` line 47, add a prefix sweep)
- Modify: `src/components/sidebar/BookmarkPanel.tsx:34,41`, `src/hooks/use-keybinding-actions.ts:315`
- Create: `src/__tests__/no-local-storage.test.ts`

**Interfaces:**
- Produces: `loadBookmarks(rootPath): Promise<void>`, `saveBookmarks(rootPath): Promise<void>`.

- [ ] **Step 1: Write the failing guard test**

```ts
// §260 Phase 5 — every `plugin-*` sandbox webview is created with a RELATIVE url
// (`sandbox-host.ts`), so it shares an origin with the main window and therefore shares
// `localStorage`. Anything the app leaves there is readable and writable by a sandboxed
// plugin holding ZERO capabilities. Persist through `tauriStorage` (Rust config.json),
// which crosses no origin.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = resolve(__dirname, "..");

// The migration itself must read localStorage to drain it; nothing else may.
const ALLOWED = ["stores/system/tauri-storage.ts"];

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "__tests__" || name === "node_modules") continue;
      sources(full, out);
    } else if (/\.tsx?$/.test(name) && !name.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

describe("localStorage is not a shared surface (§260 Phase 5)", () => {
  it("is referenced only by the storage adapter that drains it", () => {
    const offenders = sources(SRC)
      .filter((f) => readFileSync(f, "utf8").includes("localStorage"))
      .map((f) => f.slice(SRC.length + 1))
      .filter((rel) => !ALLOWED.includes(rel));
    expect(
      offenders,
      "sandbox webviews share an origin with the main window, so localStorage is " +
        "readable by any plugin — persist through tauriStorage instead",
    ).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/no-local-storage.test.ts`
Expected: FAIL, listing `stores/file/bookmark.ts`.

- [ ] **Step 3: Move `journal-layout` to `tauriStorage`**

```ts
import { createJSONStorage, persist } from "zustand/middleware";

import { tauriStorage } from "../system/tauri-storage";
// …
    { name: "baram:journal-layout", storage: createJSONStorage(() => tauriStorage) },
```

Add `"baram:journal-layout"` to `MIGRATION_KEYS` in `tauri-storage.ts` so an existing user's collapse state survives.

- [ ] **Step 4: Move bookmarks, and sweep their per-vault keys**

`bookmark.ts` — replace the two methods (keep `storageKey` exported; the sweep and the tests use it):

```ts
  loadBookmarks: async (rootPath) => {
    try {
      const raw = await tauriStorage.getItem(storageKey(rootPath));
      set({ bookmarks: raw ? (JSON.parse(raw) as BookmarkItem[]) : [] });
    } catch {
      set({ bookmarks: [] });
    }
  },

  saveBookmarks: async (rootPath) => {
    await tauriStorage.setItem(storageKey(rootPath), JSON.stringify(get().bookmarks));
  },
```

Update the `BookmarkState` interface to `Promise<void>` returns, and the three call sites to `void loadBookmarks(rootPath)` / `void saveBookmarks(rootPath)`.

`tauri-storage.ts` — the bookmark key embeds the vault root, so a static list cannot name it:

```ts
/**
 * Keys whose exact name is fixed. Bookmarks are NOT here: `baram:bookmarks:{vaultRoot}`
 * is one key per vault the user has ever opened, so they are swept by prefix below.
 */
const MIGRATION_KEYS = ["baram:settings", "baram:ai-settings", "baram:journal-layout"];

/** §260 Phase 5 — per-vault bookmark keys, discovered rather than enumerated. */
const MIGRATION_PREFIXES = ["baram:bookmarks:"];

function keysToMigrate(): string[] {
  const found = [...MIGRATION_KEYS];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && MIGRATION_PREFIXES.some((p) => key.startsWith(p))) found.push(key);
  }
  return found;
}
```

…and iterate `keysToMigrate()` in `migrateFromLocalStorage` instead of `MIGRATION_KEYS`.

- [ ] **Step 5: Test the sweep**

Add to `src/stores/system/__tests__/tauri-storage.test.ts` (create if absent): seed `localStorage` with two `baram:bookmarks:*` keys plus one unrelated key, run `migrateFromLocalStorage()` against a fake `getConfig`/`setConfig`, and assert both bookmark keys moved and were removed while the unrelated key stayed.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run src/__tests__/no-local-storage.test.ts src/stores > /tmp/t5.log; echo $?`
Expected: exit 0.

- [ ] **Step 7: Mutation-verify**

Remove `MIGRATION_PREFIXES` from `keysToMigrate`. The sweep test must fail. Restore.

- [ ] **Step 8: Commit**

```bash
git add src/stores src/components/sidebar/BookmarkPanel.tsx src/hooks/use-keybinding-actions.ts src/__tests__/no-local-storage.test.ts
git commit -m "fix(§260): stop persisting to localStorage, which sandboxes share (Phase 5)"
```

---

### Task 6: Global CSP admits `blob:`

**Files:**
- Modify: `src-tauri/tauri.conf.json` (`app.security.csp`)
- Modify: `sandbox.html` (the comment block, lines 27-38)
- Modify: `src/plugins/__tests__/plugins-enabled.csp.test.ts`

- [ ] **Step 1: Invert the guardrail test**

Replace the first `it(...)` (lines 62-81) and delete the now-subjectless `sandboxIsDevGated` helper (lines 47-52):

```ts
  it("keeps every source the sandbox needs present in the global policy", () => {
    const missing = directive(sandboxMetaCsp(), "script-src").filter(
      (src) => !directive(globalCsp(), "script-src").includes(src),
    );
    expect(
      missing,
      "a <meta> CSP can only TIGHTEN the policy a document is served with, and a " +
        "packaged build serves sandbox.html with the global csp from tauri.conf.json " +
        "as a header. Anything listed here is blocked in release even though it works " +
        "in dev, where the sandbox loads the Vite devUrl with no Tauri header.",
    ).toEqual([]);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/plugins/__tests__/plugins-enabled.csp.test.ts`
Expected: FAIL — `["blob:"]` is missing from the global `script-src`.

- [ ] **Step 3: Add `blob:` to the global script-src**

In `src-tauri/tauri.conf.json`, change the `script-src` term only:

```
script-src 'self' asset: http://asset.localhost blob:;
```

Leave every other directive untouched.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/plugins/__tests__/plugins-enabled.csp.test.ts > /tmp/t6.log; echo $?`
Expected: exit 0, both tests pass.

- [ ] **Step 5: Rewrite the `sandbox.html` decision comment**

Replace the "Phase 5 MUST decide this" paragraph with the decision and its two supporting findings — the `worker-src 'self' blob:` that already permits blob-sourced code execution in this origin, and the reason `connect-src` needs nothing (tauri's `ipc-protocol.js` falls back to `window.ipc.postMessage` permanently when the custom-protocol fetch is CSP-blocked, so the whole app already runs on that fallback; a blocked module script has no fallback). Keep the `asset:`-stays-out paragraph verbatim.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/tauri.conf.json sandbox.html src/plugins/__tests__/plugins-enabled.csp.test.ts
git commit -m "feat(§260): allow blob: in the global script-src so sandboxes load in release (Phase 5)"
```

---

### Task 7: Lift the release gate

Last on purpose: every task above is a precondition. If the series is ever split, the gate must not lift ahead of them.

**Files:**
- Delete: `src/plugins/plugins-enabled.ts`
- Modify: `src/plugins/plugin-lifecycle.ts:25,75-81`; `src/plugins/plugin-loader.ts:32,136,273-277`; `src/components/plugins/PluginMarketplace.tsx:183,255,430`
- Modify: `src/plugins/__tests__/plugin-containment.test.ts` (repurpose)
- Modify: `src/plugins/__tests__/plugin-loader.test.ts:10,106`; `src/plugins/__tests__/plugin-lifecycle.errors.test.ts:67`; `src/components/plugins/__tests__/plugin-marketplace-refresh.test.tsx:42,215`; `src/components/plugins/__tests__/plugin-marketplace-toggle.test.tsx:62`
- Modify: `src-tauri/src/plugin/mod.rs:11-25`; `src-tauri/src/commands/plugin_cmd.rs:12,59,96,140,162`

- [ ] **Step 1: Repurpose the containment test**

`plugin-containment.test.ts` guards a property that is being removed, but the property *underneath* it survives: untrusted code must never reach the main realm. Replace the three `VITE_ENABLE_PLUGINS` cases with one that pins the surviving invariant — a `sandboxed` manifest routes to `SandboxHost`, never to the same-realm loader — plus one that pins the legacy refusal:

```ts
  it("routes a sandboxed manifest away from the main realm", async () => {
    // …load a sandboxed manifest through pluginLoader with the sandbox host mocked…
    expect(mocks.startSandbox).toHaveBeenCalledTimes(1);
    expect(mocks.importMainRealmModule).not.toHaveBeenCalled();
  });

  it("refuses a legacy manifest that declares no tier", async () => {
    await expect(load({ ...manifest, trust: undefined })).rejects.toThrow(/trust/);
  });
```

Rewrite the file's header comment: it currently opens "Plugins run in the app's own JS realm with no isolation", which stops being true here.

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run src/plugins/__tests__/plugin-containment.test.ts`
Expected: FAIL — the new cases are not wired yet.

- [ ] **Step 3: Delete the frontend gate**

`rm src/plugins/plugins-enabled.ts`, then remove each import and its branch:
- `plugin-lifecycle.ts` — drop the `if (!arePluginsEnabled())` early return (lines 75-81) and the import.
- `plugin-loader.ts` — drop the guard at 136 and the `isSandboxRuntimeAllowed()` guard at 273-277 with its comment, and the import at 32.
- `PluginMarketplace.tsx` — drop the guard at 255, the disabled-state render at 430, and the import at 183.

- [ ] **Step 4: Drop the `stubEnv` calls from the five test files**

Delete every `vi.stubEnv("VITE_ENABLE_PLUGINS", …)` line listed under **Files**. Tests that asserted the disabled behaviour (`plugin-loader.test.ts:106`, `plugin-marketplace-refresh.test.tsx:215`) lose their subject — delete those cases; the containment test now carries the surviving property.

- [ ] **Step 5: Split the Rust gate**

`src-tauri/src/plugin/mod.rs` — rename and re-document:

```rust
/// §260 Phase 5 — dev-folder side-loading stays a dev-build affordance. It bypasses the
/// checksum, the registry listing, and the install consent record, and it exists to serve
/// plugin authors, who run dev builds.
///
/// This used to be `plugins_runtime_enabled`, gating install/scopes/http/storage as well.
/// Phase 5 opened those: the sandboxed tier cannot function without them, and the boundary
/// is now the Rust authorizer rather than a build flag.
pub fn dev_plugin_loading_enabled() -> bool {
    cfg!(debug_assertions)
}
```

Keep `plugins_disabled_error()` but reword it to name the actual restriction (dev-only side-loading), since it now has one caller.

`plugin_cmd.rs` — delete the four-line guard from `plugin_install` (12), `plugin_prepare_scopes` (59), `plugin_http_fetch` (140) and `plugin_storage_write` (162), including each `// §259 —` comment. In `plugin_add_dev_folder` (96) keep the guard, calling the renamed function.

- [ ] **Step 6: Run every gate**

```bash
npm test > /tmp/vitest.log; echo "vitest:$?"
npm run typecheck > /tmp/tc.log; echo "tsc:$?"
cd src-tauri && cargo clippy --all-targets > /tmp/clippy.log 2>&1; echo "clippy:$?"; cd ..
cargo test --manifest-path src-tauri/Cargo.toml > /tmp/cargo.log 2>&1; echo "cargo:$?"
npx knip > /tmp/knip.log; echo "knip:$?"
```

All must be 0. `knip` in particular will catch anything left orphaned by the deleted module.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(§260): lift the plugin release gate (Phase 5)"
```

---

### Task 8: Documentation

**Files:**
- Modify: `dev/superpowers/specs/2026-07-23-plugin-execution-model-260-design.md` (§10 phase 5, the residuals list, the Bounds section)
- Modify: `docs/plugin-development.md`
- Modify: `src-tauri/ipc-registry.json` if any command signature changed (none expected — only guards were removed)

- [ ] **Step 1: Update the ADR**

Mark phase 5 `[DONE]` with the commit. Strike the residual sentence "A dedicated consent/opt-in flow is Phase 5 work" and replace it with what shipped. Add to Bounds: `plugin-*` webviews still share an origin with each other, so two installed plugins can collude via `BroadcastChannel`/`SharedWorker`; both must be user-installed and exfiltration needs a `network`-granted accomplice. Tick the completion criteria that are now true, including "Trusted install requires a full-trust warning + separate opt-in".

- [ ] **Step 2: Update the plugin-author docs**

Document that a manifest without `trust` cannot be installed; that capability changes on update re-prompt while narrowing does not; and that `files`/`editor` imply their `:readonly` forms.

- [ ] **Step 3: Commit**

```bash
git add dev/ docs/ src-tauri/ipc-registry.json
git commit -m "docs(§260): record the Phase 5 release-gate transition"
```

---

### Task 9: Review, live smoke, PR

- [ ] **Step 1: Dispatch review agents in parallel** — `oh-my-claudecode:code-reviewer` (opus) and `oh-my-claudecode:security-reviewer`, both over the whole branch diff, not per task. Whole-branch review has caught defects per-task review missed every time on this project.
- [ ] **Step 2: Fix every finding**, each mutation-verified. Expect findings in the fixes themselves — that has happened in every phase.
- [ ] **Step 3: Live smoke from a PACKAGED build** — `npm run tauri build`, install the artifact, load `examples/plugins/sandbox-smoke`. This is the one thing no unit test substitutes for, and the reason the phase exists. Dev-folder loading is still dev-gated, so the smoke fixture must be installed through the registry path or side-loaded in a dev build; verify the packaged build separately by confirming a sandboxed plugin's webview loads its bundle (the `blob:` CSP change is exactly what this proves).
- [ ] **Step 4: Open the PR** with motivation, design considerations, a Mermaid architecture diagram, detailed implementation notes, completeness, test results and a checklist. Body via `gh api repos/…/pulls/N -X PATCH -F body=@file` — `gh pr edit` is broken here.

---

## Self-review

**Spec coverage:** §1 gate → Task 7. §2 CSP → Task 6. §3 consent → Tasks 1-3. §4 cross-check → Task 4. §5 localStorage → Task 5. §6 legacy entries → Task 4 (steps 3, 6). §7 testing → distributed, with the packaged smoke in Task 9. §8 deferrals → Task 8 (Bounds).

**Open risk carried into execution:** Task 4's test file elides its click sequences because the marketplace's existing test scaffolding is the wrong thing to duplicate blind — the implementer must copy it from `plugin-marketplace-toggle.test.tsx` and adapt. If that scaffolding turns out not to reach the Install button, write the test against `PluginDetail` instead and say so.

**Known ordering constraint:** Task 7 must stay last. Task 5 is independent and may move earlier if convenient.
