// §4.3 File tree — clipboard label helpers (pure functions)
import { foldName } from "../../utils/name-fold";
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
 * 같은지는 `foldName` 으로 본다 — 링크 인덱스가 한 키로 읽는 이름끼리(§390). 돌려주는
 * 글자는 NFC 다(D7): 디스크가 분해형(NFD)으로 저장한 이름도 키보드로 친 글처럼 쓴다.
 */
export function toWikilinkLabel(
  absPath: string,
  rootPath: string,
  allPaths: string[],
): string {
  const bare = stripExt(basename(absPath));
  const key = foldName(bare);
  const collisions = allPaths.filter(
    (p) => foldName(stripExt(basename(p))) === key,
  );
  if (collisions.length <= 1) return bare.normalize("NFC");
  const rel = toRelativePath(absPath, rootPath);
  return stripExt(rel).normalize("NFC");
}

/** 확장자를 제거한다. "a.md" → "a", "README" → "README". */
function stripExt(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}
