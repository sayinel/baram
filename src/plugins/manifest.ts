// §69 Plugin Manifest validation
import type {
  PluginCapability,
  PluginManifest,
  PluginSettingType,
} from "./types";

import {
  isSafeSettingColor,
  MAX_SETTING_FIELDS,
  MAX_SETTING_VALUE_CHARS,
} from "./plugin-settings";
import {
  CAPABILITY_DESCRIPTIONS,
  SETTING_TYPES,
  SETTING_VALUE_TYPES,
} from "./types";

/**
 * Every capability the app knows how to enforce.
 *
 * Exported since §260 Phase 6 (code review M3): `fetchRegistryIndex` needs it to fail closed on
 * a registry entry naming a capability this build cannot enforce, which otherwise reached the
 * consent dialog as unbounded registry-controlled prose.
 *
 * DERIVED, not hand-written (§260 Phase 6 code review round 2). It used to be its own literal
 * array, which happened to hold all 13 union members but was not checked against them. That was
 * tolerable while the list only *rejected* manifests post-download; M3 promoted it to a gate on
 * the registry LISTING, where forgetting a future member silently demotes a legitimate plugin to
 * legacy and makes it uninstallable. `CAPABILITY_DESCRIPTIONS` is a
 * `Record<PluginCapability, string>`, so the compiler already refuses to let it fall behind the
 * union — deriving from it makes exhaustiveness structural instead of a thing to remember.
 */
export const VALID_CAPABILITIES = Object.keys(
  CAPABILITY_DESCRIPTIONS,
) as PluginCapability[];

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

