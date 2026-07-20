import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MESSAGES } from "./i18n.js";
import { pickLanguage } from "./main.js";

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
