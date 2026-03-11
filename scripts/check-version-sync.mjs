import { readFileSync } from "node:fs";

function readCargoPackageVersion(path) {
  const content = readFileSync(path, "utf8");
  const packageBlock = content.match(/\[package\][\s\S]*?(?=\n\[|$)/);

  if (!packageBlock) {
    throw new Error(`Missing [package] section in ${path}`);
  }

  const versionMatch = packageBlock[0].match(/^\s*version\s*=\s*"([^"]+)"/m);

  if (!versionMatch) {
    throw new Error(`Missing package version in ${path}`);
  }

  return versionMatch[1];
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

const packageVersion = readJson("package.json").version;
const tauriConfigVersion = readJson("src-tauri/tauri.conf.json").version;
const cargoVersion = readCargoPackageVersion("src-tauri/Cargo.toml");

const versions = {
  "package.json": packageVersion,
  "src-tauri/tauri.conf.json": tauriConfigVersion,
  "src-tauri/Cargo.toml": cargoVersion,
};

const uniqueVersions = [...new Set(Object.values(versions))];

if (uniqueVersions.length !== 1) {
  console.error("Version mismatch detected:");

  for (const [file, version] of Object.entries(versions)) {
    console.error(`- ${file}: ${version}`);
  }

  process.exit(1);
}

console.log(`Version sync OK: ${packageVersion}`);
