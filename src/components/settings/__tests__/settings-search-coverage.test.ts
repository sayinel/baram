// 설정 탭의 행마다 설정 검색 레지스트리에 같은 label 키의 항목이 있는지 본다.
//
// 설정 검색(`SettingsModal` 의 `searchResults`)은 화면의 행을 보지 않고 `useSettingsRegistry()`
// 만 훑는다. 행(탭 파일)과 항목(`settings-registry.ts`)은 따로 손으로 적는 두 목록이라, 행만
// 더하면 탭에서는 멀쩡하고 검색에서만 사라진다. Vim 키바인딩(§298)이 그렇게 빠져 있었고,
// 이 테스트가 처음 돌았을 때 같은 방식으로 빠진 행이 에디터·저널·Zettel·AI·언어 탭과 일반 탭의
// 업데이트 섹션에도 있었다. 기존 가드(`settings-tabs.test.tsx`)는 레지스트리 → 탭 방향을 보고,
// 행 → 레지스트리 방향은 외관 다이얼 행에 한해서만 봤다.
//
// 무엇이 이것을 실패시키는가: `<SettingsRow label={t("키")}>` 행을 더하고 레지스트리에 같은
// label 키의 항목을 더하지 않으면, 또는 항목의 label 을 행과 다른 키로 적으면(0055 §4.4) 실패한다.
//
// 코퍼스: `src/components/settings/` 아래 테스트가 아닌 .tsx 의 `SettingsRow` JSX 요소(import 에서
// 다른 이름으로 받거나 `X.SettingsRow` 로 접근해도 센다), 그리고 자기 `label` prop 을 그대로
// `SettingsRow` 의 label 로 넘기는 컴포넌트의 호출부. 그런 컴포넌트는 손으로 적지 않고 AST 에서
// 판정한다(예: `AppearanceDialRow` — 호출부가 `label={t("키")}` 를 준다). label 식의 모든 갈래가
// `t("리터럴")` 이 아니면(삼항의 한쪽만 동적인 경우 포함) 키를 읽을 수 없으므로 조용히 넘기지
// 않고, 그 행을 그리는 함수가 아래 목록에 이유와 함께 있어야 한다.
// ‼️ 경계 — 보지 않는 것: `SettingsRow` JSX 로 그리지 않는 행(VaultTab 의 볼트별 설정, 플러그인
// 설정 탭), `React.createElement(SettingsRow, …)`, import 가 아닌 별칭(`const Row = SettingsRow`)과
// 배럴 재수출 별칭, 전달 컴포넌트를 다른 이름으로 import 한 호출부와 같은 이름의 컴포넌트가 두
// 파일에 따로 있는 경우(전달 컴포넌트는 이름으로만 묶는다).
import { renderHook } from "@testing-library/react";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

import en from "../../../i18n/en.json";
import { useSettingsRegistry } from "../settings-registry";

const SETTINGS_DIR = path.join(process.cwd(), "src/components/settings");

/** 행은 있지만 검색 항목을 두지 않는 label 키 — 이유와 함께. */
const NOT_SEARCHABLE_KEYS: Record<string, string> = {
  "settings.general.journalFlatten": "journalMigrate 와 같은 행이다",
  "settings.general.journalMigrate":
    "journalUseHierarchy 값에 따라 라벨이 바뀌는 일회성 동작 버튼이다. 검색 항목의 라벨은 고정이라 둘 중 하나는 늘 화면에 없는 행을 가리킨다. 이 버튼은 journalUseHierarchy 항목이 데려가는 탭에 있고, 그 항목의 keywords 가 두 라벨의 말을 담는다",
};

/** label 에서 키를 읽을 수 없는 행을 그리는 함수 — 이유와 함께. */
const UNREADABLE_LABEL_FUNCTIONS: Record<string, string> = {
  ExtensionSettingRow:
    "src/extensions/registry.json 의 확장 설정에서 파생되는 행(MarkdownTab)이다. 라벨은 `settings.ext.<key>` 를 거치고, 아직 검색 레지스트리에 올리지 않았다",
};

