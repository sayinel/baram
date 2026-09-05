// §335 승인 회수 UI. 로컬 관례(UpdateDialog.test.tsx)를 따라 fireEvent +
// vi.hoisted() 모듈 목을 쓴다 — 이 디렉터리는 @testing-library/user-event를
// 쓰지 않는다.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const listApprovedRoots = vi.hoisted(() => vi.fn());
const revokeApprovedRoot = vi.hoisted(() => vi.fn());
vi.mock("../../../ipc/approval", () => ({
  listApprovedRoots: () => listApprovedRoots(),
  revokeApprovedRoot: (p: string) => revokeApprovedRoot(p),
}));

import { useUIStore } from "../../../stores/ui/ui";
import { ApprovedRootsSection } from "../tabs/ApprovedRootsSection";

describe("§335 승인 회수", () => {
  beforeEach(() => {
    listApprovedRoots.mockReset();
    revokeApprovedRoot.mockReset();
  });

  it("승인된 경로를 보여 주고 회수하면 목록에서 사라진다", async () => {
    listApprovedRoots
      .mockResolvedValueOnce([
        { approvedAt: 0, kind: "dir", path: "/x/Vault" },
        { approvedAt: 0, kind: "file", path: "/x/memo.md" },
      ])
      .mockResolvedValueOnce([
        { approvedAt: 0, kind: "file", path: "/x/memo.md" },
      ]);
    revokeApprovedRoot.mockResolvedValue(undefined);

    render(<ApprovedRootsSection />);
    await screen.findByText("/x/Vault");

    fireEvent.click(screen.getAllByRole("button", { name: /revoke|회수/i })[0]);

    await waitFor(() =>
      expect(revokeApprovedRoot).toHaveBeenCalledWith("/x/Vault"),
    );
    await waitFor(() => expect(screen.queryByText("/x/Vault")).toBeNull());
  });

  it("회수 후 재시작이 필요하다는 사실을 화면에 말한다", async () => {
    listApprovedRoots.mockResolvedValue([
      { approvedAt: 0, kind: "dir", path: "/x/Vault" },
    ]);
    render(<ApprovedRootsSection />);
    // 재시작 안내는 정보가 아니라 **계약**이다: 회수해도 이번 세션의 asset://
    // 부여는 남는다(§335). 문구가 사라지면 사용자는 잘못된 안전감을 갖는다.
    expect(await screen.findByText(/restart|재시작/i)).toBeTruthy();
  });

  // §335 리뷰 Minor 1 — IPC 실패를 삼키면 항목은 그대로인데 클릭이 아무 반응도
  // 없어 보인다. 에러 토스트가 사용자의 유일한 피드백이다.
  it("회수가 실패하면 에러 토스트를 띄우고 항목을 목록에 남긴다", async () => {
    listApprovedRoots.mockResolvedValue([
      { approvedAt: 0, kind: "dir", path: "/x/Vault" },
    ]);
    revokeApprovedRoot.mockRejectedValue(new Error("boom"));
    const showToastSpy = vi.spyOn(useUIStore.getState(), "showToast");

    render(<ApprovedRootsSection />);
    await screen.findByText("/x/Vault");

    fireEvent.click(screen.getByRole("button", { name: /revoke|회수/i }));

    await waitFor(() =>
      expect(showToastSpy).toHaveBeenCalledWith(
        expect.stringContaining("boom"),
        "error",
      ),
    );
    expect(screen.getByText("/x/Vault")).toBeTruthy();
  });

  // §335 리뷰 Minor 2 — 로드 실패를 삼키면 "승인 0건"과 구분이 안 된다. 사용자가
  // vault가 계속 열리는 이유를 찾다가 빈 목록을 진짜 승인 0건으로 믿게 된다.
  it("초기 로드가 실패하면 에러 토스트를 띄운다", async () => {
    listApprovedRoots.mockRejectedValue(new Error("network down"));
    const showToastSpy = vi.spyOn(useUIStore.getState(), "showToast");

    render(<ApprovedRootsSection />);

    await waitFor(() =>
      expect(showToastSpy).toHaveBeenCalledWith(
        expect.stringContaining("network down"),
        "error",
      ),
    );
  });

  // §335 리뷰 Minor 3 — in-flight 가드가 없으면 더블클릭이 revoke/refresh를
  // 두 번 겹쳐 쏴서 순서가 뒤엉킬 수 있다.
  it("회수가 진행 중이면 버튼을 비활성화해 두 번째 클릭이 다시 부르지 못한다", async () => {
    listApprovedRoots
      .mockResolvedValueOnce([{ approvedAt: 0, kind: "dir", path: "/x/Vault" }])
      .mockResolvedValueOnce([]);
    let resolveRevoke!: () => void;
    revokeApprovedRoot.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveRevoke = resolve;
      }),
    );

    render(<ApprovedRootsSection />);
    await screen.findByText("/x/Vault");

    const button = screen.getByRole("button", { name: /revoke|회수/i });
    fireEvent.click(button);
    expect(button).toBeDisabled();

    fireEvent.click(button); // disabled — 두 번째 클릭은 무시되어야 한다
    expect(revokeApprovedRoot).toHaveBeenCalledTimes(1);

    resolveRevoke();
    await waitFor(() => expect(screen.queryByText("/x/Vault")).toBeNull());
  });
});
