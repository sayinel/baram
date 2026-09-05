// §333 사용자가 승인을 거부하면 그 컨텍스트만 건너뛰고 나머지는 복원된다.
//
// openFolder는 지금까지 addContext 실패를 전부 삼키고 setVaultRoot로 진행했다
// (§81, `.catch(logger.warn)`). 승인 거부는 오류가 아니라 사용자의 선택이므로
// 그대로 진행하면 Rust가 같은 경로로 다이얼로그를 한 번 더 띄운다 — 거부만
// 조용히 끝내고, 그 외의 실패는 지금 동작(경고 로그 후 setVaultRoot로 계속
// 진행)을 그대로 지킨다.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../ipc/invoke", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../ipc/invoke")>();
  return {
    ...actual,
    listDir: vi.fn(async () => []),
    refreshIndex: vi.fn(async () => ({ fileCount: 0, linkCount: 0 })),
    setVaultRoot: vi.fn(async () => undefined),
  };
});

vi.mock("../../ipc/context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../ipc/context")>();
  return {
    ...actual,
    addContext: vi.fn(async (info: unknown) => info),
    getContexts: vi.fn(async () => []),
    getVaultConfigByPath: vi.fn(async () => ({})),
  };
});

import { addContext, getContexts } from "../../ipc/context";
import { listDir, setVaultRoot } from "../../ipc/invoke";
import { useContextStore } from "../../stores/context/context";
import { useSettingsStore } from "../../stores/settings/store";
import { useUIStore } from "../../stores/ui/ui";
import { addFolder, openFolder, switchContext } from "../vault-context-loader";

const PATH = "/x/denied";

describe("§333 승인 거부 — openFolder", () => {
  beforeEach(() => {
    vi.mocked(setVaultRoot).mockClear();
    useSettingsStore.setState({ recentFolders: [], locale: "en" } as never);
    useContextStore.setState({
      activeContextId: null,
      contexts: [],
    } as never);
  });

  it("거부는 openFolder를 조용히 끝내고 setVaultRoot로 진행하지 않는다", async () => {
    useContextStore.setState({
      addContext: vi.fn().mockRejectedValue("VAULT_APPROVAL_DENIED"),
    } as never);
    const toastSpy = vi.spyOn(useUIStore.getState(), "showToast");

    await expect(openFolder(PATH)).resolves.toBeUndefined();

    expect(setVaultRoot).not.toHaveBeenCalled();
    expect(toastSpy).toHaveBeenCalledWith(
      expect.stringContaining(PATH),
      "info",
    );
  });

  it("거부가 아닌 오류는 지금처럼 setVaultRoot로 계속 진행한다", async () => {
    useContextStore.setState({
      addContext: vi.fn().mockRejectedValue("disk on fire"),
    } as never);

    await expect(openFolder(PATH)).resolves.toBeUndefined();

    expect(setVaultRoot).toHaveBeenCalledWith(PATH);
  });
});

// addFolder carries the identical double-dialog risk shape as openFolder,
// but unlike openFolder it has never wrapped addContext in a catch at all —
// today, any addContext failure (denial included) simply rethrows out of
// addFolder. So its "preserve existing behavior" baseline for a non-denial
// error is "rethrows", not "logs and continues" — the two functions differ
// and must not be assumed to match.
describe("§333 승인 거부 — addFolder", () => {
  beforeEach(() => {
    vi.mocked(setVaultRoot).mockClear();
    useSettingsStore.setState({ recentFolders: [], locale: "en" } as never);
    useContextStore.setState({
      activeContextId: null,
      contexts: [],
    } as never);
  });

  it("거부는 addFolder를 조용히 끝내고 setVaultRoot로 진행하지 않는다", async () => {
    useContextStore.setState({
      addContext: vi.fn().mockRejectedValue("VAULT_APPROVAL_DENIED"),
    } as never);
    const toastSpy = vi.spyOn(useUIStore.getState(), "showToast");

    await expect(addFolder(PATH)).resolves.toBeUndefined();

    expect(setVaultRoot).not.toHaveBeenCalled();
    expect(toastSpy).toHaveBeenCalledWith(
      expect.stringContaining(PATH),
      "info",
    );
  });

  it("거부가 아닌 오류는 addFolder 밖으로 그대로 던져진다", async () => {
    useContextStore.setState({
      addContext: vi.fn().mockRejectedValue("disk on fire"),
    } as never);

    await expect(addFolder(PATH)).rejects.toBe("disk on fire");

    expect(setVaultRoot).not.toHaveBeenCalled();
  });
});

