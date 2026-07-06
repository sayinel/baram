# Zettelkasten P2 — Plan 2c: UI enablement, index lifecycle, MOC, minor cleanup (§97 + §98)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Zettelkasten space user-reachable and robust: a settings UI to enable it + pick its directory + startup behavior; a fresh, context-scoped id→title index; startup that opens the home note / inbox; basic MOC support; and cleanup of carried Minors (keybinding namespace, index lifecycle M1/M2, autocomplete/selection nits).

**Architecture:** Add a Zettelkasten section to the General settings tab (mirror the Journal block). Fix the frontend index lifecycle so titles resolve without needing the workspace preset and don't leak across vault switches. Wire the space `startup` hook into app launch. Add a "New MOC" command (a `#moc`-tagged note from a template); discovery reuses the existing tag search. Rename the zettel keybindings' i18n keys to the `zettelkasten.*` namespace.

**Tech Stack:** React 19 + TS strict, Zustand (`useShallow`), Tiptap, Vitest.

**Design spec:** `docs/design/part13-zettelkasten-space.md` §97 (MOC), §98 (UI wiring / startup), and the carried review Minors from Plan 2a (keybinding namespace) + 2b-ii (M1 index-clear-on-switch, M2 refresh trigger, M3 autocomplete create-suppression, M4 selection paragraph breaks). Prereqs: Plans 1, 2a, 2b-i, 2b-ii all landed on this branch. **After 2c, the branch is merge-ready** (final whole-branch review + finishing-a-development-branch).

## Global Constraints

- TS strict; functional components + hooks; kebab-case; Zustand components use `useShallow`. WKWebView: no window.prompt.
- Zettel id `/^\d{12,14}$/`; `resolveZettelDir` absolute-only. Settings keys already exist (Plan 1): `zettelkastenEnabled`, `zettelkastenDirectory`, `zettelkastenStartupBehavior` (`"nothing" | "openInbox"`), `zettelkastenHomeNote` (+ their setters).
- Frontend R2 must remain intact: id-consulting paths still fire only for bare-id targets with an index hit. Index-lifecycle changes must NOT make non-zettel vaults consult stale zettel titles.
- Tests: `npm test` = `vitest run`. Baseline (branch): full suite 2676 passed | 6 skipped; tsc/eslint/knip clean; cargo 274.
- Conventional Commits, lowercase subject ≤100 chars, keep `§` refs.
- **Out of scope (YAGNI, noted):** a dedicated activity-bar item for the zettel space (opened via the "Open Zettelkasten" command from Plan 1; add later if wanted); Minor M5 (`[[./id]]` §61 relative-namespace edge — niche).

---

## File Structure

**Modified:**
- `src/components/settings/tabs/GeneralTab.tsx` — add a Zettelkasten settings section (mirror Journal).
- `src/i18n/en.json`, `src/i18n/ko.json` — zettel settings labels + rename keybinding label keys `journal.*` → `zettelkasten.*` (newNote/promote/newFromSelection).
- `src/keybindings/keybinding-registry.ts` — update the 3 zettel entries' `label` + `category` to `zettelkasten`.
- `src/stores/zettelkasten/zettel-index.ts` — nothing structural; the clear happens via a subscription wired in Task 2.
- `src/stores/context/context.ts` OR a subscription in app bootstrap — clear the zettel index on active-context change to a non-zettel vault (M1).
- `src/hooks/use-navigation.ts` / the file-open path — refresh the index when a file under the zettel dir opens (M2).
- `src/spaces/zettelkasten-space.ts` — `startup` opens home note / inbox (§98).
- `src/hooks/use-app-startup.ts` — invoke the active space's `startup` for zettel too.
- `src/services/zettelkasten-service.ts` — `createMoc` helper (§97).
- `src/hooks/use-keybinding-actions.ts` + registry + i18n — "New MOC" command.
- `src/extensions/plugins/wikilink-suggest.ts` — M3 (create-suppression by searchText).
- `src/utils/zettelkasten/` — M4 zettel-local selection extraction (avoid shared-helper blast radius).

