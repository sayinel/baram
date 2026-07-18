// §4.3 File tree — 멀티 선택 일괄 작업 헬퍼 (순수 함수)

export interface MultiMovePlan {
  moves: { from: string; to: string }[];
  skipped: string[];
}

/** 항목별 이동 유효성 검사 — use-file-tree-dnd의 단일 이동 규칙과 동일. */
export function planMultiMove(
  sourcePaths: string[],
  targetPath: string,
  rootPath: string,
): MultiMovePlan {
  const moves: { from: string; to: string }[] = [];
  const skipped: string[] = [];
  for (const source of sourcePaths) {
    const parent = source.substring(0, source.lastIndexOf("/"));
    const invalid =
      source === targetPath ||
      (targetPath !== rootPath && targetPath.startsWith(source + "/")) ||
      parent === targetPath;
    if (invalid) {
      skipped.push(source);
      continue;
    }
    const name = source.split("/").pop() ?? "";
    moves.push({ from: source, to: targetPath + "/" + name });
  }
  return { moves, skipped };
}

/** 조상이 함께 선택된 자손 경로를 제거한다 (중복 이동/삭제 방지). */
export function pruneNestedPaths(paths: ReadonlySet<string>): string[] {
  const list = [...paths];
  return list.filter(
    (p) => !list.some((other) => other !== p && p.startsWith(other + "/")),
  );
}

/** 드래그 제스처가 옮길 경로 집합: 선택 내부에서 잡으면 선택 전체, 밖이면 그 행만. */
export function resolveDragSet(
  sourcePath: string,
  selectedPaths: ReadonlySet<string>,
): string[] {
  if (selectedPaths.has(sourcePath)) return pruneNestedPaths(selectedPaths);
  return [sourcePath];
}
