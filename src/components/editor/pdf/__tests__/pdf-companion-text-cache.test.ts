// §276.5 readCompanionTextCoalesced — 합류(coalescing)이지 캐시가 아니다.
//
// 이 파일이 지켜야 하는 두 성질은 서로 반대 방향이다:
//   • 동시에 들어온 요청은 파일을 한 번만 읽는다 (참조 N개 → 읽기 1회)
//   • settle된 뒤의 요청은 반드시 다시 읽는다 (사용자가 노트를 고치면
//     다음 표시가 새 텍스트를 보여야 한다)
// 두 번째를 단정하지 않으면 "맵에서 지우지 않는다"(=캐시로 변질)는 변경이
// 첫 번째 테스트만으로는 살아남는다.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { logger } = vi.hoisted(() => ({
  logger: { error: vi.fn(), warn: vi.fn() },
}));
vi.mock("../../../../utils/logger", () => ({ logger }));

// 프로덕션 기본 reader가 파일 I/O를 타지 않도록 막아 둔다 — 이 파일의 모든
// 테스트는 reader를 직접 주입하지만, 실수로 빠뜨렸을 때 진짜 IPC를 때리는
// 대신 여기서 잡힌다.
const { readCompanionNoteContent } = vi.hoisted(() => ({
  readCompanionNoteContent: vi.fn(async () => null),
}));
vi.mock("../pdf-highlight-store", () => ({ readCompanionNoteContent }));

import { readCompanionTextCoalesced } from "../pdf-companion-text-cache";

const COMPANION = "/vault/highlights/papers/attention.md";
const OTHER_COMPANION = "/vault/highlights/papers/bert.md";

const NOTE = [
  "Attention mechanisms let the model weigh (all) positions ^h7k2m9",
  "",
  "A second highlighted sentence ^p3q8r1",
  "",
  "   ^blank12",
].join("\n");

/** 해소 시점을 테스트가 직접 정하는 reader. */
function deferredReader(): {
  calls: string[];
  fail: (err: unknown) => void;
  read: (path: string) => Promise<null | string>;
  settle: (value: null | string) => void;
} {
  const calls: string[] = [];
  let resolveIt: (v: null | string) => void = () => undefined;
  let rejectIt: (e: unknown) => void = () => undefined;
  return {
    calls,
    fail: (err) => {
      rejectIt(err);
    },
    read: (path: string) => {
      calls.push(path);
      return new Promise<null | string>((res, rej) => {
        resolveIt = res;
        rejectIt = rej;
      });
    },
    settle: (value) => {
      resolveIt(value);
    },
  };
}