---

## Task 1: Zettelkasten settings section (reachability)

**Files:**
- Modify: `src/components/settings/tabs/GeneralTab.tsx`
- Modify: `src/i18n/en.json`, `src/i18n/ko.json`
- Test: n/a (UI wiring; covered by manual QA in Task 8 + tsc)

**Interfaces:**
- Consumes: settings `zettelkastenEnabled`/`Directory`/`StartupBehavior`/`HomeNote` + setters (Plan 1); the `open` dialog + `SettingsRow`/`ToggleSwitch`/`SettingsSectionHeader` components already used by the Journal block in this file; `t()` i18n.

- [ ] **Step 1: Read the Journal block** in `GeneralTab.tsx` (~lines 191-260) to mirror its structure (SettingsSectionHeader → ToggleSwitch row → conditional directory picker via `open({directory:true})` → select). Pull the new settings values into the store selector at the top of the component (add `zettelkastenEnabled`, `zettelkastenDirectory`, `zettelkastenStartupBehavior`, `zettelkastenHomeNote` + their setters to the existing `useSettingsStore(useShallow(...))` selector).

- [ ] **Step 2: Add the Zettelkasten section** after the Journal section:

```tsx
      <SettingsSectionHeader title={t("settings.general.zettelkasten")} />

      <SettingsRow
        description={t("settings.general.zettelkastenEnabled.desc")}
        label={t("settings.general.zettelkastenEnabled")}
      >
        <ToggleSwitch
          checked={zettelkastenEnabled}
          onChange={setZettelkastenEnabled}
        />
      </SettingsRow>

      {zettelkastenEnabled && (
        <>
          <SettingsRow
            description={t("settings.general.zettelkastenDirectory.desc")}
            label={t("settings.general.zettelkastenDirectory")}
          >
            <div className="settings-key-row">
              <input
                className="settings-input settings-input-key"
                placeholder={t("settings.general.zettelkastenDirectory.placeholder")}
                readOnly
                type="text"
                value={zettelkastenDirectory}
              />
              <button
                className="settings-key-toggle"
                onClick={async () => {
                  const selected = await open({ directory: true });
                  if (typeof selected === "string") setZettelkastenDirectory(selected);
                }}
              >
                {t("common.browse")}
              </button>
            </div>
          </SettingsRow>

          <SettingsRow
            description={t("settings.general.zettelkastenStartup.desc")}
            label={t("settings.general.zettelkastenStartup")}
          >
            <select
              className="settings-select"
              onChange={(e) =>
                setZettelkastenStartupBehavior(e.target.value as "nothing" | "openInbox")
              }
              value={zettelkastenStartupBehavior}
            >
              <option value="openInbox">{t("settings.general.zettelkastenStartup.openInbox")}</option>
              <option value="nothing">{t("settings.general.zettelkastenStartup.nothing")}</option>
            </select>
          </SettingsRow>

          <SettingsRow
            description={t("settings.general.zettelkastenHomeNote.desc")}
            label={t("settings.general.zettelkastenHomeNote")}
          >
            <input
              className="settings-input"
              onChange={(e) => setZettelkastenHomeNote(e.target.value)}
              placeholder={t("settings.general.zettelkastenHomeNote.placeholder")}
              type="text"
              value={zettelkastenHomeNote}
            />
          </SettingsRow>
        </>
      )}
```

- [ ] **Step 3: Add the i18n keys** to `en.json` and `ko.json` (the `settings.general.zettelkasten*` keys used above — mirror the wording style of the journal keys). English + Korean values.

