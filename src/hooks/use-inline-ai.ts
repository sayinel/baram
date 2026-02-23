// §6.2 Inline AI — Orchestration hook for Cmd+J
// Captures selection, streams LLM, updates AI Diff plugin decorations.
// Pattern: use-ghost-text.ts (LLM streaming + plugin meta)

import { useState, useRef, useCallback, useEffect } from "react";
import type { Editor } from "@tiptap/core";
import { useAIStore } from "../stores/ai-store";
import {
  aiDiffPluginKey,
  dispatchAIDiffStart,
  dispatchAIDiffChunk,
  dispatchAIDiffDone,
  dispatchAIDiffAccept,
  dispatchAIDiffReject,
  dispatchAIDiffClear,
  dispatchAIDiffAcceptHunk,
  dispatchAIDiffRejectHunk,
} from "../extensions/plugins/ai-diff";
import type { AIDiffState, Hunk } from "../extensions/plugins/ai-diff";
import type { InlineAIPhase } from "../components/ai/InlineAIPrompt";
import { llmComplete, llmCancel } from "../ipc/invoke";
import { listen } from "@tauri-apps/api/event";
import type { UnlistenFn } from "@tauri-apps/api/event";
import type { LLMTokenPayload, LLMDonePayload, LLMErrorPayload } from "../ipc/types";
import { isLLMAllowed, getFilePrivacy } from "../utils/privacy-check";
import { getModelForTask } from "../utils/model-selection";

export interface UseInlineAIReturn {
  isActive: boolean;
  phase: InlineAIPhase | "idle";
  selectionFrom: number;
  selectionTo: number;
  hasSelection: boolean;
  hunks: Hunk[];
  activate: () => void;
  submitPrompt: (instruction: string) => void;
  applyContent: (content: string) => void;
  accept: () => void;
  reject: () => void;
  regenerate: () => void;
  cancel: () => void;
  acceptHunk: (index: number) => void;
  rejectHunk: (index: number) => void;
}

