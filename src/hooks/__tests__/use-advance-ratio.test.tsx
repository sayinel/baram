// §365 다이얼 8 — 병합된 본문 서체의 한 글자 폭을 잰다. 측정 함수는 주입한다.
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useAdvanceRatio } from "../use-advance-ratio";

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
      .fn<(stack: string, sample: string) => Promise<null | number>>()
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
});