/** Long enough for any readable id, short enough that a manifest cannot inflate a payload. */
const MAX_CONTRIBUTION_ID_CHARS = 64;

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
      // §260 스펙 0050 §6 — 기여는 `extensions` capability 를 선언해야 한다. capability 는
      // 권한의 상한이자 **설치 동의 화면이 사용자에게 보여 주는 설명**이다. 선언을 강제하지
      // 않으면 플러그인은 그냥 적지 않으면 되고, 에디터 안에서 코드를 돌린다는 사실이
      // 동의 화면에 영영 나타나지 않는다 — 이 capability 를 만든 이유가 그것이다.
      if (
        obj.tiptapExtensions.length > 0 &&
        // Sandboxed manifests never reach a valid state via this branch — the check
        // above already refuses ANY tiptapExtensions on that tier, whatever the
        // capabilities say. Firing here too would tell the author to declare
        // "extensions", which would not fix anything: reinstalling still fails, with
        // no new information (Task 7 fix round 1).
        obj.trust !== "sandboxed" &&
        Array.isArray(obj.capabilities) &&
        !obj.capabilities.includes("extensions")
      ) {
        errors.push({
          field: "capabilities",
          message:
            'a plugin that declares tiptapExtensions must also declare the "extensions" ' +
            "capability — it runs code inside the editor, and the install dialog has to " +
            "be able to say so.",
        });
      }
      for (let i = 0; i < obj.tiptapExtensions.length; i++) {
        const ext = obj.tiptapExtensions[i] as Record<string, unknown>;
        // §260 스펙 0050 §3.2 — `node`/`mark` 는 SCHEMA 를 바꾸는데, 스키마는 그것을 쓰는
        // 에디터를 만들 때 고정되고, 닿아야 할 에디터도 하나가 아니다: 큰 문서를 열 때마다
        // 자기 스키마를 가진 keep-alive 에디터가 플러그인이 로드된 뒤에도 새로 생긴다. 그래서
        // 지금은 받을 수 없다. 통과시킨 뒤 버리는 것이 이 필드의 원래 결함이었으므로,
        // 여기서 거부한다.
        if (ext.type !== "plugin") {
          errors.push({
            field: `tiptapExtensions[${i}].type`,
            message:
              'type must be "plugin". Contributing a node or a mark changes the ' +
              "schema, which is fixed when its editor is created — and the app " +
              "creates more than one editor, some of them after plugins have " +
              "loaded — so it is not supported yet. Decorations, keyboard " +
              'handlers and input rules all fit in a "plugin" contribution.',
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
    // §260 Phase 4c code review (L8) — the charset rule never bounded LENGTH, so the
    // "16 fields x 512 chars" argument that decides how settings values travel did not
    // actually hold: sixteen 64 KiB keys are a 1 MiB payload. Harmless today because that
    // payload is staged rather than framed, but a stated bound that is not a bound is how
    // the next transport decision gets made on a false premise.
    if (typeof value === "string" && value.length > MAX_CONTRIBUTION_ID_CHARS) {
      errors.push({
        field,
        message: `${field} may be at most ${MAX_CONTRIBUTION_ID_CHARS} characters`,
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
    requireString(
      field.description,
      `contributions.settings[${i}].description`,
      {
        optional: true,
      },
    );
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
    const settingType = type as PluginSettingType;
    const at = `contributions.settings[${i}]`;
    const optionValues = validateSettingShape(settingType, field, at, errors);
    // A `default` of the wrong type is rejected at install rather than silently ignored
    // at read time: the resolver falls back to the type's zero when a default does not
    // match, so a `"default": "10"` on a number field would leave the author's stated
    // default nowhere in the running app and no error anywhere.
    //
    // ‼️ §0054 — `SETTING_VALUE_TYPES[type]`, not `type`. `color` and `enum` are carried as
    // strings, so comparing against the declared NAME would reject every legal default they
    // could have. The same substitution the resolver's `coerce` makes, for the same reason.
    if (
      field.default !== undefined &&
      typeof field.default !== SETTING_VALUE_TYPES[settingType]
    ) {
      errors.push({
        field: `${at}.default`,
        message: `default must be a ${SETTING_VALUE_TYPES[settingType]} to match this field's "${settingType}" type`,
      });
      return; // the checks below all read a default of the right primitive
    }
    // §0054 — and the same argument one level deeper: a default the FIELD's own constraints
    // refuse is silently skipped by the resolver, leaving the author's stated default
    // nowhere in the running app. Every constraint that can refuse a value is checked here.
    if (field.default === undefined) return;
    // `as string` is safe and not inferrable: the `typeof` check above compared against
    // `SETTING_VALUE_TYPES["enum"]`, and TypeScript cannot narrow through that lookup.
    if (
      settingType === "enum" &&
      optionValues &&
      !optionValues.has(field.default as string)
    ) {
      errors.push({
        field: `${at}.default`,
        message: `default must be one of this field's option values`,
      });
    }
    if (settingType === "number") {
      const value = field.default as number;
      if (!Number.isFinite(value)) {
        errors.push({
          field: `${at}.default`,
          message: `default must be finite`,
        });
      } else if (
        (typeof field.min === "number" && value < field.min) ||
        (typeof field.max === "number" && value > field.max)
      ) {
        errors.push({
          field: `${at}.default`,
          message: `default must be within this field's min/max`,
        });
      }
    }
    if (settingType === "color" && !isSafeSettingColor(field.default)) {
      errors.push({
        field: `${at}.default`,
        message: `default must be a CSS colour — a hex value, a colour name, rgb()/hsl(), or var(--color-accent-default)`,
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

/**
 * §0054 — the shape checks for one settings field's `min`/`max`/`options`.
 *
 * Returns the enum's option values when they are usable, so the caller can check `default`
 * against them without walking the list twice; `null` means "already reported, do not check
 * `default` against it".
 *
 * ‼️ A constraint declared on a type that does not use it is an ERROR, not a silent no-op.
 * `options` on a `boolean` field, `min` on a `string` — these are the author writing down an
 * intention the app will never honour, and the whole reason this section exists is that such
 * intentions used to disappear between the manifest and the running app with nothing said.
 */
function validateSettingShape(
  type: PluginSettingType,
  field: Record<string, unknown>,
  at: string,
  errors: ManifestValidationError[],
): null | Set<string> {
  const rejectUnusable = (key: string, usedBy: string) => {
    if (field[key] !== undefined) {
      errors.push({
        field: `${at}.${key}`,
        message: `${key} applies only to a "${usedBy}" field, and this one is "${type}"`,
      });
    }
  };

  if (type !== "number") {
    rejectUnusable("min", "number");
    rejectUnusable("max", "number");
  } else {
    for (const key of ["min", "max"] as const) {
      const bound = field[key];
      if (bound !== undefined && !Number.isFinite(bound)) {
        errors.push({
          field: `${at}.${key}`,
          message: `${key} must be a finite number`,
        });
      }
    }
    const { max, min } = field;
    if (
      typeof min === "number" &&
      typeof max === "number" &&
      Number.isFinite(min) &&
      Number.isFinite(max) &&
      min > max
    ) {
      // A range no value can satisfy. `declaredSettingsFor` drops such a field rather than
      // render a control whose every answer its own field calls illegal; this tells the
      // author at install instead of leaving the field mysteriously absent.
      errors.push({
        field: `${at}.min`,
        message: `min must not be greater than max`,
      });
    }
  }

  if (type !== "enum") {
    rejectUnusable("options", "enum");
    return null;
  }

  const options = field.options;
  if (!Array.isArray(options) || options.length === 0) {
    errors.push({
      field: `${at}.options`,
      message: `an "enum" field must declare a non-empty options array`,
    });
    return null;
  }
  const values = new Set<string>();
  let usable = true;
  options.forEach((option, j) => {
    const entry = option as null | Record<string, unknown>;
    if (typeof entry?.value !== "string" || entry.value.length === 0) {
      errors.push({
        field: `${at}.options[${j}].value`,
        message: `option value must be a non-empty string`,
      });
      usable = false;
      return;
    }
    // ‼️ §0054 code review (MEDIUM) — an enum value is never CLAMPED. `clampChars` runs on
    // the `string` type only, and clamping an enum value would yield something that is no
    // longer one of `options`. Without this cap, `MAX_SETTING_VALUE_CHARS`'s "16 × 512 is
    // ~9 KiB" stopped being a bound the moment enums existed: one option could carry a
    // megabyte straight through to the sandbox settings pull. Same defect class as the id
    // length cap above, one level down.
    if (entry.value.length > MAX_SETTING_VALUE_CHARS) {
      errors.push({
        field: `${at}.options[${j}].value`,
        message: `option value must be at most ${MAX_SETTING_VALUE_CHARS} characters`,
      });
      usable = false;
      return;
    }
    if (typeof entry.label !== "string" || entry.label.length === 0) {
      errors.push({
        field: `${at}.options[${j}].label`,
        message: `option label must be a non-empty string`,
      });
      usable = false;
      return;
    }
    if (values.has(entry.value)) {
      // Two options with one value render two rows the user cannot tell apart, and picking
      // either stores the same answer — the same argument as `rejectDuplicateIds`.
      errors.push({
        field: `${at}.options[${j}].value`,
        message: `duplicate option value "${entry.value}"`,
      });
      usable = false;
      return;
    }
    values.add(entry.value);
  });
  return usable ? values : null;
}