// §334/§333 리뷰 I7 — switchContext는 §334 이후 **비활성 컨텍스트가 승인을 받는
// 유일한 자리**다. 여기서 거부를 삼키고 트리를 읽으면, 사용자가 "거부"를 누른 직후에
// 그 vault의 파일 목록이 그대로 뜬다.
describe("§334 승인 거부 — switchContext", () => {
  const CTX = {
    addedAt: 0,
    color: "#fff",
    contextType: "vault" as const,
    id: "target",
    label: "t",
    path: PATH,
  };
  const OTHER = { ...CTX, id: "other", label: "o", path: "/x/other" };

  beforeEach(() => {
    vi.mocked(setVaultRoot).mockClear();
    vi.mocked(setVaultRoot).mockResolvedValue(undefined);
    vi.mocked(listDir).mockClear();
    vi.mocked(addContext).mockClear();
    vi.mocked(addContext).mockImplementation(
      async (info: unknown) => info as never,
    );
    vi.mocked(getContexts).mockClear();
    vi.mocked(getContexts).mockResolvedValue([]);
    useSettingsStore.setState({ locale: "en" } as never);
    useContextStore.setState({
      activeContextId: "other",
      contexts: [OTHER, CTX],
    } as never);
  });

  it("Rust에 없는 컨텍스트는 여기서 등록한다 — setVaultRoot보다 먼저", async () => {
    await switchContext("target");

    // §329.4 순서 제약: addContext가 setVaultRoot보다 먼저여야 타입이 맞게 등록된다.
    expect(addContext).toHaveBeenCalledWith(
      expect.objectContaining({ path: PATH }),
    );
    const addOrder = vi.mocked(addContext).mock.invocationCallOrder[0];
    const setOrder = vi.mocked(setVaultRoot).mock.invocationCallOrder[0];
    expect(addOrder).toBeLessThan(setOrder);
  });

  it("이미 Rust에 등록된 컨텍스트는 다시 등록하지 않는다", async () => {
    vi.mocked(getContexts).mockResolvedValue([CTX] as never);

    await switchContext("target");

    // tauri scope는 해제가 없다 — 매 전환마다 asset scope를 다시 얹으면 패턴이 쌓인다.
    expect(addContext).not.toHaveBeenCalled();
    expect(setVaultRoot).toHaveBeenCalledWith(PATH);
  });

  // ‼️ 거절만이 목록을 못 읽는 경우가 아니다 — IPC는 `undefined`로 **resolve**할 수도
  // 있다(하네스 기본 invoke가 그렇다). `=== null`만 보면 `.some`이 TypeError로 터져
  // 컨텍스트 전환 자체가 죽는다.
  it("getContexts가 배열이 아닌 값으로 resolve해도 전환이 죽지 않는다", async () => {
    vi.mocked(getContexts).mockResolvedValue(undefined as never);

    await expect(switchContext("target")).resolves.toBeUndefined();

    expect(setVaultRoot).toHaveBeenCalledWith(PATH);
    expect(listDir).toHaveBeenCalledWith(PATH, true);
  });

  it("등록 단계의 거부는 트리를 읽지 않고 전환을 되돌린다", async () => {
    vi.mocked(addContext).mockRejectedValue("VAULT_APPROVAL_DENIED");
    const toastSpy = vi.spyOn(useUIStore.getState(), "showToast");

    await switchContext("target");

    expect(setVaultRoot).not.toHaveBeenCalled();
    expect(listDir).not.toHaveBeenCalled();
    expect(toastSpy).toHaveBeenCalledWith(
      expect.stringContaining(PATH),
      "info",
    );
    // 탭 강조는 새 컨텍스트인데 트리는 이전 vault인 반쪽 상태를 남기지 않는다.
    expect(useContextStore.getState().activeContextId).toBe("other");
  });

  it("setVaultRoot 단계의 거부도 트리를 읽지 않는다", async () => {
    vi.mocked(getContexts).mockResolvedValue([CTX] as never);
    vi.mocked(setVaultRoot).mockRejectedValue("VAULT_APPROVAL_DENIED");
    const toastSpy = vi.spyOn(useUIStore.getState(), "showToast");

    await switchContext("target");

    expect(listDir).not.toHaveBeenCalled();
    expect(toastSpy).toHaveBeenCalledWith(
      expect.stringContaining(PATH),
      "info",
    );
    expect(useContextStore.getState().activeContextId).toBe("other");
  });

  // §335 리뷰 I3 — 삭제된 vault를 "허용되지 않았습니다"로 보고하면 사용자는 뜬 적도
  // 없는 다이얼로그를 찾는다. 전용 코드를 만든 이유가 이 구분이므로, 문구와 심각도가
  // 실제로 갈리는지 단정한다.
  it("해석 실패는 거부와 다른 문구·다른 심각도로 보고한다", async () => {
    vi.mocked(getContexts).mockResolvedValue([CTX] as never);
    vi.mocked(setVaultRoot).mockRejectedValue("VAULT_PATH_UNRESOLVABLE");
    const toastSpy = vi.spyOn(useUIStore.getState(), "showToast");

    await switchContext("target");

    expect(listDir).not.toHaveBeenCalled();
    const [message, kind] = toastSpy.mock.calls.at(-1) as [string, string];
    expect(kind).toBe("error"); // 거부는 "info"다 — 사용자의 선택이지 오류가 아니다.
    expect(message).toContain(PATH);
    // 거부 문구와 같으면 이 구분은 존재하지 않는 것이다.
    expect(message).not.toContain("not allowed");
    expect(message).toMatch(/moved|renamed|unmounted/);
  });

  // ‼️ 짝 단정 — 거부가 아닌 실패는 오늘 동작(경고 로그 후 계속)을 그대로 지켜야 한다.
  // 없으면 "무슨 실패든 트리를 안 읽는다"로도 위 둘이 통과한다.
  it("거부가 아닌 setVaultRoot 실패는 지금처럼 트리를 계속 읽는다", async () => {
    vi.mocked(getContexts).mockResolvedValue([CTX] as never);
    vi.mocked(setVaultRoot).mockRejectedValue("disk on fire");

    await switchContext("target");

    expect(listDir).toHaveBeenCalledWith(PATH, true);
    expect(useContextStore.getState().activeContextId).toBe("target");
  });
});

