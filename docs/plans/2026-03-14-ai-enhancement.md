# AI Enhancement Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement AI enhancements from Part 11 design — per-task model routing, Ghost Text caching, contextual AI toolbar, privacy hardening, Writing Flow Awareness, Knowledge Q&A hybrid search, Semantic Wikilink, Agent Mode, Authorship Visualization, and Smart Templates.

**Architecture:** Layered approach — Phase 3A completes existing foundations (model routing, caching, privacy), Phase 3B adds differentiation features (Writing Flow, Knowledge Q&A, Semantic Wikilink), Phase 3C delivers advanced capabilities (Agent Mode, Authorship, Smart Templates). Each phase builds on previous infrastructure.

**Tech Stack:** TypeScript, React 19, Tiptap/ProseMirror, Zustand, Rust (Tauri 2.0), reqwest, tokio, tantivy, KaTeX, CodeMirror 6, Vitest, cargo test

**Spec:** `docs/design/part11-ai-enhancement.md`

---

## Chunk 1: Phase 3A — Per-task Model Routing (§11.2.1)

### Task 1: Extend `getConfigForTask()` to Return Full Config

**Files:**
- Modify: `src/utils/model-selection.ts`
- Test: `src/utils/__tests__/model-selection.test.ts`

- [ ] **Step 1: Write failing tests for full config return**

```typescript
// src/utils/__tests__/model-selection.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { getConfigForTask } from '../model-selection';
import { useAIStore } from '../../stores/ai-store';

describe('getConfigForTask — full config', () => {
  beforeEach(() => {
    useAIStore.setState({
      provider: 'claude',
      model: 'claude-sonnet-4-5',
      apiKey: 'sk-global',
      autoModelEnabled: false,
      providerForGhostText: 'openai',
      modelForGhostText: 'gpt-4o-mini',
      providerForInlineEdit: 'claude',
      modelForInlineEdit: 'claude-sonnet-4-5',
      providerForChat: undefined,
      modelForChat: undefined,
    });
  });

  it('returns global config when autoModelEnabled is false', () => {
    const config = getConfigForTask('ghost-text');
    expect(config.provider).toBe('claude');
    expect(config.model).toBe('claude-sonnet-4-5');
  });

  it('returns task-specific config when autoModelEnabled is true', () => {
    useAIStore.setState({ autoModelEnabled: true });
    const config = getConfigForTask('ghost-text');
    expect(config.provider).toBe('openai');
    expect(config.model).toBe('gpt-4o-mini');
  });

  it('falls back to global when task-specific is undefined', () => {
    useAIStore.setState({ autoModelEnabled: true });
    const config = getConfigForTask('chat');
    expect(config.provider).toBe('claude');
    expect(config.model).toBe('claude-sonnet-4-5');
  });

  it('returns apiKey for the resolved provider', () => {
    useAIStore.setState({
      autoModelEnabled: true,
      providerApiKeys: { openai: 'sk-openai-key' },
    });
    const config = getConfigForTask('ghost-text');
    expect(config.apiKey).toBe('sk-openai-key');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/utils/__tests__/model-selection.test.ts --reporter=verbose`
Expected: FAIL — tests reference new fields/behavior

- [ ] **Step 3: Implement full config resolution**

```typescript
// src/utils/model-selection.ts
import { useAIStore } from '../stores/ai-store';
import type { AITask } from '../stores/ai-store';

export interface TaskConfig {
  provider: string;
  model: string;
  apiKey?: string;
}

const taskProviderKeys: Record<AITask, string> = {
  'ghost-text': 'providerForGhostText',
  'inline-edit': 'providerForInlineEdit',
  'chat': 'providerForChat',
  'agent': 'providerForAgent',
};

const taskModelKeys: Record<AITask, string> = {
  'ghost-text': 'modelForGhostText',
  'inline-edit': 'modelForInlineEdit',
  'chat': 'modelForChat',
  'agent': 'modelForAgent',
};

export function getConfigForTask(task: AITask): TaskConfig {
  const state = useAIStore.getState();

  if (!state.autoModelEnabled) {
    return {
      provider: state.provider,
      model: state.model,
      apiKey: state.apiKey,
    };
  }

  const taskProvider = (state as Record<string, unknown>)[taskProviderKeys[task]] as string | undefined;
  const taskModel = (state as Record<string, unknown>)[taskModelKeys[task]] as string | undefined;

  const resolvedProvider = taskProvider || state.provider;
  const resolvedModel = taskModel || state.model;

  const apiKey = resolvedProvider === state.provider
    ? state.apiKey
    : state.providerApiKeys?.[resolvedProvider];

  return { provider: resolvedProvider, model: resolvedModel, apiKey };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/utils/__tests__/model-selection.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/model-selection.ts src/utils/__tests__/model-selection.test.ts
git commit -m "feat(§11.2.1): implement full per-task model config resolution"
```

### Task 2: Wire `useLLMStream` to Use Task-based Config

**Files:**
- Modify: `src/hooks/use-llm-stream.ts`
- Test: `src/hooks/__tests__/use-llm-stream.test.ts`

- [ ] **Step 1: Write failing test for task-aware send()**

```typescript
// src/hooks/__tests__/use-llm-stream.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLLMStream } from '../use-llm-stream';
import { useAIStore } from '../../stores/ai-store';

// Mock Tauri IPC
const mockInvoke = vi.fn().mockResolvedValue('req-123');
vi.mock('../../ipc/invoke', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

describe('useLLMStream — task-aware config', () => {
  beforeEach(() => {
    mockInvoke.mockClear();
    useAIStore.setState({
      provider: 'claude',
      model: 'claude-sonnet-4-5',
      apiKey: 'sk-global',
      autoModelEnabled: true,
      providerForGhostText: 'openai',
      modelForGhostText: 'gpt-4o-mini',
      providerApiKeys: { openai: 'sk-openai' },
    });
  });

  it('passes task-specific provider/model to IPC when task is provided', async () => {
    const { result } = renderHook(() => useLLMStream());
    await act(async () => {
      await result.current.send({
        prompt: 'test',
        systemPrompt: 'sys',
        task: 'ghost-text',
      });
    });

    expect(mockInvoke).toHaveBeenCalledWith(
      'llm_complete',
      expect.objectContaining({
        provider: 'openai',
        model: 'gpt-4o-mini',
      }),
    );
  });

  it('uses global config when no task is specified', async () => {
    const { result } = renderHook(() => useLLMStream());
    await act(async () => {
      await result.current.send({ prompt: 'test', systemPrompt: 'sys' });
    });

    expect(mockInvoke).toHaveBeenCalledWith(
      'llm_complete',
      expect.objectContaining({
        provider: 'claude',
        model: 'claude-sonnet-4-5',
      }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/hooks/__tests__/use-llm-stream.test.ts --reporter=verbose`
Expected: FAIL — `task` parameter not yet supported

- [ ] **Step 3: Add task parameter to send() and wire config**

