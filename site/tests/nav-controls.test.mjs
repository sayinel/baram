// 랜딩 nav 의 select 껍데기 — **클릭 가능 영역** 계약.
//
// ‼️ 브라우저 없이는 "캐럿을 눌러 목록이 열린다"를 직접 잡을 수 없다: 네이티브 picker 는
//    스크립트로 열리지 않고, 이 프로젝트에 브라우저 러너가 없다. 그래서 그것과 동치인
//    **구조**를 고정한다 — 흐름에 남는 것은 `<select>` 하나뿐이고, 아이콘·캐럿은 그 위에
//    겹쳐 놓되 히트 테스트에서 빠져야 한다.
//    아이콘을 flex 형제로 두면 아이콘·캐럿 위 클릭이 select 에 닿지 않고, 그때 `<label>`
//    이 받은 클릭은 select 에 **포커스만** 주고 목록을 열지 않는다(Chromium·WebKit).
//    실제로 그렇게 배선돼 있어서 랜딩의 두 드롭다운 화살표가 죽어 있었다.
//    문서 헤더(Starlight `Select.astro`)가 쓰는 구조와 같은 것을 요구한다.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const SITE = join(dirname(fileURLToPath(import.meta.url)), "..");
const layout = readFileSync(join(SITE, "src/layouts/Landing.astro"), "utf8");
const css = readFileSync(join(SITE, "src/styles/site.css"), "utf8");

/** 선언 블록들 — 셀렉터로 찾아 그 안의 선언을 본다(@media 안쪽 규칙도 개별로 잡힌다).
    주석은 미리 지운다 — 안 지우면 셀렉터 앞 주석의 낱말이 셀렉터로 오인된다. */
const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");
function blocks(selectorPredicate) {
  const out = [];
  for (const [, selector, body] of bare.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (selectorPredicate(selector.trim())) out.push({ selector: selector.trim(), body });
  }
  return out;
}

/** `<label class="... nav-select ...">…</label>` 조각들. */
function selectLabels() {
  const out = [];
  for (const m of layout.matchAll(/<label[^>]*class="[^"]*\bnav-select\b[^"]*"[^>]*>/g)) {
    const end = layout.indexOf("</label>", m.index);
    assert.notEqual(end, -1, "닫히지 않은 <label>");
    out.push(layout.slice(m.index, end));
  }
  return out;
}

test("랜딩의 두 컨트롤(테마·언어)이 nav-select 껍데기를 쓴다", () => {
  const labels = selectLabels();
  assert.equal(labels.length, 2, `nav-select 라벨 ${labels.length}개 (기대 2개: 테마·언어)`);
  for (const label of labels) {
    assert.match(label, /<select\b/, "라벨 안에 <select> 가 없다");
  }
});

test("아이콘·캐럿은 클래스로 구분돼 겹쳐 놓인다 — 흐름에 남는 형제가 아니다", () => {
  for (const label of selectLabels()) {
    const icons = [...label.matchAll(/<svg[^>]*>/g)].map((m) => m[0]);
    // sr-only 라벨 뒤의 아이콘 두 개: 앞 아이콘(label-icon) + 캐럿(caret).
    assert.equal(icons.length, 2, `svg ${icons.length}개 (기대 2개)`);
    assert.equal(icons.filter((s) => /\bclass="[^"]*\blabel-icon\b/.test(s)).length, 1);
    assert.equal(icons.filter((s) => /\bclass="[^"]*\bcaret\b/.test(s)).length, 1);
  }
});

test("nav-select 의 아이콘은 absolute + pointer-events:none 이다", () => {
  const rules = blocks((s) => s.includes(".nav-select") && s.includes("svg"));
  assert.ok(rules.length > 0, ".nav-select 의 svg 규칙이 없다");
  const merged = rules.map((r) => r.body).join(" ");
  assert.match(merged, /position:\s*absolute/, "아이콘이 흐름에서 빠져 있지 않다");
  assert.match(
    merged,
    /pointer-events:\s*none/,
    "아이콘이 클릭을 삼킨다 — select 에 닿지 못하므로 목록이 열리지 않는다",
  );
});

test("select 가 아이콘 자리까지 덮는다 — padding 으로 자리를 비워 둔다", () => {
  const rules = blocks((s) => /\.nav-select\b[^,{]*\bselect\b/.test(s));
  assert.ok(rules.length > 0, ".nav-select select 규칙이 없다");
  const merged = rules.map((r) => r.body).join(" ");
  // 앞 아이콘·캐럿 폭(1em)을 양쪽 padding 으로 확보해야 그 자리가 select 의 히트 영역이 된다.
  assert.match(
    merged,
    /padding(-inline)?:[^;]*1em/,
    "select 가 아이콘 자리를 padding 으로 덮지 않는다 — 그 위 클릭은 select 밖이다",
  );
});
