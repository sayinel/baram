// §54 / #330 follow-up — leaving the theme editor must not PIN the preview.
//
// The editor restored by SETTING the source colours back, but `system`,
// `default-light` and `default-dark` apply no inline variables at all: their values
// come from src/styles/generated/. So opening the editor on `system` (which falls
// back to the default-light palette) and pressing Cancel wrote 28 light variables
// inline, where they outranked the dark media query — a `system` user on an OS dark
// theme was left with a light UI, and only switching themes recovered it, because
// the settings effect depends on [activeThemeId, customThemes] and cancel changes
// neither.
import { useState } from "react";

import type { ThemeDef } from "../../../types/theme";

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useSettingsEffects } from "../../../hooks/use-settings-effects";
import { useSettingsStore } from "../../../stores/settings/store";
import { useUIStore } from "../../../stores/ui/ui";
import { solePalette } from "../../../types/__tests__/helpers/theme-palette";
import {
  BUILT_IN_THEMES,
  defaultColorsForBase,
  THEME_COLOR_KEYS,
} from "../../../types/theme";
import { ThemeEditor } from "../ThemeEditor";

// ‼️ `useSettingsEffects` syncs two native menus through a LAZY `import()` (§82). This file
// calls that hook, so those loads start here — and one of them resolved after vitest tore
// this file's environment down, failing the whole run with an `EnvironmentTeardownError`
// while all 4,407 tests passed. Mocking both modules makes that structurally impossible:
// the dynamic import resolves from the mock registry and never reaches the loader.
//
// The paths must keep matching the ones `use-settings-effects.ts` imports — if the hook
// moves a module, these mocks silently stop applying and the flake comes back. That is what
// `keeps the native-menu IPC modules out of the loader` below pins.
// §341 added a THIRD native-menu effect (grey out disabled-feature menu
// items) behind the same lazy `import()` — same reason, same mock.
const menuIpc = vi.hoisted(() => ({
  syncMenuLocale: vi.fn(() => Promise.resolve()),
  syncRecentMenu: vi.fn(() => Promise.resolve()),
  syncMenuEnabled: vi.fn(() => Promise.resolve()),
}));
vi.mock("../../../ipc/menu-locale", () => ({
  syncMenuLocale: menuIpc.syncMenuLocale,
}));
vi.mock("../../../ipc/recent-menu", () => ({
  syncRecentMenu: menuIpc.syncRecentMenu,
}));
vi.mock("../../../ipc/menu-enabled", () => ({
  syncMenuEnabled: menuIpc.syncMenuEnabled,
}));

// 0091 fix round 2 — the package-export click chain (item 3 / N4) needs these three
// mocked: the native save dialog, and the two IPC calls `handleExportPackage` makes
// after it. None of the existing tests in this file click either export button, so
// mocking these file-wide cannot affect them.
const dialogMock = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: dialogMock.save }));

const themeIpcMock = vi.hoisted(() => ({ themePackageBuild: vi.fn() }));
vi.mock("../../../ipc/theme", () => ({
  themePackageBuild: themeIpcMock.themePackageBuild,
}));

const fsIpcMock = vi.hoisted(() => ({ exportBinaryFile: vi.fn() }));
vi.mock("../../../ipc/fs", () => ({
  exportBinaryFile: fsIpcMock.exportBinaryFile,
}));

const NORD = BUILT_IN_THEMES.find((t) => t.id === "nord")!;
const NORD_COLORS = solePalette(NORD);

const ACCENT = "--color-accent-default";
const ACCENT_LABEL = THEME_COLOR_KEYS.find((e) => e.key === ACCENT)!.label;
const SENTINEL = "#123456";
/** 기본 라이트 강조 `#3b82f6` 을 `accentHueShift: 60` 으로 돌린 값(§367, 실측). */
const SHIFTED_ACCENT = "#af3bf6";

function accentValue(): string {
  return document.documentElement.style.getPropertyValue(ACCENT);
}

/** Edit the accent swatch the way a user does, so a restore has something to undo. */
function editAccent(): void {
  // Scoped to the row label: the category heading carries the same text.
  const label = screen.getByText(ACCENT_LABEL, {
    selector: ".theme-editor-label",
  });
  const input = label
    .closest(".theme-editor-row")!
    .querySelector<HTMLInputElement>('input[type="color"]')!;
  fireEvent.change(input, { target: { value: SENTINEL } });
  expect(accentValue()).toBe(SENTINEL);
}

