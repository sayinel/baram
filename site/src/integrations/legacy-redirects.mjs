// 구 단일 페이지 URL(`/docs/user-guide.html` 등)을 새 문서 URL로 보내는 정적 스텁을 쓴다.
// GitHub Pages는 정적 파일만 서빙하므로 301을 낼 수단이 없다 — meta refresh + canonical 이 유일하다.
//
// ‼️ Astro 내장 `redirects` 를 쓰지 않는 이유가 둘이다. 실측으로 확인했다:
//   1. 목적지에 `base` 를 붙이지 않는다 — `url=/en/docs/…` 를 내보내서 `/baram` 이 빠진
//      존재하지 않는 주소로 보낸다. canonical 도 같이 틀린다.
//   2. `trailingSlash: "always"` 와 겹치면 `docs/user-guide.html/index.html` 이라는
//      **디렉터리**를 만든다. 구 URL은 슬래시 없는 파일 요청이라 모양이 어긋난다.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const html = (target, canonical, from) => `<!doctype html>
<meta charset="utf-8" />
<title>Redirecting to ${target}</title>
<meta http-equiv="refresh" content="0;url=${target}" />
<meta name="robots" content="noindex" />
<link rel="canonical" href="${canonical}" />
<p>This page moved. <a href="${target}">Continue to ${target}</a>.</p>
<!-- from ${from} -->
`;

/**
 * 구 URL 스텁을 dist 에 직접 쓴다. 목적지는 `routes.mjs` 가 조립하므로 base 가 빠질 수 없다.
 * @param {{ targets: {from:string,to:string}[], withBase:(p:string)=>string, absolute:(p:string)=>string }} opts
 */
export function legacyRedirects({ absolute, targets, withBase }) {
  return {
    name: "baram:legacy-redirects",
    hooks: {
      "astro:build:done": ({ dir, logger }) => {
        for (const { from, to } of targets) {
          const out = join(fileURLToPath(dir), from.replace(/^\//, ""));
          mkdirSync(dirname(out), { recursive: true });
          writeFileSync(out, html(withBase(to), absolute(to), withBase(from)));
        }
        logger.info(`구 URL 스텁 ${targets.length}개`);
      },
    },
  };
}
