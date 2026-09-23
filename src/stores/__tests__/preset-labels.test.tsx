// §343 — perspective NAME parity across the four translated surfaces (fix-g2, PR #626
// follow-up). The status bar dropdown rendered `preset.name` — an English literal straight out
// of the store — while the settings card assembled `` t(`settings.workspace.preset.${id}`) ``.
// Five tables disagreed; `zettelkasten`'s name key never existed in either catalog at all, so
// `t()`'s "return the key itself" fallback (`src/i18n/index.ts:37`) put the raw key on screen.
//
// ‼️ EN CANNOT SEE THIS DEFECT. `menu.workspace.writing` and (the now-removed)
// `settings.workspace.preset.writing` were BOTH "Writing" in en.json, so an en-only assertion
// passes whether the two surfaces share a key or not. Every discriminating assertion below (c
// and d) runs the `ko` locale — that is deliberate, not incidental.
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { StatusBar } from "../../components/layout/StatusBar";
import { WorkspacePresets } from "../../components/settings/tabs/workspace-presets";
import { t } from "../../i18n";
import en from "../../i18n/en.json";
import ko from "../../i18n/ko.json";
import { useEditorStore } from "../editor/editor";
import { useFileStore } from "../file/file";
import { BUILTIN_PRESETS, useWorkspaceStore } from "../file/workspace";
import { useSettingsStore } from "../settings/store";

const EN = en as Record<string, string>;
const KO = ko as Record<string, string>;

// The canonical Korean names §343 settled on (`menu.workspace.*`) — glossed inline so a
// mismatch reads as "expected X, got Y" rather than "expected EXPECTED_KO_NAME.zettelkasten".
const EXPECTED_KO_NAME: Record<string, string> = {
  focus: "포커스",
  journal: "저널",
  skills: "스킬 편집",
  writing: "글쓰기",
  zettelkasten: "제텔",
};

function resetStoresForRender() {
  useWorkspaceStore.setState({ activePresetId: null, customPresets: [] });
  useEditorStore.setState({ activeTabId: null, tabs: [] });
  useFileStore.getState().setRootPath("/vault");
  useSettingsStore.setState({
    journalEnabled: true,
    locale: "ko",
    zettelkastenEnabled: true,
  });
}

describe("(a) BUILTIN_PRESETS' nameKey/descKey are real entries in BOTH catalogs", () => {
  // ‼️ Asserted against the catalog objects directly (`in`), not against `t()`'s return value:
  // `t()` falls back to the key string itself for a missing entry, and comparing that fallback
  // to something is exactly the check that let `settings.workspace.preset.zettelkasten` (name)
  // ship missing from both catalogs in the first place. The catalog is an independent oracle —
  // it does not come from the same table as `BUILTIN_PRESETS`.
  it.each(BUILTIN_PRESETS)("id=$id", (preset) => {
    expect(preset.nameKey in EN).toBe(true);
    expect(preset.nameKey in KO).toBe(true);
    expect(preset.descKey in EN).toBe(true);
    expect(preset.descKey in KO).toBe(true);
  });
});

describe("(b) built-in preset literals are pinned to their en catalog translation", () => {
  // Without this, `name`/`description` could drift from en.json's value for the same key and
  // nothing would fail — `presetDisplayName`/`presetDisplayDescription` only ever read the key
  // in a component; nothing else compares the two.
  it.each(BUILTIN_PRESETS)("id=$id", (preset) => {
    expect(t(preset.nameKey, "en")).toBe(preset.name);
    expect(t(preset.descKey, "en")).toBe(preset.description);
  });
});

describe("(c) built-in presets translate to the canonical menu.workspace.* Korean names", () => {
  // This is the regression's actual detector: a wrong or missing `nameKey` shows up here as a
  // wrong Korean string, where it was invisible in every en-only test that existed before.
  it.each(BUILTIN_PRESETS)("id=$id", (preset) => {
    expect(t(preset.nameKey, "ko")).toBe(EXPECTED_KO_NAME[preset.id]);
  });
});

describe("(d) StatusBar dropdown and workspace-presets.tsx's gallery agree, in ko", () => {
  it("render the identical Korean name for every built-in preset", () => {
    resetStoresForRender();

    const statusBar = render(<StatusBar editor={null} mode="wysiwyg" />);
    fireEvent.click(statusBar.getByTestId("perspective-launcher"));
    const statusBarNames = [
      ...document.querySelectorAll(".status-space-menu-item"),
    ].map((el) => el.textContent?.trim());
    statusBar.unmount();

    // Rendered directly, not through a host tab — `workspace-presets.tsx` is the actual
    // consumer of `isPresetVisible`/`presetDisplayName` (task-5-brief.md controller
    // correction); the tab that renders it moved from AppearanceTab to ActivityBarTab
    // in §370/task-5, but that move must not change which names this test compares.
    const gallery = render(<WorkspacePresets />);
    const galleryNames = [
      ...document.querySelectorAll(".workspace-card-name"),
    ].map((el) => el.textContent?.trim());
    gallery.unmount();

    // Pin the actual expected values, not just cross-surface equality — two surfaces sharing
    // the SAME wrong string would still pass a bare `toEqual` between them.
    const expected = BUILTIN_PRESETS.map((p) => EXPECTED_KO_NAME[p.id]);
    expect(statusBarNames).toEqual(expected);
    expect(galleryNames).toEqual(expected);
  });
});
