// §277.2 완전 삭제 확인 문구에 들어갈 "참조 N곳".
//
// ‼️ 이 파일의 첫 판은 **전부 초록인 채로 기능이 죽어 있었다.** getBacklinks를
// vi.mock으로 덮어 두었더니, 링크 인덱스가 이 참조들을 애초에 찾지 못한다는
// 사실(저장 키 "highlights/paper" vs 조회 키 "paper")이 테스트에는 보이지
// 않았다. 실기기에서야 드러났다 — cf. mocked-integration-hides-total-failure.
//
// 그래서 이 파일은 두 층을 따로 본다:
//   1. **배선** — searchFiles를 모킹해 "무엇을 물어보는가"를 본다.
//   2. **패턴 자체** — 그 질의 문자열을 진짜 마크다운에 돌려 본다. IPC는
//      vitest에서 못 돌리지만, 실제로 틀렸던 층(무엇을 매치하는가)은 여기서
//      진짜로 실행할 수 있다. 모킹 뒤에 숨는 부분을 최소로 줄이는 것이 요점이다.
import type { SearchResult } from "../../../../ipc/types";

import { beforeEach, describe, expect, it, vi } from "vitest";

const { searchFiles } = vi.hoisted(() => ({ searchFiles: vi.fn() }));
vi.mock("../../../../ipc/search", () => ({ searchFiles }));

const { logger } = vi.hoisted(() => ({
  logger: { error: vi.fn(), warn: vi.fn() },
}));
vi.mock("../../../../utils/logger", () => ({ logger }));

const state = { rootPath: "/vault" as null | string };
vi.mock("../../../../stores/file/file", () => ({
  useFileStore: { getState: () => state },
}));

import { countHighlightRefs } from "../pdf-highlight-ref-count";

const ID = "a1b2c3d4";

function hit(n: number): SearchResult[] {
  return Array.from({ length: n }, (_, i) => ({
    column: 1,
    filePath: `/vault/notes/${String(i)}.md`,
    line: 1,
    snippet: "",
  }));
}

/** 배선 테스트가 실제로 넘긴 질의 문자열을 꺼낸다. */
function queries(): string[] {
  return searchFiles.mock.calls.map((c) => c[1] as string);
}

beforeEach(() => {
  vi.clearAllMocks();
  state.rootPath = "/vault";
  searchFiles.mockResolvedValue([]);
});

describe("countHighlightRefs — wiring", () => {
  it("subtracts embeds, which keep rendering after a purge", async () => {
    // 임베드는 참조 패턴에도 걸린다(임베드가 참조를 품고 있다).
    searchFiles.mockResolvedValueOnce(hit(5)); // refs + embeds
    searchFiles.mockResolvedValueOnce(hit(2)); // embeds

    expect(await countHighlightRefs(ID)).toBe(3);
  });

  // ‼️ includeGlob을 **넘기지 않는다는 것**이 단정의 요점이다. 생략이 곧
  // ".md만"이고(search/mod.rs의 include_matches), 넘기면 그 매처의 문법을
  // 따라야 한다 — `"**/*.md"`를 넘겼다가 아무것도 못 찾은 적이 있다.
  // 그 매처는 `*.`으로 시작하지 않는 패턴을 **경로 접두사**로 본다.
  it("searches the vault root and lets the default .md scope stand", async () => {
    await countHighlightRefs(ID);

    expect(searchFiles).toHaveBeenCalledTimes(2);
    for (const call of searchFiles.mock.calls) {
      expect(call[0]).toBe("/vault");
      expect(call[2]).toMatchObject({ regex: true });
      expect((call[2] as { includeGlob?: string }).includeGlob).toBeUndefined();
    }
  });

  it("returns 0 without searching when there is no vault", async () => {
    state.rootPath = null;

    expect(await countHighlightRefs(ID)).toBe(0);
    expect(searchFiles).not.toHaveBeenCalled();
  });

  // 개수를 못 세는 것이 완전 삭제를 막을 이유는 아니다 — 던지면 호출부의
  // catch가 "쓰기 실패" 토스트를 띄워, 아직 아무것도 쓰지 않았는데 실패한
  // 것처럼 보인다.
  it("returns 0 and logs instead of throwing when the search fails", async () => {
    searchFiles.mockRejectedValue(new Error("search unavailable"));

    await expect(countHighlightRefs(ID)).resolves.toBe(0);
    expect(logger.warn).toHaveBeenCalled();
  });

  // 두 검색이 같은 순간의 디스크를 본다는 보장이 없다.
  it("never reports a negative count", async () => {
    searchFiles.mockResolvedValueOnce(hit(1));
    searchFiles.mockResolvedValueOnce(hit(3));

    expect(await countHighlightRefs(ID)).toBe(0);
  });

  // 정규식 메타문자가 든 id는 패턴을 깨뜨리는 대신 **다른 것을 세게** 만든다.
  it("refuses to search for an id that is not a plain block id", async () => {
    expect(await countHighlightRefs("a.*b")).toBe(0);
    expect(searchFiles).not.toHaveBeenCalled();
  });
});

