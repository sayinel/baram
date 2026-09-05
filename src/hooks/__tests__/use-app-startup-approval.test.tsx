// §330/§333/§334 시작 시 승인 처리.
//
// 이 파일이 지키는 것 셋 — 셋 다 "한 쪽이 값의 의미를 바꿨는데 다른 쪽이 옛 의미로
// 읽는" 모양이고, 어느 한 파일만 봐서는 보이지 않는다.
//
//  C1 거부는 **컨텍스트를 지우지 않는다.** 이 브랜치 이전에는 거절 사유가 "경로가
//     유효하지 않다" 하나뿐이라 catch가 곧 stale이었다. 브랜치가 "사용자가 거부를
//     눌렀다"라는 두 번째 사유를 만들었고, catch는 둘을 구분하지 못한다 — 오클릭
//     한 번에 라벨·색·별칭까지 영속 목록에서 사라진다.
//  C2 확인 다이얼로그는 **활성 컨텍스트에서만** 뜬다 (§334). 이미 승인된 나머지는
//     조용히 등록되고(교차 컨텍스트 읽기와 §87 별칭 표가 등록된 컨텍스트 전부를
//     보기 때문), 미승인은 건너뛴다.
//  I4 `uiLocale` 미러가 **다이얼로그보다 먼저** 맞춰진다. 아니면 한국어 사용자가
//     업그레이드 첫 실행에서 영어 다이얼로그를 본다.
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => [] as string[]);
const addContextIpc = vi.hoisted(() => vi.fn());
const setActiveContextIpc = vi.hoisted(() => vi.fn());
const isPathApproved = vi.hoisted(() => vi.fn());
const getConfig = vi.hoisted(() => vi.fn());
const setConfig = vi.hoisted(() => vi.fn());
const openFolder = vi.hoisted(() => vi.fn());

vi.mock("../../ipc/context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../ipc/context")>()),
  addContext: (info: { path: string }) => {
    calls.push(`addContext:${info.path}`);
    return addContextIpc(info);
  },
  setActiveContext: (id: string) => setActiveContextIpc(id),
}));

// ‼️ `isApprovalDeniedError`는 **진짜**를 쓴다. 그 판정이 이 테스트가 검증하는 대상의
// 절반이므로 목으로 대체하면 단정이 자기 자신을 확인하게 된다.
vi.mock("../../ipc/approval", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../ipc/approval")>()),
  isPathApproved: (p: string) => isPathApproved(p),
}));

vi.mock("../../ipc/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../ipc/config")>()),
  getConfig: (k: string) => getConfig(k),
  setConfig: (k: string, v: string) => {
    calls.push(`setConfig:${k}=${v}`);
    return setConfig(k, v);
  },
}));

vi.mock("../../services/vault-context-loader", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../services/vault-context-loader")
  >()),
  openFolder: (p: string) => {
    calls.push(`openFolder:${p}`);
    return openFolder(p);
  },
}));

vi.mock("../../spaces", () => ({ getSpace: () => undefined }));

import { useContextStore } from "../../stores/context/context";
import { useSettingsStore } from "../../stores/settings/store";
import { useAppStartup } from "../use-app-startup";

const A = "/x/VaultA";
const B = "/x/VaultB";
const C = "/x/VaultC";

function ctx(id: string, path: string) {
  return {
    addedAt: 0,
    color: "#fff",
    contextType: "vault" as const,
    id,
    label: id,
    path,
  };
}

function seed(contexts: ReturnType<typeof ctx>[], activeContextId: string) {
  useContextStore.setState({ activeContextId, contexts } as never);
}

function start() {
  return renderHook(() =>
    useAppStartup({
      handleNewFile: vi.fn(),
      handleOpenFilePath: vi.fn(async () => {}),
    }),
  );
}

const ids = () => useContextStore.getState().contexts.map((c) => c.id);

