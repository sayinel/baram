// §44 AI Chat Panel — right-side conversational AI interface
import { useState, useRef, useEffect, useCallback } from "react";
import { useChatStore } from "../../stores/chat-store";
import { useUIStore } from "../../stores/ui-store";
import { useLLMStream } from "../../hooks/use-llm-stream";
import { ChatMessage } from "./ChatMessage";
import { parseReferences, resolveReference, buildContextPrompt } from "../../utils/chat-context";
import type { ResolvedReference } from "../../utils/chat-context";

export function AIChatPanel() {
  const { rightPanelOpen } = useUIStore();
  const {
    sessions,
    activeSessionId,
    createSession,
    addMessage,
    updateLastMessage,
    getActiveSession,
  } = useChatStore();
  const { send, cancel, isStreaming, text, error } = useLLMStream();
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const streamSessionRef = useRef<string | null>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [text, sessions]);

  // Accumulate streaming tokens into the last assistant message
  useEffect(() => {
    if (!isStreaming || !streamSessionRef.current) return;
    updateLastMessage(streamSessionRef.current, text);
  }, [text, isStreaming, updateLastMessage]);

  // When streaming completes
  useEffect(() => {
    if (!isStreaming && streamSessionRef.current && text) {
      updateLastMessage(streamSessionRef.current, text);
      streamSessionRef.current = null;
    }
  }, [isStreaming, text, updateLastMessage]);

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || isStreaming) return;

    let sessionId = activeSessionId;
    if (!sessionId) {
      sessionId = createSession();
    }

    // Parse @references
    const refStrings = parseReferences(trimmed);
    const resolved: ResolvedReference[] = refStrings
      .map(resolveReference)
      .filter((r): r is ResolvedReference => r !== null);

    // Add user message
    addMessage(sessionId, {
      role: "user",
      content: trimmed,
      references: refStrings,
    });

    // Add empty assistant message (will be filled by streaming)
    addMessage(sessionId, {
      role: "assistant",
      content: "",
    });

    streamSessionRef.current = sessionId;

    // Build prompt with context
    const prompt = buildContextPrompt(trimmed, resolved);

    // Build conversation history for system prompt
    const session = getActiveSession();
    const history = session?.messages
      .slice(-20) // Last 20 messages
      .filter((m) => m.content) // Skip empty
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n\n") ?? "";

    const systemPrompt = history
      ? `You are a helpful AI assistant in a markdown editor called Baram. Previous conversation:\n${history}\n\nRespond helpfully and concisely.`
      : "You are a helpful AI assistant in a markdown editor called Baram. Respond helpfully and concisely.";

    send(prompt, systemPrompt);
    setInput("");
  }, [input, isStreaming, activeSessionId, createSession, addMessage, getActiveSession, send]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  if (!rightPanelOpen) return null;

  const activeSession = getActiveSession();
  const messages = activeSession?.messages ?? [];

  return (
    <div className="ai-chat-panel">
      <div className="ai-chat-header">
        <span className="ai-chat-title">AI Chat</span>
        <div className="ai-chat-header-actions">
          <button
            className="ai-chat-new-btn"
            onClick={() => createSession()}
            title="New conversation"
          >
            +
          </button>
        </div>
      </div>

      {sessions.length > 1 && (
        <div className="ai-chat-sessions">
          {sessions.map((s) => (
            <button
              key={s.id}
              className={`ai-chat-session-btn ${s.id === activeSessionId ? "active" : ""}`}
              onClick={() => useChatStore.getState().setActiveSession(s.id)}
            >
              {s.title}
            </button>
          ))}
        </div>
      )}

      <div className="ai-chat-messages">
        {messages.length === 0 && (
          <div className="ai-chat-empty">
            Start a conversation. Use @current to reference the open file.
          </div>
        )}
        {messages.map((msg) => (
          <ChatMessage
            key={msg.id}
            role={msg.role}
            content={msg.content}
            isStreaming={
              isStreaming &&
              msg.id === messages[messages.length - 1]?.id &&
              msg.role === "assistant"
            }
          />
        ))}
        <div ref={messagesEndRef} />
      </div>

      {error && <div className="ai-chat-error">{error}</div>}

      <div className="ai-chat-input-area">
        <textarea
          ref={inputRef}
          className="ai-chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask AI... (@current for context)"
          rows={2}
          disabled={isStreaming}
        />
        <div className="ai-chat-input-actions">
          {isStreaming ? (
            <button className="ai-chat-stop-btn" onClick={cancel}>
              Stop
            </button>
          ) : (
            <button
              className="ai-chat-send-btn"
              onClick={handleSend}
              disabled={!input.trim()}
            >
              Send
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
