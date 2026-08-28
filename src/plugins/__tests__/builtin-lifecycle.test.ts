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
  /**
   * Per-built-in disposable lists, keyed by id and handed to `createExtensionContext` as the
   * context's `subscriptions`. The SAME array object is returned every time for an id, so a
   * test can push a disposable after activation and the live context sees it.
   */
  const subscriptions: Record<string, { dispose: () => void }[]> = {};
  const subsFor = (id: string) => (subscriptions[id] ??= []);
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
    subsFor,
    subscriptions,
    unregisterPluginUI,
  };
});

vi.mock("../builtin", () => ({ BUILTIN_PLUGINS: h.FIXTURES }));

// ‼️ `plugin-lifecycle.ts` 자신은 이 모듈에서 정확히 셋만 가져오지만, `./plugin-loader`도
// 같은 barrel(`./extension-context`)에서 `setEditorSurfaceBlocked`/`registerHostCommandHandler`/
// `setEditorInstance`를 가져온다(§298 분리 이후 정의는 `plugin-host-registry.ts`에 있고
// `extension-context.ts`는 그 이름들을 re-export만 한다). 팩토리를 리터럴로 두면 그 이름들이
// 없어 import 시점에 깨진다 — `importOriginal`로 나머지를 그대로 두고 이 셋만 덮는다.
vi.mock("../extension-context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../extension-context")>()),
  // 각 내장의 `subscriptions`를 id별 고정 배열로 돌려준다 — teardown이 disposable을
  // 실제로 도는지 검사하려면 활성화 이후에 하나 밀어 넣을 수 있어야 한다.
  createExtensionContext: (manifest: { id: string }) => ({
    subscriptions: h.subsFor(manifest.id),
  }),
  emitPluginEvent: vi.fn(),
  unregisterPluginUI: h.unregisterPluginUI,
}));

// 아래 테스트 본문이 그대로 쓰도록 평범한 이름으로 풀어 둔다(호이스팅 이후 정상 순서로 실행된다).
const { activateA, activateB, deactivateA, subscriptions, unregisterPluginUI } =
  h;

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
    for (const key of Object.keys(subscriptions)) subscriptions[key].length = 0;
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

// ‼️ 실패가 호출자에게 도달하는가 (Task 7 fix round 1, Critical).
//
// `activateOne`과 `teardownBuiltin`은 모든 것을 삼켰다. 그래서 `activateBuiltin`은 활성화가
// 던져도 RESOLVE했고, `handleToggleBuiltin`의 실패 분기는 실행될 수 없는 죽은 코드였다 —
// 토글은 성공 경로로 가서 오류를 지우고, 영속되는 `builtinDisabled`는 "켜짐"이라고 남았다.
// 삼키는 동작 자체는 시작/종료에서는 여전히 옳으므로, 그것을 원하는 두 호출자로 옮겼다.
describe("built-in lifecycle failures reach the caller (§69)", () => {
  beforeEach(async () => {
    await shutdownBuiltinPlugins();
    activateA.mockReset();
    activateB.mockReset();
    deactivateA.mockReset();
    unregisterPluginUI.mockReset();
    for (const key of Object.keys(subscriptions)) subscriptions[key].length = 0;
    usePluginStore.setState({ builtinDisabled: [] });
  });

  it("rejects from activateBuiltin when activation throws", async () => {
    // 이것이 Critical의 핵심이다. 이전에는 resolve했다.
    activateA.mockRejectedValue(new Error("activate blew up"));
    await expect(activateBuiltin("fix-a")).rejects.toThrow("activate blew up");
  });

  it("does not reject at STARTUP, and still activates the others", async () => {
    // 삼키는 동작이 사라진 것이 아니라 이 호출자로 옮겨 왔다는 것. 하나가 실패해도
    // 실행이 멈추지 않아야 한다 — 이 보장이 없으면 위 수정이 시작 경로를 깨뜨린다.
    activateA.mockRejectedValue(new Error("activate blew up"));
    await expect(loadBuiltinPlugins()).resolves.toBeUndefined();
    expect(activateB).toHaveBeenCalledTimes(1);
  });

  it("rejects from deactivateBuiltin when teardown fails, having run every step", async () => {
    // ‼️ 단계별 가드가 존재하는 이유가 바로 이 property다: `deactivate`가 던져도 disposable은
    // 정리되고 UI 등록도 해제되어야 한다. 실패를 보고하게 만들면서 이것을 잃으면 안 된다.
    await loadBuiltinPlugins();
    const dispose = vi.fn(() => {
      throw new Error("dispose blew up");
    });
    subscriptions["fix-a"].push({ dispose });
    deactivateA.mockRejectedValue(new Error("deactivate blew up"));

    await expect(deactivateBuiltin("fix-a")).rejects.toThrow(
      /deactivate blew up[\s\S]*dispose blew up/,
    );
    expect(deactivateA).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(unregisterPluginUI).toHaveBeenCalledWith("fix-a");
  });

  it("reports a failing unregisterPluginUI instead of letting it escape raw", async () => {
    // 이전에는 이것만이 가드 없는 단계였다 — 유일하게 호출자에게 도달하는 실패이면서
    // 동시에 그 아래 단계가 없어 아무것도 건너뛰지 않았다. 이제 같은 수집에 들어간다.
    await loadBuiltinPlugins();
    unregisterPluginUI.mockImplementation(() => {
      throw new Error("unregister blew up");
    });
    await expect(deactivateBuiltin("fix-a")).rejects.toThrow(
      "unregister blew up",
    );
  });

  it("still tears the rest down at SHUTDOWN when one throws", async () => {
    await loadBuiltinPlugins();
    deactivateA.mockRejectedValue(new Error("deactivate blew up"));

    await expect(shutdownBuiltinPlugins()).resolves.toBeUndefined();
    expect(unregisterPluginUI).toHaveBeenCalledWith("fix-a");
    expect(unregisterPluginUI).toHaveBeenCalledWith("fix-b");
  });
});
