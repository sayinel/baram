// §4.2 번역 신선도 판정. 원문(en)의 `title + 본문`을 해시해 번역본의 스탬프와 대조한다.
// 설계: dev/design/specs/0044-docs-site-i18n-restructure-design.md ('원문 해시 스탬프')
//
// ‼️ 이 모듈은 **두 곳에서 돈다** — 스탬프 도구(순수 Node)와 페이지 렌더(Vite 번들).
//    판정이 두 벌이면 갈리므로 계산은 여기 하나뿐이다. 그래서 파일을 읽지 않는다:
//    번들 쪽에서는 상대 경로가 청크 기준으로 풀려 죽는다(`routes.mjs` 가 그렇게 죽었다).
//    파일 읽기는 호출자 몫이고, 이 모듈은 입력만 받는다.
//
//    두 계산이 실제로 일치하는지는 `scripts/check-dist.mjs` 가 **산출물에서** 대조한다 —
//    디스크에서 낸 판정과 빌드가 렌더한 배너가 다르면 그 게이트가 실패한다.
import { createHash } from "node:crypto";

/**
 * 스탬프에 쓰는 16진수 자릿수.
 *
 * 충돌의 결과가 "낡은 번역이 최신으로 보인다"는 **조용한** 오답이므로 넉넉히 산다.
 * 48비트면 한 페이지가 편집될 때마다 뽑는 값이 우연히 같을 확률이 사실상 0이다.
 */
export const SOURCE_HASH_LENGTH = 12;

/** 라우트 데이터에 낡음 판정을 실어 나르는 키 (`StarlightRouteData` 의 인덱스 시그니처). */
export const STALE_ROUTE_KEY = "baramStaleTranslation";

export interface SourceDocument {
  /** 원문 본문. 프론트매터를 제외한 나머지 전부. */
  body: string;
  /** 원문 프론트매터의 `title`. 제목만 바뀐 변경을 놓치지 않으려고 함께 넣는다. */
  title: string;
}

export interface StaleTranslation {
  /** 원문 페이지의 URL (base 포함). 배너의 "원문 보기" 링크. */
  sourceUrl: string;
}

/** 번역본이 원문에 대해 어떤 상태인가. */
export type TranslationState = "current" | "stale" | "unstamped";

/**
 * 해시 입력의 정규화. 양끝 공백과 줄바꿈 방식은 번역을 다시 할 이유가 아니다.
 *
 * 이 정규화가 두 계산 지점을 맞추는 역할도 한다 — Astro 가 넘기는 `entry.body` 와
 * 디스크에서 프론트매터를 잘라 낸 문자열은 앞뒤 빈 줄이 다를 수 있다.
 */
function normalize(body: string): string {
  return body.replace(/\r\n/g, "\n").trim();
}

/**
 * 원문의 해시.
 *
 * 입력을 JSON 배열로 감싸는 이유는 구분자 모호성이다 — `title + "\n" + body` 로 이으면
 * 제목 끝에 줄바꿈이 있는 문서와 본문 첫 줄이 제목인 문서가 같은 값을 낸다.
 */
export function sourceHash(source: SourceDocument): string {
  const payload = JSON.stringify([source.title.trim(), normalize(source.body)]);
  return createHash("sha256")
    .update(payload)
    .digest("hex")
    .slice(0, SOURCE_HASH_LENGTH);
}

/** 프론트매터 블록과 그 뒤 본문. 프론트매터가 없으면 `null`. */
export function splitFrontmatter(
  raw: string,
): { body: string; frontmatter: string } | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/.exec(raw);
  if (!match) return null;
  return { body: raw.slice(match[0].length), frontmatter: match[1] ?? "" };
}

/**
 * 프론트매터의 `title` 값. 없으면 `null`.
 *
 * YAML 파서를 쓰지 않는 이유: en 제목은 `check-pages.mjs` 가 `TITLES` 의
 * `JSON.stringify` 값과 일치하도록 고정하므로 항상 한 줄짜리 인용 문자열이다.
 */
