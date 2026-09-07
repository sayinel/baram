// 랜딩 클라이언트 순수 헬퍼. 옛 site/site.test.mjs 에서 이주했다.
import assert from "node:assert/strict";
import test from "node:test";
import {
  detectOS,
  formatStarCount,
  isDownloadableAsset,
  pickPrimaryAsset,
  storedTheme,
  themePreference,
} from "../src/scripts/landing.ts";

test("detectOS maps platform strings", () => {
  assert.equal(detectOS("MacIntel"), "mac");
  assert.equal(detectOS("Win32"), "win");
  assert.equal(detectOS("Linux x86_64"), "linux");
  assert.equal(detectOS("X11"), "linux");
  assert.equal(detectOS(undefined), "unknown");
});

test("pickPrimaryAsset prefers universal dmg, falls back to aarch64", () => {
  const aarch64 = { name: "Baram_0.7.0_aarch64.dmg", browser_download_url: "u" };
  assert.equal(pickPrimaryAsset([aarch64], "mac"), aarch64);
});

test("pickPrimaryAsset picks the primary pattern when both candidates are present", () => {
  const universal = { name: "Baram_0.7.0_universal.dmg", browser_download_url: "u" };
  const aarch64 = { name: "Baram_0.7.0_aarch64.dmg", browser_download_url: "a" };
  // 순서를 뒤집어도 universal 이 이겨야 한다 — 배열 순서가 아니라 패턴 우선순위가 정한다
  assert.equal(pickPrimaryAsset([aarch64, universal], "mac"), universal);
  assert.equal(pickPrimaryAsset([universal, aarch64], "mac"), universal);
});

test("pickPrimaryAsset returns null for an unknown os or empty list", () => {
  assert.equal(pickPrimaryAsset([{ name: "x.dmg", browser_download_url: "u" }], "unknown"), null);
  assert.equal(pickPrimaryAsset(undefined, "mac"), null);
});

test("isDownloadableAsset filters updater artifacts", () => {
  assert.equal(isDownloadableAsset("Baram_0.7.0_universal.dmg"), true);
  assert.equal(isDownloadableAsset("Baram_0.7.0_universal.dmg.sig"), false);
  assert.equal(isDownloadableAsset("latest.json"), false);
});

test("formatStarCount formats counts compactly", () => {
  assert.equal(formatStarCount(0), "0");
  assert.equal(formatStarCount(999), "999");
  assert.equal(formatStarCount(1000), "1k");
  assert.equal(formatStarCount(1500), "1.5k");
  assert.equal(formatStarCount("nope"), null);
  assert.equal(formatStarCount(Number.NaN), null);
});

// ── 테마 선호 ↔ 저장값 (§ Starlight 규약 공유)
//
// ‼️ 두 표면이 `localStorage["starlight-theme"]` 하나를 공유한다. 이 왕복이 갈리면
//    문서에서 고른 테마가 랜딩에서 다르게 읽힌다 — 화면을 봐서는 알기 어려운 종류다.

test("themePreference reads Starlight's convention, empty string included", () => {
  assert.equal(themePreference("dark"), "dark");
  assert.equal(themePreference("light"), "light");
  // Starlight 이 auto 를 적는 값이 빈 문자열이다 — 이것을 auto 로 읽지 못하면
  // 문서에서 '자동'을 고른 방문자가 랜딩에서 '어두운 테마'로 표시된다.
  assert.equal(themePreference(""), "auto");
  assert.equal(themePreference(null), "auto");
  assert.equal(themePreference(undefined), "auto");
  assert.equal(themePreference("nonsense"), "auto");
});

test("storedTheme round-trips every preference through themePreference", () => {
  for (const pref of ["auto", "dark", "light"]) {
    assert.equal(themePreference(storedTheme(pref)), pref, `${pref} 왕복이 깨졌다`);
  }
});

test("storedTheme writes auto as the empty string, not the word", () => {
  // "auto" 를 그대로 적으면 Starlight 쪽 파서가 그것을 auto 로 읽기는 하나,
  // 두 표면이 같은 바이트를 적는다는 계약이 조용히 깨진다.
  assert.equal(storedTheme("auto"), "");
  assert.equal(storedTheme("dark"), "dark");
  assert.equal(storedTheme("light"), "light");
});