interface JsxSite {
  file: string;
  fn: string;
  /** 이 파일에서 `SettingsRow` 를 가리키는 태그인가(별칭·네임스페이스 접근 포함). */
  isSettingsRow: boolean;
  /** `label` 속성의 식. 속성이 없거나 값이 없으면 undefined. */
  label: ts.Expression | undefined;
  node: ts.JsxOpeningLikeElement;
  sf: ts.SourceFile;
  tag: string;
}

/** 요소를 감싼 가장 가까운 이름 있는 함수(`function X` 또는 `const X = () =>`). */
function enclosingFunction(
  node: ts.Node,
): ts.FunctionLikeDeclaration | undefined {
  for (let n = node.parent; n; n = n.parent) {
    if (ts.isFunctionDeclaration(n) && n.name) return n;
    if (
      (ts.isArrowFunction(n) || ts.isFunctionExpression(n)) &&
      ts.isVariableDeclaration(n.parent) &&
      ts.isIdentifier(n.parent.name)
    ) {
      return n;
    }
  }
  return undefined;
}

/** `label` 식이 감싼 함수의 첫 매개변수에서 구조 분해한 **`label` prop** 그 자체인가. */
function forwardsOwnLabelProp(site: JsxSite): boolean {
  const param = enclosingFunction(site.node)?.parameters[0]?.name;
  const label = site.label;
  if (!label || !ts.isIdentifier(label) || !param) return false;
  if (!ts.isObjectBindingPattern(param)) return false;
  return param.elements.some((e) => {
    const prop = e.propertyName ?? e.name;
    return (
      ts.isIdentifier(e.name) &&
      e.name.text === label.text &&
      ts.isIdentifier(prop) &&
      prop.text === "label"
    );
  });
}

function functionName(fn: ts.FunctionLikeDeclaration | undefined): string {
  if (!fn) return "<module>";
  if (ts.isFunctionDeclaration(fn)) return fn.name!.text;
  return (fn.parent as ts.VariableDeclaration).name.getText();
}

/** 실제 코퍼스 — `[설정 디렉터리 기준 posix 경로, 소스]`. */
function corpus(): Array<[string, string]> {
  return sourceFiles(SETTINGS_DIR).map((full) => [
    path.posix.join(...path.relative(SETTINGS_DIR, full).split(path.sep)),
    readFileSync(full, "utf8"),
  ]);
}