- [ ] **Step 4: Verify** `npx tsc --noEmit` clean + `npx vitest run` full suite (0 failures — if there is an i18n key-completeness test, it must pass with the new keys present in BOTH locales).

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/tabs/GeneralTab.tsx src/i18n/en.json src/i18n/ko.json
git commit -m "feat(zettelkasten §98): settings UI to enable + configure the space"
```

---

## Task 2: Context-scoped index lifecycle (M1 + M2)

**Files:**
- Modify: the active-context subscription point (`src/stores/context/context.ts` `setActiveContext`/`_setActiveContextLocal`, or a bootstrap subscription in `src/hooks/use-app-startup.ts`)
- Modify: the file-open path (`src/hooks/use-navigation.ts` or `openFileInTab`) to refresh when opening under the zettel dir
- Test: `src/stores/zettelkasten/__tests__/zettel-index.test.ts` (lifecycle)

**Interfaces:**
- Consumes: `useZettelIndexStore.clear`/`refreshZettelIndex`; `resolveZettelDir`; settings `zettelkastenDirectory`/`Enabled`; the active context.
- Behavior:
  - **M1:** when the active vault context changes to one whose path is NOT under the zettel dir (or zettel disabled), `useZettelIndexStore.getState().clear()`. When it changes to the zettel space, `refreshZettelIndex(dir)`.
  - **M2:** when a file whose path starts with `${zettelDir}/` is opened and the index is empty, `refreshZettelIndex(dir)` (so titles resolve even if the space was entered via file-tree/quick-switcher rather than the preset).

- [ ] **Step 1: Write the failing lifecycle test** — assert `clear()` empties `byId`; and a helper `maybeRefreshForPath(path, zettelDir)` (extract this into `zettel-index.ts`) triggers a refresh only for paths under `zettelDir`. Add `maybeRefreshForPath(openedPath: string, zettelDir: string | null): Promise<void>` to `zettel-index.ts` (no-op unless `zettelDir` && `openedPath.startsWith(zettelDir + "/")` && index empty).
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** `maybeRefreshForPath` in `zettel-index.ts`; call it from the file-open path (grep how `openFileInTab`/`use-navigation` opens a file; add the call with `resolveZettelDir(rootPath, zettelkastenDirectory)`). Wire the M1 clear/refresh: subscribe to context changes — simplest is in the context store's active-context setter, after the active context is set, compute whether it is the zettel space and `clear()`/`refreshZettelIndex()` accordingly (guard: only touch the index when `zettelkastenEnabled`). Keep it side-effect-light.
- [ ] **Step 4: Run → PASS** + `npx tsc --noEmit` + full suite (0 failures).
- [ ] **Step 5: Commit** — `fix(zettelkasten §95): scope the id index to the active zettel space (clear on switch, refresh on open)`.

---

## Task 3: Startup opens home note / inbox (§98)

**Files:**
- Modify: `src/spaces/zettelkasten-space.ts` (`startup`)
- Modify: `src/hooks/use-app-startup.ts` (invoke zettel startup)
- Test: registry/space test or a startup unit test where feasible

**Interfaces:**
- Consumes: settings `zettelkastenStartupBehavior`/`HomeNote`/`Enabled`/`Directory`; `openFileInTab`/`readFile`; `resolveZettelDir`; `refreshZettelIndex`.
- Behavior: `zettelkastenSpace.startup` (currently only ensures the context) — when `zettelkastenEnabled` and startup is `"openInbox"`: refresh the index, then open the home note if `zettelkastenHomeNote` is set and exists, else open the inbox folder's most-recent note (or just leave the inbox as the active file tree — opening a specific file is optional; at minimum refresh the index). In `use-app-startup.ts`, after the journal startup call, also invoke `getSpace("zettelkasten")?.startup?.()` (self-guarded, so it no-ops when disabled/no context).
- Behavior must be gated: `"nothing"` → do nothing beyond ensuring context; disabled → no-op.

- [ ] Steps 1-5 (TDD): test the gating (disabled/`"nothing"` → no open; `"openInbox"` + home note set → opens it) at the unit level where the harness allows; wire the call; tsc + full suite; commit `feat(zettelkasten §98): open home note / inbox on startup`.

---

## Task 4: New MOC command (§97, basic)

**Files:**
- Modify: `src/services/zettelkasten-service.ts` (`createMoc`)
- Modify: `src/keybindings/keybinding-registry.ts` + `use-keybinding-actions.ts` + `CommandPalette.tsx` + i18n
- Test: service test for `createMoc`

**Interfaces:**
- Consumes: `createZettelNote` machinery (id gen + write + open). Produces `createMoc(zettelDir, title): Promise<{path,id}>` — a permanent note whose body is a MOC template: an H1 title, a `#moc` tag line, and a "## 노트" section placeholder for curated links.
- Behavior: `zettelkasten.newMoc` command → title via `ZettelTitleDialog` → `createMoc`. Discovery of MOCs reuses the existing tag search (`#moc`) — no new sidebar panel in this slice.

