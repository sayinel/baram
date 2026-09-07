// 크롤러에게 sitemap 의 자리를 알린다.
//
// ‼️ `site/public/robots.txt` 로 두지 않는다. 그러면 origin 리터럴이 한 벌 더 생기고,
//    도메인이 바뀔 때 그 파일만 조용히 낡는다 — 어떤 게이트도 실패하지 않은 채로.
//    계약의 단일 출처는 `help-routes.json` 이므로 여기서 파생시킨다.
import type { APIRoute } from "astro";

import { absolute } from "../../routes.mjs";

/** sitemap 은 Starlight 이 딸려 오는 `@astrojs/sitemap` 이 base 루트에 낸다. */
const SITEMAP = absolute("/sitemap-index.xml");

const BODY = `User-agent: *
Allow: /

Sitemap: ${SITEMAP}
`;

export const GET: APIRoute = () =>
  new Response(BODY, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
