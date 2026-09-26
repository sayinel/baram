// 동훈님 요청: 앱의 아이콘은 전부 lucide 여야 한다. PR #739 가 설정 화면을 규칙으로 막았지만
// 그 코퍼스는 `SettingsModal.tsx` 의 import 폐포였고, 나머지 화면은 어느 테스트도 보지 않았다 —
// 2026-09-26 에 셌을 때 64개 파일이 문자 기호로 아이콘을 그리고 있었다(계획 0108). 이 테스트가
// 그 규칙을 앱 전체로 넓힌다. 설정 화면의 폐포는 아래 코퍼스의 부분집합이다.
//
// 코퍼스 — 목록을 손으로 적지 않고 매번 디스크에서 파생한다:
//   - `src/` 아래 `.ts`·`.tsx` 전부. 빼는 것: `__tests__/`·`*.test.*`(테스트), `.d.ts`(선언뿐),
//     `src/spike/`(측정 프로브 — `spike/ime-probe/ime-probe-enabled.ts` 와
//     `spike/vim-wysiwyg-probe/vim-probe-enabled.ts` 의 게이트가 배포 빌드에서 꺼져 있다).
//   - `src/styles/` 아래 `.css` 의 `content:` 값. `generated/` 는 Style Dictionary 소유라 뺀다.
//
// 기호가 들어오는 여섯 가지 철자를 본다:
//   glyph  — × · ‹ › · U+2190–U+2BFF(화살표·수학·기술·도형·기타 기호·딩뱃) · 이모지(U+1F000–U+1FAFF)
//   entity — `&times;` `&#9650;` 같은 HTML 엔터티(문자 스캔에 걸리지 않아 #739 때 한 번 놓쳤다)
//   escape — 기호로 풀리는 `▶` 류 이스케이프
//   i18n   — `t("키")` 리터럴이 가리키는 값의 앞이나 뒤 가장자리에 붙은 기호, 또는 앞의 "+ "
//   lone   — `.tsx` 에서 기호 하나(`+ # ! §`)뿐인 JSX 글자(`>+<`)나 문자열(`{"+"}`, `? "!" :`)
//   css    — `content:` 값 안의 기호나, 기호로 풀리는 CSS 이스케이프(`\25B6`)
// 알려진 누락: 동적 키(`t(변수)`)의 라벨, 단어 모양으로 그린 아이콘(`Aa` `W` `.*`), `…`(U+2026 —
// 진행 표시로도 문장 부호로도 쓰여 이 탐지로는 아이콘과 가를 수 없다).
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
const SRC = path.join(ROOT, "src");
const EN = JSON.parse(
  readFileSync(path.join(SRC, "i18n/en.json"), "utf8"),
) as Record<string, string>;
const KO = JSON.parse(
  readFileSync(path.join(SRC, "i18n/ko.json"), "utf8"),
) as Record<string, string>;

