// 검색엔진 신호 맞대기. 산출물 게이트(check-dist 8번)가 이 판정에 기댄다.
// 실사례: 루트가 noindex 인데 사이트맵이 제출했고 랜딩 x-default 가 그곳을 가리켰다.
import assert from "node:assert/strict";
import test from "node:test";
import { headSignals, searchSignalProblems, sitemapEntries } from "../scripts/search-signals.mjs";

const EN = "https://baram.ing/en/";
const KO = "https://baram.ing/ko/";
const ROOT = "https://baram.ing/";

const alt = (hreflang, href) => ({ hreflang, href });
const page = (alternates, { noindex = false, canonical = null } = {}) => ({ noindex, canonical, alternates });
/** 고친 뒤의 모양: 서로를 가리키고 자기 자신과 x-default 를 싣는 en/ko 짝 + noindex 루트 */
const healthyPages = () =>
  new Map([
    [ROOT, page([], { noindex: true, canonical: EN })],
    [EN, page([alt("en", EN), alt("ko", KO), alt("x-default", EN)], { canonical: EN })],
    [KO, page([alt("en", EN), alt("ko", KO), alt("x-default", EN)], { canonical: KO })],
  ]);
const healthySitemap = () => [EN, KO].map((loc) => ({ loc, alternates: [alt("en", EN), alt("ko", KO)] }));
const check = (pages, sitemap = healthySitemap(), noindex = [ROOT]) =>
  searchSignalProblems({ noindex, pages, sitemap });
const kinds = (problems) => problems.map((p) => /^\[([^\]]+)\]/.exec(p)[1]).sort();

test("headSignals reads robots noindex in any attribute order, and only from robots", () => {
  assert.equal(headSignals('<meta name="robots" content="noindex">').noindex, true);
  assert.equal(headSignals("<meta content='noindex, follow' name='ROBOTS' />").noindex, true);
  assert.equal(headSignals("<meta name=googlebot content=noindex>").noindex, true);
  // `none` 은 `noindex, nofollow` 의 줄임이다.
  assert.equal(headSignals('<meta name="robots" content="none">').noindex, true);
  // 같은 낱말이 다른 메타에 있어도 noindex 가 아니다.
  assert.equal(headSignals('<meta name="description" content="noindex explained">').noindex, false);
  assert.equal(headSignals('<meta name="robots" content="index, follow">').noindex, false);
});

test("headSignals collects canonical and hreflang alternates in any attribute order", () => {
  const html = `<link rel="canonical" href="${EN}"/>
    <link href="${KO}?a=1&amp;b=2" hreflang="ko" rel="alternate">
    <link rel="alternate stylesheet" hreflang="en" href="${EN}">
    <link rel="alternate" type="application/rss+xml" href="/rss.xml">`;
  const signals = headSignals(html);
  assert.equal(signals.canonical, EN);
  // rel 은 토큰 목록이고 엔티티는 풀린다. hreflang 없는 alternate(RSS 등)는 언어 버전이 아니다.
  assert.deepEqual(signals.alternates, [alt("ko", `${KO}?a=1&b=2`), alt("en", EN)]);
});

test("sitemapEntries reads loc and xhtml:link alternates per url", () => {
  const xml = `<urlset><url><loc> ${EN} </loc><xhtml:link rel="alternate" hreflang="en" href="${EN}"/><xhtml:link rel="alternate" hreflang="ko" href="${KO}"/></url><url><loc>${KO}</loc></url></urlset>`;
  assert.deepEqual(sitemapEntries(xml), [
    { loc: EN, alternates: [alt("en", EN), alt("ko", KO)] },
    { loc: KO, alternates: [] },
  ]);
});

test("the fixed shape has no problems", () => {
  assert.deepEqual(check(healthyPages()), []);
});

