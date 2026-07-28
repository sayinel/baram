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

/** Generate localStorage key scoped to vault root */
export function storageKey(rootPath: string): string {
  return `baram:bookmarks:${rootPath}`;
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

  loadBookmarks: async (rootPath) => {
    try {
      const raw = await tauriStorage.getItem(storageKey(rootPath));
      set({ bookmarks: raw ? (JSON.parse(raw) as BookmarkItem[]) : [] });
    } catch {
      set({ bookmarks: [] });
    }
  },

  saveBookmarks: async (rootPath) => {
    await tauriStorage.setItem(
      storageKey(rootPath),
      JSON.stringify(get().bookmarks),
    );
  },
}));
