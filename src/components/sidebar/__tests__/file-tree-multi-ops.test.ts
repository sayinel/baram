import { describe, expect, it } from "vitest";

import {
  planMultiMove,
  pruneNestedPaths,
  resolveDragSet,
} from "../file-tree-multi-ops";

describe("pruneNestedPaths", () => {
  it("조상이 선택에 있으면 자손을 제거한다", () => {
    const out = pruneNestedPaths(
      new Set(["/r/docs", "/r/docs/a.md", "/r/z.md"]),
    );
    expect(out.sort()).toEqual(["/r/docs", "/r/z.md"]);
  });

  it("형제 경로 접두어에는 오탐하지 않는다 (/r/doc vs /r/docs)", () => {
    const out = pruneNestedPaths(new Set(["/r/doc", "/r/docs/a.md"]));
    expect(out.sort()).toEqual(["/r/doc", "/r/docs/a.md"]);
  });
});

describe("resolveDragSet", () => {
  it("드래그 시작 노드가 선택에 포함되면 선택 전체(프룬됨)를 반환한다", () => {
    const sel = new Set(["/r/a.md", "/r/b.md"]);
    expect(resolveDragSet("/r/a.md", sel).sort()).toEqual([
      "/r/a.md",
      "/r/b.md",
    ]);
  });

  it("선택 밖 노드를 드래그하면 그 노드만 반환한다", () => {
    const sel = new Set(["/r/a.md"]);
    expect(resolveDragSet("/r/c.md", sel)).toEqual(["/r/c.md"]);
  });
});

describe("planMultiMove", () => {
  it("유효한 이동은 moves에, 무효(자기 자신/자기 하위/같은 부모)는 skipped에 담는다", () => {
    const plan = planMultiMove(
      ["/r/a.md", "/r/docs", "/r/target/already.md"],
      "/r/target",
      "/r",
    );
    expect(plan.moves).toEqual([
      { from: "/r/a.md", to: "/r/target/a.md" },
      { from: "/r/docs", to: "/r/target/docs" },
    ]);
    expect(plan.skipped).toEqual(["/r/target/already.md"]);
  });

  it("선택된 폴더의 내부로 드롭하면 그 폴더는 skipped된다", () => {
    const plan = planMultiMove(["/r/docs"], "/r/docs/sub", "/r");
    expect(plan.moves).toEqual([]);
    expect(plan.skipped).toEqual(["/r/docs"]);
  });

  it("루트로의 이동은 루트가 target일 때 startsWith 가드를 우회하지 않는다", () => {
    const plan = planMultiMove(["/r/docs/a.md"], "/r", "/r");
    expect(plan.moves).toEqual([{ from: "/r/docs/a.md", to: "/r/a.md" }]);
  });

  it("자기 자신으로의 이동은 skipped된다", () => {
    const plan = planMultiMove(["/r/docs"], "/r/docs", "/r");
    expect(plan.moves).toEqual([]);
    expect(plan.skipped).toEqual(["/r/docs"]);
  });
});
