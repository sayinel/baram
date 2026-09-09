import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useAIStore } from "../../../stores/ai/ai";
import {
  ACTIVITY_BAR_ALWAYS_ON,
  ACTIVITY_BAR_ITEM_FEATURE,
  DEFAULT_ACTIVITY_BAR_CONFIG,
  isActivityBarItemVisible,
} from "../../../stores/settings/activity-bar-config";
import { FEATURE_KEYS } from "../../../stores/settings/feature-keys";
import { useSettingsStore } from "../../../stores/settings/store";
import { ActivityBar } from "../ActivityBar";

// ‼️ `chat` 과 `photo-gallery` 의 접근 가능 이름에는 단축키가 붙는다
// (`ActivityBar.tsx` labelFor + SHORTCUT_COMMAND_IDS) — "AI Chat (⌘⇧A)".
// 그래서 정확 문자열이 아니라 정규식으로 찾는다.
const NAME: Record<string, RegExp> = {
  calendar: /^Calendar$/,
  chat: /^AI Chat/,
  memories: /^Memories$/,
  "photo-gallery": /^Photo Gallery/,
  tasks: /^Tasks$/,
  zettel: /^Zettel$/,
};

function enableAll() {
  useSettingsStore.setState({
    journalEnabled: true,
    tasksEnabled: true,
    zettelkastenEnabled: true,
  });
  useAIStore.setState({ aiEnabled: true });
}

describe("activity-bar item classification (§338)", () => {
  it("partitions DEFAULT_ACTIVITY_BAR_CONFIG exactly", () => {
    // 소진 산술 — 새 항목을 분류 없이 추가하면 실패한다
    const all = DEFAULT_ACTIVITY_BAR_CONFIG.map((c) => c.id);
    const owned = Object.keys(ACTIVITY_BAR_ITEM_FEATURE);
    const always = [...ACTIVITY_BAR_ALWAYS_ON];

    expect(owned.filter((id) => always.includes(id))).toEqual([]); // 교집합 0
    expect([...owned, ...always].sort()).toEqual([...all].sort()); // 합집합 = 전체
    expect(owned.length + always.length).toBe(all.length); // 개수
  });

  it("uses only real FeatureKeys", () => {
    for (const f of Object.values(ACTIVITY_BAR_ITEM_FEATURE)) {
      expect(FEATURE_KEYS).toContain(f);
    }
  });
});

describe("isActivityBarItemVisible (§338)", () => {
  // 스토어 없이 순수 함수 자체를 고정한다 — ActivityBar.tsx와 ActivityBarTab.tsx가
  // 각자 지역 클로저로 복제했던 로직이 이제 여기 하나뿐이라는 것의 증거.
  const allOff = {
    ai: false,
    journal: false,
    tasks: false,
    zettelkasten: false,
  };
  const allOn = { ai: true, journal: true, tasks: true, zettelkasten: true };

  it("follows the owning feature's flag for a classified item", () => {
    expect(isActivityBarItemVisible("chat", allOn)).toBe(true);
    expect(isActivityBarItemVisible("chat", allOff)).toBe(false);
    expect(
      isActivityBarItemVisible("zettel", { ...allOn, zettelkasten: false }),
    ).toBe(false);
  });

  it("is always true for an unclassified (always-on) item, regardless of flags", () => {
    expect(isActivityBarItemVisible("search", allOff)).toBe(true);
    expect(isActivityBarItemVisible("search", allOn)).toBe(true);
  });
});

describe("activity-bar feature gating (§338)", () => {
  beforeEach(enableAll);

  it("shows every feature item when all features are on", () => {
    render(<ActivityBar />);
    for (const id of Object.keys(ACTIVITY_BAR_ITEM_FEATURE)) {
      expect(
        screen.getByRole("button", { name: NAME[id] }),
      ).toBeInTheDocument();
    }
  });

  it("hides the journal items when journal is off — including the BOTTOM two", () => {
    // §337-(3) 하단 목록에는 기능 게이트가 아예 없었다. 상단만 고치면 절반이다.
    useSettingsStore.setState({ journalEnabled: false });
    render(<ActivityBar />);
    for (const id of ["calendar", "memories", "photo-gallery"]) {
      expect(
        screen.queryByRole("button", { name: NAME[id] }),
      ).not.toBeInTheDocument();
    }
    // 비공허성 — 다른 기능은 남는다
    expect(
      screen.getByRole("button", { name: NAME.tasks }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: NAME.chat })).toBeInTheDocument();
  });

  it("hides the chat item when ai is off", () => {
    useAIStore.setState({ aiEnabled: false });
    render(<ActivityBar />);
    expect(
      screen.queryByRole("button", { name: NAME.chat }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: NAME.memories }),
    ).toBeInTheDocument();
  });

  it("hides the zettel item when zettelkasten is off", () => {
    useSettingsStore.setState({ zettelkastenEnabled: false });
    render(<ActivityBar />);
    expect(
      screen.queryByRole("button", { name: NAME.zettel }),
    ).not.toBeInTheDocument();
    // 비공허성 — 다른 기능은 남는다
    expect(
      screen.getByRole("button", { name: NAME.tasks }),
    ).toBeInTheDocument();
  });

  it("hides the tasks item when tasks is off", () => {
    useSettingsStore.setState({ tasksEnabled: false });
    render(<ActivityBar />);
    expect(
      screen.queryByRole("button", { name: NAME.tasks }),
    ).not.toBeInTheDocument();
    // 비공허성 — 다른 기능은 남는다
    expect(
      screen.getByRole("button", { name: NAME.zettel }),
    ).toBeInTheDocument();
  });

  it("never writes to activityBarConfig", () => {
    // 되켤 때 사용자의 visible 선택이 돌아와야 한다
    const before = JSON.stringify(
      useSettingsStore.getState().activityBarConfig,
    );
    useSettingsStore.setState({ journalEnabled: false });
    render(<ActivityBar />);
    expect(JSON.stringify(useSettingsStore.getState().activityBarConfig)).toBe(
      before,
    );
  });
});
