// §348 본문 서체 기본값이 `"Pretendard"` → `""` 로 바뀌었다. 화면은 같지만
// 저장된 값은 남고, 그 값은 §351 가용성 판정에서 "missing" 이다.
//
// 왜 마이그레이션이 필요한가(§348 은 "셋 다 오늘 동작과 같은 기본값이므로
// backfill 불필요"라고 판단했다): 그 판단은 **화면**에 대해서는 맞고 **저장값**에
// 대해서는 틀렸다. `"Pretendard"` 와 번들 서체 `"Pretendard Variable"` 은 서로
// 다른 CSS 패밀리명이므로, 화면이 같은 이유는 "저장값이 이제 적용된다"가 아니라
// 폴백 스택의 두 번째 항목이 받아 주기 때문이다. 그래서 문서는 정상 렌더되는데
// 설정 화면에는 빨간 "이 머신에 없음" 배지가 뜬다 — 사용자가 고른 적 없는 값에
// 대해서 (final review I5).
import { describe, expect, it } from "vitest";

import { fontAvailability } from "../../utils/font/font-availability";
import { useSettingsStore } from "../settings/store";

function fontFamilyAfter(persisted: unknown, version: number): unknown {
  return (migrate(persisted, version) as { fontFamily?: unknown }).fontFamily;
}

function migrate(persisted: unknown, version: number): unknown {
  const { migrate: fn } = useSettingsStore.persist.getOptions();
  if (typeof fn !== "function") {
    throw new Error("persist migrate is not configured");
  }
  return fn(persisted, version);
}

describe("§348 the pre-branch fontFamily default is retired, not left to badge red", () => {
  it('rewrites a persisted "Pretendard" to the new empty default', () => {
    expect(fontFamilyAfter({ fontFamily: "Pretendard" }, 24)).toBe("");
  });

  // ‼️ 이 케이스가 위 단정을 무의미하지 않게 만든다. 배지가 실제로 빨갛게
  // 되는지를 판정 함수에 직접 물어 본다 — 옛 값이 "missing" 이고 새 값이
  // 아니라는 것이 이 마이그레이션의 유일한 존재 이유다. 두 값이 같은 판정을
  // 받는다면 마이그레이션은 지워도 되는 코드다.
  it("changes what the availability badge says, which is the whole point", () => {
    const installed = [
      {
        hasKorean: true,
        monospaced: false,
        name: "Noto Sans KR",
        weights: [400],
      },
    ];
    expect(fontAvailability("Pretendard", installed)).toBe("missing");
    expect(fontAvailability("", installed)).toBe("bundled");
  });

  it("leaves a font the user actually chose alone", () => {
    expect(fontFamilyAfter({ fontFamily: "D2Coding" }, 24)).toBe("D2Coding");
  });

  // 번들 서체를 직접 고른 사용자는 그 선택을 유지한다 — 접두사 일치가 아니라
  // 정확한 문자열 비교여야 한다.
  it("leaves the bundled family's own name alone", () => {
    expect(fontFamilyAfter({ fontFamily: "Pretendard Variable" }, 24)).toBe(
      "Pretendard Variable",
    );
  });

  // 게이트가 없으면, 업그레이드 뒤 사용자가 직접 "Pretendard" 를 입력한 값이
  // 다음 버전 올림에서 조용히 지워진다.
  it("does not fire again for a version at or past the gate", () => {
    const current = useSettingsStore.persist.getOptions().version ?? 0;
    expect(fontFamilyAfter({ fontFamily: "Pretendard" }, current)).toBe(
      "Pretendard",
    );
  });

  it("defaults a fresh install to the empty (token stack) value", () => {
    expect(useSettingsStore.getInitialState().fontFamily).toBe("");
  });
});
