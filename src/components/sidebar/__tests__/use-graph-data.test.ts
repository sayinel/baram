// §30 Graph 는 저장마다 링크 index 를 다시 만들지 않고, 저장이 고쳐 둔 index 를 읽는다(issue 790).
// 횟수로 고정한다 — refreshIndex(전체 build) 호출 수와 getLinkIndex 조회 수.
import type { LinkGraph } from "../../../ipc/types";
import type { Core, ElementDefinition } from "cytoscape";

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getLinkIndex = vi.fn();
const refreshIndex = vi.fn();
vi.mock("../../../ipc/invoke", () => ({
  getLinkIndex: (...a: unknown[]) => getLinkIndex(...a),
  refreshIndex: (...a: unknown[]) => refreshIndex(...a),
  // tauri-storage(설정 store 영속화)가 ipc/invoke 재export 로 부른다
  getConfig: vi.fn().mockResolvedValue(null),
  setConfig: vi.fn().mockResolvedValue(undefined),
}));

import { useContextStore } from "../../../stores/context/context";
import { useLinkStore } from "../../../stores/editor/link";
import { useFileStore } from "../../../stores/file/file";
import { useGraphData } from "../use-graph-data";

/** populate 가 부르는 cytoscape 표면만 흉내 낸다. `added` 는 마지막 `cy.add` 의 인자. */
function stubCy(): { added: ElementDefinition[]; cy: Core } {
  const state = { added: [] as ElementDefinition[] };
  const cy = {
    add: (defs: ElementDefinition[]) => {
      state.added = defs;
    },
    elements: () => ({ remove: () => {} }),
    getElementById: () => ({ addClass: () => {}, length: 0 }),
    nodes: () => ({ forEach: () => {} }),
    off: () => {},
    on: () => {},
    resize: () => {},
    style: () => ({ update: () => {} }),
  };
  return {
    get added() {
      return state.added;
    },
    cy: cy as unknown as Core,
  };
}

const A = "/v/a.md";
const B = "/v/b.md";

function edgesIn(defs: ElementDefinition[]): string[] {
  return defs
    .filter((d) => d.data.source !== undefined)
    .map((d) => `${d.data.source}->${d.data.target}`);
}

function graph(edges: Array<[string, string]>): LinkGraph {
  return {
    edges: edges.map(([from, to]) => ({ from, to })),
    nodes: [A, B],
  } as LinkGraph;
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

beforeEach(() => {
  getLinkIndex.mockReset().mockResolvedValue(graph([]));
  refreshIndex.mockReset().mockResolvedValue(undefined);
  useFileStore.setState({ rootPath: "/v" });
  useContextStore.setState({ contexts: [] });
  useLinkStore.setState({ indexVersion: 0 });
});

describe("useGraphData — a save does not rebuild the link index", () => {
  it("reads the updated index on each of 20 saves and rebuilds it 0 times", async () => {
    const stub = stubCy();
    // 렌더마다 같은 참조여야 한다 — `handleNodeTap` 은 populate effect 의 dep 이다.
    const params = {
      cyReady: true,
      cyRef: { current: stub.cy },
      graphScope: "local" as const,
      handleNodeTap: () => {},
      simRef: { current: null },
    };
    const { result } = renderHook(() => useGraphData(params));
    await settle();
    expect(getLinkIndex).toHaveBeenCalledTimes(1);

    // 저장 = 그 파일의 index 갱신 → indexVersion 증가(use-auto-save.ts). 저장마다 기다린다 —
    // 몰아서 올리면 effect 가 취소돼 횟수가 아무것도 말하지 않는다.
    for (let i = 0; i < 20; i++) {
      act(() => useLinkStore.getState().invalidate());
      await settle();
    }

    // 이것을 실패시키는 것: 단일 vault 분기에 `await refreshIndex(rootPath)` 를 되돌린다.
    expect(refreshIndex).toHaveBeenCalledTimes(0);
    expect(getLinkIndex).toHaveBeenCalledTimes(21);

    // 저장으로 생긴 링크가 graph 에 나타난다 — 위의 0 이 graph 가 멈춰서가 아니다.
    getLinkIndex.mockResolvedValue(graph([[A, B]]));
    act(() => useLinkStore.getState().invalidate());
    await settle();
    expect(edgesIn(stub.added)).toEqual([`${A}->${B}`]);
    expect(result.current.edgeCount).toBe(1);
  });
});
