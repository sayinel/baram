// §30 Graph 는 저장마다 링크 index 를 다시 만들지 않고, 저장이 고쳐 둔 index 를 읽는다(issue 790).
// 실제 seam 으로 센다 — useAutoSave(실제 Tiptap 에디터) → writeFile → updateFileIndex → invalidate →
// useGraphData 의 getLinkIndex. index 는 가짜다: updateFileIndex 가 "디스크" 의 내용에서 링크를
// 읽어 두고, getLinkIndex 가 그것으로 graph 를 짓는다. 그래서 auto-save 가 index 를 고치지 않으면
// graph 에 링크가 나타나지 않는다.
import type { LinkGraph } from "../../../ipc/types";
import type { Core, ElementDefinition } from "cytoscape";

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const disk = new Map<string, string>();
const indexed = new Map<string, string[]>();
const refreshIndex = vi.fn();
const getLinkIndex = vi.fn(
  async (): Promise<LinkGraph> =>
    ({
      edges: [...indexed].flatMap(([from, targets]) =>
        targets.map((t) => ({ from, to: `/v/${t}.md` })),
      ),
      nodes: [...indexed.keys()],
    }) as LinkGraph,
);
const updateFileIndex = vi.fn(async (path: string) => {
  const links = [...(disk.get(path) ?? "").matchAll(/\[\[([^\]|]+)/g)];
  indexed.set(
    path,
    links.map((m) => m[1]),
  );
});
vi.mock("../../../ipc/invoke", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../ipc/invoke")>()),
  getConfig: vi.fn().mockResolvedValue(null),
  getLinkIndex: () => getLinkIndex(),
  refreshIndex: (...a: unknown[]) => refreshIndex(...a),
  setConfig: vi.fn().mockResolvedValue(undefined),
  updateFileIndex: (path: string) => updateFileIndex(path),
  writeFile: vi.fn(async (path: string, content: string) => {
    disk.set(path, content);
  }),
}));

import { useAutoSave } from "../../../hooks/use-auto-save";
import { useContextStore } from "../../../stores/context/context";
import { useEditorStore } from "../../../stores/editor/editor";
import { useLinkStore } from "../../../stores/editor/link";
import { useFileStore } from "../../../stores/file/file";
import { useSettingsStore } from "../../../stores/settings/store";
import { useGraphData } from "../use-graph-data";

const A = "/v/a.md";
const B = "/v/b.md";

function edgesIn(defs: ElementDefinition[]): string[] {
  return defs
    .filter((d) => d.data.source !== undefined)
    .map((d) => `${d.data.source}->${d.data.target}`);
}

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

beforeEach(() => {
  disk.clear();
  indexed.clear();
  indexed.set(A, []);
  refreshIndex.mockReset().mockResolvedValue(undefined);
  getLinkIndex.mockClear();
  updateFileIndex.mockClear();
  useFileStore.setState({ rootPath: "/v" });
  useContextStore.setState({ contexts: [] });
  useLinkStore.setState({ indexVersion: 0, savedPath: null });
  useSettingsStore.setState({ autoSave: true, autoSaveDelay: 2000 });
  useEditorStore.setState({
    activeTabId: "t1",
    tabs: [
      { filePath: A, id: "t1", isDirty: false, isPinned: false, title: "a" },
    ],
  } as never);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useGraphData — a save does not rebuild the link index", () => {
  it("reads the index the save updated on each of 20 auto-saves and rebuilds it 0 times", async () => {
    const { Editor } = await import("@tiptap/core");
    const { createBaramExtensions } = await import("../../../extensions");
    const editor = new Editor({
      content: "<p>start</p>",
      extensions: createBaramExtensions(),
    });
    vi.useFakeTimers();

    const stub = stubCy();
    // 렌더마다 같은 참조여야 한다 — `handleNodeTap` 은 populate effect 의 dep 이다.
    const params = {
      cyReady: true,
      cyRef: { current: stub.cy },
      graphScope: "local" as const,
      handleNodeTap: () => {},
      simRef: { current: null },
    };
    const { result } = renderHook(() => {
      useAutoSave(editor);
      return useGraphData(params);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(getLinkIndex).toHaveBeenCalledTimes(1);

    // 저장마다 기다린다 — 몰아서 올리면 effect 가 취소돼 횟수가 아무것도 말하지 않는다.
    for (let i = 0; i < 20; i++) {
      act(() => {
        editor.commands.insertContent(i === 19 ? " see [[b]]" : " x");
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2500);
      });
    }

    // 이것을 실패시키는 것: use-graph-data.ts 단일 vault 분기에 `await refreshIndex(rootPath)` 를
    // 되돌린다.
    expect(refreshIndex).toHaveBeenCalledTimes(0);
    expect(updateFileIndex).toHaveBeenCalledTimes(20);
    expect(getLinkIndex).toHaveBeenCalledTimes(21);
    // 마지막 저장이 쓴 링크가 graph 에 나타난다 — 위의 0 이 graph 가 멈춰서가 아니다.
    // 이것을 실패시키는 것: use-auto-save.ts 의 `updateFileIndex(pending.filePath)` 를
    // `Promise.resolve()` 로 바꾼다(index 가 저장을 모른다).
    expect(edgesIn(stub.added)).toEqual([`${A}->${B}`]);
    expect(result.current.edgeCount).toBe(1);

    editor.destroy();
  });
});
