// §365 다이얼 8 — 병합된 본문 서체의 한 글자 폭을 잰다. 측정 함수와 서체 집합은 주입한다 — jsdom
// 에는 `document.fonts` 가 없어, `loading` 을 내고 `ready` 를 바꾸는 흉내(`FakeFontSet`)로 대신한다.
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useAdvanceRatio } from "../use-advance-ratio";

type Measure = (stack: string, sample: string) => Promise<null | number>;

/** `FontFaceSet` 흉내 — 로드가 시작되면 `ready` 를 새 약속으로 바꾸고 `loading` 을 낸다. */
class FakeFontSet extends EventTarget {
  ready: Promise<void> = Promise.resolve();
  private settle: () => void = () => undefined;

  /** 로드가 끝났다 — 지금의 `ready` 를 푼다. */
  finishLoading(): Promise<void> {
    this.settle();
    return this.ready;
  }

  /** 로드가 시작됐다. */
  startLoading(): void {
    this.ready = new Promise((r) => (this.settle = r));
    act(() => {
      this.dispatchEvent(new Event("loading"));
    });
  }
}

/** 끝나는 시점을 테스트가 정하는 측정 하나. */
function deferred(): {
  promise: Promise<null | number>;
  resolve: (v: null | number) => void;
} {
  let resolve: (v: null | number) => void = () => undefined;
  const promise = new Promise<null | number>((r) => (resolve = r));
  return { promise, resolve };
}

async function finish(fontSet: FakeFontSet): Promise<void> {
  await act(async () => {
    await fontSet.finishLoading();
  });
}

/** 측정마다 스택의 첫 패밀리. */
function measuredFamilies(
  measure: ReturnType<typeof vi.fn<Measure>>,
): string[] {
  return measure.mock.calls.map(([stack]) => stack.split(",")[0]);
}

