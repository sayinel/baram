// §43 Ghost Text — Orchestration hook
// Debounces cursor idle, builds context prompt, streams LLM response,
// updates ProseMirror decoration via ghostTextPluginKey meta.

import { useEffect, useRef, useCallback } from "react";
import type { Editor } from "@tiptap/core";
import { useAIStore } from "../stores/ai-store";
import { useEditorStore } from "../stores/editor-store";
import { ghostTextPluginKey } from "../extensions/plugins/ghost-text";
import { buildGhostTextConfig } from "../utils/ghost-text-prompt";
import { llmComplete, llmCancel } from "../ipc/invoke";
import { listen } from "@tauri-apps/api/event";
import type { UnlistenFn } from "@tauri-apps/api/event";
import type {
  LLMTokenPayload,
  LLMDonePayload,
  LLMErrorPayload,
} from "../ipc/types";
import { isLLMAllowed, getFilePrivacy } from "../utils/privacy-check";
import { getModelForTask } from "../utils/model-selection";

// Simple prefix cache (last 5 suggestions)
const prefixCache = new Map<string, string>();
const MAX_CACHE_SIZE = 5;

function getCacheKey(textBefore: string): string {
  return textBefore.slice(-200);
}

export function useGhostText(editor: Editor | null) {
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unlistenRefs = useRef<UnlistenFn[]>([]);
  const activeRequestRef = useRef<string | null>(null);
  const accumulatedRef = useRef("");

  const cleanup = useCallback(async () => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    if (activeRequestRef.current) {
      llmCancel(activeRequestRef.current).catch(() => {});
    }
    for (const unlisten of unlistenRefs.current) {
      unlisten();
    }
    unlistenRefs.current = [];
    activeRequestRef.current = null;
    accumulatedRef.current = "";
  }, []);

  useEffect(() => {
    if (!editor) return;

    const handleUpdate = () => {
      const store = useAIStore.getState();
      if (!store.ghostTextEnabled) return;
      const filePrivacy = getFilePrivacy(editor);
      if (!isLLMAllowed(store.privacyMode, store.provider, filePrivacy)) return;

      // Cancel previous request
      cleanup();

      const { state } = editor;
      const { from } = state.selection;
      const $from = state.doc.resolve(from);

      // Build context-aware config (D1: block-type modes, D3: cross-file)
      const editorState = useEditorStore.getState();
      const activeTab = editorState.tabs.find(
        (t) => t.id === editorState.activeTabId,
      );
      const ghostConfig = buildGhostTextConfig(
        editor,
        from,
        activeTab?.filePath,
      );
      if (ghostConfig.skip) return;

      // Get text before cursor for cache key + min length check
      const textBefore = $from.parent.textBetween(
        0,
        $from.parentOffset,
        undefined,
        "\ufffc",
      );
      if (!textBefore || textBefore.length < 3) return;

      // Check cache first
      const cacheKey = getCacheKey(textBefore);
      const cached = prefixCache.get(cacheKey);
      if (cached) {
        editor.view.dispatch(
          editor.state.tr.setMeta(ghostTextPluginKey, {
            text: cached,
            pos: from,
          }),
        );
        return;
      }

      const currentStore = useAIStore.getState();

      // Debounce
      debounceRef.current = setTimeout(async () => {
        const requestId = `ghost_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        activeRequestRef.current = requestId;
        accumulatedRef.current = "";

        const storeSnapshot = useAIStore.getState();

        try {
          const tokenUn = await listen<LLMTokenPayload>(
            "llm:token",
            (event) => {
              if (event.payload.requestId !== requestId) return;
              if (activeRequestRef.current !== requestId) return;

              accumulatedRef.current += event.payload.token;
              const suggestion = accumulatedRef.current.slice(
                0,
                storeSnapshot.maxSuggestionLength,
              );

              // Update ghost text decoration
              try {
                editor.view.dispatch(
                  editor.state.tr.setMeta(ghostTextPluginKey, {
                    text: suggestion,
                    pos: from,
                  }),
                );
              } catch {
                // editor state may have changed — ignore silently
              }
            },
          );

          const doneUn = await listen<LLMDonePayload>("llm:done", (event) => {
            if (event.payload.requestId !== requestId) return;
            // Cache the result
            if (accumulatedRef.current) {
              if (prefixCache.size >= MAX_CACHE_SIZE) {
                const firstKey = prefixCache.keys().next().value;
                if (firstKey) prefixCache.delete(firstKey);
              }
              prefixCache.set(
                cacheKey,
                accumulatedRef.current.slice(
                  0,
                  storeSnapshot.maxSuggestionLength,
                ),
              );
            }
          });

          const errorUn = await listen<LLMErrorPayload>(
            "llm:error",
            (event) => {
              if (event.payload.requestId !== requestId) return;
              // Silently dismiss on error
              try {
                editor.view.dispatch(
                  editor.state.tr.setMeta(ghostTextPluginKey, {
                    text: null,
                    pos: 0,
                  }),
                );
              } catch {
                // ignore
              }
            },
          );

          unlistenRefs.current = [tokenUn, doneUn, errorUn];

          await llmComplete(
            storeSnapshot.apiKey,
            ghostConfig.contextText,
            getModelForTask("ghost-text"),
            requestId,
            ghostConfig.systemPrompt,
            storeSnapshot.maxSuggestionLength,
            storeSnapshot.provider,
            storeSnapshot.provider === "ollama"
              ? storeSnapshot.ollamaUrl
              : undefined,
            storeSnapshot.privacyMode,
          );
        } catch {
          // silently ignore — ghost text is non-critical
        }
      }, currentStore.ghostTextDebounceMs);
    };

    editor.on("update", handleUpdate);
    return () => {
      editor.off("update", handleUpdate);
      cleanup();
    };
  }, [editor, cleanup]);
}
