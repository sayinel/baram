// Drag & Drop path utilities

const IMAGE_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "svg", "ico", "bmp", "avif",
]);

/** Check if a file path has an image extension */
export function isImageFile(path: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_EXTENSIONS.has(ext);
}

/** Convert an absolute path to a relative path from a given directory */
export function getRelativePath(fromDir: string, toPath: string): string {
  const fromParts = fromDir.split("/").filter(Boolean);
  const toParts = toPath.split("/").filter(Boolean);

  // Find common prefix length
  let common = 0;
  while (
    common < fromParts.length &&
    common < toParts.length &&
    fromParts[common] === toParts[common]
  ) {
    common++;
  }

  const ups = fromParts.length - common;
  const remainder = toParts.slice(common);

  if (ups === 0) {
    return "./" + remainder.join("/");
  }
  return "../".repeat(ups) + remainder.join("/");
}

/** Resolve name conflict by appending -1, -2, etc. */
export function resolveNameConflict(
  fileName: string,
  existingNames: Set<string>,
): string {
  if (!existingNames.has(fileName)) return fileName;

  const dotIdx = fileName.lastIndexOf(".");
  const base = dotIdx > 0 ? fileName.slice(0, dotIdx) : fileName;
  const ext = dotIdx > 0 ? fileName.slice(dotIdx) : "";

  let counter = 1;
  let candidate: string;
  do {
    candidate = `${base}-${counter}${ext}`;
    counter++;
  } while (existingNames.has(candidate));

  return candidate;
}