- [ ] **Step 1: Write the failing test** — `createMoc("/z","Index")` writes a note containing `# Index`, a `#moc` line, and returns `{path,id}`; filename `notes/{id} Index.md`.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** `createMoc` (reuse `generateZettelId` + `buildPermanentNote` with a MOC body appended: `\n#moc\n\n## 관련 노트\n`), upsert to the index, open the file. Register the `zettelkasten.newMoc` action (dialog → createMoc), keybinding (a FREE key — verify), a Command Palette entry, en/ko i18n under the `zettelkasten.*` namespace.
- [ ] **Step 4: Run → PASS** + tsc + full suite (keybinding uniqueness green).
- [ ] **Step 5: Commit** — `feat(zettelkasten §97): New MOC command creates a #moc index note`.

---

## Task 5: Keybinding i18n namespace cleanup (carried Minor)

**Files:**
- Modify: `src/keybindings/keybinding-registry.ts` (3 existing zettel entries: newNote, promote, newFromSelection — from 2a/2b-ii)
- Modify: `src/i18n/en.json`, `src/i18n/ko.json`
- Test: full suite (registry label-existence test is the gate)

**Interfaces:** the registry test asserts each entry's `label` = `keybindings.{category}.{shortName}` and the key exists in i18n. Currently the zettel entries use `category: "journal"` + `label: keybindings.journal.newNote` etc. Move them to a `zettelkasten` category + `keybindings.zettelkasten.*` labels.

- [ ] **Step 1: Rename** the 3 entries' `category` → `"zettelkasten"` and `label` → `keybindings.zettelkasten.newNote` / `.promote` / `.newFromSelection` (+ the new `.newMoc` from Task 4). Add `"zettelkasten"` to the keybinding category union/list if the registry enumerates categories (check `keybinding-registry.ts` top — there is a `category` type + a categories array). Add a category display label if categories have i18n labels.
- [ ] **Step 2: Move the i18n keys** in en.json + ko.json from `keybindings.journal.newNote`/`.promote`/`.newFromSelection` to `keybindings.zettelkasten.*` (same values). Ensure no dangling `keybindings.journal.*` keys remain for these.
- [ ] **Step 3: Verify** `npx tsc --noEmit` + full suite (the keybinding-registry label/category tests + i18n completeness test must pass; the registry test that sums category groups must still equal total).
- [ ] **Step 4: Commit** — `refactor(zettelkasten §98): move zettel keybindings to the zettelkasten category`.

---

## Task 6: Autocomplete create-suppression + selection fidelity (M3 + M4)

**Files:**
- Modify: `src/extensions/plugins/wikilink-suggest.ts` (M3)
- Modify: `src/hooks/use-keybinding-actions.ts` + a zettel-local selection helper (M4)
- Test: extend the relevant tests

