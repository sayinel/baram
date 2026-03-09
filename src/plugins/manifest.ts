// §69 Plugin Manifest validation
import type { PluginManifest, PluginCapability } from "./types";

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
];

export interface ManifestValidationError {
  field: string;
  message: string;
}

export function validateManifest(
  data: unknown,
):
  | { valid: true; manifest: PluginManifest }
  | { valid: false; errors: ManifestValidationError[] } {
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
        if (!["node", "mark", "plugin"].includes(ext.type as string)) {
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
