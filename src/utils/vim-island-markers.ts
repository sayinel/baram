// §298 vim island markers — a dependency-free leaf (issue 372, 순서 1).
//
// These two DOM attributes decide who owns the modal keyboard while vim is
// active: `data-vim-suspend` marks an input island (the island owns its
// keys), `data-node-view-content` marks PM body content (vim owns them).
// The vim suspension adapter walks composedPath() outward and the FIRST
// marker found wins (extensions/CLAUDE.md, §298 design §4).
//
// Why this file exists: island membership is an APP capability, never
// document content. DOMPurify keeps `data-*` and `tabindex` by default, so
// sanitized HTML/SVG from a shared file could otherwise grant itself
// suspension — or deny it inside a real island and leave vim reading the
// user's keystrokes as commands. Every sanitizer therefore strips these
// attributes (FORBID_ATTR), which makes them a SECURITY constant consumed
// far outside the vim feature — the markdown/SVG sanitizers sit in the
// core extension graph (html/svg block views), the AI renderer loads with
// its panels — and the invariant holds whether or not vim is enabled. That
// code must not reach into the vim feature module for it — the invariant
// outlives any vim-internal refactor — so the names live here, importing
// nothing, and vim's suspension adapter is a consumer like the sanitizers.

/** Marks an input island: while focus is inside, the island owns the keys. */
export const SUSPEND_MARKER = "data-vim-suspend";

/** Tiptap's marker for PM body content: vim owns the keys. */
export const BODY_MARKER = "data-node-view-content";

/** The attributes every sanitizer must FORBID on document-supplied markup. */
export const VIM_ISLAND_MARKERS = [SUSPEND_MARKER, BODY_MARKER];