describe("useAdvanceRatio", () => {
  it("본문 서체 스택과 로케일 표본으로 잰다", async () => {
    const measure = vi.fn(() => Promise.resolve(0.86));
    const { result } = renderHook(() =>
      useAdvanceRatio("Inter", "ko", measure),
    );
    await waitFor(() => expect(result.current).toBe(0.86));
    expect(measure).toHaveBeenCalledWith(
      expect.stringMatching(/^"Inter", /u),
      "가",
    );
  });

  // 무엇이 이것을 실패시키는가: 서체가 바뀐 뒤에도 이전 서체의 결과를 돌려주면, 새 서체를 재는
  // 동안 자 슬라이더가 틀린 폭으로 px 를 쓴다.
  it("서체가 바뀌면 다시 잴 때까지 null", async () => {
    let resolveSecond: (v: number) => void = () => undefined;
    const measure = vi
      .fn<Measure>()
      .mockResolvedValueOnce(0.86)
      .mockImplementationOnce(() => new Promise((r) => (resolveSecond = r)));
    const { rerender, result } = renderHook(
      ({ family }) => useAdvanceRatio(family, "ko", measure),
      { initialProps: { family: "Inter" } },
    );
    await waitFor(() => expect(result.current).toBe(0.86));
    rerender({ family: "Noto Sans KR" });
    expect(result.current).toBeNull();
    resolveSecond(0.9);
    await waitFor(() => expect(result.current).toBe(0.9));
  });

  // 무엇이 이것을 실패시키는가: 구독이 없으면 테마의 `@font-face` 가 문서에 들어오기 전에 잰 대체
  // 서체의 비율이 서체 문자열이 바뀔 때까지 남아, 자 슬라이더가 틀린 폭으로 px 를 쓴다. `loading`
  // 때 바로 재면 면이 아직 로드 중이라 같은 대체 서체를 잰다 — 그래서 `ready` 전에는 재지 않는다.
  it("로드가 시작되고 ready 가 풀리면 같은 서체를 다시 잰다", async () => {
    const fontSet = new FakeFontSet();
    const measure = vi
      .fn<Measure>()
      .mockResolvedValueOnce(0.5)
      .mockResolvedValueOnce(0.86);
    const { result } = renderHook(() =>
      useAdvanceRatio("Theme Serif", "ko", measure, fontSet),
    );
    await waitFor(() => expect(result.current).toBe(0.5));
    fontSet.startLoading();
    expect(measure).toHaveBeenCalledTimes(1);
    await finish(fontSet);
    await waitFor(() => expect(result.current).toBe(0.86));
    expect(measure).toHaveBeenCalledTimes(2);
    expect(measure.mock.calls[1]).toEqual(measure.mock.calls[0]);
  });

  // "로드가 시작되고 …" 의 짝 — 설정 창을 닫은 뒤에 끝난 로드가 닫힌 행을 다시 재면 안 된다.
  it("언마운트 뒤에 풀린 ready 는 다시 재지 않는다", async () => {
    const fontSet = new FakeFontSet();
    const measure = vi.fn<Measure>().mockResolvedValue(0.86);
    const { result, unmount } = renderHook(() =>
      useAdvanceRatio("Inter", "ko", measure, fontSet),
    );
    await waitFor(() => expect(result.current).toBe(0.86));
    fontSet.startLoading();
    unmount();
    await finish(fontSet);
    expect(measure).toHaveBeenCalledTimes(1);
  });

  // 무엇이 이것을 실패시키는가: 옛 서체의 이펙트가 정리된 뒤에도 그 `ready` 가 옛 서체를 다시 재면,
  // 쓸데없는 측정이 돌고 그 결과가 새 서체의 결과를 덮을 길이 열린다(그 착지는 "옛 서체에서 시작한
  // 재측정은 …" 이 본다).
  it("loading 과 ready 사이에 서체가 바뀌면 옛 서체는 다시 재지 않는다", async () => {
    const fontSet = new FakeFontSet();
    const measure = vi
      .fn<Measure>()
      .mockResolvedValueOnce(0.5)
      .mockResolvedValue(0.9);
    const { rerender, result } = renderHook(
      ({ family }) => useAdvanceRatio(family, "ko", measure, fontSet),
      { initialProps: { family: "Inter" } },
    );
    await waitFor(() => expect(result.current).toBe(0.5));
    fontSet.startLoading();
    rerender({ family: "Noto Sans KR" });
    await waitFor(() => expect(result.current).toBe(0.9));
    await finish(fontSet);
    expect(result.current).toBe(0.9);
    expect(measuredFamilies(measure)).toEqual(['"Inter"', '"Noto Sans KR"']);
  });

  // 무엇이 이것을 실패시키는가: 옛 서체의 재측정이 이미 돌고 있을 때 서체가 바뀌고, 그 측정이 새
  // 서체의 결과 뒤에 착지하면 키가 다른 결과가 덮어 읽는 쪽이 `null`(재는 중)을 돌려준다.
  it("옛 서체에서 시작한 재측정은 새 서체의 결과에 착지하지 않는다", async () => {
    const fontSet = new FakeFontSet();
    const stale = deferred();
    const measure = vi
      .fn<Measure>()
      .mockResolvedValueOnce(0.5)
      .mockImplementationOnce(() => stale.promise)
      .mockResolvedValue(0.9);
    const { rerender, result } = renderHook(
      ({ family }) => useAdvanceRatio(family, "ko", measure, fontSet),
      { initialProps: { family: "Inter" } },
    );
    await waitFor(() => expect(result.current).toBe(0.5));
    fontSet.startLoading();
    await finish(fontSet);
    expect(measure).toHaveBeenCalledTimes(2);
    rerender({ family: "Noto Sans KR" });
    await waitFor(() => expect(result.current).toBe(0.9));
    await act(async () => {
      stale.resolve(0.86);
      await stale.promise;
    });
    expect(result.current).toBe(0.9);
  });

  // 무엇이 이것을 실패시키는가: 같은 키의 측정이 겹칠 때 먼저 시작한 것이 늦게 끝나 착지하면, 대체
  // 서체의 비율이 다시 잰 값을 덮는다.
  it("먼저 시작한 측정이 늦게 끝나도 다시 잰 값을 덮지 않는다", async () => {
    const fontSet = new FakeFontSet();
    const first = deferred();
    const measure = vi
      .fn<Measure>()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce(0.86);
    const { result } = renderHook(() =>
      useAdvanceRatio("Theme Serif", "ko", measure, fontSet),
    );
    fontSet.startLoading();
    await finish(fontSet);
    await waitFor(() => expect(result.current).toBe(0.86));
    await act(async () => {
      first.resolve(0.5);
      await first.promise;
    });
    expect(result.current).toBe(0.86);
  });

  // 무엇이 이것을 실패시키는가: 언마운트가 구독을 풀지 않으면 닫힌 행의 핸들러가 서체 로드마다
  // `ready` 를 기다린다. 위 "언마운트 뒤에 …" 는 `cancelled` 로도 통과하므로 해제는 따로 본다.
  it("언마운트하면 같은 핸들러로 loading 구독을 푼다", () => {
    const fontSet = new FakeFontSet();
    const add = vi.spyOn(fontSet, "addEventListener");
    const remove = vi.spyOn(fontSet, "removeEventListener");
    const measure = vi.fn<Measure>().mockResolvedValue(0.86);
    const { unmount } = renderHook(() =>
      useAdvanceRatio("Inter", "ko", measure, fontSet),
    );
    expect(add).toHaveBeenCalledWith("loading", expect.any(Function));
    unmount();
    expect(remove).toHaveBeenCalledWith("loading", add.mock.calls[0][1]);
  });
});
