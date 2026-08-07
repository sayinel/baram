// §69 — 이 작업의 실제 사용자 가치. `matchFileViewer`는 먼저 등록된 뷰어를 택하고 내장은
// 설치 플러그인보다 먼저 로드되므로, 내장이 잡은 확장자는 그것을 끄지 않는 한 커뮤니티
// 뷰어가 절대 가져올 수 없었다.
import { beforeEach, describe, expect, it } from "vitest";

import { usePluginStore } from "../../stores/system/plugin";
import { deactivateBuiltin, loadBuiltinPlugins } from "../plugin-lifecycle";
import { shutdownBuiltinPlugins } from "../plugin-lifecycle";
import { matchFileViewer, usePluginUIStore } from "../plugin-ui-store";

describe("built-in viewer hand-off (§69)", () => {
  beforeEach(async () => {
    await shutdownBuiltinPlugins();
    usePluginUIStore.setState({ fileViewers: [] });
    usePluginStore.setState({ builtinDisabled: [] });
  });

  it("the built-in claims png while it is enabled", async () => {
    await loadBuiltinPlugins();
    const viewer = matchFileViewer(
      usePluginUIStore.getState().fileViewers,
      "/x/a.png",
    );
    expect(viewer?.pluginId).toBe("baram-media-viewer");
  });

  it("no viewer claims png once the built-in is deactivated", async () => {
    await loadBuiltinPlugins();
    await deactivateBuiltin("baram-media-viewer");
    expect(
      matchFileViewer(usePluginUIStore.getState().fileViewers, "/x/a.png"),
    ).toBeNull();
  });

  it("a community viewer wins png after the built-in is deactivated", async () => {
    await loadBuiltinPlugins();
    await deactivateBuiltin("baram-media-viewer");
    usePluginUIStore.getState().registerFileViewer({
      extensions: ["png"],
      onMount: () => {},
      pluginId: "third-party",
      viewerId: "third-party:img",
    });
    expect(
      matchFileViewer(usePluginUIStore.getState().fileViewers, "/x/a.png")
        ?.pluginId,
    ).toBe("third-party");
  });
});
