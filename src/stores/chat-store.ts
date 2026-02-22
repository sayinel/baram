// §44 AI Chat Session Store
import { create } from "zustand";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  references?: string[]; // @reference targets
}

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

interface ChatState {
  sessions: ChatSession[];
  activeSessionId: string | null;

  createSession: () => string;
  setActiveSession: (id: string) => void;
  addMessage: (sessionId: string, message: Omit<ChatMessage, "id" | "timestamp">) => void;
  updateLastMessage: (sessionId: string, content: string) => void;
  deleteSession: (id: string) => void;
  getActiveSession: () => ChatSession | undefined;
}

export const useChatStore = create<ChatState>((set, get) => ({
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
                  ? message.content.slice(0, 40) + (message.content.length > 40 ? "..." : "")
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
}));
