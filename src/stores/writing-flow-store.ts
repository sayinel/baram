// §11.3 WritingFlowStore — combines writing mode detection, session context, and session memory
import type { WritingMode } from "../utils/writing-mode-detector";

import { create } from "zustand";

import { SessionContextTracker } from "../utils/session-context";
import { SessionMemory } from "../utils/session-memory";
import { getSystemPromptForMode } from "../utils/writing-mode-prompts";

interface WritingFlowState {
  compositePromptContext: () => string;
  currentFileId: string;
  currentMode: WritingMode;
  getSessionMemory: () => SessionMemory;
  modeConfidence: number;
  reset: () => void;
  sessionContext: SessionContextTracker;
  setMode: (mode: WritingMode, confidence: number) => void;
  switchFile: (fileId: string) => void;
}

// Session memories keyed by file ID — kept outside Zustand to avoid serialization issues
const sessionMemories = new Map<string, SessionMemory>();

function getOrCreateMemory(fileId: string): SessionMemory {
  let memory = sessionMemories.get(fileId);
  if (!memory) {
    memory = new SessionMemory(fileId);
    sessionMemories.set(fileId, memory);
  }
  return memory;
}

export const useWritingFlowStore = create<WritingFlowState>()((set, get) => ({
  compositePromptContext: () => {
    const state = get();
    const parts: string[] = [];

    // Mode-specific system prompt
    parts.push(getSystemPromptForMode(state.currentMode));

    // Session context (editing patterns, WPM)
    const sessionCtx = state.sessionContext.toPromptContext();
    if (sessionCtx) parts.push(sessionCtx);

    // Session memory (rejections, avoid/prefer)
    const memoryCtx = getOrCreateMemory(state.currentFileId).toPromptContext();
    if (memoryCtx) parts.push(memoryCtx);

    return parts.join("\n\n");
  },

  currentFileId: "",
  currentMode: "general" as WritingMode,

  getSessionMemory: () => {
    return getOrCreateMemory(get().currentFileId);
  },

  modeConfidence: 0.5,

  reset: () => {
    sessionMemories.clear();
    set({
      currentFileId: "",
      currentMode: "general",
      modeConfidence: 0.5,
      sessionContext: new SessionContextTracker(),
    });
  },

  sessionContext: new SessionContextTracker(),

  setMode: (mode: WritingMode, confidence: number) => {
    set({ currentMode: mode, modeConfidence: confidence });
  },

  switchFile: (fileId: string) => {
    set({ currentFileId: fileId });
  },
}));
