// §4.2 원문 해시와 번역 신선도 판정.
//
// ‼️ 여기서 증명할 수 없는 것이 하나 있다 — **빌드가 내는 해시와 이 함수가 내는 해시가
//    같은가.** 빌드는 Astro 가 파싱한 `entry.body`/`entry.data.title` 을 넣고, 스탬프
//    도구는 디스크에서 프론트매터를 잘라 넣는다. 두 입력이 갈리면 이 파일의 단정은
//    전부 통과하면서 사이트만 깨진다. 그 대조는 `scripts/check-dist.mjs` 가
//    **산출물에서** 한다 (디스크 판정 ↔ 렌더된 배너).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  frontmatterSourceHash,
  frontmatterTitle,
  hashSourceFile,
  readStaleTranslation,
  SOURCE_HASH_LENGTH,
  sourceHash,
  splitFrontmatter,
  STALE_ROUTE_KEY,
  stampFrontmatter,
  translationState,
} from "../src/lib/source-hash.ts";
import { EN_DOCS, pageFile, slugsOn } from "../scripts/docs-fs.mjs";

const DOC = { body: "본문\n\n두 번째 문단\n", title: "Getting started" };

test("hash is stable and the declared width", () => {
  const hash = sourceHash(DOC);
  assert.equal(hash, sourceHash({ ...DOC }));
  assert.match(hash, new RegExp(`^[0-9a-f]{${SOURCE_HASH_LENGTH}}$`));
});

test("a one-character body change changes the hash", () => {
  assert.notEqual(sourceHash(DOC), sourceHash({ ...DOC, body: `${DOC.body}.` }));
});

test("a title-only change changes the hash", () => {
  // 본문만 해시하면 영문 제목 변경이 번역에 반영되지 않은 채 최신으로 남는다.
  assert.notEqual(sourceHash(DOC), sourceHash({ ...DOC, title: "Get started" }));
});

test("line endings and surrounding blank lines do not change the hash", () => {
  // 번역을 다시 할 이유가 아니고, 이 정규화가 디스크 파싱과 Astro 파싱의 차이도 흡수한다.
  assert.equal(
    sourceHash(DOC),
    sourceHash({ body: `\n\n${DOC.body.replace(/\n/g, "\r\n")}  `, title: `  ${DOC.title} ` }),
  );
});

test("the title/body boundary is not ambiguous", () => {
  // 이어붙이기(`title + "\n" + body`)로 만들면 이 둘이 같은 값을 낸다.
  assert.notEqual(
    sourceHash({ body: "c", title: "a\nb" }),
    sourceHash({ body: "b\nc", title: "a" }),
  );
});

test("splitFrontmatter keeps everything after the delimiter as body", () => {
  const raw = '---\ntitle: "T"\n---\n\n본문\n---\n뒤\n';
  const parts = splitFrontmatter(raw);
  assert.equal(parts.frontmatter, 'title: "T"');
  assert.equal(parts.body, "\n본문\n---\n뒤\n");
  assert.equal(splitFrontmatter("프론트매터 없음\n"), null);
});

test("frontmatterTitle unquotes JSON strings and survives extra fields", () => {
  assert.equal(frontmatterTitle('title: "Documentation"'), "Documentation");
  assert.equal(frontmatterTitle('description: "d"\ntitle: "T"\nsidebar: x'), "T");
  assert.equal(frontmatterTitle("title: 인용 없음"), "인용 없음");
  assert.equal(frontmatterTitle('sidebar:\n  title: "중첩"'), null);
});

test("frontmatterSourceHash reads a hex stamp, quoted or not", () => {
  assert.equal(frontmatterSourceHash('sourceHash: "a1b2c3d4e5f6"'), "a1b2c3d4e5f6");
  assert.equal(frontmatterSourceHash("sourceHash: a1b2c3d4e5f6"), "a1b2c3d4e5f6");
  assert.equal(frontmatterSourceHash('title: "T"'), undefined);
});

