// IPC invoke 유틸리티 — Tauri 커맨드 타입 안전 래퍼
// Re-export facade: 도메인별 모듈에서 모든 함수를 재수출하여 기존 import 경로 호환성을 유지한다.

export * from "./config";
export * from "./export";
export * from "./fs";
export * from "./git";
export * from "./keyring";
export * from "./link-index";
export * from "./llm";
export * from "./plugin";
export * from "./search";
export * from "./snapshot";
export * from "./tag";

// Re-export types that were previously defined directly in this file.
// RenameTagResult and TagEntry now live in types.ts; re-export for backward compatibility.
export type { RenameTagResult, TagEntry } from "./types";
