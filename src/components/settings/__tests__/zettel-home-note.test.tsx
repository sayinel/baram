// §344 제텔 홈 노트 파일 선택. 로컬 관례(UpdateDialog.test.tsx, approved-roots-section.test.tsx)를
// 따라 fireEvent + vi.hoisted() 모듈 목을 쓴다 — 이 디렉터리는 @testing-library/user-event를
// 쓰지 않는다.
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

const readFile = vi.hoisted(() => vi.fn());
vi.mock("../../../ipc/invoke", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../ipc/invoke")>()),
  readFile: (p: string) => readFile(p),
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
    readFile.mockReset().mockResolvedValue("# Home");
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

  it("warns at pick time when the file cannot be read", async () => {
    // 제텔 디렉터리 밖을 고르면 vault 승인 경계에 막혀 시작 시 조용히 실패한다.
    // 사용자가 그 자리에 있는 지금 말한다 (§18.19 결함 A).
    open.mockResolvedValue("/elsewhere/home.md");
    readFile.mockRejectedValue(new Error("VAULT_DENIED"));
    render(<ZettelkastenTab />);
    fireEvent.click(buttonIn("Home Note", /Browse/i));
    await waitFor(() =>
      expect(useSettingsStore.getState().zettelkastenHomeNote).toBe(
        "/elsewhere/home.md",
      ),
    );
    await waitFor(() =>
      expect(useUIStore.getState().toast?.message).toContain("home note"),
    );
  });

  it("does not warn when the picked file reads fine — negative control", async () => {
    open.mockResolvedValue("/vault/zettel/home.md");
    readFile.mockResolvedValue("# Home");
    render(<ZettelkastenTab />);
    fireEvent.click(buttonIn("Home Note", /Browse/i));
    await waitFor(() =>
      expect(useSettingsStore.getState().zettelkastenHomeNote).toBe("home.md"),
    );
    // ‼️ readFile 이 resolve 됐음을 위 waitFor 로 먼저 확인한 뒤에야 toast 부재를
    // 단정한다 — 그렇지 않으면 onBrowse 가 아직 안 끝났을 뿐인데 통과하는,
    // 언제나 초록인 단정이 된다.
    expect(useUIStore.getState().toast).toBeNull();
  });
});
