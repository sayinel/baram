import { describe, expect, it } from "vitest";

import { formatAIError } from "../format-error";

describe("formatAIError", () => {
  // --- Claude error format ---
  it("parses Claude 401 authentication error", () => {
    const raw = `HTTP 401: {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}`;
    const result = formatAIError(raw);
    expect(result.title).toBe("Error 401");
    expect(result.detail).toBe("invalid x-api-key");
  });

  // --- OpenAI error format ---
  it("parses OpenAI 429 rate limit error", () => {
    const raw = `HTTP 429: {"error":{"message":"Rate limit exceeded","type":"rate_limit_error"}}`;
    const result = formatAIError(raw);
    expect(result.title).toBe("Error 429");
    expect(result.detail).toBe("Rate limit exceeded");
  });

  // --- Gemini error format ---
  it("parses Gemini 400 error", () => {
    const raw = `HTTP 400: {"error":{"code":400,"message":"API key not valid. Please pass a valid API key.","status":"INVALID_ARGUMENT"}}`;
    const result = formatAIError(raw);
    expect(result.title).toBe("Error 400");
    expect(result.detail).toBe(
      "API key not valid. Please pass a valid API key.",
    );
  });

  // --- Top-level message fallback ---
  it("extracts top-level message field", () => {
    const raw = `HTTP 500: {"message":"Internal server error"}`;
    const result = formatAIError(raw);
    expect(result.title).toBe("Error 500");
    expect(result.detail).toBe("Internal server error");
  });

  // --- Non-JSON HTTP body ---
  it("returns raw body when JSON parsing fails", () => {
    const raw = "HTTP 503: Service Unavailable";
    const result = formatAIError(raw);
    expect(result.title).toBe("Error 503");
    expect(result.detail).toBe("Service Unavailable");
  });

  // --- JSON without error.message ---
  it("returns raw body when JSON has no message field", () => {
    const raw = `HTTP 403: {"status":"forbidden"}`;
    const result = formatAIError(raw);
    expect(result.title).toBe("Error 403");
    expect(result.detail).toBe(`{"status":"forbidden"}`);
  });

  // --- Plain text error (no HTTP prefix) ---
  it("handles plain text error", () => {
    const raw = "API key not provided";
    const result = formatAIError(raw);
    expect(result.title).toBe("Error");
    expect(result.detail).toBe("API key not provided");
  });

  it("handles privacy mode error", () => {
    const raw =
      "Privacy mode blocks cloud provider 'claude' — only 'ollama' (local) is allowed";
    const result = formatAIError(raw);
    expect(result.title).toBe("Error");
    expect(result.detail).toBe(raw);
  });

  // --- Edge cases ---
  it("handles empty string", () => {
    const result = formatAIError("");
    expect(result.title).toBe("Error");
    expect(result.detail).toBe("");
  });

  it("handles multiline JSON body", () => {
    const raw = `HTTP 401: {
  "type": "error",
  "error": {
    "type": "authentication_error",
    "message": "invalid x-api-key"
  }
}`;
    const result = formatAIError(raw);
    expect(result.title).toBe("Error 401");
    expect(result.detail).toBe("invalid x-api-key");
  });
});