test("the shape Search Console flagged fails on every signal it crossed", () => {
  // 고치기 전 산출물 그대로: 랜딩은 상대 언어와 루트 x-default 만 싣고, 사이트맵은 루트를
  // 제출하면서 루트와 /en/ 을 같은 en 으로 묶었다.
  const pages = new Map([
    [ROOT, page([], { noindex: true, canonical: EN })],
    [EN, page([alt("ko", KO), alt("x-default", ROOT)], { canonical: EN })],
    [KO, page([alt("en", EN), alt("x-default", ROOT)], { canonical: KO })],
  ]);
  const grouped = [alt("en", ROOT), alt("en", EN), alt("ko", KO)];
  const sitemap = [ROOT, EN, KO].map((loc) => ({ loc, alternates: grouped }));
  assert.deepEqual(kinds(check(pages, sitemap)), [
    "hreflang 대상", "hreflang 대상", "hreflang 자기 참조 없음", "hreflang 자기 참조 없음",
    "사이트맵", "사이트맵 hreflang 대상", "사이트맵 hreflang 대상",
    "사이트맵 hreflang 불일치", "사이트맵 hreflang 불일치",
    "사이트맵 hreflang 중복", "사이트맵 hreflang 중복",
  ].sort());
});

test("hreflang pairs must point back, and name each other the same language", () => {
  const oneWay = healthyPages();
  oneWay.set(KO, page([alt("ko", KO)], { canonical: KO }));
  assert.deepEqual(kinds(check(oneWay, [])), ["hreflang 비대칭", "사이트맵 누락", "사이트맵 누락"]);

  const renamed = healthyPages();
  renamed.set(KO, page([alt("en", EN), alt("ja", KO), alt("x-default", EN)], { canonical: KO }));
  assert.deepEqual(kinds(check(renamed, [])), ["hreflang 언어 불일치", "사이트맵 누락", "사이트맵 누락"]);

  const twice = healthyPages();
  twice.set(EN, page([alt("en", EN), alt("EN", EN), alt("ko", KO)], { canonical: EN }));
  assert.deepEqual(kinds(check(twice, [])), ["hreflang 중복", "사이트맵 누락", "사이트맵 누락"]);
});

test("a noindex page's own hreflang is not judged, but pointing at it is", () => {
  const NOT_FOUND = "https://baram.ing/404.html";
  const pages = healthyPages();
  pages.set(NOT_FOUND, page([alt("en", "https://baram.ing/en/404/")], { noindex: true }));
  assert.deepEqual(check(pages, healthySitemap(), [ROOT, NOT_FOUND]), []);

  pages.set(EN, page([alt("en", EN), alt("ko", KO), alt("x-default", NOT_FOUND)], { canonical: EN }));
  assert.deepEqual(kinds(check(pages, healthySitemap(), [ROOT, NOT_FOUND])), ["hreflang 대상"]);
});

test("noindex belongs only where it is expected", () => {
  // 페이지가 noindex 가 되고 사이트맵 필터가 그 페이지를 빼는 "수정" — 다른 검사는 짝끼리 건너뛴다.
  const pages = healthyPages();
  pages.set(KO, page(pages.get(KO).alternates, { noindex: true, canonical: KO }));
  const sitemap = [{ loc: EN, alternates: [alt("en", EN)] }];
  assert.ok(kinds(check(pages, sitemap)).includes("예상 밖 noindex"));

  assert.deepEqual(kinds(check(healthyPages(), healthySitemap(), [])), ["예상 밖 noindex"]);
  assert.deepEqual(kinds(check(healthyPages(), healthySitemap(), [ROOT, EN])), ["noindex 빠짐"]);
});

test("the sitemap submits every indexable canonical URL, only those, with the page's alternates", () => {
  assert.deepEqual(kinds(check(healthyPages(), [healthySitemap()[0]])), ["사이트맵 누락"]);

  const gone = "https://baram.ing/en/gone/";
  assert.deepEqual(kinds(check(healthyPages(), [...healthySitemap(), { loc: gone, alternates: [] }])), ["사이트맵"]);

  const nonCanonical = healthyPages();
  nonCanonical.set(KO, page(nonCanonical.get(KO).alternates, { canonical: EN }));
  assert.ok(kinds(check(nonCanonical)).includes("사이트맵"));

  const drifted = [healthySitemap()[0], { loc: KO, alternates: [alt("ko", KO)] }];
  assert.deepEqual(kinds(check(healthyPages(), drifted)), ["사이트맵 hreflang 불일치"]);
});
