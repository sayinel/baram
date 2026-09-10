// §69 Plugin AI Policy — privacy mode + model/provider selection, shared by both
// trust tiers.
//
// Exported (§260 3c-2c) so the SANDBOXED tier's host-mediated `ai` runs the very
// same policy — privacy mode, per-task model/provider, `createLLMStream` cleanup in
// `finally`. A separate implementation for the sandbox would be a second place for
// privacy mode to be forgotten. See `sandbox/host-ai-bridge.ts`.
//
// A tier-named file (e.g. `trusted/ai-api.ts`) would misdescribe this: both tiers call
// `createAIAPI` directly, so "policy shared by both tiers" is the accurate name.
import type { AIAPI, AICompleteOptions } from "./types";

import { llmComplete, llmListModels } from "../ipc/llm";
import { useAIStore } from "../stores/ai/ai";
import { createLLMStream } from "../utils/llm-stream";
import { getConfigForTask } from "../utils/model-selection";
import { isLLMAllowed } from "../utils/privacy-check";

export function createAIAPI(pluginId: string): AIAPI {
  const start = async (
    prompt: string,
    opts: AICompleteOptions | undefined,
    onToken: (t: string) => void,
  ): Promise<void> => {
    const cfg = getConfigForTask("chat");
    const { aiEnabled, privacyMode } = useAIStore.getState();
    if (!isLLMAllowed(aiEnabled, privacyMode, cfg.provider)) {
      throw new Error(
        aiEnabled
          ? "Privacy mode is active — only local (Ollama) models are allowed."
          : "AI is disabled.",
      );
    }
    const requestId = `plugin-${pluginId}-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    let resolveDone: () => void;
    let rejectDone: (e: unknown) => void;
    const done = new Promise<void>((res, rej) => {
      resolveDone = res;
      rejectDone = rej;
    });
    const cleanup = await createLLMStream(requestId, {
      onToken,
      onDone: () => resolveDone(),
      onError: (e) => rejectDone(new Error(e)),
    });
    try {
      await llmComplete(
        prompt,
        cfg.model,
        requestId,
        opts?.systemPrompt,
        opts?.maxTokens,
        cfg.provider,
        cfg.baseUrl,
        privacyMode,
      );
      await done;
    } finally {
      cleanup();
    }
  };
  return {
    async complete(prompt, opts) {
      let buffer = "";
      await start(prompt, opts, (t) => {
        buffer += t;
      });
      return buffer;
    },
    async listModels() {
      // ‼️ §339 — `start` 와 같은 kill switch 를 여기서도 본다. 이 함수는 문서 내용을
      // 내보내지 않으므로 프라이버시 영향은 없지만, `ai` 권한을 가진 플러그인이
      // **AI 를 끈 상태에서** 앱으로 하여금 설정된 프로바이더에 요청을 보내게 할 수
      // 있었다(키는 keyring 에서 Rust 가 붙인다). Rust 쪽 백스톱은 privacy mode 뿐이고
      // `aiEnabled` 는 프런트 전용 개념이라 2층 방어가 없다 — 그래서 여기서 막는다.
      const { aiEnabled } = useAIStore.getState();
      if (!aiEnabled) throw new Error("AI is disabled.");
      const cfg = getConfigForTask("chat");
      const models = await llmListModels(cfg.provider, cfg.baseUrl);
      return models.map((m) => ({ id: m.id, name: m.name }));
    },
    async stream(prompt, opts, onToken) {
      await start(prompt, opts, onToken);
    },
  };
}
