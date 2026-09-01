// §298 vim §8 / §286 — the editor-mode policy: a `SurfaceKind` (`./surface-kind.ts`) collapsed
// to what the StatusBar and the vim status owner actually need, and which vim surface each
// mode belongs to. Extracted out of `StatusBar.tsx` so a leaf hook (`use-retained-surfaces.ts`)
// does not have to import a ~400-line rendered component for two pure mappings.
import type { SurfaceKind } from "./surface-kind";

export type EditorMode = "graph" | "plugin" | "preview" | "source" | "wysiwyg";

/**
 * §298 vim §8 / §286 — `resolveSurfaceKind` (`utils/editor/surface-kind.ts`) answers a finer
 * question than the status bar needs to show: it tells "pdf" from "image" from a plugin/HTML
 * preview, all of which read the same "Preview" here, and it has no tab open at all as two
 * kinds ("home"/"empty") the status bar doesn't even render for (App only mounts `StatusBar`
 * when a vault is open, and hides itself entirely otherwise). This is a total function so
 * adding a `SurfaceKind` without extending it is a type error, not a silent "Preview".
 */
const SURFACE_KIND_TO_EDITOR_MODE: Record<SurfaceKind, EditorMode> = {
  empty: "wysiwyg",
  graph: "graph",
  home: "wysiwyg",
  image: "preview",
  markdown: "wysiwyg",
  pdf: "preview",
  plugin: "plugin",
  preview: "preview",
  source: "source",
};

export function editorModeForSurfaceKind(kind: SurfaceKind): EditorMode {
  return SURFACE_KIND_TO_EDITOR_MODE[kind];
}

/** §298 vim §8 — which vim surface a StatusBar mode belongs to. The SAME
 *  mapping appoints the wysiwyg status owner (App) and arbitrates the
 *  indicator here; graph/preview map to null so neither surface renders
 *  and no owner is appointed. */
export function vimSurfaceForMode(
  mode: EditorMode,
): "source" | "wysiwyg" | null {
  if (mode === "source") return "source";
  if (mode === "wysiwyg") return "wysiwyg";
  return null;
}
