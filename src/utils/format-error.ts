// IPC / AI error message formatting utilities

export interface FormattedError {
  detail: string;
  title: string;
}

// AI error message formatting utility

/**
 * Parse raw AI error strings into a user-friendly title + detail.
 *
 * Handles formats like:
 * - "HTTP 401: {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}"
 * - "HTTP 429: {"error":{"message":"Rate limit exceeded","type":"rate_limit_error"}}"
 * - Plain text errors
 */
export function formatAIError(raw: string): FormattedError {
  // Try to parse "HTTP {status}: {body}" pattern
  const httpMatch = raw.match(/^HTTP (\d{3}):\s*(.+)$/s);
  if (httpMatch) {
    const status = httpMatch[1];
    const body = httpMatch[2];

    // Try to extract message from JSON body
    const message = extractJsonMessage(body);
    if (message) {
      return { title: `Error ${status}`, detail: message };
    }

    return { title: `Error ${status}`, detail: body };
  }

  return { title: "Error", detail: raw };
}

/**
 * Convert any thrown value from a Tauri IPC call into a user-friendly string.
 *
 * Rust commands return `Result<T, String>`, so the rejection value is
 * typically a plain string.  JS Error objects and arbitrary objects are
 * also handled gracefully.
 */
export function formatError(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }
  if (error instanceof Error) {
    return error.message;
  }
  if (error !== null && typeof error === "object") {
    try {
      return JSON.stringify(error);
    } catch {
      // ignore — fall through to default
    }
  }
  return "알 수 없는 오류가 발생했습니다";
}

/**
 * Extract a human-readable message from JSON error bodies.
 * Supports Claude format: { error: { message: "..." } }
 * Supports OpenAI format: { error: { message: "..." } }
 * Supports Gemini format: { error: { message: "..." } }
 */
function extractJsonMessage(body: string): null | string {
  try {
    const parsed = JSON.parse(body);

    // Claude/OpenAI/Gemini: { error: { message: "..." } }
    if (parsed?.error?.message) {
      return parsed.error.message;
    }

    // Claude alt: top-level message
    if (parsed?.message) {
      return parsed.message;
    }

    return null;
  } catch {
    return null;
  }
}
