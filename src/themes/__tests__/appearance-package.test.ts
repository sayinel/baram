// §371 6a — "지금 보이는 외관" 을 패키지의 입력으로(스펙 0062 §3). 왕복은 0055 §15.8 이다.
import type { DialValues } from "../../appearance/dials";
import type { InstalledTheme } from "../theme-install";
import type { PackageMeta } from "../theme-package-export";

import { describe, expect, it } from "vitest";

import { DIALS } from "../../appearance/dials";
import { resolveDials } from "../../appearance/merge";
import { themeDialsFor } from "../../appearance/theme-dials";
import { BUILT_IN_THEMES, defaultColorsForBase } from "../../types/theme";
import { appearancePackageInput, nonDefaultDials } from "../appearance-package";
import { validateThemeManifest } from "../theme-manifest";
import { themePackageEntries } from "../theme-package-export";

const META: PackageMeta = {
  author: "someone",
  description: "my look",
  license: "MIT",
  version: "1.0.0",
};

const ALL_VISIBLE = {
  activityBar: true,
  statusBar: true,
  tabBar: true,
} as const;

function args(
  over: Partial<Parameters<typeof appearancePackageInput>[0]> = {},
) {
  return {
    chromeVisible: ALL_VISIBLE,
    customThemes: [],
    effectiveThemeId: "system",
    includeChrome: false,
    installedThemes: {},
    themeDials: {},
    userOverrides: {},
    ...over,
  };
}

function installed(
  id: string,
  over: Partial<InstalledTheme> = {},
): InstalledTheme {
  return {
    checksum: "c".repeat(64),
    consentedAt: "2026-09-01T00:00:00.000Z",
    consentedVersion: "1.0.0",
    id,
    installedAt: "2026-09-01T00:00:00.000Z",
    installPath: `/home/u/.baram/themes/${id}`,
    manifest: {
      author: "a",
      description: "d",
      engines: { baram: ">=0.7.4" },
      id,
      license: "MIT",
      modes: { dark: { css: "dark/theme.css", tokens: "dark/tokens.json" } },
      name: "Ink",
      version: "1.0.0",
    },
    modes: { dark: { colors: defaultColorsForBase("dark"), css: true } },
    ...over,
  };
}

describe("nonDefaultDials", () => {
  it("아무 층도 없으면 비어 있다", () => {
    expect(nonDefaultDials({}, {})).toEqual({});
  });

  // 무엇이 이것을 실패시키는가: 사용자 층만 실으면 입은 테마가 준 값이 빠져, 받는 쪽 화면이 다르다.
  it("테마 층과 사용자 층을 합친 결과에서 고른다", () => {
    expect(
      nonDefaultDials({ editorFontSize: 18 }, { density: "compact" }),
    ).toEqual({
      density: "compact",
      editorFontSize: 18,
    });
  });

  // 무엇이 이것을 실패시키는가: 병합 결과 전부를 쓰면 기본값이 테마 층으로 박혀 희소성이 깨진다(0055 §15.8).
  it("기본값과 같은 값은 명시돼 있어도 싣지 않는다", () => {
    const out = nonDefaultDials(
      { editorFontFamily: "Inter" },
      { editorFontFamily: "" },
    );
    expect(out).not.toHaveProperty("editorFontFamily");
    for (const dial of DIALS) {
      if (dial.id in out) expect(out[dial.id]).not.toBe(dial.defaultValue);
    }
  });
});

