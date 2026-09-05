// §335 승인 회수 UI. 로컬 관례(UpdateDialog.test.tsx)를 따라 fireEvent +
// vi.hoisted() 모듈 목을 쓴다 — 이 디렉터리는 @testing-library/user-event를
// 쓰지 않는다.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const listApprovedRoots = vi.hoisted(() => vi.fn());
const revokeApprovedRoot = vi.hoisted(() => vi.fn());
const isPathApproved = vi.hoisted(() => vi.fn());
vi.mock("../../../ipc/approval", () => ({
  isPathApproved: (p: string) => isPathApproved(p),
  listApprovedRoots: () => listApprovedRoots(),
  revokeApprovedRoot: (p: string) => revokeApprovedRoot(p),
}));

import { useContextStore } from "../../../stores/context/context";
import { useFileStore } from "../../../stores/file/file";
import { useUIStore } from "../../../stores/ui/ui";
import { ApprovedRootsSection } from "../tabs/ApprovedRootsSection";

const VAULT = "/x/Vault";

function seedContexts(contexts: unknown[], activeContextId: null | string) {
  useContextStore.setState({ activeContextId, contexts } as never);
}

describe("§335 승인 회수", () => {
  beforeEach(() => {
    listApprovedRoots.mockReset();
    revokeApprovedRoot.mockReset();
    isPathApproved.mockReset();
    isPathApproved.mockResolvedValue(false);
    seedContexts([], null);
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
    await waitFor(() => expect(revokeApprovedRoot).toHaveBeenCalledTimes(1));

    resolveRevoke();
    await waitFor(() => expect(screen.queryByText("/x/Vault")).toBeNull());
    // 전부 가라앉은 뒤에 다시 센다 — waitFor는 1에서 통과해 버리므로, 두 번째
    // 클릭이 뒤늦게 도착했는지는 이 단정만이 가른다.
    expect(revokeApprovedRoot).toHaveBeenCalledTimes(1);
  });

  // ── §335 리뷰 I1 — 회수는 컨텍스트도 제거한다 ─────────────────────────────
  //
  // ‼️ 기록만 지우면 `validate_path_any`가 그대로 통과해 그 루트의 읽기도 쓰기도
  // 세션 내내 계속된다. §335가 "잔여 노출은 asset:// 읽기 한정"이라고 말할 수 있는
  // 근거가 바로 컨텍스트 제거이고, 그게 없으면 더 약한 동작이 더 강한 근거를 달고
  // 배포된다.

  it("회수하면 그 루트의 컨텍스트도 제거한다", async () => {
    listApprovedRoots.mockResolvedValue([
      { approvedAt: 0, kind: "dir", path: VAULT },
    ]);
    revokeApprovedRoot.mockResolvedValue(undefined);
    seedContexts(
      [
        {
          addedAt: 0,
          color: "#fff",
          contextType: "vault",
          id: "c1",
          label: "v",
          path: VAULT,
        },
        {
          addedAt: 0,
          color: "#fff",
          contextType: "vault",
          id: "c2",
          label: "o",
          path: "/y/Other",
        },
      ],
      "c2",
    );
    // 회수 전에는 둘 다 승인돼 있고, 회수 후에는 /x/Vault만 잃는다.
    isPathApproved.mockImplementation(
      async (p: string) =>
        p !== VAULT || revokeApprovedRoot.mock.calls.length === 0,
    );

    render(<ApprovedRootsSection />);
    await screen.findByText(VAULT);
    fireEvent.click(screen.getByRole("button", { name: /revoke|회수/i }));

    await waitFor(() =>
      expect(useContextStore.getState().contexts.map((c) => c.id)).toEqual([
        "c2",
      ]),
    );
  });

  // ‼️ 전/후 비교여야 하는 이유. "회수 후 미승인"만 보면, 애초에 승인이 없던
  // 컨텍스트(삭제된 폴더 등)까지 이 회수의 부수 피해로 지운다 — 사용자 상태를
  // 지우는 코드는 자기가 무엇을 지우는지 정확히 알아야 한다.
  it("이 회수와 무관하게 원래부터 미승인이던 컨텍스트는 건드리지 않는다", async () => {
    listApprovedRoots.mockResolvedValue([
      { approvedAt: 0, kind: "dir", path: VAULT },
    ]);
    revokeApprovedRoot.mockResolvedValue(undefined);
    seedContexts(
      [
        {
          addedAt: 0,
          color: "#fff",
          contextType: "vault",
          id: "c1",
          label: "v",
          path: VAULT,
        },
        {
          addedAt: 0,
          color: "#fff",
          contextType: "vault",
          id: "gone",
          label: "g",
          path: "/deleted",
        },
      ],
      "c1",
    );
    // /deleted는 전에도 후에도 false — 이 회수가 잃게 한 것이 아니다.
    isPathApproved.mockImplementation(
      async (p: string) =>
        p === VAULT && revokeApprovedRoot.mock.calls.length === 0,
    );

    render(<ApprovedRootsSection />);
    await screen.findByText(VAULT);
    fireEvent.click(screen.getByRole("button", { name: /revoke|회수/i }));

    await waitFor(() =>
      expect(useContextStore.getState().contexts.map((c) => c.id)).toEqual([
        "gone",
      ]),
    );
  });

  it("활성 컨텍스트를 회수하고 남은 것이 없으면 파일 트리를 비운다", async () => {
    listApprovedRoots.mockResolvedValue([
      { approvedAt: 0, kind: "dir", path: VAULT },
    ]);
    revokeApprovedRoot.mockResolvedValue(undefined);
    seedContexts(
      [
        {
          addedAt: 0,
          color: "#fff",
          contextType: "vault",
          id: "c1",
          label: "v",
          path: VAULT,
        },
      ],
      "c1",
    );
    isPathApproved.mockImplementation(
      async () => revokeApprovedRoot.mock.calls.length === 0,
    );
    useFileStore.setState({
      fileTree: [{ isDir: false, name: "a.md", path: `${VAULT}/a.md` }],
      rootPath: VAULT,
    } as never);

    render(<ApprovedRootsSection />);
    await screen.findByText(VAULT);
    fireEvent.click(screen.getByRole("button", { name: /revoke|회수/i }));

    // 회수한 vault의 트리를 그대로 띄워 두면 "회수됐다"와 화면이 어긋난다.
    await waitFor(() => expect(useFileStore.getState().fileTree).toEqual([]));
    expect(useFileStore.getState().rootPath).toBeNull();
  });
});
