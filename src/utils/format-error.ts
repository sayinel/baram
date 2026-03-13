// AI error message formatting utility

export interface FormattedError {
  detail: string;
  title: string;
}

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
