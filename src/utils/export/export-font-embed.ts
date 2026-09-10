// src/utils/export/export-font-embed.ts
// §353 export 에 서체를 싣는다.
//
// PDF 는 항상 임베드한다: src-tauri/src/export/mod.rs:113,129 가 HTML 을 임시
// 파일에 쓰고 headless Chrome 이 file:// 로 navigate 한다. 앱 번들의 woff2 를
// 상대 경로로 참조하면 그 임시 디렉터리 기준으로 풀려서 안 잡힌다 —
// export-katex-fonts.ts 가 같은 이유로 KaTeX face 를 인라인한다.
//
// HTML 은 사용자 선택이다: 2MB woff2 → 약 2.7MB base64 를 모든 export 에 기본으로
// 얹는 것은 과하다.
//
// ?url 이지 ?inline 이 아닌 이유는 이 파일 맨 위 테스트 주석에 있다(export-font-
// embed.test.ts) — 빌드 시점에 base64를 청크에 심는 ?inline과 달리, ?url은
// 자산 경로만 넘기고 실제 바이트는 export 시점에 fetch 로 읽는다.
//
// ‼️ 여기서 만드는 값은 순수 CSS 문자열이다. HTML 속성으로 들어갈 때의 이스케이프는
// 이 파일의 책임이 아니다 — export-html.ts 가 escapeHTML 로 처리한다(§353 리뷰
// R10). quoteFamily 는 CSS 문자열 이스케이프(\")만 하고 HTML 속성 이스케이프가
// 아니므로, 여기서 HTML을 흉내 내면 오히려 헷갈린다.
import jetbrainsMonoUrl from "../../assets/fonts/jetbrains-mono-latin-wght-normal.woff2?url";
import pretendardUrl from "../../assets/fonts/PretendardVariable.woff2?url";
import { BASE_EDITOR_STACK, BASE_MONO_STACK } from "../editor/font-surfaces";
import { quoteFamily } from "../editor/quote-font-family";

/**
 * 번들 서체만 임베드할 수 있다 — 나머지는 재배포 권리가 없다.
 *
 * `family` 를 값에 담는 이유: 키에서 표시명을 복원하려면 대문자 규칙을 다시
 * 적어야 하고 ("jetbrains mono variable" → JetBrains 의 두 번째 대문자를 잃는다),
 * 그것은 §347의 이름 계약을 두 곳에 적는 짓이다. 계약은 한 번만 적는다.
 */
const BUNDLED_ASSETS: Record<
  string,
  { family: string; url: string; weightRange: string }
> = {
  "jetbrains mono variable": {
    family: "JetBrains Mono Variable",
    url: jetbrainsMonoUrl,
    weightRange: "100 800",
  },
  "pretendard variable": {
    family: "Pretendard Variable",
    url: pretendardUrl,
    weightRange: "45 920",
  },
};

/** `article.baram-export` 의 인라인 style 값. 빈 설정은 선언을 만들지 않는다. */
export function exportFontVariables(
  bodyFont: string,
  codeFont: string,
): string {
  const parts: string[] = [];
  const body = quoteFamily(bodyFont);
  const code = quoteFamily(codeFont);
  if (body !== "")
    parts.push(`--font-family-editor:${body}, ${BASE_EDITOR_STACK}`);
  if (code !== "") parts.push(`--font-family-mono:${code}, ${BASE_MONO_STACK}`);
  return parts.join(";");
}

/** 자산 URL 을 fetch 해 base64 data URI 로. 읽기 실패는 null. */
async function toDataUri(url: string): Promise<null | string> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    let binary = "";
    for (const b of bytes) binary += String.fromCharCode(b);
    return `data:font/woff2;base64,${btoa(binary)}`;
  } catch {
    return null;
  }
}

/**
 * 요청된 패밀리 중 번들된 것들의 `@font-face` 를 data URI 로 만든다.
 *
 * 읽기가 실패하면 빈 문자열이다 — 서체 없는 export 가 export 실패보다 낫다.
 */
export async function buildFontFaceCSS(families: string[]): Promise<string> {
  const keys = [...new Set(families.map((f) => f.trim().toLowerCase()))];
  const blocks: string[] = [];
  for (const key of keys) {
    const asset = BUNDLED_ASSETS[key];
    if (!asset) continue;
    const uri = await toDataUri(asset.url);
    if (uri === null) continue;
    blocks.push(
      `@font-face{font-family:"${asset.family}";font-style:normal;` +
        `font-weight:${asset.weightRange};` +
        `src:url(${uri}) format("woff2-variations")}`,
    );
  }
  return blocks.join("\n");
}
