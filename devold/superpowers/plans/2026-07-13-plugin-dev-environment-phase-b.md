# Plugin Dev Environment — Phase B (Real UI APIs) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the stubbed `context.ui` into real, capability-gated APIs — `showNotification` fires a real toast, `showStatusBarItem` renders in the status bar, and `addStyle` injects plugin CSS — all auto-cleaned on plugin unload.

**Architecture:** A new `plugin-ui-store` (Zustand) holds plugin-registered status-bar items; `StatusBar` renders them via a `PluginStatusBarItems` slot component. `context.ui.showNotification` delegates to the existing `useUIStore.showToast` (extended with an optional `type`). `context.ui.addStyle` injects a `<style data-baram-plugin="id">` into `document.head`. Every registration returns a `Disposable` that is auto-pushed to the plugin's `subscriptions` (Obsidian-style auto-cleanup), so `pluginLoader.unloadPlugin` tears everything down; `unregisterPlugin` in the store is a belt-and-suspenders sweep.

**Tech Stack:** TypeScript/React 19, Zustand (+ `useShallow`), Vitest + @testing-library/react (jsdom).

## Global Constraints

- Builds on branch `feature/plugin-dev-environment-phase-b` (stacked on Phase A). Stay on it.
- Zustand: components MUST use `useShallow` selectors; never bare `useStore()` for multi-field/derived selections.
- `context.ui` is created only when the plugin declares `sidebar` OR `statusbar` capability (`extension-context.ts:141-144`); without it, `context.ui` is a denied proxy that throws on access. Do NOT change that gate.
- All new `context.ui` registrations return a `Disposable` and MUST be pushed to the `disposables` array (auto-cleanup on unload).
- Genuine CSS selector-scoping is NOT in scope for `addStyle` (deferred to Phase C shadow-DOM panels). `addStyle` injects a plugin-id-tagged `<style>` and removes it on dispose; selector isolation is the plugin author's responsibility (Obsidian model). Document this honestly; do not claim auto-scoping.
- TS strict; camelCase functions; kebab-case filenames; components/Extensions PascalCase; files ≤ ~300 lines.
- Tests via vitest (`npm test`), never jest. jsdom env, setup `./src/test-setup.ts`.
- **Lint gate (CI + Husky lint-staged):** before every commit run `npx eslint --fix <files>` + `npx prettier --write <files>` + `npx eslint --max-warnings=0 <files>` (clean). NEVER `git commit --no-verify`.
- Commits: Conventional Commits, English, reference `§69`.

## File Structure

- Create: `src/plugins/plugin-ui-store.ts` — Zustand store for plugin-registered status-bar items (one responsibility).
- Create: `src/components/layout/PluginStatusBarItems.tsx` — slot component rendering store items for one alignment.
- Modify: `src/stores/ui/ui.ts` — `ToastState.type` + `showToast(message, type?)`.
- Modify: `src/components/editor/Toast.tsx` — apply a `toast-{type}` class.
- Modify: `src/styles/dialogs.css` — toast type variants.
- Modify: `src/components/layout/StatusBar.tsx` — render `<PluginStatusBarItems>` in left/right regions.
- Modify: `src/plugins/extension-context.ts` — real `createUIAPI(pluginId, disposables)`.
- Modify: `src/plugins/types.ts` — `StatusBarItem` type + `UIAPI` (add `addStyle`, `showStatusBarItem` returns `StatusBarItem`).
- Modify: `src/plugins/plugin-loader.ts` — `unregisterPlugin` sweep on unload.
- Tests: `src/plugins/__tests__/plugin-ui-store.test.ts`, `src/components/layout/__tests__/PluginStatusBarItems.test.tsx`, and extend `src/plugins/__tests__/extension-context.test.ts`.

---

### Task 1: Toast type variants

