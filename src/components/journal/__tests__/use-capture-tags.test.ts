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
    const { result } = renderHook(() => useCaptureTags(true));
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
    renderHook(() => useCaptureTags(true));
    await waitFor(() =>
      expect(getVaultTags).toHaveBeenCalledWith("/other/Zettel"),
    );
  });

  it("no longer reads note files one by one", async () => {
    renderHook(() => useCaptureTags(true));
    await waitFor(() => expect(getVaultTags).toHaveBeenCalled());
    expect(listDir).not.toHaveBeenCalled();
    expect(readFile).not.toHaveBeenCalled();
  });

  it("carries the counts through so the dropdown can sort by frequency", async () => {
    getVaultTags.mockResolvedValue([
      { count: 40, tag: "영감노트" },
      { count: 2, tag: "links" },
    ]);
    const { result } = renderHook(() => useCaptureTags(true));
    await waitFor(() => expect(result.current.index.get("영감노트")).toBe(40));
  });

  // ‼️ §320이 `#Baram-Dev-Note` 별칭에 의존한다. TS 질의 정규식이 `-`를 제외하면
  // 자동완성이 `#Baram-` 다음을 못 잇고, `onSelect`는 `#Baram-#baram-dev-note`를 만든다.
  // Rust `is_tag_char`는 하이픈을 포함한다(`md/mod.rs:25-27`) — 두 쪽이 갈려 있다.
  it("completes a hyphenated tag", async () => {
    getVaultTags.mockResolvedValue([{ count: 1, tag: "baram-dev-note" }]);
    const { result } = renderHook(() => useCaptureTags(true));
    await waitFor(() => expect(result.current.index.size).toBe(1));

    act(() => result.current.onChange(changeEvent("#baram-dev")));
    expect(result.current.query).toBe("baram-dev");
    expect(result.current.visible).toBe(true);
  });

  it("replaces the whole hyphenated prefix on select", async () => {
    // 입력 `#baram-dev`에서 `baram-dev-note`를 고르면 `#baram-dev-note ` 하나가 되는 것
    // — `#baram-#baram-dev-note`가 아니다.
    getVaultTags.mockResolvedValue([{ count: 1, tag: "baram-dev-note" }]);
    const { result } = renderHook(() => useCaptureTags(true));
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
    const { result } = renderHook(() => useCaptureTags(true));
    await waitFor(() => expect(errorSpy).toHaveBeenCalled());
    expect(result.current.index.size).toBe(0);
  });
});