const CUSTOM: ThemeDef = {
  id: "custom-1730000000000",
  modes: { dark: { colors: { ...NORD_COLORS } } },
  name: "Mine",
  source: "custom",
};

function inlineVarCount(): number {
  return document.documentElement.style.length;
}

describe("ThemeEditor — leaving the editor", () => {
  beforeEach(() => {
    document.documentElement.style.cssText = "";
    // The Cancel button is queried by its label, so pin the locale rather than
    // inherit whatever the store defaults to.
    useSettingsStore.setState({
      activeThemeId: "system",
      // 다이얼은 이 describe 의 한 케이스만 쓴다 — 모듈 상태라 비워 두지 않으면
      // 그 케이스가 뒤의 인라인 변수 개수 단언을 오염시킨다.
      appearanceOverrides: {},
      customThemes: [],
      locale: "en",
    });
  });

  it.each(["system", "default-light", "default-dark"])(
    "clears the preview rather than pinning it when %s is active",
    (id) => {
      useSettingsStore.setState({ activeThemeId: id });
      render(<ThemeEditor onClose={() => {}} />);
      // The live preview does write inline variables — that is what makes the
      // editor usable, and what has to be undone by removal, not by overwrite.
      expect(inlineVarCount()).toBeGreaterThan(0);

      fireEvent.click(screen.getByText("Cancel"));

      expect(inlineVarCount()).toBe(0);
    },
  );

  it("clears the preview when the editor unmounts on a cascade-only theme", () => {
    // Navigating away instead of pressing Cancel reaches a second restore site.
    const { unmount } = render(<ThemeEditor onClose={() => {}} />);
    expect(inlineVarCount()).toBeGreaterThan(0);

    unmount();

    expect(inlineVarCount()).toBe(0);
  });

  it("restores the ORIGINAL colour after an edit when a custom theme is active", () => {
    // The other direction: a theme whose colours only exist inline must get them
    // back, or cancelling would strip the user's active theme down to the cascade.
    // The edit is what makes this test able to fail: without it the preview already
    // holds the source colours, so a restore that does nothing — or one that reads
    // the live `colors` state instead of the captured original, deleting the only
    // reason originalColorsRef exists — would pass just the same.
    // Boundary (measured): swapping in `colors`/`base` while leaving handleCancel's
    // deps at [onClose] is an EQUIVALENT mutant — the stale closure still holds the
    // first render's colours. This test kills that swap only once the deps follow,
    // which is the form a real "simplification" takes.
    useSettingsStore.setState({
      activeThemeId: CUSTOM.id,
      customThemes: [CUSTOM],
    });
    render(<ThemeEditor onClose={() => {}} />);
    editAccent();

    fireEvent.click(screen.getByText("Cancel"));

    expect(accentValue()).toBe(NORD_COLORS[ACCENT]);
  });

  it("restores the ORIGINAL colour after an edit when the editor unmounts", () => {
    useSettingsStore.setState({
      activeThemeId: CUSTOM.id,
      customThemes: [CUSTOM],
    });
    const { unmount } = render(<ThemeEditor onClose={() => {}} />);
    editAccent();

    unmount();

    expect(accentValue()).toBe(NORD_COLORS[ACCENT]);
  });

  it("keeps a saved theme applied when the editor closes in a later commit", () => {
    // handleSave does not restore anything: it relies on the unmount cleanup running
    // BEFORE the settings effect re-applies the newly saved theme, which holds only
    // because React flushes passive destroys before creates within ONE commit. Close
    // the editor in a later commit — what a transition or a deferred onClose would do
    // — and the cleanup lands last, undoing a preview that has since become a real
    // theme: `data-theme` set, palette gone, and the settings effect will not re-run
    // to repair it because [activeThemeId, customThemes] no longer change.
    let closeEditor = (): void => {};
    function Host() {
      useSettingsEffects(null);
      const [open, setOpen] = useState(true);
      closeEditor = () => setOpen(false);
      return open ? <ThemeEditor onClose={() => {}} /> : null;
    }

    render(<Host />);
    editAccent();
    fireEvent.click(screen.getByText("Save"));

    act(() => closeEditor());

    expect(accentValue()).toBe(SENTINEL);
  });

  // §367 리뷰 I3 — 편집기를 닫는 것이 강조 다이얼의 이동을 되돌렸다.
  //
  // `restorePreview()` 는 저장된 테마의 시드만 알고 다이얼을 모른다. 예전에는 그것이
  // 마지막 작성자였고(소유권 해제가 **먼저** 돌아 테마 이펙트를 다시 돌린 뒤 되돌리기가
  // 그 결과를 덮었다), 그 뒤로 `<html>` 은 테마 id·`customThemes`·`installedThemes`·
  // CSS 캐시·다이얼 값 중 하나가 움직일 때까지 이동 없는 강조를 들고 있었다.
  it("keeps the accent dial's shift after the editor closes", () => {
    useSettingsStore.setState({ appearanceOverrides: { accentHueShift: 60 } });
    let closeEditor = (): void => {};
    let openEditor = (): void => {};
    function Host() {
      useSettingsEffects(null);
      const [open, setOpen] = useState(false);
      closeEditor = () => setOpen(false);
      openEditor = () => setOpen(true);
      return open ? <ThemeEditor onClose={() => {}} /> : null;
    }

    render(<Host />);
    // 양성 기준선: 다이얼이 실제로 무언가를 쓴다. 이것이 없으면 아래 마지막 단언은
    // "다이얼이 아예 동작하지 않는다" 와 구별되지 않는다. `#af3bf6` 는 기본 라이트
    // 강조 `#3b82f6` 을 +60° 돌린 값이다(`accent-dials.test.ts` 의 실측 표).
    expect(accentValue()).toBe(SHIFTED_ACCENT);

    act(() => openEditor());
    // 미리보기는 저장된 팔레트를 그대로 깐다 — 이동이 사라진 상태가 실제로 생긴다.
    // 이 단언이 없으면 마지막 단언은 "편집기가 아무것도 안 했다" 로도 통과한다.
    expect(accentValue()).not.toBe(SHIFTED_ACCENT);

    act(() => closeEditor());

    expect(accentValue()).toBe(SHIFTED_ACCENT);
  });

  it("keeps the mode it did not edit when a paired theme is saved", () => {
    // handleSave used to REPLACE `modes` with `{ [base]: … }`. The editor always
    // starts on `themeModes(sourceTheme)[0]`, which is a fixed light-then-dark
    // order, so a theme carrying both palettes opened on light — and saving one
    // colour deleted the dark half with no warning and nothing to undo it with.
    // Nothing on this branch builds a two-mode theme yet; plan 0090's installed
    // themes do, and the editor is reachable from any card in the gallery.
    const PAIRED: ThemeDef = {
      id: "custom-paired",
      modes: {
        dark: { colors: { ...NORD_COLORS } },
        light: { colors: { ...defaultColorsForBase("light") } },
      },
      name: "Paired",
      source: "custom",
    };
    useSettingsStore.setState({
      activeThemeId: PAIRED.id,
      customThemes: [PAIRED],
    });
    render(<ThemeEditor onClose={() => {}} />);
    editAccent();

    fireEvent.click(screen.getByText("Save"));

    const saved = useSettingsStore
      .getState()
      .customThemes.find((t) => t.id === PAIRED.id)!;
    // The edited half took the change…
    expect(saved.modes.light?.colors?.[ACCENT]).toBe(SENTINEL);
    // …and the half the editor never showed is still there, byte for byte.
    expect(saved.modes.dark?.colors).toEqual(NORD_COLORS);
  });

  it("keeps the native-menu IPC modules out of the loader", async () => {
    // Not a theme assertion — it pins the mocks above to the paths the hook actually
    // imports. Reaching the MOCK is the observable proof that the real module was not
    // loaded, and it is the only thing that fails if `use-settings-effects.ts` renames one
    // of those imports: the `vi.mock` would then apply to nothing, this file would start
    // loading Tauri IPC again, and the teardown race would return with no other test
    // noticing.
    function Host() {
      useSettingsEffects(null);
      return null;
    }

    render(<Host />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(menuIpc.syncMenuLocale).toHaveBeenCalled();
    expect(menuIpc.syncRecentMenu).toHaveBeenCalled();
  });
});

// §363 / 0091 fix round 1, Finding 1 (MAJOR) — the package-export guard
// (`canExportPackage`, ThemeEditor.tsx) had zero coverage. Mutation C2
// (`&&` → `||` in the guard) and mutation C (deleting `disabled={...}`
// outright) were both green before these tests existed.
describe("ThemeEditor — package export guard", () => {
  beforeEach(() => {
    document.documentElement.style.cssText = "";
    useSettingsStore.setState({
      activeThemeId: "system",
      customThemes: [],
      locale: "en",
    });
  });

  function packageButton(): HTMLButtonElement {
    return screen.getByRole("button", { name: "Export Theme Package" });
  }

  // `system` resolves to the "default-light" built-in, whose editor `name`
  // starts as "Custom Default Light" (builtin source), so the id field's
  // slugified default ("custom-default-light") is already valid — these
  // tests only fill the four fields the id-default cannot supply.
  function fillEveryFieldButOne(skip: string): void {
    const fields: Record<string, string> = {
      Author: "Ada",
      Description: "A theme",
      "License (e.g. MIT)": "MIT",
      "Version (e.g. 1.0.0)": "1.0.0",
    };
    for (const [label, value] of Object.entries(fields)) {
      if (label === skip) continue;
      fireEvent.change(screen.getByLabelText(label), {
        target: { value },
      });
    }
  }

  it("is disabled until all four meta fields are filled, then enables", () => {
    render(<ThemeEditor onClose={() => {}} />);
    expect(packageButton().disabled).toBe(true);

    fillEveryFieldButOne("Version (e.g. 1.0.0)");
    // Mutation C2 kill: three of four filled must NOT be enough if the
    // guard genuinely requires every field (an `&&`→`||` mutant would
    // already be enabled here, on the very first filled field).
    expect(packageButton().disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Version (e.g. 1.0.0)"), {
      target: { value: "1.0.0" },
    });
    expect(packageButton().disabled).toBe(false);
  });

  it("stays disabled when only one of the four fields is filled (mutation C2)", () => {
    render(<ThemeEditor onClose={() => {}} />);

    fireEvent.change(screen.getByLabelText("Author"), {
      target: { value: "Ada" },
    });

    expect(packageButton().disabled).toBe(true);
  });

  it("rejects a package id outside [a-z0-9-], even with everything else filled", () => {
    render(<ThemeEditor onClose={() => {}} />);
    fillEveryFieldButOne("");

    fireEvent.change(screen.getByLabelText("id (e.g. my-theme)"), {
      target: { value: "Not Valid!" },
    });

    expect(packageButton().disabled).toBe(true);
  });
});

