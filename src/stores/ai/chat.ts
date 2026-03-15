// §44 AI Chat Session Store
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { tauriStorage } from "../system/tauri-storage";

export interface ChatMessage {
  content: string;
  id: string;
  references?: string[]; // @reference targets
  role: "assistant" | "user";
  timestamp: number;
}

export interface ChatSession {
  createdAt: number;
  id: string;
  messages: ChatMessage[];
  title: string;
  updatedAt: number;
}

interface ChatState {
  activeSessionId: null | string;
  addMessage: (
    sessionId: string,
    message: Omit<ChatMessage, "id" | "timestamp">,
  ) => void;

  createSession: () => string;
  deleteSession: (id: string) => void;
  getActiveSession: () => ChatSession | undefined;
  sessions: ChatSession[];
  setActiveSession: (id: string) => void;
  updateLastMessage: (sessionId: string, content: string) => void;
}

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      sessions: [],
      activeSessionId: null,

      createSession: () => {
        const id = `chat_${Date.now()}`;
        const session: ChatSession = {
          id,
          title: "New Chat",
          messages: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        set((state) => ({
          sessions: [...state.sessions, session],
          activeSessionId: id,
        }));
        return id;
      },

      setActiveSession: (id) => set({ activeSessionId: id }),

      addMessage: (sessionId, message) => {
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === sessionId
              ? {
                  ...s,
                  messages: [
                    ...s.messages,
                    {
                      ...message,
                      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                      timestamp: Date.now(),
                    },
                  ],
                  updatedAt: Date.now(),
                  // Auto-title from first user message
                  title:
                    s.messages.length === 0 && message.role === "user"
                      ? message.content.slice(0, 40) +
                        (message.content.length > 40 ? "..." : "")
                      : s.title,
                }
              : s,
          ),
        }));
      },

      updateLastMessage: (sessionId, content) => {
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === sessionId && s.messages.length > 0
              ? {
                  ...s,
                  messages: s.messages.map((m, i) =>
                    i === s.messages.length - 1 ? { ...m, content } : m,
                  ),
                  updatedAt: Date.now(),
                }
              : s,
          ),
        }));
      },

      deleteSession: (id) => {
        set((state) => ({
          sessions: state.sessions.filter((s) => s.id !== id),
          activeSessionId:
            state.activeSessionId === id ? null : state.activeSessionId,
        }));
      },

      getActiveSession: () => {
        const { sessions, activeSessionId } = get();
        return sessions.find((s) => s.id === activeSessionId);
      },
    }),
    {
      name: "baram:chat-sessions",
      storage: createJSONStorage(() => tauriStorage),
      partialize: (state) => ({
        sessions: state.sessions,
        activeSessionId: state.activeSessionId,
      }),
    },
  ),
);
