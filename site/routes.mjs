// help-routes.json 을 읽어 URL을 조립하는 유일한 곳.
// 소비자: astro.config.mjs · scripts/check-dist.mjs · (3단계) 앱 테스트.
//
// ‼️ 여기서 조립하지 않고 각자 문자열을 이어붙이면 base 누락 같은 결함이 한 소비자에게만
//    생긴다. 실제로 Astro 내장 redirects 가 목적지에 base 를 붙이지 않아 그렇게 깨졌다.
// ‼️ `readFileSync` 로 읽지 않는다. 이 모듈은 두 곳에서 돌아간다 — Astro 설정(Node)과
//    페이지 렌더(Vite 번들). 후자에서는 번들 청크 기준으로 상대 경로가 풀려
//    `dist/.prerender/chunks/help-routes.json` 을 찾다가 ENOENT 로 죽는다.
//    정적 import 는 두 컨텍스트 모두에서 번들러가 해결한다.
import ROUTES_JSON from "./help-routes.json" with { type: "json" };

/** @type {{origin:string, base:string, defaultLocale:string, locales:string[], localeLabels:Record<string,string>, docsPrefix:string, entries:Record<string,string>, legacy:Record<string,string>}} */
export const ROUTES = ROUTES_JSON;

export const BASE = ROUTES.base.replace(/\/$/, "");
export const ORIGIN = ROUTES.origin;

/** IA slug → base 없는 사이트 경로. `("getting-started","en")` → `/en/docs/getting-started/` */
export function docPath(slug, locale = ROUTES.defaultLocale) {
  const tail = slug === "index" ? "" : `${slug}/`;
  return `/${locale}/${ROUTES.docsPrefix}${tail}`;
}

/** base 를 붙인 경로. 브라우저가 실제로 가는 곳. */
export const withBase = (path) => `${BASE}${path}`;

/** 절대 URL. canonical·앱이 여는 주소. */
export const absolute = (path) => `${ORIGIN}${withBase(path)}`;

/** 앱 Help 메뉴 항목의 slug. `"guide"` → `"getting-started"` */
export const entrySlug = (key) => {
  const slug = ROUTES.entries[key];
  if (!slug) throw new Error(`help-routes.json entries 에 "${key}" 가 없습니다`);
  return slug;
};

/** 구 URL → base 없는 새 경로. 목적지는 entries 에서 파생되므로 복제가 없다. */
export function legacyTargets() {
  return Object.entries(ROUTES.legacy).map(([from, key]) => ({
    from,
    key,
    slug: entrySlug(key),
    to: docPath(entrySlug(key), ROUTES.defaultLocale),
  }));
}

/**
 * 원문이 아닌 로케일. 번역 신선도 판정과 번역 도구가 도는 대상이다.
 * `["ko"]`
 */
export const translationLocales = () =>
  ROUTES.locales.filter((l) => l !== ROUTES.defaultLocale);

/**
 * Starlight `locales` 설정을 여기서 조립한다.
 *
 * ‼️ 설정에 로케일을 직접 적으면 `ROUTES.locales` 와 갈라진다. 그러면 번역 신선도
 *    판정이 그 로케일에서 **조용히 꺼진다** — 스탬프도 요구하지 않고, 고아도 안 잡고,
 *    낡음 배너도 안 뜬다. 라벨이 없으면 여기서 크게 실패시킨다.
 */
export function starlightLocales() {
  return Object.fromEntries(
    ROUTES.locales.map((locale) => {
      const label = ROUTES.localeLabels?.[locale];
      if (!label) {
        throw new Error(
          `help-routes.json localeLabels 에 "${locale}" 이 없습니다 — 로케일을 더할 때 라벨도 함께 더하십시오`,
        );
      }
      return [locale, { label, lang: locale }];
    }),
  );
}