// 0091 fix round 2, Finding N1 (MEDIUM, re-review) — the id default's danger was not
// "empty before a name exists" (that's guarded: an unslugifiable name leaves the id
// empty, and the guard blocks on that same as any other empty field). It is a RENAME
// after the default landed: open on `system` → id defaults to "custom-default-light" →
// rename the theme → id is STILL "custom-default-light" and the guard, which only
// checks the id's FORMAT, stays satisfied. Standard slug-field fix: sync the id from
// the name until the id field itself is edited, then stop.
describe("ThemeEditor — package id follows the name until touched", () => {
  beforeEach(() => {
    document.documentElement.style.cssText = "";
    useSettingsStore.setState({
      activeThemeId: "system",
      customThemes: [],
      locale: "en",
    });
  });

  function idInput(): HTMLInputElement {
    return screen.getByLabelText("id (e.g. my-theme)");
  }

  it("re-slugifies the id when the name changes, before the id field is touched", () => {
    render(<ThemeEditor onClose={() => {}} />);
    expect(idInput().value).toBe("custom-default-light");

    fireEvent.change(screen.getByLabelText("Theme name..."), {
      target: { value: "Solar Flare" },
    });

    expect(idInput().value).toBe("solar-flare");
  });

  it("stops following the name once the id field has been edited directly", () => {
    render(<ThemeEditor onClose={() => {}} />);

    fireEvent.change(idInput(), { target: { value: "my-own-id" } });
    fireEvent.change(screen.getByLabelText("Theme name..."), {
      target: { value: "Solar Flare" },
    });

    // The bug this pins: without the touched flag, this silently becomes
    // "solar-flare", clobbering the id the author just typed by hand.
    expect(idInput().value).toBe("my-own-id");
  });
});