test("translationState separates the three outcomes", () => {
  assert.equal(translationState("aaa", "aaa"), "current");
  assert.equal(translationState("aaa", "bbb"), "stale");
  assert.equal(translationState("aaa", undefined), "unstamped");
});

test("stampFrontmatter inserts once, replaces after, and is idempotent", () => {
  const raw = '---\ntitle: "문서"\n---\n\n본문\n';
  const once = stampFrontmatter(raw, "abc123abc123", "t");
  assert.equal(once, '---\ntitle: "문서"\nsourceHash: "abc123abc123"\n---\n\n본문\n');
  assert.equal(stampFrontmatter(once, "abc123abc123", "t"), once);

  const restamped = stampFrontmatter(once, "111111111111", "t");
  assert.equal(frontmatterSourceHash(splitFrontmatter(restamped).frontmatter), "111111111111");
  assert.equal(restamped.split("sourceHash:").length - 1, 1, "줄이 늘어나면 안 된다");
  assert.equal(splitFrontmatter(restamped).body, splitFrontmatter(raw).body);
});

test("the stamp is always quoted — an all-digit hash must not become a YAML number", () => {
  // ‼️ 실측 결함: 인용하지 않으면 YAML 이 `000000000000` 을 숫자로 읽고
  //    `z.string()` 스키마가 `Expected "string", received "number"` 로 빌드를 죽인다.
  //    16진수 12자리가 숫자만으로 나올 확률이 ≈0.5% 이고 `123e45678901` 같은
  //    지수 표기 모양도 같은 함정이다 — 우연에 맡길 수 없다.
  const raw = '---\ntitle: "문서"\n---\n본문\n';
  for (const hash of ["000000000000", "123456789012", "123e45678901"]) {
    const line = stampFrontmatter(raw, hash, "t")
      .split("\n")
      .find((l) => l.startsWith("sourceHash:"));
    assert.equal(line, `sourceHash: "${hash}"`);
    assert.equal(frontmatterSourceHash(line), hash, "읽는 쪽도 인용을 벗겨야 한다");
  }
});

test("hashSourceFile agrees with hashing the parsed parts", () => {
  // 파일 진입점과 순수 진입점이 갈리면 스탬프를 찍자마자 낡음으로 뜬다.
  const slugs = slugsOn(EN_DOCS);
  assert.ok(slugs.length >= 50, `en 페이지 스캔이 ${slugs.length}개 — 경로가 바뀌었다`);
  for (const slug of slugs) {
    const raw = readFileSync(pageFile(EN_DOCS, slug), "utf8");
    const parts = splitFrontmatter(raw);
    assert.ok(parts, `en/${slug}: 프론트매터가 없다`);
    assert.equal(
      hashSourceFile(raw, slug),
      sourceHash({ body: parts.body, title: frontmatterTitle(parts.frontmatter) }),
    );
  }
});

test("hashSourceFile throws instead of silently skipping a malformed page", () => {
  // 조용히 건너뛰면 그 페이지만 판정에서 빠져 영영 최신으로 보인다.
  assert.throws(() => hashSourceFile("본문뿐\n", "x"), /프론트매터/);
  assert.throws(() => hashSourceFile('---\ndescription: "d"\n---\n본문\n', "x"), /title/);
});

test("readStaleTranslation narrows the route-data index signature", () => {
  assert.deepEqual(
    readStaleTranslation({ [STALE_ROUTE_KEY]: { sourceUrl: "/en/docs/" } }),
    { sourceUrl: "/en/docs/" },
  );
  assert.equal(readStaleTranslation({}), null);
  assert.equal(readStaleTranslation({ [STALE_ROUTE_KEY]: "문자열" }), null);
  assert.equal(readStaleTranslation({ [STALE_ROUTE_KEY]: { sourceUrl: 7 } }), null);
});
