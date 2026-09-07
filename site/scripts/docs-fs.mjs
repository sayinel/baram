// 문서 소스 트리를 디스크에서 읽는 공용 헬퍼. Node 전용(빌드 번들에서 쓰지 않는다).
// 소비자: check-pages.mjs · check-dist.mjs · i18n.mjs
//
// ‼️ 로케일마다·게이트마다 따로 구현하면 한쪽만 확장자를 빠뜨리는 식으로 갈린다.
//    실제로 페이지 열거는 세 게이트가 모두 필요로 한다.
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { ROUTES, translationLocales } from "../routes.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Starlight 이 `docs` 컬렉션에서 라우팅하는 확장자 전부.
 * 출처: `@astrojs/starlight/dist/loaders.js` 의 `docsExtensions`.
 *
 * ‼️ `md`/`mdx` 만 알아보면 나머지 다섯으로 만든 페이지가 **모든 게이트에 안 보인다** —
 *    Starlight 은 빌드하는데 스탬프도 요구되지 않고 대조도 안 되며, check-dist 의
 *    폴백 검사에는 오탐으로 잡힌다(디스크엔 없는데 산출물엔 배너가 있으므로).
 */
export const DOCS_EXTENSIONS = [
  "markdown",
  "mdown",
  "mkdn",
  "mkd",
  "mdwn",
  "md",
  "mdx",
];

const DOCS_EXT_RE = new RegExp(`\\.(${DOCS_EXTENSIONS.join("|")})$`);

/** `src/content/docs/<locale>/docs` 의 절대 경로. */
export const localeDocsDir = (locale) =>
  join(HERE, "..", "src/content/docs", locale, ROUTES.docsPrefix.replace(/\/$/, ""));

/** 원문(기본 로케일) 문서 디렉터리. */
export const EN_DOCS = localeDocsDir(ROUTES.defaultLocale);

/**
 * 번역 로케일과 그 디렉터리. `[{ locale: "ko", dir: "…/ko/docs" }]`
 * 로케일을 하드코딩하지 않는 이유는 `starlightLocales()` 주석과 같다.
 */
export const TRANSLATION_DIRS = translationLocales().map((locale) => ({
  dir: localeDocsDir(locale),
  locale,
}));

/**
 * 그 디렉터리 아래 모든 문서 파일을 IA slug 로. 없으면 빈 배열.
 * 경로 구분자는 항상 `/` 로 낸다 — slug 는 매니페스트의 문자열 키와 비교된다.
 */
export function slugsOn(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  const walk = (d) => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (DOCS_EXT_RE.test(name)) {
        out.push(relative(dir, p).replace(DOCS_EXT_RE, "").split(sep).join("/"));
      }
    }
  };
  walk(dir);
  return out;
}

/** 그 slug 의 실제 파일 경로. 없으면 `null`. */
export function pageFile(dir, slug) {
  return (
    DOCS_EXTENSIONS.map((ext) => join(dir, `${slug}.${ext}`)).find(existsSync) ??
    null
  );
}
