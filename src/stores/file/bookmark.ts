// §36 북마크 스토어 — 파일/헤딩 북마크 CRUD + Tauri 설정 영속화
//
// §260 Phase 5: localStorage에서 tauriStorage로 이동. 모든 `plugin-*` 샌드박스 웹뷰는
// 메인 윈도우와 동일 출처라 localStorage를 공유한다 — capability가 하나도 없는
// 플러그인이 vault 루트 경로·파일 경로·헤딩 텍스트를 읽고 쓸 수 있었다.
import { create } from "zustand";

import { tauriStorage } from "../system/tauri-storage";

export interface BookmarkItem {
  createdAt: number;
  filePath: string;
  group: string;
  headingLevel?: number;
  headingText?: string;
  id: string;
  label: string;
  type: "file" | "heading";
}

interface BookmarkState {
  addBookmark: (item: Omit<BookmarkItem, "createdAt" | "id">) => void;

  bookmarks: BookmarkItem[];
  /** Async since §260 Phase 5 — the backing store is Rust config, not localStorage. */
  loadBookmarks: (rootPath: string) => Promise<void>;
  moveToGroup: (id: string, group: string) => void;
  removeBookmark: (id: string) => void;
  saveBookmarks: (rootPath: string) => Promise<void>;
}

/** Get unique groups from bookmarks list */
export function getGroups(bookmarks: BookmarkItem[]): string[] {
  const groups = new Set<string>();
  for (const b of bookmarks) {
    groups.add(b.group);
  }
  return Array.from(groups);
}

/** Check for duplicate bookmark (same type + filePath + headingText) */
export function isDuplicate(
  bookmarks: BookmarkItem[],
  item: Pick<BookmarkItem, "filePath" | "headingText" | "type">,
): boolean {
  return bookmarks.some(
    (b) =>
      b.type === item.type &&
      b.filePath === item.filePath &&
      b.headingText === item.headingText,
  );
}

/** Storage key scoped to vault root. Must keep matching `MIGRATION_PREFIXES`. */
export function storageKey(rootPath: string): string {
  return `baram:bookmarks:${rootPath}`;
}

/**
 * §260 Phase 5 — every read and write runs in submission order, one at a time.
 *
 * `BookmarkPanel` mounts a load effect and an autosave effect together, and the autosave
 * fires on mount before the load has produced anything. While both were synchronous that
 * was harmless — the load filled the store, and the save read the live value straight
 * back out. Async, they overlapped: the save read an empty store and wrote `[]`, either
 * clobbering the file the load had just read or landing first so the load read `[]`.
 * Either way the user's bookmarks were gone on first mount.
 *
 * Serializing restores exactly the property the synchronous version had for free. It
 * matters that `saveBookmarks` reads `get().bookmarks` INSIDE the queued step rather than
 * at call time, so a save queued behind a load writes the loaded list, not the empty one
 * that was current when the effect fired.
 */
let queue: Promise<unknown> = Promise.resolve();

function enqueue(op: () => Promise<void>): Promise<void> {
  // Both arms run `op`, so one step's failure never strands the ones behind it.
  const next = queue.then(op, op);
  queue = next.catch(() => undefined);
  return next;
}

export const useBookmarkStore = create<BookmarkState>((set, get) => ({
  bookmarks: [],

  addBookmark: (item) => {
    const { bookmarks } = get();
    if (isDuplicate(bookmarks, item)) return;

    const newItem: BookmarkItem = {
      ...item,
      id: crypto.randomUUID(),
      createdAt: Date.now(),
    };
    set({ bookmarks: [...bookmarks, newItem] });
  },

  removeBookmark: (id) => {
    set({ bookmarks: get().bookmarks.filter((b) => b.id !== id) });
  },

  moveToGroup: (id, group) => {
    set({
      bookmarks: get().bookmarks.map((b) =>
        b.id === id ? { ...b, group } : b,
      ),
    });
  },

  loadBookmarks: (rootPath) =>
    enqueue(async () => {
      try {
        const raw = await tauriStorage.getItem(storageKey(rootPath));
        set({ bookmarks: raw ? (JSON.parse(raw) as BookmarkItem[]) : [] });
      } catch {
        set({ bookmarks: [] });
      }
    }),

  saveBookmarks: (rootPath) =>
    enqueue(async () => {
      // Read INSIDE the queued step, not at call time: a save queued behind a load must
      // write what the load produced.
      await tauriStorage.setItem(
        storageKey(rootPath),
        JSON.stringify(get().bookmarks),
      );
    }),
}));