**Files:**
- Modify: `src/stores/ui/ui.ts:33-37` (`ToastState`), `:96` (interface), `:171-172` (impl)
- Modify: `src/components/editor/Toast.tsx:26-30`
- Modify: `src/styles/dialogs.css` (after `.toast` rule at line ~1592)
- Test: `src/stores/ui/__tests__/ui.test.ts` (create or extend if present)

**Interfaces:**
- Produces: `showToast(message: string, type?: "error" | "info" | "warning"): void`; `ToastState { id: number; message: string; type?: "error" | "info" | "warning" }`

- [ ] **Step 1: Write the failing test**

Create/extend `src/stores/ui/__tests__/ui.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";

import { useUIStore } from "../ui";

describe("useUIStore.showToast", () => {
  beforeEach(() => useUIStore.setState({ toast: null }));

  it("stores an optional type and bumps id", () => {
    useUIStore.getState().showToast("hi");
    expect(useUIStore.getState().toast).toMatchObject({ message: "hi" });
    expect(useUIStore.getState().toast?.type).toBeUndefined();

    useUIStore.getState().showToast("careful", "warning");
    expect(useUIStore.getState().toast).toMatchObject({
      message: "careful",
      type: "warning",
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- stores/ui 2>&1 | tail -15`
Expected: FAIL — `showToast` rejects a 2nd arg / `type` not stored.

- [ ] **Step 3: Extend `ToastState`, the interface, and the impl in `ui.ts`**

`ToastState` (line 33):
```ts
export interface ToastState {
  /** Monotonic id — changing it restarts the auto-dismiss timer */
  id: number;
  message: string;
  type?: "error" | "info" | "warning";
}
```
Interface member (line ~96):
```ts
  showToast: (message: string, type?: "error" | "info" | "warning") => void;
```
Impl (line ~171):
```ts
      showToast: (message, type) =>
        set((state) => ({
          toast: { id: (state.toast?.id ?? 0) + 1, message, type },
        })),
```

- [ ] **Step 4: Apply the type class in `Toast.tsx`**

Replace the inner toast div (line ~28):
```tsx
      <div
        className={`toast${toast.type ? ` toast-${toast.type}` : ""}`}
        role="status"
      >
        {toast.message}
      </div>
```

- [ ] **Step 5: Add variant CSS in `dialogs.css`** (immediately after the existing `.toast { ... }` block)

```css
.toast-info {
  border-left: 3px solid var(--color-accent-default);
}

.toast-warning {
  border-left: 3px solid var(--color-warning-default, #d19a00);
}

.toast-error {
  border-left: 3px solid var(--color-danger-default, #d13438);
}
```
> Run `npm run audit:css-vars` if present; if `--color-warning-default`/`--color-danger-default` are undefined, drop to the literal fallback already inlined above (keep the fallback), or use an existing danger/warning token found via `grep -rn "danger\|warning" src/styles/generated`. Note what you chose.

- [ ] **Step 6: Run test + lint**

Run: `npm test -- stores/ui 2>&1 | tail -8` (PASS), then eslint/prettier per Global Constraints on the 3 changed source files + test.

- [ ] **Step 7: Commit**

```bash
git commit -m "feat(§69): toast type variants (info/warning/error)"
```

---

### Task 2: `plugin-ui-store` (status-bar item registry)

**Files:**
- Create: `src/plugins/plugin-ui-store.ts`
- Test: `src/plugins/__tests__/plugin-ui-store.test.ts`

**Interfaces:**
- Produces:
```ts
export interface PluginStatusBarItem {
  align: "left" | "right";
  itemId: string;
  pluginId: string;
  text: string;
}
// store actions:
registerStatusBarItem(item: PluginStatusBarItem): void
updateStatusBarItem(itemId: string, text: string): void
removeStatusBarItem(itemId: string): void
unregisterPlugin(pluginId: string): void
// state: statusBarItems: PluginStatusBarItem[]
export const usePluginUIStore
```

- [ ] **Step 1: Write the failing test**

