// §391 spec 0070 §4 — `contributions.menu` and `contributions.slash`: entry points that each
// name one of the manifest's own commands. A file of its own because `manifest.ts` was 639
// lines when these rules arrived (plan 0118 P1). The checks come in from
// `validateContributions`, which owns the error list, so a rule here reports exactly the way a
// rule there does.
// §395 spec 0074 D16 — and `contributions.fileMenu`, the file tree's right-click menu, by the menu's
// rules with its own cap and its own `when`.
// Its tie to the `filetree` capability is `checkFileMenuDeclarations`, which `validateManifest` calls
// because it needs the capability list.
import {
  MAX_ENTRY_DESCRIPTION_CHARS,
  MAX_ENTRY_TITLE_CHARS,
} from "./plugin-text";

/** D11 — one plugin cannot fill the editor's right-click menu. */
const MAX_MENU_ITEMS = 5;

/** D11 — nor the slash list. */
const MAX_SLASH_ITEMS = 10;

/** §395 spec 0074 D16 — nor the file tree's right-click menu. */
const MAX_FILE_MENU_ITEMS = 5;

/** The checks `validateContributions` lends this file, bound to its error list. */
export interface ContributionChecks {
  entries: (key: string) => null | Record<string, unknown>[];
  rejectDuplicateIds: (
    section: string,
    list: Record<string, unknown>[],
  ) => void;
  report: (field: string, message: string) => void;
  requireDeclaredCommand: (value: unknown, field: string) => void;
  requireId: (value: unknown, field: string) => void;
}

/**
 * §395 spec 0074 D16 — `fileMenu` needs `filetree`, in either tier (both may declare it), so the install
 * dialog can say so. The reverse is not an error: `filetree` without `fileMenu` is a plugin that only
 * decorates (plan 0127), as `sidebar` without `panels` stays valid (`checkPanelDeclarations`).
 */
export function checkFileMenuDeclarations(
  capabilities: unknown,
  contributions: unknown,
  report: (field: string, message: string) => void,
): void {
  if (!Array.isArray(capabilities)) return; // reported by the capabilities check
  const list =
    typeof contributions === "object" &&
    contributions !== null &&
    !Array.isArray(contributions)
      ? (contributions as Record<string, unknown>).fileMenu
      : undefined;
  if (!Array.isArray(list) || list.length === 0) return;
  if (!capabilities.includes("filetree")) {
    report(
      "capabilities",
      'contributions.fileMenu needs the "filetree" capability — the install dialog has to be able to say so',
    );
  }
}

/**
 * `menu` and `slash`: arrays of objects, capped (D11), ids unique within each array, every
 * entry's `id` an id and its `command` one of `contributions.commands[].id`; a `title`, when
 * present, 1 to 64 characters; a slash `description` 1 to 120; a menu `when` left out or
 * `"selection"` — a closed keyword (D4), so adding one later breaks no plugin. `fileMenu` (§395 spec 0074
 * D16) takes the menu's rules with its own cap and its own `when`: left out, `"file"` or `"folder"`.
 */
export function validateEntryPoints(check: ContributionChecks): void {
  const menu = check.entries("menu");
  if (menu) {
    capped(check, "menu", menu, MAX_MENU_ITEMS);
    menu.forEach((item, i) => {
      const at = `contributions.menu[${i}]`;
      validateEntry(check, item, at);
      if (item.when !== undefined && item.when !== "selection") {
        check.report(`${at}.when`, 'when must be left out or be "selection"');
      }
    });
  }
  const fileMenu = check.entries("fileMenu");
  if (fileMenu) {
    capped(check, "fileMenu", fileMenu, MAX_FILE_MENU_ITEMS);
    fileMenu.forEach((item, i) => {
      const at = `contributions.fileMenu[${i}]`;
      validateEntry(check, item, at);
      if (
        item.when !== undefined &&
        item.when !== "file" &&
        item.when !== "folder"
      ) {
        check.report(
          `${at}.when`,
          'when must be left out or be "file" or "folder"',
        );
      }
    });
  }
  const slash = check.entries("slash");
  if (slash) {
    capped(check, "slash", slash, MAX_SLASH_ITEMS);
    slash.forEach((item, i) => {
      const at = `contributions.slash[${i}]`;
      validateEntry(check, item, at);
      optionalText(
        check,
        item.description,
        `${at}.description`,
        MAX_ENTRY_DESCRIPTION_CHARS,
      );
    });
  }
}

/** The count cap and the duplicate-id rule, which every array here shares. */
function capped(
  check: ContributionChecks,
  section: string,
  list: Record<string, unknown>[],
  max: number,
): void {
  if (list.length > max) {
    check.report(
      `contributions.${section}`,
      `at most ${max} ${section} items may be declared`,
    );
  }
  check.rejectDuplicateIds(section, list);
}

/**
 * A string of 1 to `max` characters when present. Counted in `.length` — UTF-16 units, the unit
 * `sanitizePluginText` caps in, so the cap that validates is the cap that draws.
 */
function optionalText(
  check: ContributionChecks,
  value: unknown,
  field: string,
  max: number,
): void {
  if (value === undefined) return;
  if (typeof value !== "string" || value.length === 0 || value.length > max) {
    check.report(field, `${field} must be a string of 1 to ${max} characters`);
  }
}

/** What a menu, a slash and a file menu entry share: `id`, `command` and an optional `title`. */
function validateEntry(
  check: ContributionChecks,
  item: Record<string, unknown>,
  at: string,
): void {
  check.requireId(item.id, `${at}.id`);
  check.requireDeclaredCommand(item.command, `${at}.command`);
  optionalText(check, item.title, `${at}.title`, MAX_ENTRY_TITLE_CHARS);
}
