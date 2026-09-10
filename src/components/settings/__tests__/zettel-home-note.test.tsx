// §344 제텔 홈 노트 파일 선택. 로컬 관례(UpdateDialog.test.tsx, approved-roots-section.test.tsx)를
// 따라 fireEvent + vi.hoisted() 모듈 목을 쓴다 — 이 디렉터리는 @testing-library/user-event를
// 쓰지 않는다.
//
// ‼️ (Fix E / I-9) 여기 더 이상 `readFile` 목이 없다 — 경고는 픽 시점 IPC 왕복이 아니라
// `relativeToRoot`가 이미 계산하는 위치(제텔 디렉터리 안/밖)만으로 판정한다. 목을 남겨
// 두면 "그 IPC를 가로챈다"는 거짓 인상을 준다(그 경로 자체가 없어졌다).
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const open = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: (opts?: unknown) => open(opts),
}));

import { useSettingsStore } from "../../../stores/settings/store";
import { useUIStore } from "../../../stores/ui/ui";
import { ZettelkastenTab } from "../tabs/ZettelkastenTab";

/** 라벨이 붙은 input 으로 행을 찾고 그 행 안에서 버튼을 집는다 — 인덱스는 순서가
 *  바뀌면 조용히 다른 행을 누른다. */
function buttonIn(rowLabel: string, name: RegExp): HTMLElement {
  const row = screen.getByLabelText(rowLabel).closest(".settings-key-row");
  if (!row) throw new Error(`no .settings-key-row for ${rowLabel}`);
  return within(row as HTMLElement).getByRole("button", { name });
}

describe("Zettel home note picker (§344)", () => {
  beforeEach(() => {
    open.mockReset();
    useSettingsStore.setState({
      zettelkastenEnabled: true,
      zettelkastenDirectory: "/vault/zettel",
      zettelkastenHomeNote: "",
    });
    useUIStore.setState({ toast: null });
  });

  it("stores a path inside the zettel dir as a relative path", async () => {
    open.mockResolvedValue("/vault/zettel/home.md");
    render(<ZettelkastenTab />);
    fireEvent.click(buttonIn("Home Note", /Browse/i));
    await waitFor(() =>
      expect(useSettingsStore.getState().zettelkastenHomeNote).toBe("home.md"),
    );
  });

  it("starts the dialog in the zettel directory and filters to markdown", async () => {
    open.mockResolvedValue(null);
    render(<ZettelkastenTab />);
    fireEvent.click(buttonIn("Home Note", /Browse/i));
    await waitFor(() => expect(open).toHaveBeenCalled());
    expect(open.mock.calls[0][0]).toStrictEqual({
      defaultPath: "/vault/zettel",
      filters: [{ name: "Markdown", extensions: ["md"] }],
    });
  });

  it("can be cleared back to empty — leaving it unset is valid", () => {
    useSettingsStore.setState({ zettelkastenHomeNote: "home.md" });
    render(<ZettelkastenTab />);
    fireEvent.click(buttonIn("Home Note", /Clear/i));
    expect(useSettingsStore.getState().zettelkastenHomeNote).toBe("");
  });

  // §344 / Fix E (I-9): the warning is judged by LOCATION (relativeToRoot), not by a
  // pick-time `readFile` probe. The probe warned on perfectly valid setups — `check_vault`
  // validates against registered contexts, and the Zettel directory is only registered
  // AFTER startup picks it, so a home note outside the vault (a normal setup) always
  // failed to read at pick time and always succeeded at startup. Location is the one
  // thing we actually know ahead of time: a file inside the Zettel directory is
  // guaranteed to be readable at startup (that directory is what gets registered);
  // a file outside it depends on whatever else is registered by then, which is unknown.
  it("warns when the picked file is outside the Zettel directory", async () => {
    open.mockResolvedValue("/elsewhere/home.md");
    render(<ZettelkastenTab />);
    fireEvent.click(buttonIn("Home Note", /Browse/i));
    await waitFor(() =>
      expect(useSettingsStore.getState().zettelkastenHomeNote).toBe(
        "/elsewhere/home.md",
      ),
    );
    await waitFor(() =>
      expect(useUIStore.getState().toast?.message).toContain("Zettel"),
    );
    // The old advice named the wrong mechanism ("approve … in Settings › Vault" —
    // check_vault validates registered contexts, not the approval store). The new
    // copy must not repeat that claim.
    expect(useUIStore.getState().toast?.message).not.toContain("approve");
  });

  it("does not warn when the picked file is inside the Zettel directory — negative control", async () => {
    open.mockResolvedValue("/vault/zettel/home.md");
    render(<ZettelkastenTab />);
    fireEvent.click(buttonIn("Home Note", /Browse/i));
    // ‼️ `open()` resolves on a microtask, so the handler's state write hasn't landed the
    // instant `fireEvent.click` returns — wait for it before asserting toast ABSENCE, or
    // this would pass vacuously on a stale pre-click snapshot instead of the post-click one.
    await waitFor(() =>
      expect(useSettingsStore.getState().zettelkastenHomeNote).toBe("home.md"),
    );
    expect(useUIStore.getState().toast).toBeNull();
  });

  it("with no zettel directory set, stores the absolute path, warns, and opens the dialog with no defaultPath", async () => {
    // dir === null 분기 — `resolveAbsoluteDirSetting` 은 빈 설정과 상대 경로 모두에
    // null 을 준다. 그때 상대화할 기준이 없으므로 절대 경로를 그대로 저장하고,
    // defaultPath 는 **undefined** 여야 한다(빈 문자열이면 OS 가 임의 위치를 연다).
    // 위치를 알 수 없으므로(§344/Fix E) 경고도 뜬다 — "밖이거나 dir === null"의
    // 나머지 절반.
    useSettingsStore.setState({ zettelkastenDirectory: "" });
    open.mockResolvedValue("/elsewhere/home.md");
    render(<ZettelkastenTab />);
    fireEvent.click(buttonIn("Home Note", /Browse/i));
    await waitFor(() =>
      expect(useSettingsStore.getState().zettelkastenHomeNote).toBe(
        "/elsewhere/home.md",
      ),
    );
    expect(useUIStore.getState().toast?.message).toContain("Zettel");
    expect(open.mock.calls[0][0]).toStrictEqual({
      defaultPath: undefined,
      filters: [{ name: "Markdown", extensions: ["md"] }],
    });
  });
});
