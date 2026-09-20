// §361 — the async half of applying a community theme's CSS: `installedThemeToDef` never
// invents a mode's `css` text, only `readStoredThemeCss` does, and this hook is the one
// caller that fetches it and drops the result in `useThemeCssCacheStore`.
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const readStoredThemeCss =
  vi.fn<(id: string, mode: "dark" | "light") => Promise<null | string>>();
vi.mock("../../themes/theme-store-fs", () => ({
  readStoredThemeCss: (id: string, mode: "dark" | "light") =>
    readStoredThemeCss(id, mode),
}));

import type { InstalledTheme } from "../../themes/theme-install";

import { useThemeCssCacheStore } from "../../stores/system/theme-css-cache";
import { useThemeCssHydration } from "../use-theme-css-hydration";

function Host({
  activeThemeId,
  installedThemes,
}: {
  activeThemeId: string;
  installedThemes: Record<string, InstalledTheme>;
}) {
  useThemeCssHydration(activeThemeId, installedThemes);
  return null;
}

function installed(over: Partial<InstalledTheme> = {}): InstalledTheme {
  return {
    checksum: "c".repeat(64),
    consentedAt: "2026-09-01T00:00:00.000Z",
    consentedVersion: "1.0.0",
    id: "dracula",
    installedAt: "2026-09-01T00:00:00.000Z",
    installPath: "/home/.baram/themes/dracula",
    manifest: {
      author: "a",
      description: "d",
      engines: { baram: ">=0.7.0" },
      id: "dracula",
      license: "MIT",
      modes: { light: {} },
      name: "Dracula",
      version: "1.0.0",
    },
    modes: { light: { css: true } },
    ...over,
  };
}

const originalMatchMedia = window.matchMedia;

beforeEach(() => {
  readStoredThemeCss.mockReset();
  useThemeCssCacheStore.setState({ entries: {} });
  window.matchMedia = ((query: string) => ({
    addEventListener: () => {},
    matches: false,
    media: query,
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  window.matchMedia = originalMatchMedia;
});

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("useThemeCssHydration", () => {
  it("does nothing for a theme that is not installed (builtin/custom/system)", async () => {
    render(<Host activeThemeId="default-light" installedThemes={{}} />);
    await flush();
    expect(readStoredThemeCss).not.toHaveBeenCalled();
  });

  it("does nothing for an installed theme whose active mode has no CSS", async () => {
    render(
      <Host
        activeThemeId="dracula"
        installedThemes={{
          dracula: installed({ modes: { light: { css: false } } }),
        }}
      />,
    );
    await flush();
    expect(readStoredThemeCss).not.toHaveBeenCalled();
  });

  it("fetches and caches the active mode's CSS for an installed theme that has it", async () => {
    readStoredThemeCss.mockResolvedValue("body{color:red}");
    render(
      <Host
        activeThemeId="dracula"
        installedThemes={{ dracula: installed() }}
      />,
    );
    await flush();

    expect(readStoredThemeCss).toHaveBeenCalledWith("dracula", "light");
    expect(useThemeCssCacheStore.getState().entries["dracula:light"]).toBe(
      "body{color:red}",
    );
  });

  it("does not re-fetch once the cache is already warm", async () => {
    useThemeCssCacheStore.getState().setCss("dracula:light", "already-warm");
    render(
      <Host
        activeThemeId="dracula"
        installedThemes={{ dracula: installed() }}
      />,
    );
    await flush();
    expect(readStoredThemeCss).not.toHaveBeenCalled();
  });

  it("ignores a null result (verify failed at load time) rather than caching it", async () => {
    readStoredThemeCss.mockResolvedValue(null);
    render(
      <Host
        activeThemeId="dracula"
        installedThemes={{ dracula: installed() }}
      />,
    );
    await flush();
    expect(
      useThemeCssCacheStore.getState().entries["dracula:light"],
    ).toBeUndefined();
  });

  // A single-mode theme's mode is fixed regardless of `prefers-color-scheme` —
  // `resolveThemeMode` only consults the OS for a PAIRED theme. Pins that this hook uses
  // the same rule `use-settings-effects.ts` does, via the same `installedThemeToDef`.
  it("resolves the one declared mode even when the OS prefers the other", async () => {
    readStoredThemeCss.mockResolvedValue("body{color:red}");
    window.matchMedia = ((query: string) => ({
      addEventListener: () => {},
      matches: true, // OS prefers dark
      media: query,
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;
    render(
      <Host
        activeThemeId="dracula"
        installedThemes={{ dracula: installed() }}
      />,
    );
    await flush();
    expect(readStoredThemeCss).toHaveBeenCalledWith("dracula", "light");
  });

  it("does not throw and settles cleanly on unmount mid-fetch", async () => {
    let resolve!: (v: null | string) => void;
    readStoredThemeCss.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const { unmount } = render(
      <Host
        activeThemeId="dracula"
        installedThemes={{ dracula: installed() }}
      />,
    );
    unmount();
    await act(async () => {
      resolve("body{color:red}");
      await Promise.resolve();
    });
    // The effect's cleanup set `active = false` before this resolved — nothing to assert
    // beyond "this did not throw" and the cache staying untouched by a stale write.
    expect(
      useThemeCssCacheStore.getState().entries["dracula:light"],
    ).toBeUndefined();
  });
});
