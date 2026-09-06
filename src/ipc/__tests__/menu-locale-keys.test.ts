// §4.2 네이티브 메뉴는 Rust가 만든 영어 리터럴로 뜬 뒤 `menu-locale.ts`가 갈아끼운다.
// 매핑에 있는데 카탈로그에 없는 키는 t()가 키 문자열 자체를 반환하므로, 메뉴에
// "menu.help.homepage"가 그대로 뜬다. 그 창은 사용자가 보는 화면이다.
import { describe, expect, it } from "vitest";

import en from "../../i18n/en.json";
import ko from "../../i18n/ko.json";
import { MENU_I18N_MAP } from "../menu-locale";

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
});