export function useInlineAI(editor: Editor | null): UseInlineAIReturn {
  const [isActive, setIsActive] = useState(false);
  const [phase, setPhase] = useState<InlineAIPhase | "idle">("idle");
  const [selectionFrom, setSelectionFrom] = useState(0);
  const [selectionTo, setSelectionTo] = useState(0);
  const [hasSelection, setHasSelection] = useState(false);
  const [hunks, setHunks] = useState<Hunk[]>([]);

  const unlistenRefs = useRef<UnlistenFn[]>([]);
  const activeRequestRef = useRef<string | null>(null);
  const lastInstructionRef = useRef("");

  const cleanupListeners = useCallback(async () => {
    if (activeRequestRef.current) {
      llmCancel(activeRequestRef.current).catch(() => {});
    }
    for (const unlisten of unlistenRefs.current) {
      unlisten();
    }
    unlistenRefs.current = [];
    activeRequestRef.current = null;
  }, []);

  // Watch plugin state changes to sync phase
  useEffect(() => {
    if (!editor || !isActive) return;

    const handleTransaction = () => {
      const pluginState = aiDiffPluginKey.getState(editor.state) as AIDiffState | undefined;
      if (!pluginState) return;

      // Sync hunks from plugin state
      if (pluginState.phase === "completed" && pluginState.hunks.length > 0) {
        setHunks(pluginState.hunks);
      }

      // If plugin cleared externally (e.g. doc changed), close our UI
      if (pluginState.phase === "idle" && phase !== "idle" && phase !== "input") {
        setIsActive(false);
        setPhase("idle");
        setHunks([]);
        cleanupListeners();
      }
    };

    editor.on("transaction", handleTransaction);
    return () => {
      editor.off("transaction", handleTransaction);
    };
  }, [editor, isActive, phase, cleanupListeners]);

  const activate = useCallback(() => {
    if (!editor) return;

    const { from, to } = editor.state.selection;
    setSelectionFrom(from);
    setSelectionTo(to);
    setHasSelection(from !== to);
    setIsActive(true);
    setPhase("input");
  }, [editor]);

  const submitPrompt = useCallback(
    async (instruction: string) => {
      if (!editor) return;
      lastInstructionRef.current = instruction;

      const store = useAIStore.getState();
      const filePrivacy = getFilePrivacy(editor);
      if (!isLLMAllowed(store.privacyMode, store.provider, filePrivacy)) {
        return;
      }

      const { from, to } = { from: selectionFrom, to: selectionTo };
      const selectedText =
        from !== to
          ? editor.state.doc.textBetween(from, to, "\n")
          : "";

      setPhase("streaming");

      let systemPrompt: string;
      if (selectedText) {
        systemPrompt =
          "Rewrite the following text according to the user's instruction. Output ONLY the rewritten text, nothing else. No explanations, no markdown formatting unless specifically asked.";
        // Start diff tracking
        dispatchAIDiffStart(editor.view, from, to, selectedText);
      } else {
        systemPrompt =
          "Generate content according to the user's instruction. Output ONLY the generated text, nothing else. No explanations.";
        // For no-selection case, we still use diff (from=to, empty original)
        dispatchAIDiffStart(editor.view, from, to, "");
      }

      const requestId = `inlineai_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      activeRequestRef.current = requestId;

      const prompt = selectedText
        ? `Text to rewrite:\n${selectedText}\n\nInstruction: ${instruction}`
        : instruction;

      try {
        const tokenUn = await listen<LLMTokenPayload>("llm:token", (event) => {
          if (event.payload.requestId !== requestId) return;
          if (activeRequestRef.current !== requestId) return;
          try {
            dispatchAIDiffChunk(editor.view, event.payload.token);
          } catch {
            // editor state may have changed
          }
        });

        const doneUn = await listen<LLMDonePayload>("llm:done", (event) => {
          if (event.payload.requestId !== requestId) return;
          try {
            dispatchAIDiffDone(editor.view);
          } catch {
            // ignore
          }
          setPhase("completed");
        });

        const errorUn = await listen<LLMErrorPayload>("llm:error", (event) => {
          if (event.payload.requestId !== requestId) return;
          try {
            dispatchAIDiffClear(editor.view);
          } catch {
            // ignore
          }
          setPhase("input");
        });

        unlistenRefs.current = [tokenUn, doneUn, errorUn];

        await llmComplete(
          store.apiKey,
          prompt,
          getModelForTask("inline-edit"),
          requestId,
          systemPrompt,
          1024,
          store.provider,
          store.provider === "ollama" ? store.ollamaUrl : undefined,
          store.privacyMode,
        );
      } catch {
        setPhase("input");
        try {
          dispatchAIDiffClear(editor.view);
        } catch {
          // ignore
        }
      }
    },
    [editor, selectionFrom, selectionTo],
  );

  const applyContent = useCallback(
    (content: string) => {
      if (!editor) return;

      const { from, to } = editor.state.selection;
      const selectedText =
        from !== to ? editor.state.doc.textBetween(from, to, "\n") : "";

      setSelectionFrom(from);
      setSelectionTo(to);
      setHasSelection(from !== to);
      setIsActive(true);

      // Start diff with the provided content (no LLM call)
      dispatchAIDiffStart(editor.view, from, to, selectedText);
      dispatchAIDiffChunk(editor.view, content);
      dispatchAIDiffDone(editor.view);
      setPhase("completed");
    },
    [editor],
  );

  const accept = useCallback(() => {
    if (!editor) return;

    const pluginState = aiDiffPluginKey.getState(editor.state) as AIDiffState | undefined;
    if (!pluginState || pluginState.phase === "idle") {
      // No-selection case: text was generated at cursor. Already inserted via diff.
    }

    dispatchAIDiffAccept(editor.view);
    setIsActive(false);
    setPhase("idle");
    setHunks([]);
    cleanupListeners();
    editor.commands.focus();
  }, [editor, cleanupListeners]);

  const reject = useCallback(() => {
    if (!editor) return;
    dispatchAIDiffReject(editor.view);
    setIsActive(false);
    setPhase("idle");
    setHunks([]);
    cleanupListeners();
    editor.commands.focus();
  }, [editor, cleanupListeners]);

  const acceptHunk = useCallback(
    (index: number) => {
      if (!editor) return;
      dispatchAIDiffAcceptHunk(editor.view, index);
    },
    [editor],
  );

  const rejectHunk = useCallback(
    (index: number) => {
      if (!editor) return;
      dispatchAIDiffRejectHunk(editor.view, index);
    },
    [editor],
  );

  const regenerate = useCallback(() => {
    if (!editor) return;
    // Clear existing diff and re-submit with last instruction
    dispatchAIDiffClear(editor.view);
    cleanupListeners();
    if (lastInstructionRef.current) {
      submitPrompt(lastInstructionRef.current);
    }
  }, [editor, cleanupListeners, submitPrompt]);

  const cancel = useCallback(() => {
    if (!editor) return;
    if (phase === "streaming" || phase === "completed") {
      dispatchAIDiffClear(editor.view);
    }
    setIsActive(false);
    setPhase("idle");
    setHunks([]);
    cleanupListeners();
    editor.commands.focus();
  }, [editor, phase, cleanupListeners]);

  return {
    isActive,
    phase,
    selectionFrom,
    selectionTo,
    hasSelection,
    hunks,
    activate,
    submitPrompt,
    applyContent,
    accept,
    reject,
    regenerate,
    cancel,
    acceptHunk,
    rejectHunk,
  };
}