Create `src/plugins/__tests__/plugin-ui-store.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";

import { usePluginUIStore } from "../plugin-ui-store";

const item = (itemId: string, pluginId = "p1") => ({
  align: "right" as const,
  itemId,
  pluginId,
  text: "hi",
});

describe("plugin-ui-store status bar items", () => {
  beforeEach(() => usePluginUIStore.setState({ statusBarItems: [] }));

  it("registers, updates, and removes an item", () => {
    usePluginUIStore.getState().registerStatusBarItem(item("a"));
    expect(usePluginUIStore.getState().statusBarItems).toHaveLength(1);

    usePluginUIStore.getState().updateStatusBarItem("a", "bye");
    expect(usePluginUIStore.getState().statusBarItems[0].text).toBe("bye");

    usePluginUIStore.getState().removeStatusBarItem("a");
    expect(usePluginUIStore.getState().statusBarItems).toHaveLength(0);
  });

  it("unregisterPlugin drops all items for a plugin", () => {
    usePluginUIStore.getState().registerStatusBarItem(item("a", "p1"));
    usePluginUIStore.getState().registerStatusBarItem(item("b", "p2"));
    usePluginUIStore.getState().registerStatusBarItem(item("c", "p1"));
    usePluginUIStore.getState().unregisterPlugin("p1");
    const remaining = usePluginUIStore.getState().statusBarItems;
    expect(remaining).toHaveLength(1);
    expect(remaining[0].pluginId).toBe("p2");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- plugin-ui-store 2>&1 | tail -12`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/plugins/plugin-ui-store.ts`**

```ts
// §69 Plugin UI registry — plugin-registered status-bar items (runtime only)
import { create } from "zustand";

export interface PluginStatusBarItem {
  align: "left" | "right";
  itemId: string;
  pluginId: string;
  text: string;
}

interface PluginUIState {
  registerStatusBarItem: (item: PluginStatusBarItem) => void;
  removeStatusBarItem: (itemId: string) => void;
  statusBarItems: PluginStatusBarItem[];
  unregisterPlugin: (pluginId: string) => void;
  updateStatusBarItem: (itemId: string, text: string) => void;
}

export const usePluginUIStore = create<PluginUIState>()((set) => ({
  statusBarItems: [],

  registerStatusBarItem: (item) =>
    set((state) => ({ statusBarItems: [...state.statusBarItems, item] })),

  updateStatusBarItem: (itemId, text) =>
    set((state) => ({
      statusBarItems: state.statusBarItems.map((i) =>
        i.itemId === itemId ? { ...i, text } : i,
      ),
    })),

  removeStatusBarItem: (itemId) =>
    set((state) => ({
      statusBarItems: state.statusBarItems.filter((i) => i.itemId !== itemId),
    })),

  unregisterPlugin: (pluginId) =>
    set((state) => ({
      statusBarItems: state.statusBarItems.filter(
        (i) => i.pluginId !== pluginId,
      ),
    })),
}));
```

- [ ] **Step 4: Run test to verify it passes + lint**

Run: `npm test -- plugin-ui-store 2>&1 | tail -8` (PASS), then eslint/prettier on the 2 files.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(§69): plugin-ui-store for plugin status-bar items"
```

---

### Task 3: `PluginStatusBarItems` slot + StatusBar wiring

**Files:**
- Create: `src/components/layout/PluginStatusBarItems.tsx`
- Modify: `src/components/layout/StatusBar.tsx` (render slots in left @ ~line 229 and right @ ~line 250)
- Modify: status-bar CSS (grep `.status-bar-left` in `src/styles` — likely `layout.css`; add `.status-plugin-item`)
- Test: `src/components/layout/__tests__/PluginStatusBarItems.test.tsx`

**Interfaces:**
- Consumes: `usePluginUIStore` (Task 2).
- Produces: `<PluginStatusBarItems align="left" | "right" />`.

- [ ] **Step 1: Write the failing test**

