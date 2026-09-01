// §5.13 쿼리 결과 행 → 그 문서로 이동.
//
// 결과 목록은 CSS로 `cursor: pointer`와 hover까지 갖춰 놓고도 클릭 핸들러가 없었다.
// 누를 수 있어 보이는데 아무 일도 일어나지 않는 상태였다.
//
// 여기서 "열렸는가"가 아니라 **무엇을 열었는가**를 단정하는 이유: `VaultFile.path`는
// vault 상대경로(`use-query-block.ts`가 rootPath를 떼어 낸 값)이고 파일을 읽는 쪽은
// 절대경로만 받는다(`fs/mod.rs`의 `validate_path`가 상대경로를 거부한다). 호출 여부만
// 보는 테스트는 경로를 안 붙여도 초록이라 정확히 그 결함을 놓친다.
//
// 두 번째 계약은 stopPropagation이다. NodeViewWrapper의 onClick이 블록을 편집 상태로
// 여는데(`handleWrapperClick`), 행 클릭이 거기까지 새어 나가면 문서로 이동하면서
// 빌더까지 열린다. 그래서 `qb-editing`이 붙지 않는지도 함께 본다.

import type { VaultFile } from "../../../../utils/query-executor";

import { act, fireEvent, render } from "@testing-library/react";
import { Editor, type JSONContent } from "@tiptap/core";
import { EditorContent } from "@tiptap/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createBaramExtensions } from "../../..";

const FILES: VaultFile[] = [
  {
    frontmatter: {},
    modifiedAt: 0,
    name: "202507211839 제주 여행 (2014).md",
    path: "Zettel/notes/202507211839 제주 여행 (2014).md",
    tags: ["Diary"],
  },
  {
    frontmatter: {},
    modifiedAt: 0,
    name: "202505192202 The Hard Thing.md",
    path: "Zettel/notes/202505192202 The Hard Thing.md",
    tags: ["Book"],
  },
];

const { openSpy, stub } = vi.hoisted(() => ({
  openSpy: vi.fn(),
  stub: { vaultPath: "/vault" as null | string },
}));

vi.mock("../../../../components/zettelkasten/open-hub-note", () => ({
  openZettelHubNote: openSpy,
}));

vi.mock("../../../../hooks/use-query-block", () => ({
  resultCount: () => 2,
  useQueryBlock: () => ({
    error: null,
    execute: vi.fn(),
    loading: false,
    results: { files: FILES, source: "files" },
    vaultPath: stub.vaultPath,
  }),
}));

const editors: Editor[] = [];

function docWith(query: string): JSONContent {
  // ‼️ 쿼리 블록 앞에 문단이 있어야 한다. 블록이 문서의 첫 노드면 **마운트 시점의 초기
  // 선택**이 그 위에 놓여 빌더가 이미 열린 채로 시작한다 — 그 상태에서는 "행 클릭이
  // 빌더를 열지 않는다"는 단정이 구현과 무관하게 항상 통과한다(측정으로 확인).
  return {
    content: [
      { content: [{ text: "위 문단", type: "text" }], type: "paragraph" },
      { attrs: { query }, type: "queryBlock" },
    ],
    type: "doc",
  };
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 3; i++) {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      await new Promise((r) => setTimeout(r, 0));
    }
  });
}

function rows(selector: string): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(selector)];
}

async function setup(query: string): Promise<void> {
  const editor = new Editor({
    content: docWith(query),
    extensions: createBaramExtensions(),
  });
  editors.push(editor);
  render(<EditorContent editor={editor} />);
  await flush();
}

beforeEach(() => {
  stub.vaultPath = "/vault";
  openSpy.mockClear();
});

afterEach(() => {
  while (editors.length) editors.pop()?.destroy();
  document.body.innerHTML = "";
});

describe("§5.13 쿼리 결과 클릭 → 문서 열기", () => {
  it("목록 모드: vault 상대경로에 rootPath를 붙인 절대경로로 연다", async () => {
    await setup('filter: tags contains "Diary"');

    const items = rows(".qb-list-item");
    expect(items).toHaveLength(2);

    await act(async () => {
      fireEvent.click(items[1]);
    });

    // 두 번째 행 — 첫 행이 아니라 누른 행을 여는지까지 고정한다.
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(openSpy).toHaveBeenCalledWith(
      "/vault/Zettel/notes/202505192202 The Hard Thing.md",
    );
  });

  it("표 모드에서도 같은 규칙으로 연다", async () => {
    await setup('display: table\nfilter: tags contains "Diary"');

    const trs = rows(".qb-table tbody tr");
    expect(trs).toHaveLength(2);

    await act(async () => {
      fireEvent.click(trs[0]);
    });

    expect(openSpy).toHaveBeenCalledWith(
      "/vault/Zettel/notes/202507211839 제주 여행 (2014).md",
    );
  });

  it("카드 모드에서도 같은 규칙으로 연다", async () => {
    await setup('display: card\nfilter: tags contains "Diary"');

    const cards = rows(".qb-card");
    expect(cards).toHaveLength(2);

    await act(async () => {
      fireEvent.click(cards[1]);
    });

    expect(openSpy).toHaveBeenCalledWith(
      "/vault/Zettel/notes/202505192202 The Hard Thing.md",
    );
  });

  it("Enter 키로도 열린다", async () => {
    await setup('filter: tags contains "Diary"');

    await act(async () => {
      fireEvent.keyDown(rows(".qb-list-item")[0], { key: "Enter" });
    });

    expect(openSpy).toHaveBeenCalledWith(
      "/vault/Zettel/notes/202507211839 제주 여행 (2014).md",
    );
  });

  it("행 클릭이 빌더까지 열지는 않는다 (stopPropagation)", async () => {
    await setup('filter: tags contains "Diary"');

    await act(async () => {
      fireEvent.click(rows(".qb-list-item")[0]);
    });

    const container = document.querySelector(".qb-container");
    expect(container).not.toBeNull();
    expect(container!.className).not.toContain("qb-editing");
    expect(container!.querySelector(".qb-builder")).toBeNull();
  });

  it("vault가 열려 있지 않으면 아무것도 열지 않는다", async () => {
    stub.vaultPath = null;
    await setup('filter: tags contains "Diary"');

    await act(async () => {
      fireEvent.click(rows(".qb-list-item")[0]);
    });

    // 상대경로를 절대경로로 만들 기준이 없다 — 잘못된 경로를 여는 것보다 아무 일도
    // 하지 않는 편이 낫다.
    expect(openSpy).not.toHaveBeenCalled();
  });
});
