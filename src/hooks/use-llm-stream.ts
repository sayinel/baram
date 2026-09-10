import { useCallback, useEffect, useRef, useState } from "react";

import type { AITask } from "../stores/ai/ai";

import { llmCancel, llmComplete } from "../ipc/invoke";
import { useAIStore } from "../stores/ai/ai";
import { createLLMStream } from "../utils/llm-stream";
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
  // issue 265: one cleanup per in-flight request, from createLLMStream (which
  // rolls back a half-registered set and is idempotent) — not three bare
  // unlisten handles assigned only after all three registrations succeeded.
  const cleanupRef = useRef<(() => void) | null>(null);
  const requestIdRef = useRef<null | string>(null);
  /** Aborts a registration still in flight, which has no cleanup handle yet. */
  const registrationRef = useRef<AbortController | null>(null);

  const cleanup = useCallback(() => {
    registrationRef.current?.abort();
    registrationRef.current = null;
    cleanupRef.current?.();
    cleanupRef.current = null;
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
      cleanup();

      const store = useAIStore.getState();
      const task = opts?.task ?? "chat";
      const config = getConfigForTask(task);
      const provider = opts?.provider ?? config.provider;
      const model = opts?.model ?? config.model;
      const baseUrl =
        opts?.baseUrl ?? (provider === "ollama" ? store.ollamaUrl : undefined);
      const privacyMode = store.privacyMode;

      // Privacy check
      if (!isLLMAllowed(store.aiEnabled, privacyMode, provider)) {
        setError(
          store.aiEnabled
            ? "Privacy mode is active. Only local models (Ollama) are allowed."
            : "AI is disabled.",
        );
        return;
      }

      const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      requestIdRef.current = requestId;

      setText("");
      setError(null);
      setTotalTokens(0);
      setIsStreaming(true);

      // Every write below is guarded: a late rejection from an EARLIER send
      // must not set error state on, or tear down, the request the user
      // started afterwards (the owner check use-inline-ai.ts already has).
      const owns = () => requestIdRef.current === requestId;
      const registration = new AbortController();
      registrationRef.current = registration;
      let cleanupStream: (() => void) | undefined;
      try {
        cleanupStream = await createLLMStream(
          requestId,
          {
            onDone: (payload) => {
              if (!owns()) return;
              setTotalTokens(payload.totalTokens);
              setIsStreaming(false);
              cleanup();
            },
            onError: (message) => {
              if (!owns()) return;
              setError(message);
              setIsStreaming(false);
              cleanup();
            },
            onToken: (token) => {
              if (owns()) setText((prev) => prev + token);
            },
          },
          { signal: registration.signal },
        );
        if (registrationRef.current === registration) {
          registrationRef.current = null;
        }
        if (!owns()) {
          // A newer send took over while the listeners were registering.
          cleanupStream();
          return;
        }
        cleanupRef.current = cleanupStream;

        // Invoke Rust backend
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
        cleanupStream?.();
        if (!owns()) return;
        if (e instanceof DOMException && e.name === "AbortError") return;
        setError(String(e));
        setIsStreaming(false);
        cleanup();
      }
    },
    [cleanup],
  );

  // Unmount cleanup — unlisten an active stream if the component is torn down mid-stream
  useEffect(() => {
    return () => {
      registrationRef.current?.abort();
      registrationRef.current = null;
      cleanupRef.current?.();
      cleanupRef.current = null;
      requestIdRef.current = null;
    };
  }, []);

  return { send, cancel, isStreaming, text, error, totalTokens };
}
