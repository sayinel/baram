import type { AddressableNote } from "../use-capture-targets";

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// vi.mock factories are hoisted above top-level consts, so the mocked fns
// must be created via vi.hoisted() to be safely referenced inside them
// (mirrors use-capture-targets.test.tsx). `listDir`/`readFile` stay mocked
// here too — the point of this file is to prove the hook no longer calls
// them, which needs a spy that would notice a call. `getConfig`/`setConfig`
// are stubs only — this suite mutates `useFileStore`/`useSettingsStore`
// directly, which fires the settings store's persist middleware into
// `tauriStorage`; without stubs it logs spurious "no such export" noise.
const { getVaultTags, listDir, readFile, getConfig, setConfig } = vi.hoisted(
  () => ({
    getVaultTags: vi.fn(),
    listDir: vi.fn(),
    readFile: vi.fn(),
    getConfig: vi.fn().mockResolvedValue(null),
    setConfig: vi.fn().mockResolvedValue(undefined),
  }),
);
vi.mock("../../../ipc/invoke", () => ({
  getVaultTags,
  listDir,
  readFile,
  getConfig,
  setConfig,
}));

import { useFileStore } from "../../../stores/file/file";
import { useSettingsStore } from "../../../stores/settings/store";
import { logger } from "../../../utils/logger";
import { useCaptureTags } from "../use-capture-tags";

/** A synthetic input change event carrying only what `onChange` reads:
 *  `target.value` and `target.selectionStart`. Cursor is placed at the end
 *  of the typed text, matching ordinary typing. */
function changeEvent(value: string): React.ChangeEvent<HTMLInputElement> {
  return {
    target: { selectionStart: value.length, value },
  } as unknown as React.ChangeEvent<HTMLInputElement>;
}

/** A synthetic keydown event carrying only what `onKeyDown` reads. */
function keyEvent(key: string): React.KeyboardEvent<HTMLInputElement> {
  return {
    key,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  } as unknown as React.KeyboardEvent<HTMLInputElement>;
}

/** No notes reachable — most tests don't care about §324-b's note suggestions. */
const EMPTY_ADDRESSABLE_NAMES: Map<string, AddressableNote> = new Map();

/** Builds an `addressableNames` map the way `useCaptureTargets` would, from
 *  `[display name, capture count]` pairs. */
function addressableNames(
  ...entries: [string, number][]
): Map<string, AddressableNote> {
  return new Map(
    entries.map(([display, captureCount]) => [
      display.toLowerCase(),
      { captureCount, display },
    ]),
  );
}

