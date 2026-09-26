// §363 · §371 6a — 두 내보내기 화면이 함께 쓰는 패키지 정보와 그 관문(스펙 0062 §4).
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { usePackageMeta } from "../use-package-meta";

function fill(state: ReturnType<typeof usePackageMeta>): void {
  state.setAuthor("a");
  state.setDescription("d");
  state.setLicense("MIT");
  state.setVersion("1.0.0");
}

describe("usePackageMeta", () => {
  it("넷을 다 채우기 전에는 complete 가 아니다", () => {
    const { result } = renderHook(() => usePackageMeta("My Look"));
    expect(result.current.complete).toBe(false);
    act(() => fill(result.current));
    expect(result.current.complete).toBe(true);
  });

  it("id 는 직접 고치기 전까지 이름의 슬러그를 따라간다", () => {
    const { rerender, result } = renderHook(
      ({ name }) => usePackageMeta(name),
      {
        initialProps: { name: "My Look" },
      },
    );
    expect(result.current.id).toBe("my-look");
    rerender({ name: "Solar Flare" });
    expect(result.current.id).toBe("solar-flare");
    act(() => result.current.setId("custom-id"));
    rerender({ name: "Another" });
    expect(result.current.id).toBe("custom-id");
  });

  // 무엇이 이것을 실패시키는가: id 형식 검사를 빼면 설치 경로가 거부하는 패키지가 나간다.
  it("형식이 틀린 id 는 complete 를 막는다", () => {
    const { result } = renderHook(() => usePackageMeta("My Look"));
    act(() => {
      fill(result.current);
      result.current.setId("Not Valid");
    });
    expect(result.current.complete).toBe(false);
  });

  it("meta 는 매니페스트가 요구하는 네 값이다", () => {
    const { result } = renderHook(() => usePackageMeta("x"));
    act(() => fill(result.current));
    expect(result.current.meta).toEqual({
      author: "a",
      description: "d",
      license: "MIT",
      version: "1.0.0",
    });
  });
});
