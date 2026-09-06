// 랜딩 클라이언트 순수 헬퍼. 옛 site/site.test.mjs 에서 이주했다.
import assert from "node:assert/strict";
import test from "node:test";
import {
  detectOS,
  formatStarCount,
  isDownloadableAsset,
  nextTheme,
  pickPrimaryAsset,
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

test("nextTheme toggles both ways, and treats absent as light-to-dark", () => {
  assert.equal(nextTheme("dark"), "light");
  assert.equal(nextTheme("light"), "dark");
  // data-theme 가 아직 없을 때(시스템 설정 따라감) 첫 클릭은 다크로 간다
  assert.equal(nextTheme(null), "dark");
});