**Interfaces / behavior:**
- **M3:** in `wikilink-suggest.ts` the `hasExact` check (~line 338-341) compares the query to `f.target`; for zettel items `target` is the id. Compare against `f.searchText ?? f.target` so an exact existing zettel TITLE suppresses the redundant `Create "<title>"` item.
- **M4:** New-from-selection currently reads the selection via the shared `getSelectedText` (`ai-commands.ts`, `textBetween` with no separator) → multi-paragraph selections lose structure and the title-derivation can swallow the whole selection. Add a zettel-local `getSelectionMarkdown(editor)` (use `textBetween(from, to, "\n\n")` for a block separator) and use it in the newFromSelection action for the note body; derive the title from its first non-empty line. Do NOT change the shared `getSelectedText` (wider blast radius).

- [ ] Steps 1-5 (TDD): test M3 (an exact-title query yields no Create item when the zettel note exists) + M4 (a two-paragraph selection produces a body with the paragraph break preserved and a title = first line only); implement; tsc + full suite; commit `fix(zettelkasten §95): suppress redundant Create on title match + preserve selection paragraphs`.

---

## Task 7: Full verification

- [ ] `npx tsc --noEmit` clean; `npx vitest run` 0 failures (>= baseline + new tests); `npx eslint` (changed dirs) clean; `npx knip` no new unused; `cd src-tauri && cargo test` unchanged (274 — no Rust changes in 2c).

---

## Task 8: Manual GUI QA (fully relaunch `npm run tauri dev`)

- [ ] Settings → enable Zettelkasten + pick a directory. Command Palette "Open Zettelkasten" → space opens, `inbox/`+`notes/` exist.
- [ ] New Zettel (Mod+Shift+K) → title dialog → note created + opened. Type `[[`, search by title → pill shows title. Rename a note's title → existing `[[id]]` pills update.
- [ ] Quick Capture → inbox; Promote (Mod+Shift+P) an inbox note → moves to notes/. New-from-selection (Mod+Shift+E) → note + link, paragraphs preserved. New MOC → `#moc` note.
- [ ] Open a zettel note via the file tree (not the preset) → titles still resolve (M2). Switch to another vault → `[[id]]`-looking links there are NOT hijacked (M1). Export (Notion/Pandoc/HTML) → titles shown; saved `.md` still `[[id]]`.
- [ ] No commit unless a fix is needed (dispatch a fix if QA finds a defect).

---

## Self-Review

- **Spec coverage:** §98 UI (settings T1) + startup (T3); §97 MOC (T4). Carried Minors: M1/M2 index lifecycle (T2), keybinding namespace (T5), M3/M4 (T6). Deferred/YAGNI (noted): activity-bar item, M5 `[[./id]]`.
- **Reachability:** T1 makes the feature usable end-to-end (enable + dir); combined with 2a/2b it completes the user-facing loop. After 2c + a whole-branch review, the branch is merge-ready.
- **Frontend R2 preserved:** T2's lifecycle changes CLEAR the index off the zettel space (so non-zettel vaults never consult stale titles — fixes M1 which was the one cross-vault exposure), and refresh only for paths under the zettel dir. No new id-consulting path.
- **Placeholder scan:** T1/T2/T3/T5/T6 name the exact files + behavior + tests; the "read the Journal block / grep the file-open path / check the category list" notes are in-situ discovery for existing code, not deferred logic. T3/T6 use compact step lists (the behavior + test assertions are pinned) consistent with modifying existing UI/editor code.
- **Type consistency:** reuses `createZettelNote`/`generateZettelId`/`buildPermanentNote`/`refreshZettelIndex`/`useZettelIndexStore`/`resolveZettelDir`/`titleForId`/`idForTitle` from prior plans; new `createMoc(dir,title)→{path,id}`, `maybeRefreshForPath(path,dir)`, `getSelectionMarkdown(editor)`.
- **Merge readiness:** after Task 8, run a whole-branch final review across ALL of Plan 1+2a+2b+2c (the comprehensive review deferred through the sub-plans), then superpowers:finishing-a-development-branch.
