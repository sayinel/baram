import { beforeEach, describe, expect, it } from "vitest";

import { useSettingsStore } from "../../stores/settings/store";

describe("appearanceOverrides", () => {
  beforeEach(() => {
    useSettingsStore.setState({ appearanceOverrides: {} });
  });

  it("starts empty — the user layer says nothing until the user speaks", () => {
    expect(useSettingsStore.getState().appearanceOverrides).toEqual({});
  });

  it("records only the dial the user set", () => {
    useSettingsStore.getState().setDial("editorMaxWidth", 640);
    expect(useSettingsStore.getState().appearanceOverrides).toEqual({
      editorMaxWidth: 640,
    });
  });

  it("removes the key on reset rather than writing the default", () => {
    // 무엇이 이것을 실패시키는가: reset 이 기본값을 써 버리면 사용자 층이 그 키를
    // 계속 소유해, 이후 테마 업데이트의 값이 영원히 반영되지 않는다(§366 검증 3).
    useSettingsStore.getState().setDial("editorMaxWidth", 640);
    useSettingsStore.getState().resetDial("editorMaxWidth");
    expect(useSettingsStore.getState().appearanceOverrides).toEqual({});
    expect(
      "editorMaxWidth" in useSettingsStore.getState().appearanceOverrides,
    ).toBe(false);
  });

  it("rejects a value the dial cannot parse", () => {
    useSettingsStore.getState().setDial("editorMaxWidth", -1);
    expect(useSettingsStore.getState().appearanceOverrides).toEqual({});
  });
});
