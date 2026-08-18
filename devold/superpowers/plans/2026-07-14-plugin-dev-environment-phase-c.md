# Plugin Dev Environment — Phase C (Panels + Palette) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give plugins real, capability-gated UI-contribution surfaces on top of Phase B: a plugin can add a **sidebar panel** (mounted into a Shadow root for CSS isolation), add a **Settings tab** (also Shadow-isolated), and expose its **commands in the Command Palette** — all auto-cleaned on plugin unload.

**Architecture:** The Phase B `plugin-ui-store` (Zustand) is extended with three new registries — `sidebarPanels`, `settingsTabs`, `paletteCommands` — plus an `activePluginPanelId` pointer. `context.ui.addSidebarPanel` / `addSettingsTab` register a record (namespaced by plugin id) and return a `Disposable` that removes it; `context.commands.register(id, handler, opts)` additionally registers a palette command when `opts.paletteVisible` or `opts.title` is set. A single reusable `PluginShadowMount` React component owns the imperative mount lifecycle: on mount it `attachShadow({mode:"open"})` on its host `<div>`, appends an inner content `<div>` inside that shadow root, and calls the plugin's `onMount(contentDiv)` once; on unmount it calls `onUnmount(contentDiv)`. The Activity Bar merges plugin sidebar-panel icons dynamically; the Sidebar renders a single new `"plugin"` panel kind whose content is the active plugin panel (chosen by `activePluginPanelId`); `SettingsModal` renders a "Plugins" nav group of contributed tabs; `CommandPalette` merges `paletteCommands` and dispatches via `executePluginCommand(fullId)`. Plugin unload sweeps every registry through the existing `unregisterPluginUI` → `usePluginUIStore.unregisterPlugin(pluginId)` path; `onUnmount` fires naturally because removing a store entry unmounts its `PluginShadowMount`.

**Tech Stack:** TypeScript/React 19, Zustand (+ `useShallow`), lucide-react, Vitest + @testing-library/react (jsdom — jsdom supports `attachShadow`).

## Key Design Decisions

These resolve the open questions the spec left to the implementer. They are binding for every task; keep them consistent.

1. **`"plugin"` (singular) vs the existing `"plugins"` (plural) sidebar kind.** The `SidebarPanel` union (`src/stores/ui/ui.ts:18`) already contains `"plugins"` — that is the built-in plugin **manager / marketplace** panel (renders `<PluginMarketplace/>`). Per spec §5.3 we add exactly **one** new member, `"plugin"` (singular), as the generic **host slot** for whichever plugin-*contributed* panel is active; which one is resolved by `plugin-ui-store.activePluginPanelId`. This keeps the union closed regardless of how many panels plugins register. ⚠️ The plural/singular pair is a deliberate near-collision — a one-character typo routes to the wrong panel and TS will NOT catch it (both are valid members). Every reference to the contributed-panel kind is the **singular** `"plugin"`; every reference to the manager is the **plural** `"plugins"`. Add a code comment at the union noting this.

2. **Activity Bar icon for contributed panels.** Plugin panels carry an optional `icon: string`. We do **not** do dynamic lucide-by-name lookup (rabbit hole). Rule: if `panel.icon` is a non-empty string, render it verbatim as a text/emoji glyph (`<span>{panel.icon}</span>`); otherwise render a generic lucide fallback. Use `Blocks` from lucide-react as the fallback (verified exported) — visually distinct from the manager panel's `Puzzle`.

3. **Shadow-DOM mount passes an inner `<div>`, not the `ShadowRoot`.** Spec §5.3 prose says "call `onMount(shadowRoot)`", but the API type (§4.1) is `onMount(el: HTMLElement)`. A `ShadowRoot` is **not** an `HTMLElement` (no `.style`, `.classList`, `.dataset`) — passing it cast-to-`HTMLElement` would break plugins at runtime. Resolution (documented drift): attach the shadow root for CSS isolation, then create + append an inner content `<div>` inside it and pass **that div** to `onMount`. This is type-honest and mirrors Obsidian's `ItemView.onOpen(contentEl: HTMLElement)`.

4. **`settings` joins the `ui` capability gate + per-method gating.** Today the gate is `sidebar || statusbar` (`extension-context.ts:145`). Spec §4.1 says `ui` exists if **statusbar OR sidebar OR settings**, with per-method gating. We add `settings` to the object-level gate, and add per-method capability guards inside the API: `showStatusBarItem`→`statusbar`, `addSidebarPanel`→`sidebar`, `addSettingsTab`→`settings`. `showNotification` and `addStyle` remain generic (available whenever `ui` exists). This is a deliberate, tested widening; it does not weaken any gate (a plugin with none of the three still gets a denied proxy). Existing Phase B tests are unaffected (they never call a method outside their declared cap).

5. **`onUnmount` is fired by the React layer, not imperatively by the store.** `unregisterPluginUI(pluginId)` (unload sweep) only **removes registry entries** via `usePluginUIStore.unregisterPlugin`. Because the mounted host (`PluginPanelHost` / `PluginSettingsTabHost`) renders a `PluginShadowMount` keyed to the registry entry, removing the entry unmounts that component, whose cleanup calls `onUnmount(contentDiv)`. This keeps the store free of live DOM refs and guarantees `onMount`/`onUnmount` symmetry (a panel that was never displayed never fires either). Task 6 proves this end-to-end.

6. **`PluginCapability` union — NO Phase C drift.** `src/plugins/types.ts:59-70` already includes `sidebar`, `settings`, `statusbar`, `ai`, `network`. No new capability is needed for Phase C. (`storage` is absent — that is a **Phase D** addition, out of scope here.) `CAPABILITY_DESCRIPTIONS` already documents `sidebar`/`settings`.

7. **`addStyle` does NOT reach Shadow-DOM panels — plugins style shadow content from inside `onMount`.** `ctx.ui.addStyle(css)` injects a `<style>` into `document.head` (light DOM); Shadow-DOM encapsulation blocks `document`-level stylesheets from crossing into a shadow root, so `addStyle` CANNOT style a plugin's sidebar-panel/settings-tab content. To style shadow content, the plugin appends its own `<style>` to the `el` passed to `onMount(el)` (that element lives inside the shadow root, and its styles are auto-removed when the panel unmounts). CSS custom properties (e.g. `var(--color-text-default)`) DO inherit across the shadow boundary, so plugin-authored shadow CSS can still theme against app tokens. `addStyle` remains the tool for light-DOM surfaces (status bar, global tweaks). This is a documentation/comment requirement, NOT a code change: (a) add a one-line code comment at `PluginShadowMount` and at `addStyle` noting the boundary; (b) the Phase E `plugin-development.md` rewrite must state it explicitly. Do NOT make `addStyle` try to target shadow roots.

## Global Constraints

- Branch `feature/plugin-dev-environment-phase-c` (create off current `main`, which is at `3c66f4a` with Phase B merged). Stay on it.
- Every new `context.ui` registration returns a `Disposable` pushed to `disposables` (auto-cleanup on unload); `unregisterPluginUI` must also call `onUnmount` and sweep the new store fields.
- Capability gate must stay intact; do not weaken it. If `settings` needs to join the `ui` gate, that's a deliberate, tested change.
- Zustand: components use `useShallow`; outside React use `.getState()`.
- TS strict + `verbatimModuleSyntax` (type-only imports use `import type`); files ≤ ~300 lines; kebab-case files; PascalCase components/types.
- Tests via vitest (jsdom), never jest. `npm run typecheck` now typechecks app + node tools + TESTS.
- Lint gate (CI + Husky lint-staged): `npx eslint --fix` + `npx prettier --write` + `npx eslint --max-warnings=0` clean; CSS via stylelint. NEVER `git commit --no-verify`.
- Commits: Conventional Commits, English, reference `§69`.

