import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import en from "../../../i18n/en.json";
import { useSettingsStore } from "../../../stores/settings/store";
import { AppearanceDialRow } from "../appearance-dial-row";

describe("AppearanceDialRow", () => {
  beforeEach(() => {
    useSettingsStore.setState({ appearanceOverrides: {}, locale: "en" });
  });

  it("shows the default origin and offers no revert", () => {
    render(<AppearanceDialRow dialId="editorMaxWidth" label="Line width" />);
    // 무엇이 이것을 실패시키는가: 배지가 원시 origin("default")을 그대로
    // 보여주면 이 단정은 여전히 통과한다 — `data-origin`이 그 회귀를 잡고,
    // textContent 단정은 화면에 실제로 번역된 문구가 실리는지를 잡는다.
    const badge = screen.getByTestId("dial-origin");
    expect(badge).toHaveAttribute("data-origin", "default");
    expect(badge).toHaveTextContent(
      en["settings.appearance.dialOrigin.default"],
    );
    // 무엇이 이것을 실패시키는가: 이 클래스가 빠지면 배지가 본문 크기·
    // 기본 텍스트색으로 렌더돼 라벨과 시각적으로 경쟁한다(§366 버그 리포트).
    expect(badge).toHaveClass("settings-dial-origin-badge");
    expect(screen.queryByTestId("dial-revert")).toBeNull();
  });

  it("flips to the user origin and offers a revert once changed", () => {
    render(<AppearanceDialRow dialId="editorMaxWidth" label="Line width" />);
    fireEvent.change(screen.getByRole("slider"), { target: { value: "640" } });
    const badge = screen.getByTestId("dial-origin");
    expect(badge).toHaveAttribute("data-origin", "user");
    expect(badge).toHaveTextContent(en["settings.appearance.dialOrigin.user"]);
    expect(screen.getByTestId("dial-revert")).toBeInTheDocument();
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
    expect(
      screen.getByText("Maximum content width (640px)"),
    ).toBeInTheDocument();
  });

  it("labels zero as 'no limit' instead of showing a bare 0px", () => {
    // 무엇이 이것을 실패시키는가: 0을 그냥 "0px"로 찍으면 사용자에게 왜
    // 에디터가 갑자기 무제한 폭이 됐는지 설명이 없다.
    render(<AppearanceDialRow dialId="editorMaxWidth" label="Line width" />);
    fireEvent.change(screen.getByRole("slider"), { target: { value: "0" } });
    expect(
      screen.getByText("Maximum content width (No limit)"),
    ).toBeInTheDocument();
  });

  it("shows a rem readout for the padding dial", () => {
    render(<AppearanceDialRow dialId="editorPadding" label="Editor padding" />);
    fireEvent.change(screen.getByRole("slider"), { target: { value: "6" } });
    expect(
      screen.getByText("Space around the editor content (6rem)"),
    ).toBeInTheDocument();
  });
});
