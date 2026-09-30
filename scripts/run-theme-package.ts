/**
 * §371 6b-2 — `theme-package.ts` 의 CLI. `plugin-release.yml` 의 `release-theme` 잡과 게시 전
 * 파일 설치 점검(스펙 0063 §7.5)이 이것을 부른다.
 *
 * Usage (저장소 루트에서 — 앱 버전을 `./package.json` 에서 읽는다):
 *   npx tsx scripts/run-theme-package.ts package --dir examples/themes/hangul --version 1.0.0 --out <dir>
 *     → <dir>/<id>-<version>.zip 을 쓰고(없는 <dir> 은 만든다) stdout 에 `theme_id=` · `zip_name=` ·
 *       `sha256=` 세 줄
 *   npx tsx scripts/run-theme-package.ts verify --zip <file> --id <id> --version <v> \
 *       --manifest-out <file> --preview-out <file>
 *
 * 종료 코드: 0 통과, 1 거부(이유는 stderr), 2 인자 오류.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { packageTheme, verifyThemeArchive } from "./theme-package";

function flags(argv: string[], required: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key?.startsWith("--") || value === undefined) {
      usage(`bad argument pair: ${key ?? ""} ${value ?? ""}`);
    }
    out[key.slice(2)] = value;
  }
  for (const name of required) {
    if (!out[name]) usage(`missing --${name}`);
  }
  return out;
}

function refuse(message: string): never {
  console.error(`run-theme-package: ${message}`);
  process.exit(1);
}

function usage(message: string): never {
  console.error(`run-theme-package: ${message}`);
  process.exit(2);
}

const [command, ...rest] = process.argv.slice(2);

if (command === "package") {
  const args = flags(rest, ["dir", "version", "out"]);
  const appVersion = (
    JSON.parse(readFileSync("package.json", "utf8")) as { version: string }
  ).version;
  const result = await packageTheme(args.dir, {
    appVersion,
    version: args.version,
  });
  if (!result.ok) refuse(result.error);
  mkdirSync(args.out, { recursive: true });
  writeFileSync(join(args.out, result.zipName), result.bytes);
  const sha256 = createHash("sha256").update(result.bytes).digest("hex");
  console.log(`theme_id=${result.manifest.id}`);
  console.log(`zip_name=${result.zipName}`);
  console.log(`sha256=${sha256}`);
} else if (command === "verify") {
  const args = flags(rest, [
    "zip",
    "id",
    "version",
    "manifest-out",
    "preview-out",
  ]);
  const result = await verifyThemeArchive(
    new Uint8Array(readFileSync(args.zip)),
    { id: args.id, version: args.version },
  );
  if (!result.ok) refuse(result.error);
  writeFileSync(args["manifest-out"], result.manifestText);
  writeFileSync(args["preview-out"], `${JSON.stringify(result.preview)}\n`);
} else {
  usage(
    `unknown command ${JSON.stringify(command ?? "")} — use "package" or "verify"`,
  );
}
