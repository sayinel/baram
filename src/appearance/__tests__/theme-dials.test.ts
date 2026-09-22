// §366 — 스펙 §15 검증 2(출처 정확성) · 3(되돌리기 왕복)이 0093 에서 ❌ 로 남은
// 이유는 병합기의 `theme` 갈래에 실데이터가 한 번도 도달한 적이 없어서다
// (`use-appearance-dials.ts` 가 모듈 상수 `{}` 를 넘겼다). §371 이 매니페스트에
// `dials` 를 실었고 이 파일이 그 둘을 처음 실행한다.
import type { InstalledTheme } from "../../themes/theme-install";

import { beforeEach, describe, expect, it } from "vitest";

import { useSettingsStore } from "../../stores/settings/store";
import { resolveDials } from "../merge";
import { themeDialsFor } from "../theme-dials";

/** `src/themes/__tests__/theme-revocation.test.ts` 의 `installedTheme` 을 전사한 뒤
 *  `dials` 만 더했다 — 새 모양을 발명하지 않는다. */
function installedTheme(
  id: string,
  dials?: Record<string, number | string>,
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
      dials,
      engines: { baram: ">=0.7.0" },
      id,
      license: "MIT",
      modes: { light: { tokens: "t.json" } },
      name: id,
      version: "1.0.0",
    },
    modes: { light: { css: false } },
  };
}

describe("themeDialsFor", () => {
  it("hands the merger the installed theme's own dials object", () => {
    const theme = installedTheme("prose", { editorMaxWidth: 720 });
    expect(themeDialsFor("prose", { prose: theme })).toEqual({
      editorMaxWidth: 720,
    });
  });

  it("returns the manifest's object by reference, not a copy", () => {
    // 무엇이 이것을 실패시키는가: 여기서 매번 새 객체를 만들면(펼치기·필터링)
    // `use-appearance-dials.ts` 의 이펙트 deps 가 매 렌더 바뀌어 이펙트가 매
    // 렌더 돌고, `<html>` 에 같은 값을 다시 쓴다.
    const theme = installedTheme("prose", { editorMaxWidth: 720 });
    const installed = { prose: theme };
    expect(themeDialsFor("prose", installed)).toBe(theme.manifest.dials);
  });

  it("is an empty layer for a theme that declares no dials", () => {
    const theme = installedTheme("plain");
    expect(themeDialsFor("plain", { plain: theme })).toEqual({});
  });

  it("is an empty layer for an id with no install record, and the same reference each time", () => {
    // 참조 안정성 — 위 이펙트 deps 핀의 '없을 때' 쪽 절반.
    const a = themeDialsFor("missing", {});
    const b = themeDialsFor("missing", {});
    expect(a).toEqual({});
    expect(a).toBe(b);
  });

  it("a withdrawn theme contributes nothing, because the caller asks about `system`", () => {
    // `useThemeDials` 는 `useEffectiveThemeId` 의 id 로 묻는다. 철회되면 그 id 가
    // `"system"` 이고, 설치 기록이 없으므로 층이 비어 있다 — 철회된 테마의 색은
    // 벗기면서 그 테마의 본문 폭만 남는 상태가 생기지 않는다.
    const theme = installedTheme("prose", { editorMaxWidth: 720 });
    expect(themeDialsFor("system", { prose: theme })).toEqual({});
  });

  it("survives an `installedThemes` container that persist landed as null", () => {
    // 무엇이 이것을 실패시키는가: 컨테이너 가드가 없으면 `null[themeId]` 가
    // TypeError 이고, 이 함수는 앱 시작마다 도는 렌더 경로 안이라 트리 전체가
    // 언마운트된다. 설정 스토어 persist 에는 커스텀 `merge:` 가 없어 저장분의
    // `null` 이 그대로 state 에 앉는다(`store.ts` 의 `?? {}` 가 같은 이유다).
    expect(themeDialsFor("prose", null as never)).toEqual({});
    expect(themeDialsFor("prose", undefined as never)).toEqual({});
  });
});

describe("테마 층이 실제로 흐를 때의 병합 (스펙 §15 검증 2·3)", () => {
  const themeLayer = themeDialsFor("prose", {
    prose: installedTheme("prose", {
      editorLineBreak: "keepAll",
      editorMaxWidth: 720,
    }),
  });

  beforeEach(() => {
    useSettingsStore.setState({ appearanceOverrides: {} });
  });

  it("테마가 말한 다이얼은 origin 이 theme 이다", () => {
    const resolved = resolveDials(themeLayer, {});
    expect(resolved.editorMaxWidth).toEqual({ origin: "theme", value: 720 });
    expect(resolved.editorLineBreak).toEqual({
      origin: "theme",
      value: "keepAll",
    });
  });

  it("테마가 말하지 않은 다이얼은 default 로 남는다 — 희소 유지 (§364.2)", () => {
    // 무엇이 이것을 실패시키는가: 테마 층을 순회하는 대신 입력을 채워 넣으면
    // 말하지 않은 다이얼까지 origin 이 theme 이 되고, 그러면 `applyDialVars` 가
    // 기본값을 인라인 변수로 `<html>` 에 써 cascade 를 가린다.
    expect(resolveDials(themeLayer, {}).editorPadding.origin).toBe("default");
  });

  it("사용자가 바꾼 다이얼은 테마를 이기고, 나머지는 테마를 따른다 (검증 2)", () => {
    const resolved = resolveDials(themeLayer, { editorMaxWidth: 960 });
    expect(resolved.editorMaxWidth).toEqual({ origin: "user", value: 960 });
    expect(resolved.editorLineBreak).toEqual({
      origin: "theme",
      value: "keepAll",
    });
  });

  it("되돌리기 뒤의 병합 결과가 테마만 적용한 상태와 정확히 같다 (검증 3)", () => {
    // 진짜 `resetDial` 을 지나간다 — 같은 인자로 `resolveDials` 를 두 번 부르는
    // 왕복은 되돌리기가 무엇을 하든 통과한다.
    const store = useSettingsStore.getState();
    store.setDial("editorMaxWidth", 960);
    expect(
      resolveDials(themeLayer, useSettingsStore.getState().appearanceOverrides)
        .editorMaxWidth,
    ).toEqual({ origin: "user", value: 960 });

    store.resetDial("editorMaxWidth");
    const afterRevert = resolveDials(
      themeLayer,
      useSettingsStore.getState().appearanceOverrides,
    );
    expect(afterRevert).toEqual(resolveDials(themeLayer, {}));
    expect(afterRevert.editorMaxWidth).toEqual({
      origin: "theme",
      value: 720,
    });
  });

  it("되돌리기가 테마 값을 사용자 층에 **쓰는** 것이었다면 구별된다 — 비공허성", () => {
    // 그 구현은 화면상 같은 값을 보이지만 사용자 층이 그 다이얼을 계속 소유해,
    // 이후 테마 업데이트가 영원히 반영되지 않는다(스펙 §15.3).
    expect(resolveDials(themeLayer, { editorMaxWidth: 720 })).not.toEqual(
      resolveDials(themeLayer, {}),
    );
  });
});
