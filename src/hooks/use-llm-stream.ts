import { useState, useRef, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { llmComplete, llmCancel } from "../ipc/invoke";
import { useAIStore } from "../stores/ai-store";
import type { AITask } from "../stores/ai-store";
import { isLLMAllowed } from "../utils/privacy-check";
import { getModelForTask } from "../utils/model-selection";
import type {
  LLMTokenPayload,
  LLMDonePayload,
  LLMErrorPayload,
} from "../ipc/types";

interface UseLLMStreamOptions {
  model?: string;
  maxTokens?: number;
  provider?: string;
  baseUrl?: string;
  task?: AITask;
}

interface UseLLMStreamReturn {
  send: (
    prompt: string,
    systemPrompt?: string,
    opts?: UseLLMStreamOptions,
  ) => void;
  cancel: () => void;
  isStreaming: boolean;
  text: string;
  error: string | null;
  totalTokens: number;
}

export function useLLMStream(): UseLLMStreamReturn {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [totalTokens, setTotalTokens] = useState(0);
  const unlistenRefs = useRef<UnlistenFn[]>([]);
  const requestIdRef = useRef<string | null>(null);

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
      const provider = opts?.provider ?? store.provider;
      const task = opts?.task ?? "chat";
      const model = opts?.model ?? getModelForTask(task);
      const apiKey = store.apiKey;
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
          apiKey,
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

  return { send, cancel, isStreaming, text, error, totalTokens };
}
