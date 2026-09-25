// §365 다이얼 2a·2b — 배경 대비(스펙 0059 §3 · §9.1).
import { describe, expect, it } from "vitest";

import { DEFAULT_DARK_PALETTE } from "../../types/generated/palette-dark";
import { DEFAULT_LIGHT_PALETTE } from "../../types/generated/palette-light";
import { BG_ROLE_KEYS } from "../background-contrast";
import { DIALS } from "../dials";

type Id = "backgroundContrastDark" | "backgroundContrastLight";

const dial = (id: Id) => {
  const found = DIALS.find((d) => d.id === id);
  if (found?.kind !== "enum") throw new Error(`${id} is not an enum dial`);
  return found;
};

const LIGHT = { mode: "light", seeds: DEFAULT_LIGHT_PALETTE } as const;
const DARK = { mode: "dark", seeds: DEFAULT_DARK_PALETTE } as const;

// 스펙 0059 §3.2 의 표를 기본 팔레트 값으로 옮겨 적었다(`palette-light.ts`: bg-default
// #ffffff · bg-panel #f1f3f5, `palette-dark.ts`: #1a1a2e · #0f172a). 무엇이 이것을
// 실패시키는가: 표의 칸 하나를 바꾸면 — 특히 채움이 받는 시드를 바꾸면(`flat` 에서
// bg-panel 대신 bg-default) 채움이 크롬과 같은 색이 되어 활성 파일 강조가 사라진다.
const LIGHT_FLAT = {
  "--color-bg-bar": "#ffffff",
  "--color-bg-chrome-fill": "#f1f3f5",
  "--color-bg-panel": "#ffffff",
};
const LIGHT_WHITE = {
  "--color-bg-bar": "#ffffff",
  "--color-bg-chrome-fill": "#f1f3f5",
  "--color-bg-default": "#ffffff",
  "--color-bg-panel": "#ffffff",
  "--color-editor-bg": "#ffffff",
};
const DARK_FLAT = {
  "--color-bg-bar": "#1a1a2e",
  "--color-bg-chrome-fill": "#0f172a",
  "--color-bg-panel": "#1a1a2e",
};
const DARK_BLACK = {
  "--color-bg-bar": "#000000",
  "--color-bg-chrome-fill": "#1a1a2e",
  "--color-bg-default": "#000000",
  "--color-bg-panel": "#000000",
  "--color-editor-bg": "#000000",
};

describe("§365 배경 대비 — 재배선 표", () => {
  it.each([
    ["backgroundContrastLight", "flat", LIGHT, LIGHT_FLAT],
    ["backgroundContrastLight", "white", LIGHT, LIGHT_WHITE],
    ["backgroundContrastDark", "flat", DARK, DARK_FLAT],
    ["backgroundContrastDark", "black", DARK, DARK_BLACK],
  ] as const)("%s = %s 는 스펙의 표와 같다", (id, option, ctx, table) => {
    expect(dial(id).toVars(option, ctx)).toEqual(table);
  });

  // 희소성(§364.2). 무엇이 이것을 실패시키는가: `default` 에서 시드를 되써 인라인에
  // 박으면 `system` 의 미디어 쿼리를 누른다(`apply.ts` 머리주석).
  it("default 는 빈 맵이다", () => {
    expect(dial("backgroundContrastLight").toVars("default", LIGHT)).toEqual(
      {},
    );
    expect(dial("backgroundContrastDark").toVars("default", DARK)).toEqual({});
  });
});

describe("§365 배경 대비 — 모드", () => {
  // 무엇이 이것을 실패시키는가: 모드 판정을 빼면 라이트 다이얼의 `white` 가 다크 화면에
  // 흰 크롬을 박는다. 긍정 짝은 위 표 — 제 모드에서는 값이 나온다.
  it("제 모드가 아니면 어떤 값도 빈 맵이다", () => {
    for (const option of dial("backgroundContrastLight").options) {
      expect(
        dial("backgroundContrastLight").toVars(option, DARK),
        option,
      ).toEqual({});
    }
    for (const option of dial("backgroundContrastDark").options) {
      expect(
        dial("backgroundContrastDark").toVars(option, LIGHT),
        option,
      ).toEqual({});
    }
  });

  // 두 다이얼의 값 집합이 갈라져 있다는 것이 D1 의 요지다 — 라이트 다이얼에 `black` 을
  // 저장할 길이 없어야 "골랐는데 안 바뀜" 이 구조적으로 막힌다.
  it("반대 모드의 값은 parse 가 받지 않는다", () => {
    expect(dial("backgroundContrastLight").parse("black")).toBeUndefined();
    expect(dial("backgroundContrastDark").parse("white")).toBeUndefined();
    expect(dial("backgroundContrastLight").parse("white")).toBe("white");
    expect(dial("backgroundContrastDark").parse("black")).toBe("black");
  });
});

describe("§365 배경 대비 — 시드가 없을 때", () => {
  // 무엇이 이것을 실패시키는가: 없는 시드를 `undefined` 로 옮겨 적거나 추측으로 채우면.
  // 긍정 짝: 시드가 필요 없는 네 키는 그대로 나온다.
  it("white 는 시드 없이도 표면 넷을 내고 채움만 뺀다", () => {
    expect(
      dial("backgroundContrastLight").toVars("white", {
        mode: "light",
        seeds: {},
      }),
    ).toEqual({
      "--color-bg-bar": "#ffffff",
      "--color-bg-default": "#ffffff",
      "--color-bg-panel": "#ffffff",
      "--color-editor-bg": "#ffffff",
    });
  });

  it("flat 은 본문 시드가 없으면 크롬·바를, 크롬 시드가 없으면 채움을 뺀다", () => {
    expect(
      dial("backgroundContrastLight").toVars("flat", {
        mode: "light",
        seeds: { "--color-bg-default": "#fdf6e3" },
      }),
    ).toEqual({ "--color-bg-bar": "#fdf6e3", "--color-bg-panel": "#fdf6e3" });
    expect(
      dial("backgroundContrastLight").toVars("flat", {
        mode: "light",
        seeds: { "--color-bg-panel": "#eee8d5" },
      }),
    ).toEqual({ "--color-bg-chrome-fill": "#eee8d5" });
  });
});

describe("§365 배경 대비 — 구조", () => {
  // vars 는 이 다이얼이 어떤 값에서든 쓸 수 있는 키 전부다(`DialBase.vars`). 역할 토큰이
  // 빠지면 `dial-kinds.test.ts` 의 "clearThemeVars 가 지운다" 검사가 그 둘을 보지 못한다.
  it("vars 는 다섯 키이고 역할 토큰 둘을 담는다", () => {
    for (const id of [
      "backgroundContrastLight",
      "backgroundContrastDark",
    ] as const) {
      expect([...dial(id).vars].sort()).toEqual([
        "--color-bg-bar",
        "--color-bg-chrome-fill",
        "--color-bg-default",
        "--color-bg-panel",
        "--color-editor-bg",
      ]);
      for (const key of BG_ROLE_KEYS) expect(dial(id).vars).toContain(key);
    }
  });

  it("채널은 color 다 — --color-* 의 작성자는 테마 이펙트 하나다", () => {
    expect(dial("backgroundContrastLight").channel).toBe("color");
    expect(dial("backgroundContrastDark").channel).toBe("color");
  });
});
