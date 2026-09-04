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

import { setVaultRoot } from "../../ipc/invoke";
import { useContextStore } from "../../stores/context/context";
import { useSettingsStore } from "../../stores/settings/store";
import { useUIStore } from "../../stores/ui/ui";
import { openFolder } from "../vault-context-loader";

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
