# Phase 3B — AI Enhancement Implementation Notes

## Scope (§11.3 + §11.4 + §11.5)

### §11.3 Writing Flow Awareness
- WritingModeDetector: 7 modes (technical, academic, creative, skills, journal, notes, general)
- Mode-specific system prompts for Ghost Text
- SessionContextTracker: edit event circular buffer, 5-min sliding window analysis
- SessionMemory: rejection/preference tracking per file, prompt injection
- WritingFlowStore (Zustand) + ProseMirror plugin, wired to Ghost Text

### §11.4 Knowledge Q&A — Hybrid Search
- Rust chunker: heading-based split, merge short (<50 tokens), split long (>500 tokens)
- Embedding providers: Ollama, OpenAI, Gemini (Rust reqwest)
- VectorStore: in-memory brute-force cosine search, binary persistence
- HybridRanker: BM25 + vector + graph proximity, auto weight adjustment
- IPC commands: embed_text, search_knowledge, index_vault, index_status, index_file
- KnowledgeStore (Zustand) + embedding IPC wrapper
- CitationLink component + @vault/@folder reference in Chat Panel

### §11.5 Semantic Wikilink
- Entity extractor: dictionary-based (file names + aliases), case-insensitive, multi-word
- Ghost Link ProseMirror plugin: Decoration.inline, Tab/Esc keybindings, frequency control

## Dependencies (existing modules)
- `src/hooks/use-ghost-text.ts` — Ghost Text hook (inject WritingFlow context)
- `src/utils/ghost-text-prompt.ts` — prompt builder (mode-specific suffix)
- `src/stores/ai-store.ts` — AI state
- `src/utils/chat-context.ts` — @reference system (add @vault, @folder)
- `src/components/ai/AIChatPanel.tsx` — Chat Panel (add Knowledge Q&A mode)
- `src-tauri/src/search/mod.rs` — tantivy BM25 search (reuse for hybrid ranker)
- `src-tauri/src/index/mod.rs` — LinkIndex (graph proximity)
- `src-tauri/src/lib.rs` — command registration + managed state

## Technical Challenges
1. Rust embedding module: new crate dependency (none needed — uses reqwest which already exists)
2. VectorStore persistence: binary format for fast load, tempfile for tests
3. HybridRanker: normalize BM25 scores to [0,1], auto-detect query type
4. SessionContextTracker: circular buffer with 5-min window, pattern classification
5. Ghost Link frequency control: 30s cooldown, max 3 per paragraph, Esc suppression

## Edge Cases
- Empty vault (no files to index)
- Files with no headings (single chunk)
- Very long files (>500 tokens per section → paragraph-level split)
- Knowledge Q&A before index is ready (show "indexing..." status)
- Ghost Link on already-linked entities (must skip [[wikilink]] matches)
- Session memory with no feedback (return empty prompt context)

## Files to Create
### TypeScript (new)
- `src/utils/writing-mode-detector.ts`
- `src/utils/writing-mode-prompts.ts`
- `src/utils/session-context.ts`
- `src/utils/session-memory.ts`
- `src/stores/writing-flow-store.ts`
- `src/extensions/plugins/writing-flow.ts`
- `src/stores/knowledge-store.ts`
- `src/ipc/embedding.ts`
- `src/components/ai/CitationLink.tsx`
- `src/utils/entity-extractor.ts`
- `src/extensions/plugins/ghost-link.ts`

### TypeScript (tests)
- `src/utils/__tests__/writing-mode-detector.test.ts`
- `src/utils/__tests__/writing-mode-prompts.test.ts`
- `src/utils/__tests__/session-context.test.ts`
- `src/utils/__tests__/session-memory.test.ts`
- `src/stores/__tests__/writing-flow-store.test.ts`
- `src/stores/__tests__/knowledge-store.test.ts`
- `src/components/ai/__tests__/CitationLink.test.tsx`
- `src/utils/__tests__/entity-extractor.test.ts`
- `src/extensions/plugins/__tests__/ghost-link.test.ts`

### Rust (new)
- `src-tauri/src/embedding/mod.rs`
- `src-tauri/src/embedding/chunker.rs`
- `src-tauri/src/embedding/ollama_embed.rs`
- `src-tauri/src/embedding/openai_embed.rs`
- `src-tauri/src/embedding/gemini_embed.rs`
- `src-tauri/src/embedding/vector_store.rs`
- `src-tauri/src/embedding/hybrid_ranker.rs`
- `src-tauri/src/commands/embedding_cmd.rs`

### Files to Modify
- `src-tauri/src/lib.rs` — register embedding module + commands + managed state
- `src-tauri/Cargo.toml` — add tempfile dev-dependency
- `src/hooks/use-ghost-text.ts` — inject WritingFlow prompt context
- `src/utils/chat-context.ts` — add @vault/@folder reference
- `src/components/ai/AIChatPanel.tsx` — add Knowledge Q&A mode

## Implementation Order (parallelizable groups)

### Group A: Writing Flow (§11.3) — Tasks 13-17
1. Task 13: WritingModeDetector
2. Task 14: Writing Mode Prompts
3. Task 15: SessionContextTracker
4. Task 16: SessionMemory
5. Task 17: WritingFlowStore + plugin + Ghost Text wiring

### Group B: Knowledge Q&A Rust (§11.4) — Tasks 18-22
1. Task 18: Markdown Chunker
2. Task 19: Embedding Providers
3. Task 20: VectorStore
4. Task 21: HybridRanker
5. Task 22: Embedding IPC Commands

### Group C: Semantic Wikilink (§11.5) — Tasks 25-26
1. Task 25: Entity Extractor
2. Task 26: Ghost Link Plugin

### Group D: Knowledge Q&A Frontend (§11.4) — Tasks 23-24
(depends on Group B)
1. Task 23: KnowledgeStore + IPC wrapper
2. Task 24: CitationLink + Chat Panel integration

**Groups A, B, C can execute in parallel. Group D after Group B completes.**
