// §348 서체 설정 키 3개 — 코드 슬롯, 그리고 최근 사용 목록의 승격·상한·무동작.
//
// `recentFonts` 는 사용자가 서체를 고를 때마다 쓰이므로 고빈도 경로다. zustand 의
// `setState` 는 반환값이 현재 state 와 **같은 객체**일 때만 리스너를 아예 부르지
// 않는다(`Object.is(nextState, state)`) — partial 을 돌려주면 새 root 가 되어
// 아무것도 안 바뀌어도 모든 구독자가 깨어난다. 그래서 무동작 케이스를
// "값이 같다"가 아니라 "알림이 0건이다"로 단정한다.
import { beforeEach, describe, expect, it } from "vitest";

import { useSettingsStore } from "../settings/store";

/** 이 파일이 건드리는 키만 되돌린다 — 다른 테스트의 전제를 뒤집지 않기 위해. */
beforeEach(() => {
  useSettingsStore.setState({
    codeFontFamily: "",
    codeFontSize: 14,
    codeLineHeight: 1.75,
    fontFamily: "",
    fontSize: 16,
    lineHeight: 1.75,
    linkFontMetrics: true,
    recentFonts: [],
  });
});

describe("§348 font settings", () => {
  it("defaults both slots to the empty string — 토큰 스택을 그대로 쓴다는 뜻", () => {
    const initial = useSettingsStore.getInitialState();
    expect(initial.codeFontFamily).toBe("");
    expect(initial.fontFamily).toBe("");
    expect(initial.recentFonts).toEqual([]);
  });

  it("sets the code slot independently of the body slot", () => {
    useSettingsStore.getState().setCodeFontFamily("D2Coding");
    expect(useSettingsStore.getState().codeFontFamily).toBe("D2Coding");
    expect(useSettingsStore.getState().fontFamily).toBe("");
  });

  it("keeps the most recent font first", () => {
    const { pushRecentFont } = useSettingsStore.getState();
    pushRecentFont("Inter");
    pushRecentFont("D2Coding");
    expect(useSettingsStore.getState().recentFonts).toEqual([
      "D2Coding",
      "Inter",
    ]);
  });

  it("promotes a repeat rather than storing it twice", () => {
    const { pushRecentFont } = useSettingsStore.getState();
    for (const f of ["Inter", "D2Coding", "Georgia", "Inter"])
      pushRecentFont(f);
    expect(useSettingsStore.getState().recentFonts).toEqual([
      "Inter",
      "Georgia",
      "D2Coding",
    ]);
  });

  it("caps the list at five and drops the oldest", () => {
    const { pushRecentFont } = useSettingsStore.getState();
    for (const f of ["a", "b", "c", "d", "e", "f"]) pushRecentFont(f);
    expect(useSettingsStore.getState().recentFonts).toEqual([
      "f",
      "e",
      "d",
      "c",
      "b",
    ]);
  });

  it("trims the name before storing it", () => {
    useSettingsStore.getState().pushRecentFont("  Inter  ");
    expect(useSettingsStore.getState().recentFonts).toEqual(["Inter"]);
  });

  // 동등성 관문: 이미 맨 앞인 서체를 다시 고르는 것은 흔한 일이고, 그때 새 root
  // 를 만들면 설정 스토어를 구독하는 모든 컴포넌트가 이유 없이 리렌더된다.
  it("notifies nobody when the pushed font is already first", () => {
    const { pushRecentFont } = useSettingsStore.getState();
    pushRecentFont("Inter");
    let notifications = 0;
    const unsubscribe = useSettingsStore.subscribe(() => {
      notifications++;
    });
    pushRecentFont("Inter");
    unsubscribe();
    expect(notifications).toBe(0);
  });

  it("notifies nobody for a blank name", () => {
    let notifications = 0;
    const unsubscribe = useSettingsStore.subscribe(() => {
      notifications++;
    });
    useSettingsStore.getState().pushRecentFont("   ");
    unsubscribe();
    expect(notifications).toBe(0);
    expect(useSettingsStore.getState().recentFonts).toEqual([]);
  });

  // partialize 는 whitelist 다 — 빠뜨리면 재시작마다 서체 설정이 사라지고,
  // 사용자는 "가끔 안 먹는다"로 겪는다.
  it.each(["codeFontFamily", "fontFamily", "recentFonts"])(
    "persists %s",
    (key) => {
      useSettingsStore.setState({
        codeFontFamily: "D2Coding",
        fontFamily: "Inter",
        recentFonts: ["Inter"],
      });
      const persisted = useSettingsStore.persist
        .getOptions()
        .partialize?.(useSettingsStore.getState()) as Record<string, unknown>;
      expect(Object.keys(persisted)).toContain(key);
    },
  );
});

// §354 연동 스위치. 규칙은 하나뿐이다: **끌 때만** 코드 값을 채운다. 켤 때
// 손대지 않는 이유는 켜져 있는 동안 그 값을 읽는 곳이 없기 때문이고(그래서
// 지우는 것과 남기는 것이 화면에서 구별되지 않는다), 다음에 끌 때 어차피
// 그 시점의 파생값으로 다시 덮이기 때문이다.
describe("§354 link switch", () => {
  it("starts linked, so the shipped default renders exactly as before", () => {
    expect(useSettingsStore.getInitialState().linkFontMetrics).toBe(true);
  });

  it("seeds the code values from the derived ones when unlinked", () => {
    useSettingsStore.setState({ fontSize: 20, lineHeight: 2 });
    useSettingsStore.getState().setLinkFontMetrics(false);
    const s = useSettingsStore.getState();
    // 20 × 0.875 = 17.5 → 슬라이더가 표현할 수 있는 18.
    expect(s.codeFontSize).toBe(18);
    expect(s.codeLineHeight).toBe(2);
  });

  // 반올림은 파생이 아니라 **여기서만** 일어난다. 슬라이더의 스텝이 1px 이라
  // 표현 못 하는 값에서 출발하면 첫 드래그에 값이 튄다.
  it("rounds only the seeded value, to a step the slider can express", () => {
    useSettingsStore.setState({ fontSize: 17 });
    useSettingsStore.getState().setLinkFontMetrics(false);
    expect(useSettingsStore.getState().codeFontSize).toBe(15);
  });

  it("leaves a custom code size alone when the link is switched back on", () => {
    useSettingsStore.getState().setCodeFontSize(11);
    useSettingsStore.getState().setLinkFontMetrics(true);
    expect(useSettingsStore.getState().codeFontSize).toBe(11);
    expect(useSettingsStore.getState().linkFontMetrics).toBe(true);
  });
});