## File Structure

- Modify: `src/plugins/types.ts` — extend `UIAPI` (`addSidebarPanel`/`addSettingsTab`); extend `CommandsAPI.register` + add `CommandRegisterOptions`; add `PluginSidebarPanelOptions`/`PluginSettingsTabOptions`.
- Modify: `src/plugins/plugin-ui-store.ts` — add `PluginSidebarPanel`/`PluginSettingsTab`/`PluginPaletteCommand` records; `sidebarPanels`/`settingsTabs`/`paletteCommands`/`activePluginPanelId` state + register/remove/setActive actions; extend `unregisterPlugin` sweep.
- Modify: `src/plugins/extension-context.ts` — `createUIAPI` gains `addSidebarPanel`/`addSettingsTab` + per-method gating + `settings` in the gate + capability arg; `createCommandsAPI` gains `opts` + palette registration.
- Create: `src/components/plugins/PluginShadowMount.tsx` — reusable shadow-root mount component.
- Create: `src/components/layout/PluginPanelHost.tsx` — renders the active contributed sidebar panel.
- Create: `src/components/settings/PluginSettingsTabHost.tsx` — renders one contributed settings tab.
- Modify: `src/stores/ui/ui.ts` — add `"plugin"` to `SidebarPanel`.
- Modify: `src/components/layout/ActivityBar.tsx` — merge plugin panel icons + click handler.
- Modify: `src/components/layout/Sidebar.tsx` — render `"plugin"` kind via `PluginPanelHost`.
- Modify: `src/components/settings/SettingsModal.tsx` — "Plugins" nav group + host render.
- Modify: `src/components/command/CommandPalette.tsx` — merge `paletteCommands` + dispatch.
- Modify: `src/styles/panels.css` (or nearest) — `.plugin-shadow-host`, `.activity-bar-plugin-icon`, `.settings-nav-group`.
- Tests: extend `src/plugins/__tests__/plugin-ui-store.test.ts`, `src/plugins/__tests__/extension-context.test.ts`; create `src/components/plugins/__tests__/PluginShadowMount.test.tsx`, `src/components/layout/__tests__/PluginPanelHost.test.tsx`, `src/components/layout/__tests__/ActivityBar.plugin.test.tsx`, `src/components/settings/__tests__/PluginSettingsTabHost.test.tsx`, `src/components/command/__tests__/CommandPalette.plugin.test.tsx`.

---

### Task 1: Types + `plugin-ui-store` registries (panels / tabs / palette commands)

**Files:**
- Modify: `src/plugins/types.ts` (`UIAPI` @133-137, `CommandsAPI` @3-6; add option types)
- Modify: `src/plugins/plugin-ui-store.ts` (whole file — extend)
- Test: `src/plugins/__tests__/plugin-ui-store.test.ts` (extend)

**Interfaces:**
- Produces (types.ts):
```ts
export interface CommandRegisterOptions {
  paletteVisible?: boolean;
  title?: string;
}
export interface PluginSidebarPanelOptions {
  icon?: string;
  id: string;
  onMount(el: HTMLElement): void;
  onUnmount?(el: HTMLElement): void;
  title: string;
}
export interface PluginSettingsTabOptions {
  id: string;
  onMount(el: HTMLElement): void;
  onUnmount?(el: HTMLElement): void;
  title: string;
}
// CommandsAPI.register gains opts:
register(id: string, handler: (...args: unknown[]) => unknown, opts?: CommandRegisterOptions): Disposable;
// UIAPI gains:
addSidebarPanel(opts: PluginSidebarPanelOptions): Disposable;
addSettingsTab(opts: PluginSettingsTabOptions): Disposable;
```
- Produces (plugin-ui-store.ts records):
```ts
export interface PluginSidebarPanel {
  icon?: string;
  onMount: (el: HTMLElement) => void;
  onUnmount?: (el: HTMLElement) => void;
  panelId: string;   // namespaced: `${pluginId}:${id}`
  pluginId: string;
  title: string;
}
export interface PluginSettingsTab {
  onMount: (el: HTMLElement) => void;
  onUnmount?: (el: HTMLElement) => void;
  pluginId: string;
  tabId: string;     // namespaced: `${pluginId}:${id}`
  title: string;
}
export interface PluginPaletteCommand {
  commandId: string; // fullId: `${pluginId}.${id}` (matches command registry)
  pluginId: string;
  title: string;
}
```
- Produces (store actions): `registerSidebarPanel`, `removeSidebarPanel(panelId)`, `registerSettingsTab`, `removeSettingsTab(tabId)`, `registerPaletteCommand`, `removePaletteCommand(commandId)`, `setActivePluginPanelId(id: null | string)`; extended `unregisterPlugin(pluginId)`.

- [ ] **Step 1: Write the failing store tests** (extend `plugin-ui-store.test.ts`)

Read the existing file first (it already has a `beforeEach` resetting `statusBarItems`; extend the reset to the new arrays). Add:

```ts
const panel = (id: string, pluginId = "p1") => ({
  onMount: () => {},
  panelId: `${pluginId}:${id}`,
  pluginId,
  title: id,
});
const tab = (id: string, pluginId = "p1") => ({
  onMount: () => {},
  pluginId,
  tabId: `${pluginId}:${id}`,
  title: id,
});
const cmd = (id: string, pluginId = "p1") => ({
  commandId: `${pluginId}.${id}`,
  pluginId,
  title: id,
});

describe("plugin-ui-store panels/tabs/palette", () => {
  beforeEach(() =>
    usePluginUIStore.setState({
      activePluginPanelId: null,
      paletteCommands: [],
      settingsTabs: [],
      sidebarPanels: [],
      statusBarItems: [],
    }),
  );

  it("registers and removes a sidebar panel", () => {
    usePluginUIStore.getState().registerSidebarPanel(panel("a"));
    expect(usePluginUIStore.getState().sidebarPanels).toHaveLength(1);
    usePluginUIStore.getState().removeSidebarPanel("p1:a");
    expect(usePluginUIStore.getState().sidebarPanels).toHaveLength(0);
  });

  it("registers/removes settings tabs and palette commands", () => {
    usePluginUIStore.getState().registerSettingsTab(tab("s"));
    usePluginUIStore.getState().registerPaletteCommand(cmd("c"));
    expect(usePluginUIStore.getState().settingsTabs).toHaveLength(1);
    expect(usePluginUIStore.getState().paletteCommands).toHaveLength(1);
    usePluginUIStore.getState().removeSettingsTab("p1:s");
    usePluginUIStore.getState().removePaletteCommand("p1.c");
    expect(usePluginUIStore.getState().settingsTabs).toHaveLength(0);
    expect(usePluginUIStore.getState().paletteCommands).toHaveLength(0);
  });

  it("setActivePluginPanelId tracks the active panel", () => {
    usePluginUIStore.getState().setActivePluginPanelId("p1:a");
    expect(usePluginUIStore.getState().activePluginPanelId).toBe("p1:a");
  });

  it("unregisterPlugin sweeps all registries and clears active id for that plugin", () => {
    usePluginUIStore.getState().registerSidebarPanel(panel("a", "p1"));
    usePluginUIStore.getState().registerSidebarPanel(panel("b", "p2"));
    usePluginUIStore.getState().registerSettingsTab(tab("s", "p1"));
    usePluginUIStore.getState().registerPaletteCommand(cmd("c", "p1"));
    usePluginUIStore.getState().setActivePluginPanelId("p1:a");

    usePluginUIStore.getState().unregisterPlugin("p1");

    const s = usePluginUIStore.getState();
    expect(s.sidebarPanels.map((p) => p.pluginId)).toEqual(["p2"]);
    expect(s.settingsTabs).toHaveLength(0);
    expect(s.paletteCommands).toHaveLength(0);
    expect(s.activePluginPanelId).toBeNull(); // active belonged to p1
  });

  it("unregisterPlugin keeps active id when it belongs to another plugin", () => {
    usePluginUIStore.getState().registerSidebarPanel(panel("b", "p2"));
    usePluginUIStore.getState().setActivePluginPanelId("p2:b");
    usePluginUIStore.getState().unregisterPlugin("p1");
    expect(usePluginUIStore.getState().activePluginPanelId).toBe("p2:b");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- plugin-ui-store 2>&1 | tail -20`
