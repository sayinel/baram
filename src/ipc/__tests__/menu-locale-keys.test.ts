// §4.2 네이티브 메뉴는 Rust가 만든 영어 리터럴로 뜬 뒤 `menu-locale.ts`가 갈아끼운다.
// 매핑에 있는데 카탈로그에 없는 키는 t()가 키 문자열 자체를 반환하므로, 메뉴에
// "menu.help.homepage"가 그대로 뜬다. 그 창은 사용자가 보는 화면이다.
//
// 갈아끼우기가 **닿지 않는** 경우도 같은 화면을 만든다. `update_menu_locale`(lib.rs)은 세 맵을
// 각각 `if let Some(...)`으로만 보고 else가 없다 — 어느 맵에도 없는 id로 보낸 라벨은 경고 없이
// 버려진다. 그래서 이 파일은 **세 가지**를 본다: 매핑이 있는가, 리터럴이 en.json과 같은가,
// 그리고 만든 항목이 실제로 등록됐는가.
//
// ‼️ 실측으로 셋 다 필요했다. 처음에는 매핑과 리터럴만 봤고, 그 상태로 **결함 2건이 통과**했다:
//    `view_inline_ai`는 만들어 보여 주면서 `menu_items`에 등록되지 않아 한국어에서도 "Inline AI"
//    였고, `Workspace` 서브메뉴 리터럴은 en/ko가 Perspective/화면구성으로 바뀐 뒤에도 낡아
//    있었다(서브메뉴는 `.id()`가 없어 항목 파싱에서 빠진다).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import en from "../../i18n/en.json";
import ko from "../../i18n/ko.json";
import { MENU_I18N_MAP } from "../menu-locale";

const MENU_RS = "src-tauri/src/menu.rs";
const SOURCE = readFileSync(MENU_RS, "utf8");
const EN = en as Record<string, string>;

/** 이 파일이 알아보는 빌더. 모르는 종류가 생기면 파싱이 조용히 그것을 빼먹는다. */
const KNOWN_BUILDERS = [
  "MenuItemBuilder",
  "CheckMenuItemBuilder",
  "SubmenuBuilder",
];

function matches(re: RegExp): string[] {
  return [...SOURCE.matchAll(re)].map((m) => m[1]);
}

/** 등록표에 들어간 id — 이 셋에 없으면 로케일 스왑이 그 항목에 닿지 않는다. */
function registered(table: string): Set<string> {
  return new Set(matches(new RegExp(`${table}\\.insert\\("([^"]+)"`, "g")));
}

/**
 * `(id, label)` — `.id(…)`를 가진 네이티브 메뉴 항목 전부.
 *
 * 문장 단위로 파싱한다(`let x = …Builder::new(…)…;`). 리터럴에서 앞으로 `.id(`를 찾으면
 * 서브메뉴 라벨(서브메뉴에는 id가 없다)과 **그 다음 항목의 id**를 짝지어 거짓 불일치 8건을
 * 만든다 — 처음 그렇게 짰다.
 */
function itemLabels(): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const stmt of SOURCE.matchAll(
    /let\s+\w+\s*=\s*(?:MenuItem|CheckMenuItem)Builder::new\(([\s\S]*?);/g,
  )) {
    const label = /^\s*"((?:[^"\\]|\\.)*)"/.exec(stmt[1]);
    const id = /\.id\("([^"]+)"\)/.exec(stmt[1]);
    if (label && id) out.push([id[1], label[1]]);
  }
  return out;
}

/**
 * `(id, label)` — 서브메뉴. id는 빌더가 아니라 `menu_subs.insert`가 준다.
 *
 * 그래서 항목 파싱에서 구조적으로 빠지고, 그 사각지대에 `Workspace` 불일치가 살아 있었다.
 */
function submenuLabels(): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const m of SOURCE.matchAll(
    /let\s+(\w+)\s*=\s*SubmenuBuilder::new\(app,\s*"((?:[^"\\]|\\.)*)"/g,
  )) {
    const [, variable, label] = m;
    const id = new RegExp(
      `menu_subs\\.insert\\("([^"]+)"\\.into\\(\\),\\s*${variable}\\b`,
    ).exec(SOURCE);
    if (id) out.push([id[1], label]);
  }
  return out;
}

