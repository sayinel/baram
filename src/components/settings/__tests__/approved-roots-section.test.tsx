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
});
