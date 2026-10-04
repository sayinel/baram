/*
 * §3.6 D3 (interim) — 한쪽만 바꾼 EXTERNAL hunk 는 사용자가 고르게 한다.
 *
 * merge 의 base 는 이벤트 시점의 `openFiles` 라, 저장 안 된 작업을 든 배경 탭에서는 그 탭의
 * 저장 안 된 텍스트가 base 가 되곤 한다. 그러면 merge 는 local 쪽 hunk 를 보지 못하고 외부
 * hunk 를 자동 적용한다 — Apply 가 바로 켜지고, 누르면 local 편집이 고를 기회도 없이 사라진다.
 *
 * 픽스처 `src-tauri/src/snapshot/fixtures/merge-outputs.json` 은 Rust `merge_texts` 의 실제
 * 출력이다(merge.rs 의 테스트가 같은 파일을 읽어 고정한다).
 */
import type { MergeSegment } from "../../ipc/types";

import { act, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { MergeView } from "../../components/editor/MergeView";
import { requireChoiceForExternalHunks } from "../conflict-resolution";

interface MergeFixture {
  base: string;
  external: string;
  local: string;
  name: string;
  segments: MergeSegment[];
}

const FIXTURES = JSON.parse(
  readFileSync(
    join(process.cwd(), "src-tauri/src/snapshot/fixtures/merge-outputs.json"),
    "utf8",
  ),
) as MergeFixture[];

describe("§3.6 requireChoiceForExternalHunks", () => {
  it("turns only external hunks into choices whose local side is the base", () => {
    // 이것을 실패시키는 것: 변환 제거 / local hunk 까지 변환.
    const segments: MergeSegment[] = [
      { kind: "unchanged", lines: ["u"] },
      { base: ["b1"], external: ["e1"], kind: "external" },
      { base: ["b2"], kind: "local", local: ["l2"] },
      { base: ["b3"], external: ["e3"], kind: "conflict", local: ["l3"] },
    ];

    expect(requireChoiceForExternalHunks(segments)).toEqual([
      { kind: "unchanged", lines: ["u"] },
      { base: ["b1"], external: ["e1"], kind: "conflict", local: ["b1"] },
      { base: ["b2"], kind: "local", local: ["l2"] },
      { base: ["b3"], external: ["e3"], kind: "conflict", local: ["l3"] },
    ]);
  });

  it("the fixtures are real merge outputs with an external hunk", () => {
    // 픽스처가 정말 위험한 출력임을 고정한다 — 외부 hunk 가 없으면 아래 단언이 공허하다.
    expect(FIXTURES.map((f) => f.name)).toEqual([
      "base-equals-local",
      "partially-advanced-base",
      "task-spliced-base",
    ]);
    for (const f of FIXTURES) {
      expect(f.segments.some((s) => s.kind === "external")).toBe(true);
    }
  });

  it.each(FIXTURES.map((f) => [f.name, f] as const))(
    "%s: no external hunk is left to apply silently",
    (_name, f) => {
      // 이것을 실패시키는 것: 변환 제거.
      expect(
        requireChoiceForExternalHunks(f.segments).some(
          (s) => s.kind === "external",
        ),
      ).toBe(false);
    },
  );

  it.each(FIXTURES.map((f) => [f.name, f] as const))(
    "%s: in the merge view Apply waits for a choice, and choosing local keeps local",
    (_name, f) => {
      // 이것을 실패시키는 것: 변환 제거(Apply 가 바로 켜지고 외부 텍스트가 나간다).
      // 결합 규칙: MergeView 는 줄을 "\n" 으로 잇고 끝 개행을 붙이지 않는다 — 비교는 그 규칙에
      // 맞춘다(고치지 않는다).
      const onApply = vi.fn();
      render(
        <MergeView
          filePath={f.name}
          onApply={onApply}
          onCancel={vi.fn()}
          segments={requireChoiceForExternalHunks(f.segments)}
        />,
      );
      const apply = screen.getByRole("button", {
        name: "Apply Merge",
      }) as HTMLButtonElement;
      expect(apply.disabled).toBe(true);

      for (const button of screen.getAllByRole("button", { name: "내 것" })) {
        act(() => fireEvent.click(button));
      }
      act(() => fireEvent.click(apply));

      expect(onApply).toHaveBeenCalledWith(f.local.replace(/\n$/, ""));
    },
  );
});

describe("§3.6 MergeView while Apply runs", () => {
  it("disables Apply and Cancel when busy", () => {
    // 이것을 실패시키는 것: MergeView 의 `busy` 무시(쓰는 도중 두 번째 Apply·Cancel 이 눌린다).
    render(
      <MergeView
        busy
        filePath="a.md"
        onApply={vi.fn()}
        onCancel={vi.fn()}
        segments={[{ kind: "unchanged", lines: ["x"] }]}
      />,
    );
    const disabled = (name: string) =>
      (screen.getByRole("button", { name }) as HTMLButtonElement).disabled;
    expect([disabled("Apply Merge"), disabled("Cancel")]).toEqual([true, true]);
  });
});
