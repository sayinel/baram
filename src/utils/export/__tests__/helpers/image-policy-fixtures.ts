// The documents the image policy tests judge against: one saved inside a
// vault, one never saved, one opened on its own — and the one diagram asset
// this export is taken to have produced.
import { relativeScope } from "../../export-image-source-policy";

/** The diagram assets this export produced — the only `baram-asset:` names kept. */
export const KNOWN: ReadonlySet<string> = new Set(["mermaid-0.png"]);

/** A document saved inside the vault `/vault`. */
export const SAVED = {
  contextRoot: "/vault",
  documentPath: "/vault/notes/today.md",
  knownAssets: KNOWN,
};

/** A document that has never been saved: nothing for a relative path to start from. */
export const UNSAVED = {
  contextRoot: "/vault",
  documentPath: null,
  knownAssets: KNOWN,
};

/** A file opened on its own: no vault or folder context to be relative to. */
export const LONE = {
  contextRoot: null,
  documentPath: "/Users/me/solo.md",
  knownAssets: KNOWN,
};

/** The scope of `SAVED`: what a relative image is judged in. */
export const IN_VAULT = relativeScope(SAVED.documentPath, SAVED.contextRoot);