Create `src/components/layout/__tests__/PluginStatusBarItems.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { usePluginUIStore } from "../../../plugins/plugin-ui-store";
import { PluginStatusBarItems } from "../PluginStatusBarItems";

describe("PluginStatusBarItems", () => {
  beforeEach(() => usePluginUIStore.setState({ statusBarItems: [] }));

  it("renders only items matching the alignment", () => {
    usePluginUIStore.setState({
      statusBarItems: [
        { align: "right", itemId: "r1", pluginId: "p", text: "RightItem" },
        { align: "left", itemId: "l1", pluginId: "p", text: "LeftItem" },
      ],
    });
    render(<PluginStatusBarItems align="right" />);
    expect(screen.getByText("RightItem")).toBeInTheDocument();
    expect(screen.queryByText("LeftItem")).not.toBeInTheDocument();
  });

  it("renders nothing when no items match", () => {
    const { container } = render(<PluginStatusBarItems align="left" />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- PluginStatusBarItems 2>&1 | tail -12`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `PluginStatusBarItems.tsx`**

```tsx
// §69 Plugin status-bar slot — renders plugin-registered items for one alignment
import { useShallow } from "zustand/shallow";

import { usePluginUIStore } from "../../plugins/plugin-ui-store";

export function PluginStatusBarItems({ align }: { align: "left" | "right" }) {
  const items = usePluginUIStore(
    useShallow((s) => s.statusBarItems.filter((i) => i.align === align)),
  );
  if (items.length === 0) return null;
  return (
    <>
      {items.map((item) => (
        <span className="status-plugin-item cursor-default" key={item.itemId}>
          {item.text}
        </span>
      ))}
    </>
  );
}
```

- [ ] **Step 4: Wire into `StatusBar.tsx`**

Add the import near the other component imports:
```tsx
import { PluginStatusBarItems } from "./PluginStatusBarItems";
```
In `.status-bar-left`, immediately before its closing `</div>` (after the favorite-button block, ~line 229):
```tsx
        <PluginStatusBarItems align="left" />
```
In `.status-bar-right`, immediately before its closing `</div>` (after the zoom block, ~line 250):
```tsx
          <PluginStatusBarItems align="right" />
```

- [ ] **Step 5: Add `.status-plugin-item` CSS**

`grep -rn "\.status-bar-left\|\.status-mode" src/styles` to find the status-bar CSS file (likely `src/styles/layout.css`). Add, matching neighboring status-bar item rules:
```css
.status-plugin-item {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs, 11px);
}
```
> Use an existing status-bar font-size token if the neighbors use one; match them rather than introducing `--font-size-xs` if it doesn't exist (grep first).

- [ ] **Step 6: Run test + full check + lint**

Run: `npm test -- PluginStatusBarItems 2>&1 | tail -8` (PASS); `npx tsc --noEmit` (clean); eslint/prettier on the new + modified files.

- [ ] **Step 7: Commit**

```bash
git commit -m "feat(§69): render plugin status-bar items in StatusBar"
```

---

### Task 4: Real `context.ui` APIs + types + unload sweep

**Files:**
- Modify: `src/plugins/types.ts` (`StatusBarItem` type; `UIAPI`)
- Modify: `src/plugins/extension-context.ts` (`createUIAPI` real impl + call site + `unregisterPluginUI` export)
- Modify: `src/plugins/plugin-loader.ts` (`unloadPlugin` sweeps the UI store)
- Test: extend `src/plugins/__tests__/extension-context.test.ts`

**Interfaces:**
- Consumes: `useUIStore.showToast` (Task 1), `usePluginUIStore` (Task 2).
- Produces (types):
```ts
export interface StatusBarItem {
  dispose(): void;
  setText(text: string): void;
}
export interface UIAPI {
  addStyle(css: string): Disposable;
  showNotification(message: string, type?: "error" | "info" | "warning"): void;
  showStatusBarItem(text: string, align?: "left" | "right"): StatusBarItem;
}
```
- Produces: `createUIAPI(pluginId: string, disposables: Disposable[]): UIAPI`; `unregisterPluginUI(pluginId: string): void`.

