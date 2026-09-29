/**
 * §371 6b-2 — 테마 패키지를 만들고(`packageTheme`), 만든 아카이브를 다시 읽어 검증한다
 * (`verifyThemeArchive`). 스펙 0063 §7.3 · §7.5.
 *
 * 부르는 곳은 둘이다 — `plugin-release.yml` 의 `release-theme` 잡과, 게시 전 파일 설치 점검
 * (§7.5). 둘 다 `run-theme-package.ts` 를 지난다. **같은 원본은 같은 바이트가 된다**: 무압축
 * (`level: 0`)에 고정 시각(`ZIP_DATE`)이고 확장 타임스탬프를 끄므로(`extendedTimestamp: false` — 켜면
 * 그 시각을 UTC 로 따로 적는다, `ZIP_DATE` 주석) zlib 판본 · 시간대 · 파일 시각이 끼어들 자리가 없다.
 * `theme-package-script.test.ts` 의 "같은 원본은 같은 바이트가 된다" 가 그 셋을 항목마다 본다. 남는
 * 변수는 zip 을 쓰는 `@zip.js/zip.js` 의 판본 하나이고, `package.json` 이 그것을 캐럿 없이
 * 고정한다. 그래서 같은 커밋에서 만든 로컬 zip 의 sha256 이 게시된 항목의 `checksum` 과 같고,
 * 점검한 파일이 곧 게시된 파일이다.
 *
 * ‼️ 테마 내용은 **실행하지 않는다**. 이 파일이 읽는 것은 매니페스트와 매니페스트가 선언한
 * 파일뿐이고, 그 경로가 테마 폴더를 벗어나지 못하게 한다 — 경로의 모양은 `themePackageFiles`,
 * 읽기는 `readThemeFile` 이 가두고, 매니페스트도 그 관문을 지난 뒤에야 읽힌다. 폴더 자체가
 * 심볼릭 링크면 거부한다(`packageTheme`). 보지 않는 것: 폴더의 **조상** 경로의 링크 — 마지막
 * 마디만 `lstat` 한다(`theme-release-workflow.test.ts` 의 합성 루트가 `examples` 를 링크하고,
 * macOS 의 임시 폴더는 `/var` 링크 밑에 있다).
 */
import type { ThemeManifest } from "../src/themes/theme-manifest";
import type { PreviewPalettes } from "../src/themes/theme-preview-palette";
import type { ThemeMode } from "../src/types/theme";

import {
  configure,
  Uint8ArrayReader,
  Uint8ArrayWriter,
  ZipReader,
  ZipWriter,
} from "@zip.js/zip.js";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { resolve, sep } from "node:path";

import { parseBaramFloor } from "../src/plugins/engines";
import { compareVersions } from "../src/plugins/version-range";
import { parseThemeManifestText } from "../src/themes/theme-install";
import {
  previewPaletteFrom,
  registryPreviewPalettes,
} from "../src/themes/theme-preview-palette";
import { parseThemeTokens } from "../src/themes/theme-tokens";
import { RESERVED_THEME_IDS, THEME_MODES } from "../src/types/theme";

configure({ useWebWorkers: false });

export const THEME_MANIFEST = "baram-theme.json";

/**
 * zip 에 적는 시각. **로컬 시각으로 만든다** — zip 의 DOS 시각은 만드는 쪽의 로컬 벽시계로
 * 적히므로 `Date.UTC(…)` 로 만든 고정 시각은 시간대마다 다른 바이트가 된다(실측: UTC ·
 * Asia/Seoul 에서 sha256 이 갈렸다). 로컬 생성자는 어느 시간대에서든 같은 연월일시를 준다.
 *
 * 그래서 `packageTheme` 은 확장 타임스탬프를 끈다(`extendedTimestamp: false`). 그 extra field
 * (`0x5455`)는 이 시각을 UTC 기준 초로 따로 적으므로, 로컬 생성자로 만든 이 값이 시간대마다 다른
 * 바이트가 된다 — 2026-09-29 실측: 켜고 `TZ` 를 UTC · America/Los_Angeles · Asia/Seoul 로 두어
 * `examples/themes/hangul` 을 묶은 zip 의 sha256 셋이 서로 달랐고, 끄면 셋이 같았다.
 */
const ZIP_DATE = new Date(2020, 0, 1, 12, 0, 0);

/** 매니페스트가 선언할 수 있는 경로의 한 마디. `.` · `..` 는 따로 막는다. */
const PATH_SEGMENT_RE = /^[A-Za-z0-9._-]+$/;

export interface PackagedTheme {
  bytes: Uint8Array;
  /** zip 에 든 파일, 든 순서 그대로. 첫째는 늘 `baram-theme.json`. */
  files: readonly string[];
  manifest: ThemeManifest;
  ok: true;
  zipName: string;
}

