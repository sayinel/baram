// §4.3 File tree — clipboard label helpers (pure functions)
import { basename } from "../../utils/path-utils";

/** vault 루트 기준 상대 경로 (선행 슬래시 없음). 루트 밖이면 절대 경로 그대로. */
export function toRelativePath(absPath: string, rootPath: string): string {
  if (absPath === rootPath) return "";
  if (absPath.startsWith(rootPath + "/")) {
    return absPath.slice(rootPath.length + 1);
  }
  return absPath;
}

/**
 * 위키링크 라벨: 확장자 제거한 파일명.
 * vault 내에 같은(확장자 제거) 파일명이 2개 이상이면 확장자 제거한 vault-상대 경로.
 */
export function toWikilinkLabel(
  absPath: string,
  rootPath: string,
  allPaths: string[],
): string {
  const bare = stripExt(basename(absPath));
  const collisions = allPaths.filter((p) => stripExt(basename(p)) === bare);
  if (collisions.length <= 1) return bare;
  const rel = toRelativePath(absPath, rootPath);
  return stripExt(rel);
}

/** 확장자를 제거한다. "a.md" → "a", "README" → "README". */
function stripExt(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}