describe("§324-b useCaptureTags", () => {
  const originalFileState = useFileStore.getState();
  const originalSettingsState = useSettingsStore.getState();

  beforeEach(() => {
    getVaultTags.mockReset().mockResolvedValue([]);
    listDir.mockReset();
    readFile.mockReset();
    useFileStore.setState({ rootPath: "/vault" } as never);
    useSettingsStore.setState({
      zettelkastenDirectory: "/vault/zettel",
    } as never);
  });

  afterEach(() => {
    useFileStore.setState(originalFileState, true);
    useSettingsStore.setState(originalSettingsState, true);
    vi.restoreAllMocks();
  });

  // ‼️ `SCAN_LIMIT = 100` 회귀 핀. 태그가 주소인 설계에서 제안 목록에서 빠진
  // 허브는 오타를 유발하고 → 매칭 실패 → `inbox` 낙오로 이어진다. 조용히 실패하는 종류다.
  it("suggests a tag beyond the old 100-file scan limit", async () => {
    const many = Array.from({ length: 150 }, (_, i) => ({
      count: 1,
      tag: `t${i}`,
    }));
    getVaultTags.mockResolvedValue(many);
    const { result } = renderHook(() =>
      useCaptureTags(true, EMPTY_ADDRESSABLE_NAMES),
    );
    await waitFor(() => expect(result.current.index.size).toBe(150));
    expect(result.current.index.has("t130")).toBe(true);
  });

  // ‼️ `resolveZettelDir`는 rootPath를 **무시한다**(절대 경로 설정이다 —
  // `zettelkasten.ts:21-29`). vault 루트를 넘기면 Zettel 공간을 포함하지 않는 트리를
  // 훑을 수 있고, 허브가 하나도 제안되지 않는다.
  it("scans the Zettel directory, not the vault root", async () => {
    useFileStore.setState({ rootPath: "/some/vault" } as never);
    useSettingsStore.setState({
      zettelkastenDirectory: "/other/Zettel",
    } as never);
    renderHook(() => useCaptureTags(true, EMPTY_ADDRESSABLE_NAMES));
    await waitFor(() =>
      expect(getVaultTags).toHaveBeenCalledWith("/other/Zettel"),
    );
  });

  it("no longer reads note files one by one", async () => {
    renderHook(() => useCaptureTags(true, EMPTY_ADDRESSABLE_NAMES));
    await waitFor(() => expect(getVaultTags).toHaveBeenCalled());
    expect(listDir).not.toHaveBeenCalled();
    expect(readFile).not.toHaveBeenCalled();
  });

  it("carries the counts through so the dropdown can sort by frequency", async () => {
    getVaultTags.mockResolvedValue([
      { count: 40, tag: "영감노트" },
      { count: 2, tag: "links" },
    ]);
    const { result } = renderHook(() =>
      useCaptureTags(true, EMPTY_ADDRESSABLE_NAMES),
    );
    await waitFor(() => expect(result.current.index.get("영감노트")).toBe(40));
  });

  // ‼️ §320이 `#Baram-Dev-Note` 별칭에 의존한다. TS 질의 정규식이 `-`를 제외하면
  // 자동완성이 `#Baram-` 다음을 못 잇고, `onSelect`는 `#Baram-#baram-dev-note`를 만든다.
  // Rust `is_tag_char`는 하이픈을 포함한다(`md/mod.rs:25-27`) — 두 쪽이 갈려 있다.
  it("completes a hyphenated tag", async () => {
    getVaultTags.mockResolvedValue([{ count: 1, tag: "baram-dev-note" }]);
    const { result } = renderHook(() =>
      useCaptureTags(true, EMPTY_ADDRESSABLE_NAMES),
    );
    await waitFor(() => expect(result.current.index.size).toBe(1));

    act(() => result.current.onChange(changeEvent("#baram-dev")));
    expect(result.current.query).toBe("baram-dev");
    expect(result.current.visible).toBe(true);
  });

  it("replaces the whole hyphenated prefix on select", async () => {
    // 입력 `#baram-dev`에서 `baram-dev-note`를 고르면 `#baram-dev-note ` 하나가 되는 것
    // — `#baram-#baram-dev-note`가 아니다.
    getVaultTags.mockResolvedValue([{ count: 1, tag: "baram-dev-note" }]);
    const { result } = renderHook(() =>
      useCaptureTags(true, EMPTY_ADDRESSABLE_NAMES),
    );
    await waitFor(() => expect(result.current.index.size).toBe(1));

    // `onSelect` reads the cursor off the real input the hook is attached
    // to — a bare mock object would make `input.selectionStart` undefined
    // and silently fall back to `value.length`, which happens to be right
    // here too, so a real element is what actually exercises that read.
    const input = document.createElement("input");
    document.body.appendChild(input);
    result.current.inputRef.current = input;

    act(() => result.current.onChange(changeEvent("#baram-dev")));
    input.value = "#baram-dev";
    input.setSelectionRange(input.value.length, input.value.length);

    act(() => result.current.onSelect("baram-dev-note"));
    expect(result.current.value).toBe("#baram-dev-note ");

    document.body.removeChild(input);
  });

  it("logs and keeps an empty index when the IPC fails", async () => {
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
    getVaultTags.mockRejectedValue(new Error("nope"));
    const { result } = renderHook(() =>
      useCaptureTags(true, EMPTY_ADDRESSABLE_NAMES),
    );
    await waitFor(() => expect(errorSpy).toHaveBeenCalled());
    expect(result.current.index.size).toBe(0);
  });

  describe("§324-b 후속 — note names in the suggestion list", () => {
    // ‼️ 이 테스트가 이 작업 전체의 존재 이유다: `CaptureTest.md`를 막 만들어도 그
    // 제목이 vault 태그 fixture에 **없는** 채로 제안에 뜬다.
    it("suggests a newly created note's title even when no tag has used it yet", async () => {
      getVaultTags.mockResolvedValue([{ count: 3, tag: "other" }]);
      const { result } = renderHook(() =>
        useCaptureTags(true, addressableNames(["CaptureTest", 0])),
      );
      await waitFor(() => expect(result.current.index.size).toBe(1));

      act(() => result.current.onChange(changeEvent("#Captur")));
      expect(result.current.suggestions).toEqual([
        { count: 0, isNote: true, name: "CaptureTest" },
      ]);
      // ‼️ `onChange`의 `visible` 게이트가 여기서 `filterTags(typed, index)`(태그
      // 전용)로 되돌아가면 이 단정은 "제안은 있지만 드롭다운은 안 뜬다"가 되어
      // 사용자에게는 여전히 아무것도 안 보인다 — `suggestions`만 보는 위 단정으로는
      // 못 잡는 결함이라 따로 고정한다.
      expect(result.current.visible).toBe(true);
    });

    // §324-b 후속 규칙 ②: 태그의 사용 빈도가 아무리 높아도 노트가 먼저 온다.
    it("puts a matching note ahead of a matching tag even when the tag has far more uses", async () => {
      getVaultTags.mockResolvedValue([{ count: 100, tag: "applesauce" }]);
      const { result } = renderHook(() =>
        useCaptureTags(true, addressableNames(["Apple", 1])),
      );
      await waitFor(() => expect(result.current.index.size).toBe(1));

      act(() => result.current.onChange(changeEvent("#app")));
      expect(result.current.suggestions.map((s) => s.name)).toEqual([
        "Apple",
        "applesauce",
      ]);
      expect(result.current.suggestions[0].isNote).toBe(true);
    });

    // §324-b 후속 규칙 ②: 소문자 키로 중복 제거 — 노트가 이긴다. 두 조회가 모두
    // 성공해도(노트 맵·태그 맵) 결과에는 한 번만, 태그의 count(20)가 아니라 노트의
    // captureCount(5)로 나타나야 한다.
    it("shows a name once, as a note, when it is both a note and a tag", async () => {
      getVaultTags.mockResolvedValue([{ count: 20, tag: "hub" }]);
      const { result } = renderHook(() =>
        useCaptureTags(true, addressableNames(["Hub", 5])),
      );
      await waitFor(() => expect(result.current.index.size).toBe(1));

      act(() => result.current.onChange(changeEvent("#hub")));
      expect(result.current.suggestions).toEqual([
        { count: 5, isNote: true, name: "Hub" },
      ]);
    });

    // §324-b 후속 규칙 ①: 키보드가 고르는 것과 화면에 보일 배열이 같은 출처
    // (`suggestions`)여야 한다. 노트의 **표시 케이스**(`display`)가 선택되는지도
    // 함께 고정한다 — 소문자 키가 새면 `#baram-dev-note`가 되어 이 단정이 깨진다.
    it("Enter selects the note at the current index, in its original display case", async () => {
      getVaultTags.mockResolvedValue([]);
      const { result } = renderHook(() =>
        useCaptureTags(true, addressableNames(["Baram-Dev-Note", 2])),
      );
      await waitFor(() => expect(result.current.index.size).toBe(0));

      const input = document.createElement("input");
      document.body.appendChild(input);
      result.current.inputRef.current = input;

      act(() => result.current.onChange(changeEvent("#baram")));
      input.value = "#baram";
      input.setSelectionRange(input.value.length, input.value.length);
      expect(result.current.visible).toBe(true);

      act(() => result.current.onKeyDown(keyEvent("Enter")));
      expect(result.current.value).toBe("#Baram-Dev-Note ");

      document.body.removeChild(input);
    });

    // §324-b 후속 규칙 ④: 태스크 모드의 배선(`NO_CAPTURE_TARGETS`)이 빈 Map을
    // 넘기므로, 노트가 있어도 제안에 노트가 없다 — 별도 게이트가 아니라 이 인자
    // 하나로 성립해야 한다.
    it("suggests no notes when addressableNames is empty (task mode)", async () => {
      getVaultTags.mockResolvedValue([{ count: 1, tag: "capturetest" }]);
      const { result } = renderHook(() =>
        useCaptureTags(true, EMPTY_ADDRESSABLE_NAMES),
      );
      await waitFor(() => expect(result.current.index.size).toBe(1));

      act(() => result.current.onChange(changeEvent("#captur")));
      expect(result.current.suggestions).toEqual([
        { count: 1, isNote: false, name: "capturetest" },
      ]);
    });

    // ‼️ 리뷰 HIGH — 이 작업이 고치려던 버그를 그대로 재현한다. 노트 스캔은
    // `listDir` + 노트마다 `readFile` 하나씩(§320)이라 타이핑보다 훨씬 느릴 수
    // 있다. 사용자가 `#CaptureTest`를 다 칠 때까지 스캔이 안 끝나면(그 순간
    // `addressableNames`는 비어 있다), 스캔이 끝난 뒤에도 드롭다운이 뜨려면
    // `visible`이 그 뒤 값 변화를 반영해야 한다 — 타이핑 순간에 굳어 버리면
    // 사용자는 전체 이름을 정확히 쳤는데도 아무것도 못 보고, "여전히 안 뜬다"고
    // 결론짓는다(이 작업을 만든 바로 그 버그 리포트).
    it("reveals the dropdown once the note scan resolves after the whole name was already typed — no further keystroke needed", async () => {
      getVaultTags.mockResolvedValue([]);
      const { result, rerender } = renderHook(
        ({ names }) => useCaptureTags(true, names),
        { initialProps: { names: EMPTY_ADDRESSABLE_NAMES } },
      );
      await waitFor(() => expect(result.current.index.size).toBe(0));

      // The scan hasn't resolved yet — `addressableNames` is still empty.
      act(() => result.current.onChange(changeEvent("#CaptureTest")));
      expect(result.current.visible).toBe(false);

      // The scan resolves — only the prop changes, no further keystroke.
      rerender({ names: addressableNames(["CaptureTest", 0]) });

      expect(result.current.visible).toBe(true);
      expect(result.current.suggestions).toEqual([
        { count: 0, isNote: true, name: "CaptureTest" },
      ]);
    });
  });
});