export interface Refusal {
  error: string;
  ok: false;
}

export interface VerifiedTheme {
  manifest: ThemeManifest;
  /** 아카이브에서 꺼낸 매니페스트 원문 — 색인은 이것으로 쓴다. */
  manifestText: string;
  ok: true;
  preview: PreviewPalettes;
}

const refuse = (error: string): Refusal => ({ error, ok: false });

/**
 * 매니페스트가 선언한 파일 → zip 에 넣을 목록. 매니페스트가 첫째, 모드는 `THEME_MODES` 순서,
 * 두 모드가 같은 파일을 가리키면 한 번.
 *
 * CSS 를 선언한 테마는 거부한다 — 테마 CSS 는 `url()` 로 패키지 안의 다른 파일을 끌어 오고
 * (`inline-assets.ts`), 그 파일을 목록에 올리는 규칙이 이 파이프라인에 아직 없다. 빼고 묶으면
 * 설치가 자산을 못 찾는 zip 이 조용히 나간다.
 */
export function themePackageFiles(
  manifest: ThemeManifest,
): Refusal | { files: string[]; ok: true } {
  const files = [THEME_MANIFEST];
  for (const mode of THEME_MODES) {
    const assets = manifest.modes[mode];
    if (assets === undefined) continue;
    if (assets.css !== undefined && assets.css !== "") {
      return refuse(
        `modes.${mode}.css is declared — this pipeline publishes token-only themes; a theme's CSS pulls other package files through url(), and nothing here lists those yet`,
      );
    }
    const path = assets.tokens;
    if (path === undefined || path === "") continue;
    const problem = pathProblem(path);
    if (problem !== null) return refuse(`modes.${mode}.tokens ${problem}`);
    if (!files.includes(path)) files.push(path);
  }
  if (files.length === 1) {
    return refuse("the manifest declares no tokens file in any mode");
  }
  return { files, ok: true };
}

function pathProblem(path: string): null | string {
  const segments = path.split("/");
  const bad = segments.find(
    (segment) =>
      segment === "." || segment === ".." || !PATH_SEGMENT_RE.test(segment),
  );
  return bad === undefined
    ? null
    : `${JSON.stringify(path)} must be a relative path of [A-Za-z0-9._-] segments, without . or ..`;
}

/**
 * 게시하려는 테마의 하한을 **지금 앱 버전**이 만족하는가 — 만족하지 않으면 그 이유.
 *
 * `plugin-release.yml` 의 플러그인 meta 단계와 같은 규칙이고 같은 방향으로 닫힌다: 앱 버전이
 * 프리릴리스이거나 읽을 수 없으면 거부한다(`0.7.7-beta.1` 은 하한을 싣는 릴리스가 아니다).
 * 규칙 자체는 앱의 것이다 — `parseBaramFloor` 와 `compareVersions`.
 */
export function releaseFloorProblem(
  appVersion: string,
  range: string,
): null | string {
  if (!/^\d+\.\d+\.\d+$/.test(appVersion)) {
    return `app version ${JSON.stringify(appVersion)} is not a plain release version`;
  }
  const floor = parseBaramFloor(range);
  if (floor === null) {
    return `engines.baram ${JSON.stringify(range)} must be of the form ">=X.Y.Z"`;
  }
  const cmp = compareVersions(appVersion, floor);
  if (cmp === null) {
    return `cannot compare app version ${appVersion} with engines.baram ${range}`;
  }
  return cmp < 0
    ? `app version ${appVersion} does not satisfy this theme's engines.baram (${range}) — release the app first`
    : null;
}

/**
 * `dir` 의 테마를 zip 으로. `expected.version` 은 태그의 버전, `expected.appVersion` 은 게시하는
 * 커밋의 `package.json` 버전이다.
 */