function jsxSites(files: Array<[string, string]>): JsxSite[] {
  const sites: JsxSite[] = [];
  for (const [file, source] of files) {
    const sf = ts.createSourceFile(
      file,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const rowNames = settingsRowNames(sf);
    const visit = (n: ts.Node): void => {
      if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) {
        const tag = n.tagName.getText(sf);
        const attr = n.attributes.properties.find(
          (p): p is ts.JsxAttribute =>
            ts.isJsxAttribute(p) && p.name.getText(sf) === "label",
        );
        const init = attr?.initializer;
        sites.push({
          file,
          fn: functionName(enclosingFunction(n)),
          isSettingsRow: rowNames.has(tag) || tag.endsWith(".SettingsRow"),
          label:
            init && ts.isJsxExpression(init)
              ? init.expression
              : init && ts.isStringLiteral(init)
                ? init
                : undefined,
          node: n,
          sf,
          tag,
        });
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return sites;
}

/**
 * label 식이 담는 i18n 키. 괄호와 삼항의 두 갈래를 따라 내려가 **모든** 잎이 `t("리터럴")` 일 때만
 * 키 목록을 돌려주고, 한 잎이라도 다른 식이면 undefined(읽을 수 없음)다 — `on ? t("a") : dyn` 에서
 * "a" 만 검사하고 `dyn` 을 조용히 통과시키지 않으려고.
 */
function labelKeys(expr: ts.Expression | undefined): string[] | undefined {
  if (!expr) return undefined;
  if (ts.isParenthesizedExpression(expr)) return labelKeys(expr.expression);
  if (ts.isConditionalExpression(expr)) {
    const whenTrue = labelKeys(expr.whenTrue);
    const whenFalse = labelKeys(expr.whenFalse);
    return whenTrue && whenFalse ? [...whenTrue, ...whenFalse] : undefined;
  }
  const arg = ts.isCallExpression(expr) ? expr.arguments[0] : undefined;
  if (
    ts.isCallExpression(expr) &&
    ts.isIdentifier(expr.expression) &&
    expr.expression.text === "t" &&
    arg &&
    ts.isStringLiteralLike(arg)
  ) {
    return [arg.text];
  }
  return undefined;
}

function registryLabels(): Set<string> {
  const { result } = renderHook(() => useSettingsRegistry());
  return new Set(result.current.map((s) => s.label));
}

/**
 * 행으로 셀 요소와, 판정해 낸 전달 컴포넌트. `SettingsRow` 에서 시작해 label prop 을 그대로
 * 넘기는 컴포넌트를 행 태그에 더하고, 더할 것이 없을 때까지 반복한다(전달이 두 겹이어도 잡는다).
 */
function rowSites(files: Array<[string, string]>): {
  forwarders: string[];
  rows: JsxSite[];
} {
  const sites = jsxSites(files);
  const forwarders = new Set<string>();
  const forwarding = new Set<JsxSite>();
  const isRow = (site: JsxSite): boolean =>
    site.isSettingsRow || forwarders.has(site.tag);
  for (let grew = true; grew;) {
    grew = false;
    for (const site of sites) {
      if (!isRow(site) || forwarding.has(site)) continue;
      if (forwardsOwnLabelProp(site)) {
        forwarding.add(site);
        if (!forwarders.has(site.fn)) {
          forwarders.add(site.fn);
          grew = true;
        }
      }
    }
  }
  return {
    forwarders: [...forwarders].sort(),
    rows: sites.filter((s) => !forwarding.has(s) && isRow(s)),
  };
}

/** 이 파일에서 `SettingsRow` 를 가리키는 로컬 이름 — 이름 그대로와 `import { SettingsRow as X }`. */
function settingsRowNames(sf: ts.SourceFile): Set<string> {
  const names = new Set(["SettingsRow"]);
  for (const statement of sf.statements) {
    const bindings = ts.isImportDeclaration(statement)
      ? statement.importClause?.namedBindings
      : undefined;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const el of bindings.elements) {
      if ((el.propertyName ?? el.name).text === "SettingsRow") {
        names.add(el.name.text);
      }
    }
  }
  return names;
}

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "__tests__") found.push(...sourceFiles(full));
    } else if (entry.name.endsWith(".tsx")) {
      found.push(full);
    }
  }
  return found;
}

describe("settings search covers every settings row", () => {
  const { forwarders, rows } = rowSites(corpus());
  const keyed = rows.flatMap((row) =>
    (labelKeys(row.label) ?? []).map((key) => ({ key, row })),
  );
  const unreadable = rows.filter((row) => labelKeys(row.label) === undefined);

  it("finds the rows it claims to scan — non-vacuity control", () => {
    // 스캐너가 아무것도 못 찾으면 아래 단정들은 모두 공허하게 초록이다.
    const keys = new Set(keyed.map((k) => k.key));
    expect(keys).toContain("settings.editor.autoPairBrackets"); // SettingsRow 직접
    expect(keys).toContain("settings.editor.editorLineBreak"); // AppearanceDialRow 경유
    expect(keys).toContain("settings.ai.chatModel"); // TaskModelSelector 경유
    expect(keys).toContain("settings.general.journalMigrate"); // 삼항의 두 갈래
    expect(forwarders).toEqual(
      expect.arrayContaining(["AppearanceDialRow", "TaskModelSelector"]),
    );
  });

  it("gives every row a registry entry with the row's own label key", () => {
    const labels = registryLabels();
    const missing = keyed
      .filter(({ key }) => !labels.has(key) && !(key in NOT_SEARCHABLE_KEYS))
      .map(({ key, row }) => `${row.file} ${key}`);
    expect(missing).toEqual([]);
  });

  it("names the function behind every row whose label it cannot read", () => {
    const unexplained = unreadable
      .filter((row) => !(row.fn in UNREADABLE_LABEL_FUNCTIONS))
      .map(
        (row) =>
          `${row.file} ${row.fn}: label={${row.label?.getText(row.sf) ?? ""}}`,
      );
    expect(unexplained).toEqual([]);
  });

  it("keeps both exemption lists pointed at rows that still exist", () => {
    // 행이 사라지거나 검색에 올라간 뒤에도 면제가 남으면, 같은 이름의 다음 행이 이유 없이 면제된다.
    const labels = registryLabels();
    const keys = new Set(keyed.map((k) => k.key));
    for (const key of Object.keys(NOT_SEARCHABLE_KEYS)) {
      expect(keys, key).toContain(key);
      expect(labels.has(key), `${key} is exempt but registered`).toBe(false);
    }
    const unreadableFns = new Set(unreadable.map((row) => row.fn));
    for (const fn of Object.keys(UNREADABLE_LABEL_FUNCTIONS)) {
      expect(unreadableFns, fn).toContain(fn);
    }
  });
});

