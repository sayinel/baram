// §277.2 완전 삭제 확인 문구에 들어갈 "참조 N곳".
//
// 이 수의 위험한 방향은 **과소**다 — 실제로는 참조가 있는데 0이 나오면
// 사용자는 안전하다고 읽고 되돌릴 수 없는 삭제를 누른다. 그래서 여기서
// 고정하는 것은 "0을 안전으로 쓰지 말라"는 계약(호출부)이 아니라, 0이
// 나오는 **모든 경로**가 실제로 0을 돌려준다는 사실이다.
import type { BacklinkEntry } from "../../../../ipc/types";

import { beforeEach, describe, expect, it, vi } from "vitest";

const { getBacklinks } = vi.hoisted(() => ({ getBacklinks: vi.fn() }));
vi.mock("../../../../ipc/link-index", () => ({ getBacklinks }));

const { logger } = vi.hoisted(() => ({
  logger: { error: vi.fn(), warn: vi.fn() },
}));
vi.mock("../../../../utils/logger", () => ({ logger }));

import { countHighlightRefs } from "../pdf-highlight-ref-count";

const COMPANION = "/vault/highlights/papers/attention.md";

// ‼️ linkType을 기본값에 **반드시** 담는다. Rust 인덱스는 항상 채워 보내는데
// (extractor.rs), 픽스처가 비워 두면 "어떤 링크 종류를 세는가"가 어느 방향으로도
// 고정되지 않는다 — 필터를 조이든 풀든 전부 초록이다.
function entry(overrides: Partial<BacklinkEntry> = {}): BacklinkEntry {
  return {
    context: "see ((highlights/papers/attention#^h1))",
    line: 3,
    linkType: "blockRef",
    sourcePath: "/vault/notes/reading.md",
    targetPath: COMPANION,
    ...overrides,
  };
}

describe("countHighlightRefs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("counts only the entries whose blockId matches", async () => {
    getBacklinks.mockResolvedValue([
      entry({ blockId: "h1" }),
      entry({ blockId: "h1", sourcePath: "/vault/notes/other.md" }),
      entry({ blockId: "h2" }),
      // 블록 id 없는 항목 = 평범한 위키링크. 이 하이라이트를 가리키지 않는다.
      entry(),
    ]);

    expect(await countHighlightRefs(COMPANION, "h1")).toBe(2);
  });

  // 인덱스의 키는 파일 stem 기반이라 `Paper.pdf`와 `highlights/Paper.md`가
  // 같은 키로 겹친다(§278에 적힌 기존 결함) — 그 겹침이 이 수를 오염시키지
  // 못한다는 것이 blockId로 거르는 이유다.
  it("is not confused by backlinks that belong to the PDF's own stem collision", async () => {
    getBacklinks.mockResolvedValue([
      entry({ blockId: "h1" }),
      entry({
        context: "[[attention]]",
        targetPath: "/vault/papers/attention.pdf",
      }),
    ]);

    expect(await countHighlightRefs(COMPANION, "h1")).toBe(1);
  });

  it("asks the index about the companion note, which is what block refs target", async () => {
    getBacklinks.mockResolvedValue([]);
    await countHighlightRefs(COMPANION, "h1");
    expect(getBacklinks).toHaveBeenCalledWith(COMPANION);
  });

  // 블록 임베드는 완전 삭제로 아무것도 잃지 않는다 — 임베드가 그리는 것은
  // 동반 노트의 문단이고, 완전 삭제는 사이드카 항목만 지운다. 세면 경고가
  // 실제보다 무거워진다.
  it("does not count a block embed, which keeps rendering after a purge", async () => {
    getBacklinks.mockResolvedValue([
      entry({ blockId: "h1", linkType: "blockRef" }),
      entry({
        blockId: "h1",
        context: "{{embed ((highlights/papers/attention#^h1))}}",
        linkType: "blockEmbed",
      }),
    ]);

    expect(await countHighlightRefs(COMPANION, "h1")).toBe(1);
  });

  // ‼️ 반대 방향은 열어 둔다. 과소 집계가 위험한 방향이므로("참조 0곳"이
  // 없는 안전을 약속한다), 모르는 종류는 뺀다가 아니라 **센다**.
  it.each([
    ["an unknown future link type", "someFutureKind"],
    ["a missing link type", undefined],
  ])("counts %s rather than dropping it", async (_label, linkType) => {
    getBacklinks.mockResolvedValue([entry({ blockId: "h1", linkType })]);

    expect(await countHighlightRefs(COMPANION, "h1")).toBe(1);
  });

  it("returns 0 without asking when there is no companion path", async () => {
    expect(await countHighlightRefs(null, "h1")).toBe(0);
    expect(getBacklinks).not.toHaveBeenCalled();
  });

  // 개수를 못 세는 것이 완전 삭제를 막을 이유는 아니다 — 던지면 호출부의
  // catch가 "쓰기 실패" 토스트를 띄워, 아직 아무것도 쓰지 않았는데 실패한
  // 것처럼 보인다.
  it("returns 0 and logs instead of throwing when the index call fails", async () => {
    getBacklinks.mockRejectedValue(new Error("index not ready"));

    await expect(countHighlightRefs(COMPANION, "h1")).resolves.toBe(0);
    expect(logger.warn).toHaveBeenCalled();
  });
});
