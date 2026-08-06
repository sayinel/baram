// §69 — 세 출처(내장·커뮤니티·개발 중)를 하나의 행 모델로 파생한다.
//
// 행이 무엇을 할 수 있는지는 `actionsFor` 한 곳에서만 결정된다. 그전에는 각 목록이 자기
// 마크업에서 개별 판단했고, 그래서 Installed 탭이 상세 화면 경로를 오래 갖지 못했고
// Updates 탭은 죽은 `onInstall` 콜백을 넘겼다.
import type { BuiltinPlugin } from "./builtin";
import type { RevocationList } from "./revocation";
import type { InstalledPlugin, PluginManifest } from "./types";

import { revocationFor } from "./revocation";

export interface PluginRow {
  /**
   * builtin: `builtinDisabled`에 없으면 true
   * community: `InstalledPlugin.enabled`
   * dev: 항상 true — 토글로 렌더되지 않는다
   */
  enabled: boolean;
  error?: string;
  /** community와 dev만 채워진다. 내장은 디스크에 설치된 것이 아니다. */
  installed?: InstalledPlugin;
  manifest: PluginManifest;
  revocation?: null | ReturnType<typeof revocationFor>;
  source: PluginSource;
  updateVersion?: string;
}

export type PluginSource = "builtin" | "community" | "dev";

export interface RowActions {
  canReload: boolean;
  canRemove: boolean;
  canToggle: boolean;
  canUpdate: boolean;
}

interface BuildRowsInput {
  builtinDisabled: string[];
  builtins: BuiltinPlugin[];
  devPlugins: Record<string, InstalledPlugin>;
  installedPlugins: Record<string, InstalledPlugin>;
  pluginErrors: Record<string, string>;
  revocations: null | RevocationList;
  updateAvailable: Record<string, string>;
}

/** §3.1의 표를 코드로 옮긴 것. 판단 지점은 여기 하나다. */
export function actionsFor(source: PluginSource): RowActions {
  switch (source) {
    case "builtin":
      // 앱 코드다. 삭제할 것도, 레지스트리에서 업데이트할 것도 없다.
      return {
        canReload: false,
        canRemove: false,
        canToggle: true,
        canUpdate: false,
      };
    case "community":
      return {
        canReload: false,
        canRemove: true,
        canToggle: true,
        canUpdate: true,
      };
    case "dev":
      // 토글이 없는 이유: Rust가 매 실행마다 목록을 받아 무조건 로드하므로 끈 상태를
      // 영속화할 자리가 없다. 대신 폴더를 제거한다.
      return {
        canReload: true,
        canRemove: true,
        canToggle: false,
        canUpdate: false,
      };
  }
}

export function buildPluginRows(input: BuildRowsInput): PluginRow[] {
  const rows: PluginRow[] = [];

  for (const { manifest } of input.builtins) {
    rows.push({
      enabled: !input.builtinDisabled.includes(manifest.id),
      error: input.pluginErrors[manifest.id],
      manifest,
      source: "builtin",
    });
  }

  for (const plugin of Object.values(input.installedPlugins)) {
    const id = plugin.manifest.id;
    rows.push({
      enabled: plugin.enabled,
      error: input.pluginErrors[id],
      installed: plugin,
      manifest: plugin.manifest,
      revocation: revocationFor(id, plugin.manifest.version, input.revocations),
      source: "community",
      updateVersion: input.updateAvailable[id],
    });
  }

  for (const plugin of Object.values(input.devPlugins)) {
    rows.push({
      enabled: true,
      error: input.pluginErrors[plugin.manifest.id],
      installed: plugin,
      manifest: plugin.manifest,
      source: "dev",
    });
  }

  return rows;
}

// ‼️ `manifestFor` (installed → dev → builtin 순으로 §5.2를 해결하는 조회 함수) is added in
// Task 5 together with its first consumer. Adding it here unexported would fail `tsc`'s
// `noUnusedLocals` (a top-level declaration with zero references in the file is a compile
// error, not just a knip finding), and exporting it early would fail knip's unused-export
// check instead — there is no version of it that sits alone in this file cleanly.
