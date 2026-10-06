// §391 spec 0070 §4 — `contributions.menu` and `contributions.slash`: entry points that each
// name one of the manifest's own commands. A file of its own because `manifest.ts` was 639
// lines when these rules arrived (plan 0118 P1). The checks come in from
// `validateContributions`, which owns the error list, so a rule here reports exactly the way a
// rule there does.
import {
  MAX_ENTRY_DESCRIPTION_CHARS,
  MAX_ENTRY_TITLE_CHARS,
} from "./plugin-text";

/** D11 — one plugin cannot fill the editor's right-click menu. */
const MAX_MENU_ITEMS = 5;

/** D11 — nor the slash list. */
const MAX_SLASH_ITEMS = 10;

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
 * `menu` and `slash`: arrays of objects, capped (D11), ids unique within each array, every
 * entry's `id` an id and its `command` one of `contributions.commands[].id`; a `title`, when
 * present, 1 to 64 characters; a slash `description` 1 to 120; a menu `when` left out or
 * `"selection"` — a closed keyword (D4), so adding one later breaks no plugin.
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

/** The count cap and the duplicate-id rule, which both arrays share. */
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

/** What a menu entry and a slash entry share: `id`, `command` and an optional `title`. */
function validateEntry(
  check: ContributionChecks,
  item: Record<string, unknown>,
  at: string,
): void {
  check.requireId(item.id, `${at}.id`);
  check.requireDeclaredCommand(item.command, `${at}.command`);
  optionalText(check, item.title, `${at}.title`, MAX_ENTRY_TITLE_CHARS);
}