// ‼️ 여기가 진짜로 돌아가는 층이다. 위 배선이 꺼내 온 **바로 그 질의 문자열**을
// 실제 마크다운에 적용한다 — 형식을 눈대중으로 흉내 낸 별도 패턴을 쓰면 이
// 파일이 검증하는 대상이 제품 코드가 아니게 된다.
describe("countHighlightRefs — the patterns it actually sends", () => {
  let refRe: RegExp;
  let embedRe: RegExp;

  beforeEach(async () => {
    await countHighlightRefs(ID);
    const [ref, embed] = queries();
    refRe = new RegExp(ref, "g");
    embedRe = new RegExp(embed, "g");
  });

  function refCount(line: string): number {
    return [...line.matchAll(refRe)].length;
  }

  it.each([
    ["a plain reference", "see ((highlights/papers/attention#^a1b2c3d4))"],
    [
      "a reference with display text",
      "see ((highlights/p#^a1b2c3d4|Attention is))",
    ],
    ["a self reference", "see ((#^a1b2c3d4))"],
  ])("matches %s", (_label, line) => {
    expect(refCount(line)).toBe(1);
  });

  // ‼️ 동반 노트의 **정의**는 세면 안 된다. `highlights/*.md`도 검색 범위에
  // 들어가므로, 정의를 세면 모든 하이라이트가 최소 1곳으로 잡힌다.
  it("does not match the block-id definition in the companion note", () => {
    expect(refCount("Attention is all you need ^a1b2c3d4")).toBe(0);
  });

  it("does not match a different block id", () => {
    expect(refCount("see ((highlights/p#^ffffffff))")).toBe(0);
  });

  // 인덱스는 한 줄의 두 참조 중 뒤엣것을 버린다(index/mod.rs:233의
  // (파일, 줄) 중복 제거). 검색으로 세는 이유 중 하나가 이것이다.
  it("counts both references on one line — the thing the index drops", () => {
    expect(
      refCount(
        "compare ((highlights/p#^a1b2c3d4)) with ((highlights/p#^a1b2c3d4))",
      ),
    ).toBe(2);
  });

  it("matches an embed with the embed pattern", () => {
    const line = "{{embed ((highlights/papers/attention#^a1b2c3d4))}}";
    expect([...line.matchAll(embedRe)]).toHaveLength(1);
    // 참조 패턴에도 걸리므로 빼는 것이다 — 그 전제를 여기서 고정한다.
    expect(refCount(line)).toBe(1);
  });

  it("does not treat a plain reference as an embed", () => {
    expect([
      ..."see ((highlights/p#^a1b2c3d4))".matchAll(embedRe),
    ]).toHaveLength(0);
  });
});
