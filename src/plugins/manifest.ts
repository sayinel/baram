// §69 Plugin Manifest validation
import type {
  PluginCapability,
  PluginManifest,
  PluginSettingType,
} from "./types";

import { MAX_SETTING_FIELDS } from "./plugin-settings";
import { SETTING_TYPES } from "./types";

const VALID_CAPABILITIES: PluginCapability[] = [
  "editor",
  "editor:readonly",
  "files",
  "files:readonly",
  "commands",
  "sidebar",
  "statusbar",
  "settings",
  "events",
  "ai",
  "network",
  "storage",
  "viewer",
];

export interface ManifestValidationError {
  field: string;
  message: string;
}

/**
 * §260 Phase 4a security review (HIGH-2) — how many status-bar items one plugin may
 * declare. Unbounded, a manifest alone could fill the app chrome with hundreds of
 * items, no plugin code and (before this review) no capability required.
 */
const MAX_STATUS_BAR_ITEMS = 5;

/**
 * Ids that stay unambiguous once namespaced. The host builds `${pluginId}.${command}`
 * and `${pluginId}:sb:${item}`; a plugin id cannot contain `.` or `:` (see the id rule
 * above), which is what makes cross-plugin collision impossible — so keep the same
 * characters out of the ids that follow the separator.
 */
const CONTRIBUTION_ID = /^[A-Za-z0-9_-]+$/;