- [ ] **Step 1: Write the failing tests** (extend `extension-context.test.ts`)

Read the existing test file first for its imports/patterns, then add:

```ts
import { usePluginUIStore } from "../plugin-ui-store";
import { useUIStore } from "../../stores/ui/ui";

// manifest helper — reuse the file's existing one if present; else:
function mf(caps: string[]) {
  return {
    id: "ui-plugin", name: "UI", description: "", version: "1.0.0",
    author: "", license: "MIT", main: "index.mjs",
    engines: { baram: ">=0.2.0" }, capabilities: caps,
  } as unknown as import("../types").PluginManifest;
}

describe("ExtensionContext ui API", () => {
  beforeEach(() => {
    usePluginUIStore.setState({ statusBarItems: [] });
    useUIStore.setState({ toast: null });
    document.head.querySelectorAll("style[data-baram-plugin]").forEach((n) => n.remove());
  });

  it("denies ui without sidebar/statusbar capability", () => {
    const ctx = createExtensionContext(mf(["commands"]), "/p");
    expect(() => ctx.ui.showNotification("x")).toThrow(/statusbar|sidebar|capability/i);
  });

  it("showNotification fires a toast with the type", () => {
    const ctx = createExtensionContext(mf(["statusbar"]), "/p");
    ctx.ui.showNotification("hello", "warning");
    expect(useUIStore.getState().toast).toMatchObject({ message: "hello", type: "warning" });
  });

  it("showStatusBarItem registers, updates via setText, and disposes", () => {
    const ctx = createExtensionContext(mf(["statusbar"]), "/p");
    const handle = ctx.ui.showStatusBarItem("A", "left");
    expect(usePluginUIStore.getState().statusBarItems).toHaveLength(1);
    expect(usePluginUIStore.getState().statusBarItems[0]).toMatchObject({ align: "left", text: "A" });
    handle.setText("B");
    expect(usePluginUIStore.getState().statusBarItems[0].text).toBe("B");
    handle.dispose();
    expect(usePluginUIStore.getState().statusBarItems).toHaveLength(0);
  });

  it("addStyle injects a tagged <style> and removes it on dispose", () => {
    const ctx = createExtensionContext(mf(["statusbar"]), "/p");
    const d = ctx.ui.addStyle(".x{color:red}");
    const el = document.head.querySelector('style[data-baram-plugin="ui-plugin"]');
    expect(el?.textContent).toBe(".x{color:red}");
    d.dispose();
    expect(document.head.querySelector('style[data-baram-plugin="ui-plugin"]')).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- extension-context 2>&1 | tail -20`
Expected: FAIL — `ui.addStyle` undefined / showNotification is console stub (no toast) / showStatusBarItem returns Disposable not registering.

- [ ] **Step 3: Update `types.ts`** — replace the `UIAPI` interface (types.ts:127-131) and add `StatusBarItem`:

```ts
export interface StatusBarItem {
  dispose(): void;
  setText(text: string): void;
}

export interface UIAPI {
  addStyle(css: string): Disposable;
  showNotification(message: string, type?: "error" | "info" | "warning"): void;
  showStatusBarItem(text: string, align?: "left" | "right"): StatusBarItem;
}
```

- [ ] **Step 4: Rewrite `createUIAPI` in `extension-context.ts`** (replace the stub at lines ~236-258) and update its call site (line ~143) to pass `manifest.id`:

Call site (line ~143): `? createUIAPI(manifest.id, disposables)`.

Add near the top imports:
```ts
import { useUIStore } from "../stores/ui/ui";
import { usePluginUIStore } from "./plugin-ui-store";
```

