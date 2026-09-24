// 검색엔진에 주는 신호 — robots · canonical · hreflang · 사이트맵 — 를 산출물에서 읽고 서로 맞댄다.
// 소비자: scripts/check-dist.mjs (산출물 게이트) · tests/search-signals.test.mjs.
//
// ‼️ 신호 하나하나는 제자리에서 옳아 보인다. 루트 `/` 는 언어 분기 페이지라 `noindex` 가
//    맞았다. 그런데 사이트맵이 그 URL 을 제출했고, `/en/` 과 같은 en 대체로 묶었으며,
//    두 랜딩의 hreflang x-default 가 그곳을 가리켰다. Search Console 은
//    "'noindex' 태그에 의해 제외됨" 으로 신고했다. 어긋남은 **신호끼리 맞대야** 보인다.
//
// 정규식 파서다. 속성값 안의 `>`, HTML 주석·`<script>` 문자열 안의 태그는 구분하지 못한다 —
// 그런 형태가 산출물에 생기면 여기부터 의심할 것.

const ENTITIES = { amp: "&", apos: "'", gt: ">", lt: "<", quot: '"', "#39": "'" };
const decode = (text) => text.replace(/&(amp|apos|gt|lt|quot|#39);/g, (_, name) => ENTITIES[name]);

/** 태그 하나의 속성값 — 속성 순서·따옴표 종류에 기대지 않는다. */
function attr(tag, name) {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i").exec(tag);
  return m ? decode(m[1] ?? m[2] ?? m[3]) : null;
}

const tagsOf = (source, name) =>
  [...source.matchAll(new RegExp(`<${name}\\s[^>]*>`, "gi"))].map((m) => m[0]);

const alternateOf = (tag) => ({ hreflang: attr(tag, "hreflang") ?? "", href: attr(tag, "href") ?? "" });

/** 비교 키. hreflang 은 대소문자를 가리지 않는다. */
const alternateKey = ({ hreflang, href }) => `${hreflang.toLowerCase()} ${href}`;

/**
 * 페이지 HTML 이 검색엔진에 하는 말.
 * @param {string} html
 * @returns {{ noindex: boolean, canonical: string | null, alternates: { hreflang: string, href: string }[] }}
 */
export function headSignals(html) {
  // `none` 은 `noindex, nofollow` 의 줄임이다.
  const noindex = tagsOf(html, "meta").some(
    (tag) =>
      /^(robots|googlebot)$/i.test(attr(tag, "name") ?? "") &&
      /\b(noindex|none)\b/i.test(attr(tag, "content") ?? ""),
  );
  const links = tagsOf(html, "link");
  const rels = (tag) => (attr(tag, "rel") ?? "").toLowerCase().split(/\s+/);
  const canonical = links.find((tag) => rels(tag).includes("canonical"));
  const alternates = links
    .filter((tag) => rels(tag).includes("alternate") && attr(tag, "hreflang") !== null)
    .map(alternateOf);
  return { noindex, canonical: canonical ? attr(canonical, "href") : null, alternates };
}

/**
 * 사이트맵 파일 하나의 `<url>` 항목.
 * @param {string} xml
 * @returns {{ loc: string, alternates: { hreflang: string, href: string }[] }[]}
 */
export function sitemapEntries(xml) {
  return [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map(([, body]) => ({
    loc: decode((/<loc>([^<]*)<\/loc>/.exec(body)?.[1] ?? "").trim()),
    alternates: tagsOf(body, "xhtml:link").map(alternateOf),
  }));
}

/** 같은 hreflang 이 두 번 이상 나온 값들 (대소문자 무시) */
function duplicatedLanguages(alternates) {
  const seen = new Set();
  const twice = new Set();
  for (const { hreflang } of alternates) {
    const key = hreflang.toLowerCase();
    if (seen.has(key)) twice.add(key);
    seen.add(key);
  }
  return [...twice];
}

/**
 * 신호끼리 어긋난 곳.
 * @param {object} signals
 * @param {Map<string, ReturnType<typeof headSignals>>} signals.pages dist 의 모든 HTML, **절대 URL** 키
 * @param {ReturnType<typeof sitemapEntries>} signals.sitemap 모든 사이트맵 파일의 항목
 * @param {Iterable<string>} signals.noindex noindex 여야 하는 페이지의 절대 URL — 정확히 이것들만
 * @returns {string[]}
 */
export function searchSignalProblems({ noindex, pages, sitemap }) {
  const problems = [];
  // 색인되는 표준 URL 인가. 아니면 그 이유.
  const unindexable = (url) => {
    const page = pages.get(url);
    if (!page) return "dist 안에 없다";
    if (page.noindex) return "noindex 다";
    return page.canonical && page.canonical !== url ? `canonical 이 ${page.canonical} 다` : null;
  };

  // noindex 는 정해진 자리에만 있어야 한다. 문서 페이지 하나가 noindex 가 되면 그 짝의 hreflang 과
  // 사이트맵 항목이 걸리는데, 사이트맵 필터에 그 페이지를 더하는 "수정" 이 게이트를 초록으로 만든다.
  const wantNoindex = new Set(noindex);
  for (const [url, page] of pages) {
    if (page.noindex && !wantNoindex.has(url)) problems.push(`[예상 밖 noindex] ${url}`);
    if (!page.noindex && wantNoindex.has(url)) problems.push(`[noindex 빠짐] ${url} — noindex 여야 한다`);
  }
  for (const url of wantNoindex) {
    if (!pages.has(url)) problems.push(`[noindex 대상 부재] ${url} 가 dist 안에 없다`);
  }

  // hreflang — 넷을 묻는다.
  //   ① 같은 언어가 두 번 나오지 않는다 — 어느 쪽이 그 언어인지 모호하다.
  //   ② 자기 자신도 나열한다. ③ 짝이 되가리키고, 자기 자신을 같은 언어로 적는다.
  //      ②와 ③의 되가리키기는 Google 문서의 규칙이다(한쪽만 가리키면 그 짝은 무시된다).
  //   ④ 대상이 색인되는 표준 URL 이다 — 아니면 그 언어 버전으로 보여 줄 페이지가 색인에 없다.
  // noindex 페이지 **자신의** hreflang 은 묻지 않는다 — 색인에 들어가지 않는 페이지의 주장이다.
  // (Starlight 404 는 없는 `/en/404/`·`/ko/404/` 를 가리키는데, `404.md` frontmatter 로 noindex 다.)
  // 그 페이지를 **가리키는** 쪽은 여전히 ④에 걸린다.
  for (const [url, page] of pages) {
    if (!page.alternates.length || page.noindex) continue;
    for (const lang of duplicatedLanguages(page.alternates)) {
      problems.push(`[hreflang 중복] ${url} — "${lang}" 가 두 번 이상 나온다`);
    }
    if (!page.alternates.some((a) => a.href === url)) {
      problems.push(`[hreflang 자기 참조 없음] ${url} — 자기 자신을 언어 버전으로 나열하지 않는다`);
    }
    for (const { hreflang, href } of page.alternates) {
      const why = unindexable(href);
      if (why) {
        problems.push(`[hreflang 대상] ${url} → ${hreflang} ${href} 가 ${why}`);
        continue;
      }
      if (href === url) continue;
      const target = pages.get(href).alternates;
      // 짝이 자기 자신을 아예 싣지 않는 것은 짝 쪽에서 ②로 신고된다 — 여기서는 **다른 언어로**
      // 적은 것만 본다.
      const selfNames = target.filter((a) => a.href === href);
      if (!target.some((a) => a.href === url)) {
        problems.push(`[hreflang 비대칭] ${url} → ${hreflang} ${href} 가 되가리키지 않는다`);
      } else if (
        hreflang.toLowerCase() !== "x-default" &&
        selfNames.length &&
        !selfNames.some((a) => alternateKey(a) === alternateKey({ hreflang, href }))
      ) {
        problems.push(`[hreflang 언어 불일치] ${url} 는 ${href} 를 ${hreflang} 로 부르는데 그 페이지는 자기를 그렇게 적지 않는다`);
      }
    }
  }

  // 사이트맵 — "색인해 달라" 는 목록이다. 색인되는 표준 URL 을 **전부**, 그것만 싣고,
  // 대체 링크는 그 페이지의 hreflang 과 같아야 한다(x-default 는 사이트맵에 싣지 않는다).
  const submitted = new Set(sitemap.map((entry) => entry.loc));
  for (const url of pages.keys()) {
    if (!unindexable(url) && !submitted.has(url)) {
      problems.push(`[사이트맵 누락] ${url} 는 색인되는 표준 URL 인데 사이트맵에 없다`);
    }
  }
  for (const { loc, alternates } of sitemap) {
    const why = unindexable(loc);
    if (why) {
      problems.push(`[사이트맵] ${loc} 가 ${why}`);
      continue;
    }
    for (const lang of duplicatedLanguages(alternates)) {
      problems.push(`[사이트맵 hreflang 중복] ${loc} — "${lang}" 가 두 번 이상 나온다`);
    }
    for (const { hreflang, href } of alternates) {
      const bad = unindexable(href);
      if (bad) problems.push(`[사이트맵 hreflang 대상] ${loc} → ${hreflang} ${href} 가 ${bad}`);
    }
    const inPage = pages
      .get(loc)
      .alternates.filter((a) => a.hreflang.toLowerCase() !== "x-default")
      .map(alternateKey)
      .sort()
      .join(", ");
    const inSitemap = alternates.map(alternateKey).sort().join(", ");
    if (inPage !== inSitemap) {
      problems.push(`[사이트맵 hreflang 불일치] ${loc} — 페이지 "${inPage}" / 사이트맵 "${inSitemap}"`);
    }
  }
  return problems;
}
