import { dirname } from "../../utils/path-utils";

/**
 * Directory paths that must be expanded to reveal `filePath`, ordered
 * root→leaf. Excludes `rootPath` itself and the file itself. Returns [] when
 * the file is a direct child of root or is not under root.
 */
export function ancestorDirs(filePath: string, rootPath: string): string[] {
  if (!rootPath || !filePath.startsWith(rootPath + "/")) return [];
  const chain: string[] = [];
  let dir = dirname(filePath);
  while (dir && dir !== rootPath && dir.startsWith(rootPath + "/")) {
    chain.push(dir);
    dir = dirname(dir);
  }
  return chain.reverse();
}
