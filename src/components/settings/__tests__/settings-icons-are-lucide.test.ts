// 동훈님 요청: 설정 화면의 아이콘은 전부 lucide 여야 한다. 문자 기호(× ← ↻ ⚠ ▸ ⠇ ⓘ ✓ …)로
// 그린 아이콘을 lucide 로 바꾼 뒤, 되돌리면 깨지는 자리가 탭 목록(settings-tabs.test.tsx)
// 몇 곳뿐이었다 — 화면 안의 나머지는 어느 테스트도 보지 않았다. 여기서 규칙으로 막는다.
//
// 코퍼스: `SettingsModal.tsx` 에서 상대 경로 import 를 따라 닿는 `.tsx` 전부(테스트 제외,
// `import type` 제외). 목록을 손으로 적지 않고 매번 파생한다 — 설정 화면이 새 컴포넌트를
// 렌더하기 시작하면 그 파일도 자동으로 들어온다. `.ts` 모듈은 따라가지 않는다: 스토어·
// 유틸은 아무것도 그리지 않는다.
//
// 기호가 들어오는 네 가지 철자를 모두 본다 — 문자 그대로, HTML 엔터티(`&#10003;` 는
// 문자 스캔에 걸리지 않아 실제로 한 번 놓쳤다), `\u21BB` 같은 이스케이프, 그리고 i18n 값
// 앞뒤에 붙은 기호("↻ Refresh", "Browse Themes →", "+ Add …"). 설명 문장 **가운데**의
// 기호(`(-> →)` 처럼 입력 예시를 보여 주는 것)는 아이콘이 아니므로 i18n 쪽은 앞뒤만 본다.
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../../../..");
const ENTRY = path.join(ROOT, "src/components/settings/SettingsModal.tsx");
const EN = JSON.parse(
  readFileSync(path.join(ROOT, "src/i18n/en.json"), "utf8"),
) as Record<string, string>;
const KO = JSON.parse(
  readFileSync(path.join(ROOT, "src/i18n/ko.json"), "utf8"),
) as Record<string, string>;

/** × 와 화살표·수학·기술·도형·기타 기호·딩뱃·점자(U+2190–U+2BFF, ⓘ 포함), 그리고 이모지. */
const GLYPH = /[\u{D7}\u{2190}-\u{2BFF}\u{1F000}-\u{1FAFF}]/u;
const ENTITY = /&#x?[0-9a-f]+;|&[a-z]+;/gi;
const ESCAPE = /\\u\{?([0-9a-f]{4,5})\}?/gi;
/** 라벨 앞뒤에 붙은 아이콘 기호. `+` 는 뒤에 공백이 올 때만 — "+{count} more" 는 개수다. */
const EDGE_GLYPH = new RegExp(
  `^(?:${GLYPH.source}|\\+)\\s|\\s${GLYPH.source}$`,
  "u",
);

/** 텍스트이지 아이콘이 아닌 것. 파일(posix 상대 경로)마다 허용하는 철자와 이유. */
const ALLOWED: Record<string, { reason: string; spelling: string }[]> = {
  "src/components/settings/SettingsSearchResults.tsx": [
    { reason: "검색 결과의 섹션·라벨 사이 구분점", spelling: "&middot;" },
  ],
};

/** 앞뒤 기호가 아이콘이 아니라 내용인 i18n 라벨과 그 이유. */
const ALLOWED_LABELS: Record<string, string> = {
  "settings.vault.bulletMarker.plus":
    "글머리 표시 문자 선택지 — `+` 는 아이콘이 아니라 고르는 대상인 문자 자체다",
};

type Catalogs = readonly (readonly [string, Record<string, string>])[];

interface Finding {
  file: string;
  line: number;
  what: string;
}

const CATALOGS: Catalogs = [
  ["en", EN],
  ["ko", KO],
];

function posix(file: string): string {
  return path.relative(ROOT, file).split(path.sep).join("/");
}

function resolveTsx(from: string, spec: string): null | string {
  const base = path.resolve(path.dirname(from), spec);
  for (const candidate of [`${base}.tsx`, path.join(base, "index.tsx"), base]) {
    if (
      candidate.endsWith(".tsx") &&
      existsSync(candidate) &&
      statSync(candidate).isFile()
    ) {
      return candidate;
    }
  }
  return null;
}

function scanSource(
  file: string,
  source: string,
  catalogs: Catalogs = CATALOGS,
): Finding[] {
  const allowed = new Set((ALLOWED[file] ?? []).map((a) => a.spelling));
  const findings: Finding[] = [];
  const code = stripComments(source);
  code.split("\n").forEach((text, i) => {
    const at = (what: string) => findings.push({ file, line: i + 1, what });
    const glyph = text.match(new RegExp(GLYPH.source, "gu"));
    if (glyph) at(`glyph ${glyph.join("")}`);
    for (const [entity] of text.matchAll(ENTITY)) {
      if (!allowed.has(entity)) at(`entity ${entity}`);
    }
    for (const [escape, hex] of text.matchAll(ESCAPE)) {
      if (GLYPH.test(String.fromCodePoint(parseInt(hex, 16)))) {
        at(`escape ${escape}`);
      }
    }
  });
  // 파일 전체에서 찾는다 — prettier 는 `t(` 와 키를 두 줄로 나누곤 해서, 줄 단위로 보면
  // 그런 호출을 조용히 놓친다.
  for (const m of code.matchAll(/\bt\(\s*"([^"]+)"/g)) {
    if (m[1] in ALLOWED_LABELS) continue;
    const line = code.slice(0, m.index).split("\n").length;
    for (const [locale, catalog] of catalogs) {
      const value = catalog[m[1]];
      if (typeof value === "string" && EDGE_GLYPH.test(value)) {
        findings.push({
          file,
          line,
          what: `${locale} ${m[1]} = ${JSON.stringify(value)}`,
        });
      }
    }
  }
  return findings;
}

