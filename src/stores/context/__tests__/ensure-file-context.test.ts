// §89 The backend counts who holds a file context, by window. A store that already lists the file
// still has to say so: a file window starts from the main window's saved list, so it would hold
// nothing and lose its writes when the main window closes its tab on the same file.
import { beforeEach, describe, expect, it, vi } from "vitest";

const ipc = vi.hoisted(() => ({
  addContext: vi.fn(),
}));

vi.mock("../../../ipc/context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../ipc/context")>()),
  addContext: ipc.addContext,
}));

import type { ContextInfo } from "../../../ipc/types";

import { useContextStore } from "../context";

const PATH = "/elsewhere/note.md";

function fileContext(over: Partial<ContextInfo> = {}): ContextInfo {
  return {
    addedAt: 0,
    color: "#9ca3af",
    contextType: "file",
    id: "listed",
    label: "note.md",
    path: PATH,
    ...over,
  } as ContextInfo;
}

beforeEach(() => {
  ipc.addContext.mockReset();
  useContextStore.setState({ activeContextId: null, contexts: [] });
});

describe("ensureFileContext", () => {
  // 이것을 실패시키는 것: 목록에 있다고 바로 돌아가면 이 창은 소유자로 올라가지 않는다.
  it("tells the backend about a file its list already has", async () => {
    const listed = fileContext();
    useContextStore.setState({ contexts: [listed] });
    ipc.addContext.mockResolvedValue(listed);

    await expect(
      useContextStore.getState().ensureFileContext(PATH),
    ).resolves.toEqual(listed);

    expect(ipc.addContext).toHaveBeenCalledWith(listed);
  });

  // 이것을 실패시키는 것: 옛 id 를 남기면 이 탭의 context id 가 백엔드에 없는 등록을 가리킨다.
  it("takes the registration the backend already has under another id", async () => {
    const listed = fileContext();
    const registered = fileContext({ id: "registered" });
    useContextStore.setState({ activeContextId: "listed", contexts: [listed] });
    ipc.addContext.mockResolvedValue(registered);

    await expect(
      useContextStore.getState().ensureFileContext(PATH),
    ).resolves.toEqual(registered);

    const { activeContextId, contexts } = useContextStore.getState();
    expect(contexts).toEqual([registered]);
    expect(activeContextId).toBe("registered");
  });

  it("leaves another context active when swapping the id", async () => {
    const listed = fileContext();
    const other = fileContext({ id: "other", path: "/elsewhere/other.md" });
    useContextStore.setState({
      activeContextId: "other",
      contexts: [listed, other],
    });
    ipc.addContext.mockResolvedValue(fileContext({ id: "registered" }));

    await useContextStore.getState().ensureFileContext(PATH);

    expect(useContextStore.getState().activeContextId).toBe("other");
  });

  // 이것을 실패시키는 것: 여기서 던지면 지워진 파일을 여는 호출자가 읽기 오류 대신 등록 오류를 받는다.
  it("falls back to what it listed if the backend refuses", async () => {
    const listed = fileContext();
    useContextStore.setState({ contexts: [listed] });
    ipc.addContext.mockRejectedValue(new Error("Not a file"));

    await expect(
      useContextStore.getState().ensureFileContext(PATH),
    ).resolves.toEqual(listed);
  });

  // 이것을 실패시키는 것: 거부를 삼키면 다른 창의 등록이 있을 때 거부한 파일이 그대로 열린다.
  it("lets a refused approval stand", async () => {
    useContextStore.setState({ contexts: [fileContext()] });
    ipc.addContext.mockRejectedValue("VAULT_APPROVAL_DENIED");

    await expect(
      useContextStore.getState().ensureFileContext(PATH),
    ).rejects.toBe("VAULT_APPROVAL_DENIED");
  });

  // The pair: a file inside an open vault is the vault's, and needs no registration of its own.
  it("does not register a file inside a vault it lists", async () => {
    const vault = fileContext({
      contextType: "vault",
      id: "vault",
      path: "/elsewhere",
    });
    useContextStore.setState({ contexts: [vault] });

    await expect(
      useContextStore.getState().ensureFileContext(PATH),
    ).resolves.toEqual(vault);

    expect(ipc.addContext).not.toHaveBeenCalled();
  });
});