export function frontmatterTitle(frontmatter: string): string | null {
  const match = /^title:[ \t]*(.+?)[ \t]*$/m.exec(frontmatter);
  if (!match?.[1]) return null;
  const value = match[1];
  if (!value.startsWith('"')) return value;
  try {
    return JSON.parse(value) as string;
  } catch {
    return null;
  }
}

/**
 * 프론트매터의 `sourceHash` 값. 없으면 `undefined`.
 *
 * ‼️ 인용부호를 허용하는 것이 아니라 **인용부호가 정상**이다 — 아래 `stampFrontmatter`
 *    주석 참조. 인용 없는 형태도 읽어 주는 이유는 손으로 적은 파일 때문이다.
 */
export function frontmatterSourceHash(frontmatter: string): string | undefined {
  return /^sourceHash:[ \t]*"?([0-9a-f]+)"?[ \t]*$/m.exec(frontmatter)?.[1];
}

/**
 * 디스크에서 읽은 원문 파일의 해시.
 *
 * 프론트매터나 `title` 이 없으면 던진다 — 조용히 건너뛰면 그 페이지만 판정에서
 * 빠져 영영 최신으로 보인다.
 */
export function hashSourceFile(raw: string, label: string): string {
  const parts = splitFrontmatter(raw);
  if (!parts) throw new Error(`${label}: 프론트매터가 없습니다`);
  const title = frontmatterTitle(parts.frontmatter);
  if (title === null) throw new Error(`${label}: 프론트매터에 title 이 없습니다`);
  return sourceHash({ body: parts.body, title });
}

/**
 * 프론트매터의 `sourceHash` 를 갈아 끼운 파일 내용. 없으면 마지막 줄로 넣는다.
 *
 * 자리를 끝으로 고정하는 이유는 diff 다 — 번역자가 보는 변경이 항상 한 줄이어야 한다.
 *
 * ‼️ **값을 반드시 인용한다.** 16진수 12자리가 우연히 숫자만으로 나오면(≈0.5%)
 *    YAML 이 그것을 **숫자로** 파싱해 `z.string()` 스키마가 거부하고 빌드가
 *    `Expected type "string", received "number"` 로 죽는다. `123e45678901` 같은
 *    지수 표기 모양도 같은 함정이다. 실측으로 확인한 결함이고, 증상이 원인을 전혀
 *    가리키지 않아 다음 사람이 오래 헤맨다.
 */
export function stampFrontmatter(
  raw: string,
  hash: string,
  label: string,
): string {
  const parts = splitFrontmatter(raw);
  if (!parts) throw new Error(`${label}: 프론트매터가 없습니다`);
  const line = `sourceHash: ${JSON.stringify(hash)}`;
  const frontmatter = /^sourceHash:.*$/m.test(parts.frontmatter)
    ? parts.frontmatter.replace(/^sourceHash:.*$/m, line)
    : `${parts.frontmatter}\n${line}`;
  return `---\n${frontmatter}\n---\n${parts.body}`;
}

/** 원문 해시와 번역본에 찍힌 스탬프를 견준다. */
export function translationState(
  expected: string,
  stamped: string | undefined,
): TranslationState {
  if (!stamped) return "unstamped";
  return stamped === expected ? "current" : "stale";
}

/** 라우트 데이터에 실린 낡음 판정을 꺼낸다. 인덱스 시그니처라 좁히기가 필요하다. */
export function readStaleTranslation(
  route: Record<string, unknown>,
): StaleTranslation | null {
  const value = route[STALE_ROUTE_KEY];
  if (typeof value !== "object" || value === null) return null;
  const { sourceUrl } = value as Partial<StaleTranslation>;
  return typeof sourceUrl === "string" ? { sourceUrl } : null;
}