Expected: FAIL — `registerSidebarPanel` / `sidebarPanels` / `activePluginPanelId` undefined.

- [ ] **Step 3: Add the option/register types to `types.ts`**

Replace `CommandsAPI` (@3-6) so `register` takes `opts`, and add `CommandRegisterOptions` above it:
```ts
export interface CommandRegisterOptions {
  paletteVisible?: boolean;
  title?: string;
}

export interface CommandsAPI {
  execute(id: string, ...args: unknown[]): Promise<unknown>;
  register(
    id: string,
    handler: (...args: unknown[]) => unknown,
    opts?: CommandRegisterOptions,
  ): Disposable;
}
```
Add the panel/tab option interfaces (near `UIAPI`) and extend `UIAPI` (@133-137):
```ts
export interface PluginSidebarPanelOptions {
  icon?: string;
  id: string;
  onMount(el: HTMLElement): void;
  onUnmount?(el: HTMLElement): void;
  title: string;
}

export interface PluginSettingsTabOptions {
  id: string;
  onMount(el: HTMLElement): void;
  onUnmount?(el: HTMLElement): void;
  title: string;
}

export interface UIAPI {
  addSettingsTab(opts: PluginSettingsTabOptions): Disposable;
  addSidebarPanel(opts: PluginSidebarPanelOptions): Disposable;
  addStyle(css: string): Disposable;
  showNotification(message: string, type?: "error" | "info" | "warning"): void;
  showStatusBarItem(text: string, align?: "left" | "right"): StatusBarItem;
}
```

- [ ] **Step 4: Extend `plugin-ui-store.ts`**

Add the three record interfaces (below `PluginStatusBarItem`), extend `PluginUIState`, and implement. Full new state shape:
```ts
interface PluginUIState {
  activePluginPanelId: null | string;
  paletteCommands: PluginPaletteCommand[];
  registerPaletteCommand: (cmd: PluginPaletteCommand) => void;
  registerSettingsTab: (tab: PluginSettingsTab) => void;
  registerSidebarPanel: (panel: PluginSidebarPanel) => void;
  registerStatusBarItem: (item: PluginStatusBarItem) => void;
  removePaletteCommand: (commandId: string) => void;
  removeSettingsTab: (tabId: string) => void;
  removeSidebarPanel: (panelId: string) => void;
  removeStatusBarItem: (itemId: string) => void;
  setActivePluginPanelId: (id: null | string) => void;
  settingsTabs: PluginSettingsTab[];
  sidebarPanels: PluginSidebarPanel[];
  statusBarItems: PluginStatusBarItem[];
  unregisterPlugin: (pluginId: string) => void;
  updateStatusBarItem: (itemId: string, text: string) => void;
}
```
Initial values: `activePluginPanelId: null`, `paletteCommands: []`, `settingsTabs: []`, `sidebarPanels: []` (keep `statusBarItems: []`). Add register/remove actions mirroring the Phase B status-bar pattern (append on register, filter on remove). `setActivePluginPanelId: (id) => set({ activePluginPanelId: id })`. Extend `unregisterPlugin`:
```ts
  unregisterPlugin: (pluginId) =>
    set((state) => {
      const removed = state.sidebarPanels
        .filter((p) => p.pluginId === pluginId)
        .map((p) => p.panelId);
      return {
        activePluginPanelId:
          state.activePluginPanelId &&
          removed.includes(state.activePluginPanelId)
            ? null
            : state.activePluginPanelId,
        paletteCommands: state.paletteCommands.filter(
          (c) => c.pluginId !== pluginId,
        ),
        settingsTabs: state.settingsTabs.filter((t) => t.pluginId !== pluginId),
        sidebarPanels: state.sidebarPanels.filter(
          (p) => p.pluginId !== pluginId,
        ),
        statusBarItems: state.statusBarItems.filter(
          (i) => i.pluginId !== pluginId,
        ),
      };
    }),
```

- [ ] **Step 5: Run tests + tsc + lint**

Run: `npm test -- plugin-ui-store 2>&1 | tail -12` (PASS), `npm run typecheck 2>&1 | tail -5` (clean — the extended `UIAPI`/`CommandsAPI` may surface call-site type gaps in extension-context; if so they are addressed in Tasks 3/5 — confirm the ONLY errors are there, otherwise fix). eslint/prettier on the 3 files.

> Note: adding `addSidebarPanel`/`addSettingsTab` to `UIAPI` makes `createUIAPI`'s current return value fail `typecheck` until Task 3. If `npm run typecheck` errors ONLY inside `extension-context.ts`, that is expected — proceed; do not stub. If it errors elsewhere, stop and reconcile.

- [ ] **Step 6: Commit**

```bash
git add src/plugins/types.ts src/plugins/plugin-ui-store.ts src/plugins/__tests__/plugin-ui-store.test.ts
git commit -m "feat(§69): plugin-ui-store registries for panels/tabs/palette commands"
```

---

### Task 2: `PluginShadowMount` — reusable Shadow-DOM mount component

**Files:**
- Create: `src/components/plugins/PluginShadowMount.tsx`
- Modify: `src/styles/panels.css` (add `.plugin-shadow-host`)
- Test: `src/components/plugins/__tests__/PluginShadowMount.test.tsx`

**Interfaces:**
- Produces: `<PluginShadowMount onMount={(el:HTMLElement)=>void} onUnmount?={(el:HTMLElement)=>void} />`.
- Contract: on mount, attaches an open shadow root to its host `<div>`, appends an inner content `<div>` inside the shadow root, calls `onMount(contentDiv)` exactly once; on unmount calls `onUnmount?.(contentDiv)` and clears the shadow. Idempotent under React Strict-Mode double-invoke.

- [ ] **Step 1: Write the failing test**

Create `src/components/plugins/__tests__/PluginShadowMount.test.tsx`:
```tsx
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PluginShadowMount } from "../PluginShadowMount";

describe("PluginShadowMount", () => {
  it("mounts into a shadow root and calls onMount with an HTMLElement", () => {
    const onMount = vi.fn((el: HTMLElement) => {
      el.textContent = "from-plugin";
    });
    const { container } = render(<PluginShadowMount onMount={onMount} />);
    const host = container.querySelector(".plugin-shadow-host") as HTMLElement;
    expect(host.shadowRoot).not.toBeNull();
    expect(onMount).toHaveBeenCalledTimes(1);
    const el = onMount.mock.calls[0][0];
    expect(el).toBeInstanceOf(HTMLElement); // inner div, NOT the ShadowRoot
    expect(host.shadowRoot?.textContent).toContain("from-plugin");
  });

  it("calls onUnmount on unmount", () => {
    const onUnmount = vi.fn();
    const { unmount } = render(
      <PluginShadowMount onMount={() => {}} onUnmount={onUnmount} />,
    );
    unmount();
    expect(onUnmount).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- PluginShadowMount 2>&1 | tail -15`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `PluginShadowMount.tsx`**

