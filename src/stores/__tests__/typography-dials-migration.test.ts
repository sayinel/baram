// §365 v27 → v28 마이그레이션(스펙 0060 §6). 본문 타이포 넷이 외관 다이얼이 되면서 기존
// 저장분의 값을 사용자 층(`appearanceOverrides`)으로 옮긴다.
//
// ‼️ `FROM` 은 27 로 고정한다 — `appearance-overrides-migration.test.ts` 머리주석과 같은 이유다.
// 현재 버전에서 파생하면 다음 마이그레이션이 버전을 올릴 때 이 게이트를 건너뛴다.
import { describe, expect, it } from "vitest";

import { useSettingsStore } from "../settings/store";

const FROM = 27;

function migrate(state: Record<string, unknown>): Record<string, unknown> {
  const fn = useSettingsStore.persist.getOptions().migrate!;
  return fn(state, FROM) as Record<string, unknown>;
}

describe("본문 타이포 → appearanceOverrides 마이그레이션", () => {
  // 무엇이 이것을 실패시키는가: 전부 옮기면 사용자 층이 기본값으로 채워져, 사용자가 고른 적
  // 없는 값이 테마의 제안을 이긴다(§364.2 희소성).
  it("기본값을 쓰던 사용자는 키를 얻지 않는다", () => {
    const out = migrate({
      codeFontFamily: "",
      fontFamily: "",
      fontSize: 16,
      lineHeight: 1.75,
    });
    expect(out.appearanceOverrides).toBeUndefined();
  });

  it("기본값과 다른 값은 다이얼 id 로 옮겨진다", () => {
    const out = migrate({
      codeFontFamily: "D2Coding",
      fontFamily: "Noto Sans KR",
      fontSize: 18,
      lineHeight: 1.6,
    });
    expect(out.appearanceOverrides).toEqual({
      editorCodeFontFamily: "D2Coding",
      editorFontFamily: "Noto Sans KR",
      editorFontSize: 18,
      editorLineHeight: 1.6,
    });
  });

  it("이미 있던 사용자 층과 합친다", () => {
    const out = migrate({
      appearanceOverrides: { density: "compact" },
      fontSize: 18,
    });
    expect(out.appearanceOverrides).toEqual({
      density: "compact",
      editorFontSize: 18,
    });
  });

  it("parse 에 실패하는 값은 옮기지 않는다", () => {
    const out = migrate({ fontFamily: "a\nb", fontSize: 99 });
    expect(out.appearanceOverrides).toBeUndefined();
  });

  it("서체 이름은 공백을 걷어 옮긴다", () => {
    expect(migrate({ fontFamily: "  Inter " }).appearanceOverrides).toEqual({
      editorFontFamily: "Inter",
    });
  });

  // 무엇이 이것을 실패시키는가: 옛 키를 남기면 마이그레이션 직후 state 에 두 출처가 공존한다.
  it("옛 키 넷을 지운다", () => {
    const out = migrate({
      codeFontFamily: "D2Coding",
      fontFamily: "",
      fontSize: 18,
      lineHeight: 1.75,
    });
    for (const key of [
      "codeFontFamily",
      "fontFamily",
      "fontSize",
      "lineHeight",
    ]) {
      expect(key in out, key).toBe(false);
    }
  });

  it("게이트를 지난 버전에서는 다시 돌지 않는다", () => {
    const current = useSettingsStore.persist.getOptions().version ?? 0;
    const fn = useSettingsStore.persist.getOptions().migrate!;
    const out = fn(
      { appearanceOverrides: {}, fontSize: 18 },
      current,
    ) as Record<string, unknown>;
    expect(out.appearanceOverrides).toEqual({});
  });
});
