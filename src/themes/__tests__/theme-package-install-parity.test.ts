// 스펙 0063 §5.3 · §5.4 — 찾아보기 카드의 그림 = 설치 뒤 갤러리 카드의 그림.
//
// 게시 단계가 색인에 싣는 미리보기(`verifyThemeArchive`)와, **같은 아카이브**를 앱의 파일 설치
// 경로(`installStagedThemeFromFile`)로 넣은 뒤 갤러리가 그리는 팔레트(`themePreviewPalettes`)가
// 같아야 한다. 스테이징은 Rust 의 몫이라 여기서는 흉내 낸다 — 흉내는 아카이브의 항목을 **그대로**
// 돌려줄 뿐이고, 색을 읽는 것은 앱의 코드다.
//
// 무엇이 이것을 실패시키는가: 게시 단계가 설치 경로와 다른 파일에서 한 모드의 색을 읽으면
// (실측: `verifyThemeArchive` 가 모드와 토큰 파일의 짝을 뒤바꾸자 이 케이스가 빨갰다). 별칭 채우기나
// 기본 팔레트로 메우는 규칙이 어긋나는 것은 이 테마로는 보이지 않는다 — 두 모드의 토큰이 미리보기
// 16키를 모두 싣고, 그 16키는 전부 별칭 없는 시드다. 그쪽은 `theme-tokens.test.ts` 가 본다.

import { Uint8ArrayReader, Uint8ArrayWriter, ZipReader } from "@zip.js/zip.js";
import { resolve } from "node:path";
import { expect, it, vi } from "vitest";

const themeStageRead =
  vi.fn<(stageId: string, path: string) => Promise<Uint8Array>>();
const appVersion = vi.hoisted(() => vi.fn(() => Promise.resolve("0.7.7")));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: appVersion }));
vi.mock("../../ipc/theme", () => ({
  themeInstallCommit: vi.fn(() =>
    Promise.resolve({
      id: "baram-hangul",
      install_path: "/home/u/.baram/themes/baram-hangul",
    }),
  ),
  themeInstallDiscard: vi.fn(() => Promise.resolve()),
  themeInstallStage: vi.fn(),
  themeReadStoredCss: vi.fn(),
  themeStageRead: (stageId: string, path: string) =>
    themeStageRead(stageId, path),
}));

import {
  packageTheme,
  verifyThemeArchive,
} from "../../../scripts/theme-package";
import { installedThemeToDef } from "../installed-theme-defs";
import { installStagedThemeFromFile } from "../theme-install";
import { themePreviewPalettes } from "../theme-preview-palette";

it("게시가 색인에 싣는 미리보기 = 같은 zip 을 파일로 설치한 뒤 갤러리가 그리는 팔레트", async () => {
  const packaged = await packageTheme(
    resolve(__dirname, "../../../examples/themes/hangul"),
    { appVersion: "0.7.7", version: "1.0.0" },
  );
  if (!packaged.ok) throw new Error(packaged.error);
  const published = await verifyThemeArchive(packaged.bytes, {
    id: "baram-hangul",
    version: "1.0.0",
  });
  if (!published.ok) throw new Error(published.error);

  const entries = new Map<string, Uint8Array>();
  const reader = new ZipReader(new Uint8ArrayReader(packaged.bytes));
  for (const entry of await reader.getEntries()) {
    if (!entry.directory) {
      entries.set(entry.filename, await entry.getData(new Uint8ArrayWriter()));
    }
  }
  await reader.close();
  themeStageRead.mockImplementation((_stage, path) => {
    const found = entries.get(path);
    return found === undefined
      ? Promise.reject(new Error(`no such file: ${path}`))
      : Promise.resolve(found);
  });

  const result = await installStagedThemeFromFile({
    checksum: "c".repeat(64),
    manifest: new TextDecoder().decode(entries.get("baram-theme.json")),
    manifest_sha256: "d".repeat(64),
    stage_id: "stage-1",
  });
  expect(result.ok).toBe(true);
  if (!result.ok) return;

  expect(themePreviewPalettes(installedThemeToDef(result.installed))).toEqual(
    published.preview,
  );
});