describe("§334 시작 시 승인", () => {
  beforeEach(() => {
    calls.length = 0;
    addContextIpc.mockReset();
    addContextIpc.mockImplementation(async (info: unknown) => info);
    setActiveContextIpc.mockReset();
    setActiveContextIpc.mockResolvedValue(undefined);
    isPathApproved.mockReset();
    isPathApproved.mockResolvedValue(true);
    getConfig.mockReset();
    getConfig.mockResolvedValue(null);
    setConfig.mockReset();
    setConfig.mockResolvedValue(undefined);
    openFolder.mockReset();
    openFolder.mockResolvedValue(undefined);
    useSettingsStore.setState({
      lastOpenedFile: null,
      lastOpenedFolder: null,
      locale: "ko",
      onLaunch: "restoreLastFolder",
    } as never);
  });

  // ── C1 ────────────────────────────────────────────────────────────────────

  it("활성 컨텍스트를 거부해도 그 컨텍스트를 지우지 않는다", async () => {
    seed([ctx("a", A), ctx("b", B)], "a");
    addContextIpc.mockRejectedValue("VAULT_APPROVAL_DENIED");

    start();

    await waitFor(() => expect(addContextIpc).toHaveBeenCalled());
    // §330 결정 2 — 거부는 세션 한정이다. 다음 실행에 다시 묻는다.
    await waitFor(() => expect(ids()).toEqual(["a", "b"]));
  });

  it("비활성 컨텍스트를 거부해도 지우지 않는다", async () => {
    seed([ctx("a", A), ctx("b", B)], "a");
    addContextIpc.mockImplementation(async (info: { path: string }) => {
      if (info.path === B) throw "VAULT_APPROVAL_DENIED";
      return info;
    });

    start();

    await waitFor(() => expect(addContextIpc).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(ids()).toEqual(["a", "b"]));
  });

  // ‼️ 짝 단정. 이게 없으면 "catch에서 아무것도 안 지운다"로도 위 테스트가 통과한다 —
  // 즉 §90 청소를 통째로 없애도 초록이다. 지워야 하는 경우는 여전히 지워야 한다.
  it("거부가 아닌 실패(해석 불가 = 삭제된 vault)는 여전히 stale로 지운다", async () => {
    seed([ctx("a", A), ctx("b", B)], "a");
    addContextIpc.mockImplementation(async (info: { path: string }) => {
      if (info.path === B) throw "VAULT_PATH_UNRESOLVABLE";
      return info;
    });

    start();

    await waitFor(() => expect(ids()).toEqual(["a"]));
  });

  // ── C2 ────────────────────────────────────────────────────────────────────

  it("미승인 비활성 컨텍스트는 등록을 시도하지 않는다 — 다이얼로그는 활성에서만", async () => {
    seed([ctx("a", A), ctx("b", B), ctx("c", C)], "b");
    // 활성(B)은 미승인이라 물어야 하고, A도 미승인이지만 물으면 안 된다. C는 승인됨.
    isPathApproved.mockImplementation(async (p: string) => p === C);

    start();

    await waitFor(() => expect(openFolder).toHaveBeenCalled());
    const registered = calls.filter((c) => c.startsWith("addContext:"));
    expect(registered).toEqual([`addContext:${B}`, `addContext:${C}`]);
    // 미승인 비활성 컨텍스트는 남는다 — 전환할 때 switchContext가 묻는다.
    expect(ids()).toEqual(["a", "b", "c"]);
  });

  // ‼️ "활성 하나만 등록"이 아니라는 단정. `validate_path_any`(교차 컨텍스트 읽기)와
  // `resolve_cross_vault_link`(§87 별칭 표)는 **등록된 컨텍스트 전부**를 보므로,
  // 승인이 끝난 사용자에게서 활성 외 등록을 없애면 그 둘이 조용히 죽는다.
  it("이미 승인된 비활성 컨텍스트는 전부 조용히 등록한다", async () => {
    seed([ctx("a", A), ctx("b", B), ctx("c", C)], "b");

    start();

    await waitFor(() =>
      expect(calls.filter((c) => c.startsWith("addContext:"))).toEqual([
        `addContext:${A}`,
        `addContext:${B}`,
        `addContext:${C}`,
      ]),
    );
    expect(isPathApproved).toHaveBeenCalledWith(A);
    expect(isPathApproved).toHaveBeenCalledWith(C);
    // 활성 컨텍스트에는 묻지 않는다 — 무조건 등록(=필요하면 다이얼로그)이다.
    expect(isPathApproved).not.toHaveBeenCalledWith(B);
  });

  it("활성 컨텍스트를 거부하면 openFolder로 내려가지 않는다 (두 번째 다이얼로그 방지)", async () => {
    seed([ctx("a", A)], "a");
    addContextIpc.mockRejectedValue("VAULT_APPROVAL_DENIED");

    start();

    await waitFor(() => expect(addContextIpc).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    // openFolder → setVaultRoot → ensure_approved 가 같은 경로를 다시 묻는다.
    expect(openFolder).not.toHaveBeenCalled();
  });

  // ── I4 ────────────────────────────────────────────────────────────────────

  it("uiLocale 미러를 첫 승인 IPC보다 먼저 맞춘다", async () => {
    seed([ctx("a", A)], "a");

    start();

    await waitFor(() =>
      expect(setConfig).toHaveBeenCalledWith("uiLocale", "ko"),
    );
    const mirror = calls.indexOf("setConfig:uiLocale=ko");
    const firstGate = calls.findIndex((c) => c.startsWith("addContext:"));
    expect(mirror).toBeGreaterThanOrEqual(0);
    expect(firstGate).toBeGreaterThan(mirror);
  });

  it("이미 같은 값이면 config를 다시 쓰지 않는다", async () => {
    seed([ctx("a", A)], "a");
    getConfig.mockResolvedValue("ko");

    start();

    await waitFor(() => expect(addContextIpc).toHaveBeenCalled());
    // ‼️ setConfig 전체가 아니라 uiLocale 키만 본다 — zustand persist(tauriStorage)가
    // 같은 커맨드로 `baram:settings`·`baram:context`를 쓰기 때문에, 호출 0회를
    // 단정하면 이 테스트는 절대 통과하지 않는다(그리고 통과시키려 단정을 지우면
    // 아무것도 안 지키게 된다).
    expect(calls).not.toContain("setConfig:uiLocale=ko");
  });
});
