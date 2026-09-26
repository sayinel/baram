// §365 다이얼 8 — 본문 폭 행(스펙 0060 §8.3). 저장은 px 하나, 표현은 글자 수와 px.
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const measure = vi.hoisted(() =>
  vi.fn(() => Promise.resolve<null | number>(1770 / 2048)),
);
vi.mock("../../../utils/font/char-advance", () => ({
  ADVANCE_SAMPLES: { en: "abcdefghijklmnopqrstuvwxyz", ko: "가" },
  measureAdvanceRatio: measure,
}));

import { useSettingsStore } from "../../../stores/settings/store";
import { usePluginStore } from "../../../stores/system/plugin";
import { EditorWidthRow } from "../editor-width-row";

function slider(container: HTMLElement): HTMLInputElement {
  const el = container.querySelector('input[type="range"]');
  if (!(el instanceof HTMLInputElement)) throw new Error("no slider");
  return el;
}

beforeEach(() => {
  measure.mockClear();
  measure.mockImplementation(() => Promise.resolve(1770 / 2048));
  usePluginStore.setState({ revocations: null });
  // 레퍼런스 테마의 값(스펙 0060 §8.2 검산) — 사용자 층으로 준다.
  useSettingsStore.setState({
    activeThemeId: "system",
    appearanceOverrides: {
      editorFontSize: 17,
      editorLetterSpacing: -0.01,
      editorMaxWidth: 720,
      editorPadding: 5,
    },
    editorWidthUnit: "chars",
    installedThemes: {},
    locale: "ko",
  });
});

describe("EditorWidthRow", () => {
  it("글자 수로 보인다", async () => {
    render(<EditorWidthRow />);
    expect(await screen.findByText("39자")).toBeTruthy();
  });

  it("px 로 바꾸면 저장값 그대로", async () => {
    useSettingsStore.setState({ editorWidthUnit: "px" });
    render(<EditorWidthRow />);
    expect((await screen.findByTestId("dial-value")).textContent).toBe("720px");
  });

  it("자 슬라이더는 환산한 px 를 사용자 층에 쓴다", async () => {
    const { container } = render(<EditorWidthRow />);
    await screen.findByText("39자");
    fireEvent.change(slider(container), { target: { value: "40" } });
    expect(useSettingsStore.getState().appearanceOverrides.editorMaxWidth).toBe(
      741,
    );
    expect(screen.getByTestId("dial-value").textContent).toBe("40자");
  });

  // 계획 0107 P8 — 왼쪽 끝(최소 − 1)은 "제한 없음" 이고 0 을 쓴다. 19 가 저장되지 않는다.
  it("왼쪽 끝은 제한 없음", async () => {
    const { container } = render(<EditorWidthRow />);
    await screen.findByText("39자");
    fireEvent.change(slider(container), { target: { value: "19" } });
    expect(useSettingsStore.getState().appearanceOverrides.editorMaxWidth).toBe(
      0,
    );
    expect(screen.getByTestId("dial-value").textContent).toBe("제한 없음");
  });

  // 무엇이 이것을 실패시키는가: 재지 못한 채 자 슬라이더를 열어 두면 없는 비율로 px 를 쓴다.
  it("폭을 재지 못하면 px 로 보이고 단위 전환을 잠근다", async () => {
    measure.mockImplementation(() => Promise.resolve(null));
    render(<EditorWidthRow />);
    await screen.findByText("720px");
    expect((screen.getByRole("combobox") as HTMLSelectElement).disabled).toBe(
      true,
    );
  });
});