export async function packageTheme(
  dir: string,
  expected: { appVersion: string; version: string },
): Promise<PackagedTheme | Refusal> {
  const root = resolve(dir);
  // 폴더 자체가 링크면 그 너머 전체가 "폴더 안" 이 된다 — `readThemeFile` 은 실제 경로를 폴더의
  // **실제** 경로와 비교하므로 링크된 폴더를 막지 못한다.
  let rootStat;
  try {
    rootStat = lstatSync(root);
  } catch {
    return refuse(`no theme directory at ${dir}`);
  }
  if (rootStat.isSymbolicLink()) {
    return refuse(
      `${dir} is a symbolic link — pass the theme directory itself, not a link to it`,
    );
  }
  let realRoot: string;
  try {
    realRoot = realpathSync(root);
  } catch {
    return refuse(`no theme directory at ${dir}`);
  }
  const folder = { dir, realRoot, root };
  // 매니페스트를 관문 **다음에**, 한 번만 읽는다 — 파싱하는 바이트가 곧 묶는 바이트다.
  const read = readThemeFile(
    folder,
    THEME_MANIFEST,
    `no ${THEME_MANIFEST} in ${dir}`,
  );
  if (!read.ok) return read;
  const manifestBytes = read.bytes;
  let text: string;
  try {
    // `ignoreBOM: true` 는 BOM 을 떼지 않고 파서에 넘긴다(그래서 거부된다). 앱의 스테이징은
    // 매니페스트를 `read_to_string` 으로 읽어 `serde_json::from_str` 에 넘기고
    // (`src-tauri/src/plugin/install.rs`), serde_json 은 BOM 을 공백으로 읽지 않는다 — 기본
    // `TextDecoder` 처럼 BOM 을 떼면 앱이 설치하지 못하는 매니페스트가 여기를 지난다.
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      manifestBytes,
    );
  } catch {
    return refuse(`${THEME_MANIFEST} is not valid UTF-8`);
  }
  const parsed = parseThemeManifestText(text);
  if (!parsed.valid) {
    return refuse(
      `${THEME_MANIFEST} is invalid: ${parsed.errors.map((e) => `${e.field}: ${e.message}`).join("; ")}`,
    );
  }
  const manifest = parsed.manifest;
  if (RESERVED_THEME_IDS.has(manifest.id)) {
    return refuse(
      `id ${JSON.stringify(manifest.id)} is reserved for a built-in theme — the app refuses to install it`,
    );
  }
  if (manifest.version !== expected.version) {
    return refuse(
      `tag version ${expected.version} != manifest version ${manifest.version}`,
    );
  }
  const floor = releaseFloorProblem(
    expected.appVersion,
    manifest.engines.baram,
  );
  if (floor !== null) return refuse(floor);

  const listed = themePackageFiles(manifest);
  if (!listed.ok) return listed;

  // 첫째는 늘 매니페스트다(`themePackageFiles`) — 위에서 읽은 그 바이트를 그대로 묶는다.
  const contents: Uint8Array[] = [manifestBytes];
  for (const file of listed.files.slice(1)) {
    const declared = readThemeFile(
      folder,
      file,
      `${JSON.stringify(file)} is declared but not present in ${dir}`,
    );
    if (!declared.ok) return declared;
    const problem = tokensProblem(file, declared.bytes);
    if (problem !== null) return refuse(problem);
    contents.push(declared.bytes);
  }

  const writer = new ZipWriter(new Uint8ArrayWriter(), {
    dataDescriptor: false,
    extendedTimestamp: false,
    lastModDate: ZIP_DATE,
    level: 0,
  });
  for (const [i, file] of listed.files.entries()) {
    await writer.add(file, new Uint8ArrayReader(contents[i]));
  }
  const bytes = await writer.close();
  return {
    bytes,
    files: listed.files,
    manifest,
    ok: true,
    zipName: `${manifest.id}-${manifest.version}.zip`,
  };
}

/**
 * 테마 폴더 안의 파일 하나를 읽는다 — 매니페스트도, 매니페스트가 선언한 파일도 이 관문을 지난다.
 * 폴더 밖으로 풀리는 경로 · 일반 파일이 아닌 것(`lstat` — 심볼릭 링크를 따라가지 않는다) · 실제
 * 경로가 폴더의 실제 경로 밖인 것을 거부한다. `missing` 은 파일이 없을 때의 거부 문구다.
 */
function readThemeFile(
  folder: { dir: string; realRoot: string; root: string },
  file: string,
  missing: string,
): Refusal | { bytes: Uint8Array; ok: true } {
  const full = resolve(folder.root, file);
  if (!full.startsWith(folder.root + sep)) {
    return refuse(`${JSON.stringify(file)} resolves outside ${folder.dir}`);
  }
  let stat;
  try {
    stat = lstatSync(full);
  } catch {
    return refuse(missing);
  }
  if (!stat.isFile()) {
    return refuse(
      `${JSON.stringify(file)} is not a regular file (symlinks are not followed)`,
    );
  }
  // `lstat` 은 마지막 마디만 본다 — `light/` 가 폴더 밖을 가리키는 링크면 `light/tokens.json` 은
  // 일반 파일로 보이면서 밖을 읽는다. 실제 경로로 한 번 더 가둔다.
  if (!realpathSync(full).startsWith(folder.realRoot + sep)) {
    return refuse(
      `${JSON.stringify(file)} resolves outside ${folder.dir} through a linked directory`,
    );
  }
  return { bytes: new Uint8Array(readFileSync(full)), ok: true };
}

