// §363 — `themePackageEntries` 라운드트립. 이 파일이 보는 것은 **빌더에 넘어가는 엔트리
// 맵**뿐이다 — 프런트에 zip 리더가 없으므로 zip 바이트 자체의 왕복은 Rust in-file 테스트가
// 본다(`plugin::archive`의 `build_zip_bytes_round_trips_every_entry`). 두 쪽이 각자 볼 수
// 있는 것을 본다.
import type { ThemeDef } from "../../types/theme";
import type { PackageMeta } from "../theme-package-export";

import { describe, expect, it } from "vitest";

import { defaultColorsForBase } from "../../types/theme";
import { validateThemeManifest } from "../theme-manifest";
import { themePackageEntries } from "../theme-package-export";

const META: PackageMeta = {
  author: "someone",
  description: "a theme",
  license: "Apache-2.0",
  version: "1.0.0",
};

function decodeManifest(entries: Record<string, Uint8Array>): unknown {
  return JSON.parse(new TextDecoder().decode(entries["baram-theme.json"]));
}

/** 라이트+다크 쌍을 가진 테마 — 설치 테마가 실제로 들고 오는 모양(§357). */
function pairedTheme(): ThemeDef {
  return {
    id: "custom-test-theme",
    name: "Paired Test Theme",
    source: "custom",
    modes: {
      light: { colors: defaultColorsForBase("light") },
      dark: { colors: defaultColorsForBase("dark") },
    },
  };
}

describe("themePackageEntries", () => {
  it("엔트리 맵의 baram-theme.json 이 설치 검증을 통과한다", () => {
    const entries = themePackageEntries(pairedTheme(), META);
    // ‼️ 내보낸 패키지는 이 앱이 설치할 수 있어야 한다. 그 왕복이 이 기능의 전부다.
    expect(validateThemeManifest(decodeManifest(entries)).valid).toBe(true);
  });

  it("선언한 모드마다 tokens.json 이 있고, 매니페스트가 그 경로를 가리킨다", () => {
    const entries = themePackageEntries(pairedTheme(), META);
    expect(Object.keys(entries)).toEqual(
      expect.arrayContaining(["light/tokens.json", "dark/tokens.json"]),
    );
    const result = validateThemeManifest(decodeManifest(entries));
    if (!result.valid) throw new Error("manifest unexpectedly invalid");
    expect(result.manifest.modes.light?.tokens).toBe("light/tokens.json");
    expect(result.manifest.modes.dark?.tokens).toBe("dark/tokens.json");
  });

  it("엔트리 맵은 정확히 매니페스트 + 선언한 모드 수만큼만 갖는다 (키 하나도 더도 덜도 아니다)", () => {
    const entries = themePackageEntries(pairedTheme(), META);
    expect(Object.keys(entries).sort()).toEqual(
      ["baram-theme.json", "dark/tokens.json", "light/tokens.json"].sort(),
    );
  });

  it("매니페스트는 zip 루트에 있다 — 어떤 접두사도 붙지 않는다", () => {
    // ‼️ install.rs 의 `dir.join("baram-theme.json")` 이 스테이징 루트를 그대로 쓰고,
    // 추출이 최상위 폴더를 벗기지 않는다 — "baram-theme.json" 을 포함하는 키가 아니라
    // 정확히 그 이름의 키여야 한다. `my-theme/baram-theme.json` 은 설치되지 않는다.
    const entries = themePackageEntries(pairedTheme(), META);
    expect("baram-theme.json" in entries).toBe(true);
    expect(
      Object.keys(entries).some(
        (k) => /baram-theme\.json$/.test(k) && k !== "baram-theme.json",
      ),
    ).toBe(false);
  });

  it("한 모드짜리 테마는 그 모드의 tokens.json만 담는다", () => {
    const theme: ThemeDef = {
      id: "custom-light-only",
      name: "Light Only",
      source: "custom",
      modes: { light: { colors: defaultColorsForBase("light") } },
    };
    const entries = themePackageEntries(theme, META);
    expect(Object.keys(entries).sort()).toEqual(
      ["baram-theme.json", "light/tokens.json"].sort(),
    );
  });

  it("css만 있고 colors가 없는 모드는 담지 않는다 (§358 — 이 함수는 CSS를 다루지 않는다)", () => {
    const theme: ThemeDef = {
      id: "custom-css-only",
      name: "CSS Only Dark",
      source: "custom",
      modes: {
        light: { colors: defaultColorsForBase("light") },
        dark: { css: "body { color: red; }" },
      },
    };
    const entries = themePackageEntries(theme, META);
    expect(Object.keys(entries).sort()).toEqual(
      ["baram-theme.json", "light/tokens.json"].sort(),
    );
  });

  it("메타 필드가 하나라도 비면 설치 검증에 실패한다 (이 기능의 유일한 실패 모드)", () => {
    const entries = themePackageEntries(pairedTheme(), {
      ...META,
      author: "",
    });
    expect(validateThemeManifest(decodeManifest(entries)).valid).toBe(false);
  });

  it("engines.baram이 빠지면 설치 검증에 실패한다 (왕복 단언이 공허하지 않다는 증거)", () => {
    // ‼️ Step 6 뮤테이션 ①의 자동화된 버전: 매니페스트에서 engines.baram이 빠진 문서를
    // 직접 만들어, 첫 테스트가 실제로 그 필드를 요구하는지 확인한다 — 소스를 고치지
    // 않고도, 이 테스트 스위트 자체가 그 필드를 요구한다는 증거가 된다.
    const entries = themePackageEntries(pairedTheme(), META);
    const manifest = decodeManifest(entries) as Record<string, unknown>;
    delete (manifest as { engines?: unknown }).engines;
    expect(validateThemeManifest(manifest).valid).toBe(false);
  });
});
