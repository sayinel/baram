// issue 545 — where an image may point: the verdict on one destination.
//
// pandoc treats an image as a FILE, not a link: for docx and epub it opens the
// destination and embeds the bytes, for `http(s):` it downloads them. This
// module decides, on the string alone, what pandoc may read — and decides it
// so that pandoc never sees a filesystem path the document wrote:
//
// - `baram-asset:NAME` (a mermaid diagram the export rasterized) is kept; the
//   backend swaps it for the staged file. Only a name this export produced
//   counts: a document-written placeholder wearing another name is refused.
// - A path that stays inside the document's own context — judged here on the
//   normalized string, against the context root the tab names — is staged:
//   the destination becomes `baram-asset:image-N.ext` and `{ name, source }`
//   goes to the backend, which resolves `source` against the document's
//   directory, canonicalizes it, and reads it only if the result lies under
//   that same root. A relative path and an absolute one (`/…`, `C:\…`) are
//   judged alike, by where they lead. The string check here is what lets a
//   plain `../../secret.png` degrade to its alt text and the export still
//   succeed; the canonical check there is the boundary — a symlink out of the
//   vault, a spelling the URL parser and the filesystem read differently, a
//   path this file never imagined, all fail the export there, naming the
//   source. A path in a document that has never been saved, or in a file
//   opened on its own (a `File` context authorizes exactly that file), has no
//   context to lie inside, and is refused.
// - Everything else is refused, and the caller replaces it by its alt text:
//   `file:`, `data:`, `http(s):` and every other scheme, a protocol-relative
//   `//host/x`, a UNC `\\server\…`, an empty or fragment-only destination.
//   Remote images are refused deliberately — an export must not make a
//   request the user did not see coming (a tracking pixel in a shared note) —
//   and an "include remote images" option is a separate decision.
import { parserView, RELATIVE_BASE } from "../link-href";
import {
  decodePercent,
  dirname,
  foldAsciiCase,
  hasDriveLetter,
  isAbsolutePath,
  isUnderRoot,
  stripTrailingSeparators,
  toPosixPath,
} from "../path-utils";

/** Where an image may point, resolved once per document. */
export interface RelativeScope {
  /**
   * Windows paths (a drive letter) are compared case-insensitively: the
   * filesystem is, and `c:\vault` and `C:\Vault` are one directory.
   */
  caseInsensitive: boolean;
  /** The document's directory, POSIX-separated. */
  documentDir: string;
  /** The context root, POSIX-separated, without a trailing separator. */
  root: string;
}

/** The scheme of a staged asset's placeholder — written by the mermaid export
 *  (mermaid-export-assets.ts) and by this policy, swapped for the file by the
 *  backend. The one spelling on the frontend side; the backend has its own
 *  by design (the layers do not trust each other). */
export const ASSET_SCHEME = "baram-asset:";

/** What may happen to one destination: kept as written (`source`), staged
 *  as an asset request for `source`, or refused. */
export type Verdict =
  | { kind: "keep"; source: string }
  | { kind: "refuse" }
  | { kind: "stage"; source: string };

/** The scope relative images resolve in, or null when there is none. */
export function relativeScope(
  documentPath: null | string,
  contextRoot: null | string,
): null | RelativeScope {
  if (documentPath === null || contextRoot === null) return null;
  // Judged on the inputs as given: a drive root `C:/` would lose its
  // separator to the normalisation below and stop looking like a drive.
  const caseInsensitive =
    hasDriveLetter(documentPath) || hasDriveLetter(contextRoot);
  const root = stripTrailingSeparators(toPosixPath(contextRoot));
  if (root === "") return null;
  return {
    caseInsensitive,
    documentDir: dirname(toPosixPath(documentPath)),
    root,
  };
}

/** Is `target` the scope's root or inside it, by the scope's own case rule? */
function inScope(target: string, scope: RelativeScope): boolean {
  const same = scope.caseInsensitive
    ? foldAsciiCase(target) === foldAsciiCase(scope.root)
    : target === scope.root;
  return same || isUnderRoot(target, scope.root, scope.caseInsensitive);
}

/**
 * Whether pandoc may read `url`, and how. `scope` null: no path image may.
 * Judged on the parser's view of the destination (leading controls and
 * spaces dropped, tabs and newlines removed — `parserView`), as the link
 * policy does, so a tab before an absolute path is still an absolute path.
 * An absolute path is judged like a relative one — where it leads: inside
 * the document's context it is staged (before this change it was the only
 * form that ever embedded), outside it becomes alt text.
 */
export function classifyImageSource(
  url: string,
  scope: null | RelativeScope,
  knownAssets: ReadonlySet<string>,
): Verdict {
  const view = parserView(url);
  if (view.startsWith(ASSET_SCHEME)) {
    // Kept by the parser's view of it: that is the destination written out,
    // so a stray leading tab never reaches the markdown handed to pandoc.
    return knownAssets.has(view.slice(ASSET_SCHEME.length))
      ? { kind: "keep", source: view }
      : { kind: "refuse" };
  }
  if (view === "" || /^[#?]/.test(view)) return { kind: "refuse" };
  // Protocol-relative (`//host/x`) and UNC (`\\server\share`) name a host,
  // never a file of this context.
  if (/^[/\\]{2}/.test(view)) return { kind: "refuse" };
  const absolute = isAbsolutePath(view);
  if (!absolute) {
    // The WHATWG parser is what decides whether a destination carries its
    // own scheme (`java\tscript:`, ` HTTP:`); anything that does not resolve
    // under the placeholder base is not a path.
    let parsed: URL;
    try {
      parsed = new URL(view, RELATIVE_BASE);
    } catch {
      return { kind: "refuse" };
    }
    if (parsed.protocol !== "https:" || parsed.host !== "baram.invalid") {
      return { kind: "refuse" };
    }
  }
  if (scope === null) return { kind: "refuse" };
  // A query or fragment is not part of a file name (`img/a.png?raw=1`,
  // `icons.svg#home`): the file is what comes before it.
  const source = view.replace(/[?#].*$/, "");
  if (source === "") return { kind: "refuse" };
  // Where the path leads, on the string: `..` collapsed, percent-escapes
  // decoded as pandoc would decode them, backslashes read as separators. A
  // path that leaves the context root has no business being staged — the
  // backend would refuse it and fail the whole export, where alt text lets
  // the export go through without it.
  const decoded = decodePercent(source);
  // What the escapes hid is judged too: `%2Fetc%2Fpasswd` is `/etc/passwd`,
  // an absolute path, and the backend decodes it the same way.
  if (/^[/\\]{2}/.test(decoded)) return { kind: "refuse" };
  const target = toPosixPath(
    absolute || isAbsolutePath(decoded)
      ? decoded
      : `${scope.documentDir}/${decoded}`,
  );
  if (!inScope(target, scope)) return { kind: "refuse" };
  return { kind: "stage", source };
}
