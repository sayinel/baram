// §44 AI Chat Panel — right-side conversational AI interface
import { useState, useRef, useEffect, useCallback } from "react";
import { useChatStore } from "../../stores/chat-store";
import { useUIStore } from "../../stores/ui-store";
import { useLLMStream } from "../../hooks/use-llm-stream";
import { ChatMessage } from "./ChatMessage";
import { parseReferences, resolveReference, buildContextPrompt } from "../../utils/chat-context";
import type { ResolvedReference } from "../../utils/chat-context";
import { formatAIError } from "../../utils/format-error";
import { ReferenceAutocomplete } from "./ReferenceAutocomplete";

const ChevronIcon = ({ rotated }: { rotated: boolean }) => (
  <svg
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ transform: rotated ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}
  >
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

export function AIChatPanel() {
  const { rightPanelOpen } = useUIStore();
  const {
    sessions,
    activeSessionId,
    createSession,
    setActiveSession,
    deleteSession,
    addMessage,
    updateLastMessage,
    getActiveSession,
  } = useChatStore();
  const { send, cancel, isStreaming, text, error } = useLLMStream();
  const [input, setInput] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [refQuery, setRefQuery] = useState<string | null>(null);
  const [refPosition, setRefPosition] = useState({ top: 0, left: 0 });
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const inputAreaRef = useRef<HTMLDivElement>(null);
  const streamSessionRef = useRef<string | null>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!dropdownOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest(".ai-chat-session-dropdown")) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [dropdownOpen]);

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

  // § @ reference autocomplete detection
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setInput(value);

    const cursorPos = e.target.selectionStart;
    const textBeforeCursor = value.slice(0, cursorPos);

    // Find the last @ that's either at start or preceded by whitespace
    const atMatch = textBeforeCursor.match(/(?:^|\s)@([^\s]*)$/);
    if (atMatch) {
      const query = atMatch[1]; // text after @
      setRefQuery(query);

      // Position the dropdown above the textarea
      if (inputAreaRef.current) {
        const rect = inputAreaRef.current.getBoundingClientRect();
        setRefPosition({ top: rect.height + 4, left: 8 });
      }
    } else {
      setRefQuery(null);
    }
  }, []);

  const handleRefSelect = useCallback((ref: string) => {
    const textarea = inputRef.current;
    if (!textarea) {
      setInput((prev) => prev + ref + " ");
      setRefQuery(null);
      return;
    }

    const cursorPos = textarea.selectionStart;
    const textBeforeCursor = input.slice(0, cursorPos);
    const textAfterCursor = input.slice(cursorPos);

    // Find and replace the @query part
    const atMatch = textBeforeCursor.match(/(?:^|\s)@([^\s]*)$/);
    if (atMatch) {
      const atStart = textBeforeCursor.lastIndexOf("@");
      const newInput = input.slice(0, atStart) + ref + " " + textAfterCursor;
      setInput(newInput);

      // Set cursor after inserted reference
      requestAnimationFrame(() => {
        const newPos = atStart + ref.length + 1;
        textarea.setSelectionRange(newPos, newPos);
        textarea.focus();
      });
    }

    setRefQuery(null);
  }, [input]);

  const handleApplyToEditor = useCallback((content: string) => {
    useUIStore.getState().setPendingApplyContent(content);
  }, []);

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
      // When autocomplete is open, let it handle navigation keys
      if (refQuery !== null && (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Tab" || e.key === "Escape")) {
        return; // handled by ReferenceAutocomplete's keydown listener
      }
      if (refQuery !== null && e.key === "Enter") {
        return; // autocomplete handles Enter to select
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend, refQuery],
  );

  if (!rightPanelOpen) return null;

  const activeSession = getActiveSession();
  const messages = activeSession?.messages ?? [];

  return (
    <div className="ai-chat-panel">
      <div className="ai-chat-header">
        <div className="ai-chat-session-dropdown">
          <button
            className="ai-chat-session-trigger"
            onClick={() => setDropdownOpen(!dropdownOpen)}
          >
            <span>{activeSession?.title ?? "AI Chat"}</span>
            <ChevronIcon rotated={dropdownOpen} />
          </button>
          {dropdownOpen && (
            <div className="ai-chat-dropdown-menu">
              {sessions.map((s) => (
                <div
                  key={s.id}
                  className={`ai-chat-dropdown-item ${s.id === activeSessionId ? "active" : ""}`}
                >
                  <button
                    className="ai-chat-dropdown-item-label"
                    onClick={() => { setActiveSession(s.id); setDropdownOpen(false); }}
                  >
                    {s.title}
                  </button>
                  <button
                    className="ai-chat-dropdown-item-delete"
                    onClick={(e) => { e.stopPropagation(); deleteSession(s.id); }}
                    title="Delete conversation"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
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
            onApplyToEditor={msg.role === "assistant" ? handleApplyToEditor : undefined}
          />
        ))}
        <div ref={messagesEndRef} />
      </div>

      {error && (() => {
        const formatted = formatAIError(error);
        return (
          <div className="ai-chat-error">
            <strong>{formatted.title}</strong>
            <span>{formatted.detail}</span>
          </div>
        );
      })()}

      <div className="ai-chat-input-area" ref={inputAreaRef}>
        {refQuery !== null && (
          <ReferenceAutocomplete
            query={refQuery}
            position={refPosition}
            onSelect={handleRefSelect}
            onClose={() => setRefQuery(null)}
          />
        )}
        <textarea
          ref={inputRef}
          className="ai-chat-input"
          value={input}
          onChange={handleInputChange}
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
