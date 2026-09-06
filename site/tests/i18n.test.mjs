// 랜딩 i18n. 옛 site/site.test.mjs 의 두 테스트를 이주하고 한 방향을 더 막는다.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import en from "../src/i18n/en.json" with { type: "json" };
import ko from "../src/i18n/ko.json" with { type: "json" };

const SITE = join(dirname(fileURLToPath(import.meta.url)), "..");
const DICTS = { en, ko };

test("en and ko dictionaries have identical key sets", () => {
  const a = Object.keys(en).sort();
  const b = Object.keys(ko).sort();
  assert.deepEqual(a, b, `en 전용: ${a.filter((k) => !(k in ko))} / ko 전용: ${b.filter((k) => !(k in en))}`);
});

test("no dictionary value is empty", () => {
  for (const [locale, dict] of Object.entries(DICTS)) {
    for (const [key, value] of Object.entries(dict)) {
      assert.ok(value.trim().length > 0, `${locale}.${key} 가 비어 있다`);
    }
  }
});

test("keys are alphabetically sorted", () => {
  // 앱의 src/i18n 규약과 같다 — 추가 위치가 흔들리면 diff 가 커진다
  for (const [locale, dict] of Object.entries(DICTS)) {
    const keys = Object.keys(dict);
    assert.deepEqual(keys, keys.slice().sort(), `${locale}.json 이 정렬돼 있지 않다`);
  }
});

const decode = (html) =>
  html
    .replaceAll("&#38;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&");

// ‼️ 이것이 고아 키를 잡는 방향이다. 소스에서 `t("...")` 를 grep 하는 방식으로는
//    `t(`features.${key}.t`)` 같은 템플릿 호출을 못 찾아 거짓 고아가 잡힌다.
//    렌더된 HTML 에 값이 실제로 있는지를 보면 그 함정이 없고, "키가 화면에 도달했다"는
//    더 강한 사실을 단정한다.
for (const locale of Object.keys(DICTS)) {
  test(`every ${locale} dictionary value reaches the rendered landing`, (t) => {
    const page = join(SITE, "dist", locale, "index.html");
    if (!existsSync(page)) {
      t.skip(`dist/${locale}/index.html 없음 — 먼저 npm run build`);
      return;
    }
    const html = decode(readFileSync(page, "utf8"));
    const missing = Object.entries(DICTS[locale])
      .filter(([, value]) => !html.includes(value))
      .map(([key]) => key);
    assert.deepEqual(missing, [], `랜딩에 도달하지 않은 키: ${missing.join(", ")}`);
  });
}
