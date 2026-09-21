import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import en from "../../../i18n/en.json";
import { useSettingsStore } from "../../../stores/settings/store";
import { AppearanceDialRow } from "../appearance-dial-row";

describe("AppearanceDialRow", () => {
  beforeEach(() => {
    useSettingsStore.setState({ appearanceOverrides: {}, locale: "en" });
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

  it("keeps the readout's class so the value stays a fixed-width, tabular-nums slot", () => {
    // 무엇이 이것을 실패시키는가: 이 클래스가 빠지면 값이 고정 폭 밖으로
    // 나가 드래그 중 자릿수가 바뀔 때마다 슬라이더 위치가 옆으로 흔들린다
    // (§366 버그 리포트 — description 두 줄 넘침과 같은 종류의 떨림).
    render(<AppearanceDialRow dialId="editorMaxWidth" label="Line width" />);
    expect(screen.getByTestId("dial-value")).toHaveClass("settings-dial-value");
  });
});
