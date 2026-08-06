// §69 — 내장을 하나씩 켜고 끈다. 지금까지 `loadBuiltinPlugins`는 무조건 전부 로드했고
// `shutdownBuiltinPlugins`는 `activeBuiltins.splice(0)`로 전부 비우는 것뿐이었다.
//
// ‼️ `BuiltinPlugin` 타입은 import하지 않는다 — 픽스처는 `vi.hoisted` 안에서 만들고 캐스트가
// 필요 없으므로, import하면 `noUnusedLocals`와 lint가 둘 다 잡는다.
import { beforeEach, describe, expect, it, vi } from "vitest";

// ‼️ `vi.hoisted` — `vi.mock`은 import 위로 호이스팅되므로 팩토리가 실행될 때 평범한
// 최상위 `const FIXTURES`는 아직 초기화되지 않았다(TDZ 오류). 값을 즉시 평가하는
// 팩토리(`BUILTIN_PLUGINS: FIXTURES`)는 특히 그렇다 — 참조를 화살표 함수 안으로 미루는
// 형태와 달리 회피할 수 없다. 이 저장소의 관례이기도 하다: `plugin-lifecycle.errors.test.ts`,
// `tauri-sandbox-transport.test.ts` 등이 같은 이유로 `vi.hoisted`를 쓴다.
const h = vi.hoisted(() => {
  const builtinManifest = (id: string, name: string) => ({
    author: "Baram",
    capabilities: [],
    description: id,
    engines: { baram: ">=0.5.0" },
    id,
    license: "Apache-2.0",
    main: "(builtin)",
    name,
    trust: "trusted",
    version: "1.0.0",
  });
  const activateA = vi.fn();
  const activateB = vi.fn();
  const deactivateA = vi.fn();
  const unregisterPluginUI = vi.fn();
  return {
    activateA,
    activateB,
    deactivateA,
    FIXTURES: [
      {
        manifest: builtinManifest("fix-a", "Fixture A"),
        module: { activate: activateA, deactivate: deactivateA },
      },
      {
        manifest: builtinManifest("fix-b", "Fixture B"),
        module: { activate: activateB },
      },
    ],
    unregisterPluginUI,
  };
});

vi.mock("../builtin", () => ({ BUILTIN_PLUGINS: h.FIXTURES }));

// ‼️ `plugin-lifecycle.ts` 자신은 이 모듈에서 정확히 셋만 가져오지만, `./plugin-loader`가
// 물고 들어오는 `sandbox/host-ai-bridge.ts`가 같은 모듈의 `createAIAPI`를 쓴다(둘 다
// `../extension-context`로 같은 파일을 resolve). 팩토리를 리터럴로 두면 그 이름이 없어
// import 시점에 깨진다 — `importOriginal`로 나머지를 그대로 두고 이 셋만 덮는다.
vi.mock("../extension-context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../extension-context")>()),
  createExtensionContext: () => ({ subscriptions: [] }),
  emitPluginEvent: vi.fn(),
  unregisterPluginUI: h.unregisterPluginUI,
}));

// 아래 테스트 본문이 그대로 쓰도록 평범한 이름으로 풀어 둔다(호이스팅 이후 정상 순서로 실행된다).
const { activateA, activateB, deactivateA, unregisterPluginUI } = h;

import { usePluginStore } from "../../stores/system/plugin";
import {
  activateBuiltin,
  deactivateBuiltin,
  loadBuiltinPlugins,
  shutdownBuiltinPlugins,
} from "../plugin-lifecycle";

describe("built-in lifecycle (§69)", () => {
  beforeEach(async () => {
    await shutdownBuiltinPlugins(); // 이전 테스트의 활성 상태를 비운다
    activateA.mockReset();
    activateB.mockReset();
    deactivateA.mockReset();
    unregisterPluginUI.mockReset();
    usePluginStore.setState({ builtinDisabled: [] });
  });

  it("activates every built-in when none is disabled", async () => {
    await loadBuiltinPlugins();
    expect(activateA).toHaveBeenCalledTimes(1);
    expect(activateB).toHaveBeenCalledTimes(1);
  });

  it("skips a disabled built-in at startup", async () => {
    usePluginStore.setState({ builtinDisabled: ["fix-a"] });
    await loadBuiltinPlugins();
    expect(activateA).not.toHaveBeenCalled();
    expect(activateB).toHaveBeenCalledTimes(1);
  });

  it("activates a built-in the disabled list does not name", async () => {
    // ‼️ disabled 목록 방식의 핵심 보장: 다음 릴리스가 내장을 추가해도 기본 켜짐이다.
    // enabled 맵이었다면 새 id가 맵에 없어서 꺼진 것으로 읽혔을 것이다.
    usePluginStore.setState({ builtinDisabled: ["some-old-id"] });
    await loadBuiltinPlugins();
    expect(activateA).toHaveBeenCalledTimes(1);
    expect(activateB).toHaveBeenCalledTimes(1);
  });

  it("deactivates only the named built-in", async () => {
    await loadBuiltinPlugins();
    await deactivateBuiltin("fix-a");
    expect(deactivateA).toHaveBeenCalledTimes(1);
    expect(unregisterPluginUI).toHaveBeenCalledWith("fix-a");
    expect(unregisterPluginUI).not.toHaveBeenCalledWith("fix-b");
  });

  it("re-activates after a deactivate", async () => {
    // 한 방향만 테스트하면 재활성 경로가 죽어도 통과한다.
    await loadBuiltinPlugins();
    await deactivateBuiltin("fix-a");
    activateA.mockClear();
    await activateBuiltin("fix-a");
    expect(activateA).toHaveBeenCalledTimes(1);
  });

  it("is a no-op to activate one that is already active", async () => {
    await loadBuiltinPlugins();
    await activateBuiltin("fix-a");
    expect(activateA).toHaveBeenCalledTimes(1);
  });

  it("is a no-op to deactivate one that is not active", async () => {
    await deactivateBuiltin("fix-a");
    expect(deactivateA).not.toHaveBeenCalled();
  });

  it("still tears every built-in down on shutdown", async () => {
    await loadBuiltinPlugins();
    await shutdownBuiltinPlugins();
    expect(unregisterPluginUI).toHaveBeenCalledWith("fix-a");
    expect(unregisterPluginUI).toHaveBeenCalledWith("fix-b");
  });
});
