// §360 — the first implementation of `ThemeAssetReader`, and the contract it has to keep.
//
// 0089 wrote that contract as prose on the type and had nothing to enforce it: "구현체는
// 받은 경로를 파일 이름 그대로 다뤄야 한다 — 퍼센트 디코드하거나 URL 로 다시 읽으면
// 여기서 한 봉쇄 판정이 무의미해진다." The reader keeps it by DOING NOTHING to the path,
// which is easy to write and easy to break later with a well-meant `decodeURIComponent`.
// So the assertions below are on the exact string that crosses the boundary.
//
// This is the frontend half. The filesystem half — that `%2e%2e` resolves to a directory
// of that name and not to `..` — is `the_staged_reader_treats_a_path_as_a_literal_file_name`
// in `src-tauri/src/plugin/install.rs`. Neither half alone is the contract.
import type { ThemeMode } from "../../types/theme";

import { beforeEach, describe, expect, it, vi } from "vitest";

const themeStageRead =
  vi.fn<(stageId: string, path: string) => Promise<Uint8Array>>();
const themeReadStoredCss =
  vi.fn<(themeId: string, mode: ThemeMode) => Promise<string>>();
vi.mock("../../ipc/theme", () => ({
  themeReadStoredCss: (id: string, mode: ThemeMode) =>
    themeReadStoredCss(id, mode),
  themeStageRead: (stageId: string, path: string) =>
    themeStageRead(stageId, path),
}));

import { inlineThemeAssets } from "../../utils/theme-css/inline-assets";
import { sanitizeThemeCss } from "../../utils/theme-css/sanitize";
import {
  MAX_THEME_TOKENS_BYTES,
  readStagedThemeText,
  readStoredThemeCss,
  stagedThemeAssetReader,
} from "../theme-store-fs";

const bytes = (s: string): Uint8Array => new TextEncoder().encode(s);

describe("stagedThemeAssetReader keeps the ThemeAssetReader contract (§360)", () => {
  beforeEach(() => {
    themeStageRead.mockReset();
  });

  // ‼️ The one that matters. A reader that percent-decoded would turn this into
  // `../outside.png` and hand the containment check a different question than the one
  // `inlineThemeAssets` answered.
  it("does not percent-decode: `%2e%2e` crosses as `%2e%2e`", async () => {
    themeStageRead.mockRejectedValue(new Error("no such file"));
    await stagedThemeAssetReader("stage-1")("%2e%2e/outside.png");
    expect(themeStageRead).toHaveBeenCalledWith(
      "stage-1",
      "%2e%2e/outside.png",
    );
  });

  // The same rule from the other side: a name that CONTAINS an escape-looking sequence is
  // a legal file name, and decoding would make it unreadable rather than unsafe.
  it.each([
    "assets/a%2eb.png",
    "assets/with space.png",
    "assets/100%25.png",
    "assets/plain.png",
  ])("reads %s by its literal name", async (name) => {
    themeStageRead.mockResolvedValue(bytes("x"));
    await stagedThemeAssetReader("stage-1")(name);
    expect(themeStageRead).toHaveBeenCalledWith("stage-1", name);
  });

  it("returns the bytes it was given, and undefined when there is no such file", async () => {
    const read = stagedThemeAssetReader("stage-1");
    themeStageRead.mockResolvedValue(bytes("hello"));
    expect(await read("assets/x.png")).toEqual(bytes("hello"));
    themeStageRead.mockRejectedValue(new Error("no such file"));
    expect(await read("assets/missing.png")).toBeUndefined();
  });

  // The join with 0089: whatever `inlineThemeAssets` decided a reference resolves to is
  // what reaches the filesystem, unchanged. Without this, the two halves could each be
  // correct about a path they do not agree on.
  it("hands inlineThemeAssets' package path straight through", async () => {
    themeStageRead.mockResolvedValue(new Uint8Array([1, 2, 3]));
    const css = sanitizeThemeCss('a{background:url("assets/logo.png")}');
    const out = await inlineThemeAssets(css, stagedThemeAssetReader("stage-7"));
    expect(themeStageRead).toHaveBeenCalledWith("stage-7", "assets/logo.png");
    expect(out).toContain("data:image/png;base64,AQID");
  });
});

describe("readStagedThemeText caps by bytes, not characters (§360)", () => {
  beforeEach(() => {
    themeStageRead.mockReset();
  });

  // ‼️ The distinction is the test. A 3-byte-per-character document is a third of the
  // length and the whole of the cost, so a character cap would let a Korean or CJK theme
  // through at three times the parse work the cap was written to bound.
  it("refuses a document whose character count is under the cap but whose bytes are not", async () => {
    const chars = Math.floor(MAX_THEME_TOKENS_BYTES / 2);
    const body = "가".repeat(chars); // 3 bytes each
    expect(body.length).toBeLessThan(MAX_THEME_TOKENS_BYTES);
    themeStageRead.mockResolvedValue(bytes(body));
    await expect(
      readStagedThemeText(
        "stage-1",
        "light/tokens.json",
        MAX_THEME_TOKENS_BYTES,
      ),
    ).rejects.toMatchObject({ code: "tooLarge" });
  });

  it("admits a document at the cap and decodes it", async () => {
    themeStageRead.mockResolvedValue(bytes("12345"));
    expect(await readStagedThemeText("stage-1", "a.css", 5)).toBe("12345");
  });
});

describe("readStoredThemeCss re-verifies what it read (§360)", () => {
  beforeEach(() => {
    themeReadStoredCss.mockReset();
  });

  it("returns CSS that still satisfies the stored contract", async () => {
    themeReadStoredCss.mockResolvedValue("@layer baram-theme{a{color:red}}");
    expect(await readStoredThemeCss("dracula", "light")).toBe(
      "@layer baram-theme{a{color:red}}",
    );
  });

  // ‼️ The point of the load-time layer: install-time hygiene froze the rules of that day,
  // and the theme directory is one a person can open afterwards. A file edited to fetch a
  // remote image is not injected, and the app does not fail to start over it either.
  it("returns null for stored CSS that no longer satisfies it", async () => {
    themeReadStoredCss.mockResolvedValue(
      "@layer baram-theme{a{background:url(https://evil.test/x.png)}}",
    );
    expect(await readStoredThemeCss("dracula", "light")).toBeNull();
  });

  it("returns null when that mode has no stored CSS at all", async () => {
    themeReadStoredCss.mockRejectedValue(new Error("Plugin not found"));
    expect(await readStoredThemeCss("dracula", "dark")).toBeNull();
  });
});