// §333 리뷰 I7 — openFolder의 `existing` 갈래는 addContext를 거치지 않으므로
// setVaultRoot가 확인 다이얼로그를 띄우는 자리다. 잡지 않으면 거부가 openFolder 밖으로
// 던져지고, `FileTree.tsx`의 `onClick={handleOpenFolder}`에는 catch가 없다.
describe("§333 승인 거부 — openFolder(existing 갈래)", () => {
  const CTX = {
    addedAt: 0,
    color: "#fff",
    contextType: "vault" as const,
    id: "e1",
    label: "e",
    path: PATH,
  };

  beforeEach(() => {
    vi.mocked(setVaultRoot).mockClear();
    vi.mocked(listDir).mockClear();
    useSettingsStore.setState({ recentFolders: [], locale: "en" } as never);
    useContextStore.setState({
      activeContextId: "e1",
      contexts: [CTX],
    } as never);
  });

  it("거부는 예외로 새지 않고 트리도 읽지 않는다", async () => {
    vi.mocked(setVaultRoot).mockRejectedValue("VAULT_APPROVAL_DENIED");
    const toastSpy = vi.spyOn(useUIStore.getState(), "showToast");

    await expect(openFolder(PATH)).resolves.toBeUndefined();

    expect(listDir).not.toHaveBeenCalled();
    expect(toastSpy).toHaveBeenCalledWith(
      expect.stringContaining(PATH),
      "info",
    );
  });

  it("거부가 아닌 setVaultRoot 실패는 지금처럼 호출자에게 던진다", async () => {
    vi.mocked(setVaultRoot).mockRejectedValue("disk on fire");

    await expect(openFolder(PATH)).rejects.toBe("disk on fire");
  });
});
