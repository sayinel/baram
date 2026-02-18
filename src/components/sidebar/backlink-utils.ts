// §29 Backlink panel utility functions — stub for TDD
import type { BacklinkEntry } from "../../ipc/types";

export interface BacklinkGroup {
  sourcePath: string;
  entries: BacklinkEntry[];
}

/** Group backlink entries by source file path */
export function groupBacklinksByFile(
  _entries: BacklinkEntry[],
): BacklinkGroup[] {
  // TODO: implement
  return [];
}

/** Extract file name from a full path */
export function extractFileNameFromPath(_path: string): string {
  // TODO: implement
  return "";
}