describe("MENU_I18N_MAP", () => {
  it("maps every menu id to a key both catalogs define", () => {
    const values = Object.values(MENU_I18N_MAP);
    expect(values.length).toBeGreaterThan(0);
    expect(values.filter((k) => !(k in en))).toEqual([]);
    expect(values.filter((k) => !(k in ko))).toEqual([]);
  });

  it("covers the Help menu's homepage item", () => {
    expect(MENU_I18N_MAP.help_homepage).toBe("menu.help.homepage");
  });

  it("has no mapping for an id menu.rs never uses", () => {
    // A dead mapping is only cosmetic — `update_menu_locale` skips unknown ids — but it is
    // also the signature of a renamed id whose mapping was left behind.
    const unused = Object.keys(MENU_I18N_MAP).filter(
      (id) => !SOURCE.includes(`"${id}"`),
    );
    expect(unused).toEqual([]);
  });
});

describe("menu.rs", () => {
  const items = itemLabels();
  const submenus = submenuLabels();

  // Fail-closed, and DERIVED rather than a floor. A floor of "at least 70" leaves slack: one
  // or two silently dropped statements stay green, and the failure message then says "the
  // parse broke" when it may be a real removal. Comparing the statement parse against every
  // `.id("…")` literal in the same file has zero slack and updates itself.
  it("parses every id in the file", () => {
    // Every `.id("…")` in this file belongs to an item statement — submenus carry none — so
    // the item parse must reproduce the literal set exactly.
    const parsed = items.map(([id]) => id);
    const literals = new Set(matches(/\.id\("([^"]+)"\)/g));
    expect(literals.size).toBeGreaterThan(60);
    expect([...literals].filter((id) => !parsed.includes(id)).sort()).toEqual(
      [],
    );
  });

  it("builds nothing this file cannot parse", () => {
    // The parse names its builder types. A future `IconMenuItemBuilder` would be invisible to
    // every assertion here — including the derived one above, since its `.id()` would have no
    // statement to belong to. Catch it at the import line instead.
    const imported = /use tauri::menu::\{([^}]*)\}/.exec(SOURCE)?.[1] ?? "";
    const builders = imported
      .split(",")
      .map((name) => name.trim())
      .filter((name) => name.endsWith("Builder") && name !== "MenuBuilder");
    expect(builders.length).toBeGreaterThan(0);
    expect(builders.filter((name) => !KNOWN_BUILDERS.includes(name))).toEqual(
      [],
    );
  });

  it("registers every item it builds, so the locale swap reaches it", () => {
    // `update_menu_locale` looks the id up in three maps and does nothing when all three miss.
    // An unregistered item therefore keeps its English literal in every locale, silently.
    const inTable = registered("menu_items");
    expect(inTable.size).toBeGreaterThan(60);
    expect(items.filter(([id]) => !inTable.has(id)).map(([id]) => id)).toEqual(
      [],
    );
  });

  it("spells every item the way en.json does", () => {
    const wrong = [...items, ...submenus]
      .filter(([id]) => id in MENU_I18N_MAP)
      .filter(([id, label]) => EN[MENU_I18N_MAP[id]] !== label)
      .map(
        ([id, label]) =>
          `${id}: rust "${label}" ≠ en "${EN[MENU_I18N_MAP[id]]}"`,
      );
    expect(wrong).toEqual([]);
  });

  it("has a mapping for every item and submenu it builds", () => {
    expect(items.filter(([id]) => !(id in MENU_I18N_MAP))).toEqual([]);
    expect(submenus.filter(([id]) => !(id in MENU_I18N_MAP))).toEqual([]);
  });

  it("finds the submenus, which carry no id of their own", () => {
    // Named canaries: the submenu parse joins two regexes across the file, and if either
    // stops matching the comparison above goes quiet instead of failing.
    expect(submenus.length).toBe(registered("menu_subs").size);
    expect(new Map(submenus).get("menu_workspace")).toBe("Perspective");
    expect(new Map(items).get("file_save")).toBe("Save");
  });
});
