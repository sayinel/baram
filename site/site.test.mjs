import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MESSAGES } from "./i18n.js";
import { pickLanguage, detectOS, pickPrimaryAsset } from "./main.js";

const SITE = dirname(fileURLToPath(import.meta.url));

test("en and ko dictionaries have identical key sets", () => {
  assert.deepEqual(Object.keys(MESSAGES.ko).sort(), Object.keys(MESSAGES.en).sort());
});

test("every data-i18n key in index.html exists in both dictionaries", () => {
  const html = readFileSync(join(SITE, "index.html"), "utf8");
  const keys = [...html.matchAll(/data-i18n="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(keys.length >= 55, `expected >=55 keys, got ${keys.length}`);
  for (const key of keys) {
    assert.ok(MESSAGES.en[key], `missing en: ${key}`);
    assert.ok(MESSAGES.ko[key], `missing ko: ${key}`);
  }
});

test("pickLanguage prefers stored value, then navigator language", () => {
  assert.equal(pickLanguage("ko", "en-US"), "ko");
  assert.equal(pickLanguage("en", "ko-KR"), "en");
  assert.equal(pickLanguage(null, "ko-KR"), "ko");
  assert.equal(pickLanguage(null, "ko"), "ko");
  assert.equal(pickLanguage(null, "en-US"), "en");
  assert.equal(pickLanguage(null, undefined), "en");
  assert.equal(pickLanguage("garbage", "fr-FR"), "en");
});

test("detectOS maps platform strings", () => {
  assert.equal(detectOS("MacIntel"), "mac");
  assert.equal(detectOS("macOS"), "mac");
  assert.equal(detectOS("Win32"), "win");
  assert.equal(detectOS("Windows"), "win");
  assert.equal(detectOS("Linux x86_64"), "linux");
  assert.equal(detectOS(""), "unknown");
  assert.equal(detectOS(undefined), "unknown");
});

test("pickPrimaryAsset prefers universal dmg, falls back to aarch64 (v0.3.0 layout)", () => {
  const v040 = [
    { name: "Baram_0.4.0_universal.dmg", browser_download_url: "u" },
    { name: "Baram_0.4.0_x64-setup.exe", browser_download_url: "w" },
    { name: "Baram_0.4.0_amd64.AppImage", browser_download_url: "l" },
  ];
  assert.equal(pickPrimaryAsset(v040, "mac").browser_download_url, "u");
  assert.equal(pickPrimaryAsset(v040, "win").browser_download_url, "w");
  assert.equal(pickPrimaryAsset(v040, "linux").browser_download_url, "l");

  const v030 = [
    { name: "Baram_0.3.0_aarch64.dmg", browser_download_url: "a" },
    { name: "Baram_0.3.0_x64_en-US.msi", browser_download_url: "m" },
    { name: "Baram_0.3.0_amd64.deb", browser_download_url: "d" },
  ];
  assert.equal(pickPrimaryAsset(v030, "mac").browser_download_url, "a");
  assert.equal(pickPrimaryAsset(v030, "win").browser_download_url, "m");
  assert.equal(pickPrimaryAsset(v030, "linux").browser_download_url, "d");
  assert.equal(pickPrimaryAsset(v030, "unknown"), null);
  assert.equal(pickPrimaryAsset([], "mac"), null);
});