function settingsClosure(): string[] {
  const seen = new Set<string>();
  const queue = [ENTRY];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, "utf8");
    for (const m of source.matchAll(
      /(?:import|export)\s[^;]*?from\s+"(\.[^"]+)"/g,
    )) {
      if (/^(?:import|export)\s+type\b/.test(m[0])) continue;
      const next = resolveTsx(file, m[1]);
      if (next && !next.includes("__tests__")) queue.push(next);
    }
  }
  return [...seen].sort();
}

/** 블록 주석과, 줄 머리나 공백 뒤의 `//` 주석을 지운다(줄 번호는 유지). `https://` 는
 *  `:` 뒤라 지우지 않는다 — 문자열 안의 ` //` 는 지워지므로 그 뒤 기호는 못 본다. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
    .replace(/(^|\s)\/\/.*$/gm, (_match, lead: string) => lead);
}

describe("settings UI icons are lucide, not text glyphs", () => {
  const closure = settingsClosure();

  it("walks a closure that really reaches past the settings folder", () => {
    // 비-공허성: 파생이 조용히 비거나 줄면 아래 단정은 무엇도 보지 않고 통과한다.
    const files = closure.map(posix);
    expect(files.length).toBeGreaterThan(40);
    expect(files).toContain("src/components/plugins/PluginMarketplace.tsx");
    expect(files).toContain("src/components/journal/MigrationDialog.tsx");
    expect(files).toContain("src/components/plugins/PluginConsentDialog.tsx");
  });

  it("draws no icon with a text glyph, entity, escape or glyph-edged label", () => {
    const findings = closure.flatMap((file) =>
      scanSource(posix(file), readFileSync(file, "utf8")),
    );
    expect(findings.map((f) => `${f.file}:${f.line} ${f.what}`)).toEqual([]);
  });

  it("detects each spelling it claims to (positive controls)", () => {
    // 무엇이 이것을 실패시키는가: 탐지식 하나가 망가져 아무것도 잡지 못하면 위 단정은
    // 초록으로 남는다. 바꾸기 전의 실제 철자로 하나씩 확인한다.
    // i18n 은 합성 카탈로그로 본다 — 정규식만 따로 재면 `t("키")` → 값 조회의 연결이
    // 끊겨도 모른다.
    const catalogs: Catalogs = [
      [
        "en",
        {
          "p.after": "Browse Themes →",
          "p.before": "↻ Refresh",
          "p.count": "+{count} more",
          "p.mid": "Turns (-> →) into symbols",
          "p.plus": "+ Add Custom Command",
        },
      ],
    ];
    const probe = (source: string) =>
      scanSource("probe.tsx", source, catalogs).map((f) =>
        f.what.split(" ").slice(0, 2).join(" "),
      );
    expect(probe(`<button>{"×"}</button>`)).toEqual(["glyph ×"]);
    expect(probe(`<span>&#10003;</span>`)).toEqual(["entity &#10003;"]);
    expect(probe(`{"\\u21BB"}`)).toEqual(["escape \\u21BB"]);
    expect(probe(`{t("p.before")}`)).toEqual(["en p.before"]);
    expect(probe(`{t("p.after")}`)).toEqual(["en p.after"]);
    expect(probe(`{t(\n  "p.plus",\n)}`)).toEqual(["en p.plus"]);
    // 음성 대조: 문장 가운데의 기호, 개수 표기, 주석 안의 기호는 걸리지 않는다
    expect(probe(`{t("p.mid")}`)).toEqual([]);
    expect(probe(`{t("p.count")}`)).toEqual([]);
    expect(probe(`// 예전에는 "▾ 내장" 이었다`)).toEqual([]);
    expect(probe(`{/* ⚠ below */}`)).toEqual([]);
  });

  it("allows only exemptions that are still needed", () => {
    // 허용 목록이 낡으면(그 철자가 사라지거나 라벨이 더는 걸리지 않으면) 조용히 넓은
    // 구멍으로 남는다.
    for (const [file, entries] of Object.entries(ALLOWED)) {
      const source = readFileSync(path.join(ROOT, file), "utf8");
      for (const { spelling } of entries) {
        expect(source, `${file} ${spelling}`).toContain(spelling);
      }
    }
    const used = closure.map((file) => readFileSync(file, "utf8")).join("\n");
    for (const key of Object.keys(ALLOWED_LABELS)) {
      expect(used, key).toContain(`"${key}"`);
      expect(EDGE_GLYPH.test(EN[key]), key).toBe(true);
    }
  });
});
