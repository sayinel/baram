import type { InstalledTheme } from "../../../themes/theme-install";

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import en from "../../../i18n/en.json";
import { useSettingsStore } from "../../../stores/settings/store";
import { AppearanceDialRow } from "../appearance-dial-row";

/** `src/themes/__tests__/theme-revocation.test.ts` 의 픽스처 모양 + `dials`. */
function installedTheme(
  dials: Record<string, number | string>,
): InstalledTheme {
  return {
    checksum: "c".repeat(64),
    consentedAt: "2026-09-01T00:00:00.000Z",
    consentedVersion: "1.0.0",
    id: "prose",
    installedAt: "2026-09-01T00:00:00.000Z",
    installPath: "/home/u/.baram/themes/prose",
    manifest: {
      author: "a",
      description: "d",
      dials,
      engines: { baram: ">=0.7.0" },
      id: "prose",
      license: "MIT",
      modes: { light: { tokens: "t.json" } },
      name: "prose",
      version: "1.0.0",
    },
    modes: { light: { css: false } },
  };
}

describe("AppearanceDialRow", () => {
  beforeEach(() => {
    useSettingsStore.setState({
      activeThemeId: "system",
      appearanceOverrides: {},
      installedThemes: {},
      locale: "en",
    });
  });

  it("shows the default origin with no badge and no revert", () => {
    render(<AppearanceDialRow dialId="editorMaxWidth" label="Line width" />);
    // 무엇이 이것을 실패시키는가: `data-origin`이 슬롯(항상 렌더)이 아니라
    // 배지(default에서는 렌더되지 않는다)에 있었다면, 이 단정 자체가 할
    // 대상을 잃는다 — 슬롯에 거는 것이 그 회귀를 막는다.
    const slot = screen.getByTestId("dial-origin");
    expect(slot).toHaveAttribute("data-origin", "default");
    // default는 값이 이미 description에 있으므로 배지를 아예 렌더하지
    // 않는다("아무 일도 없었다"는 정보 없는 배지를 막기 위해, §366 후속 수정).
    expect(screen.queryByTestId("dial-origin-badge")).toBeNull();
    expect(screen.queryByTestId("dial-revert")).toBeNull();
  });

  it("flips to the user origin, shows a localized badge, and offers a revert", () => {
    render(<AppearanceDialRow dialId="editorMaxWidth" label="Line width" />);
    fireEvent.change(screen.getByRole("slider"), { target: { value: "640" } });
    const slot = screen.getByTestId("dial-origin");
    expect(slot).toHaveAttribute("data-origin", "user");
    const badge = screen.getByTestId("dial-origin-badge");
    expect(badge).toHaveTextContent(en["settings.appearance.dialOrigin.user"]);
    // 무엇이 이것을 실패시키는가: 이 클래스가 빠지면 배지가 본문 크기·
    // 기본 텍스트색으로 렌더돼 라벨과 시각적으로 경쟁한다(§366 버그 리포트).
    expect(badge).toHaveClass("settings-dial-origin-badge");
    const revert = screen.getByTestId("dial-revert");
    expect(revert).toBeInTheDocument();
    // 무엇이 이것을 실패시키는가: `btn-unstyled`로 되돌아가면 버튼이 다시
    // 맨 글리프로 보인다 — "버튼처럼 안 보인다"는 사용자 리포트가 되돌아온다.
    expect(revert).toHaveClass("icon-btn", "settings-dial-revert");
    expect(revert).toHaveAccessibleName(en["settings.appearance.dialRevert"]);
  });

  it("reverting removes the key rather than pinning the default", () => {
    // 무엇이 이것을 실패시키는가: 되돌리기가 기본값을 쓰면 사용자 층이 이 다이얼을
    // 계속 소유해, 나중에 테마가 주는 값이 영원히 반영되지 않는다.
    render(<AppearanceDialRow dialId="editorMaxWidth" label="Line width" />);
    fireEvent.change(screen.getByRole("slider"), { target: { value: "640" } });
    fireEvent.click(screen.getByTestId("dial-revert"));
    expect(useSettingsStore.getState().appearanceOverrides).toEqual({});
  });

  it("shows a px readout that tracks the slider value", () => {
    render(<AppearanceDialRow dialId="editorMaxWidth" label="Line width" />);
    fireEvent.change(screen.getByRole("slider"), { target: { value: "640" } });
    // 값은 더 이상 description 괄호 안이 아니라 전용 읽기 슬롯에 산다(§366
    // 후속 수정) — description은 값과 무관한 상수 문장으로 남는다.
    expect(screen.getByText("Maximum content width")).toBeInTheDocument();
    expect(screen.getByTestId("dial-value")).toHaveTextContent("640px");
  });

  it("labels zero as 'no limit' instead of showing a bare 0px", () => {
    // 무엇이 이것을 실패시키는가: 0을 그냥 "0px"로 찍으면 사용자에게 왜
    // 에디터가 갑자기 무제한 폭이 됐는지 설명이 없다.
    render(<AppearanceDialRow dialId="editorMaxWidth" label="Line width" />);
    fireEvent.change(screen.getByRole("slider"), { target: { value: "0" } });
    expect(screen.getByTestId("dial-value")).toHaveTextContent("No limit");
  });

  it("shows a rem readout for the padding dial", () => {
    render(<AppearanceDialRow dialId="editorPadding" label="Editor padding" />);
    fireEvent.change(screen.getByRole("slider"), { target: { value: "6" } });
    expect(screen.getByText("Space around the content")).toBeInTheDocument();
    expect(screen.getByTestId("dial-value")).toHaveTextContent("6rem");
  });

  it("wears the theme's value with a theme badge and no revert", () => {
    // §366 — 이 행이 처음으로 `theme` origin 을 실데이터로 본다. 무엇이 이것을
    // 실패시키는가: 이 컴포넌트가 병합기에 `{}` 를 계속 넘기면(테마 층을 끊으면)
    // `<html>` 에는 720px 이 적용되는데 화면은 기본값 800 을 배지 없이 보여 준다.
    useSettingsStore.setState({
      activeThemeId: "prose",
      installedThemes: { prose: installedTheme({ editorMaxWidth: 720 }) },
    });
    render(<AppearanceDialRow dialId="editorMaxWidth" label="Line width" />);
    expect(screen.getByTestId("dial-origin")).toHaveAttribute(
      "data-origin",
      "theme",
    );
    expect(screen.getByTestId("dial-origin-badge")).toHaveTextContent(
      en["settings.appearance.dialOrigin.theme"],
    );
    expect(screen.getByTestId("dial-value")).toHaveTextContent("720px");
    // 되돌릴 사용자 값이 없다 — 되돌리기는 `user` origin 에서만 뜬다.
    expect(screen.queryByTestId("dial-revert")).toBeNull();
  });

  it("names the revert for the layer it actually returns to", () => {
    // 무엇이 이것을 실패시키는가: 라벨이 `dialRevert`("기본값으로 되돌리기")로
    // 고정돼 있으면, 테마가 말한 다이얼에서 그 문장이 거짓이 된다 — `resetDial`
    // 은 사용자 층 키를 지울 뿐이라 되돌아가는 자리는 테마 값이다.
    useSettingsStore.setState({
      activeThemeId: "prose",
      installedThemes: { prose: installedTheme({ editorMaxWidth: 720 }) },
    });
    render(<AppearanceDialRow dialId="editorMaxWidth" label="Line width" />);
    fireEvent.change(screen.getByRole("slider"), { target: { value: "960" } });
    expect(screen.getByTestId("dial-revert")).toHaveAccessibleName(
      en["settings.appearance.dialRevertToTheme"],
    );
  });

  it("keeps the default wording when the theme said nothing about THAT dial", () => {
    // 비공허성 — 라벨이 "테마가 설치돼 있는가" 가 아니라 "이 다이얼에 대해
    // 테마가 말했는가" 로 갈린다는 것의 핀. 같은 테마, 다른 행.
    useSettingsStore.setState({
      activeThemeId: "prose",
      installedThemes: { prose: installedTheme({ editorMaxWidth: 720 }) },
    });
    render(<AppearanceDialRow dialId="editorPadding" label="Editor padding" />);
    fireEvent.change(screen.getByRole("slider"), { target: { value: "6" } });
    expect(screen.getByTestId("dial-revert")).toHaveAccessibleName(
      en["settings.appearance.dialRevert"],
    );
  });

  it("keeps the readout's class so the value stays a fixed-width, tabular-nums slot", () => {
    // 무엇이 이것을 실패시키는가: 이 클래스가 빠지면 값이 고정 폭 밖으로
    // 나가 드래그 중 자릿수가 바뀔 때마다 슬라이더 위치가 옆으로 흔들린다
    // (§366 버그 리포트 — description 두 줄 넘침과 같은 종류의 떨림).
    render(<AppearanceDialRow dialId="editorMaxWidth" label="Line width" />);
    expect(screen.getByTestId("dial-value")).toHaveClass("settings-dial-value");
  });
});
