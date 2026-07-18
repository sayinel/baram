// §4.4 File tree — 키보드 내비게이션 순수 헬퍼 (트리 탐색)
import { dirname } from "../../utils/path-utils";

export interface NavEntry {
  isDir: boolean;
  path: string;
}

/** 펼친 폴더의 첫 자식: visible에서 parent 바로 뒤 항목이 parent의 자식이면 그 경로 */
export function firstChildPath(
  entries: NavEntry[],
  parentDir: string,
): null | string {
  const idx = entries.findIndex((e) => e.path === parentDir);
  if (idx === -1 || idx + 1 >= entries.length) return null;
  const nextEntry = entries[idx + 1];
  return nextEntry.path.startsWith(parentDir + "/") ? nextEntry.path : null;
}

/** 경로의 isDir 여부 (미존재면 false) */
export function isDirPath(entries: NavEntry[], path: string): boolean {
  return entries.find((e) => e.path === path)?.isDir ?? false;
}

/** current 다음 경로 (경계에서 유지; null/미존재면 첫 항목) */
export function nextPath(
  paths: string[],
  current: null | string,
): null | string {
  if (paths.length === 0) return null;
  const idx = current === null ? -1 : paths.indexOf(current);
  if (idx === -1) return paths[0];
  return idx < paths.length - 1 ? paths[idx + 1] : paths[idx];
}

/** childPath의 부모 디렉토리가 visible에 있으면 반환 (루트 직속은 null) */
export function parentPath(
  entries: NavEntry[],
  childPath: string,
  rootPath: string,
): null | string {
  const parent = dirname(childPath);
  if (parent === rootPath || parent === "") return null;
  return entries.some((e) => e.path === parent) ? parent : null;
}

/** current 이전 경로 (경계에서 유지; null/미존재면 첫 항목) */
export function prevPath(
  paths: string[],
  current: null | string,
): null | string {
  if (paths.length === 0) return null;
  const idx = current === null ? -1 : paths.indexOf(current);
  if (idx === -1) return paths[0];
  return idx > 0 ? paths[idx - 1] : paths[idx];
}
