#!/usr/bin/env node
/**
 * Upsert a plugin entry into a registry index.json.
 * Called by .github/workflows/plugin-release.yml (§69 registry hosting).
 *
 * Usage:
 *   node scripts/update-registry-index.mjs \
 *     --index path/to/index.json \
 *     --manifest examples/plugins/word-count/baram-plugin.json \
 *     --zip-name baram-word-count-1.0.0.zip \
 *     --checksum <64-hex sha256> \
 *     --base-url https://sayinel.github.io/baram-plugins/
 */
import { readFileSync, writeFileSync } from "node:fs";

function fail(msg) {
  console.error(`update-registry-index: ${msg}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key?.startsWith("--") || value === undefined) {
      fail(`bad argument pair: ${key ?? ""} ${value ?? ""}`);
    }
    args[key.slice(2)] = value;
  }
  for (const required of ["index", "manifest", "zip-name", "checksum", "base-url"]) {
    if (!args[required]) fail(`missing --${required}`);
  }
  return args;
}

const MANIFEST_REQUIRED = [
  "id",
  "name",
  "description",
  "version",
  "author",
  "license",
  "capabilities",
  "engines",
];

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

const args = parseArgs(process.argv.slice(2));

if (!/^[0-9a-f]{64}$/.test(args.checksum)) {
  fail("checksum must be 64 lowercase hex chars");
}

if (!/^[a-z0-9][a-z0-9.-]*\.zip$/.test(args["zip-name"])) {
  fail("--zip-name must match /^[a-z0-9][a-z0-9.-]*\\.zip$/");
}

const manifest = JSON.parse(readFileSync(args.manifest, "utf8"));
for (const field of MANIFEST_REQUIRED) {
  if (manifest[field] === undefined) fail(`manifest missing required field: ${field}`);
}

if (!isNonEmptyString(manifest.id) || !/^[a-z0-9][a-z0-9-]*$/.test(manifest.id)) {
  fail("manifest field 'id' must be a non-empty string matching /^[a-z0-9][a-z0-9-]*$/");
}
for (const field of ["name", "description", "author", "license"]) {
  if (!isNonEmptyString(manifest[field])) {
    fail(`manifest field '${field}' must be a non-empty string`);
  }
}
if (!isNonEmptyString(manifest.version) || !/^\d+\.\d+\.\d+$/.test(manifest.version)) {
  fail("manifest field 'version' must be a string matching /^\\d+\\.\\d+\\.\\d+$/");
}
if (!Array.isArray(manifest.capabilities) || !manifest.capabilities.every(isNonEmptyString)) {
  fail("manifest field 'capabilities' must be an array of non-empty strings");
}
if (
  typeof manifest.engines !== "object" ||
  manifest.engines === null ||
  Array.isArray(manifest.engines) ||
  !Object.values(manifest.engines).every(isNonEmptyString)
) {
  fail("manifest field 'engines' must be a plain object whose values are non-empty strings");
}
if (manifest.icon !== undefined && !isNonEmptyString(manifest.icon)) {
  fail("manifest field 'icon' must be a non-empty string when present");
}
if (
  manifest.keywords !== undefined &&
  (!Array.isArray(manifest.keywords) || !manifest.keywords.every(isNonEmptyString))
) {
  fail("manifest field 'keywords' must be an array of non-empty strings when present");
}

const baseUrl = args["base-url"].endsWith("/") ? args["base-url"] : `${args["base-url"]}/`;

const entry = {
  id: manifest.id,
  name: manifest.name,
  description: manifest.description,
  version: manifest.version,
  author: manifest.author,
  license: manifest.license,
  downloadUrl: `${baseUrl}plugins/${args["zip-name"]}`,
  checksum: args.checksum,
  capabilities: manifest.capabilities,
  engines: manifest.engines,
};
if (manifest.icon !== undefined) entry.icon = manifest.icon;
if (manifest.keywords !== undefined) entry.keywords = manifest.keywords;

const index = JSON.parse(readFileSync(args.index, "utf8"));
if (!Array.isArray(index.plugins)) fail("index.json has no plugins array");

const at = index.plugins.findIndex((p) => p.id === entry.id);
if (at >= 0) index.plugins[at] = entry;
else index.plugins.push(entry);
index.updatedAt = new Date().toISOString().slice(0, 10);

const serialized = `${JSON.stringify(index, null, 2)}\n`;
JSON.parse(serialized); // self-check: output must round-trip before we write it
writeFileSync(args.index, serialized);
console.log(`upserted ${entry.id}@${entry.version} -> ${entry.downloadUrl}`);
