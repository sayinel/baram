// §371 6b-2 — `plugin-release.yml` 의 `release-theme` 잡이 push 전에 하는 일을, 네트워크와 비밀 없이
// 같은 순서로 돌린다: 묶기 → 묶인 zip 다시 검증 → 색인 쓰기 → 색인 전체 검증 → 아카이브 검증.
// 워크플로의 각 단계는 여기서 부르는 스크립트를 같은 인자로 부를 뿐이다.
//
// 무엇이 이것을 실패시키는가: 한 단계가 낸 것을 다음 단계가 받지 않으면 — 예컨대 색인 스크립트가
// `plugins/` 가 아닌 곳을 `downloadUrl` 로 쓰거나(zip 은 `plugins/` 에 있다), 미리보기를 계약과
// 다른 모양으로 옮겨 적거나, checksum 이 묶인 바이트의 것이 아니면.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";

import {
  packageTheme,
  verifyThemeArchive,
} from "../../../scripts/theme-package";

const ROOT = resolve(__dirname, "../../..");
const TSX = resolve(ROOT, "node_modules/.bin/tsx");
const BASE_URL = "https://sayinel.github.io/baram-plugins/";

it("묶은 테마를 색인에 올린 레지스트리를 두 검증기가 모두 받는다", async () => {
  const packaged = await packageTheme(join(ROOT, "examples/themes/hangul"), {
    appVersion: "0.7.7",
    version: "1.0.0",
  });
  if (!packaged.ok) throw new Error(packaged.error);
  const verified = await verifyThemeArchive(packaged.bytes, {
    id: "baram-hangul",
    version: "1.0.0",
  });
  if (!verified.ok) throw new Error(verified.error);

  const registry = mkdtempSync(join(tmpdir(), "baram-theme-chain-"));
  mkdirSync(join(registry, "plugins"));
  writeFileSync(join(registry, "plugins", packaged.zipName), packaged.bytes);
  writeFileSync(join(registry, "index.json"), JSON.stringify({ plugins: [] }));
  const work = mkdtempSync(join(tmpdir(), "baram-theme-chain-work-"));
  writeFileSync(join(work, "manifest.json"), verified.manifestText);
  writeFileSync(join(work, "preview.json"), JSON.stringify(verified.preview));

  const checksum = createHash("sha256").update(packaged.bytes).digest("hex");
  const steps = [
    [
      process.execPath,
      join(ROOT, "scripts/update-registry-index.mjs"),
      "--index",
      join(registry, "index.json"),
      "--manifest",
      join(work, "manifest.json"),
      "--zip-name",
      packaged.zipName,
      "--checksum",
      checksum,
      "--base-url",
      BASE_URL,
      "--kind",
      "theme",
      "--preview",
      join(work, "preview.json"),
    ],
    [
      TSX,
      join(ROOT, "scripts/validate-index.ts"),
      join(registry, "index.json"),
    ],
    [
      TSX,
      join(ROOT, "scripts/validate-registry-assets.ts"),
      registry,
      "--base-url",
      BASE_URL,
    ],
  ];
  for (const [command, ...args] of steps) {
    const result = spawnSync(command, args, { encoding: "utf8" });
    expect(result.status, `${args[0]}\n${result.stdout}${result.stderr}`).toBe(
      0,
    );
  }
});
