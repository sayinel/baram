// §4.2 페이지마다 "이 번역이 원문보다 낡았는가"를 판정해 라우트 데이터에 싣는다.
// 설계: dev/design/specs/0044-docs-site-i18n-restructure-design.md
//
// ‼️ **폴백 라우트는 `id` 가 `ko/...` 인데 `entry` 는 en 엔트리다.** (Starlight
//    `utils/routing/index.js` 의 `getRoutes` 실측) 그래서 판정은 `route.id` 가 아니라
//    `route.entry.id` 를 봐야 한다. `route.id` 로 갈랐다면 미번역 페이지 전부가
//    "낡음" 배너를 달았을 것이다 — 폴백은 Starlight 이 자기 알림으로 이미 처리한다.
//
// ‼️ 고아 번역(en 짝이 없는 ko 파일)은 **던져서 빌드를 실패시킨다.** 통과시키면
//    비교할 원문이 없다는 이유로 배너 없이 자신 있게 렌더된다 — 낡은 번역보다 나쁘다.
import { defineRouteMiddleware } from "@astrojs/starlight/route-data";
import { getCollection } from "astro:content";

import { docPath, ROUTES, withBase } from "../routes.mjs";
import {
  sourceHash,
  STALE_ROUTE_KEY,
  type StaleTranslation,
  translationState,
} from "./lib/source-hash.ts";

const DEFAULT_LOCALE: string = ROUTES.defaultLocale;
const LOCALES = new Set<string>(ROUTES.locales);
const DOCS_PREFIX = ROUTES.docsPrefix.replace(/\/$/, "");

/**
 * 번역 신선도를 묻지 않는 페이지.
 *
 * 404 는 문서가 아니라 크롬이다. 한 문장짜리 페이지에 "원문보다 낡음" 이야기는 없고,
 * 무엇보다 **원문 짝이 `en/404` 가 아니라 컬렉션 루트의 `404`** 다(Starlight 의
 * 로케일별 404 규약). 그대로 두면 번역된 404 가 "고아" 로 오진돼 빌드가 죽는다.
 */
const UNVERSIONED = new Set(["404"]);

const docs = await getCollection("docs");
const byId = new Map(docs.map((entry) => [entry.id, entry]));

/**
 * `en/docs/getting-started` → `{ locale: "en", rest: "docs/getting-started" }`.
 * 로케일 디렉터리 밖의 엔트리(루트 `404`)는 `null`.
 */
function splitId(id: string): { locale: string; rest: string } | null {
  const slash = id.indexOf("/");
  if (slash < 0) return null;
  const locale = id.slice(0, slash);
  return LOCALES.has(locale) ? { locale, rest: id.slice(slash + 1) } : null;
}

/**
 * 엔트리 id 의 뒷부분 → IA slug.
 * 문서 홈은 Astro 가 `index` 를 떼어 `en/docs` 로 주므로 `docs` 자체가 그 페이지다.
 */
function slugOf(rest: string): string {
  return rest === DOCS_PREFIX ? "index" : rest.slice(DOCS_PREFIX.length + 1);
}

/** 신선도를 묻지 않기로 한 페이지인가 (`UNVERSIONED`). */
const isExempt = (rest: string): boolean => UNVERSIONED.has(rest);

/** `docPath()` 가 URL을 조립할 수 있는 자리에 있는가. */
const isUnderDocs = (rest: string): boolean =>
  rest === DOCS_PREFIX || rest.startsWith(`${DOCS_PREFIX}/`);

// ── 모듈 적재 시 한 번, 컬렉션 전체를 검사한다.
//
// ‼️ 이 검사를 미들웨어 안에 두면 **낡은 페이지가 생기는 날에야** 발동한다(판정이
//    `state === "current"` 뒤에 있으므로). 여기로 올려 두면 새 섹션을 넣는 순간
//    실패한다 — 링크가 조용히 틀리는 것보다 빌드가 시끄럽게 죽는 편이 낫다.
const localeEntries = docs.filter((entry) => splitId(entry.id) !== null);
if (localeEntries.length < docs.length / 2) {
  // id 모양이 바뀌면 아래 판정 전체가 조용히 건너뛰어진다.
  throw new Error(
    `routeData: 콘텐츠 엔트리 id 모양이 예상과 다릅니다 (로케일 접두어를 가진 것 ` +
      `${localeEntries.length}/${docs.length}). 예: ${docs
        .slice(0, 3)
        .map((e) => e.id)
        .join(", ")}`,
  );
}
for (const entry of localeEntries) {
  const { rest } = splitId(entry.id)!;
  if (!isExempt(rest) && !isUnderDocs(rest)) {
    throw new Error(
      `routeData: "${entry.id}" 가 "${DOCS_PREFIX}/" 아래에 없습니다. 새 섹션을 ` +
        `추가했다면 원문 URL 조립(routes.mjs 의 docPath)을 그 섹션에 맞게 넓히고, ` +
        `신선도를 묻지 않을 페이지라면 UNVERSIONED 에 넣으십시오.`,
    );
  }
}

export const onRequest = defineRouteMiddleware((context) => {
  const route = context.locals.starlightRoute;

  // 폴백 = 미번역. 원문을 그대로 보여 주는 것이 맞고, Starlight 이 알림을 단다.
  if (route.isFallback) return;

  const parts = splitId(route.entry.id);
  if (!parts || parts.locale === DEFAULT_LOCALE) return;
  if (isExempt(parts.rest)) return; // 404 같은 크롬 — 위 UNVERSIONED 주석 참조

  const sourceId = `${DEFAULT_LOCALE}/${parts.rest}`;
  const source = byId.get(sourceId);
  if (!source) {
    throw new Error(
      `고아 번역: ${route.entry.id} 에 대응하는 원문 ${sourceId} 이 없습니다. ` +
        `원문이 이름이 바뀌었거나 삭제됐다면 번역본도 같이 옮기거나 지우십시오.`,
    );
  }

  const expected = sourceHash({
    body: source.body ?? "",
    title: source.data.title,
  });
  const state = translationState(expected, route.entry.data.sourceHash);
  if (state === "current") return;
  if (state === "unstamped") {
    throw new Error(
      `스탬프 없는 번역: ${route.entry.id} 에 sourceHash 가 없습니다. ` +
        `\`npm run i18n:stamp -- ${parts.locale}/${slugOf(parts.rest)}\` 로 찍으십시오 — 스탬프가 ` +
        `없으면 낡음을 판정할 수 없고, 판정할 수 없는 번역은 조용히 신뢰받습니다.`,
    );
  }

  const notice: StaleTranslation = {
    sourceUrl: withBase(docPath(slugOf(parts.rest), DEFAULT_LOCALE)),
  };
  route[STALE_ROUTE_KEY] = notice;
});
