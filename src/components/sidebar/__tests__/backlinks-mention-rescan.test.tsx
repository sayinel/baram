// §34 issue 791 — the unlinked-mention search runs again when its inputs change, and only then.
//
// The search (`getUnlinkedMentions` → `find_unlinked_mentions`) walks the vault and reads the OTHER
// notes' bodies for the viewed note's name. Its inputs are that name, the vault, and other notes'
// text on disk — `announceNoteChanges` (`services/note-changes.ts`), not `indexVersion`. Counted by
// calls.
import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getBacklinks = vi.fn();
const getUnlinkedMentions = vi.fn();
const writeFile = vi.fn();
vi.mock("../../../ipc/invoke", () => ({
  getBacklinks: (...a: unknown[]) => getBacklinks(...a),
  getUnlinkedMentions: (...a: unknown[]) => getUnlinkedMentions(...a),
  readFile: vi.fn().mockResolvedValue("a line that says Alpha here"),
  refreshIndex: vi.fn().mockResolvedValue(undefined),
  updateFileIndex: vi.fn().mockResolvedValue(undefined),
  writeFile: (...a: unknown[]) => writeFile(...a),
  // tauri-storage(설정 store 영속화)가 ipc/invoke 재export 로 부른다
  getConfig: vi.fn().mockResolvedValue(null),
  setConfig: vi.fn().mockResolvedValue(undefined),
}));

import type { EditorTab } from "../../../stores/editor/editor";

import { announceNoteChanges } from "../../../services/note-changes";
import { useEditorStore } from "../../../stores/editor/editor";
import { useLinkStore } from "../../../stores/editor/link";
import { useFileStore } from "../../../stores/file/file";
import { Backlinks } from "../Backlinks";

const A = "/v/Alpha.md";
const B = "/v/Beta.md";
const C = "/v/c.md";

/** 마운트 뒤 첫 검색(rootPath effect 와 파일 effect)이 끝난 상태에서 센다. */
async function mounted() {
  const view = render(<Backlinks />);
  await settle();
  getUnlinkedMentions.mockClear();
  getBacklinks.mockClear();
  return view;
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

function show(filePath: string): void {
  useEditorStore.setState({
    activeTabId: "t1",
    tabs: [{ filePath, id: "t1", title: "t" } as EditorTab],
  });
}

beforeEach(() => {
  getBacklinks.mockReset().mockResolvedValue([]);
  getUnlinkedMentions.mockReset().mockResolvedValue([]);
  writeFile.mockReset().mockResolvedValue(undefined);
  useFileStore.setState({ rootPath: "/v" });
  useLinkStore.setState({ indexVersion: 0, unlinkedMentions: [] });
  show(A);
});

describe("§34 Backlinks — when the unlinked-mention search runs (issue 791)", () => {
  // 이것을 실패시키는 것: mention 검색을 다시 `indexVersion` 에 묶거나(main 의 effect 모양),
  // 변경 경로를 보지 않고 모든 알림에 다시 찾는다.
  it("does not search again on 20 saves of the viewed note, and still refreshes its backlinks", async () => {
    await mounted();

    for (let i = 0; i < 20; i++) {
      // 저장 한 번 = 그 노트의 쓰기 알림(writeFile · 감시자 메아리) + link index 갱신 신호.
      act(() => {
        announceNoteChanges([A]);
        useLinkStore.getState().invalidate();
      });
      await settle();
    }

    expect(getUnlinkedMentions).toHaveBeenCalledTimes(0);
    // backlink 조회는 저장마다 돈다 — 위의 0 이 패널이 죽어서가 아니다.
    expect(getBacklinks).toHaveBeenCalledTimes(20);
  });

  // 이것을 실패시키는 것: Backlinks 의 `onNoteChanges` 구독을 지운다 — 리뷰의 사례: embed 쓰기
  // (`use-embed-sync`)나 외부 편집이 다른 노트의 본문만 바꾸면 신호가 없었다.
  it("searches again when another note changed on disk, links unchanged", async () => {
    await mounted();

    act(() => announceNoteChanges([B]));
    await settle();

    expect(getUnlinkedMentions).toHaveBeenCalledTimes(1);
    expect(getUnlinkedMentions).toHaveBeenLastCalledWith(A, "/v");
  });

  // 이것을 실패시키는 것: 알림을 store 필드 하나(마지막 값)로 전한다 — 한 render 에 닿은 두
  // 알림 중 앞의 것을 잃는다(이 PR 의 첫 판이 `savedPath` 로 그렇게 했다).
  it("hears another note's change and its own save that reach one render", async () => {
    await mounted();

    act(() => {
      announceNoteChanges([B]);
      announceNoteChanges([A]);
    });
    await settle();

    expect(getUnlinkedMentions).toHaveBeenCalledTimes(1);
  });

  it("does not search again when only the link index changed", async () => {
    await mounted();

    act(() => useLinkStore.getState().invalidate());
    await settle();

    expect(getUnlinkedMentions).toHaveBeenCalledTimes(0);
    expect(getBacklinks).toHaveBeenCalledTimes(1);
  });

  it("searches for the new name when another note is shown", async () => {
    await mounted();

    act(() => show(C));
    await settle();

    expect(getUnlinkedMentions).toHaveBeenCalledTimes(1);
    expect(getUnlinkedMentions).toHaveBeenCalledWith(C, "/v");
  });
});
