// §69 — 세 출처(내장·커뮤니티·개발 중)를 하나의 행 모델로 파생한다.
//
// 행이 무엇을 할 수 있는지는 `actionsFor` 한 곳에서만 결정된다. 그전에는 각 목록이 자기
// 마크업에서 개별 판단했고, 그래서 Installed 탭이 상세 화면 경로를 오래 갖지 못했고
// Updates 탭은 죽은 `onInstall` 콜백을 넘겼다.
import type { BuiltinPlugin } from "./builtin";
import type { RevocationList } from "./revocation";
import type { InstalledPlugin, PluginManifest, RegistryEntry } from "./types";

import { BUILTIN_PLUGINS } from "./builtin";
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

/**
 * §69 한 pluginId의 출처. `selectManifest`와 **같은 순서**로 판단한다 — 두 함수가 다른
 * 순서를 쓰면 한 화면이 A의 매니페스트에 B의 액션 표를 붙인다.
 *
 * 어디에도 없으면 `community`: 아직 설치하지 않은 레지스트리 리스팅이 그 경우이고,
 * 커뮤니티가 정확히 그 뜻이다(`PluginDetail`의 기본값과 동일).
 */
export function derivePluginSource(
  sources: {
    devPlugins: Record<string, InstalledPlugin>;
    installedPlugins: Record<string, InstalledPlugin>;
  },
  pluginId: string,
): PluginSource {
  if (sources.installedPlugins[pluginId]) return "community";
  if (sources.devPlugins[pluginId]) return "dev";
  if (BUILTIN_PLUGINS.some((b) => b.manifest.id === pluginId)) return "builtin";
  return "community";
}

/**
 * 설치된 매니페스트로부터 상세 화면이 읽는 모양을 합성한다.
 *
 * `downloadUrl`은 비어 있다. `handleUpdate`가 리스팅을 재해석하므로(§260 Phase 5 코드
 * 리뷰 H2) 그것을 신뢰하지 않고, 비어 있는 값이 "이 화면에서 받을 것은 없다"를 말한다.
 */
export function entryFromManifest(
  manifest: PluginManifest,
  checksum = "",
): RegistryEntry {
  return { ...manifest, checksum, downloadUrl: "", downloads: undefined };
}

/**
 * 한 pluginId의 매니페스트. installed → dev → builtin 순.
 *
 * ‼️ §5.2 — 내장은 `installedPlugins`에 들어가지 않으므로, `installedPlugins[id] ?? devPlugins[id]`
 * 만 보는 코드는 내장에 대해 조용히 `undefined`를 받는다. `PluginSettingsForm`이 정확히 그랬고
 * (오류 없이 폼이 안 그려짐), 그것이 이 함수가 존재하는 이유다.
 *
 * ‼️ 셀렉터 형태인 것이 핵심이다: 호출자가 `useShallow` 안에서 부르면 구독이 유지된다.
 * `getState()`로 읽는 형태였다면 dev 플러그인 다시 로드가 매니페스트를 교체해도 열려 있는
 * 폼이 갱신되지 않는다. 스토어 타입은 export되지 않으므로 필요한 두 필드만 구조적으로 받는다.
 */
export function selectManifest(
  sources: {
    devPlugins: Record<string, InstalledPlugin>;
    installedPlugins: Record<string, InstalledPlugin>;
  },
  pluginId: string,
): PluginManifest | undefined {
  return (
    sources.installedPlugins[pluginId]?.manifest ??
    sources.devPlugins[pluginId]?.manifest ??
    BUILTIN_PLUGINS.find((b) => b.manifest.id === pluginId)?.manifest
  );
}
