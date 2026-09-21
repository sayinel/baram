import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useSettingsStore } from "../../../stores/settings/store";
import { AppearanceDialRow } from "../appearance-dial-row";

describe("AppearanceDialRow", () => {
  beforeEach(() => {
    useSettingsStore.setState({ appearanceOverrides: {} });
  });

  it("shows the default origin and offers no revert", () => {
    render(<AppearanceDialRow dialId="editorMaxWidth" label="Line width" />);
    expect(screen.getByTestId("dial-origin")).toHaveTextContent("default");
    expect(screen.queryByTestId("dial-revert")).toBeNull();
  });

  it("flips to the user origin and offers a revert once changed", () => {
    render(<AppearanceDialRow dialId="editorMaxWidth" label="Line width" />);
    fireEvent.change(screen.getByRole("slider"), { target: { value: "640" } });
    expect(screen.getByTestId("dial-origin")).toHaveTextContent("user");
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
});
