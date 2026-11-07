// §34 issue 791 — the unlinked-mention search runs again when its inputs change, and only then.
//
// The search (`getUnlinkedMentions` → `find_unlinked_mentions`) walks the vault and reads the OTHER
// notes' bodies for the viewed note's name. Its inputs are that name, the vault, and other notes'
// text on disk — the announcements of `services/note-changes.ts`, not `indexVersion`. Counted by
// calls; the answer's ownership (a late answer for another note) is checked on screen and in the
// store.
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

import type { UnlinkedMention } from "../../../ipc/types";
import type { EditorTab } from "../../../stores/editor/editor";

import {
  announceNoteChanges,
  announceUnnamedNoteChanges,
} from "../../../services/note-changes";
import { useEditorStore } from "../../../stores/editor/editor";
import { useLinkStore } from "../../../stores/editor/link";
import { useFileStore } from "../../../stores/file/file";
import { Backlinks } from "../Backlinks";

const A = "/v/Alpha.md";
const B = "/v/Beta.md";
const C = "/v/c.md";

function mention(sourcePath: string, context: string): UnlinkedMention {
  const matchText = /Alpha|Beta/.exec(context)?.[0] ?? "";
  return { context, line: 1, matchText, sourcePath };
}

/** A search whose answer the test hands back when it chooses. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

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
  useLinkStore.setState({
    indexVersion: 0,
    unlinkedMentions: [],
    unlinkedMentionsFor: null,
  });
  show(A);
});

describe("§34 Backlinks — when the unlinked-mention search runs (issue 791)", () => {
  // 이것을 실패시키는 것: mention 검색을 다시 `indexVersion` 에 묶거나, 변경 경로를 보지 않고 모든
  // 알림에 다시 찾는다.
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

  // 이것을 실패시키는 것: Backlinks 의 `onNoteChanges` 구독을 지운다 — embed 쓰기(`use-embed-sync`)나
  // 외부 편집은 다른 노트의 본문만 바꾸고 `indexVersion` 은 올리지 않는다.
  it("searches again when another note changed on disk, links unchanged", async () => {
    await mounted();

    act(() => announceNoteChanges([B]));
    await settle();

    expect(getUnlinkedMentions).toHaveBeenCalledTimes(1);
    expect(getUnlinkedMentions).toHaveBeenLastCalledWith(A, "/v");
  });

  // 이것을 실패시키는 것: 알림을 store 필드 하나(마지막 값)로 전한다 — 한 render 에 닿은 두
  // 알림 중 앞의 것을 잃는다.
  it("hears another note's change and its own save that reach one render", async () => {
    await mounted();

    act(() => {
      announceNoteChanges([B]);
      announceNoteChanges([A]);
    });
    await settle();

    expect(getUnlinkedMentions).toHaveBeenCalledTimes(1);
  });

  // 이것을 실패시키는 것: 리스너가 `null` 을 건너뛴다 — 폴더가 옮겨 가도 목록이 그대로다.
  it("searches again on a change that names no note", async () => {
    await mounted();

    act(() => announceUnnamedNoteChanges());
    await settle();

    expect(getUnlinkedMentions).toHaveBeenCalledTimes(1);
  });

  // 이것을 실패시키는 것: 리스너의 `unlinkedMentionsFor !== path` 를 지운다 — 검색이 실패하면 자기
  // 저장이 건너뛰기에 걸려, 다른 노트가 바뀌거나 노트를 떠날 때까지 목록이 비어 있다.
  it("lets the viewed note's own save search again after a failed search", async () => {
    await mounted();
    getUnlinkedMentions.mockRejectedValueOnce(new Error("walk failed"));
    act(() => announceNoteChanges([B]));
    await settle();
    getUnlinkedMentions.mockClear();

    act(() => announceNoteChanges([A]));
    await settle();

    expect(getUnlinkedMentions).toHaveBeenCalledTimes(1);
    expect(useLinkStore.getState().unlinkedMentionsFor).toBe(A);
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

describe("§34 Backlinks — signals do not pile up walks (issue 791)", () => {
  // 이것을 실패시키는 것: 신호마다 검색을 새로 시작한다(호출 100번), 또는 `again` 을 보지 않는다
  // (마지막 호출 수가 1번이고 뒤의 변경을 놓친다).
  it("walks once at a time for a note, and once more for what arrived during it", async () => {
    const first = deferred<UnlinkedMention[]>();
    const second = deferred<UnlinkedMention[]>();
    await mounted();
    getUnlinkedMentions
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    act(() => {
      for (let i = 0; i < 100; i++) announceNoteChanges([B]);
    });
    await settle();
    expect(getUnlinkedMentions).toHaveBeenCalledTimes(1);

    await act(async () => first.resolve([]));
    await settle();
    expect(getUnlinkedMentions).toHaveBeenCalledTimes(2);

    await act(async () => second.resolve([]));
    await settle();
    expect(getUnlinkedMentions).toHaveBeenCalledTimes(2);
  });

  // 이것을 실패시키는 것: 다시 찾을 표시가 있는 답을 버린다 — 쓰기가 검색보다 빠르게 이어지면
  // 스트림이 끝날 때까지 답이 하나도 보이지 않는다.
  it("delivers a walk's answer even when another walk is marked to follow", async () => {
    const first = deferred<UnlinkedMention[]>();
    const view = await mounted();
    getUnlinkedMentions
      .mockReturnValueOnce(first.promise)
      .mockReturnValue(new Promise(() => undefined));

    act(() => {
      announceNoteChanges([B]);
      announceNoteChanges([B]);
    });
    await act(async () => first.resolve([mention(C, "c says Alpha here")]));
    await settle();

    expect(view.container.textContent).toContain("c says Alpha here");
  });

  // 이것을 실패시키는 것: `while` 의 `mentionSearchRef.current === search` 를 지운다 — 떠난 노트를
  // 한 번 더 찾는다.
  it("does not run the marked walk again for a note it moved away from", async () => {
    const forA = deferred<UnlinkedMention[]>();
    await mounted();
    getUnlinkedMentions.mockImplementation((path: string) =>
      path === A ? forA.promise : Promise.resolve([]),
    );

    act(() => {
      announceNoteChanges([C]);
      announceNoteChanges([C]);
    });
    act(() => show(B));
    await settle();
    await act(async () => forA.resolve([]));
    await settle();

    const searchedForA = getUnlinkedMentions.mock.calls.filter(
      ([path]) => path === A,
    );
    expect(searchedForA).toHaveLength(1);
  });

  // 이것을 실패시키는 것: `catch` 뒤에 루프를 빠져나간다 — 실패한 walk 동안 온 변경을 잃는다.
  it("runs the marked walk after a failed one", async () => {
    const first = deferred<UnlinkedMention[]>();
    let fail!: (e: Error) => void;
    await mounted();
    getUnlinkedMentions
      .mockReturnValueOnce(
        new Promise((_, reject) => {
          fail = reject;
        }),
      )
      .mockReturnValueOnce(first.promise);

    act(() => {
      announceNoteChanges([B]);
      announceNoteChanges([B]);
    });
    await act(async () => fail(new Error("a folder vanished mid-walk")));
    await settle();

    expect(getUnlinkedMentions).toHaveBeenCalledTimes(2);
    await act(async () => first.resolve([]));
    await settle();
    expect(useLinkStore.getState().unlinkedMentionsFor).toBe(A);
  });
});

describe("§34 Backlinks — an answer belongs to the note it was searched for (issue 791)", () => {
  // A 에서 B 로 빠르게 옮겨 B 의 답이 먼저, A 의 답이 나중에 온다.
  // 이것을 실패시키는 것: `fetchUnlinkedMentions` 의 `mentionSearchRef.current === search`
  // 검사를 지운다 — A 의 답이 store 를 차지해, 렌더 관문이 B 의 답을 가린다.
  it("drops a late answer for the note it moved away from", async () => {
    const forA = deferred<UnlinkedMention[]>();
    const forB = deferred<UnlinkedMention[]>();
    const view = await mounted();
    getUnlinkedMentions.mockImplementation((path: string) =>
      path === A ? forA.promise : forB.promise,
    );
    act(() => announceNoteChanges([C])); // A 를 다시 찾는다 — 답은 아직
    act(() => show(B)); // B 로 옮긴다 — B 도 찾는다
    await settle();

    await act(async () => forB.resolve([mention(C, "c says Beta here")]));
    await act(async () => forA.resolve([mention(C, "c says Alpha here")]));
    await settle();

    expect(useLinkStore.getState().unlinkedMentionsFor).toBe(B);
    expect(view.container.textContent).toContain("c says Beta here");
    expect(view.container.textContent).not.toContain("c says Alpha here");
  });

  // 이것을 실패시키는 것: unmount 의 `mentionSearchRef.current = null` 을 지운다 — 닫힌 패널의 검색이
  // 끝나며 store 의 답을 덮어, 그 노트의 답이 보이지 않게 된다(패널은 사이드바를 바꿀 때마다 닫힌다).
  it("drops the answer of a panel that was closed", async () => {
    const forA = deferred<UnlinkedMention[]>();
    const closed = await mounted();
    getUnlinkedMentions.mockImplementation(() => forA.promise);
    act(() => announceNoteChanges([C]));
    await settle();
    closed.unmount();

    show(B);
    getUnlinkedMentions.mockReset();
    getUnlinkedMentions.mockResolvedValue([mention(C, "c says Beta here")]);
    const reopened = render(<Backlinks />);
    await settle();
    await act(async () => forA.resolve([mention(C, "c says Alpha here")]));
    await settle();

    expect(useLinkStore.getState().unlinkedMentionsFor).toBe(B);
    expect(reopened.container.textContent).toContain("c says Beta here");
  });

  // 이것을 실패시키는 것: 렌더의 `unlinkedMentionsFor === filePath` 관문을 지운다.
  it("shows nothing of another note's answer while the viewed note's search runs", async () => {
    const forB = deferred<UnlinkedMention[]>();
    const view = await mounted();
    act(() =>
      useLinkStore
        .getState()
        .setUnlinkedMentions(A, [mention(C, "c says Alpha here")]),
    );
    expect(view.container.textContent).toContain("c says Alpha here");

    getUnlinkedMentions.mockImplementation(() => forB.promise);
    act(() => show(B));
    await settle();

    expect(view.container.textContent).not.toContain("c says Alpha here");
  });

  // 긍정 짝 — "Link" 는 답이 찾아진 노트(`unlinkedMentionsFor`)의 이름으로 쓴다. 다른 노트의 답은
  // 위의 렌더 관문이 보이지 않게 하므로, 그 답의 버튼은 누를 수 없다.
  it("links a mention to the note it was found for", async () => {
    const view = await mounted();
    act(() =>
      useLinkStore
        .getState()
        .setUnlinkedMentions(A, [mention(C, "a line that says Alpha here")]),
    );

    const link = view.container.querySelector<HTMLElement>(
      ".backlinks-linkify-btn",
    );
    expect(link).not.toBeNull();
    await act(async () => link!.click());
    await settle();

    expect(writeFile).toHaveBeenCalledWith(
      C,
      "a line that says [[Alpha]] here",
    );
  });

  // 이것을 실패시키는 것: 실패한 검색이 `setUnlinkedMentions(path, [])` 로 "이 노트의 답은 0개" 를
  // 남긴다 — 다음 검색 전까지 실패가 답처럼 보인다.
  it("keeps a failed search from passing for an empty answer", async () => {
    await mounted();
    getUnlinkedMentions.mockRejectedValueOnce(new Error("walk failed"));

    act(() => announceNoteChanges([B]));
    await settle();

    expect(useLinkStore.getState().unlinkedMentionsFor).toBeNull();
  });
});
