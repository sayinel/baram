// §34 보고 있는 노트를 저장해도 unlinked mention 을 다시 찾지 않는다(issue 791).
// 횟수로 고정한다 — getUnlinkedMentions(vault 를 걸어 다른 노트를 전부 읽는 검색) 호출 수.
import { useLayoutEffect } from "react";

import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getBacklinks = vi.fn();
const getUnlinkedMentions = vi.fn();
vi.mock("../../../ipc/invoke", () => ({
  getBacklinks: (...a: unknown[]) => getBacklinks(...a),
  getUnlinkedMentions: (...a: unknown[]) => getUnlinkedMentions(...a),
  readFile: vi.fn().mockResolvedValue(""),
  refreshIndex: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  // tauri-storage(설정 store 영속화)가 ipc/invoke 재export 로 부른다
  getConfig: vi.fn().mockResolvedValue(null),
  setConfig: vi.fn().mockResolvedValue(undefined),
}));

import type { EditorTab } from "../../../stores/editor/editor";

import { useEditorStore } from "../../../stores/editor/editor";
import { useLinkStore } from "../../../stores/editor/link";
import { useFileStore } from "../../../stores/file/file";
import { Backlinks } from "../Backlinks";

const A = "/v/a.md";
const B = "/v/b.md";
const C = "/v/c.md";

/** 마운트 뒤 첫 검색(rootPath effect 와 파일 effect)이 끝난 상태에서 센다. */
async function mounted(): Promise<void> {
  render(<Backlinks />);
  await settle();
  getUnlinkedMentions.mockClear();
  getBacklinks.mockClear();
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

function view(filePath: string): void {
  useEditorStore.setState({
    activeTabId: "t1",
    tabs: [{ filePath, id: "t1", title: "t" } as EditorTab],
  });
}

beforeEach(() => {
  getBacklinks.mockReset().mockResolvedValue([]);
  getUnlinkedMentions.mockReset().mockResolvedValue([]);
  useFileStore.setState({ rootPath: "/v" });
  useLinkStore.setState({ indexVersion: 0, savedPath: null });
  view(A);
});

describe("Backlinks — unlinked-mention search per save", () => {
  // 이것을 실패시키는 것: `if (!selfSave)` 를 지워 언제나 검색한다.
  it("does not search again on 20 saves of the viewed note, and still refreshes its backlinks", async () => {
    await mounted();

    for (let i = 0; i < 20; i++) {
      act(() => useLinkStore.getState().invalidate(A));
      await settle();
    }

    expect(getUnlinkedMentions).toHaveBeenCalledTimes(0);
    // 같은 effect 의 backlink 조회는 저장마다 돈다 — 위의 0 이 effect 가 죽어서가 아니다.
    expect(getBacklinks).toHaveBeenCalledTimes(20);
  });

  // 이것을 실패시키는 것: `useLinkStore.getState().savedPath === filePath` 를 지운다.
  it("searches again when another note is saved, or when the cause is unknown", async () => {
    await mounted();

    act(() => useLinkStore.getState().invalidate(B));
    await settle();
    act(() => useLinkStore.getState().invalidate());
    await settle();

    expect(getUnlinkedMentions).toHaveBeenCalledTimes(2);
    expect(getUnlinkedMentions).toHaveBeenLastCalledWith(A, "/v");
  });

  // 이것을 실패시키는 것: `mentionsForRef.current === filePath` 를 지운다.
  it("searches again for the new name when the viewed note is renamed and saved in one render", async () => {
    await mounted();

    act(() => {
      view(C);
      useLinkStore.getState().invalidate(C);
    });
    await settle();

    expect(getUnlinkedMentions).toHaveBeenCalledTimes(1);
    expect(getUnlinkedMentions).toHaveBeenCalledWith(C, "/v");
  });

  // 이것을 실패시키는 것: `indexVersion === seenVersionRef.current + 1` 을 지운다.
  it("searches again when another note's save and its own reach one render", async () => {
    await mounted();

    act(() => {
      useLinkStore.getState().invalidate(B);
      useLinkStore.getState().invalidate(A);
    });
    await settle();

    expect(getUnlinkedMentions).toHaveBeenCalledTimes(1);
  });

  // 이것을 실패시키는 것: effect 가 `savedPath` 를 렌더에서 고른 값 대신
  // `useLinkStore.getState().savedPath` 로 읽는다.
  it("does not take a later self-save for the bump of another note's save", async () => {
    // B 의 저장이 그린 렌더가 커밋되고 그 passive effect 가 돌기 전에 A 의 저장이 온다. layout
    // effect 는 커밋 안에서 passive effect 보다 먼저 돈다 — 그 자리에서 두 번째 bump 를 올린다.
    function SaveAAfterB() {
      const version = useLinkStore((s) => s.indexVersion);
      useLayoutEffect(() => {
        if (version === 1) useLinkStore.getState().invalidate(A);
      }, [version]);
      return null;
    }
    render(
      <>
        <Backlinks />
        <SaveAAfterB />
      </>,
    );
    await settle();
    getUnlinkedMentions.mockClear();

    act(() => useLinkStore.getState().invalidate(B));
    await settle();

    expect(useLinkStore.getState().indexVersion).toBe(2);
    expect(getUnlinkedMentions).toHaveBeenCalledTimes(1);
  });
});
