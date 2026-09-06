// URL 조립과 앱↔사이트 계약.
// 이 테스트가 없으면 사이트 경로가 바뀔 때 앱만 조용히 404 가 된다.
import assert from "node:assert/strict";
import test from "node:test";
import { PAGES } from "../ia-tree.mjs";
import { absolute, BASE, docPath, entrySlug, legacyTargets, ORIGIN, ROUTES, withBase } from "../routes.mjs";

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
