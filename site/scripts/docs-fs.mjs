// 문서 소스 트리를 디스크에서 읽는 공용 헬퍼. Node 전용(빌드 번들에서 쓰지 않는다).
// 소비자: check-pages.mjs · check-dist.mjs · i18n.mjs
//
// ‼️ 로케일마다 따로 구현하면 한쪽만 `.mdx` 를 빠뜨리는 식으로 갈린다.
//    실제로 페이지 열거는 세 게이트가 모두 필요로 한다.
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/** `src/content/docs/<locale>/docs` 의 절대 경로. */
export const localeDocsDir = (locale) =>
  join(HERE, "..", "src/content/docs", locale, "docs");

export const EN_DOCS = localeDocsDir("en");
export const KO_DOCS = localeDocsDir("ko");

/**
 * 그 디렉터리 아래 모든 `.md`/`.mdx` 를 IA slug 로. 없으면 빈 배열.
 * 경로 구분자는 항상 `/` 로 낸다 — slug 는 매니페스트의 문자열 키와 비교된다.
 */
export function slugsOn(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  const walk = (d) => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.mdx?$/.test(name)) {
        out.push(relative(dir, p).replace(/\.mdx?$/, "").split(sep).join("/"));
      }
    }
  };
  walk(dir);
  return out;
}

/** 그 slug 의 실제 파일 경로. 없으면 `null`. */
export function pageFile(dir, slug) {
  return (
    [`${slug}.md`, `${slug}.mdx`].map((f) => join(dir, f)).find(existsSync) ??
    null
  );
}