```tsx
// §69 Plugin Shadow-DOM mount — CSS-isolated container for imperative plugin UI
import { useEffect, useRef } from "react";

interface PluginShadowMountProps {
  onMount: (el: HTMLElement) => void;
  onUnmount?: (el: HTMLElement) => void;
}

export function PluginShadowMount({ onMount, onUnmount }: PluginShadowMountProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  // Latest-callback refs so the mount effect stays [] (mount once) without
  // going stale — the panel's onMount/onUnmount identity may change per render.
  const onMountRef = useRef(onMount);
  const onUnmountRef = useRef(onUnmount);
  onMountRef.current = onMount;
  onUnmountRef.current = onUnmount;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    // attachShadow throws if already attached (Strict-Mode remount reuses the node).
    const shadow = host.shadowRoot ?? host.attachShadow({ mode: "open" });
    const content = document.createElement("div");
    content.className = "plugin-shadow-content";
    shadow.appendChild(content);
    onMountRef.current(content);
    return () => {
      onUnmountRef.current?.(content);
      content.remove();
    };
  }, []);

  return <div className="plugin-shadow-host" ref={hostRef} />;
}
```

- [ ] **Step 4: Add CSS**

`grep -n "\.panels\|panel-" src/styles/panels.css | head` to find a home; append:
```css
.plugin-shadow-host {
  width: 100%;
  height: 100%;
}
```
> `.plugin-shadow-content` lives inside the shadow root and is NOT reachable by host CSS (that is the point); do not add rules for it.

- [ ] **Step 5: Run test + tsc + lint**

