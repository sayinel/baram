// §69 — 내장 플러그인의 비활성 상태. enabled 맵이 아니라 DISABLED 목록인 것이 핵심:
// 다음 릴리스에 내장이 추가돼도 마이그레이션 없이 기본 켜짐이 된다.
import { beforeEach, describe, expect, it } from "vitest";

import { usePluginStore } from "../system/plugin";

describe("builtinDisabled (§69)", () => {
  beforeEach(() => {
    usePluginStore.setState({ builtinDisabled: [] });
  });

  it("defaults to empty, so an unknown built-in is enabled", () => {
    expect(usePluginStore.getState().builtinDisabled).toEqual([]);
  });

  it("records a disabled built-in", () => {
    usePluginStore.getState().setBuiltinEnabled("baram-media-viewer", false);
    expect(usePluginStore.getState().builtinDisabled).toEqual([
      "baram-media-viewer",
    ]);
  });

  it("removes it again when re-enabled", () => {
    usePluginStore.getState().setBuiltinEnabled("baram-media-viewer", false);
    usePluginStore.getState().setBuiltinEnabled("baram-media-viewer", true);
    expect(usePluginStore.getState().builtinDisabled).toEqual([]);
  });

  it("does not duplicate an id disabled twice", () => {
    // 같은 id가 두 번 들어가면 재활성이 한 번으로 끝나지 않는다.
    usePluginStore.getState().setBuiltinEnabled("a", false);
    usePluginStore.getState().setBuiltinEnabled("a", false);
    expect(usePluginStore.getState().builtinDisabled).toEqual(["a"]);
  });

  it("leaves other ids alone", () => {
    usePluginStore.getState().setBuiltinEnabled("a", false);
    usePluginStore.getState().setBuiltinEnabled("b", false);
    usePluginStore.getState().setBuiltinEnabled("a", true);
    expect(usePluginStore.getState().builtinDisabled).toEqual(["b"]);
  });
});