const GLYPH = /[\u{D7}\u{2039}\u{203A}\u{2190}-\u{2BFF}\u{1F000}-\u{1FAFF}]/u;
const ENTITY = /&#x?[0-9a-f]+;|&[a-z]+;/gi;
const ESCAPE = /\\u\{?([0-9a-f]{4,5})\}?/gi;
/** 라벨 앞뒤에 붙은 아이콘 기호. `+` 는 뒤에 공백이 올 때만 — "+{count} more" 는 개수다. */
const EDGE_GLYPH = new RegExp(
  `^(?:${GLYPH.source}|\\+)\\s|\\s${GLYPH.source}$`,
  "u",
);
const LONE_TEXT = />\s*([+#!§])\s*</g;
const LONE_LITERAL = /[{?:]\s*"([+#!§])"\s*[}:]/g;
const CSS_CONTENT = /content\s*:\s*([^;}]*)/g;
const CSS_ESCAPE = /\\([0-9a-f]{2,6})\s?/gi;

type Catalogs = readonly (readonly [string, Record<string, string>])[];

interface Exemption {
  reason: string;
  /** `"<kind> <token>"` 목록, 또는 파일 전체가 내용·표기 데이터일 때 `"*"`. */
  spellings: "*" | readonly string[];
}

interface Finding {
  file: string;
  line: number;
  /** `"<kind> <token>"` — 예: `glyph →`, `entity &gt;`, `i18n 키`, `lone +`, `css ▶`. */
  spelling: string;
}

const CATALOGS: Catalogs = [
  ["en", EN],
  ["ko", KO],
];

/**
 * 아이콘이 아니라 텍스트·표기·문서 내용인 것. 파일(posix 상대 경로)마다 허용하는 철자와 이유.
 * 판정 근거는 계획 0108 의 "아이콘이 아닌 것" 표다.
 */
const ALLOWED: Record<string, Exemption> = {
  "src/components/command/command-registry.ts": {
    reason: "명령 팔레트의 단축키 표기(⌘⇧⌥)",
    spellings: ["glyph ⌘", "glyph ⇧", "glyph ⌥"],
  },
  "src/components/editor/DiffView.tsx": {
    reason: "diff 줄 접두사 `+` — 문법이다",
    spellings: ["lone +"],
  },
  "src/components/editor/MergeView.tsx": {
    reason: "diff 줄 접두사 `+` — 문법이다",
    spellings: ["lone +"],
  },
  "src/components/onboarding/HomeScreen.tsx": {
    reason: "`<kbd>` 안의 단축키 표기",
    spellings: ["glyph ⌘", "glyph ⇧"],
  },
  "src/components/settings/SettingsSearchResults.tsx": {
    reason: "검색 결과의 섹션·라벨 사이 구분점",
    spellings: ["entity &middot;"],
  },
  "src/components/settings/appearance-dial-row.tsx": {
    reason: "양수 다이얼 값의 부호 `+`",
    spellings: ["lone +"],
  },
  "src/components/settings/tabs/VaultTab.tsx": {
    reason:
      "글머리 표시 문자 선택지 — `+` 는 아이콘이 아니라 고르는 대상인 문자 자체다",
    spellings: ["lone +", "i18n settings.vault.bulletMarker.plus"],
  },
  "src/components/sidebar/CalendarPanel.tsx": {
    reason: "안내 문장 속 설정 경로 구분자 `>`",
    spellings: ["entity &gt;"],
  },
  "src/components/sidebar/SkillLivePreview.tsx": {
    reason: "안내 문장이 인용하는 태그 이름 `<system>`·`<user>`",
    spellings: ["entity &lt;", "entity &gt;"],
  },
  "src/components/sidebar/TagPanel.tsx": {
    reason:
      "이름 바꾸기 토스트 문장의 → 와, 태그 트리가 태그 앞에 보여 주는 태그 문법 `#`",
    spellings: ["glyph →", "lone #"],
  },
  "src/components/sidebar/file-icon.tsx": {
    reason: "SVG 파일 아이콘 안에 그리는 라벨 `<>`",
    spellings: ["entity &lt;", "entity &gt;"],
  },
  "src/components/tasks/TaskFilterBar.tsx": {
    reason:
      "`<option>` 은 글자만 담는다. ⏫🔽 는 사용자가 태스크 줄에 입력하는 Tasks 우선순위 문법 기호다",
    spellings: [
      "i18n tasks.panel.priority.high",
      "i18n tasks.panel.priority.low",
    ],
  },
  "src/components/tasks/TaskRow.tsx": {
    reason: "경과일 숫자 앞의 마이너스 부호",
    spellings: ["glyph −"],
  },
  "src/extensions/nodes/mermaid-block-view.tsx": {
    reason: "textarea placeholder 의 줄바꿈 엔터티",
    spellings: ["entity &#10;"],
  },
  "src/extensions/nodes/tag-node-view.tsx": {
    reason: "태그 노드가 태그 앞에 보여 주는 태그 문법 `#`",
    spellings: ["lone #"],
  },
  "src/extensions/plugins/slash-command-items-basic.ts": {
    reason: "slash 메뉴의 마크다운 문법 힌트(mdHint)",
    spellings: ["glyph ▸"],
  },
  "src/extensions/plugins/slash-command-items-journal.ts": {
    reason: "slash 메뉴의 문법 힌트(mdHint)",
    spellings: ["glyph 📷"],
  },
  "src/extensions/plugins/slash-command-items-tasks.ts": {
    reason: "Tasks 필드 문법 기호 — 문서에 그대로 쓰인다",
    spellings: ["glyph ⏫", "glyph 🔁", "glyph 📅", "glyph ⏳", "glyph 🛫"],
  },
  "src/extensions/plugins/smart-punctuation.ts": {
    reason: "입력 규칙의 치환 결과 — 문서에 들어가는 문자",
    spellings: "*",
  },
  "src/extensions/plugins/symbol-data.ts": {
    reason: "기호 팔레트의 데이터 — 문서에 들어가는 문자",
    spellings: "*",
  },
  "src/extensions/plugins/task-created-stamp.ts": {
    reason: "Tasks 생성일 필드 문법 ➕",
    spellings: ["glyph ➕"],
  },
  "src/hooks/tab-switching/load-tab-content.ts": {
    reason: "성능 계측 라벨 문자열",
    spellings: ["glyph →"],
  },
  "src/hooks/use-editor-effects.ts": {
    reason: "OS 창 제목의 저장 안 됨 표시 — 창 제목은 글자만 담는다",
    spellings: ["escape \\u25CF"],
  },
  "src/keybindings/key-utils.ts": {
    reason: "키 이름 표기(⌘⇧⌥↩⇥⌫…)",
    spellings: "*",
  },
  "src/pipeline/serializer.ts": {
    reason: "마크다운 직렬화의 이스케이프",
    spellings: ["entity &#x20;"],
  },
  "src/pipeline/transformers/media-html-tag.ts": {
    reason: "HTML 속성 이스케이프 표",
    spellings: "*",
  },
  "src/pipeline/transformers/toggle-transformer.ts": {
    reason: "HTML 이스케이프 표",
    spellings: "*",
  },
  "src/plugins/builtin/media-viewer.ts": {
    reason:
      "플러그인 매니페스트 `icon` 은 서드파티와 공유하는 문자열 계약이다(`plugins/types.ts` 의 `icon?: string`)",
    spellings: ["glyph 🖼"],
  },
  "src/plugins/editor-surfaces.ts": {
    reason: "오류 문구가 인용하는 설계 절 번호 ⑪",
    spellings: ["glyph ⑪"],
  },
  "src/services/task-capture.ts": {
    reason: "Tasks 생성일 필드 문법 ➕(정규식)",
    spellings: ["glyph ➕"],
  },
  "src/themes/theme-install.ts": {
    reason: "오류·진단 문구 속 →",
    spellings: ["glyph →"],
  },
  "src/themes/theme-store-fs.ts": {
    reason: "오류 문구 속 →",
    spellings: ["glyph →"],
  },
  "src/utils/block-ai-diff.ts": {
    reason: "`<kbd>` 단축키 표기 ⌘↵",
    spellings: ["glyph ⌘", "glyph ↵"],
  },
  "src/utils/export/export-html-code-block.ts": {
    reason: "HTML 이스케이프 표",
    spellings: "*",
  },
  "src/utils/export/notion-export.ts": {
    reason: "Notion 으로 내보내는 문서 내용(콜아웃 이모지·토글 ▶)",
    spellings: "*",
  },
  "src/utils/export/pandoc-export.ts": {
    reason: "Pandoc 으로 내보내는 문서 내용(토글 ▶)",
    spellings: ["escape \\u25B6"],
  },
  "src/utils/journal/journal-memories.ts": {
    reason: "저널 마크다운의 표지 문자 파싱과 HTML 이스케이프",
    spellings: "*",
  },
  "src/utils/journal/journal-search.ts": {
    reason: "HTML 이스케이프 표",
    spellings: "*",
  },
  "src/utils/journal/journal-themes.ts": {
    reason:
      "테마 데이터 `streakIcon` — 어디에도 렌더되지 않는다(읽는 곳은 journal-themes.test.ts 뿐)",
    spellings: "*",
  },
  "src/utils/markdown/svg-utils.ts": {
    reason: "SVG 텍스트 이스케이프",
    spellings: "*",
  },
  "src/utils/skill/skill-chain-runner.ts": {
    reason: "오류 문구 속 순환 경로 →",
    spellings: ["glyph →"],
  },
  "src/utils/skill/skill-dependency-analyzer.ts": {
    reason: "경고 문구 속 순환 경로 →",
    spellings: ["glyph →"],
  },
  "src/utils/table-grid-picker.ts": {
    reason: "표 크기 표기 `3 × 4`",
    spellings: ["glyph ×"],
  },
  "src/utils/tasks/task-field-order.ts": {
    reason: "Tasks 필드 문법 기호",
    spellings: "*",
  },
  "src/utils/tasks/task-field-tokens.ts": {
    reason: "Tasks 필드 문법 기호",
    spellings: "*",
  },
  "src/utils/tasks/task-line-edit.ts": {
    reason: "Tasks 반복 필드 문법 🔁(정규식)",
    spellings: ["glyph 🔁"],
  },
  "src/utils/tasks/task-timer.ts": {
    reason: "Tasks 타이머 필드 문법 ⏱",
    spellings: ["glyph ⏱"],
  },
  "src/utils/tasks/task-triage.ts": {
    reason: "Tasks 완료·취소 필드 문법(정규식)",
    spellings: ["glyph ✅", "glyph ❌"],
  },
  "src/utils/theme-css/inline-assets.ts": {
    reason: "오류 문구 속 →",
    spellings: ["glyph →"],
  },
};

/**
 * 아직 바꾸지 않은 파일과 그것을 바꾸는 계획 0108 의 태스크. 태스크마다 자기 줄을 먼저 지워
 * red 를 본 뒤 바꾼다. 마지막 태스크가 이 표와 그 분기를 지운다.
 */
const PENDING: Record<string, string> = {
  "src/components/export/ExportDialog.tsx": "Task 7",
  "src/components/export/ExportFormatDropdown.tsx": "Task 7",
  "src/components/journal/CaptureTargetPreview.tsx": "Task 7",
  "src/components/journal/JournalSearchPanel.tsx": "Task 7",
  "src/components/journal/JournalSection.tsx": "Task 7",
  "src/components/journal/MiniCalendar.tsx": "Task 7",
  "src/components/journal/PhotoGalleryPanel.tsx": "Task 7",
  "src/components/layout/StatusBar.tsx": "Task 7",
  "src/components/onboarding/HomeScreen.tsx": "Task 7",
  "src/components/plugins/PluginDetail.tsx": "Task 7",
  "src/components/sidebar/Backlinks.tsx": "Task 8",
  "src/components/sidebar/BookmarkPanel.tsx": "Task 8",
  "src/components/sidebar/CalendarPanel.tsx": "Task 8",
  "src/components/sidebar/FileHistoryView.tsx": "Task 9",
  "src/components/sidebar/FileTree.tsx": "Task 8",
  "src/components/sidebar/FileTreeNode.tsx": "Task 8",
  "src/components/sidebar/FolderAccessError.tsx": "Task 8",
  "src/components/sidebar/GitPanel.tsx": "Task 8",
  "src/components/sidebar/GlobalSearch.tsx": "Task 8",
  "src/components/sidebar/GraphSettingsPanel.tsx": "Task 8",
  "src/components/sidebar/PropertiesPanel.tsx": "Task 9",
  "src/components/sidebar/SkillDependencySection.tsx": "Task 9",
  "src/components/sidebar/SkillLintSection.tsx": "Task 9",
  "src/components/sidebar/SkillLivePreview.tsx": "Task 9",
  "src/components/sidebar/SkillOptimizeSection.tsx": "Task 9",
  "src/components/sidebar/TagPanel.tsx": "Task 8",
  "src/components/sidebar/VersionHistoryPanel.tsx": "Task 9",
  "src/styles/tasks.css": "Task 7",
  "src/utils/date-picker.ts": "Task 7",
};

function allFindings(): Finding[] {
  return [
    ...sourceFiles().flatMap((file) =>
      scanSource(file, readFileSync(path.join(ROOT, file), "utf8")),
    ),
    ...styleFiles().flatMap((file) =>
      scanCss(file, readFileSync(path.join(ROOT, file), "utf8")),
    ),
  ];
}

function exempt(finding: Finding): boolean {
  const entry = ALLOWED[finding.file] as Exemption | undefined;
  if (!entry) return false;
  return entry.spellings === "*" || entry.spellings.includes(finding.spelling);
}

function posix(file: string): string {
  return path.relative(ROOT, file).split(path.sep).join("/");
}

function scanCss(file: string, source: string): Finding[] {
  const findings: Finding[] = [];
  const css = source.replace(/\/\*[\s\S]*?\*\//g, (block) =>
    block.replace(/[^\n]/g, " "),
  );
  for (const m of css.matchAll(CSS_CONTENT)) {
    const line = css.slice(0, m.index).split("\n").length;
    for (const [glyph] of m[1].matchAll(new RegExp(GLYPH.source, "gu"))) {
      findings.push({ file, line, spelling: `css ${glyph}` });
    }
    for (const [escape, hex] of m[1].matchAll(CSS_ESCAPE)) {
      if (GLYPH.test(String.fromCodePoint(parseInt(hex, 16)))) {
        findings.push({ file, line, spelling: `css ${escape.trim()}` });
      }
    }
  }
  return findings;
}

function scanSource(
  file: string,
  source: string,
  catalogs: Catalogs = CATALOGS,
): Finding[] {
  const findings: Finding[] = [];
  const code = stripComments(source);
  const lineAt = (index: number) => code.slice(0, index).split("\n").length;
  code.split("\n").forEach((text, i) => {
    const at = (spelling: string) =>
      findings.push({ file, line: i + 1, spelling });
    for (const [glyph] of text.matchAll(new RegExp(GLYPH.source, "gu"))) {
      at(`glyph ${glyph}`);
    }
    for (const [entity] of text.matchAll(ENTITY)) at(`entity ${entity}`);
    for (const [escape, hex] of text.matchAll(ESCAPE)) {
      if (GLYPH.test(String.fromCodePoint(parseInt(hex, 16)))) {
        at(`escape ${escape}`);
      }
    }
  });
  if (file.endsWith(".tsx")) {
    for (const m of [
      ...code.matchAll(LONE_TEXT),
      ...code.matchAll(LONE_LITERAL),
    ]) {
      findings.push({ file, line: lineAt(m.index), spelling: `lone ${m[1]}` });
    }
  }
  // 파일 전체에서 찾는다 — prettier 는 `t(` 와 키를 두 줄로 나누곤 해서, 줄 단위로 보면
  // 그런 호출을 조용히 놓친다.
  for (const m of code.matchAll(/\bt\(\s*"([^"]+)"/g)) {
    for (const [, catalog] of catalogs) {
      const value = catalog[m[1]];
      if (typeof value === "string" && EDGE_GLYPH.test(value)) {
        findings.push({
          file,
          line: lineAt(m.index),
          spelling: `i18n ${m[1]}`,
        });
        break;
      }
    }
  }
  return findings;
}

function sourceFiles(): string[] {
  return walk(SRC)
    .map(posix)
    .filter(
      (file) =>
        /\.tsx?$/.test(file) &&
        !file.endsWith(".d.ts") &&
        !file.includes("/__tests__/") &&
        !/\.test\.tsx?$/.test(file) &&
        !file.startsWith("src/spike/"),
    )
    .sort();
}

/** 블록 주석과, 줄 머리나 공백 뒤의 `//` 주석을 지운다(줄 번호는 유지). `https://` 는
 *  `:` 뒤라 지우지 않는다 — 문자열 안의 ` //` 는 지워지므로 그 뒤 기호는 못 본다. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
    .replace(/(^|\s)\/\/.*$/gm, (_match, lead: string) => lead);
}

function styleFiles(): string[] {
  return walk(path.join(SRC, "styles"))
    .map(posix)
    .filter((file) => file.endsWith(".css") && !file.includes("/generated/"))
    .sort();
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

describe("UI icons are lucide, not text glyphs — the whole app", () => {
  const findings = allFindings();
  const open = findings.filter((f) => !exempt(f));

  it("walks the whole source tree, not an import closure", () => {
    // 비-공허성: 파생이 조용히 비거나 줄면 아래 단정은 무엇도 보지 않고 통과한다.
    const sources = sourceFiles();
    expect(sources.length).toBeGreaterThan(900);
    expect(sources).toContain("src/components/layout/TabBar.tsx");
    expect(sources).toContain("src/components/settings/SettingsModal.tsx");
    expect(sources).toContain("src/extensions/plugins/fold-decorations.ts");
    expect(sources).toContain("src/utils/date-picker.ts");
    expect(sources.some((f) => f.startsWith("src/spike/"))).toBe(false);
    expect(styleFiles()).toContain("src/styles/editor/base.css");
  });

  it("draws no icon with a text glyph, entity, escape, lone symbol or glyph-edged label", () => {
    const offenders = open
      .filter((f) => !(f.file in PENDING))
      .map((f) => `${f.file}:${f.line} ${f.spelling}`);
    expect(offenders).toEqual([]);
  });

  it("detects each spelling it claims to (positive controls)", () => {
    // 무엇이 이것을 실패시키는가: 탐지식 하나가 망가져 아무것도 잡지 못하면 위 단정은
    // 초록으로 남는다. 바꾸기 전의 실제 철자로 하나씩 확인한다. i18n 은 합성 카탈로그로
    // 본다 — 정규식만 따로 재면 `t("키")` → 값 조회의 연결이 끊겨도 모른다.
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
    const probe = (source: string, file = "probe.tsx") =>
      scanSource(file, source, catalogs).map((f) => f.spelling);
    expect(probe(`<button>{"×"}</button>`)).toEqual(["glyph ×"]);
    expect(probe(`<button>‹</button>`)).toEqual(["glyph ‹"]);
    expect(probe(`<span>&#10003;</span>`)).toEqual(["entity &#10003;"]);
    expect(probe(`{"\\u21BB"}`)).toEqual(["escape \\u21BB"]);
    expect(probe(`<button>+</button>`)).toEqual(["lone +"]);
    expect(probe(`{isError ? "✗" : "!"}`)).toEqual(["glyph ✗", "lone !"]);
    expect(probe(`{"#"}`)).toEqual(["lone #"]);
    expect(probe(`{t("p.before")}`)).toEqual(["i18n p.before"]);
    expect(probe(`{t("p.after")}`)).toEqual(["i18n p.after"]);
    expect(probe(`{t(\n  "p.plus",\n)}`)).toEqual(["i18n p.plus"]);
    expect(
      scanCss("probe.css", `a::before { content: "▶"; }`).map(
        (f) => f.spelling,
      ),
    ).toEqual(["css ▶"]);
    expect(
      scanCss("probe.css", `a::before { content: "\\25B6"; }`).map(
        (f) => f.spelling,
      ),
    ).toEqual(["css \\25B6"]);
    // 음성 대조: 문장 가운데의 기호, 개수 표기, 주석 안의 기호, `.ts` 의 단독 기호(JSX 가
    // 아니다), 문자열 연결의 `#`, 기호 없는 CSS content 는 걸리지 않는다.
    expect(probe(`{t("p.mid")}`)).toEqual([]);
    expect(probe(`{t("p.count")}`)).toEqual([]);
    expect(probe(`// 예전에는 "▾ 내장" 이었다`)).toEqual([]);
    expect(probe(`{/* ⚠ below */}`)).toEqual([]);
    expect(probe(`const sign = { a: "+" };`, "probe.ts")).toEqual([]);
    expect(probe(`{"#".repeat(level)}`)).toEqual([]);
    expect(scanCss("probe.css", `a::before { content: "/ 를 입력"; }`)).toEqual(
      [],
    );
  });

  it("allows only exemptions that are still needed", () => {
    // 허용 목록이 낡으면(파일이 사라지거나 그 철자가 사라지면) 조용히 넓은 구멍으로 남는다.
    // PENDING 도 같다 — 바꾼 파일을 목록에 남겨 두면 그 파일의 재발을 아무도 못 본다.
    const stale: string[] = [];
    for (const [file, entry] of Object.entries(ALLOWED)) {
      const mine = findings.filter((f) => f.file === file);
      if (entry.spellings === "*") {
        if (mine.length === 0) stale.push(`${file} *`);
        continue;
      }
      for (const spelling of entry.spellings) {
        if (!mine.some((f) => f.spelling === spelling)) {
          stale.push(`${file} ${spelling}`);
        }
      }
    }
    for (const file of Object.keys(PENDING)) {
      if (!open.some((f) => f.file === file)) stale.push(`${file} (PENDING)`);
    }
    expect(stale).toEqual([]);
  });
});
