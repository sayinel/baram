// URL 조립과 앱↔사이트 계약.
// 이 테스트가 없으면 사이트 경로가 바뀔 때 앱만 조용히 404 가 된다.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SITE = join(dirname(fileURLToPath(import.meta.url)), "..");
import { PAGES } from "../ia-tree.mjs";
import { absolute, BASE, docPath, entrySlug, legacyTargets, ORIGIN, ROUTES, starlightLocales, translationLocales, withBase } from "../routes.mjs";

test("docPath puts the locale first and the docs prefix second", () => {
  assert.equal(docPath("getting-started", "en"), "/en/docs/getting-started/");
  assert.equal(docPath("getting-started", "ko"), "/ko/docs/getting-started/");
  assert.equal(docPath("faq/general", "ko"), "/ko/docs/faq/general/");
});

test("docPath('index') is the docs root, not a page named index", () => {
  assert.equal(docPath("index", "en"), "/en/docs/");
});

test("docPath defaults to the default locale", () => {
  assert.equal(docPath("getting-started"), docPath("getting-started", ROUTES.defaultLocale));
});

test("locales are symmetric — no root locale", () => {
  // 대칭이 낡음 대조(en/x ↔ ko/x)와 로케일 스위처를 단순하게 유지하는 근거다.
  for (const locale of ROUTES.locales) {
    assert.ok(docPath("getting-started", locale).startsWith(`/${locale}/`));
  }
  assert.ok(ROUTES.locales.includes(ROUTES.defaultLocale));
});

test("withBase and absolute carry the GitHub Pages base", () => {
  // ‼️ base 누락이 실제 결함이었다 — Astro 내장 redirects 가 목적지에 base 를 안 붙였다.
  assert.equal(withBase("/en/docs/"), `${BASE}/en/docs/`);
  assert.equal(absolute("/en/docs/"), `${ORIGIN}${BASE}/en/docs/`);
  assert.ok(absolute(docPath("getting-started", "ko")).startsWith(`${ORIGIN}${BASE}/ko/`));
});

test("every help entry slug exists in the IA tree", () => {
  const known = new Set(PAGES.map((p) => p.slug));
  for (const [key, slug] of Object.entries(ROUTES.entries)) {
    assert.ok(known.has(slug), `entries.${key} = "${slug}" 가 IA 트리에 없다`);
  }
});

test("entrySlug throws on an unknown key rather than returning undefined", () => {
  assert.throws(() => entrySlug("nope"), /nope/);
});

test("legacy targets are derived from entries, not duplicated", () => {
  const targets = legacyTargets();
  assert.ok(targets.length > 0);
  for (const { key, slug, to } of targets) {
    assert.equal(slug, ROUTES.entries[key]);
    assert.equal(to, docPath(slug, ROUTES.defaultLocale));
  }
});

test("the app opens exactly the three documented surfaces", () => {
  // 앱 Help 메뉴가 여는 URL. 3단계에서 src/utils/help-urls.ts 가 이 값을 파생한다.
  assert.deepEqual(Object.keys(ROUTES.entries).sort(), ["faq", "guide", "shortcuts"]);
  assert.equal(
    absolute(docPath(entrySlug("guide"), "en")),
    "https://sayinel.github.io/baram/en/docs/getting-started/",
  );
});

// ── 로케일 목록의 단일 출처 (§4.2)
//
// ‼️ astro.config 에 로케일을 직접 적으면 `ROUTES.locales` 와 갈라지고, 그러면 번역
//    신선도 판정이 그 로케일에서 **조용히 꺼진다** — routeData 의 `LOCALES` 에 없으니
//    스탬프도 안 요구하고 고아도 안 잡고 배너도 안 뜬다. 아무 게이트도 실패하지 않는다.
test("starlightLocales derives exactly the configured locales", () => {
  const built = starlightLocales();
  assert.deepEqual(Object.keys(built).sort(), [...ROUTES.locales].sort());
  for (const locale of ROUTES.locales) {
    assert.equal(built[locale].lang, locale);
    assert.ok(built[locale].label.length > 0, `${locale} 라벨이 비어 있다`);
  }
});

test("starlightLocales throws on a locale with no label", () => {
  // 라벨을 빼먹은 채 로케일을 더하면 조용히 넘어가지 않는다.
  const saved = ROUTES.localeLabels;
  ROUTES.localeLabels = { ...saved };
  delete ROUTES.localeLabels[ROUTES.locales.at(-1)];
  try {
    assert.throws(() => starlightLocales(), /localeLabels/);
  } finally {
    ROUTES.localeLabels = saved;
  }
  assert.doesNotThrow(() => starlightLocales());
});

test("translationLocales is every locale but the default", () => {
  const t = translationLocales();
  assert.ok(!t.includes(ROUTES.defaultLocale));
  assert.equal(t.length, ROUTES.locales.length - 1);
});

test("astro.config takes its locales from routes.mjs, not a literal", () => {
  const config = readFileSync(join(SITE, "astro.config.mjs"), "utf8");
  assert.match(config, /locales:\s*starlightLocales\(\)/,
    "astro.config 이 로케일을 직접 적고 있다 — ROUTES.locales 와 갈라진다");
  assert.match(config, /starlightLocales/, "import 도 함께 있어야 한다");
});
