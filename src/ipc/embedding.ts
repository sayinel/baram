// §11.4 Knowledge Q&A — embedding and knowledge search IPC commands
import { invoke } from "@tauri-apps/api/core";

// Types mirroring Rust structs in embedding_cmd.rs

export interface IndexStatus {
  indexed_files: number;
  is_indexing: boolean;
  total_chunks: number;
  total_files: number;
}

export interface KnowledgeSearchResult {
  chunk_id: string;
  content: string;
  file_path: string;
  heading_path: string[];
  score: number;
}

/** Embed a single text string and return its vector */
export async function embedText(
  text: string,
  provider: string,
  model: string,
  apiKey?: string,
  baseUrl?: string,
): Promise<number[]> {
  return invoke<number[]>("embed_text", {
    text,
    provider,
    model,
    apiKey: apiKey ?? null,
    baseUrl: baseUrl ?? null,
  });
}

/** Index a single file (incremental) */
export async function indexFile(
  filePath: string,
  relativePath: string,
  provider: string,
  model: string,
  apiKey?: string,
  baseUrl?: string,
): Promise<number> {
  return invoke<number>("index_file", {
    filePath,
    relativePath,
    provider,
    model,
    apiKey: apiKey ?? null,
    baseUrl: baseUrl ?? null,
  });
}

/** Get current indexing status */
export async function indexStatus(): Promise<IndexStatus> {
  return invoke<IndexStatus>("index_status");
}

/** Index all markdown files in the vault directory */
export async function indexVault(
  vaultPath: string,
  provider: string,
  model: string,
  apiKey?: string,
  baseUrl?: string,
): Promise<IndexStatus> {
  return invoke<IndexStatus>("index_vault", {
    vaultPath,
    provider,
    model,
    apiKey: apiKey ?? null,
    baseUrl: baseUrl ?? null,
  });
}

/** Hybrid search (BM25 + vector + graph) across indexed vault */
export async function searchKnowledge(
  query: string,
  provider: string,
  model: string,
  topK?: number,
  currentFile?: string,
  apiKey?: string,
  baseUrl?: string,
): Promise<KnowledgeSearchResult[]> {
  return invoke<KnowledgeSearchResult[]>("search_knowledge", {
    query,
    topK: topK ?? null,
    currentFile: currentFile ?? null,
    provider,
    model,
    apiKey: apiKey ?? null,
    baseUrl: baseUrl ?? null,
  });
}
