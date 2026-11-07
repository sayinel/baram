// §395 spec 0074 D4 · D6 · D7 · D8 · D14 · D16 — the numbers file tree decorations and the file tree menu
// run on, in one place. The
// D14 values are starting values: the task that owns each one measures it, and ledger 0098 records the
// run. Change a value here and the committed tests follow it, because they import it.
//
// ‼️ A leaf with no imports: the sandbox realm reaches this through `validate.ts` to judge a call before
// sending it, and that realm must not reach a store.

/** D14 — `setFileDecorations` and `clearFileDecorations` calls one plugin's decoration bucket holds. */
export const DECORATION_BURST = 8;

/** D14 — the decoration bucket earns one call back per interval. */
export const DECORATION_INTERVAL_MS = 250;

/**
 * D14 — `defineFileIcon` calls the icon bucket holds: the icon cap (`MAX_FILE_ICONS`, a pair
 * `validate.test.ts` holds), so an icon pack defines every icon in `activate` without waiting.
 */
export const ICON_BURST = 64;

/** D14 — the icon bucket earns one call back per interval. */
export const ICON_INTERVAL_MS = 250;

/** D4 · D14 — grapheme clusters in one badge. */
export const MAX_BADGE_GRAPHEMES = 2;

/** D14 — paths one plugin may hold a decoration for. */
export const MAX_DECORATED_PATHS = 20_000;

/** D14 — a badge or a glyph icon, in UTF-16 units, before sanitizing. */
export const MAX_DECORATION_GLYPH_CHARS = 16;

/** D7 · D14 — a path a plugin names, absolute (trusted) or relative to a context root (sandboxed), in UTF-16 units. */
export const MAX_DECORATION_PATH_CHARS = 4_096;

/** D14 — updates in one `setFileDecorations` call. */
export const MAX_DECORATION_UPDATES = 1_000;

/** D6 — an icon name, in UTF-16 units; the name is ASCII, so bytes too. */
export const MAX_FILE_ICON_NAME_CHARS = 64;

/** D6 — an icon's SVG, in UTF-8 bytes. */
export const MAX_FILE_ICON_SVG_BYTES = 8 * 1024;

/** D6 — icons one plugin may define. */
export const MAX_FILE_ICONS = 64;

/**
 * D16 — the most targets the file tree menu hands a plugin command. Above it every plugin item is drawn
 * disabled, in both tiers, so a plugin never silently gets the first part of a selection. Read by
 * `components/sidebar/file-tree-plugin-menu.ts`.
 */
export const MAX_FILE_MENU_TARGETS = 1_000;

/** D8 — badges one row shows: from the first plugins, in plugin id order, that set one. */
export const MAX_ROW_BADGES = 2;
