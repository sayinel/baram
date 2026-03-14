// §43 Ghost Text — Orchestration hook
// Debounces cursor idle, builds context prompt, streams LLM response,
// updates ProseMirror decoration via ghostTextPluginKey meta.

import { useCallback, useEffect, useRef } from "react";

import { listen } from "@tauri-apps/api/event";
import type { UnlistenFn } from "@tauri-apps/api/event";

import type {
  LLMDonePayload,
  LLMErrorPayload,
  LLMTokenPayload,
} from "../ipc/types";
import type { Editor } from "@tiptap/core";

import {
  ghostTextPluginKey,
  registerGhostTextAcceptedCallback,
} from "../extensions/plugins/ghost-text";
import { llmCancel, llmComplete } from "../ipc/invoke";
import { useAIStore } from "../stores/ai-store";
import { useEditorStore } from "../stores/editor-store";
import { GhostTextCache } from "../utils/ghost-text-cache";
import { buildGhostTextConfig } from "../utils/ghost-text-prompt";
import { getConfigForTask } from "../utils/model-selection";
import { getFilePrivacy, isLLMAllowed } from "../utils/privacy-check";

// §11.2.2 Module-level cache singleton with TTL and file invalidation
const ghostCache = new GhostTextCache();

// §11.2.2 Prefetch trigger: true when text ends with sentence punctuation and has >= 2 sentences
// Exported for use in ghost text acceptance handler (Tab key path)
export function shouldPrefetch(text: string): boolean {
  if (!/[.!?。]$/.test(text.trim())) return false;
  const sentenceCount = (text.match(/[.!?。]+/g) || []).length;
  return sentenceCount >= 2;
}

export function useGhostText(editor: Editor | null) {
  const debounceRef = useRef<null | ReturnType<typeof setTimeout>>(null);
  const unlistenRefs = useRef<UnlistenFn[]>([]);
  const activeRequestRef = useRef<null | string>(null);
  const accumulatedRef = useRef("");
  const lastFilePathRef = useRef<string | undefined>(undefined);

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
      const ghostTaskConfig = getConfigForTask("ghost-text");
      if (
        !isLLMAllowed(store.privacyMode, ghostTaskConfig.provider, filePrivacy)
      )
        return;

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
      // §11.2.2 Invalidate cache when switching files
      const currentFilePath = activeTab?.filePath;
      if (
        lastFilePathRef.current &&
        currentFilePath !== lastFilePathRef.current
      ) {
        ghostCache.invalidateFile(lastFilePathRef.current);
      }
      lastFilePathRef.current = currentFilePath;

      const ghostConfig = buildGhostTextConfig(editor, from, currentFilePath);
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
      const cached = ghostCache.get(textBefore);
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
          unlistenRefs.current.push(tokenUn);

          const doneUn = await listen<LLMDonePayload>("llm:done", (event) => {
            if (event.payload.requestId !== requestId) return;
            // Cache the result with file path for invalidation
            if (accumulatedRef.current) {
              ghostCache.set(
                textBefore,
                accumulatedRef.current.slice(
                  0,
                  storeSnapshot.maxSuggestionLength,
                ),
                currentFilePath,
              );
            }
          });
          unlistenRefs.current.push(doneUn);

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
          unlistenRefs.current.push(errorUn);

          const taskCfg = getConfigForTask("ghost-text");
          await llmComplete(
            taskCfg.apiKey,
            ghostConfig.contextText,
            taskCfg.model,
            requestId,
            ghostConfig.systemPrompt,
            storeSnapshot.maxSuggestionLength,
            taskCfg.provider,
            taskCfg.baseUrl,
            storeSnapshot.privacyMode,
          );
        } catch {
          // silently ignore — ghost text is non-critical
        }
      }, currentStore.ghostTextDebounceMs);
    };

    editor.on("update", handleUpdate);

    // §11.2.2 Register prefetch callback triggered after Tab-acceptance
    registerGhostTextAcceptedCallback((acceptedText, pos) => {
      const store = useAIStore.getState();
      if (!store.ghostTextEnabled) return;

      // Build the text that will be before the cursor after acceptance
      const { state } = editor;
      const $from = state.doc.resolve(pos);
      const textBefore =
        $from.parent.textBetween(0, $from.parentOffset, undefined, "\ufffc") +
        acceptedText;

      if (!shouldPrefetch(textBefore)) return;

      // Fire background prefetch — result stored in cache for next keystroke
      const taskCfg = getConfigForTask("ghost-text");
      const ghostConfig = buildGhostTextConfig(editor, pos, undefined);
      if (ghostConfig.skip) return;

      const requestId = `prefetch_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      llmComplete(
        taskCfg.apiKey,
        textBefore,
        taskCfg.model,
        requestId,
        ghostConfig.systemPrompt,
        store.maxSuggestionLength,
        taskCfg.provider,
        taskCfg.baseUrl,
        store.privacyMode,
      ).catch(() => {
        // prefetch is best-effort — ignore errors silently
      });
    });

    return () => {
      editor.off("update", handleUpdate);
      registerGhostTextAcceptedCallback(null);
      cleanup();
    };
  }, [editor, cleanup]);
}
