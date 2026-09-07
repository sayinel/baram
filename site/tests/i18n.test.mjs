// 랜딩 i18n. 옛 site/site.test.mjs 의 두 테스트를 이주하고 한 방향을 더 막는다.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import en from "../src/i18n/en.json" with { type: "json" };
import ko from "../src/i18n/ko.json" with { type: "json" };
import uiEn from "../src/content/i18n/en.json" with { type: "json" };
import uiKo from "../src/content/i18n/ko.json" with { type: "json" };

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

// ── Starlight UI 사전 (`src/content/i18n/*.json`) — 위의 랜딩 사전과 다른 물건이다.
//
// ‼️ 전체 키 패리티를 요구할 수 없다: ko.json 은 Starlight 기본 영문 문자열을 덮는
//    항목들을 갖고 en.json 은 그것들이 필요 없다. 요구할 수 있는 것은 **우리가 새로
//    만든 키**의 완결성이다 — en.json 은 그 커스텀 키만 담으므로 그 파일 자체가
//    목록이 된다(복제하지 않는다).
const UI_DICTS = { en: uiEn, ko: uiKo };
const CUSTOM_KEYS = Object.keys(uiEn);

test("the custom UI keys are actually declared somewhere", () => {
  // 목록이 비면 아래 단정이 전부 공허해진다.
  assert.ok(CUSTOM_KEYS.length >= 2, `en.json 에 커스텀 키가 ${CUSTOM_KEYS.length}개`);
});

test("every custom UI key used by our components exists in the fallback dictionary", () => {
  // 컴포넌트에 `t("…")` 를 추가하고 문자열을 빼먹으면 배너가 빈칸으로 렌더된다.
  const components = join(SITE, "src/components");
  const files = readdirSync(components).filter((f) => f.endsWith(".astro"));
  assert.ok(files.length > 0, "src/components 에 .astro 파일이 없다 — 스캔 경로가 바뀌었다");
  const used = new Set();
  for (const file of files) {
    const src = readFileSync(join(components, file), "utf8");
    for (const m of src.matchAll(/Astro\.locals\.t\(\s*"([^"]+)"/g)) used.add(m[1]);
  }
  assert.ok(used.size > 0, "`Astro.locals.t(\"…\")` 호출을 하나도 못 찾았다 — 스캔이 공허하다");
  for (const key of used) {
    // Starlight 기본 키(`page.`·`i18n.` 등)는 프레임워크가 제공하므로 제외한다.
    if (!key.startsWith("translation.")) continue;
    assert.ok(CUSTOM_KEYS.includes(key), `${key} 를 쓰는데 src/content/i18n/en.json 에 없다`);
  }
});

test("a locale defines all custom UI keys or none of them", () => {
  // Starlight 은 fallbackLng: defaultLocale 이라 빠진 키만 영어로 떨어진다 —
  // 한 로케일이 절반만 번역하면 한국어 문장에 영문 링크 라벨이 붙은 배너가 나온다.
  for (const [locale, dict] of Object.entries(UI_DICTS)) {
    const have = CUSTOM_KEYS.filter((k) => k in dict);
    assert.ok(
      have.length === 0 || have.length === CUSTOM_KEYS.length,
      `${locale}: ${have.length}/${CUSTOM_KEYS.length} 만 정의했다 — 빠진 것 ${CUSTOM_KEYS.filter((k) => !(k in dict))}`,
    );
  }
  assert.equal(CUSTOM_KEYS.filter((k) => k in uiEn).length, CUSTOM_KEYS.length,
    "en.json 은 폴백이므로 전부 있어야 한다");
});

test("no UI dictionary value is empty", () => {
  for (const [locale, dict] of Object.entries(UI_DICTS)) {
    for (const [key, value] of Object.entries(dict)) {
      assert.ok(String(value).trim().length > 0, `${locale}.${key} 가 비어 있다`);
    }
  }
});