function tokensProblem(file: string, bytes: Uint8Array): null | string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
  } catch {
    return `${JSON.stringify(file)} is not valid UTF-8 JSON`;
  }
  const result = parseThemeTokens(parsed);
  if (result.ok) return null;
  return result.key === null
    ? `${JSON.stringify(file)} is not a JSON object of colours`
    : `${JSON.stringify(file)} has no usable value for ${result.key} — the app would install this mode without its colours`;
}

/**
 * 아카이브 바이트를 다시 읽어, 그것이 검증한 테마인지 본다 — 그리고 색인이 실을 매니페스트와
 * 미리보기를 **그 바이트에서** 꺼낸다(플러그인 잡의 "Verify the packaged artifact" 와 같은 이유:
 * 게시되는 항목과 게시되는 파일이 구성으로 일치한다).
 *
 * 파일 목록은 매니페스트에서 다시 계산한 목록과 **정확히** 같아야 한다 — 빠진 것도 남는 것도 없이.
 */
export async function verifyThemeArchive(
  bytes: Uint8Array,
  expected: { id: string; version: string },
): Promise<Refusal | VerifiedTheme> {
  const reader = new ZipReader(new Uint8ArrayReader(bytes), {
    checkOverlappingEntry: true,
    checkSignature: true,
    strictness: "strict",
  });
  try {
    let entries;
    try {
      entries = await reader.getEntries();
    } catch (err) {
      return refuse(`not a readable ZIP archive (${String(err)})`);
    }
    const found = new Map<string, Uint8Array>();
    for (const entry of entries) {
      if (entry.directory) {
        return refuse(
          `the archive holds a directory entry ${JSON.stringify(entry.filename)}`,
        );
      }
      // 방어로 남긴다 — 위의 `strictness: "strict"` 에서 zip.js 2.18.2 의 `getEntries` 는 같은 이름이
      // 둘인 아카이브에 `Ambiguous archive`(reason `duplicate filename`)를 던져, 이 줄에 닿기 전에 위의
      // catch 가 거부한다. strict 를 풀거나 zip.js 가 바뀌면 이 줄이 그 자리를 맡는다.
      if (found.has(entry.filename)) {
        return refuse(
          `the archive holds ${JSON.stringify(entry.filename)} twice`,
        );
      }
      found.set(entry.filename, await entry.getData(new Uint8ArrayWriter()));
    }
    const manifestBytes = found.get(THEME_MANIFEST);
    if (manifestBytes === undefined) {
      return refuse(`the archive has no ${THEME_MANIFEST} at its root`);
    }
    let manifestText: string;
    try {
      manifestText = new TextDecoder("utf-8", { fatal: true }).decode(
        manifestBytes,
      );
    } catch {
      return refuse(`the packaged ${THEME_MANIFEST} is not valid UTF-8`);
    }
    const parsed = parseThemeManifestText(manifestText);
    if (!parsed.valid) {
      return refuse(
        `the packaged ${THEME_MANIFEST} is invalid: ${parsed.errors.map((e) => `${e.field}: ${e.message}`).join("; ")}`,
      );
    }
    const manifest = parsed.manifest;
    if (manifest.id !== expected.id) {
      return refuse(
        `the archive contains theme '${manifest.id}' but '${expected.id}' was verified`,
      );
    }
    if (manifest.version !== expected.version) {
      return refuse(
        `the archive contains version '${manifest.version}' but '${expected.version}' was verified`,
      );
    }
    const listed = themePackageFiles(manifest);
    if (!listed.ok) return listed;
    const actual = [...found.keys()].sort();
    const declared = [...listed.files].sort();
    if (JSON.stringify(actual) !== JSON.stringify(declared)) {
      return refuse(
        `the archive holds ${JSON.stringify(actual)} but the manifest declares ${JSON.stringify(declared)}`,
      );
    }

    const preview: {
      dark?: ReturnType<typeof previewPaletteFrom>;
      light?: ReturnType<typeof previewPaletteFrom>;
    } = {};
    for (const mode of THEME_MODES) {
      const path = manifest.modes[mode]?.tokens;
      if (path === undefined || path === "") continue;
      const bytesOf = found.get(path) as Uint8Array;
      const problem = tokensProblem(path, bytesOf);
      if (problem !== null) return refuse(problem);
      const result = parseThemeTokens(
        JSON.parse(new TextDecoder().decode(bytesOf)),
      );
      if (result.ok)
        preview[mode as ThemeMode] = previewPaletteFrom(result.colors, mode);
    }
    // 앱이 레지스트리에서 받아들이는 모양인지, 앱의 함수로 — 틀리면 찾아보기 카드가 미리보기를 버린다.
    if (registryPreviewPalettes(preview) === undefined) {
      return refuse(
        "the extracted preview does not pass the app's registry preview contract",
      );
    }
    return { manifest, manifestText, ok: true, preview };
  } finally {
    await reader.close();
  }
}