export function validateManifest(
  data: unknown,
):
  | { errors: ManifestValidationError[]; valid: false }
  | { manifest: PluginManifest; valid: true } {
  const errors: ManifestValidationError[] = [];
  if (!data || typeof data !== "object") {
    return {
      valid: false,
      errors: [{ field: "root", message: "manifest must be a JSON object" }],
    };
  }

  const obj = data as Record<string, unknown>;

  // Required string fields
  for (const field of [
    "id",
    "name",
    "description",
    "version",
    "author",
    "license",
    "main",
  ]) {
    if (!obj[field] || typeof obj[field] !== "string") {
      errors.push({
        field,
        message: `${field} is required and must be a string`,
      });
    }
  }

  // ID format: lowercase alphanumeric + hyphens
  if (typeof obj.id === "string" && !/^[a-z0-9-]+$/.test(obj.id)) {
    errors.push({
      field: "id",
      message: "id must contain only lowercase letters, digits, and hyphens",
    });
  }

  // Engines
  if (!obj.engines || typeof obj.engines !== "object") {
    errors.push({ field: "engines", message: "engines is required" });
  } else {
    const engines = obj.engines as Record<string, unknown>;
    if (!engines.baram || typeof engines.baram !== "string") {
      errors.push({
        field: "engines.baram",
        message: "engines.baram version is required",
      });
    }
  }

  // Capabilities
  if (!Array.isArray(obj.capabilities)) {
    errors.push({
      field: "capabilities",
      message: "capabilities must be an array",
    });
  } else {
    for (const cap of obj.capabilities) {
      if (!VALID_CAPABILITIES.includes(cap as PluginCapability)) {
        errors.push({
          field: "capabilities",
          message: `unknown capability: ${cap}`,
        });
      }
    }
  }

  // Trust tier (§260) — required discriminator
  if (obj.trust !== "trusted" && obj.trust !== "sandboxed") {
    errors.push({
      field: "trust",
      message: 'trust is required and must be "trusted" or "sandboxed"',
    });
  }

  // §260 3c-2b — sandboxed-tier constraints that follow from HOW its code is
  // loaded, not from taste. The bundle is imported from a `blob:` URL, which has no
  // base URL, so nothing inside it can resolve a sibling module; and Rust reads it
  // out of the plugin's own directory, so `main` must stay inside that directory.
  // Both are install-time errors here rather than opaque failures in the sandbox.
  if (obj.trust === "sandboxed") {
    const main = typeof obj.main === "string" ? obj.main : "";
    const escapes =
      main.startsWith("/") ||
      main.startsWith("\\") ||
      /^[A-Za-z]:/.test(main) ||
      main.split(/[/\\]/).includes("..");
    if (escapes) {
      errors.push({
        field: "main",
        message:
          "a sandboxed plugin's main must be a single bundled file inside the " +
          "plugin directory (no absolute paths, no ..)",
      });
    }
    if (
      Array.isArray(obj.tiptapExtensions) &&
      obj.tiptapExtensions.length > 0
    ) {
      errors.push({
        field: "tiptapExtensions",
        message:
          "tiptapExtensions require the main realm and are only available to " +
          'trust: "trusted" — a sandboxed plugin contributes declaratively',
      });
    }
  }

  // Contributions (optional, sandboxed tier)
  if (obj.contributions !== undefined) {
    if (
      typeof obj.contributions !== "object" ||
      obj.contributions === null ||
      Array.isArray(obj.contributions)
    ) {
      errors.push({
        field: "contributions",
        message: "contributions must be an object",
      });
    } else {
      errors.push(
        ...validateContributions(obj.contributions as Record<string, unknown>),
      );
    }
  }

  // tiptapExtensions (optional)
  if (obj.tiptapExtensions !== undefined) {
    if (!Array.isArray(obj.tiptapExtensions)) {
      errors.push({
        field: "tiptapExtensions",
        message: "tiptapExtensions must be an array",
      });
    } else {
      for (let i = 0; i < obj.tiptapExtensions.length; i++) {
        const ext = obj.tiptapExtensions[i] as Record<string, unknown>;
        if (!["mark", "node", "plugin"].includes(ext.type as string)) {
          errors.push({
            field: `tiptapExtensions[${i}].type`,
            message: "type must be node, mark, or plugin",
          });
        }
        if (!ext.name || typeof ext.name !== "string") {
          errors.push({
            field: `tiptapExtensions[${i}].name`,
            message: "name is required",
          });
        }
        if (!ext.exportName || typeof ext.exportName !== "string") {
          errors.push({
            field: `tiptapExtensions[${i}].exportName`,
            message: "exportName is required",
          });
        }
      }
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, manifest: obj as unknown as PluginManifest };
}

/**
 * §260 Phase 4a security review (HIGH-2) — validate the ENTRIES, not just that
 * `contributions` is an object.
 *
 * Before this, `"statusBar": [{}]` reached the loader, where `sanitizeStatusBarText`
 * threw on a non-string `text` AFTER the sandbox had already started — leaving a live,
 * still-authorized sandbox that the loader never recorded, so disabling the plugin was a
 * no-op. The loader's rollback now covers that structurally, and this stops the
 * malformed manifest at install time, where the author can see it. Both halves matter:
 * validation alone leaves the structural hole, the rollback alone leaves the next
 * unvalidated field.
 */
function validateContributions(
  contributions: Record<string, unknown>,
): ManifestValidationError[] {
  const errors: ManifestValidationError[] = [];
  const requireString = (
    value: unknown,
    field: string,
    { optional = false }: { optional?: boolean } = {},
  ) => {
    if (optional && value === undefined) return;
    if (typeof value !== "string" || value.length === 0) {
      errors.push({ field, message: `${field} must be a non-empty string` });
    }
  };
  const requireId = (value: unknown, field: string) => {
    requireString(value, field);
    if (typeof value === "string" && !CONTRIBUTION_ID.test(value)) {
      errors.push({
        field,
        message: `${field} may contain only letters, digits, "_" and "-"`,
      });
    }
    // §260 Phase 4c security review (LOW-3) — the charset admits `__proto__`, and an id is
    // used as an object key downstream (the resolved settings record, the store's own
    // per-plugin record). Assigning to it on a plain object hits the inherited setter, so
    // the field silently did nothing rather than failing visibly. The resolver is
    // null-prototype now, which fixes the behaviour; this tells the AUTHOR, at install,
    // rather than leaving them a control that does not work.
    if (value === "__proto__") {
      errors.push({ field, message: `${field} may not be "__proto__"` });
    }
  };
  /** Every declared section must be an array of objects before anything indexes it. */
  const entries = (key: string): null | Record<string, unknown>[] => {
    const value = contributions[key];
    if (value === undefined) return null;
    if (!Array.isArray(value)) {
      errors.push({
        field: `contributions.${key}`,
        message: `contributions.${key} must be an array`,
      });
      return null;
    }
    const bad = value.findIndex(
      (e) => typeof e !== "object" || e === null || Array.isArray(e),
    );
    if (bad !== -1) {
      errors.push({
        field: `contributions.${key}[${bad}]`,
        message: `contributions.${key} entries must be objects`,
      });
      return null;
    }
    return value as Record<string, unknown>[];
  };

  const commands = entries("commands");
  commands?.forEach((cmd, i) => {
    requireId(cmd.id, `contributions.commands[${i}].id`);
    requireString(cmd.title, `contributions.commands[${i}].title`);
    if (cmd.palette !== undefined && typeof cmd.palette !== "boolean") {
      errors.push({
        field: `contributions.commands[${i}].palette`,
        message: "palette must be a boolean",
      });
    }
  });

  /**
   * Duplicate ids within one section (code review M9). Two entries with the same id
   * become two store items with the SAME `itemId`, which React renders with a duplicate
   * key and which `updateStatusBarText`/`removeStatusBarItem` then touch together — a
   * plugin addressing "its" item would silently drive both.
   */
  const rejectDuplicateIds = (
    section: string,
    list: Record<string, unknown>[],
    /** Which field carries the identity — `settings` calls its own `key` (Phase 4c). */
    field = "id",
  ) => {
    const seen = new Set<string>();
    list.forEach((entry, i) => {
      const id = entry[field];
      if (typeof id !== "string") return; // already reported by requireId
      if (seen.has(id)) {
        errors.push({
          field: `contributions.${section}[${i}].${field}`,
          message: `duplicate ${field} "${id}"`,
        });
      }
      seen.add(id);
    });
  };
  if (commands) rejectDuplicateIds("commands", commands);

  const statusBar = entries("statusBar");
  if (statusBar) rejectDuplicateIds("statusBar", statusBar);
  if (statusBar && statusBar.length > MAX_STATUS_BAR_ITEMS) {
    errors.push({
      field: "contributions.statusBar",
      message: `at most ${MAX_STATUS_BAR_ITEMS} status-bar items may be declared`,
    });
  }
  statusBar?.forEach((item, i) => {
    requireId(item.id, `contributions.statusBar[${i}].id`);
    requireString(item.text, `contributions.statusBar[${i}].text`);
    requireString(item.tooltip, `contributions.statusBar[${i}].tooltip`, {
      optional: true,
    });
    if (item.command !== undefined) {
      requireId(item.command, `contributions.statusBar[${i}].command`);
      // …and it must name a command this manifest declares (code review NIT-2).
      // Otherwise the item renders as a button whose handler never exists: a permanently
      // dead control, with nothing anywhere to explain it.
      if (
        typeof item.command === "string" &&
        !(commands ?? []).some((c) => c.id === item.command)
      ) {
        errors.push({
          field: `contributions.statusBar[${i}].command`,
          message: `no command "${item.command}" is declared in contributions.commands`,
        });
      }
    }
  });

  // §260 Phase 4c — `settings` is READ now (the plugin detail view renders it and both
  // tiers resolve values against it), so this is the commit that owes it a shape. The
  // carry-over rule from 4a, discharged.
  const settings = entries("settings");
  if (settings) rejectDuplicateIds("settings", settings, "key");
  if (settings && settings.length > MAX_SETTING_FIELDS) {
    errors.push({
      field: "contributions.settings",
      message: `at most ${MAX_SETTING_FIELDS} settings fields may be declared`,
    });
  }
  settings?.forEach((field, i) => {
    // `requireId`, not `requireString`: a key is namespaced per plugin in the persisted
    // record and addressed by the resolver, so keep the separators the host builds with
    // out of it — the same rule the status bar's ids follow.
    requireId(field.key, `contributions.settings[${i}].key`);
    requireString(field.label, `contributions.settings[${i}].label`);
    const type = field.type;
    if (
      typeof type !== "string" ||
      !SETTING_TYPES.includes(type as PluginSettingType)
    ) {
      errors.push({
        field: `contributions.settings[${i}].type`,
        message: `type must be one of ${SETTING_TYPES.map((t) => `"${t}"`).join(", ")}`,
      });
      return; // without a valid type there is nothing to check `default` against
    }
    // A `default` of the wrong type is rejected at install rather than silently ignored
    // at read time: the resolver falls back to the type's zero when a default does not
    // match, so a `"default": "10"` on a number field would leave the author's stated
    // default nowhere in the running app and no error anywhere.
    if (field.default !== undefined && typeof field.default !== type) {
      errors.push({
        field: `contributions.settings[${i}].default`,
        message: `default must be a ${type} to match this field's type`,
      });
    }
  });

  // `menu` is declared in the Phase-1 schema and still nothing consumes it. Checked only
  // as an array of objects: asserting a shape the loader does not read would freeze a
  // design that is not settled, while leaving it unchecked would repeat the mistake this
  // function exists to fix the moment something reads it.
  //
  // ‼️ CARRY-OVER (4a → 4b → 4c): whoever first reads `menu[].command` adds `requireId`
  // for it in the SAME commit — the host builds `${pluginId}.${command}` from it, exactly
  // as the status bar does, and `CONTRIBUTION_ID` is what keeps the separator unambiguous.
  entries("menu");
  return errors;
}