describe("appearancePackageInput — 색", () => {
  it("system 이면 기본 라이트 · 다크 팔레트 둘을 싣고 출처 이름이 없다", () => {
    const input = appearancePackageInput(args());
    expect(input.theme.modes.light?.colors).toEqual(
      defaultColorsForBase("light"),
    );
    expect(input.theme.modes.dark?.colors).toEqual(
      defaultColorsForBase("dark"),
    );
    expect(input.sourceName).toBeNull();
  });

  it("내장 테마는 그 테마의 색과 이름이다", () => {
    const nord = BUILT_IN_THEMES.find((t) => t.id === "nord")!;
    const input = appearancePackageInput(args({ effectiveThemeId: "nord" }));
    expect(input.theme.modes).toEqual(nord.modes);
    expect(input.sourceName).toBe(nord.name);
  });

  // 무엇이 이것을 실패시키는가: CSS 캐시를 `lookupThemes` 에 넘기면 설치 테마의 CSS 가 패키지로 새어 나간다(D4).
  it("설치 테마는 CSS 없이 색만이고, 저장 CSS 가 있는 모드를 알려 준다", () => {
    const input = appearancePackageInput(
      args({
        effectiveThemeId: "ink",
        installedThemes: { ink: installed("ink") },
      }),
    );
    expect(input.theme.modes.dark?.colors).toEqual(
      defaultColorsForBase("dark"),
    );
    expect(input.theme.modes.dark?.css).toBeUndefined();
    expect(input.cssModes).toEqual(["dark"]);
    expect(input.sourceName).toBe("Ink");
  });

  it("CSS 가 없는 테마는 cssModes 가 비어 있다", () => {
    expect(
      appearancePackageInput(args({ effectiveThemeId: "nord" })).cssModes,
    ).toEqual([]);
  });
});

describe("appearancePackageInput — 크롬", () => {
  const statusHidden = {
    activityBar: true,
    statusBar: false,
    tabBar: true,
  } as const;

  it("확인란이 꺼져 있으면 숨긴 표면이 있어도 싣지 않는다", () => {
    const input = appearancePackageInput(args({ chromeVisible: statusHidden }));
    expect(input.chrome).toBeUndefined();
    expect(input.hiddenSurfaces).toEqual(["statusBar"]);
  });

  it("켜져 있으면 숨긴 표면만 false 로 싣는다", () => {
    const input = appearancePackageInput(
      args({ chromeVisible: statusHidden, includeChrome: true }),
    );
    expect(input.chrome).toEqual({ statusBar: false });
  });

  it("숨긴 표면이 없으면 켜져 있어도 싣지 않는다", () => {
    const input = appearancePackageInput(args({ includeChrome: true }));
    expect(input.chrome).toBeUndefined();
    expect(input.hiddenSurfaces).toEqual([]);
  });
});

describe("export 왕복 (0055 §15.8)", () => {
  // 무엇이 이것을 실패시키는가: 다이얼 하나를 빠뜨리거나(사용자 층만 싣기), 설치 경로가 모르는 모양으로
  // 쓰면(`rebuildManifest` 가 버린다) 되읽은 병합값이 내보내기 전과 달라진다.
  it("내보낸 매니페스트를 설치 경로가 다시 읽으면 모든 다이얼이 같은 값이다", () => {
    const themeDials: DialValues = {
      density: "compact",
      editorFontFamily: "Inter",
      editorFontSize: 18,
    };
    const userOverrides: DialValues = {
      accentHueShift: 30,
      editorFontFamily: "",
      editorMaxWidth: 0,
    };
    const input = appearancePackageInput(args({ themeDials, userOverrides }));
    const entries = themePackageEntries(
      { ...input.theme, id: "my-look", name: "My Look", source: "custom" },
      META,
      { dials: input.dials, minBaram: ">=0.7.6" },
    );
    const parsed = validateThemeManifest(
      JSON.parse(new TextDecoder().decode(entries["baram-theme.json"])),
    );
    if (!parsed.valid) throw new Error("manifest unexpectedly invalid");
    const reinstalled = themeDialsFor("my-look", {
      "my-look": { ...installed("my-look"), manifest: parsed.manifest },
    });
    const before = resolveDials(themeDials, userOverrides);
    const after = resolveDials(reinstalled, {});
    for (const dial of DIALS) {
      expect(after[dial.id].value, dial.id).toBe(before[dial.id].value);
    }
  });
});
