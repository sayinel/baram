// §69 Plugin Manifest validation
import type { PluginCapability, PluginManifest } from "./types";

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

  const statusBar = entries("statusBar");
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
    }
  });

  // `menu` and `settings` are declared in the Phase-1 schema but nothing consumes them
  // yet (Phase 4b). Checked only as arrays of objects: asserting a shape the loader does
  // not read would freeze a design that is not settled, while leaving them unchecked
  // would repeat the mistake this function exists to fix the moment 4b reads one.
  entries("menu");
  entries("settings");
  return errors;
}
