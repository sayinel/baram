// 사이트 게이트가 `site/` **밖에서** 읽는 파일은 워크플로 트리거에도 있어야 한다.
//
// ‼️ 이것이 없으면 다음이 성립한다: 앱이 `src/i18n/ko.json` 의 용어를 바꾼다 → pages.yml
//    은 path 필터에 그 파일이 없어 **돌지 않고**, ci.yml 은 사이트를 아예 보지 않는다 →
//    두 워크플로가 모두 초록인 채로 용어 사전만 조용히 낡는다. 게이트의 입력이 그 게이트의
//    트리거 밖에 있으면 그 게이트는 필요한 순간에 돌지 않는다.
//
// 목록을 손으로 베끼지 않고 **게이트 소스에서 파생**시킨다 — 새 경계 넘기가 추가되면
// 그것도 자동으로 요구된다.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const SITE = join(dirname(fileURLToPath(import.meta.url)), "..");
const WORKFLOW = join(SITE, "..", ".github/workflows/pages.yml");

/** 게이트 스크립트들이 `site/` 밖에서 읽는 리포 상대 경로. */
function escapingReads() {
  const dir = join(SITE, "scripts");
  const found = new Set();
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".mjs")) continue;
    const src = readFileSync(join(dir, name), "utf8");
    // join(HERE, "..", "..", "<repo-relative path>")
    for (const m of src.matchAll(/join\(\s*HERE\s*,\s*"\.\."\s*,\s*"\.\."\s*,\s*"([^"]+)"/g)) {
      found.add(m[1]);
    }
  }
  return [...found];
}

test("the scan finds the boundary-crossing reads it claims to", () => {
  // 빈손이면 아래 단정이 공허해진다 — 지금 실재하는 것은 용어 게이트의 앱 사전이다.
  const reads = escapingReads();
  assert.ok(reads.length >= 1, `site/ 밖 읽기를 하나도 못 찾았다 — 스캔 패턴이 낡았다`);
  assert.ok(reads.includes("src/i18n/ko.json"), `앱 사전 읽기를 못 찾았다: ${reads}`);
});

test("every file a gate reads outside site/ is in the pages.yml path filter", () => {
  const workflow = readFileSync(WORKFLOW, "utf8");
  for (const path of escapingReads()) {
    assert.ok(
      workflow.includes(`- "${path}"`),
      `pages.yml 의 paths 에 "${path}" 가 없다 — 그 파일이 바뀔 때 사이트 게이트가 돌지 않는다`,
    );
  }
});

test("both triggers carry the filter, not just one", () => {
  // push 에만 넣으면 PR 에서 안 돌고, pull_request 에만 넣으면 main 에서 안 돈다.
  const workflow = readFileSync(WORKFLOW, "utf8");
  for (const path of escapingReads()) {
    const hits = workflow.split(`- "${path}"`).length - 1;
    assert.equal(hits, 2, `"${path}" 가 ${hits}번 — push·pull_request 두 곳에 있어야 한다`);
  }
});