New implementation (module-level counter for unique ids):
```ts
let uiItemCounter = 0;

function createUIAPI(pluginId: string, disposables: Disposable[]): UIAPI {
  return {
    showNotification(
      message: string,
      type?: "error" | "info" | "warning",
    ): void {
      useUIStore.getState().showToast(message, type);
    },
    showStatusBarItem(
      text: string,
      align: "left" | "right" = "right",
    ): StatusBarItem {
      const itemId = `${pluginId}:sb:${++uiItemCounter}`;
      usePluginUIStore
        .getState()
        .registerStatusBarItem({ align, itemId, pluginId, text });
      const item: StatusBarItem = {
        setText: (t) => usePluginUIStore.getState().updateStatusBarItem(itemId, t),
        dispose: () => usePluginUIStore.getState().removeStatusBarItem(itemId),
      };
      disposables.push({ dispose: item.dispose });
      return item;
    },
    addStyle(css: string): Disposable {
      const el = document.createElement("style");
      el.setAttribute("data-baram-plugin", pluginId);
      el.textContent = css;
      document.head.appendChild(el);
      const disposable: Disposable = { dispose: () => el.remove() };
      disposables.push(disposable);
      return disposable;
    },
  };
}
```
Import the `StatusBarItem` type alongside `UIAPI` in the existing `import type { ... } from "./types"` block. Remove the now-unused `logger` import ONLY if nothing else in the file uses it (check first — `emitPluginEvent`/event errors use `logger`, so keep it).

- [ ] **Step 5: Add `unregisterPluginUI` + wire unload sweep**

In `extension-context.ts`, export a helper:
```ts
export function unregisterPluginUI(pluginId: string): void {
  usePluginUIStore.getState().unregisterPlugin(pluginId);
  document.head
    .querySelectorAll(`style[data-baram-plugin="${pluginId}"]`)
    .forEach((n) => n.remove());
}
```
In `plugin-loader.ts` `unloadPlugin`, after disposing the plugin's disposables (after the dispose loop, before `this.loaded.delete(id)`), call it:
```ts
    unregisterPluginUI(id);
```
Add `unregisterPluginUI` to the existing import from `./extension-context`.

- [ ] **Step 6: Run tests + tsc + lint**

Run: `npm test -- extension-context 2>&1 | tail -20` (PASS), `npm test -- plugin 2>&1 | tail -6` (no regressions), `npx tsc --noEmit` (clean), eslint/prettier on all changed files.

- [ ] **Step 7: Commit**

```bash
git commit -m "feat(§69): real context.ui — showNotification/showStatusBarItem/addStyle + unload sweep"
```

---

## Self-Review

**Spec coverage (spec §4.1 ui + §5.1-5.2 + §11 Phase B):**
- `showNotification` → real toast (Task 1 + Task 4). ✓
- `showStatusBarItem` → StatusBar slot (Task 2 store + Task 3 render + Task 4 API). ✓
- `plugin-ui-store` (Task 2). ✓
- `provideStyle`/`addStyle` (Task 4; selector-scoping deferred, documented). ✓
- Auto-cleanup: every ui registration pushes a Disposable (Task 4); `unloadPlugin` disposes them AND sweeps the store/DOM (Task 4 Step 5). ✓

**Placeholder scan:** none — all code is concrete. The only "locate it" steps (toast CSS confirmed at `dialogs.css`; status-bar CSS + font-size token) instruct a `grep` because the exact line/token must be matched to neighbors; the rules themselves are given.

**Type consistency:** `StatusBarItem { setText; dispose }` defined in Task 4 types matches its use in `createUIAPI`. `PluginStatusBarItem { align; itemId; pluginId; text }` identical across Task 2 (store), Task 3 (component), Task 4 (registration). `showToast(message, type?)` defined Task 1, consumed Task 4. `usePluginUIStore` actions (`registerStatusBarItem/updateStatusBarItem/removeStatusBarItem/unregisterPlugin`) consistent Tasks 2/4. `createUIAPI(pluginId, disposables)` new arity matches the updated call site.

**Out of scope (later phases):** `addSidebarPanel`/`addSettingsTab` + Shadow-DOM + Command Palette (Phase C); `ai`/`network`/`storage` (Phase D). Genuine CSS selector-scoping (Phase C).