describe("readCompanionTextCoalesced", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("extracts the block's text from the companion note", async () => {
    const read = vi.fn(async () => NOTE);

    expect(await readCompanionTextCoalesced(COMPANION, "h7k2m9", read)).toBe(
      "Attention mechanisms let the model weigh (all) positions",
    );
  });

  it("returns the FULL sentence, including the characters buildRefDisplay strips", async () => {
    // 이 기능의 존재 이유 — display 슬롯은 `( ) [ ] |`를 지우고 80자에서
    // 자르지만, 동반 노트의 문단은 원문을 온전히 갖고 있다.
    const read = vi.fn(async () => NOTE);

    const text = await readCompanionTextCoalesced(COMPANION, "h7k2m9", read);

    expect(text).toContain("(all)");
  });

  it("joins three concurrent reads of the same note into ONE file read", async () => {
    const d = deferredReader();

    const all = Promise.all([
      readCompanionTextCoalesced(COMPANION, "h7k2m9", d.read),
      readCompanionTextCoalesced(COMPANION, "p3q8r1", d.read),
      readCompanionTextCoalesced(COMPANION, "h7k2m9", d.read),
    ]);
    d.settle(NOTE);

    expect(await all).toEqual([
      "Attention mechanisms let the model weigh (all) positions",
      "A second highlighted sentence",
      "Attention mechanisms let the model weigh (all) positions",
    ]);
    expect(d.calls).toEqual([COMPANION]);
  });

  it("gives each joiner its OWN block — the coalescing key is the path, not the id", async () => {
    // 합류 키에 blockId를 섞으면 같은 노트의 서로 다른 참조가 각자 파일을
    // 읽는다(합류가 사라진다). 반대로 결과를 blockId 없이 나눠 쓰면 두
    // 참조가 같은 문단을 보여준다. 위 테스트와 이 단정이 그 둘을 함께 막는다.
    const read = vi.fn(async () => NOTE);

    const [first, second] = await Promise.all([
      readCompanionTextCoalesced(COMPANION, "h7k2m9", read),
      readCompanionTextCoalesced(COMPANION, "p3q8r1", read),
    ]);

    expect(first).not.toBe(second);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("‼️ reads AGAIN once the previous read settled — it joins, it does not cache", async () => {
    // 판별력: joinRead의 `.finally(() => inFlight.delete(...))`를 지우면
    // 두 번째 읽기가 일어나지 않고 read 호출이 1회로 남는다. 그 상태에서는
    // 사용자가 동반 노트에서 문단을 고쳐도 참조가 옛 텍스트에 영원히 고정된다.
    const read = vi
      .fn<(path: string) => Promise<null | string>>()
      .mockResolvedValueOnce("first version ^h7k2m9")
      .mockResolvedValueOnce("edited by the user ^h7k2m9");

    const before = await readCompanionTextCoalesced(COMPANION, "h7k2m9", read);
    const after = await readCompanionTextCoalesced(COMPANION, "h7k2m9", read);

    expect(before).toBe("first version");
    expect(after).toBe("edited by the user");
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("does not join reads of different notes", async () => {
    const read = vi
      .fn<(path: string) => Promise<null | string>>()
      .mockResolvedValue(NOTE);

    await Promise.all([
      readCompanionTextCoalesced(COMPANION, "h7k2m9", read),
      readCompanionTextCoalesced(OTHER_COMPANION, "h7k2m9", read),
    ]);

    expect(read.mock.calls.map((c) => c[0])).toEqual([
      COMPANION,
      OTHER_COMPANION,
    ]);
  });

  it("returns null (never throws) when the read fails, and logs it", async () => {
    // 호출부는 NodeView다 — 던지면 main.tsx의 전역 unhandledrejection
    // 핸들러가 preventDefault()로 삼켜 흔적 없이 사라진다.
    const read = vi.fn(() => Promise.reject(new Error("permission denied")));

    expect(
      await readCompanionTextCoalesced(COMPANION, "h7k2m9", read),
    ).toBeNull();
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it("releases the in-flight entry on failure too, so a retry is possible", async () => {
    // 실패한 Promise가 맵에 남으면 그 노트의 참조는 앱을 껐다 켜기 전까지
    // 영원히 실패한다 — 일시적인 실패(파일이 잠깐 잠김)가 영구 장애가 된다.
    const failing = deferredReader();
    const first = readCompanionTextCoalesced(COMPANION, "h7k2m9", failing.read);
    failing.fail(new Error("permission denied"));
    expect(await first).toBeNull();

    const retry = vi.fn(async () => NOTE);
    expect(await readCompanionTextCoalesced(COMPANION, "h7k2m9", retry)).toBe(
      "Attention mechanisms let the model weigh (all) positions",
    );
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("returns null when the companion note does not exist", async () => {
    const read = vi.fn(async () => null);

    expect(
      await readCompanionTextCoalesced(COMPANION, "h7k2m9", read),
    ).toBeNull();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("returns null when the note has no paragraph for that block id", async () => {
    const read = vi.fn(async () => NOTE);

    expect(
      await readCompanionTextCoalesced(COMPANION, "gone999", read),
    ).toBeNull();
  });
});
