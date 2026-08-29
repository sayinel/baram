// Drag & Drop path utilities

const IMAGE_EXTENSIONS = new Set([
  "avif",
  "bmp",
  "gif",
  "ico",
  "jpeg",
  "jpg",
  "png",
  "svg",
  "webp",
]);

/** Return the final path component (filename) for a given path.
 *  e.g. "/home/user/notes/readme.md" → "readme.md" */
export function basename(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx >= 0 ? path.substring(idx + 1) : path;
}

/** Return the directory portion of a path (no trailing slash).
 *  e.g. "/home/user/notes/readme.md" → "/home/user/notes" */
export function dirname(path: string): string {
  const idx = path.lastIndexOf("/");
  if (idx < 0) return "";
  if (idx === 0) return "/";
  return path.substring(0, idx);
}

/** §61 Extract namespace (directory path) from a vault-relative file path.
 *  e.g. "notes/ai/prompt.md" → "notes/ai", "readme.md" → undefined */
export function extractNamespace(relativePath: string): string | undefined {
  const lastSlash = relativePath.lastIndexOf("/");
  if (lastSlash <= 0) return undefined;
  return relativePath.substring(0, lastSlash);
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

/** Check if a file path has an image extension */
export function isImageFile(path: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_EXTENSIONS.has(ext);
}

/**
 * Is `candidate` strictly inside the directory `root`?
 *
 * ‼️ Tests the BOUNDARY CHARACTER rather than building a prefix, which is the only shape that
 * works on both platforms. Two others were tried and are wrong (§260 Phase 4a review I3, #306):
 *
 * - Appending `"/"` — on Windows both sides are backslash-delimited, so it matched NOTHING,
 *   silently. Callers got "no files", not an error.
 * - Inferring the separator from the path (`path.includes("\\") ? "\\" : "/"`) — fixes Windows
 *   and breaks POSIX, where a backslash is a legal character in a directory name: a vault at
 *   `/home/me/my\dir` infers `"\\"` and then never matches its own files.
 *
 * The boundary check is also what stops `/Users/me/work` matching `/Users/me/workspace/note.md`.
 * "Strictly inside" — the root itself is not under itself; callers that accept equality test it.
 */
export function isUnderRoot(candidate: string, root: string): boolean {
  const base = stripTrailingSeparators(root);
  if (!base || !candidate.startsWith(base)) return false;
  const boundary = candidate[base.length];
  return boundary === "/" || boundary === "\\";
}

/**
 * Collapse `.`, `..` and empty segments in a POSIX-style path.
 *
 * ‼️ Two callers used to inline this loop, and the third — the one that
 * mattered — only *claimed* to (`use-navigation.ts` had the comment
 * "Normalize simple relative path (handles ../ and ./)" above a bare string
 * concatenation). A `[x](../a.md)` link therefore opened `/vault/dir/../a.md`,
 * which reads fine but is a different string from `/vault/a.md`, so the
 * already-open-tab lookup missed and the same file opened twice.
 *
 * An absolute path cannot escape its root: `/a/../..` is `/`, matching POSIX.
 * A relative one keeps leading `..` segments, since there is nothing to
 * resolve them against yet.
 */
export function normalizePath(path: string): string {
  const isAbsolute = path.startsWith("/");
  const out: string[] = [];
  for (const segment of path.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (out.length > 0 && out[out.length - 1] !== "..") out.pop();
      else if (!isAbsolute) out.push("..");
      continue;
    }
    out.push(segment);
  }
  return (isAbsolute ? "/" : "") + out.join("/");
}

/**
 * `candidate` expressed relative to `root`, or `null` when it is not inside.
 *
 * Separators in the result are normalised to `/` — deliberately, and not merely for tidiness:
 * every consumer of a relative path in this app splits on `/` alone. `extractNamespace` is the
 * clearest case, so on Windows a relative path of `sub\note.md` yielded no namespace at all.
 * Returning `null` rather than a wrong string keeps a non-contained path from being silently
 * sliced into nonsense.
 */
export function relativeToRoot(candidate: string, root: string): null | string {
  if (!isUnderRoot(candidate, root)) return null;
  return candidate
    .slice(stripTrailingSeparators(root).length)
    .replace(/^[/\\]+/, "")
    .replace(/\\/g, "/");
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

/**
 * Drop trailing path separators, so a root and a candidate can be compared at a boundary.
 *
 * The canonical implementation of that one rule: `contextRootOf` in `stores/context/context.ts`
 * delegates here rather than keeping a second copy, because a stored root with two trailing
 * slashes once made two comparisons disagree and ate the first character of a relative path
 * (§260 Phase 4a security re-review LOW-4).
 */
export function stripTrailingSeparators(path: string): string {
  return path.replace(/[/\\]+$/, "");
}

/**
 * A directory *setting* resolved to an absolute path, or `null` when the value
 * cannot name one.
 *
 * Absolute-only is deliberate and predates this helper: a relative directory
 * setting has no single root to resolve against — the active context moves —
 * so a value like `zettel` would name a different folder every time the user
 * switched vaults. Returning `null` makes that a visible refusal instead of a
 * silent relocation.
 *
 * ‼️ This rule had three copies (`resolveJournalDir`, `resolveZettelDir`, and
 * §312.1's tasks home). Two of them already carried "mirror of the other" in
 * their doc comments, which is the shape this codebase has repeatedly paid for.
 * New callers delegate here.
 */
export function resolveAbsoluteDirSetting(dir: string): null | string {
  if (!dir) return null;
  // A Windows drive letter is the other way a path can be absolute; without it
  // every Windows setting reads as relative and resolves to `null`.
  if (!dir.startsWith("/") && !/^[A-Z]:\\/.test(dir)) return null;
  // Strip trailing separators so joins like `${dir}/tasks` don't double up.
  return stripTrailingSeparators(dir);
}

/**
 * A path normalized for *comparison* — separators folded to `/`, then `.`/`..`
 * collapsed. Not for display and not for I/O; two strings that name the same
 * file must produce the same value here.
 *
 * ‼️ `normalizePath` alone is not enough. It splits on `/` only, so a Windows
 * path like `C:\v\tasks\inbox.md` stays one segment and never matches a path
 * that was joined with `/`. The task index hands out **platform-separator**
 * paths from Rust while every setting-derived path is joined with `/`, so
 * without this the two sides never met on Windows — the archive's candidate
 * set silently became empty and the button never appeared (§312 M2-b3).
 */
export function toPosixPath(path: string): string {
  return normalizePath(path.replace(/\\/g, "/"));
}
