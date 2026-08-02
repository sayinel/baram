/**
 * Checks that every `index.json` entry points at an archive that actually EXISTS in the
 * registry and hashes to the checksum the entry declares (§69).
 *
 * ‼️ THE ONE CHECK THAT CANNOT RUN IN THIS REPO. `validate-index.ts` judges the document —
 * field types, tiers, capabilities, the version floor, the URL's scheme. It has never
 * opened a single ZIP, because in the app repo there are none: the archives live in
 * `sayinel/baram-plugins` alongside the index that names them. So the two failures a user
 * meets most directly have had no gate at all:
 *
 * - `downloadUrl` names a file that is not there → every install of that entry 404s
 * - the file is there but its sha256 is not the entry's → every install fails its integrity
 *   check, which the app reports as a checksum mismatch rather than as a registry mistake
 *
 * Both deploy cleanly, serve a 200 for `index.json`, and look perfect in every existing
 * gate. The second is the worse one: an operator who pasted a stale checksum sees a healthy
 * index and a stream of users reporting that a plugin "won't install".
 *
 * Run: npx tsx scripts/validate-registry-assets.ts <registry-root> [--base-url URL]
 *
 * `<registry-root>` is a checkout of the registry repo — the directory holding `index.json`
 * and `plugins/`.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import { label } from "./gha-label";

/** Where the registry serves from. An entry pointing elsewhere is refused; see below. */
const DEFAULT_BASE_URL = "https://sayinel.github.io/baram-plugins/";

const args = process.argv.slice(2);
const baseFlag = args.indexOf("--base-url");
const baseUrl = (
  baseFlag >= 0 ? (args[baseFlag + 1] ?? DEFAULT_BASE_URL) : DEFAULT_BASE_URL
).replace(/\/*$/, "/");
const root = resolve(args.find((a) => !a.startsWith("--")) ?? ".");
const indexPath = join(root, "index.json");

const errors: string[] = [];
const warnings: string[] = [];

function fail(message: string): never {
  console.error(`✗ ${indexPath}: ${message}`);
  process.exit(1);
}

let raw: unknown;
try {
  raw = JSON.parse(readFileSync(indexPath, "utf8"));
} catch (err) {
  fail(`not valid JSON — ${String(err)}`);
}

const plugins = (raw as { plugins?: unknown }).plugins;
if (!Array.isArray(plugins)) {
  fail("no `plugins` array — the app cannot read this as an index at all");
}

/** Archives an entry claimed, so orphans can be reported afterwards. */
const referenced = new Set<string>();

plugins.forEach((value, position) => {
  const entry = (value ?? {}) as Record<string, unknown>;
  const id = typeof entry.id === "string" && entry.id !== "" ? entry.id : null;
  const where = label(id ?? `entry #${position + 1}`);

  const url = entry.downloadUrl;
  const checksum = entry.checksum;
  if (typeof url !== "string" || typeof checksum !== "string") {
    // `validate-index.ts` owns the type table and says this far better. Skipping rather
    // than repeating it keeps one message per defect: the two scripts run together.
    return;
  }

  if (!url.startsWith(baseUrl)) {
    // ‼️ AN ERROR, not a warning, and the reasoning is about what a gate can promise. An
    // archive hosted elsewhere cannot be hashed here, so admitting one would mean this
    // script reports success over an entry it never checked — the silent-pass shape every
    // other gate in this repo is written to avoid.
    //
    // It is also a policy statement worth making explicit: `plugin-release.yml` publishes
    // every archive into the registry's own Pages, so an off-registry URL today means a
    // hand-edited entry. If self-hosted plugins ever become a supported model, this is the
    // line that has to change, and it should change deliberately.
    errors.push(
      `${where}: downloadUrl ${label(JSON.stringify(url))} is not under ${baseUrl} — ` +
        "the archive cannot be verified here, so publishing it would mean shipping an " +
        "entry no gate has ever checked",
    );
    return;
  }

  const relative = url.slice(baseUrl.length);
  if (relative === "" || relative.includes("..")) {
    errors.push(
      `${where}: downloadUrl ${label(JSON.stringify(url))} does not name a file inside the registry`,
    );
    return;
  }
  referenced.add(relative);

  const file = join(root, relative);
  if (!existsSync(file) || !statSync(file).isFile()) {
    errors.push(
      `${where}: ${relative} is not in the registry — the app would 404 on every install ` +
        "of this entry, after the marketplace has already offered it",
    );
    return;
  }

  const actual = createHash("sha256").update(readFileSync(file)).digest("hex");
  if (actual !== checksum) {
    errors.push(
      `${where}: ${relative} hashes to ${actual} but the entry declares ${label(checksum)} — ` +
        "the app verifies this before extracting, so every install fails and the user is " +
        "told the download was corrupted",
    );
  }
});

/**
 * Archives belonging to a plugin the index has WITHDRAWN — not merely superseded.
 *
 * ‼️ The distinction is what keeps this warning worth reading. Every update leaves the
 * previous version's ZIP behind, so "no entry points at this file" fires once per release
 * forever and the real case drowns in a decade of `-1.0.0.zip`. A superseded archive is
 * normal: the id is still listed, at a newer version.
 *
 * What is worth saying is that a plugin removed from the index — the withdrawal path, the
 * one used for `baram-ai-summary` — keeps serving its archive by direct URL. Nothing in the
 * app can reach it (the index is the only way in), but a trusted-tier plugin pulled for
 * cause is still one `curl` away, and an operator should decide that on purpose.
 *
 * Matched by longest id prefix rather than by parsing `<id>-<version>.zip`: ids may contain
 * hyphens, so splitting on the last one guesses wrong for `baram-word-count`.
 */
const indexedIds = plugins
  .map((p) => (p as { id?: unknown }).id)
  .filter((id): id is string => typeof id === "string" && id !== "")
  .sort((a, b) => b.length - a.length);

const pluginsDir = join(root, "plugins");
if (existsSync(pluginsDir)) {
  for (const name of readdirSync(pluginsDir).sort()) {
    const relative = `plugins/${name}`;
    if (referenced.has(relative) || !name.endsWith(".zip")) continue;
    const superseded = indexedIds.some((id) => name.startsWith(`${id}-`));
    if (!superseded) {
      warnings.push(
        `${label(relative)} belongs to no listed plugin — a withdrawn plugin's archive ` +
          "stays downloadable by direct URL",
      );
    }
  }
}

for (const warning of warnings) console.warn(`⚠ ${indexPath}: ${warning}`);

if (errors.length > 0) {
  console.error(`✗ ${indexPath}: ${errors.length} problem(s)`);
  for (const error of errors) console.error(`    ${error}`);
  process.exit(1);
}

console.log(
  `✓ ${indexPath}: ${referenced.size} archive(s) present and matching` +
    (warnings.length > 0 ? ` (${warnings.length} warning(s))` : ""),
);
