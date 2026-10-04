/*
 * §3.6 충돌 큐 — 탭 id 와 generation 으로 식별한다.
 *
 * 충돌 자리가 하나였을 때는 두 번째 외부 변경이 첫 번째를 덮어 그 탭의 충돌이 조용히
 * 사라졌다. 큐는 탭마다 한 항목을 두고, 같은 탭의 새 이벤트는 그 자리에서 합치며
 * generation 을 새로 매긴다. 동작은 자기가 본 generation 만 지운다.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { useUIStore } from "../ui";

const ui = () => useUIStore.getState();
const entry = (tabId: string) =>
  ui().conflictQueue.find((e) => e.tabId === tabId)!;

beforeEach(() => {
  useUIStore.setState({ conflictQueue: [] });
});

describe("§3.6 conflict queue", () => {
  it("keeps conflicts of different tabs in arrival order", () => {
    // 이것을 실패시키는 것: enqueue 가 큐를 새 항목 하나로 덮어씀(한 칸 자리).
    ui().enqueueConflict({
      base: "",
      externalMtime: 1,
      filePath: "/a",
      tabId: "A",
    });
    ui().enqueueConflict({
      base: "",
      externalMtime: 2,
      filePath: "/c",
      tabId: "C",
    });

    expect(ui().conflictQueue.map((e) => e.tabId)).toEqual(["A", "C"]);
  });

  it("merges a newer event for the same tab in place, with a new generation", () => {
    // 이것을 실패시키는 것: 같은 tabId 합치기 제거(항목이 둘) / generation 고정.
    ui().enqueueConflict({
      base: "B1",
      externalMtime: 10,
      filePath: "/a",
      tabId: "A",
    });
    ui().enqueueConflict({
      base: "",
      externalMtime: 5,
      filePath: "/c",
      tabId: "C",
    });
    const first = entry("A").generation;

    ui().enqueueConflict({
      base: "B2",
      externalMtime: 20,
      filePath: "/a",
      tabId: "A",
    });

    expect(ui().conflictQueue.map((e) => e.tabId)).toEqual(["A", "C"]);
    expect(entry("A")).toMatchObject({ base: "B2", externalMtime: 20 });
    expect(entry("A").generation).toBeGreaterThan(first);
  });

  it("keeps the later mtime when an older event arrives late", () => {
    // 이것을 실패시키는 것: `max` 대신 새 이벤트의 mtime 을 그대로 씀.
    ui().enqueueConflict({
      base: "B1",
      externalMtime: 20,
      filePath: "/a",
      tabId: "A",
    });
    ui().enqueueConflict({
      base: "B2",
      externalMtime: 10,
      filePath: "/a",
      tabId: "A",
    });

    expect(entry("A").externalMtime).toBe(20);
  });

  it("resolves only the tab named, wherever it sits", () => {
    // 이것을 실패시키는 것: resolve 가 머리를 지움(shift).
    ui().enqueueConflict({
      base: "",
      externalMtime: 1,
      filePath: "/a",
      tabId: "A",
    });
    ui().enqueueConflict({
      base: "",
      externalMtime: 2,
      filePath: "/c",
      tabId: "C",
    });

    ui().resolveConflict("C", entry("C").generation);

    expect(ui().conflictQueue.map((e) => e.tabId)).toEqual(["A"]);
  });

  it("does not resolve an entry a newer event replaced", () => {
    // 이것을 실패시키는 것: resolve 가 generation 을 보지 않음.
    ui().enqueueConflict({
      base: "",
      externalMtime: 1,
      filePath: "/a",
      tabId: "A",
    });
    const old = entry("A").generation;
    ui().enqueueConflict({
      base: "",
      externalMtime: 2,
      filePath: "/a",
      tabId: "A",
    });

    ui().resolveConflict("A", old);

    expect(ui().conflictQueue).toHaveLength(1);
    expect(ui().conflictGeneration("A")).toBe(entry("A").generation);
  });

  it("retargets the path without a new generation", () => {
    // 이것을 실패시키는 것: retarget 이 generation 을 올림(진행 중인 동작의 resolve 가 빗나간다).
    ui().enqueueConflict({
      base: "",
      externalMtime: 1,
      filePath: "/a",
      tabId: "A",
    });
    const generation = entry("A").generation;

    ui().retargetConflict("A", "/a2");

    expect(entry("A")).toMatchObject({ filePath: "/a2", generation });
  });

  it("an identical event and no-op actions leave the state object alone", () => {
    // 이것을 실패시키는 것: 동등성 관문 제거(같은 내용으로 `set` 해 모든 구독자를 깨운다).
    ui().enqueueConflict({
      base: "B",
      externalMtime: 1,
      filePath: "/a",
      tabId: "A",
    });
    const before = useUIStore.getState();

    ui().enqueueConflict({
      base: "B",
      externalMtime: 1,
      filePath: "/a",
      tabId: "A",
    });
    ui().retargetConflict("A", "/a");
    ui().resolveConflict("A", -1);
    ui().dropConflict("missing");

    expect(useUIStore.getState()).toBe(before);
  });

  it("drop removes the tab's entry whatever its generation", () => {
    // 이것을 실패시키는 것: drop 을 generation 이 맞을 때만 지우게 바꿈(닫힌 탭의 항목이 남는다).
    ui().enqueueConflict({
      base: "",
      externalMtime: 1,
      filePath: "/a",
      tabId: "A",
    });
    ui().dropConflict("A");
    expect(ui().conflictQueue).toEqual([]);
    expect(ui().conflictGeneration("A")).toBeNull();
  });
});
