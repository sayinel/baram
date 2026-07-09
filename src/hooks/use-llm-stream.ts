import { useCallback, useEffect, useRef, useState } from "react";

import { listen } from "@tauri-apps/api/event";
import type { UnlistenFn } from "@tauri-apps/api/event";

import type {
  LLMDonePayload,
  LLMErrorPayload,
  LLMTokenPayload,
} from "../ipc/types";
import type { AITask } from "../stores/ai/ai";

import { llmCancel, llmComplete } from "../ipc/invoke";
import { useAIStore } from "../stores/ai/ai";
import { getConfigForTask } from "../utils/model-selection";
import { isLLMAllowed } from "../utils/privacy-check";

interface UseLLMStreamOptions {
  baseUrl?: string;
  maxTokens?: number;
  model?: string;
  provider?: string;
  task?: AITask;
}

interface UseLLMStreamReturn {
  cancel: () => void;
  error: null | string;
  isStreaming: boolean;
  send: (
    prompt: string,
    systemPrompt?: string,
    opts?: UseLLMStreamOptions,
  ) => void;
  text: string;
  totalTokens: number;
}

export function useLLMStream(): UseLLMStreamReturn {
  const [text, setText] = useState("");
  const [error, setError] = useState<null | string>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [totalTokens, setTotalTokens] = useState(0);
  const unlistenRefs = useRef<UnlistenFn[]>([]);
  const requestIdRef = useRef<null | string>(null);

  const cleanup = useCallback(async () => {
    for (const unlisten of unlistenRefs.current) {
      unlisten();
    }
    unlistenRefs.current = [];
    requestIdRef.current = null;
  }, []);

  const cancel = useCallback(() => {
    if (requestIdRef.current) {
      llmCancel(requestIdRef.current).catch(() => {});
    }
    cleanup();
    setIsStreaming(false);
  }, [cleanup]);

  const send = useCallback(
    async (
      prompt: string,
      systemPrompt?: string,
      opts?: UseLLMStreamOptions,
    ) => {
      // Cancel any existing stream
      await cleanup();

      const store = useAIStore.getState();
      const task = opts?.task ?? "chat";
      const config = getConfigForTask(task);
      const provider = opts?.provider ?? config.provider;
      const model = opts?.model ?? config.model;
      const baseUrl =
        opts?.baseUrl ?? (provider === "ollama" ? store.ollamaUrl : undefined);
      const privacyMode = store.privacyMode;

      // Privacy check
      if (!isLLMAllowed(privacyMode, provider)) {
        setError(
          "Privacy mode is active. Only local models (Ollama) are allowed.",
        );
        return;
      }

      const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      requestIdRef.current = requestId;

      setText("");
      setError(null);
      setTotalTokens(0);
      setIsStreaming(true);

      // Listen for events
      const tokenUn = await listen<LLMTokenPayload>("llm:token", (event) => {
        if (event.payload.requestId === requestId) {
          setText((prev) => prev + event.payload.token);
        }
      });

      const doneUn = await listen<LLMDonePayload>("llm:done", (event) => {
        if (event.payload.requestId === requestId) {
          setTotalTokens(event.payload.totalTokens ?? 0);
          setIsStreaming(false);
          cleanup();
        }
      });

      const errorUn = await listen<LLMErrorPayload>("llm:error", (event) => {
        if (event.payload.requestId === requestId) {
          setError(event.payload.error);
          setIsStreaming(false);
          cleanup();
        }
      });

      unlistenRefs.current = [tokenUn, doneUn, errorUn];

      // Invoke Rust backend
      try {
        await llmComplete(
          prompt,
          model,
          requestId,
          systemPrompt,
          opts?.maxTokens,
          provider,
          baseUrl,
          privacyMode,
        );
      } catch (e) {
        setError(String(e));
        setIsStreaming(false);
        cleanup();
      }
    },
    [cleanup],
  );

  // Unmount cleanup — unlisten any active event listeners if component is torn down mid-stream
  useEffect(() => {
    return () => {
      for (const unlisten of unlistenRefs.current) {
        unlisten();
      }
      unlistenRefs.current = [];
      requestIdRef.current = null;
    };
  }, []);

  return { send, cancel, isStreaming, text, error, totalTokens };
}
