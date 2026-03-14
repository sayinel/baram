// §11.7 AuthorshipSync — serialize/deserialize authorship segments for sidecar files

import type { AuthorshipSegment } from "./authorship-tracker";

interface AuthorshipSidecar {
  filePath: string;
  segments: AuthorshipSegment[];
  version: number;
}

const CURRENT_VERSION = 1;

/** Deserialize a JSON sidecar string back to authorship data. */
export function deserializeAuthorship(json: string): {
  filePath: string;
  segments: AuthorshipSegment[];
} {
  const parsed = JSON.parse(json) as AuthorshipSidecar;
  return {
    filePath: parsed.filePath,
    segments: parsed.segments,
  };
}

/** Serialize authorship segments to a JSON string for sidecar storage. */
export function serializeAuthorship(
  filePath: string,
  segments: AuthorshipSegment[],
): string {
  const sidecar: AuthorshipSidecar = {
    filePath,
    segments,
    version: CURRENT_VERSION,
  };
  return JSON.stringify(sidecar, null, 2);
}
