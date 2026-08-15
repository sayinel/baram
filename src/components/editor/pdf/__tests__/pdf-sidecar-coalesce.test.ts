// §276.5 readSidecarCoalesced — 합류(coalescing)이지 캐시가 아니다.
//
// 이 읽기가 왜 합류돼야 하는가: §276.4 이후 `highlights/` 접두사를 가진 블록
// 참조는 전부 사이드카를 읽는다(리졸버가 읽고 나서야 종류를 안다). 논문 하나를
// 열 군데 인용한 노트는 같은 파일을 열 번 읽고 열 번 파싱한다.
//
// 지켜야 하는 두 성질은 서로 반대 방향이다:
//   • 동시에 들어온 요청은 파일을 한 번만 읽는다
//   • settle된 뒤의 요청은 반드시 다시 읽는다 — 사이드카는 **우리 자신이**
//     하이라이트를 추가/삭제할 때 덮어쓰므로, 캐시하면 방금 만든 하이라이트가
//     참조에서 보이지 않는다
import { beforeEach, describe, expect, it, vi } from "vitest";

// 프로덕션 기본 reader가 파일 I/O를 타지 않도록 막아 둔다 — 모든 테스트는
// reader를 직접 주입하지만, 실수로 빠뜨렸을 때 진짜 IPC를 때리는 대신 여기서
// 잡힌다.
const { readSidecar } = vi.hoisted(() => ({
  readSidecar: vi.fn(async () => null),
}));
vi.mock("../pdf-highlight-store", () => ({ readSidecar }));

import type { Sidecar } from "../pdf-highlight-sidecar";

import { readSidecarCoalesced } from "../pdf-sidecar-coalesce";

const SIDECAR_PATH = "/vault/.baram/pdf-highlights/papers/attention.json";
const OTHER_PATH = "/vault/.baram/pdf-highlights/papers/bert.json";

/** 해소 시점을 테스트가 직접 정하는 reader. */
function deferredReader(): {
  calls: string[];
  fail: (err: unknown) => void;
  read: (path: string) => Promise<null | Sidecar>;
  settle: (value: null | Sidecar) => void;
} {
  const calls: string[] = [];
  let resolveIt: (v: null | Sidecar) => void = () => undefined;
  let rejectIt: (e: unknown) => void = () => undefined;
  return {
    calls,
    fail: (err) => {
      rejectIt(err);
    },
    read: (path: string) => {
      calls.push(path);
      return new Promise<null | Sidecar>((res, rej) => {
        resolveIt = res;
        rejectIt = rej;
      });
    },
    settle: (value) => {
      resolveIt(value);
    },
  };
}

function sidecar(...ids: string[]): Sidecar {
  return {
    companion: "highlights/papers/attention.md",
    highlights: ids.map((id) => ({
      color: "yellow" as const,
      id,
      kind: "text" as const,
      page: 1,
      rects: [{ h: 10, w: 20, x: 0, y: 0 }],
    })),
    pdf: "papers/attention.pdf",
    version: 1,
  };
}

describe("readSidecarCoalesced", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns what the reader returned", async () => {
    const read = vi.fn(async () => sidecar("abc123"));

    expect(await readSidecarCoalesced(SIDECAR_PATH, read)).toEqual(
      sidecar("abc123"),
    );
  });

  it("joins three concurrent reads of the same sidecar into ONE file read", async () => {
    // 이것이 이 모듈의 존재 이유다 — 한 문서의 참조 N개가 같은 tick에
    // 들어오므로(NodeView 포털이 한 번에 flush된다) N번 읽고 N번 파싱하던
    // 것이 1회가 된다.
    const d = deferredReader();

    const all = Promise.all([
      readSidecarCoalesced(SIDECAR_PATH, d.read),
      readSidecarCoalesced(SIDECAR_PATH, d.read),
      readSidecarCoalesced(SIDECAR_PATH, d.read),
    ]);
    d.settle(sidecar("abc123"));

    const results = await all;
    expect(d.calls).toEqual([SIDECAR_PATH]);
    // 합류자 전원이 같은 객체를 받는다 — 읽기가 하나였다는 직접 증거.
    expect(results[0]).toBe(results[1]);
    expect(results[1]).toBe(results[2]);
  });

  it("‼️ reads AGAIN once the previous read settled — it joins, it does not cache", async () => {
    // 판별력: settle 시 맵에서 제거하는 한 줄을 지우면 두 번째 읽기가 일어나지
    // 않는다. 그 상태에서는 방금 만든 하이라이트를 가리키는 참조가 "사이드카에
    // 그 id가 없다"로 판정돼 영원히 display 라벨에 머문다.
    const read = vi
      .fn<(path: string) => Promise<null | Sidecar>>()
      .mockResolvedValueOnce(sidecar("abc123"))
      .mockResolvedValueOnce(sidecar("abc123", "new999"));

    const before = await readSidecarCoalesced(SIDECAR_PATH, read);
    const after = await readSidecarCoalesced(SIDECAR_PATH, read);

    expect(before?.highlights.map((h) => h.id)).toEqual(["abc123"]);
    expect(after?.highlights.map((h) => h.id)).toEqual(["abc123", "new999"]);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("does not join reads of different sidecars", async () => {
    const read = vi
      .fn<(path: string) => Promise<null | Sidecar>>()
      .mockResolvedValue(sidecar("abc123"));

    await Promise.all([
      readSidecarCoalesced(SIDECAR_PATH, read),
      readSidecarCoalesced(OTHER_PATH, read),
    ]);

    expect(read.mock.calls.map((c) => c[0])).toEqual([
      SIDECAR_PATH,
      OTHER_PATH,
    ]);
  });

  it("releases the in-flight entry on failure too, so a retry is possible", async () => {
    // 실패한 Promise가 맵에 남으면 그 PDF의 참조는 앱을 껐다 켜기 전까지
    // 영원히 실패한다 — 일시적인 실패가 영구 장애가 된다.
    const failing = deferredReader();
    const first = readSidecarCoalesced(SIDECAR_PATH, failing.read);
    failing.fail(new Error("permission denied"));
    expect(await first).toBeNull();

    const retry = vi.fn(async () => sidecar("abc123"));
    expect(await readSidecarCoalesced(SIDECAR_PATH, retry)).toEqual(
      sidecar("abc123"),
    );
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("returns null (never throws) when the read rejects", async () => {
    // 호출부는 리졸버 → NodeView다. 던지면 main.tsx의 전역
    // unhandledrejection 핸들러가 preventDefault()로 삼켜 흔적 없이 사라진다.
    const read = vi.fn(() => Promise.reject(new Error("permission denied")));

    expect(await readSidecarCoalesced(SIDECAR_PATH, read)).toBeNull();
  });

  it("returns null (never throws) when the reader throws SYNCHRONOUSLY", async () => {
    // 합류 래퍼가 `read(key)`를 async 래퍼 없이 그냥 부르면 동기 throw는
    // Promise를 만들지도 못해 `.catch`를 지나가고 계약이 깨진다.
    const read = vi.fn((): Promise<null | Sidecar> => {
      throw new Error("thrown before any promise exists");
    });

    expect(await readSidecarCoalesced(SIDECAR_PATH, read)).toBeNull();
  });

  it("passes a missing sidecar (null) through unchanged", async () => {
    // 하이라이트가 아직 없는 PDF — 정상 경로이지 실패가 아니다.
    const read = vi.fn(async () => null);

    expect(await readSidecarCoalesced(SIDECAR_PATH, read)).toBeNull();
  });
});
