import { beforeEach, describe, expect, it } from "vitest";

import { useAIStore } from "../ai/ai";
import { FEATURE_KEYS } from "../settings/feature-keys";
import { isFeatureEnabled } from "../settings/features";
import { useSettingsStore } from "../settings/store";

describe("feature flags (§338)", () => {
  beforeEach(() => {
    useSettingsStore.setState({
      journalEnabled: true,
      tasksEnabled: true,
      zettelkastenEnabled: true,
    });
    useAIStore.setState({ aiEnabled: true });
  });

  it("FEATURE_KEYS lists exactly the four features", () => {
    expect([...FEATURE_KEYS].sort()).toEqual([
      "ai",
      "journal",
      "tasks",
      "zettelkasten",
    ]);
  });

  it("reads each flag from the store that owns it", () => {
    for (const key of FEATURE_KEYS) {
      expect(isFeatureEnabled(key)).toBe(true);
    }

    useSettingsStore.setState({ journalEnabled: false });
    expect(isFeatureEnabled("journal")).toBe(false);
    expect(isFeatureEnabled("tasks")).toBe(true);

    useAIStore.setState({ aiEnabled: false });
    expect(isFeatureEnabled("ai")).toBe(false);
    // 다른 스토어의 값이 딸려 내려가지 않는다 — 비공허성 대조군
    expect(isFeatureEnabled("tasks")).toBe(true);
  });

  it("defaults aiEnabled to true so today's behavior is unchanged", () => {
    // 기본값이 뒤집히면 이 설계의 모든 두-모양 비교가 공허해진다 (§345)
    const fresh = useAIStore.getInitialState();
    expect(fresh.aiEnabled).toBe(true);
  });

  it("persists aiEnabled — partialize is an explicit allowlist", () => {
    // ‼️ ai.ts의 partialize에 넣지 않으면 토글이 재시작에서 사라진다
    const partialize = useAIStore.persist.getOptions().partialize;
    expect(partialize).toBeDefined();
    const persisted = partialize!({
      ...useAIStore.getInitialState(),
      aiEnabled: false,
    }) as Record<string, unknown>;
    expect(persisted).toHaveProperty("aiEnabled", false);
  });

  it("keeps the ai store at version 3 — a new key with today's default needs no backfill", () => {
    expect(useAIStore.persist.getOptions().version).toBe(3);
  });
});