Run: `npm test -- PluginShadowMount 2>&1 | tail -8` (PASS — including the Strict-Mode case if the setup wraps in `<StrictMode>`; if the second render double-fires onMount, the `shadowRoot ??` guard prevents the attach throw but you must confirm onMount count is 1 under the project's test render — the callback-ref + `[]` effect gives one mount per real mount). `npm run typecheck 2>&1 | tail -5`. eslint/prettier.

- [ ] **Step 6: Commit**

```bash
git add src/components/plugins/PluginShadowMount.tsx src/components/plugins/__tests__/PluginShadowMount.test.tsx src/styles/panels.css
git commit -m "feat(§69): PluginShadowMount — CSS-isolated shadow-root mount for plugin UI"
```

---

### Task 3: `context.ui` panel/tab APIs + widened gate + per-method gating

**Files:**
- Modify: `src/plugins/extension-context.ts` (`createUIAPI` @249-283, gate @144-147, call site @146)
- Test: `src/plugins/__tests__/extension-context.test.ts` (extend)

**Interfaces:**
- Consumes: `usePluginUIStore` register/remove actions (Task 1), option types (Task 1).
- Produces: `createUIAPI(pluginId: string, capabilities: Set<PluginCapability>, disposables: Disposable[]): UIAPI` (arity change: adds `capabilities`); `ui.addSidebarPanel` / `ui.addSettingsTab`; per-method capability guards.

- [ ] **Step 1: Write the failing tests** (extend the `ExtensionContext ui API` describe)

Extend the `beforeEach` reset to include the new arrays, then add:
```ts
test("ui object exists with only 'settings' capability", () => {
  const ctx = createExtensionContext(makeManifest(["settings"]), "/p");
  expect(() => ctx.ui.showNotification("x")).not.toThrow();
});

test("addSidebarPanel requires 'sidebar' capability", () => {
  const ctx = createExtensionContext(makeManifest(["settings"]), "/p");
  expect(() =>
    ctx.ui.addSidebarPanel({ id: "p", onMount: () => {}, title: "P" }),
  ).toThrow(/sidebar/i);
});

test("addSidebarPanel registers a namespaced panel and disposes it", () => {
  const ctx = createExtensionContext(makeManifest(["sidebar"]), "/p");
  const d = ctx.ui.addSidebarPanel({ id: "notes", onMount: () => {}, title: "Notes" });
  const panels = usePluginUIStore.getState().sidebarPanels;
  expect(panels).toHaveLength(1);
  expect(panels[0].panelId).toBe("test-plugin:notes");
  expect(panels[0].pluginId).toBe("test-plugin");
  d.dispose();
  expect(usePluginUIStore.getState().sidebarPanels).toHaveLength(0);
});

test("addSettingsTab requires 'settings' capability", () => {
  const ctx = createExtensionContext(makeManifest(["sidebar"]), "/p");
  expect(() =>
    ctx.ui.addSettingsTab({ id: "t", onMount: () => {}, title: "T" }),
  ).toThrow(/settings/i);
});

test("addSettingsTab registers a namespaced tab and disposes it", () => {
  const ctx = createExtensionContext(makeManifest(["settings"]), "/p");
  const d = ctx.ui.addSettingsTab({ id: "cfg", onMount: () => {}, title: "Cfg" });
  expect(usePluginUIStore.getState().settingsTabs[0].tabId).toBe("test-plugin:cfg");
  d.dispose();
  expect(usePluginUIStore.getState().settingsTabs).toHaveLength(0);
});

test("showStatusBarItem requires 'statusbar' capability", () => {
  const ctx = createExtensionContext(makeManifest(["sidebar"]), "/p");
  expect(() => ctx.ui.showStatusBarItem("x")).toThrow(/statusbar/i);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- extension-context 2>&1 | tail -25`
Expected: FAIL — `settings`-only ui is a denied proxy (throws); `addSidebarPanel`/`addSettingsTab` undefined; no per-method gating.

- [ ] **Step 3: Widen the gate + pass capabilities (`extension-context.ts` @144-147)**

```ts
  const ui: UIAPI =
    hasCapability("sidebar") ||
    hasCapability("statusbar") ||
    hasCapability("settings")
      ? createUIAPI(manifest.id, capabilities, disposables)
      : (createDeniedProxy("ui", "sidebar") as UIAPI);
```
(`capabilities` is the `Set<PluginCapability>` already built at the top of `createExtensionContext`.)

- [ ] **Step 4: Rewrite `createUIAPI` (@249-283)**

Add `capabilities` param + a local guard; add the two methods; add per-method guards to `showStatusBarItem`:
```ts
function createUIAPI(
  pluginId: string,
  capabilities: Set<PluginCapability>,
  disposables: Disposable[],
): UIAPI {
  const require = (cap: PluginCapability, method: string) => {
    if (!capabilities.has(cap)) {
      throw new Error(
        `Plugin requires "${cap}" capability to call ui.${method}. ` +
          `Add "${cap}" to the capabilities array in baram-plugin.json.`,
      );
    }
  };
  return {
    showNotification(message, type) {
      useUIStore.getState().showToast(message, type);
    },
    showStatusBarItem(text, align = "right") {
      require("statusbar", "showStatusBarItem");
      const itemId = `${pluginId}:sb:${++uiItemCounter}`;
      usePluginUIStore
        .getState()
        .registerStatusBarItem({ align, itemId, pluginId, text });
      const item: StatusBarItem = {
        setText: (t) =>
          usePluginUIStore.getState().updateStatusBarItem(itemId, t),
        dispose: () => usePluginUIStore.getState().removeStatusBarItem(itemId),
      };
      disposables.push({ dispose: item.dispose });
      return item;
    },
    addSidebarPanel(opts) {
      require("sidebar", "addSidebarPanel");
      const panelId = `${pluginId}:${opts.id}`;
      usePluginUIStore.getState().registerSidebarPanel({
        icon: opts.icon,
        onMount: opts.onMount,
        onUnmount: opts.onUnmount,
        panelId,
        pluginId,
        title: opts.title,
      });
      const disposable: Disposable = {
        dispose: () =>
          usePluginUIStore.getState().removeSidebarPanel(panelId),
      };
      disposables.push(disposable);
      return disposable;
    },
    addSettingsTab(opts) {
      require("settings", "addSettingsTab");
      const tabId = `${pluginId}:${opts.id}`;
      usePluginUIStore.getState().registerSettingsTab({
        onMount: opts.onMount,
        onUnmount: opts.onUnmount,
        pluginId,
        tabId,
        title: opts.title,
      });
      const disposable: Disposable = {
        dispose: () => usePluginUIStore.getState().removeSettingsTab(tabId),
      };
      disposables.push(disposable);
      return disposable;
    },
    addStyle(css) {
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
Add `PluginCapability` to the `import type { ... } from "./types"` block if not already imported (it is imported today — verify).

> `unregisterPluginUI` (@242-247) already calls `usePluginUIStore.getState().unregisterPlugin(pluginId)`, which (after Task 1) sweeps panels/tabs/commands too — no change needed here. Confirm it still removes the `<style>` tags.

- [ ] **Step 5: Run tests + full plugin suite + tsc + lint**

Run: `npm test -- extension-context 2>&1 | tail -25` (PASS), `npm test -- "plugin" 2>&1 | tail -12` (no Phase B regressions), `npm run typecheck 2>&1 | tail -5` (now clean — Task 1's expected error is resolved), eslint/prettier.

- [ ] **Step 6: Commit**

```bash
git add src/plugins/extension-context.ts src/plugins/__tests__/extension-context.test.ts
git commit -m "feat(§69): context.ui.addSidebarPanel/addSettingsTab + settings gate + per-method gating"
```

---

### Task 4: Sidebar panel wiring — `"plugin"` kind + ActivityBar icons + host

**Files:**
- Modify: `src/stores/ui/ui.ts` (`SidebarPanel` @18-31)
- Create: `src/components/layout/PluginPanelHost.tsx`
- Modify: `src/components/layout/Sidebar.tsx` (switch @79-91)
- Modify: `src/components/layout/ActivityBar.tsx` (imports, selectors, render @145-154)
- Modify: `src/styles/panels.css` (`.activity-bar-plugin-icon`, `.plugin-panel-empty`)
- Test: `src/components/layout/__tests__/PluginPanelHost.test.tsx`, `src/components/layout/__tests__/ActivityBar.plugin.test.tsx`

**Interfaces:**
- Consumes: `usePluginUIStore` (`sidebarPanels`, `activePluginPanelId`, `setActivePluginPanelId`), `PluginShadowMount` (Task 2), `useUIStore` sidebar actions.
- Produces: `SidebarPanel` gains `"plugin"`; `<PluginPanelHost />`.

- [ ] **Step 1: Write the failing tests**

`PluginPanelHost.test.tsx`:
```tsx
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { usePluginUIStore } from "../../../plugins/plugin-ui-store";
import { PluginPanelHost } from "../PluginPanelHost";

describe("PluginPanelHost", () => {
  beforeEach(() =>
    usePluginUIStore.setState({ activePluginPanelId: null, sidebarPanels: [] }),
  );

  it("mounts the active plugin panel", () => {
    const onMount = vi.fn();
    usePluginUIStore.setState({
      activePluginPanelId: "p1:notes",
      sidebarPanels: [
        { onMount, panelId: "p1:notes", pluginId: "p1", title: "Notes" },
      ],
    });
    render(<PluginPanelHost />);
    expect(onMount).toHaveBeenCalledTimes(1);
  });

  it("shows an empty state when the active panel is missing", () => {
    const { container } = render(<PluginPanelHost />);
    expect(container.querySelector(".plugin-panel-empty")).not.toBeNull();
  });
});
```
`ActivityBar.plugin.test.tsx`:
```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { usePluginUIStore } from "../../../plugins/plugin-ui-store";
import { useUIStore } from "../../../stores/ui/ui";
import { ActivityBar } from "../ActivityBar";

describe("ActivityBar plugin panels", () => {
  beforeEach(() => {
    usePluginUIStore.setState({ activePluginPanelId: null, sidebarPanels: [] });
    useUIStore.setState({ sidebarOpen: true, sidebarPanel: "files" });
  });

  it("renders a button for a registered plugin panel and activates it on click", () => {
    usePluginUIStore.setState({
      sidebarPanels: [
        { icon: "🔌", onMount: () => {}, panelId: "p1:notes", pluginId: "p1", title: "My Notes" },
      ],
    });
    render(<ActivityBar />);
    const btn = screen.getByTitle("My Notes");
    fireEvent.click(btn);
    expect(useUIStore.getState().sidebarPanel).toBe("plugin");
    expect(usePluginUIStore.getState().activePluginPanelId).toBe("p1:notes");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- "PluginPanelHost|ActivityBar.plugin" 2>&1 | tail -20`
Expected: FAIL — module not found / `"plugin"` not assignable / no plugin button.

- [ ] **Step 3: Add `"plugin"` to the `SidebarPanel` union (`ui.ts` @18-31)**

Insert `"plugin"` before `"plugins"` and add a comment:
```ts
export type SidebarPanel =
  | "backlinks"
  | "bookmarks"
  | "calendar"
  | "files"
  | "git"
  | "graph"
  | "outline"
  // "plugin" (singular) = host slot for the active plugin-CONTRIBUTED panel
  // (resolved via plugin-ui-store.activePluginPanelId). "plugins" (plural) =
  // the built-in plugin manager/marketplace. Do NOT confuse the two.
  | "plugin"
  | "plugins"
  | "search"
  | "skills-gallery"
  | "snapshots"
  | "tags"
  | "zettel";
```

- [ ] **Step 4: Implement `PluginPanelHost.tsx`**

```tsx
// §69 Host slot for the active plugin-contributed sidebar panel (§5.3)
import { useShallow } from "zustand/shallow";

import { usePluginUIStore } from "../../plugins/plugin-ui-store";
import { PluginShadowMount } from "../plugins/PluginShadowMount";

export function PluginPanelHost() {
  const { activePluginPanelId, sidebarPanels } = usePluginUIStore(
    useShallow((s) => ({
      activePluginPanelId: s.activePluginPanelId,
      sidebarPanels: s.sidebarPanels,
    })),
  );
  const panel = sidebarPanels.find((p) => p.panelId === activePluginPanelId);
  if (!panel) {
    return <div className="plugin-panel-empty">No plugin panel selected.</div>;
  }
  return (
    <PluginShadowMount
      key={panel.panelId}
      onMount={panel.onMount}
      onUnmount={panel.onUnmount}
    />
  );
}
```
The `key={panel.panelId}` guarantees switching panels remounts (fresh shadow root + `onMount`/`onUnmount`).

- [ ] **Step 5: Render `"plugin"` in `Sidebar.tsx` (@79-91)**

Add a static import (host is tiny — no need to lazy-load) and a branch:
```tsx
import { PluginPanelHost } from "./PluginPanelHost";
// ...inside the switch, alongside the "plugins" branch:
{sidebarPanel === "plugin" && <PluginPanelHost />}
```

- [ ] **Step 6: Merge plugin icons into `ActivityBar.tsx`**

Add imports: `Blocks` from lucide-react; `usePluginUIStore`. Read the plugin panels via `useShallow`:
```tsx
const { sidebarPanels, activePluginPanelId, setActivePluginPanelId } =
  usePluginUIStore(
    useShallow((s) => ({
      activePluginPanelId: s.activePluginPanelId,
      setActivePluginPanelId: s.setActivePluginPanelId,
      sidebarPanels: s.sidebarPanels,
    })),
  );
```
Add a dedicated click handler (do NOT reuse `handlePanelClick("plugin")` — it would toggle-close when switching between two plugin panels):
```tsx
const handlePluginPanelClick = (panelId: string) => {
  const active = activePluginPanelId;
  setActivePluginPanelId(panelId);
  if (!sidebarOpen) {
    setSidebarPanel("plugin");
    toggleSidebar();
  } else if (sidebarPanel === "plugin" && active === panelId) {
    toggleSidebar(); // same panel already open → close
  } else {
    setSidebarPanel("plugin");
  }
};
```
Render plugin buttons immediately after the `visibleTopItems.map(...)` block (still inside `.activity-bar-top`):
```tsx
{sidebarPanels.map((panel) => (
  <button
    className={`activity-bar-btn ${
      sidebarOpen &&
      sidebarPanel === "plugin" &&
      activePluginPanelId === panel.panelId
        ? "activity-bar-btn-active"
        : ""
    }`}
    key={panel.panelId}
    onClick={() => handlePluginPanelClick(panel.panelId)}
    title={panel.title}
  >
    {panel.icon ? (
      <span className="activity-bar-plugin-icon">{panel.icon}</span>
    ) : (
      <Blocks {...ICON_PROPS} />
    )}
  </button>
))}
```

- [ ] **Step 7: Add CSS**

Append to `src/styles/panels.css`:
```css
.activity-bar-plugin-icon {
  font-size: 18px;
  line-height: 1;
}

.plugin-panel-empty {
  padding: var(--space-4, 16px);
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}
```
> Confirm `--space-4`/`--font-size-sm` exist (`grep -rn "space-4\|font-size-sm" src/styles/generated`); if not, match a neighboring empty-state rule's spacing.

- [ ] **Step 8: Run tests + tsc + lint**

Run: `npm test -- "PluginPanelHost|ActivityBar" 2>&1 | tail -20` (PASS — including existing ActivityBar tests if any), `npm run typecheck 2>&1 | tail -5`, eslint/prettier + stylelint on the CSS.

- [ ] **Step 9: Commit**

```bash
git add src/stores/ui/ui.ts src/components/layout/PluginPanelHost.tsx src/components/layout/Sidebar.tsx src/components/layout/ActivityBar.tsx src/styles/panels.css src/components/layout/__tests__/PluginPanelHost.test.tsx src/components/layout/__tests__/ActivityBar.plugin.test.tsx
git commit -m "feat(§69): plugin sidebar panels — 'plugin' kind + ActivityBar icons + host"
```

---

### Task 5: Settings tab wiring — "Plugins" nav group + host

**Files:**
- Create: `src/components/settings/PluginSettingsTabHost.tsx`
- Modify: `src/components/settings/SettingsModal.tsx` (nav @100-109, content @122-137)
- Modify: `src/styles/settings.css` (`.settings-nav-group`)
- Test: `src/components/settings/__tests__/PluginSettingsTabHost.test.tsx`

**Interfaces:**
- Consumes: `usePluginUIStore` (`settingsTabs`), `PluginShadowMount` (Task 2).
- Produces: `<PluginSettingsTabHost tabId={string} />`; SettingsModal renders a "Plugins" group of contributed tabs and hosts the active one.

> Design note: the built-in `activeTab` is the closed `SettingsTab` union; contributed tab ids are dynamic namespaced strings. Track them with a SEPARATE `useState<string | null>(null)` (`activePluginTab`) so the union stays closed. Selecting a built-in tab clears `activePluginTab`; selecting a contributed tab sets it. The existing plural `"plugins"` built-in tab (marketplace) is unchanged — contributed tabs are ADDITIONAL nav rows.

- [ ] **Step 1: Write the failing test**

`PluginSettingsTabHost.test.tsx`:
```tsx
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { usePluginUIStore } from "../../../plugins/plugin-ui-store";
import { PluginSettingsTabHost } from "../PluginSettingsTabHost";

describe("PluginSettingsTabHost", () => {
  beforeEach(() => usePluginUIStore.setState({ settingsTabs: [] }));

  it("mounts the matching settings tab", () => {
    const onMount = vi.fn();
    usePluginUIStore.setState({
      settingsTabs: [{ onMount, pluginId: "p1", tabId: "p1:cfg", title: "Cfg" }],
    });
    render(<PluginSettingsTabHost tabId="p1:cfg" />);
    expect(onMount).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- PluginSettingsTabHost 2>&1 | tail -15`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `PluginSettingsTabHost.tsx`**

```tsx
// §69 Host for one plugin-contributed Settings tab (§5.4), Shadow-isolated
import { useShallow } from "zustand/shallow";

import { usePluginUIStore } from "../../plugins/plugin-ui-store";
import { PluginShadowMount } from "../plugins/PluginShadowMount";

export function PluginSettingsTabHost({ tabId }: { tabId: string }) {
  const tab = usePluginUIStore(
    useShallow((s) => s.settingsTabs.find((t) => t.tabId === tabId)),
  );
  if (!tab) return null;
  return (
    <PluginShadowMount
      key={tab.tabId}
      onMount={tab.onMount}
      onUnmount={tab.onUnmount}
    />
  );
}
```

- [ ] **Step 4: Wire into `SettingsModal.tsx`**

Add imports:
```tsx
import { useShallow } from "zustand/shallow";
import { usePluginUIStore } from "../../plugins/plugin-ui-store";
import { PluginSettingsTabHost } from "./PluginSettingsTabHost";
```
Add state + selector inside the component:
```tsx
const [activePluginTab, setActivePluginTab] = useState<string | null>(null);
const pluginTabs = usePluginUIStore(useShallow((s) => s.settingsTabs));
```
In the built-in nav `.map` (@100-109), set `onClick={() => { setActiveTab(tab.id); setActivePluginTab(null); }}` and make the active class `activeTab === tab.id && !activePluginTab`. After the built-in nav `.map`, append the contributed group:
```tsx
{pluginTabs.length > 0 && (
  <>
    <div className="settings-nav-group">Plugins</div>
    {pluginTabs.map((tab) => (
      <button
        className={`settings-nav-item ${activePluginTab === tab.tabId ? "settings-nav-active" : ""}`}
        key={tab.tabId}
        onClick={() => setActivePluginTab(tab.tabId)}
      >
        <span className="settings-nav-icon">{"🧩"}</span>
        {tab.title}
      </button>
    ))}
  </>
)}
```
In the content region (@122-137), render the contributed host when one is active — wrap the existing built-in switch:
```tsx
) : activePluginTab ? (
  <div className="settings-section">
    <PluginSettingsTabHost tabId={activePluginTab} />
  </div>
) : (
  <>
    {/* existing built-in tab switch, unchanged */}
  </>
)}
```
(So the ternary becomes: `searchQuery.trim() ? <SearchResults/> : activePluginTab ? <Host/> : <builtins/>`.)

- [ ] **Step 5: Add CSS**

Append to `src/styles/settings.css` (match `.settings-nav-item` neighbors):
```css
.settings-nav-group {
  padding: var(--space-2, 8px) var(--space-3, 12px) var(--space-1, 4px);
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
```
> Confirm the `--space-*` tokens exist; else match the padding used by `.settings-nav-item`.

- [ ] **Step 6: Run tests + tsc + lint**

Run: `npm test -- "PluginSettingsTabHost|SettingsModal" 2>&1 | tail -15` (PASS — plus any existing SettingsModal test), `npm run typecheck 2>&1 | tail -5`, eslint/prettier + stylelint.

- [ ] **Step 7: Commit**

```bash
git add src/components/settings/PluginSettingsTabHost.tsx src/components/settings/SettingsModal.tsx src/styles/settings.css src/components/settings/__tests__/PluginSettingsTabHost.test.tsx
git commit -m "feat(§69): plugin Settings tabs — Plugins nav group + Shadow-isolated host"
```

---

### Task 6: Command Palette integration — `register` opts + palette merge

**Files:**
- Modify: `src/plugins/extension-context.ts` (`createCommandsAPI` @52-75)
- Modify: `src/components/command/CommandPalette.tsx` (commands memo @63-85)
- Test: `src/plugins/__tests__/extension-context.test.ts` (extend), `src/components/command/__tests__/CommandPalette.plugin.test.tsx`

**Interfaces:**
- Consumes: `usePluginUIStore` (`paletteCommands`, `registerPaletteCommand`, `removePaletteCommand`), `executePluginCommand` (`extension-context.ts:173`), `useUIStore.showToast`.
- Produces: `commands.register(id, handler, opts)` registers a palette command when `opts.paletteVisible` or `opts.title`; CommandPalette shows them under a "Plugin" category and dispatches via `executePluginCommand(fullId)`.

- [ ] **Step 1: Write the failing tests**

Extend `extension-context.test.ts` (commands describe) — reset `paletteCommands` in a `beforeEach` for the block:
```ts
test("register with paletteVisible exposes a palette command; dispose removes it", () => {
  usePluginUIStore.setState({ paletteCommands: [] });
  const ctx = createExtensionContext(makeManifest(["commands"]), "/p");
  const d = ctx.commands.register("hello", () => {}, {
    paletteVisible: true,
    title: "Say Hello",
  });
  const cmds = usePluginUIStore.getState().paletteCommands;
  expect(cmds).toHaveLength(1);
  expect(cmds[0]).toMatchObject({
    commandId: "test-plugin.hello",
    pluginId: "test-plugin",
    title: "Say Hello",
  });
  d.dispose();
  expect(usePluginUIStore.getState().paletteCommands).toHaveLength(0);
});

test("register without palette opts does NOT expose a palette command", () => {
  usePluginUIStore.setState({ paletteCommands: [] });
  const ctx = createExtensionContext(makeManifest(["commands"]), "/p");
  ctx.commands.register("silent", () => {});
  expect(usePluginUIStore.getState().paletteCommands).toHaveLength(0);
});
```
Create `CommandPalette.plugin.test.tsx` — mock the parent props are simple callbacks; open the palette via the store:
```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.fn(async () => {});
vi.mock("../../../plugins/extension-context", () => ({
  executePluginCommand: (...a: unknown[]) => execute(...a),
}));

import { usePluginUIStore } from "../../../plugins/plugin-ui-store";
import { useUIStore } from "../../../stores/ui/ui";
import { CommandPalette } from "../CommandPalette";

const noop = () => {};

describe("CommandPalette plugin commands", () => {
  beforeEach(() => {
    usePluginUIStore.setState({ paletteCommands: [] });
    useUIStore.setState({ commandPaletteOpen: true });
    execute.mockClear();
  });

  it("lists a plugin palette command and dispatches it", () => {
    usePluginUIStore.setState({
      paletteCommands: [
        { commandId: "p1.hello", pluginId: "p1", title: "Say Hello" },
      ],
    });
    render(
      <CommandPalette
        editor={null}
        onCloseFolder={noop}
        onNewFile={noop}
        onOpenFile={noop}
        onOpenFolder={noop}
        onSave={noop}
        onToggleSourceMode={noop}
      />,
    );
    fireEvent.click(screen.getByText("Say Hello"));
    expect(execute).toHaveBeenCalledWith("p1.hello");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- "extension-context|CommandPalette.plugin" 2>&1 | tail -25`
Expected: FAIL — `register` rejects 3rd arg / no palette command registered / "Say Hello" not rendered.

- [ ] **Step 3: Extend `createCommandsAPI` (`extension-context.ts` @52-75)**

```ts
function createCommandsAPI(
  pluginId: string,
  disposables: Disposable[],
): CommandsAPI {
  return {
    register(id, handler, opts) {
      const fullId = `${pluginId}.${id}`;
      commandHandlers.set(fullId, handler);
      const showInPalette = opts?.paletteVisible === true || !!opts?.title;
      if (showInPalette) {
        usePluginUIStore.getState().registerPaletteCommand({
          commandId: fullId,
          pluginId,
          title: opts?.title ?? id,
        });
      }
      const disposable: Disposable = {
        dispose: () => {
          commandHandlers.delete(fullId);
          if (showInPalette) {
            usePluginUIStore.getState().removePaletteCommand(fullId);
          }
        },
      };
      disposables.push(disposable);
      return disposable;
    },
    async execute(id, ...args) {
      const handler =
        commandHandlers.get(id) ?? commandHandlers.get(`${pluginId}.${id}`);
      if (!handler) throw new Error(`Command not found: ${id}`);
      return handler(...args);
    },
  };
}
```
(`usePluginUIStore` is already imported at the top of the file from Phase B.)

- [ ] **Step 4: Merge palette commands into `CommandPalette.tsx`**

Add imports:
```tsx
import { usePluginUIStore } from "../../plugins/plugin-ui-store";
import { executePluginCommand } from "../../plugins/extension-context";
```
Read the store (near the other `useUIStore` selector):
```tsx
const pluginPaletteCommands = usePluginUIStore(
  useShallow((s) => s.paletteCommands),
);
```
Extend the `commands` memo (@63-85) to concat mapped plugin commands, and add `pluginPaletteCommands` to its dep array:
```tsx
const commands = useMemo(() => {
  const base = buildCommands(
    toggleSidebar,
    onToggleSourceMode,
    onNewFile,
    onOpenFile,
    onSave,
    onOpenFolder,
    onSkillPreview ?? (() => {}),
    onCloseFolder,
  );
  const plugin: CommandItem[] = pluginPaletteCommands.map((c) => ({
    action: () => {
      void executePluginCommand(c.commandId).catch((err) =>
        useUIStore.getState().showToast(String(err), "error"),
      );
    },
    category: "Plugin",
    id: c.commandId,
    label: c.title,
  }));
  return [...base, ...plugin];
}, [
  toggleSidebar,
  onToggleSourceMode,
  onNewFile,
  onOpenFile,
  onSave,
  onOpenFolder,
  onSkillPreview,
  onCloseFolder,
  pluginPaletteCommands,
]);
```

- [ ] **Step 5: Run tests + full suite + tsc + lint**

Run: `npm test -- "extension-context|CommandPalette" 2>&1 | tail -25` (PASS), `npm test -- "plugin" 2>&1 | tail -12` (no regressions), `npm run typecheck 2>&1 | tail -5`, eslint/prettier.

- [ ] **Step 6: Commit**

```bash
git add src/plugins/extension-context.ts src/components/command/CommandPalette.tsx src/plugins/__tests__/extension-context.test.ts src/components/command/__tests__/CommandPalette.plugin.test.tsx
git commit -m "feat(§69): plugin commands in Command Palette — register opts + merge"
```

---

### Task 7: End-to-end unload lifecycle integration test

**Files:**
- Test: `src/plugins/__tests__/plugin-ui-lifecycle.test.tsx` (create)

**Interfaces:**
- Consumes: `createExtensionContext`, `unregisterPluginUI` (`extension-context.ts`), `PluginPanelHost` (Task 4), `usePluginUIStore`.
- Produces: no source change — proves the cross-task contract (Decision 5): unload sweeps every registry AND a mounted panel's `onUnmount` fires via React unmount.

> This is a verification task (no new production code). It catches integration bugs the per-task unit tests cannot: that removing a store entry actually unmounts the `PluginShadowMount` and fires `onUnmount`, and that `unregisterPluginUI` clears panels/tabs/commands/activePluginPanelId together.

- [ ] **Step 1: Write the integration test**

Create `src/plugins/__tests__/plugin-ui-lifecycle.test.tsx`:
```tsx
import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PluginManifest } from "../types";

import { PluginPanelHost } from "../../components/layout/PluginPanelHost";
import {
  createExtensionContext,
  unregisterPluginUI,
} from "../extension-context";
import { usePluginUIStore } from "../plugin-ui-store";

function manifest(caps: string[]): PluginManifest {
  return {
    author: "",
    capabilities: caps as PluginManifest["capabilities"],
    description: "",
    engines: { baram: ">=0.2.0" },
    id: "life",
    license: "MIT",
    main: "index.mjs",
    name: "Life",
    version: "1.0.0",
  };
}

describe("plugin UI unload lifecycle", () => {
  beforeEach(() =>
    usePluginUIStore.setState({
      activePluginPanelId: null,
      paletteCommands: [],
      settingsTabs: [],
      sidebarPanels: [],
      statusBarItems: [],
    }),
  );

  it("sweeps registries and fires onUnmount for the mounted panel on unload", () => {
    const onMount = vi.fn();
    const onUnmount = vi.fn();
    const ctx = createExtensionContext(
      manifest(["sidebar", "settings", "commands"]),
      "/p",
    );
    ctx.ui.addSidebarPanel({ id: "n", onMount, onUnmount, title: "N" });
    ctx.ui.addSettingsTab({ id: "s", onMount: () => {}, title: "S" });
    ctx.commands.register("c", () => {}, { paletteVisible: true });
    usePluginUIStore.getState().setActivePluginPanelId("life:n");

    render(<PluginPanelHost />);
    expect(onMount).toHaveBeenCalledTimes(1);
    expect(usePluginUIStore.getState().sidebarPanels).toHaveLength(1);
    expect(usePluginUIStore.getState().settingsTabs).toHaveLength(1);
    expect(usePluginUIStore.getState().paletteCommands).toHaveLength(1);

    // Simulate plugin unload: dispose subscriptions + sweep.
    act(() => {
      for (const d of ctx.subscriptions) d.dispose();
      unregisterPluginUI("life");
    });

    const s = usePluginUIStore.getState();
    expect(s.sidebarPanels).toHaveLength(0);
    expect(s.settingsTabs).toHaveLength(0);
    expect(s.paletteCommands).toHaveLength(0);
    expect(s.activePluginPanelId).toBeNull();
    expect(onUnmount).toHaveBeenCalledTimes(1); // React unmounted the host
  });
});
```

- [ ] **Step 2: Run to verify it passes (should be green given Tasks 1-6)**

Run: `npm test -- plugin-ui-lifecycle 2>&1 | tail -15`
Expected: PASS. If `onUnmount` count is 0, the panel host is not re-rendering when the store entry is removed — verify `PluginPanelHost` subscribes to `sidebarPanels`/`activePluginPanelId` via `useShallow` (Task 4) so its removal triggers a re-render → unmount. Fix the subscription, not the test.

- [ ] **Step 3: Full suite + typecheck**

Run: `npm test 2>&1 | tail -15` (all green — record the passed count), `npm run typecheck 2>&1 | tail -5` (clean).

- [ ] **Step 4: Commit**

```bash
git add src/plugins/__tests__/plugin-ui-lifecycle.test.tsx
git commit -m "test(§69): plugin UI unload lifecycle — registry sweep + onUnmount"
```

- [ ] **Step 5: Manual GUI verification (whole surface)**

Run: `npm run tauri dev` with a dev plugin (Phase A loop) that declares `["sidebar","settings","commands"]` and, in `activate(ctx)`, calls `ctx.ui.addSidebarPanel(...)`, `ctx.ui.addSettingsTab(...)`, and `ctx.commands.register("hi", ..., { title: "Plugin: Hi" })`. Expected: a new Activity Bar icon opens the plugin panel (content in a shadow root — host CSS does not bleed in); Settings shows a "Plugins" group with the tab; Command Palette lists "Plugin: Hi" under a "Plugin" category and runs it. Reload/remove the plugin (Phase A Developer section) → icon, tab, and command all disappear.

---

## Self-Review

**Spec coverage (spec §4.1 panels + §4.5 palette + §5.3-5.6 + §11 Phase C):**
- `ui.addSidebarPanel` (Shadow-DOM) → Task 3 (API) + Task 2 (mount) + Task 4 (ActivityBar/Sidebar wiring). ✓
- `ui.addSettingsTab` (Shadow-DOM, "Plugins" group) → Task 3 (API) + Task 2 (mount) + Task 5 (SettingsModal). ✓
- `commands.register(id, handler, opts)` + Command Palette integration → Task 1 (type) + Task 6 (impl + merge). ✓
- `plugin-ui-store` gains `sidebarPanels`/`settingsTabs`/`paletteCommands`/`activePluginPanelId` + register/unregister + `unregisterPlugin` sweep → Task 1. ✓
- Single `"plugin"` sidebar kind + `activePluginPanelId` (§5.3) → Decision 1 + Task 4. ✓
- Mount lifecycle: `onMount` once on first display, `onUnmount` on removal/unload (§5.6) → Task 2 + Decision 5, proven in Task 7. ✓
- Unload sweep drops all four registries + fires `onUnmount` → Task 1 (`unregisterPlugin`) + existing `unregisterPluginUI` + Task 7 (proof). ✓

**Design-decision consistency:** `"plugin"` (singular, contributed host) vs `"plugins"` (plural, manager) used consistently (Decision 1, Task 4). `onMount` always receives an inner `<div>` inside the shadow root — type `HTMLElement`, never `ShadowRoot` (Decision 3, Task 2). `settings` added to the `ui` gate + per-method guards, gate never weakened (Decision 4, Task 3). `onUnmount` fired by React unmount, not the store (Decision 5, Tasks 2/4/7).

**Type consistency:** `PluginSidebarPanelOptions`/`PluginSettingsTabOptions`/`CommandRegisterOptions` (types.ts, Task 1) consumed by `createUIAPI`/`createCommandsAPI` (Task 3/6). Store records `PluginSidebarPanel { panelId }` / `PluginSettingsTab { tabId }` / `PluginPaletteCommand { commandId }` (Task 1) match every producer (extension-context, Tasks 3/6) and consumer (`PluginPanelHost`/`PluginSettingsTabHost`/`CommandPalette`, Tasks 4/5/6). Namespacing: panels/tabs use `${pluginId}:${id}`; palette commands use `${pluginId}.${id}` (matches the command-handler registry key so `executePluginCommand(commandId)` resolves). `createUIAPI` new arity `(pluginId, capabilities, disposables)` matches its single call site (Task 3). `activePluginPanelId` is a `panelId` (namespaced) everywhere.

**Placeholder scan:** none — every step gives concrete code. The only `grep`-to-locate steps (CSS token confirmation, panels.css/settings.css insertion points) are because exact lines/tokens must match neighbors; the rules themselves are supplied with literal fallbacks.

**Spec-vs-code drift found (documented, not silently absorbed):**
1. `onMount(el)` type is `HTMLElement` but §5.3 prose says "shadowRoot" — resolved by passing an inner content div (Decision 3). ✓
2. `ui` gate is `sidebar||statusbar` in code but §4.1 title says "statusbar/sidebar/settings" — resolved by adding `settings` (Decision 4). ✓
3. `SidebarPanel` already has `"plugins"` (manager); spec §5.3's new `"plugin"` kind is a near-collision — flagged with a code comment (Decision 1). ✓
4. `PluginCapability` already includes `sidebar`/`settings` — NO addition needed for Phase C (Decision 6). ✓
5. AppLayout unmounts the whole Sidebar when `sidebarOpen` is false (`AppLayout.tsx:81` `showSidebar`), so toggling the sidebar closed fires `onUnmount` and reopening fires `onMount` — spec §5.3 wanted visibility to be CSS-only (no unmount). Honoring that would require restructuring AppLayout (out of scope, higher risk). Accepted deviation: lifecycle stays symmetric and correct; the "CSS-only visibility" optimization is deferred. Documented here so a reviewer is not surprised.

**Out of scope (later phases):** `ai`/`network`/`storage` APIs + the `storage` capability (Phase D); public `.d.ts` types, starter template, example plugins, `docs/plugin-development.md` rewrite (Phase E); registry schema + seed (Phase F). Genuine per-plugin storage isolation and sensitive-capability approval UX are Phase D.