Modify `src/hooks/use-llm-stream.ts`:
- Add `task?: AITask` to `SendOptions` interface
- In `send()`, call `getConfigForTask(task)` when `task` is provided
- Pass resolved `provider`, `model`, `apiKey` to `invoke('llm_complete', ...)`

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/hooks/__tests__/use-llm-stream.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/hooks/use-llm-stream.ts src/hooks/__tests__/use-llm-stream.test.ts
git commit -m "feat(§11.2.1): wire useLLMStream to per-task model routing"
```

### Task 3: Wire Ghost Text and Inline Edit Hooks

**Files:**
- Modify: `src/hooks/use-ghost-text.ts`
- Modify: `src/hooks/use-inline-ai.ts`
- Test: existing tests + manual verification

- [ ] **Step 1: Write test for ghost-text task routing**

```typescript
// Add to src/hooks/__tests__/use-ghost-text.test.ts
describe('ghost-text — task routing', () => {
  it('passes task="ghost-text" to useLLMStream.send()', async () => {
    // Verify the send() call includes task: 'ghost-text'
    // Use spy on useLLMStream's send to check task parameter
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/hooks/__tests__/use-ghost-text.test.ts --reporter=verbose`

- [ ] **Step 3: Add `task: 'ghost-text'` to send() call in use-ghost-text.ts**

In `use-ghost-text.ts`, find the `send()` call and add `task: 'ghost-text'` parameter.

- [ ] **Step 4: Add `task: 'inline-edit'` to send() call in use-inline-ai.ts**

In `use-inline-ai.ts`, find the `send()` call and add `task: 'inline-edit'` parameter.

- [ ] **Step 5: Run all AI-related tests**

Run: `npx vitest run src/hooks/__tests__/ --reporter=verbose`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add src/hooks/use-ghost-text.ts src/hooks/use-inline-ai.ts src/hooks/__tests__/
git commit -m "feat(§11.2.1): wire ghost-text and inline-edit to per-task routing"
```

---

## Chunk 2: Phase 3A — Ghost Text Prefetch & Caching (§11.2.2)

### Task 4: Implement Enhanced GhostTextCache

**Files:**
- Create: `src/utils/ghost-text-cache.ts`
- Test: `src/utils/__tests__/ghost-text-cache.test.ts`

- [ ] **Step 1: Write failing tests for GhostTextCache**

```typescript
// src/utils/__tests__/ghost-text-cache.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GhostTextCache } from '../ghost-text-cache';

describe('GhostTextCache', () => {
  let cache: GhostTextCache;

  beforeEach(() => {
    cache = new GhostTextCache({ maxSize: 5, ttlMs: 5000 });
  });

  it('stores and retrieves a suggestion by prefix hash', () => {
    cache.set('hello world', 'continuation text');
    expect(cache.get('hello world')).toBe('continuation text');
  });

  it('returns undefined for cache miss', () => {
    expect(cache.get('unknown')).toBeUndefined();
  });

  it('evicts oldest entry when maxSize exceeded', () => {
    for (let i = 0; i < 6; i++) {
      cache.set(`prefix-${i}`, `suggestion-${i}`);
    }
    expect(cache.get('prefix-0')).toBeUndefined();
    expect(cache.get('prefix-5')).toBe('suggestion-5');
  });

  it('expires entries after TTL', () => {
    vi.useFakeTimers();
    cache.set('prefix', 'suggestion');
    vi.advanceTimersByTime(5001);
    expect(cache.get('prefix')).toBeUndefined();
    vi.useRealTimers();
  });

  it('invalidates all entries for a given filePath', () => {
    cache.set('prefix-a', 'sug-a', 'file1.md');
    cache.set('prefix-b', 'sug-b', 'file1.md');
    cache.set('prefix-c', 'sug-c', 'file2.md');
    cache.invalidateFile('file1.md');
    expect(cache.get('prefix-a')).toBeUndefined();
    expect(cache.get('prefix-b')).toBeUndefined();
    expect(cache.get('prefix-c')).toBe('sug-c');
  });

  it('tracks hitCount on successful get', () => {
    cache.set('prefix', 'suggestion');
    cache.get('prefix');
    cache.get('prefix');
    expect(cache.getStats().hits).toBe(2);
  });

  it('clear() empties the cache', () => {
    cache.set('a', 'b');
    cache.clear();
    expect(cache.get('a')).toBeUndefined();
    expect(cache.getStats().size).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/utils/__tests__/ghost-text-cache.test.ts --reporter=verbose`
Expected: FAIL — module not found

- [ ] **Step 3: Implement GhostTextCache**

```typescript
// src/utils/ghost-text-cache.ts
interface CacheEntry {
  prefix: string;
  suggestion: string;
  filePath?: string;
  timestamp: number;
  hitCount: number;
}

interface CacheOptions {
  maxSize?: number;
  ttlMs?: number;
}

export class GhostTextCache {
  private entries = new Map<string, CacheEntry>();
  private maxSize: number;
  private ttlMs: number;
  private totalHits = 0;

  constructor(options: CacheOptions = {}) {
    this.maxSize = options.maxSize ?? 50;
    this.ttlMs = options.ttlMs ?? 5 * 60 * 1000;
  }

  private hash(prefix: string): string {
    // Use last 200 chars as key
    const key = prefix.slice(-200);
    let h = 0;
    for (let i = 0; i < key.length; i++) {
      h = ((h << 5) - h + key.charCodeAt(i)) | 0;
    }
    return String(h);
  }

  set(prefix: string, suggestion: string, filePath?: string): void {
    const key = this.hash(prefix);
    if (this.entries.size >= this.maxSize && !this.entries.has(key)) {
      // Evict oldest
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(key, {
      prefix,
      suggestion,
      filePath,
      timestamp: Date.now(),
      hitCount: 0,
    });
  }

  get(prefix: string): string | undefined {
    const key = this.hash(prefix);
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.entries.delete(key);
      return undefined;
    }
    entry.hitCount++;
    this.totalHits++;
    return entry.suggestion;
  }

  invalidateFile(filePath: string): void {
    for (const [key, entry] of this.entries) {
      if (entry.filePath === filePath) {
        this.entries.delete(key);
      }
    }
  }

  clear(): void {
    this.entries.clear();
    this.totalHits = 0;
  }

  getStats(): { size: number; hits: number } {
    return { size: this.entries.size, hits: this.totalHits };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/utils/__tests__/ghost-text-cache.test.ts --reporter=verbose`
Expected: PASS (all 7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/utils/ghost-text-cache.ts src/utils/__tests__/ghost-text-cache.test.ts
git commit -m "feat(§11.2.2): implement GhostTextCache with TTL, eviction, file invalidation"
```

### Task 5: Integrate Cache into use-ghost-text Hook

**Files:**
- Modify: `src/hooks/use-ghost-text.ts`
- Test: `src/hooks/__tests__/use-ghost-text.test.ts`

- [ ] **Step 1: Write failing test for cache integration**

```typescript
// Add to src/hooks/__tests__/use-ghost-text.test.ts
describe('ghost-text — cache integration', () => {
  it('returns cached suggestion without LLM call on cache hit', () => {
    // 1. Trigger ghost text for prefix "Hello world."
    // 2. Verify LLM send() was called
    // 3. Trigger again with same prefix
    // 4. Verify LLM send() was NOT called again
    // 5. Verify same suggestion displayed
  });

  it('invalidates cache when file becomes dirty', () => {
    // Set cache entry, then set dirty flag → cache miss
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/hooks/__tests__/use-ghost-text.test.ts --reporter=verbose`

- [ ] **Step 3: Wire GhostTextCache into use-ghost-text.ts**

In `use-ghost-text.ts`:
1. Create module-level `const ghostCache = new GhostTextCache()` singleton
2. Before calling `send()`, check `ghostCache.get(currentPrefix)`
3. If hit, set suggestion directly without LLM call
4. After LLM response, store in `ghostCache.set(prefix, suggestion, filePath)`
5. On file change, call `ghostCache.invalidateFile(previousFilePath)`

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/hooks/__tests__/use-ghost-text.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/hooks/use-ghost-text.ts src/hooks/__tests__/use-ghost-text.test.ts
git commit -m "feat(§11.2.2): integrate GhostTextCache into use-ghost-text hook"
```

### Task 6: Implement Prefetch on Paragraph Completion

**Files:**
- Modify: `src/hooks/use-ghost-text.ts`
- Test: `src/hooks/__tests__/use-ghost-text.test.ts`

- [ ] **Step 1: Write failing test for prefetch trigger**

```typescript
describe('ghost-text — prefetch', () => {
  it('triggers background prefetch after ghost-text acceptance at paragraph end', () => {
    // 1. Simulate Tab acceptance at end of paragraph (ends with '.')
    // 2. Verify a background LLM request fires
    // 3. Verify result stored in cache
  });

  it('does not prefetch if paragraph has < 2 sentences', () => {
    // Short paragraph → no prefetch
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Implement prefetch logic**

Add `triggerPrefetch(currentText: string, cursorPos: number)` helper:
- Check: text ends with sentence-ending punctuation (`.`, `!`, `?`, `。`)
- Check: text contains ≥ 2 sentences (count sentence-ending marks)
- Check: no existing prefetch cache for next-line context
- Fire background `send()` with `isPrefetch: true` flag (lower priority)

- [ ] **Step 4: Run tests to verify they pass**

- [ ] **Step 5: Commit**

```bash
git add src/hooks/use-ghost-text.ts src/hooks/__tests__/use-ghost-text.test.ts
git commit -m "feat(§11.2.2): add paragraph-end prefetch for ghost text"
```

---

## Chunk 3: Phase 3A — Contextual AI Toolbar (§11.2.3)

### Task 7: Implement Content Type Detector

**Files:**
- Create: `src/utils/content-type-detector.ts`
- Test: `src/utils/__tests__/content-type-detector.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/utils/__tests__/content-type-detector.test.ts
import { describe, it, expect } from 'vitest';
import { detectContentType, ContentMode } from '../content-type-detector';

describe('detectContentType', () => {
  it('returns CODE when selection contains codeBlock', () => {
    const nodeTypes = [{ type: 'codeBlock' }];
    expect(detectContentType(nodeTypes)).toBe('code');
  });

  it('returns MATH when selection contains mathBlock', () => {
    const nodeTypes = [{ type: 'mathBlock' }];
    expect(detectContentType(nodeTypes)).toBe('math');
  });

  it('returns TABLE when selection contains table', () => {
    const nodeTypes = [{ type: 'table' }];
    expect(detectContentType(nodeTypes)).toBe('table');
  });

  it('returns STRUCTURE when selection has heading + paragraph', () => {
    const nodeTypes = [{ type: 'heading' }, { type: 'paragraph' }];
    expect(detectContentType(nodeTypes)).toBe('structure');
  });

  it('returns TEXT as default for paragraphs only', () => {
    const nodeTypes = [{ type: 'paragraph' }];
    expect(detectContentType(nodeTypes)).toBe('text');
  });

  it('prioritizes CODE over TEXT when mixed', () => {
    const nodeTypes = [{ type: 'paragraph' }, { type: 'codeBlock' }];
    expect(detectContentType(nodeTypes)).toBe('code');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/utils/__tests__/content-type-detector.test.ts --reporter=verbose`
Expected: FAIL — module not found

- [ ] **Step 3: Implement content-type-detector.ts**

```typescript
// src/utils/content-type-detector.ts
export type ContentMode = 'text' | 'code' | 'math' | 'table' | 'structure';

interface NodeInfo {
  type: string;
}

export function detectContentType(nodes: NodeInfo[]): ContentMode {
  const types = new Set(nodes.map((n) => n.type));

  if (types.has('codeBlock')) return 'code';
  if (types.has('mathBlock') || types.has('mathInline')) return 'math';
  if (types.has('table')) return 'table';
  if (types.has('heading') && types.has('paragraph')) return 'structure';
  return 'text';
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/utils/__tests__/content-type-detector.test.ts --reporter=verbose`
Expected: PASS (all 6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/utils/content-type-detector.ts src/utils/__tests__/content-type-detector.test.ts
git commit -m "feat(§11.2.3): implement content type detector for contextual AI toolbar"
```

### Task 8: Define Mode-specific AI Menu Actions

**Files:**
- Create: `src/utils/contextual-ai-actions.ts`
- Test: `src/utils/__tests__/contextual-ai-actions.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/utils/__tests__/contextual-ai-actions.test.ts
import { describe, it, expect } from 'vitest';
import { getActionsForMode } from '../contextual-ai-actions';

describe('getActionsForMode', () => {
  it('returns 6 actions for text mode', () => {
    const actions = getActionsForMode('text');
    expect(actions).toHaveLength(6);
    expect(actions.map((a) => a.id)).toEqual([
      'improve', 'shorten', 'expand', 'translate', 'tone', 'explain',
    ]);
  });

  it('returns 5 actions for code mode', () => {
    const actions = getActionsForMode('code');
    expect(actions).toHaveLength(5);
    expect(actions.map((a) => a.id)).toContain('optimize');
    expect(actions.map((a) => a.id)).toContain('find-bugs');
  });

  it('returns 4 actions for math mode', () => {
    const actions = getActionsForMode('math');
    expect(actions).toHaveLength(4);
  });

  it('returns 4 actions for table mode', () => {
    const actions = getActionsForMode('table');
    expect(actions).toHaveLength(4);
  });

  it('returns 4 actions for structure mode', () => {
    const actions = getActionsForMode('structure');
    expect(actions).toHaveLength(4);
  });

  it('each action has id, label, icon, systemPrompt', () => {
    const actions = getActionsForMode('code');
    for (const action of actions) {
      expect(action).toHaveProperty('id');
      expect(action).toHaveProperty('label');
      expect(action).toHaveProperty('systemPrompt');
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/utils/__tests__/contextual-ai-actions.test.ts --reporter=verbose`

- [ ] **Step 3: Implement contextual-ai-actions.ts**

```typescript
// src/utils/contextual-ai-actions.ts
import type { ContentMode } from './content-type-detector';

export interface AIAction {
  id: string;
  label: string;
  systemPrompt: string;
}

const TEXT_ACTIONS: AIAction[] = [
  { id: 'improve', label: '개선', systemPrompt: 'Improve the following text for clarity, grammar, and flow. Output only the improved text.' },
  { id: 'shorten', label: '줄이기', systemPrompt: 'Make the following text more concise while preserving meaning. Output only the shortened text.' },
  { id: 'expand', label: '늘리기', systemPrompt: 'Expand the following text with more detail and explanation. Output only the expanded text.' },
  { id: 'translate', label: '번역', systemPrompt: 'Translate the following text to the target language. Output only the translation.' },
  { id: 'tone', label: '톤 변경', systemPrompt: 'Rewrite the following text in the requested tone. Output only the rewritten text.' },
  { id: 'explain', label: '설명', systemPrompt: 'Explain the following text in simple terms. Output only the explanation.' },
];

const CODE_ACTIONS: AIAction[] = [
  { id: 'add-comments', label: '설명 추가', systemPrompt: 'Add clear, concise comments to the following code. Output only the commented code.' },
  { id: 'optimize', label: '최적화', systemPrompt: 'Optimize the following code for performance and readability. Output only the optimized code.' },
  { id: 'find-bugs', label: '버그 찾기', systemPrompt: 'Analyze the following code for potential bugs and issues. List each bug with explanation.' },
  { id: 'convert-lang', label: '변환', systemPrompt: 'Convert the following code to the target language. Output only the converted code.' },
  { id: 'gen-tests', label: '테스트 생성', systemPrompt: 'Generate unit tests for the following code. Output only the test code.' },
];

const MATH_ACTIONS: AIAction[] = [
  { id: 'solve-steps', label: '풀이 과정', systemPrompt: 'Show step-by-step solution for the following LaTeX expression.' },
  { id: 'fix-latex', label: 'LaTeX 수정', systemPrompt: 'Fix any LaTeX syntax errors in the following expression. Output only corrected LaTeX.' },
  { id: 'explain-math', label: '자연어 설명', systemPrompt: 'Explain the following mathematical expression in plain language.' },
  { id: 'related-formulas', label: '관련 공식', systemPrompt: 'List related formulas and identities for the following expression.' },
];

const TABLE_ACTIONS: AIAction[] = [
  { id: 'analyze-data', label: '데이터 분석', systemPrompt: 'Analyze the following markdown table data and provide insights.' },
  { id: 'fill-cells', label: '빈 셀 채우기', systemPrompt: 'Fill in empty cells in the following table based on patterns in existing data.' },
  { id: 'suggest-rows', label: '행/열 추가 제안', systemPrompt: 'Suggest additional rows or columns for the following table.' },
  { id: 'to-csv', label: 'CSV 변환', systemPrompt: 'Convert the following markdown table to CSV format.' },
];

const STRUCTURE_ACTIONS: AIAction[] = [
  { id: 'gen-toc', label: '목차 생성', systemPrompt: 'Generate a table of contents for the following document structure.' },
  { id: 'improve-structure', label: '구조 개선', systemPrompt: 'Suggest improvements to the document structure.' },
  { id: 'split-sections', label: '섹션 분리', systemPrompt: 'Suggest how to split this content into separate sections.' },
  { id: 'summarize', label: '요약', systemPrompt: 'Summarize the following document section.' },
];

const MODE_ACTIONS: Record<ContentMode, AIAction[]> = {
  text: TEXT_ACTIONS,
  code: CODE_ACTIONS,
  math: MATH_ACTIONS,
  table: TABLE_ACTIONS,
  structure: STRUCTURE_ACTIONS,
};

export function getActionsForMode(mode: ContentMode): AIAction[] {
  return MODE_ACTIONS[mode];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/utils/__tests__/contextual-ai-actions.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/contextual-ai-actions.ts src/utils/__tests__/contextual-ai-actions.test.ts
git commit -m "feat(§11.2.3): define mode-specific AI actions for contextual toolbar"
```

### Task 9: Wire Contextual AI Menu into FloatingToolbar

**Files:**
- Modify: `src/components/toolbar/FloatingToolbar.tsx`
- Test: `src/components/toolbar/__tests__/FloatingToolbar.test.tsx`

- [ ] **Step 1: Write failing test for mode-based menu rendering**

```typescript
// In FloatingToolbar test file
describe('FloatingToolbar — contextual AI menu', () => {
  it('shows code-specific actions when codeBlock is selected', () => {
    // Render toolbar with selection containing codeBlock
    // Click AI button → verify code actions appear
  });

  it('shows text actions by default for paragraph selection', () => {
    // Render toolbar with paragraph selection
    // Click AI button → verify text actions appear
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Integrate content-type-detector and contextual-ai-actions into FloatingToolbar**

In `FloatingToolbar.tsx`:
1. Import `detectContentType` and `getActionsForMode`
2. On AI button click, detect content mode from current selection
3. Render mode-specific action list in dropdown

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/toolbar/__tests__/ --reporter=verbose`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/toolbar/FloatingToolbar.tsx src/components/toolbar/__tests__/
git commit -m "feat(§11.2.3): integrate contextual AI menu into FloatingToolbar"
```

---

## Chunk 4: Phase 3A — Privacy Mode Hardening (§11.2.4)

### Task 10: Add no-store Headers to Rust LLM Backends

**Files:**
- Modify: `src-tauri/src/llm/claude.rs`
- Modify: `src-tauri/src/llm/openai.rs`
- Modify: `src-tauri/src/llm/mod.rs`
- Test: `src-tauri/src/llm/` (unit tests in each file)

- [ ] **Step 1: Write failing Rust tests for no-store headers**

```rust
// In src-tauri/src/llm/claude.rs — add to tests module
#[test]
fn test_privacy_mode_adds_no_store_header() {
    let headers = build_headers("sk-key", true); // privacy_mode = true
    assert_eq!(headers.get("anthropic-no-store").unwrap(), "true");
}

#[test]
fn test_normal_mode_no_extra_header() {
    let headers = build_headers("sk-key", false);
    assert!(headers.get("anthropic-no-store").is_none());
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src-tauri && cargo test llm --lib -- --nocapture`
Expected: FAIL — `build_headers` doesn't accept `privacy_mode` parameter

- [ ] **Step 3: Add privacy_mode parameter to LLM backends**

In `src-tauri/src/llm/mod.rs`:
- Add `privacy_mode: bool` to `LlmRequest` struct
- Pass through to provider functions

In `claude.rs`:
- `build_headers(api_key, privacy_mode)` → add `anthropic-no-store: true` when enabled

In `openai.rs`:
- Add `store: false` to request body when privacy_mode is true (OpenAI data retention opt-out)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd src-tauri && cargo test llm --lib -- --nocapture`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/llm/
git commit -m "feat(§11.2.4): add no-store headers for privacy mode in Rust LLM backends"
```

### Task 11: Implement Per-file Privacy Detection

**Files:**
- Modify: `src/utils/privacy-check.ts`
- Test: `src/utils/__tests__/privacy-check.test.ts`

- [ ] **Step 1: Write failing tests for per-file privacy**

```typescript
// src/utils/__tests__/privacy-check.test.ts
import { describe, it, expect } from 'vitest';
import { checkFilePrivacy } from '../privacy-check';

describe('checkFilePrivacy', () => {
  it('returns true when frontmatter contains privacy: true', () => {
    const markdown = '---\ntitle: Secret\nprivacy: true\n---\n\nContent';
    expect(checkFilePrivacy(markdown)).toBe(true);
  });

  it('returns false when frontmatter has no privacy field', () => {
    const markdown = '---\ntitle: Public\n---\n\nContent';
    expect(checkFilePrivacy(markdown)).toBe(false);
  });

  it('returns false when no frontmatter', () => {
    expect(checkFilePrivacy('# Hello')).toBe(false);
  });

  it('returns false when privacy: false explicitly', () => {
    const markdown = '---\nprivacy: false\n---\n\nContent';
    expect(checkFilePrivacy(markdown)).toBe(false);
  });
});

describe('isLLMAllowed — with filePrivacy', () => {
  it('blocks cloud providers when filePrivacy is true', () => {
    expect(isLLMAllowed(false, 'claude', true)).toBe(false);
    expect(isLLMAllowed(false, 'openai', true)).toBe(false);
  });

  it('allows ollama when filePrivacy is true', () => {
    expect(isLLMAllowed(false, 'ollama', true)).toBe(true);
  });

  it('uses global privacy when filePrivacy is false', () => {
    expect(isLLMAllowed(false, 'claude', false)).toBe(true);
    expect(isLLMAllowed(true, 'claude', false)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/utils/__tests__/privacy-check.test.ts --reporter=verbose`

- [ ] **Step 3: Implement checkFilePrivacy and extend isLLMAllowed**

```typescript
// Add to src/utils/privacy-check.ts
export function checkFilePrivacy(markdown: string): boolean {
  const fmMatch = markdown.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return false;
  return /^privacy:\s*true$/m.test(fmMatch[1]);
}

// Extend existing isLLMAllowed signature
export function isLLMAllowed(
  globalPrivacy: boolean,
  provider: string,
  filePrivacy = false,
): boolean {
  if (filePrivacy || globalPrivacy) {
    return provider === 'ollama';
  }
  return true;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/utils/__tests__/privacy-check.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/privacy-check.ts src/utils/__tests__/privacy-check.test.ts
git commit -m "feat(§11.2.4): implement per-file privacy detection and LLM gating"
```

### Task 12: Add Privacy Status to StatusBar

**Files:**
- Modify: `src/components/toolbar/StatusBar.tsx`
- Test: `src/components/toolbar/__tests__/StatusBar.test.tsx`

- [ ] **Step 1: Write failing test for privacy indicator**

```typescript
describe('StatusBar — privacy indicator', () => {
  it('shows lock icon when global privacy is ON', () => {
    useSettingsStore.setState({ privacyMode: true });
    render(<StatusBar />);
    expect(screen.getByTestId('privacy-indicator')).toBeInTheDocument();
    expect(screen.getByTestId('privacy-indicator')).toHaveTextContent('🔒');
  });

  it('shows file lock icon when file privacy is ON', () => {
    // Set filePrivacy via editor context
    render(<StatusBar />);
    expect(screen.getByTestId('privacy-indicator')).toHaveTextContent('🔒');
  });

  it('shows no indicator when privacy is OFF', () => {
    useSettingsStore.setState({ privacyMode: false });
    render(<StatusBar />);
    expect(screen.queryByTestId('privacy-indicator')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Add privacy indicator to StatusBar component**

- [ ] **Step 4: Run tests to verify they pass**

- [ ] **Step 5: Commit**

```bash
git add src/components/toolbar/StatusBar.tsx src/components/toolbar/__tests__/
git commit -m "feat(§11.2.4): add privacy status indicator to StatusBar"
```

---

## Chunk 5: Phase 3B — Writing Flow Awareness (§11.3)

### Task 13: Implement WritingModeDetector

**Files:**
- Create: `src/utils/writing-mode-detector.ts`
- Test: `src/utils/__tests__/writing-mode-detector.test.ts`

- [ ] **Step 1: Write failing tests for all 7 writing modes**

```typescript
// src/utils/__tests__/writing-mode-detector.test.ts
import { describe, it, expect } from 'vitest';
import { detectWritingMode, WritingMode } from '../writing-mode-detector';

describe('detectWritingMode', () => {
  it('returns technical for docs/ path', () => {
    const result = detectWritingMode({ filePath: 'docs/api.md', nodeTypes: {}, frontmatter: {} });
    expect(result.mode).toBe('technical');
  });

  it('returns skills for skills/ path', () => {
    const result = detectWritingMode({ filePath: 'skills/summarizer.md', nodeTypes: {}, frontmatter: {} });
    expect(result.mode).toBe('skills');
  });

  it('returns journal for journal/ path', () => {
    const result = detectWritingMode({ filePath: 'journal/2026-03-14.md', nodeTypes: {}, frontmatter: {} });
    expect(result.mode).toBe('journal');
  });

  it('returns academic when mathBlock count >= 2', () => {
    const result = detectWritingMode({
      filePath: 'paper.md',
      nodeTypes: { mathBlock: 3, paragraph: 10 },
      frontmatter: {},
    });
    expect(result.mode).toBe('academic');
  });

  it('returns academic for frontmatter type: paper', () => {
    const result = detectWritingMode({
      filePath: 'thesis.md',
      nodeTypes: { paragraph: 5 },
      frontmatter: { type: 'paper' },
    });
    expect(result.mode).toBe('academic');
  });

  it('returns creative for short paragraphs with high inline marks', () => {
    const result = detectWritingMode({
      filePath: 'essay.md',
      nodeTypes: { paragraph: 20 },
      frontmatter: {},
      avgParagraphLength: 30,
      inlineMarkRatio: 0.15,
    });
    expect(result.mode).toBe('creative');
  });

  it('returns notes for many list items and wikilinks', () => {
    const result = detectWritingMode({
      filePath: 'brainstorm.md',
      nodeTypes: { paragraph: 5, listItem: 15, wikiLink: 3 },
      frontmatter: {},
    });
    expect(result.mode).toBe('notes');
  });

  it('returns general as fallback', () => {
    const result = detectWritingMode({
      filePath: 'readme.md',
      nodeTypes: { paragraph: 3 },
      frontmatter: {},
    });
    expect(result.mode).toBe('general');
  });

  it('includes confidence score', () => {
    const result = detectWritingMode({ filePath: 'docs/api.md', nodeTypes: {}, frontmatter: {} });
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/utils/__tests__/writing-mode-detector.test.ts --reporter=verbose`

- [ ] **Step 3: Implement WritingModeDetector**

```typescript
// src/utils/writing-mode-detector.ts
export type WritingMode = 'technical' | 'academic' | 'creative' | 'skills' | 'journal' | 'notes' | 'general';

interface DetectorInput {
  filePath: string;
  nodeTypes: Record<string, number>;
  frontmatter: Record<string, unknown>;
  avgParagraphLength?: number;
  inlineMarkRatio?: number;
}

interface DetectorResult {
  mode: WritingMode;
  confidence: number;
}

export function detectWritingMode(input: DetectorInput): DetectorResult {
  // Priority 1: Explicit frontmatter type
  if (input.frontmatter.type === 'paper') return { mode: 'academic', confidence: 0.95 };
  if (input.frontmatter.type === 'journal') return { mode: 'journal', confidence: 0.95 };

  // Priority 2: Path patterns
  if (/^skills\//.test(input.filePath) || /\.skill\.md$/.test(input.filePath)) {
    return { mode: 'skills', confidence: 0.9 };
  }
  if (/^journal\//.test(input.filePath)) return { mode: 'journal', confidence: 0.9 };
  if (/^docs\//.test(input.filePath)) return { mode: 'technical', confidence: 0.8 };

  // Priority 3: Document structure
  const { nodeTypes } = input;
  const mathCount = (nodeTypes.mathBlock ?? 0) + (nodeTypes.mathInline ?? 0);
  if (mathCount >= 2) return { mode: 'academic', confidence: 0.8 };

  const codeCount = nodeTypes.codeBlock ?? 0;
  if (codeCount >= 3) return { mode: 'technical', confidence: 0.7 };

  const listItemCount = nodeTypes.listItem ?? 0;
  const wikiLinkCount = nodeTypes.wikiLink ?? 0;
  const totalNodes = Object.values(nodeTypes).reduce((s, n) => s + n, 0) || 1;
  if (listItemCount / totalNodes > 0.5 || wikiLinkCount >= 2) {
    return { mode: 'notes', confidence: 0.7 };
  }

  // Priority 4: Editing patterns
  if (input.avgParagraphLength && input.avgParagraphLength < 50 && (input.inlineMarkRatio ?? 0) > 0.1) {
    return { mode: 'creative', confidence: 0.6 };
  }

  return { mode: 'general', confidence: 0.5 };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/utils/__tests__/writing-mode-detector.test.ts --reporter=verbose`
Expected: PASS (all 9 tests)

- [ ] **Step 5: Commit**

```bash
git add src/utils/writing-mode-detector.ts src/utils/__tests__/writing-mode-detector.test.ts
git commit -m "feat(§11.3.1): implement WritingModeDetector with 7 modes + confidence"
```

### Task 14: Implement Writing Mode System Prompts

**Files:**
- Create: `src/utils/writing-mode-prompts.ts`
- Test: `src/utils/__tests__/writing-mode-prompts.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/utils/__tests__/writing-mode-prompts.test.ts
import { describe, it, expect } from 'vitest';
import { getSystemPromptForMode } from '../writing-mode-prompts';

describe('getSystemPromptForMode', () => {
  it('includes common preamble for all modes', () => {
    for (const mode of ['technical', 'academic', 'creative', 'skills', 'journal', 'notes', 'general'] as const) {
      const prompt = getSystemPromptForMode(mode);
      expect(prompt).toContain('Continue the user\'s text naturally');
    }
  });

  it('includes technical-specific instructions for technical mode', () => {
    const prompt = getSystemPromptForMode('technical');
    expect(prompt).toContain('technical terminology');
  });

  it('includes academic-specific instructions for academic mode', () => {
    const prompt = getSystemPromptForMode('academic');
    expect(prompt).toContain('formal academic');
  });

  it('includes skills-specific instructions for skills mode', () => {
    const prompt = getSystemPromptForMode('skills');
    expect(prompt).toContain('XML');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement writing-mode-prompts.ts**

Define `COMMON_PREAMBLE` and `MODE_APPENDIX` map, compose via `getSystemPromptForMode(mode)`.

- [ ] **Step 4: Run tests to verify they pass**

- [ ] **Step 5: Commit**

```bash
git add src/utils/writing-mode-prompts.ts src/utils/__tests__/writing-mode-prompts.test.ts
git commit -m "feat(§11.3.1): define mode-specific system prompts for Writing Flow"
```

### Task 15: Implement Session Context Tracker

**Files:**
- Create: `src/utils/session-context.ts`
- Test: `src/utils/__tests__/session-context.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/utils/__tests__/session-context.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionContextTracker, EditEvent } from '../session-context';

describe('SessionContextTracker', () => {
  let tracker: SessionContextTracker;

  beforeEach(() => {
    tracker = new SessionContextTracker();
  });

  it('records edit events up to buffer limit (100)', () => {
    for (let i = 0; i < 120; i++) {
      tracker.record({ type: 'insert', nodeType: 'paragraph', textLength: 10, timestamp: Date.now() + i });
    }
    expect(tracker.getEvents()).toHaveLength(100);
  });

  it('analyzes 5-min window for dominant pattern', () => {
    const now = Date.now();
    for (let i = 0; i < 20; i++) {
      tracker.record({ type: 'insert', nodeType: 'listItem', textLength: 15, timestamp: now - i * 1000 });
    }
    const analysis = tracker.analyze();
    expect(analysis.dominantPattern).toBe('list-writing');
  });

  it('detects fast continuous typing as freewriting', () => {
    const now = Date.now();
    for (let i = 0; i < 30; i++) {
      tracker.record({ type: 'insert', nodeType: 'paragraph', textLength: 50, timestamp: now - i * 500 });
    }
    const analysis = tracker.analyze();
    expect(analysis.wordsPerMinute).toBeGreaterThan(30);
  });

  it('detects high delete ratio as review mode', () => {
    const now = Date.now();
    for (let i = 0; i < 10; i++) {
      tracker.record({ type: 'delete', nodeType: 'paragraph', textLength: 20, timestamp: now - i * 2000 });
    }
    for (let i = 0; i < 3; i++) {
      tracker.record({ type: 'insert', nodeType: 'paragraph', textLength: 5, timestamp: now - i * 2000 });
    }
    const analysis = tracker.analyze();
    expect(analysis.dominantPattern).toBe('reviewing');
  });

  it('generates context string for Ghost Text prompt', () => {
    const now = Date.now();
    for (let i = 0; i < 10; i++) {
      tracker.record({ type: 'insert', nodeType: 'listItem', textLength: 20, timestamp: now - i * 1000 });
    }
    const context = tracker.toPromptContext();
    expect(context).toContain('list');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement SessionContextTracker**

Circular buffer of 100 EditEvents, 5-min sliding window analysis, pattern detection (list-writing, paragraph-writing, structure-editing, code-writing, reviewing), words-per-minute calculation, `toPromptContext()` serializer.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/utils/__tests__/session-context.test.ts --reporter=verbose`

- [ ] **Step 5: Commit**

```bash
git add src/utils/session-context.ts src/utils/__tests__/session-context.test.ts
git commit -m "feat(§11.3.2): implement SessionContextTracker with edit pattern analysis"
```

### Task 16: Implement Session Memory

**Files:**
- Create: `src/utils/session-memory.ts`
- Test: `src/utils/__tests__/session-memory.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/utils/__tests__/session-memory.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { SessionMemory } from '../session-memory';

describe('SessionMemory', () => {
  let memory: SessionMemory;

  beforeEach(() => {
    memory = new SessionMemory('test-file.md');
  });

  it('records rejection', () => {
    memory.recordRejection('This is too formal');
    expect(memory.getRejections()).toHaveLength(1);
  });

  it('limits rejections to 10', () => {
    for (let i = 0; i < 15; i++) {
      memory.recordRejection(`rejection-${i}`);
    }
    expect(memory.getRejections()).toHaveLength(10);
  });

  it('adds avoid pattern from explicit feedback', () => {
    memory.addAvoidPattern('too formal');
    expect(memory.getPreferences().avoidPatterns).toContain('too formal');
  });

  it('adds prefer pattern', () => {
    memory.addPreferPattern('use Korean');
    expect(memory.getPreferences().preferPatterns).toContain('use Korean');
  });

  it('generates prompt injection string', () => {
    memory.recordRejection('Too verbose suggestion');
    memory.addPreferPattern('concise');
    const prompt = memory.toPromptContext();
    expect(prompt).toContain('DO NOT');
    expect(prompt).toContain('concise');
  });

  it('returns empty string when no feedback collected', () => {
    expect(memory.toPromptContext()).toBe('');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement SessionMemory**

- [ ] **Step 4: Run tests to verify they pass**

- [ ] **Step 5: Commit**

```bash
git add src/utils/session-memory.ts src/utils/__tests__/session-memory.test.ts
git commit -m "feat(§11.3.3): implement SessionMemory for AI feedback tracking"
```

### Task 17: Create WritingFlowStore and Wire to Ghost Text

**Files:**
- Create: `src/stores/writing-flow-store.ts`
- Create: `src/extensions/plugins/writing-flow.ts`
- Test: `src/stores/__tests__/writing-flow-store.test.ts`

- [ ] **Step 1: Write failing tests for WritingFlowStore**

```typescript
// src/stores/__tests__/writing-flow-store.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useWritingFlowStore } from '../writing-flow-store';

describe('WritingFlowStore', () => {
  beforeEach(() => {
    useWritingFlowStore.getState().reset();
  });

  it('initializes with general mode', () => {
    expect(useWritingFlowStore.getState().currentMode).toBe('general');
  });

  it('updates mode via setMode()', () => {
    useWritingFlowStore.getState().setMode('technical', 0.8);
    expect(useWritingFlowStore.getState().currentMode).toBe('technical');
    expect(useWritingFlowStore.getState().modeConfidence).toBe(0.8);
  });

  it('provides compositePromptContext() combining mode + session + memory', () => {
    useWritingFlowStore.getState().setMode('technical', 0.9);
    const ctx = useWritingFlowStore.getState().compositePromptContext();
    expect(ctx).toContain('technical');
  });

  it('resets sessionMemory per file', () => {
    useWritingFlowStore.getState().switchFile('file-a.md');
    useWritingFlowStore.getState().getSessionMemory().addAvoidPattern('test');
    useWritingFlowStore.getState().switchFile('file-b.md');
    expect(useWritingFlowStore.getState().getSessionMemory().getPreferences().avoidPatterns).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement WritingFlowStore**

Zustand store with: `currentMode`, `modeConfidence`, `sessionContext` (SessionContextTracker), `sessionMemories` (Map<fileId, SessionMemory>), `compositePromptContext()` method.

- [ ] **Step 4: Implement writing-flow ProseMirror plugin**

ProseMirror plugin that listens to transactions, feeds EditEvents to SessionContextTracker, and triggers WritingMode re-detection on significant changes.

- [ ] **Step 5: Run tests to verify they pass**

- [ ] **Step 6: Wire compositePromptContext into use-ghost-text.ts**

In `use-ghost-text.ts`, before sending to LLM, append `useWritingFlowStore.getState().compositePromptContext()` to system prompt.

- [ ] **Step 7: Commit**

```bash
git add src/stores/writing-flow-store.ts src/extensions/plugins/writing-flow.ts src/stores/__tests__/writing-flow-store.test.ts
git commit -m "feat(§11.3): implement WritingFlowStore + ProseMirror plugin + Ghost Text integration"
```

---

## Chunk 6: Phase 3B — Knowledge Q&A — Rust Backend (§11.4)

### Task 18: Implement Markdown Chunker (Rust)

**Files:**
- Create: `src-tauri/src/embedding/mod.rs`
- Create: `src-tauri/src/embedding/chunker.rs`
- Modify: `src-tauri/src/lib.rs` (register module)
- Test: unit tests in `chunker.rs`

- [ ] **Step 1: Write failing Rust tests for chunker**

```rust
// src-tauri/src/embedding/chunker.rs
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_splits_by_headings() {
        let md = "# Title\n\nParagraph 1\n\n## Section A\n\nParagraph 2\n\n## Section B\n\nParagraph 3";
        let chunks = chunk_markdown(md, "test.md");
        assert_eq!(chunks.len(), 3);
        assert_eq!(chunks[0].heading_path, vec!["Title"]);
        assert_eq!(chunks[1].heading_path, vec!["Title", "Section A"]);
    }

    #[test]
    fn test_merges_short_chunks() {
        let md = "# Title\n\nShort.\n\n## Sub\n\nAlso short.";
        let chunks = chunk_markdown(md, "test.md");
        // Chunks shorter than 50 tokens should merge with parent
        assert!(chunks.iter().all(|c| c.token_count >= 10));
    }

    #[test]
    fn test_splits_long_chunks() {
        let long_paragraph = "Word ".repeat(600);
        let md = format!("# Title\n\n{}", long_paragraph);
        let chunks = chunk_markdown(md, "test.md");
        assert!(chunks.iter().all(|c| c.token_count <= 550));
    }

    #[test]
    fn test_chunk_metadata() {
        let md = "---\ntags: [rust, test]\n---\n\n# Title\n\nContent with [[link]].";
        let chunks = chunk_markdown(md, "docs/test.md");
        assert_eq!(chunks[0].file_path, "docs/test.md");
        assert!(!chunks[0].id.is_empty());
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src-tauri && cargo test embedding --lib -- --nocapture`

- [ ] **Step 3: Implement chunker**

Implement `chunk_markdown(content: &str, file_path: &str) -> Vec<Chunk>`:
- Parse headings with regex `^#{1,6}\s+(.+)$`
- Split into heading-based sections
- Estimate token count (~4 chars/token)
- Merge short chunks (< 50 tokens) with parent
- Split long chunks (> 500 tokens) at paragraph boundaries
- Extract wikilinks with regex `\[\[([^\]]+)\]\]`

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd src-tauri && cargo test embedding --lib -- --nocapture`

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/embedding/
git commit -m "feat(§11.4.2): implement markdown chunker with heading-based splitting"
```

### Task 19: Implement Embedding Providers (Rust)

**Files:**
- Create: `src-tauri/src/embedding/ollama_embed.rs`
- Create: `src-tauri/src/embedding/openai_embed.rs`
- Create: `src-tauri/src/embedding/gemini_embed.rs`
- Modify: `src-tauri/src/embedding/mod.rs`
- Test: unit tests in each provider file

- [ ] **Step 1: Write failing tests for Ollama embedding**

```rust
// src-tauri/src/embedding/ollama_embed.rs
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ollama_request_body_format() {
        let body = build_ollama_embed_request("test text", "nomic-embed-text");
        let json: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(json["model"], "nomic-embed-text");
        assert_eq!(json["prompt"], "test text");
    }

    #[test]
    fn test_parse_ollama_embed_response() {
        let response = r#"{"embedding": [0.1, 0.2, 0.3]}"#;
        let embedding = parse_ollama_response(response).unwrap();
        assert_eq!(embedding, vec![0.1, 0.2, 0.3]);
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement all three embedding providers**

Each provider: `build_request()`, `parse_response()`, and `embed_text(client, text, config) -> Result<Vec<f32>>`.

- [ ] **Step 4: Implement provider dispatch in mod.rs**

```rust
pub async fn embed_texts(
    client: &reqwest::Client,
    texts: Vec<String>,
    provider: &str,
    config: &EmbedConfig,
) -> Result<Vec<Vec<f32>>, EmbedError> {
    match provider {
        "ollama" => ollama_embed::embed_batch(client, texts, config).await,
        "openai" => openai_embed::embed_batch(client, texts, config).await,
        "gemini" => gemini_embed::embed_batch(client, texts, config).await,
        _ => Err(EmbedError::UnsupportedProvider(provider.to_string())),
    }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd src-tauri && cargo test embedding --lib -- --nocapture`

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/embedding/
git commit -m "feat(§11.4.2): implement Ollama/OpenAI/Gemini embedding providers"
```

### Task 20: Implement Vector Store (Rust)

**Files:**
- Create: `src-tauri/src/embedding/vector_store.rs`
- Test: unit tests in vector_store.rs

- [ ] **Step 1: Write failing tests**

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_add_and_search() {
        let mut store = VectorStore::new();
        store.add("chunk-1", vec![1.0, 0.0, 0.0]);
        store.add("chunk-2", vec![0.0, 1.0, 0.0]);
        store.add("chunk-3", vec![0.9, 0.1, 0.0]);

        let results = store.search(&[1.0, 0.0, 0.0], 2);
        assert_eq!(results[0].id, "chunk-1");
        assert_eq!(results[1].id, "chunk-3");
    }

    #[test]
    fn test_remove_by_file() {
        let mut store = VectorStore::new();
        store.add_with_file("c1", vec![1.0], "file1.md");
        store.add_with_file("c2", vec![0.5], "file1.md");
        store.add_with_file("c3", vec![0.3], "file2.md");
        store.remove_by_file("file1.md");
        assert_eq!(store.len(), 1);
    }

    #[test]
    fn test_cosine_similarity() {
        let sim = cosine_similarity(&[1.0, 0.0], &[1.0, 0.0]);
        assert!((sim - 1.0).abs() < 1e-6);

        let sim = cosine_similarity(&[1.0, 0.0], &[0.0, 1.0]);
        assert!(sim.abs() < 1e-6);
    }

    #[test]
    fn test_save_and_load() {
        let dir = tempfile::TempDir::new().unwrap();
        let mut store = VectorStore::new();
        store.add("c1", vec![1.0, 2.0, 3.0]);
        store.save(dir.path()).unwrap();

        let loaded = VectorStore::load(dir.path()).unwrap();
        assert_eq!(loaded.len(), 1);
        let results = loaded.search(&[1.0, 2.0, 3.0], 1);
        assert_eq!(results[0].id, "c1");
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement VectorStore**

In-memory brute-force vector search with cosine similarity, binary file persistence (`.baram/embeddings/vectors.bin`), add/remove/search/save/load.

- [ ] **Step 4: Run tests to verify they pass**

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/embedding/vector_store.rs
git commit -m "feat(§11.4.2): implement VectorStore with cosine search and binary persistence"
```

### Task 21: Implement Hybrid Ranker (Rust)

**Files:**
- Create: `src-tauri/src/embedding/hybrid_ranker.rs`
- Test: unit tests in hybrid_ranker.rs

- [ ] **Step 1: Write failing tests**

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_score_combination() {
        let config = RankConfig { alpha: 0.3, beta: 0.5, gamma: 0.2 };
        let score = combine_scores(0.8, 0.6, 0.5, &config);
        let expected = 0.3 * 0.8 + 0.5 * 0.6 + 0.2 * 0.5;
        assert!((score - expected).abs() < 1e-6);
    }

    #[test]
    fn test_normalize_bm25_scores() {
        let scores = vec![2.0, 5.0, 3.0];
        let normalized = normalize_min_max(&scores);
        assert!((normalized[0] - 0.0).abs() < 1e-6); // min
        assert!((normalized[1] - 1.0).abs() < 1e-6); // max
    }

    #[test]
    fn test_graph_proximity() {
        let prox = graph_proximity(0); // current file
        assert!((prox - 1.0).abs() < 1e-6);
        let prox = graph_proximity(1); // 1-hop
        assert!((prox - 0.5).abs() < 1e-6);
        let prox = graph_proximity(2); // 2-hop
        assert!((prox - 1.0 / 3.0).abs() < 1e-6);
    }

    #[test]
    fn test_dedup_same_file_chunks() {
        let results = vec![
            RankedChunk { id: "f1-c1".into(), file_path: "f1.md".into(), score: 0.9 },
            RankedChunk { id: "f1-c2".into(), file_path: "f1.md".into(), score: 0.8 },
            RankedChunk { id: "f1-c3".into(), file_path: "f1.md".into(), score: 0.7 },
            RankedChunk { id: "f1-c4".into(), file_path: "f1.md".into(), score: 0.6 },
            RankedChunk { id: "f2-c1".into(), file_path: "f2.md".into(), score: 0.5 },
        ];
        let deduped = enforce_diversity(results, 3); // max 3 per file
        assert_eq!(deduped.iter().filter(|r| r.file_path == "f1.md").count(), 3);
    }

    #[test]
    fn test_auto_weight_for_keyword_query() {
        let weights = auto_weights("JWT 토큰 갱신");
        assert!(weights.alpha > weights.beta); // BM25 favored for keyword
    }

    #[test]
    fn test_auto_weight_for_semantic_query() {
        let weights = auto_weights("인증 전략에 대해 알려줘");
        assert!(weights.beta > weights.alpha); // vector favored for semantic
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement HybridRanker**

`combine_scores()`, `normalize_min_max()`, `graph_proximity()`, `enforce_diversity()`, `auto_weights()`, and main `hybrid_rank()` function.

- [ ] **Step 4: Run tests to verify they pass**

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/embedding/hybrid_ranker.rs
git commit -m "feat(§11.4.3): implement hybrid ranker with BM25+vector+graph scoring"
```

### Task 22: Implement Embedding IPC Commands

**Files:**
- Create: `src-tauri/src/commands/embedding_cmd.rs`
- Modify: `src-tauri/src/lib.rs` (register commands + managed state)
- Test: `src-tauri/src/commands/embedding_cmd.rs` unit tests

- [ ] **Step 1: Write failing tests**

```rust
#[cfg(test)]
mod tests {
    #[test]
    fn test_index_status_serialization() {
        let status = IndexStatus {
            total_files: 100,
            indexed_files: 45,
            total_chunks: 500,
            is_indexing: true,
        };
        let json = serde_json::to_string(&status).unwrap();
        assert!(json.contains("\"is_indexing\":true"));
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Implement IPC commands**

Commands: `embed_text`, `search_knowledge`, `index_vault`, `index_status`, `index_file` (incremental).

- [ ] **Step 4: Register commands and EmbeddingState in lib.rs**

Add `EmbeddingState` (VectorStore + ChunkIndex) as managed state, register all embedding commands.

- [ ] **Step 5: Run tests to verify they pass**

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/commands/embedding_cmd.rs src-tauri/src/lib.rs src-tauri/src/embedding/mod.rs
git commit -m "feat(§11.4): implement embedding IPC commands and managed state"
```

---

## Chunk 7: Phase 3B — Knowledge Q&A — Frontend (§11.4)

### Task 23: Create Knowledge Store

**Files:**
- Create: `src/stores/knowledge-store.ts`
- Create: `src/ipc/embedding.ts`
- Test: `src/stores/__tests__/knowledge-store.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/stores/__tests__/knowledge-store.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useKnowledgeStore } from '../knowledge-store';

describe('KnowledgeStore', () => {
  beforeEach(() => {
    useKnowledgeStore.getState().reset();
  });

  it('initializes with idle indexing status', () => {
    expect(useKnowledgeStore.getState().indexingStatus).toBe('idle');
  });

  it('updates indexing progress', () => {
    useKnowledgeStore.getState().setIndexingProgress(45, 100);
    expect(useKnowledgeStore.getState().indexedFiles).toBe(45);
    expect(useKnowledgeStore.getState().totalFiles).toBe(100);
    expect(useKnowledgeStore.getState().indexingStatus).toBe('indexing');
  });

  it('sets status to ready when indexing completes', () => {
    useKnowledgeStore.getState().setIndexingProgress(100, 100);
    expect(useKnowledgeStore.getState().indexingStatus).toBe('ready');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement knowledge-store.ts and embedding.ts IPC wrapper**

- [ ] **Step 4: Run tests to verify they pass**

- [ ] **Step 5: Commit**

```bash
git add src/stores/knowledge-store.ts src/ipc/embedding.ts src/stores/__tests__/knowledge-store.test.ts
git commit -m "feat(§11.4): implement KnowledgeStore and embedding IPC wrapper"
```

### Task 24: Implement Citation System in Chat Panel

**Files:**
- Create: `src/components/ai/CitationLink.tsx`
- Modify: `src/components/ai/AIChatPanel.tsx`
- Modify: `src/utils/chat-context.ts`
- Test: `src/components/ai/__tests__/CitationLink.test.tsx`

- [ ] **Step 1: Write failing tests for CitationLink rendering**

```typescript
// src/components/ai/__tests__/CitationLink.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CitationLink } from '../CitationLink';

describe('CitationLink', () => {
  it('renders citation number and file path', () => {
    render(<CitationLink index={1} filePath="docs/auth.md" heading="JWT 검증" />);
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('docs/auth.md#JWT-검증')).toBeInTheDocument();
  });

  it('renders [열기] button', () => {
    render(<CitationLink index={1} filePath="docs/auth.md" heading="JWT 검증" />);
    expect(screen.getByText('열기')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement CitationLink component**

- [ ] **Step 4: Add @vault reference parsing to chat-context.ts**

Add `@vault` and `@folder:path` to reference pattern matching. When detected, route through `searchKnowledge()` IPC instead of direct file read.

- [ ] **Step 5: Add Knowledge Q&A mode detection to AIChatPanel**

Detect vault-wide queries by `@vault` reference or keyword heuristics ("이 프로젝트에서", "어디에", "찾아줘"). Show "🔍 Vault 검색 모드" badge.

- [ ] **Step 6: Run all tests to verify they pass**

Run: `npx vitest run src/components/ai/__tests__/ --reporter=verbose`

- [ ] **Step 7: Commit**

```bash
git add src/components/ai/CitationLink.tsx src/components/ai/AIChatPanel.tsx src/utils/chat-context.ts src/components/ai/__tests__/
git commit -m "feat(§11.4.4): implement Citation system and @vault reference in Chat Panel"
```

---

## Chunk 8: Phase 3B — Semantic Wikilink (§11.5)

### Task 25: Implement Entity Extractor (Dictionary-based)

**Files:**
- Create: `src/utils/entity-extractor.ts`
- Test: `src/utils/__tests__/entity-extractor.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/utils/__tests__/entity-extractor.test.ts
import { describe, it, expect } from 'vitest';
import { extractEntities } from '../entity-extractor';

describe('extractEntities', () => {
  const dictionary = new Set(['ProseMirror', 'Tiptap', 'Rust', 'editor engine']);

  it('finds exact matches from dictionary', () => {
    const result = extractEntities('Baram uses ProseMirror for editing.', dictionary);
    expect(result).toContain('ProseMirror');
  });

  it('finds case-insensitive matches', () => {
    const result = extractEntities('Built with tiptap framework.', dictionary);
    expect(result).toContain('Tiptap');
  });

  it('excludes already-linked entities', () => {
    const result = extractEntities('Uses [[ProseMirror]] and Tiptap.', dictionary);
    expect(result).not.toContain('ProseMirror');
    expect(result).toContain('Tiptap');
  });

  it('returns empty for text with no dictionary matches', () => {
    const result = extractEntities('Hello world.', dictionary);
    expect(result).toHaveLength(0);
  });

  it('finds multi-word entities', () => {
    const result = extractEntities('The editor engine is fast.', dictionary);
    expect(result).toContain('editor engine');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement entity-extractor.ts**

- [ ] **Step 4: Run tests to verify they pass**

- [ ] **Step 5: Commit**

```bash
git add src/utils/entity-extractor.ts src/utils/__tests__/entity-extractor.test.ts
git commit -m "feat(§11.5.3): implement dictionary-based entity extractor"
```

### Task 26: Implement Ghost Link ProseMirror Plugin

**Files:**
- Create: `src/extensions/plugins/ghost-link.ts`
- Test: `src/extensions/plugins/__tests__/ghost-link.test.ts`

- [ ] **Step 1: Write failing tests for Ghost Link decoration**

```typescript
describe('GhostLinkPlugin', () => {
  it('creates inline decoration for suggested links', () => {
    // Create doc with paragraph containing entity match
    // Apply ghost-link suggestions
    // Verify Decoration.inline is created with correct class
  });

  it('removes decoration on Esc keypress', () => {
    // Create ghost link → press Esc → decoration removed
  });

  it('converts to actual wikilink on Tab keypress', () => {
    // Create ghost link → press Tab → text replaced with [[entity]]
  });

  it('respects maxSuggestionsPerParagraph = 3', () => {
    // Paragraph with 5 matches → only 3 decorations
  });

  it('respects 30-second cooldown between suggestions', () => {
    // Trigger suggestion → immediately trigger again → no new suggestions
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement Ghost Link plugin**

ProseMirror Plugin with PluginKey, DecorationSet state, Tab/Esc key bindings, frequency control (30s cooldown, max 3 per paragraph, min 20 char paragraph).

- [ ] **Step 4: Run tests to verify they pass**

- [ ] **Step 5: Commit**

```bash
git add src/extensions/plugins/ghost-link.ts src/extensions/plugins/__tests__/ghost-link.test.ts
git commit -m "feat(§11.5.2): implement Ghost Link ProseMirror plugin with frequency control"
```

---

## Chunk 9: Phase 3C — Agent Mode (§11.6)

### Task 27: Implement Agent Store (State Machine)

**Files:**
- Create: `src/stores/agent-store.ts`
- Test: `src/stores/__tests__/agent-store.test.ts`

- [ ] **Step 1: Write failing tests for agent state machine**

```typescript
// src/stores/__tests__/agent-store.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useAgentStore } from '../agent-store';

describe('AgentStore — state machine', () => {
  beforeEach(() => {
    useAgentStore.getState().reset();
  });

  it('starts in idle state', () => {
    expect(useAgentStore.getState().status).toBe('idle');
  });

  it('transitions idle → planning on startPlanning()', () => {
    useAgentStore.getState().startPlanning('Improve all skills');
    expect(useAgentStore.getState().status).toBe('planning');
    expect(useAgentStore.getState().goal).toBe('Improve all skills');
  });

  it('transitions planning → reviewing on setPlan()', () => {
    useAgentStore.getState().startPlanning('test');
    useAgentStore.getState().setPlan({ steps: [{ file: 'a.md', action: 'update', risk: 'low' }] });
    expect(useAgentStore.getState().status).toBe('reviewing');
  });

  it('transitions reviewing → executing on approvePlan()', () => {
    useAgentStore.getState().startPlanning('test');
    useAgentStore.getState().setPlan({ steps: [{ file: 'a.md', action: 'update', risk: 'low' }] });
    useAgentStore.getState().approvePlan();
    expect(useAgentStore.getState().status).toBe('executing');
  });

  it('transitions executing → paused on pauseOnRisk()', () => {
    useAgentStore.getState().startPlanning('test');
    useAgentStore.getState().setPlan({ steps: [] });
    useAgentStore.getState().approvePlan();
    useAgentStore.getState().pauseOnRisk('High risk detected');
    expect(useAgentStore.getState().status).toBe('paused');
  });

  it('transitions executing → completed on finish()', () => {
    useAgentStore.getState().startPlanning('test');
    useAgentStore.getState().setPlan({ steps: [] });
    useAgentStore.getState().approvePlan();
    useAgentStore.getState().finish();
    expect(useAgentStore.getState().status).toBe('completed');
  });

  it('cancel() returns to idle from any state', () => {
    useAgentStore.getState().startPlanning('test');
    useAgentStore.getState().cancel();
    expect(useAgentStore.getState().status).toBe('idle');
  });

  it('tracks step completion progress', () => {
    useAgentStore.getState().startPlanning('test');
    useAgentStore.getState().setPlan({
      steps: [
        { file: 'a.md', action: 'update', risk: 'low' },
        { file: 'b.md', action: 'update', risk: 'low' },
      ],
    });
    useAgentStore.getState().approvePlan();
    useAgentStore.getState().completeStep(0, { diff: '+added' });
    expect(useAgentStore.getState().completedSteps).toBe(1);
    expect(useAgentStore.getState().totalSteps).toBe(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement agent-store.ts**

Zustand store with status state machine, plan/steps, completedSteps tracking, per-step results (diffs), risk detection integration point.

- [ ] **Step 4: Run tests to verify they pass**

- [ ] **Step 5: Commit**

```bash
git add src/stores/agent-store.ts src/stores/__tests__/agent-store.test.ts
git commit -m "feat(§11.6.1): implement Agent Mode state machine store"
```

### Task 28: Implement Agent Planner and Risk Detector

**Files:**
- Create: `src/utils/agent-planner.ts`
- Create: `src/utils/agent-risk-detector.ts`
- Test: `src/utils/__tests__/agent-planner.test.ts`
- Test: `src/utils/__tests__/agent-risk-detector.test.ts`

- [ ] **Step 1: Write failing tests for risk detector**

```typescript
// src/utils/__tests__/agent-risk-detector.test.ts
import { describe, it, expect } from 'vitest';
import { detectRisk, RiskLevel } from '../agent-risk-detector';

describe('detectRisk', () => {
  it('returns low for minor text change', () => {
    const original = 'Hello world.\nSecond line.\nThird line.';
    const modified = 'Hello world.\nSecond line updated.\nThird line.';
    expect(detectRisk(original, modified)).toBe('low');
  });

  it('returns medium when >50% of headings changed', () => {
    const original = '# Title\n\n## Section A\n\n## Section B';
    const modified = '# New Title\n\n## New Section\n\n## Another';
    expect(detectRisk(original, modified)).toBe('medium');
  });

  it('returns medium when frontmatter fields added/removed', () => {
    const original = '---\ntitle: Test\n---\n\nContent';
    const modified = '---\ntitle: Test\nnew_field: value\n---\n\nContent';
    expect(detectRisk(original, modified)).toBe('medium');
  });

  it('returns high when file content changes >50%', () => {
    const original = 'Line 1\nLine 2\nLine 3\nLine 4';
    const modified = 'Completely different content here now.';
    expect(detectRisk(original, modified)).toBe('high');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement agent-risk-detector.ts**

Analyze original vs modified: heading change ratio, frontmatter field diffs, content change percentage. Return `'low' | 'medium' | 'high'`.

- [ ] **Step 4: Write failing tests for agent planner**

```typescript
// src/utils/__tests__/agent-planner.test.ts
describe('buildPlannerPrompt', () => {
  it('includes user goal in prompt', () => {
    const prompt = buildPlannerPrompt('Improve descriptions', ['skills/a.md', 'skills/b.md']);
    expect(prompt).toContain('Improve descriptions');
  });

  it('includes file list in prompt', () => {
    const prompt = buildPlannerPrompt('test', ['file1.md', 'file2.md']);
    expect(prompt).toContain('file1.md');
    expect(prompt).toContain('file2.md');
  });

  it('requests JSON output format', () => {
    const prompt = buildPlannerPrompt('test', []);
    expect(prompt).toContain('JSON');
  });
});

describe('parsePlanResponse', () => {
  it('parses valid plan JSON', () => {
    const response = '{"goal":"test","steps":[{"file":"a.md","action":"update","description":"fix","risk":"low"}]}';
    const plan = parsePlanResponse(response);
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0].file).toBe('a.md');
  });

  it('throws on invalid JSON', () => {
    expect(() => parsePlanResponse('not json')).toThrow();
  });
});
```

- [ ] **Step 5: Implement agent-planner.ts**

- [ ] **Step 6: Run all tests to verify they pass**

- [ ] **Step 7: Commit**

```bash
git add src/utils/agent-planner.ts src/utils/agent-risk-detector.ts src/utils/__tests__/
git commit -m "feat(§11.6.2): implement Agent planner and risk detector"
```

### Task 29: Implement Agent Executor

**Files:**
- Create: `src/utils/agent-executor.ts`
- Test: `src/utils/__tests__/agent-executor.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
describe('AgentExecutor', () => {
  it('executes a single step and produces diff', async () => {
    // Mock file read and LLM call
    // Execute step → verify diff output
  });

  it('pauses execution on medium/high risk', async () => {
    // Step produces high-risk change → executor pauses
  });

  it('tracks progress in agent store', async () => {
    // Execute 2 steps → verify completedSteps increments
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement agent-executor.ts**

Sequential step execution: read file → send to LLM → generate diff → risk check → store result. Integrates with agent-store for status updates.

- [ ] **Step 4: Run tests to verify they pass**

- [ ] **Step 5: Commit**

```bash
git add src/utils/agent-executor.ts src/utils/__tests__/agent-executor.test.ts
git commit -m "feat(§11.6.2): implement Agent executor with step-by-step execution"
```

### Task 30: Implement Agent Panel UI

**Files:**
- Create: `src/components/ai/AgentPanel.tsx`
- Create: `src/components/ai/AgentPlanView.tsx`
- Create: `src/components/ai/AgentProgressBar.tsx`
- Create: `src/components/ai/AgentDiffView.tsx`
- Test: `src/components/ai/__tests__/AgentPanel.test.tsx`

- [ ] **Step 1: Write failing tests for AgentPanel**

```typescript
describe('AgentPanel', () => {
  it('shows goal input when idle', () => {
    useAgentStore.setState({ status: 'idle' });
    render(<AgentPanel />);
    expect(screen.getByPlaceholderText(/목표/)).toBeInTheDocument();
  });

  it('shows plan review when in reviewing state', () => {
    useAgentStore.setState({
      status: 'reviewing',
      plan: { steps: [{ file: 'a.md', action: 'update', risk: 'low', description: 'test' }] },
    });
    render(<AgentPanel />);
    expect(screen.getByText('a.md')).toBeInTheDocument();
    expect(screen.getByText('실행')).toBeInTheDocument();
  });

  it('shows progress bar when executing', () => {
    useAgentStore.setState({ status: 'executing', completedSteps: 2, totalSteps: 5 });
    render(<AgentPanel />);
    expect(screen.getByText('2/5')).toBeInTheDocument();
  });

  it('shows diff results when completed', () => {
    useAgentStore.setState({
      status: 'completed',
      results: [{ file: 'a.md', diff: '+line added', accepted: null }],
    });
    render(<AgentPanel />);
    expect(screen.getByText('전체 수락')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement all Agent Panel components**

AgentPanel: top-level with state-based view switching.
AgentPlanView: checkbox list of steps with risk badges.
AgentProgressBar: file-by-file status (✅/🔄/⬚).
AgentDiffView: inline diff per file with accept/reject buttons.

- [ ] **Step 4: Run tests to verify they pass**

- [ ] **Step 5: Commit**

```bash
git add src/components/ai/Agent*.tsx src/components/ai/__tests__/
git commit -m "feat(§11.6): implement Agent Mode UI — plan view, progress bar, diff review"
```

---

## Chunk 10: Phase 3C — Authorship Visualization (§11.7)

### Task 31: Implement Authorship Tracker

**Files:**
- Create: `src/utils/authorship-tracker.ts`
- Test: `src/utils/__tests__/authorship-tracker.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/utils/__tests__/authorship-tracker.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { AuthorshipTracker, AuthorshipSegment } from '../authorship-tracker';

describe('AuthorshipTracker', () => {
  let tracker: AuthorshipTracker;

  beforeEach(() => {
    tracker = new AuthorshipTracker();
  });

  it('records ai-generated segment on ghost text accept', () => {
    tracker.recordAIGenerated(10, 30, { provider: 'claude', model: 'sonnet', action: 'ghost-text' });
    const segments = tracker.getSegments();
    expect(segments).toHaveLength(1);
    expect(segments[0].origin).toBe('ai-generated');
    expect(segments[0].from).toBe(10);
    expect(segments[0].to).toBe(30);
  });

  it('records ai-modified segment on inline edit accept', () => {
    tracker.recordAIModified(5, 20, { provider: 'openai', model: 'gpt-4o', action: 'inline-edit' });
    const segments = tracker.getSegments();
    expect(segments[0].origin).toBe('ai-modified');
  });

  it('converts ai-generated to human when user types in that range', () => {
    tracker.recordAIGenerated(10, 30, { provider: 'claude', model: 'sonnet', action: 'ghost-text' });
    tracker.recordHumanEdit(15, 20);
    const segments = tracker.getSegments();
    // Should split: [10-15 ai-generated] [15-20 human] [20-30 ai-generated]
    const humanSeg = segments.find((s) => s.origin === 'human');
    expect(humanSeg).toBeDefined();
  });

  it('calculates statistics', () => {
    tracker.recordAIGenerated(0, 100, { provider: 'claude', model: 'sonnet', action: 'ghost-text' });
    tracker.recordHumanEdit(0, 70);
    const stats = tracker.getStats(100);
    expect(stats.humanPercent).toBe(70);
    expect(stats.aiGeneratedPercent).toBe(30);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement AuthorshipTracker**

Segment management with split/merge logic, origin transition rules, statistics calculation.

- [ ] **Step 4: Run tests to verify they pass**

- [ ] **Step 5: Commit**

```bash
git add src/utils/authorship-tracker.ts src/utils/__tests__/authorship-tracker.test.ts
git commit -m "feat(§11.7.3): implement AuthorshipTracker with segment management"
```

### Task 32: Implement Authorship Store and Sidecar Sync

**Files:**
- Create: `src/stores/authorship-store.ts`
- Create: `src/utils/authorship-sync.ts`
- Test: `src/stores/__tests__/authorship-store.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
describe('AuthorshipStore', () => {
  it('stores tracker per file path', () => {
    useAuthorshipStore.getState().getOrCreateTracker('test.md');
    expect(useAuthorshipStore.getState().hasTracker('test.md')).toBe(true);
  });

  it('isEnabled defaults to false', () => {
    expect(useAuthorshipStore.getState().isEnabled).toBe(false);
  });
});

describe('AuthorshipSync', () => {
  it('serializes segments to JSON', () => {
    const segments: AuthorshipSegment[] = [
      { from: 0, to: 50, origin: 'human', timestamp: Date.now() },
    ];
    const json = serializeAuthorship('test.md', segments);
    const parsed = JSON.parse(json);
    expect(parsed.filePath).toBe('test.md');
    expect(parsed.segments).toHaveLength(1);
  });

  it('deserializes JSON back to segments', () => {
    const json = '{"filePath":"test.md","version":1,"segments":[{"from":0,"to":50,"origin":"human","timestamp":1000}]}';
    const data = deserializeAuthorship(json);
    expect(data.segments[0].origin).toBe('human');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement authorship-store.ts and authorship-sync.ts**

- [ ] **Step 4: Run tests to verify they pass**

- [ ] **Step 5: Commit**

```bash
git add src/stores/authorship-store.ts src/utils/authorship-sync.ts src/stores/__tests__/authorship-store.test.ts
git commit -m "feat(§11.7.5): implement AuthorshipStore and sidecar file sync"
```

### Task 33: Implement Authorship ProseMirror Plugin and Stats Panel

**Files:**
- Create: `src/extensions/plugins/authorship.ts`
- Create: `src/components/toolbar/AuthorshipPanel.tsx`
- Test: `src/extensions/plugins/__tests__/authorship.test.ts`
- Test: `src/components/toolbar/__tests__/AuthorshipPanel.test.tsx`

- [ ] **Step 1: Write failing tests for Authorship plugin decorations**

```typescript
describe('AuthorshipPlugin', () => {
  it('creates decoration for ai-generated segments', () => {
    // Add segments → verify Decoration.inline with class authorship-ai-generated
  });

  it('creates decoration for ai-modified segments', () => {
    // Add segments → verify Decoration.inline with class authorship-ai-modified
  });

  it('shows no decorations when disabled', () => {
    // isEnabled = false → no decorations
  });
});
```

- [ ] **Step 2: Write failing tests for AuthorshipPanel**

```typescript
describe('AuthorshipPanel', () => {
  it('shows percentage breakdown', () => {
    // Set stats → verify human %, ai-generated %, ai-modified % displayed
  });

  it('shows progress bar', () => {
    // Verify visual bar segments
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

- [ ] **Step 4: Implement authorship ProseMirror plugin**

DecorationSet based on AuthorshipTracker segments, toggled by isEnabled flag from store.

- [ ] **Step 5: Implement AuthorshipPanel component**

Stats display with percentage bar, recent AI activity list.

- [ ] **Step 6: Run tests to verify they pass**

- [ ] **Step 7: Commit**

```bash
git add src/extensions/plugins/authorship.ts src/components/toolbar/AuthorshipPanel.tsx src/extensions/plugins/__tests__/ src/components/toolbar/__tests__/
git commit -m "feat(§11.7): implement Authorship visualization plugin and stats panel"
```

---

## Chunk 11: Phase 3C — Smart Templates (§11.8)

### Task 34: Define Built-in Template Schemas

**Files:**
- Create: `src/utils/smart-templates.ts`
- Test: `src/utils/__tests__/smart-templates.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/utils/__tests__/smart-templates.test.ts
import { describe, it, expect } from 'vitest';
import { getBuiltinTemplates, getTemplateById, buildTemplatePrompt } from '../smart-templates';

describe('Smart Templates', () => {
  it('provides 7 built-in templates', () => {
    expect(getBuiltinTemplates()).toHaveLength(7);
  });

  it('each template has id, name, sections, contextHints', () => {
    for (const tmpl of getBuiltinTemplates()) {
      expect(tmpl).toHaveProperty('id');
      expect(tmpl).toHaveProperty('name');
      expect(tmpl).toHaveProperty('sections');
      expect(tmpl.sections.length).toBeGreaterThan(0);
    }
  });

  it('getTemplateById returns correct template', () => {
    const tmpl = getTemplateById('api-doc');
    expect(tmpl?.name).toBe('API Documentation');
  });

  it('buildTemplatePrompt includes template sections and context', () => {
    const prompt = buildTemplatePrompt('api-doc', { projectName: 'Baram', techStack: 'Tauri + React' });
    expect(prompt).toContain('API Documentation');
    expect(prompt).toContain('Baram');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement smart-templates.ts**

Define 7 templates (API Documentation, Meeting Notes, Technical Spec, Tutorial, Blog Post, Release Notes, Research Notes) with section schemas and LLM prompt builders.

- [ ] **Step 4: Run tests to verify they pass**

- [ ] **Step 5: Commit**

```bash
git add src/utils/smart-templates.ts src/utils/__tests__/smart-templates.test.ts
git commit -m "feat(§11.8.2): define 7 built-in Smart Template schemas"
```

### Task 35: Implement Smart Template Dialog and Generation

**Files:**
- Create: `src/components/ai/SmartTemplateDialog.tsx`
- Modify: `src/components/command/SlashMenu.tsx` (add /ai-template entry)
- Test: `src/components/ai/__tests__/SmartTemplateDialog.test.tsx`

- [ ] **Step 1: Write failing tests**

```typescript
describe('SmartTemplateDialog', () => {
  it('renders template selection grid', () => {
    render(<SmartTemplateDialog isOpen onClose={() => {}} />);
    expect(screen.getByText('API Documentation')).toBeInTheDocument();
    expect(screen.getByText('Meeting Notes')).toBeInTheDocument();
  });

  it('calls onGenerate with selected template id', async () => {
    const onGenerate = vi.fn();
    render(<SmartTemplateDialog isOpen onClose={() => {}} onGenerate={onGenerate} />);
    await userEvent.click(screen.getByText('API Documentation'));
    expect(onGenerate).toHaveBeenCalledWith('api-doc');
  });

  it('shows Custom option with text input', () => {
    render(<SmartTemplateDialog isOpen onClose={() => {}} />);
    expect(screen.getByText('Custom...')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement SmartTemplateDialog**

Template selection grid, custom description input, generate button that calls LLM with template prompt.

- [ ] **Step 4: Add /ai-template to SlashMenu**

- [ ] **Step 5: Run tests to verify they pass**

- [ ] **Step 6: Commit**

```bash
git add src/components/ai/SmartTemplateDialog.tsx src/components/command/SlashMenu.tsx src/components/ai/__tests__/
git commit -m "feat(§11.8): implement Smart Template dialog and slash command"
```

---

## Integration & Final Verification

### Task 36: End-to-end Integration Tests

**Files:**
- Create: `src/__tests__/ai-enhancement-integration.test.ts`

- [ ] **Step 1: Write integration tests**

```typescript
describe('AI Enhancement — Integration', () => {
  describe('Per-task Model Routing E2E', () => {
    it('ghost text uses task-specific model in IPC call', () => {
      // Setup: autoModelEnabled=true, providerForGhostText='openai'
      // Trigger ghost text → verify IPC called with openai provider
    });
  });

  describe('Writing Flow → Ghost Text integration', () => {
    it('technical mode injects technical prompt into ghost text', () => {
      // Open file in docs/ → verify WritingFlowStore mode=technical
      // Trigger ghost text → verify system prompt contains technical keywords
    });
  });

  describe('Privacy mode blocks AI for private files', () => {
    it('file with privacy:true frontmatter blocks ghost text', () => {
      // Open file with privacy:true → trigger ghost text → verify no LLM call
    });
  });

  describe('Contextual toolbar shows mode-specific actions', () => {
    it('selecting code block shows code actions', () => {
      // Select codeBlock → open AI menu → verify code actions visible
    });
  });
});
```

- [ ] **Step 2: Run integration tests**

Run: `npx vitest run src/__tests__/ai-enhancement-integration.test.ts --reporter=verbose`

- [ ] **Step 3: Fix any failures**

- [ ] **Step 4: Run full test suite**

Run: `npx vitest run --reporter=verbose`
Expected: ALL PASS (existing 1863+ tests + new tests)

Run: `cd src-tauri && cargo test -- --nocapture`
Expected: ALL PASS (existing 163+ tests + new tests)

- [ ] **Step 5: Final commit**

```bash
git add src/__tests__/ai-enhancement-integration.test.ts
git commit -m "test(§11): add end-to-end integration tests for AI enhancements"
```

---

## Test Plan Summary

### Unit Tests (Vitest)

| Feature | Test File | Test Count (est.) |
|---------|-----------|-------------------|
| Per-task model routing | `src/utils/__tests__/model-selection.test.ts` | 4 |
| useLLMStream task-aware | `src/hooks/__tests__/use-llm-stream.test.ts` | 2 |
| Ghost Text cache | `src/utils/__tests__/ghost-text-cache.test.ts` | 7 |
| Ghost Text prefetch | `src/hooks/__tests__/use-ghost-text.test.ts` | 4 |
| Content type detector | `src/utils/__tests__/content-type-detector.test.ts` | 6 |
| Contextual AI actions | `src/utils/__tests__/contextual-ai-actions.test.ts` | 6 |
| Privacy check (per-file) | `src/utils/__tests__/privacy-check.test.ts` | 6 |
| StatusBar privacy | `src/components/toolbar/__tests__/StatusBar.test.tsx` | 3 |
| Writing mode detector | `src/utils/__tests__/writing-mode-detector.test.ts` | 9 |
| Writing mode prompts | `src/utils/__tests__/writing-mode-prompts.test.ts` | 4 |
| Session context tracker | `src/utils/__tests__/session-context.test.ts` | 5 |
| Session memory | `src/utils/__tests__/session-memory.test.ts` | 6 |
| Writing flow store | `src/stores/__tests__/writing-flow-store.test.ts` | 4 |
| Knowledge store | `src/stores/__tests__/knowledge-store.test.ts` | 3 |
| Citation link | `src/components/ai/__tests__/CitationLink.test.tsx` | 2 |
| Entity extractor | `src/utils/__tests__/entity-extractor.test.ts` | 5 |
| Ghost link plugin | `src/extensions/plugins/__tests__/ghost-link.test.ts` | 5 |
| Agent store | `src/stores/__tests__/agent-store.test.ts` | 7 |
| Agent risk detector | `src/utils/__tests__/agent-risk-detector.test.ts` | 4 |
| Agent planner | `src/utils/__tests__/agent-planner.test.ts` | 5 |
| Agent executor | `src/utils/__tests__/agent-executor.test.ts` | 3 |
| Agent panel | `src/components/ai/__tests__/AgentPanel.test.tsx` | 4 |
| Authorship tracker | `src/utils/__tests__/authorship-tracker.test.ts` | 4 |
| Authorship store/sync | `src/stores/__tests__/authorship-store.test.ts` | 4 |
| Authorship plugin | `src/extensions/plugins/__tests__/authorship.test.ts` | 3 |
| Authorship panel | `src/components/toolbar/__tests__/AuthorshipPanel.test.tsx` | 2 |
| Smart templates | `src/utils/__tests__/smart-templates.test.ts` | 4 |
| Smart template dialog | `src/components/ai/__tests__/SmartTemplateDialog.test.tsx` | 3 |
| Integration tests | `src/__tests__/ai-enhancement-integration.test.ts` | 4 |
| **Total** | **29 test files** | **~132 tests** |

### Rust Unit Tests (cargo test)

| Feature | Module | Test Count (est.) |
|---------|--------|-------------------|
| Privacy no-store headers | `src-tauri/src/llm/claude.rs` | 2 |
| Privacy no-store headers | `src-tauri/src/llm/openai.rs` | 2 |
| Markdown chunker | `src-tauri/src/embedding/chunker.rs` | 4 |
| Embedding providers | `src-tauri/src/embedding/ollama_embed.rs` | 2 |
| Embedding providers | `src-tauri/src/embedding/openai_embed.rs` | 2 |
| Embedding providers | `src-tauri/src/embedding/gemini_embed.rs` | 2 |
| Vector store | `src-tauri/src/embedding/vector_store.rs` | 4 |
| Hybrid ranker | `src-tauri/src/embedding/hybrid_ranker.rs` | 6 |
| Embedding IPC commands | `src-tauri/src/commands/embedding_cmd.rs` | 1 |
| **Total** | **9 test modules** | **~25 tests** |

### Performance Validation

| Metric | Target | Test Method |
|--------|--------|-------------|
| Ghost Text cache hit display | < 50ms | Vitest timer mock + assertion |
| Writing Mode detection | < 100ms | `performance.now()` in test |
| Content type detection | < 5ms | `performance.now()` in test |
| Authorship decoration overhead | < 5ms/transaction | ProseMirror transaction timing |
| Entity extraction (dictionary) | < 200ms | Vitest timer in entity-extractor test |

### Test Commands Quick Reference

```bash
# Run all new frontend tests
npx vitest run --reporter=verbose

# Run specific chunk tests
npx vitest run src/utils/__tests__/model-selection.test.ts    # Chunk 1
npx vitest run src/utils/__tests__/ghost-text-cache.test.ts   # Chunk 2
npx vitest run src/utils/__tests__/content-type-detector.test.ts  # Chunk 3
npx vitest run src/utils/__tests__/privacy-check.test.ts      # Chunk 4
npx vitest run src/utils/__tests__/writing-mode-detector.test.ts  # Chunk 5
npx vitest run src/stores/__tests__/knowledge-store.test.ts   # Chunk 7
npx vitest run src/utils/__tests__/entity-extractor.test.ts   # Chunk 8
npx vitest run src/stores/__tests__/agent-store.test.ts       # Chunk 9
npx vitest run src/utils/__tests__/authorship-tracker.test.ts # Chunk 10
npx vitest run src/utils/__tests__/smart-templates.test.ts    # Chunk 11

# Run all Rust tests
cd src-tauri && cargo test -- --nocapture

# Run specific Rust module
cd src-tauri && cargo test embedding --lib -- --nocapture
cd src-tauri && cargo test llm --lib -- --nocapture

# Type check
npx tsc --noEmit

# Full suite (should run before final merge)
npx vitest run && cd src-tauri && cargo test
```
