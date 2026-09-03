import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// vi.mock factories are hoisted above top-level consts, so the mocked fns
// must be created via vi.hoisted() to be safely referenced inside them
// (mirrors use-zettel-hub-data.test.ts).
const { listDir, readFile } = vi.hoisted(() => ({
  listDir: vi.fn(),
  readFile: vi.fn(),
}));
vi.mock("../../../ipc/invoke", () => ({ listDir, readFile }));

import { useSettingsStore } from "../../../stores/settings/store";
import { useCaptureTargets } from "../use-capture-targets";

/** A `notes/`-shaped FileEntry — filename carries no leading Zettel id so
 *  `parseNoteTitle` returns it verbatim as the title. */
function noteEntry(path: string) {
  return {
    isDir: false,
    modifiedAt: 1,
    name: path.split("/").pop()!,
    path,
    size: 0,
  };
}

describe("useCaptureTargets", () => {
  beforeEach(() => {
    listDir.mockReset();
    readFile.mockReset();
    useSettingsStore.setState({ zettelkastenDirectory: "/z" });
  });

  // 노트 후보를 **한 번만** 읽는 것 — 태그를 한 글자 칠 때마다 Zettel 공간을 다시 훑으면
  // 타이핑이 IPC 폭풍을 만든다.
  it("reads the notes directory once per dialog open, not per keystroke", async () => {
    listDir.mockResolvedValue([]);
    const { rerender } = renderHook(
      ({ tags }) => useCaptureTargets(true, tags),
      { initialProps: { tags: ["영"] } },
    );
    await waitFor(() => expect(listDir).toHaveBeenCalledTimes(1));
    rerender({ tags: ["영감"] });
    rerender({ tags: ["영감노트"] });
    expect(listDir).toHaveBeenCalledTimes(1);
  });

  it("resolves targets from the loaded notes as the tag list changes", async () => {
    listDir.mockResolvedValue([
      noteEntry("/z/notes/Hub.md"),
      noteEntry("/z/notes/Other.md"),
    ]);
    readFile.mockImplementation(async (path: string) =>
      path.endsWith("Hub.md") ? "# Hub\n" : "# Other\n",
    );

    const { rerender, result } = renderHook(
      ({ tags }: { tags: string[] }) => useCaptureTargets(true, tags),
      { initialProps: { tags: ["Hub"] } },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.targets.map((t) => t.title)).toEqual(["Hub"]);

    rerender({ tags: ["Other"] });
    expect(result.current.targets.map((t) => t.title)).toEqual(["Other"]);

    rerender({ tags: ["Neither"] });
    expect(result.current.targets).toEqual([]);
  });

  it("reports the capture count for each target", async () => {
    listDir.mockResolvedValue([noteEntry("/z/notes/Hub.md")]);
    // The `## Captures` section carries two capture block ids (`^m…`).
    readFile.mockResolvedValue(
      "# Hub\n\n## Captures\n\n" +
        "### 2026-09-01 10:00 ^m2609011000\nA\n\n" +
        "### 2026-09-01 11:00 ^m2609011100\nB\n",
    );

    const { result } = renderHook(() => useCaptureTargets(true, ["Hub"]));
    await waitFor(() =>
      expect(result.current.targets[0]?.captureCount).toBe(2),
    );
  });

  // ‼️ `loading`이 참인 동안은 대상이 빈 배열이다. 미리보기가 이 구분을 못 하면 노트를
  // 읽는 사이에 "일치하는 노트 없음"을 잠깐 보여 준다 — 사용자가 오타라고 믿는다.
  //
  // ‼️ 열린 채로 렌더하면 이 단정은 초기값을 못 본다: 마운트 effect가 `setLoading(true)`를
  // `act()` 안에서 동기적으로 다시 찍어, `useState(false)`로 바꿔도 이 자리에서는 여전히
  // `true`로 보인다(뮤테이션 생존 확인함). 처음엔 **닫힌 채로** 렌더해 effect 본문이
  // 아예 안 도는 상태에서 초기값 자체를 본다.
  it("is loading until the notes have been read", async () => {
    listDir.mockResolvedValue([]);
    const { rerender, result } = renderHook(
      ({ open }: { open: boolean }) => useCaptureTargets(open, ["Hub"]),
      { initialProps: { open: false } },
    );
    expect(result.current.loading).toBe(true);
    expect(result.current.targets).toEqual([]);

    rerender({ open: true });
    expect(result.current.loading).toBe(true);
    expect(result.current.targets).toEqual([]);
    await waitFor(() => expect(result.current.loading).toBe(false));
  });

  it("does nothing while closed", () => {
    renderHook(() => useCaptureTargets(false, ["영감노트"]));
    expect(listDir).not.toHaveBeenCalled();
  });

  // notes/ 아래만 본다 — `inbox/`의 fleeting note는 대상이 아니다(제목이 없다).
  it("only considers files under notes/", async () => {
    listDir.mockImplementation(async (dir: string) => {
      if (dir === "/z/notes") return [noteEntry("/z/notes/Hub.md")];
      // What an un-scoped scan of the whole Zettel space would additionally
      // surface — the fleeting note lives in inbox/ and must not become a
      // target even though its title matches the tag below.
      //
      // ‼️ The title must not contain a space: `resolveCaptureTargets` only
      // compares a whitespace-free title directly against the (space-free)
      // tag input, else it falls back to aliases-only — a space in the title
      // would make this fixture fail to match for a reason unrelated to
      // notes/ scoping and the mutation this test targets would survive.
      return [
        noteEntry("/z/notes/Hub.md"),
        noteEntry("/z/inbox/FleetingHub.md"),
      ];
    });
    readFile.mockImplementation(async (path: string) =>
      path.includes("FleetingHub") ? "# FleetingHub\n" : "# Hub\n",
    );

    const { result } = renderHook(() =>
      useCaptureTargets(true, ["FleetingHub"]),
    );
    await waitFor(() => expect(listDir).toHaveBeenCalled());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.targets).toEqual([]);
  });

  // ‼️ 열림 전환마다 다시 읽는 것. 다이얼로그는 언마운트되지 않고 `null`을 반환하므로
  // (`QuickCaptureDialog.tsx:323`) 한 번만 읽는 구현은 그 세션 동안 새로 만든 허브 노트를
  // 영원히 못 본다.
  it("re-reads on the next open", async () => {
    // A stable reference, deliberately — an inline array literal here would
    // be a new reference on every render and mask the effect's `[open]`-only
    // dependency behind an accidentally-stable-enough test.
    const tags = ["새허브"];
    listDir.mockResolvedValue([noteEntry("/z/notes/Hub.md")]);
    readFile.mockResolvedValue("# Hub\n");

    const { rerender, result } = renderHook(
      ({ open }: { open: boolean }) => useCaptureTargets(open, tags),
      { initialProps: { open: true } },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    // "새허브" doesn't match the only note loaded so far ("Hub").
    expect(result.current.targets).toEqual([]);

    rerender({ open: false });

    // A hub note created elsewhere during this session — only a re-scan on
    // the next open can see it.
    listDir.mockResolvedValue([
      noteEntry("/z/notes/Hub.md"),
      noteEntry("/z/notes/새허브.md"),
    ]);
    readFile.mockImplementation(async (path: string) =>
      path.includes("새허브") ? "# 새허브\n" : "# Hub\n",
    );

    rerender({ open: true });
    await waitFor(() => expect(result.current.targets).toHaveLength(1));
    expect(result.current.targets[0]?.title).toBe("새허브");
  });
});