// 0091 fix round 2, Item 3 (re-review) — `handleExportPackage`'s success path, its
// dropped-mode warning, and its error handling were all added across this task and its
// first fix round with zero coverage: deleting the `themePackageBuild` →
// `exportBinaryFile` pair outright stayed green throughout (Task 2's Major 2 shape).
describe("ThemeEditor — package export click chain", () => {
  beforeEach(() => {
    document.documentElement.style.cssText = "";
    useSettingsStore.setState({
      activeThemeId: "system",
      customThemes: [],
      locale: "en",
    });
    useUIStore.setState({ toast: null });
    dialogMock.save.mockReset().mockResolvedValue("/tmp/exported.zip");
    themeIpcMock.themePackageBuild.mockReset().mockResolvedValue([1, 2, 3]);
    fsIpcMock.exportBinaryFile.mockReset().mockResolvedValue(undefined);
  });

  function packageButton(): HTMLButtonElement {
    return screen.getByRole("button", { name: "Export Theme Package" });
  }

  function fillAllPackageMeta(): void {
    fireEvent.change(screen.getByLabelText("Author"), {
      target: { value: "Ada" },
    });
    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "A theme" },
    });
    fireEvent.change(screen.getByLabelText("License (e.g. MIT)"), {
      target: { value: "MIT" },
    });
    fireEvent.change(screen.getByLabelText("Version (e.g. 1.0.0)"), {
      target: { value: "1.0.0" },
    });
  }

  it("a successful click builds the entry map and exports the bytes it got back", async () => {
    render(<ThemeEditor onClose={() => {}} />);
    fillAllPackageMeta();

    fireEvent.click(packageButton());

    await waitFor(() => expect(fsIpcMock.exportBinaryFile).toHaveBeenCalled());

    expect(themeIpcMock.themePackageBuild).toHaveBeenCalledTimes(1);
    const entries = themeIpcMock.themePackageBuild.mock.calls[0]?.[0] as Record<
      string,
      Uint8Array
    >;
    expect(Object.keys(entries)).toEqual(
      expect.arrayContaining(["baram-theme.json", "light/tokens.json"]),
    );
    expect(fsIpcMock.exportBinaryFile).toHaveBeenCalledWith(
      "/tmp/exported.zip",
      [1, 2, 3],
    );
  });

  it("warns when a declared mode has no colours to export", async () => {
    const CSS_ONLY_DARK: ThemeDef = {
      id: "custom-css-only",
      modes: {
        dark: { css: "body { color: red; }" },
        light: { colors: { ...defaultColorsForBase("light") } },
      },
      name: "CSS Only Dark",
      source: "custom",
    };
    useSettingsStore.setState({
      activeThemeId: CSS_ONLY_DARK.id,
      customThemes: [CSS_ONLY_DARK],
    });
    render(<ThemeEditor onClose={() => {}} />);
    fillAllPackageMeta();

    fireEvent.click(packageButton());

    await waitFor(() => expect(fsIpcMock.exportBinaryFile).toHaveBeenCalled());

    // "Dark", not the raw mode id "dark" — the toast reuses the same key the base
    // toggle two rows above it already renders (0091 fix round 2, Finding N4).
    expect(useUIStore.getState().toast?.type).toBe("warning");
    expect(useUIStore.getState().toast?.message).toContain("Dark");
  });

  it("shows an error toast instead of an unhandled rejection when the export IPC fails", async () => {
    fsIpcMock.exportBinaryFile.mockReset();
    fsIpcMock.exportBinaryFile.mockRejectedValueOnce(new Error("disk full"));
    render(<ThemeEditor onClose={() => {}} />);
    fillAllPackageMeta();

    fireEvent.click(packageButton());

    await waitFor(() =>
      expect(useUIStore.getState().toast?.type).toBe("error"),
    );
    expect(useUIStore.getState().toast?.message).toContain("disk full");
  });
});
