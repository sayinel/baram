/*
 * §3.6 `readTabLocalText` — 탭 자신의 저장 안 된 텍스트를, 그 문서가 사는 자리에서 읽는다.
 *
 * 우선순위는 동시 후보로 고정한다. 한 픽스처에 모든 후보를 서로 다른 텍스트로 둔다:
 * 버퍼 "S", `openFiles` "T", 완성 keepalive "P", shared editor "E"(loadedTabId = a), cache "C".
 * 조건을 모두 켠 채 시작해 위에서부터 하나씩 끈다. 이웃한 두 단계를 바꾸면 한 단언이 깨진다.
 */
import type { Editor } from "@tiptap/core";
import type { EditorState } from "@tiptap/pm/state";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { makeTestEditor } from "../../../__tests__/helpers/make-test-editor";
import { useEditorStore } from "../../../stores/editor/editor";
import { useFileStore } from "../../../stores/file/file";
import {
  clearOriginalDoc,
  markContentLoaded,
  setDocumentOwner,
  setTabLoading,
} from "../programmatic-update";
import { readTabLocalText } from "../tab-local-text";

const A = "/v/a.md";

let shared: Editor;
let pooled: Editor;
let cache: Map<string, EditorState>;
let poolComplete: boolean;
let poolEntry: Editor | null;
const buffers = new Map<string, string>();

const fileTab = (id: string, filePath: string) => ({
  contextId: "c",
  filePath,
  id,
  isDirty: true,
  isPinned: false,
  title: id,
});

/** text 면 그 텍스트(앞뒤 공백 제거), unavailable 이면 이유. */
const read = (tabId = "a"): string => {
  const r = readTabLocalText(tabId);
  return r.kind === "text" ? r.text.trim() : r.reason;
};

beforeEach(() => {
  shared = makeTestEditor("<p>E</p>");
  pooled = makeTestEditor("<p>P</p>");
  const cacheSource = makeTestEditor("<p>C</p>");
  cache = new Map([["a", cacheSource.state]]);
  cacheSource.destroy();
  poolComplete = true;
  poolEntry = pooled;
  buffers.clear();
  buffers.set("a", "S");

  useFileStore.setState({ openFiles: new Map([[A, "T"]]) });
  useEditorStore.setState({
    activeTabId: "a",
    documentSurfaceAccess: {
      editor: shared,
      editorStateCache: cache,
      isKeepaliveComplete: () => poolComplete,
      keepaliveEditor: (id) => (id === "a" ? poolEntry : null),
    },
    mruOrder: [],
    sourceBufferAccess: {
      getSourceBuffer: (id) => buffers.get(id) ?? "",
      hasSourceBuffer: (id) => buffers.has(id),
      setSourceBuffer: (id, content) => {
        buffers.set(id, content);
      },
    },
    sourceModeTabs: ["a"],
    staleContentTabs: ["a"],
    tabs: [fileTab("a", A), fileTab("b", "/v/b.md")],
  });
  markContentLoaded("a");
  setDocumentOwner(shared, "a");
  setTabLoading("a", true);
});

afterEach(() => {
  setTabLoading("a", false);
  clearOriginalDoc("a");
  clearOriginalDoc("b");
  shared.destroy();
  if (!pooled.isDestroyed) pooled.destroy();
});

describe("§3.6 readTabLocalText — authority order", () => {
  it("walks the order by switching the conditions off one at a time", () => {
    // 이것을 실패시키는 것: 이웃한 두 단계의 교환 — 4↔5(소스↔로딩) 는 첫 단언, 5↔6(로딩↔stale)
    // 은 둘째, 6↔8(stale↔pool) 은 셋째, 8↔9(pool↔shared, F21) 는 넷째, 9↔10(shared↔cache) 은
    // 다섯째, 10↔11(cache↔text) 은 여섯째가 깬다.
    expect(read()).toBe("S");

    useEditorStore.setState({ sourceModeTabs: [] });
    expect(read()).toBe("loading");

    setTabLoading("a", false);
    expect(read()).toBe("T");

    useEditorStore.setState({ staleContentTabs: [] });
    expect(read()).toBe("P");

    poolEntry = null;
    expect(read()).toBe("E");

    markContentLoaded("b");
    setDocumentOwner(shared, "b");
    expect(read()).toBe("C");

    cache.delete("a");
    expect(read()).toBe("T");
  });

  it("a stale tab reads the text even when a complete pool entry exists", () => {
    // 이것을 실패시키는 것: stale 판정을 pool 뒤로.
    useEditorStore.setState({ sourceModeTabs: [] });
    setTabLoading("a", false);
    expect(read()).toBe("T");
  });

  it("an incomplete pool entry reads the text", () => {
    // 이것을 실패시키는 것: 미완 pool 판정 제거(미완 문서 "P" 를 읽는다).
    useEditorStore.setState({ sourceModeTabs: [], staleContentTabs: [] });
    setTabLoading("a", false);
    poolComplete = false;
    expect(read()).toBe("T");
  });

  it("a destroyed pool entry falls through to the next surface", () => {
    // 이것을 실패시키는 것: pool 의 `isDestroyed` 확인 제거(파괴된 editor 를 직렬화한다).
    useEditorStore.setState({ sourceModeTabs: [], staleContentTabs: [] });
    setTabLoading("a", false);
    pooled.destroy();
    expect(read()).toBe("E");
  });
});

