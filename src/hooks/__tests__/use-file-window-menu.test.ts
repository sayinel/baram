// §89 What a file window does with the native menu commands sent to it.
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const host = vi.hoisted(() => ({
  close: vi.fn(async () => undefined),
  deliver: null as ((event: { payload: string }) => void) | null,
  listen: vi.fn(),
  runInsert: vi.fn(async () => undefined),
  unlisten: vi.fn(),
}));

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({
    listen: async (name: string, handler: (e: { payload: string }) => void) => {
      host.listen(name);
      host.deliver = handler;
      return host.unlisten;
    },
  }),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ close: host.close }),
}));

vi.mock("../../utils/editor/insert-menu-commands", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../utils/editor/insert-menu-commands")
  >()),
  runInsertMenuCommand: host.runInsert,
}));

import type { Editor } from "@tiptap/react";

import { useUIStore } from "../../stores/ui/ui";
import { useFileWindowMenu } from "../use-file-window-menu";

const editor = {} as Editor;

function mount(over: { holdsDocument?: boolean } = {}) {
  const actions = {
    editor,
    handleSave: vi.fn(async () => undefined),
    holdsDocument: true,
    toggleSource: vi.fn(),
    ...over,
  };
  const hook = renderHook((props: typeof actions) => useFileWindowMenu(props), {
    initialProps: actions,
  });
  return { actions, hook };
}

async function send(id: string) {
  await vi.waitFor(() => expect(host.deliver).not.toBeNull());
  host.deliver?.({ payload: id });
}

beforeEach(() => {
  vi.clearAllMocks();
  host.deliver = null;
  useUIStore.setState({ toast: null });
});

describe("a menu command in a file window", () => {
  it("listens to what is sent to this window", async () => {
    mount();
    await vi.waitFor(() =>
      expect(host.listen).toHaveBeenCalledWith("menu-event"),
    );
  });

  it("saves this window's text", async () => {
    const { actions } = mount();

    await send("file_save");

    expect(actions.handleSave).toHaveBeenCalledOnce();
  });

  // 이것을 실패시키는 것: 창을 그냥 없애면 저장 안 된 글을 묻지 않고 버린다. `close` 는 저장 확인을 거친다.
  it("closes through the close that asks about unsaved work", async () => {
    mount();

    await send("file_close_tab");

    expect(host.close).toHaveBeenCalledOnce();
  });

  it("switches source mode", async () => {
    const { actions } = mount();

    await send("view_source");

    expect(actions.toggleSource).toHaveBeenCalledOnce();
  });

  it("runs an insert command on this window's editor", async () => {
    mount();

    await send("insert_bold");

    expect(host.runInsert).toHaveBeenCalledWith("insert_bold", editor);
  });

  // 이것을 실패시키는 것: 소스 모드나 불러오기 전에는 보이지 않는 문서가 바뀐다.
  it("leaves the document alone while it is not the one on screen", async () => {
    mount({ holdsDocument: false });

    await send("insert_bold");

    expect(host.runInsert).not.toHaveBeenCalled();
  });

  // 이것을 실패시키는 것: 조용히 무시하면 단축키가 표시된 메뉴를 눌러도 실패했는지조차 알 수 없다.
  it.each([
    "file_save_as",
    "export_doc",
    "edit_find_replace",
    "view_reload",
    "go_back",
    "view_inline_ai",
    "file_close_folder",
  ])("says it cannot do %s, and does nothing else", async (id) => {
    const { actions } = mount();

    await send(id);

    expect(useUIStore.getState().toast?.message).toBe(
      "This isn't available in a separate window.",
    );
    expect(actions.handleSave).not.toHaveBeenCalled();
    expect(actions.toggleSource).not.toHaveBeenCalled();
    expect(host.close).not.toHaveBeenCalled();
    expect(host.runInsert).not.toHaveBeenCalled();
  });

  it("says why an insert command did nothing", async () => {
    mount({ holdsDocument: false });

    await send("insert_bold");

    expect(useUIStore.getState().toast?.message).toBe(
      "This works on the document. Leave source mode first.",
    );
  });

  // The pair: what it can do says nothing.
  it("stays quiet about what it did", async () => {
    mount();

    await send("insert_bold");
    await send("file_save");

    expect(useUIStore.getState().toast).toBeNull();
  });

  it("uses the actions of the latest render", async () => {
    const { actions, hook } = mount();
    await vi.waitFor(() => expect(host.deliver).not.toBeNull());
    const handleSave = vi.fn(async () => undefined);

    hook.rerender({ ...actions, handleSave });
    await send("file_save");

    expect(handleSave).toHaveBeenCalledOnce();
    expect(actions.handleSave).not.toHaveBeenCalled();
  });

  it("stops listening when the window's layout goes away", async () => {
    const { hook } = mount();
    await vi.waitFor(() => expect(host.deliver).not.toBeNull());

    hook.unmount();

    await vi.waitFor(() => expect(host.unlisten).toHaveBeenCalledOnce());
  });
});
