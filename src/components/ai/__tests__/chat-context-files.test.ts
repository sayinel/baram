// §3.5 AI 채팅의 `@file:` 은 앱이 들고 있지 않은 파일을 디스크에서 읽는다 (#798).
//
// `openFiles` 는 탭이 보이는 파일만 든다 — 닫은 파일의 원문은 탭과 함께 내려간다. 참조 선택기는 트리의 모든
// 파일을 내놓으므로, 앞서 닫았거나 연 적 없는 파일이 경로만으로 들어가지 않으려면 디스크에서 읽어야 한다.
import { beforeEach, describe, expect, it, vi } from "vitest";

const readFile = vi.hoisted(() => vi.fn(async (_path: string) => "from disk"));
const listDir = vi.hoisted(() =>
  vi.fn(async (_path: string, _recursive?: boolean) => [
    { isDir: false, name: "a.md", path: "/vault/a.md" },
  ]),
);

vi.mock("../../../ipc/fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../ipc/fs")>()),
  listDir,
  readFile,
}));

import { useContextStore } from "../../../stores/context/context";
import { useEditorStore } from "../../../stores/editor/editor";
import { useFileStore } from "../../../stores/file/file";
import { resolveReferences } from "../../../utils/chat-context";

beforeEach(() => {
  readFile.mockClear();
  useFileStore.setState({ openFiles: new Map() });
  useEditorStore.setState({ activeTabId: null, tabs: [] });
});

describe("§3.5 @file: references", () => {
  // 이것을 실패시키는 것: chat-context.ts 의 `readUnheldFiles` 호출을 지우면 `[file: …]` 자리표시만 들어간다.
  it("reads a file no tab shows from disk", async () => {
    const [ref] = await resolveReferences(["@file:/v/closed.md"]);
    expect(readFile).toHaveBeenCalledWith("/v/closed.md");
    expect(ref.content).toBe("from disk");
    expect(ref.label).toBe("closed.md");
  });

  // 긍정 짝 — 탭이 보이는 파일은 앱이 들고 있는 글(저장 안 한 것까지)을 쓰고 디스크를 읽지 않는다.
  it("uses the text the app holds for a file a tab shows", async () => {
    useFileStore.setState({ openFiles: new Map([["/v/open.md", "held"]]) });
    const [ref] = await resolveReferences(["@file:/v/open.md"]);
    expect(readFile).not.toHaveBeenCalled();
    expect(ref.content).toBe("held");
  });

  it("keeps the placeholder when the read fails", async () => {
    readFile.mockRejectedValueOnce(new Error("gone"));
    const [ref] = await resolveReferences(["@file:/v/gone.md"]);
    expect(ref.content).toBe("[file: /v/gone.md]");
  });

  // 이것을 실패시키는 것: `resolveReferences` 가 비동기 단계에 걸러진 결과 목록과 걸러지지 않은 참조 목록을
  // 함께 넘기면, 답하지 못해 빠진 `@current` 뒤의 참조가 하나씩 밀려 `@vault:` 가 해석되지 않는다.
  it("keeps each result paired with its reference when one is dropped", async () => {
    useContextStore.setState({
      contexts: [
        {
          contextType: "folder",
          id: "ctx1",
          label: "Work",
          path: "/vault",
        },
      ],
    } as never);
    const refs = await resolveReferences(["@current", "@vault:ctx1"]);
    expect(refs).toHaveLength(1);
    expect(refs[0].content).toContain("Files in Work");
    expect(refs[0].content).toContain("a.md");
  });
});