describe("§3.6 readTabLocalText — the shared editor by its own record", () => {
  it("a tab last loaded into an evicted pool editor is loading, not the shared editor's document", () => {
    // 큰 탭 a 가 pool editor 에 로드됐다가 버려졌다 — loadedTabId 는 a, shared editor 는 b 를 든다.
    // 이것을 실패시키는 것: shared 판정을 `loadedTabId() === tabId` 로("E" 를 a 의 글로 읽는다) /
    // "loading" 갈래 제거(cache "C" 로 떨어진다).
    useEditorStore.setState({ sourceModeTabs: [], staleContentTabs: [] });
    setTabLoading("a", false);
    poolEntry = null;
    setDocumentOwner(shared, "b");

    expect(read()).toBe("loading");
  });
});

describe("§3.6 readTabLocalText — unavailable is never an empty string", () => {
  it("a missing source buffer is unavailable", () => {
    // 이것을 실패시키는 것: 버퍼 없음을 `getSourceBuffer` 의 "" 로 읽음.
    buffers.delete("a");
    expect(read()).toBe("source-unreachable");
  });

  it("an accessor without hasSourceBuffer is unavailable, not empty", () => {
    // 이것을 실패시키는 것: `hasSourceBuffer` 가 없을 때 버퍼를 있는 것으로 침.
    useEditorStore.setState({
      sourceBufferAccess: {
        getSourceBuffer: () => "",
        setSourceBuffer: () => undefined,
      },
    });
    expect(read()).toBe("source-unreachable");
  });

  it("no registered document surfaces is unavailable", () => {
    // 이것을 실패시키는 것: access null 판정 제거(`openFiles` 로 떨어진다).
    useEditorStore.setState({
      documentSurfaceAccess: null,
      sourceModeTabs: [],
      staleContentTabs: [],
    });
    setTabLoading("a", false);
    expect(read()).toBe("no-surface");
  });

  it("no cached file text is unavailable", () => {
    // 이것을 실패시키는 것: 텍스트 없음을 "" 로.
    useFileStore.setState({ openFiles: new Map() });
    useEditorStore.setState({ sourceModeTabs: [] });
    setTabLoading("a", false);
    expect(read()).toBe("no-text");
  });

  it("a binary viewer file is unavailable", () => {
    // 이것을 실패시키는 것: binary 판정 제거.
    useEditorStore.setState({ tabs: [fileTab("a", "/v/a.pdf")] });
    expect(read()).toBe("binary");
  });

  it("two tabs on one path are ambiguous", () => {
    // 이것을 실패시키는 것: 같은 경로 탭 판정 제거.
    useEditorStore.setState({ tabs: [fileTab("a", A), fileTab("a2", A)] });
    expect(read()).toBe("ambiguous");
  });

  it("a missing tab is unavailable", () => {
    // 이것을 실패시키는 것: no-tab 판정 제거(없는 탭의 경로를 읽다 throw 한다).
    expect(read("zzz")).toBe("no-tab");
  });

  it("a code tab reads its buffer though it is not in sourceModeTabs", () => {
    // 이것을 실패시키는 것: 소스 표면 판정을 `sourceModeTabs` 만으로.
    useEditorStore.setState({
      sourceModeTabs: [],
      tabs: [fileTab("a", "/v/x.ts")],
    });
    expect(read()).toBe("S");
  });
});
