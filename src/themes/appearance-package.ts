// §371 6a — "지금 보이는 외관" 을 테마 패키지의 입력으로(스펙 0062 §3). 순수 함수만 둔다: 스토어는 부르는
// 쪽(`components/settings/appearance-export.tsx`)이 읽어 넘긴다 — `src/themes/*.ts` 는 스토어를
// import 하지 않는다(`stores/ui/chrome-proposal.ts` 머리주석의 전수).
//
// 요약 화면과 파일에 쓰는 값이 **같은** 함수를 거친다 — 화면이 보인 것과 다른 것이 파일로 나가지 않게.
import type { DialValues } from "../appearance/dials";
import type { ThemeDef, ThemeMode } from "../types/theme";
import type { InstalledTheme } from "./theme-install";
import type { ThemeManifest } from "./theme-manifest";

import { DIALS } from "../appearance/dials";
import { resolveDials } from "../appearance/merge";
import {
  defaultColorsForBase,
  findThemeById,
  THEME_MODES,
} from "../types/theme";
import { lookupThemes } from "./installed-theme-defs";

export interface AppearancePackageInput {
  /** 확인란이 켜졌고 숨긴 표면이 있을 때만(스펙 0062 D3). */
  readonly chrome: ChromeProposal | undefined;
  /** 입은 설치 테마가 **저장한** CSS 가 있는 모드 — 실리지 않는다는 안내용(D4, 계획 0110 P1). */
  readonly cssModes: readonly ThemeMode[];
  readonly dials: DialValues;
  /** 지금 숨긴 표면 — 확인란 옆에 적고, 비면 확인란을 끈다. */
  readonly hiddenSurfaces: readonly (keyof ChromeProposal)[];
  /** 색의 출처 이름. `system`(또는 찾지 못한 id)이면 `null` — 화면이 "기본 팔레트" 로 적는다. */
  readonly sourceName: null | string;
  /** 색을 실을 테마. id · name · source 는 부르는 쪽이 패키지 값으로 바꾼다. */
  readonly theme: ThemeDef;
}

export type ChromeProposal = NonNullable<ThemeManifest["chrome"]>;

/** 크롬 표면마다 지금 보이는가 — UI 스토어의 세 `…Visible` 필드. */
export type ChromeVisibility = Readonly<Record<keyof ChromeProposal, boolean>>;

export function appearancePackageInput(args: {
  chromeVisible: ChromeVisibility;
  customThemes: ThemeDef[];
  effectiveThemeId: string;
  includeChrome: boolean;
  installedThemes: Record<string, InstalledTheme>;
  themeDials: DialValues;
  userOverrides: DialValues;
}): AppearancePackageInput {
  // ‼️ CSS 캐시 인자 없이 — 편집기(`ThemeEditor.tsx` 의 `resolvedTheme`)와 같다. 설치 테마의 CSS 를 다른
  // 경로로 옮기지 않는다는 성질에 §360 의 보안 논거가 기댄다(`theme-package-export.ts` 머리주석).
  const found = findThemeById(
    args.effectiveThemeId,
    lookupThemes(args.customThemes, args.installedThemes),
  );
  const theme: ThemeDef = found ?? {
    id: "system",
    modes: {
      dark: { colors: defaultColorsForBase("dark") },
      light: { colors: defaultColorsForBase("light") },
    },
    name: "system",
    source: "custom",
  };
  const installed = args.installedThemes[args.effectiveThemeId];
  const cssModes = THEME_MODES.filter(
    (mode) => installed?.modes[mode]?.css === true,
  );
  const hiddenSurfaces = (
    Object.keys(args.chromeVisible) as (keyof ChromeProposal)[]
  ).filter((surface) => !args.chromeVisible[surface]);
  const chrome =
    args.includeChrome && hiddenSurfaces.length > 0
      ? (Object.fromEntries(
          hiddenSurfaces.map((s) => [s, false]),
        ) as ChromeProposal)
      : undefined;
  return {
    chrome,
    cssModes,
    dials: nonDefaultDials(args.themeDials, args.userOverrides),
    hiddenSurfaces,
    sourceName: found?.name ?? null,
    theme,
  };
}

/**
 * 병합값 가운데 **다이얼 기본값과 다른 것**(스펙 0062 D2).
 *
 * 받는 쪽에서 이 값들이 테마 층이 된다. 기본값과 같은 키는 실어도 결과가 같고, 병합 결과 전부를 쓰면
 * 기본값이 테마 층에 박혀 희소성이 깨진다(0055 §15.8). 사용자 층에 기본값이 **명시된** 키도 빠진다 —
 * 예: 테마 서체를 이기려고 비운 서체 `""`(스펙 0060 §7.1). 받는 쪽에는 그 테마 서체가 없다.
 */
export function nonDefaultDials(
  theme: DialValues,
  user: DialValues,
): DialValues {
  const resolved = resolveDials(theme, user);
  const out: DialValues = {};
  for (const dial of DIALS) {
    const { value } = resolved[dial.id];
    if (value !== dial.defaultValue) out[dial.id] = value;
  }
  return out;
}