// 실제 코퍼스에는 별칭 import·네임스페이스 접근·한쪽만 동적인 삼항·label 이 아닌 prop 전달이
// 하나도 없다. 그 판정 경로가 깨져도 위 단정은 초록이므로, 합성 소스로 경로마다 고정한다.
describe("row scanner on synthetic sources", () => {
  const scan = (source: string) => {
    const { forwarders, rows } = rowSites([["synthetic.tsx", source]]);
    return {
      forwarders,
      keys: rows.flatMap((row) => labelKeys(row.label) ?? []),
      unreadable: rows
        .filter((row) => labelKeys(row.label) === undefined)
        .map((row) => row.fn),
    };
  };

  it("counts a row imported under another name", () => {
    const { keys } = scan(`
      import { SettingsRow as Row } from "./settings-shared";
      function A() { return <Row label={t("k.alias")} />; }`);
    expect(keys).toEqual(["k.alias"]);
  });

  it("counts a row reached through a namespace import", () => {
    const { keys } = scan(`
      import * as S from "./settings-shared";
      function A() { return <S.SettingsRow label={t("k.ns")} />; }`);
    expect(keys).toEqual(["k.ns"]);
  });

  it("reads both branches of a ternary, and refuses one that is not t(literal)", () => {
    expect(
      scan(
        `function A() { return <SettingsRow label={on ? t("k.a") : t("k.b")} />; }`,
      ).keys,
    ).toEqual(["k.a", "k.b"]);
    const partial = scan(
      `function A() { return <SettingsRow label={on ? t("k.a") : dyn} />; }`,
    );
    expect(partial.keys).toEqual([]);
    expect(partial.unreadable).toEqual(["A"]);
  });

  it("follows a component that forwards its own label prop, through two layers", () => {
    const { forwarders, keys } = scan(`
      function F({ label }) { return <SettingsRow label={label} />; }
      function G({ label }) { return <F label={label} />; }
      function B() { return <G label={t("k.g")} />; }`);
    expect(forwarders).toEqual(["F", "G"]);
    expect(keys).toEqual(["k.g"]);
  });

  it("does not treat a component that renders a different prop as a forwarder", () => {
    const { forwarders, keys, unreadable } = scan(`
      function I({ label, title }) { return <SettingsRow label={title} />; }
      function B() { return <I label={t("k.i")} />; }`);
    expect(forwarders).toEqual([]);
    expect(keys).toEqual([]);
    expect(unreadable).toEqual(["I"]);
  });
});

describe("settings search results", () => {
  it("fills every {value} placeholder in a description with a real value", () => {
    // `SettingsSearchResults` 는 설명의 `{value}` 를 `String(control.storeSelector())` 로 채운다.
    // `NAVIGATE_CONTROL` 의 selector 는 null 이라, 그런 설명에 쓰면 화면에 "null" 이 찍힌다.
    const { result } = renderHook(() => useSettingsRegistry());
    const EN = en as Record<string, string>;
    const withValue = result.current.filter((s) =>
      EN[s.description]?.includes("{value}"),
    );
    // 비공허성 — 계획 0107 §365 이 `codeFontSize`·`codeLineHeight`(§7.1, `{value}` 를 뺀 값 칸으로
    // 옮겼다, P9) 를 이 증인에서 빼앗아 `tasksArchiveAfterDays` 로 옮겼다(`navigateControlShowing`
    // 을 여전히 쓰는 항목, `settings-registry.ts` 실측).
    expect(withValue.map((s) => s.id)).toContain("tasksArchiveAfterDays");
    const empty = withValue
      .filter((s) => s.control.storeSelector() == null)
      .map((s) => s.id);
    expect(empty).toEqual([]);
  });
});
