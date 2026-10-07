// §44 AI Chat Session Store
import { create } from "zustand";
import { persist } from "zustand/middleware";

import { createCoalescingStorage } from "../system/coalescing-storage";
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

type PersistedChat = Pick<ChatState, "activeSessionId" | "sessions">;

/**
 * §44 Chat history is saved at most once per this many ms (#800). A streamed reply updates
 * the last message on every token, and each save stringifies every session and rewrites
 * `config.json`; coalescing makes that a handful of saves per reply instead of one per token.
 */
export const CHAT_SAVE_INTERVAL_MS = 250;

const chatStorage = createCoalescingStorage<PersistedChat>(
  tauriStorage,
  CHAT_SAVE_INTERVAL_MS,
);

/**
 * Save the chat history now instead of at the next interval. Called where a change must not
 * wait: a reply ending (done, error, cancel), a message added or a session deleted, and
 * before the app quits or reloads. Resolves once the save has been written.
 */
export function flushChatPersist(): Promise<void> {
  return chatStorage.flush();
}

// Best effort when the page goes away without passing through the quit path (an error
// screen's reload button, a dev reload). The write is async, so it may not finish.
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => {
    void flushChatPersist();
  });
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
        void flushChatPersist();
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
        void flushChatPersist();
      },

      getActiveSession: () => {
        const { sessions, activeSessionId } = get();
        return sessions.find((s) => s.id === activeSessionId);
      },
    }),
    {
      name: "baram:chat-sessions",
      storage: chatStorage,
      partialize: (state) => ({
        sessions: state.sessions,
        activeSessionId: state.activeSessionId,
      }),
    },
  ),
);
