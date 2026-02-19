// §36 북마크 스토어 — 파일/헤딩 북마크 CRUD + localStorage 영속화
import { create } from "zustand";

export interface BookmarkItem {
  id: string;
  type: "file" | "heading";
  filePath: string;
  label: string;
  group: string;
  createdAt: number;
  headingText?: string;
  headingLevel?: number;
}

interface BookmarkState {
  bookmarks: BookmarkItem[];

  addBookmark: (item: Omit<BookmarkItem, "id" | "createdAt">) => void;
  removeBookmark: (id: string) => void;
  moveToGroup: (id: string, group: string) => void;
  loadBookmarks: (rootPath: string) => void;
  saveBookmarks: (rootPath: string) => void;
}

/** Generate localStorage key scoped to vault root */
export function storageKey(rootPath: string): string {
  return `baram:bookmarks:${rootPath}`;
}

/** Check for duplicate bookmark (same type + filePath + headingText) */
export function isDuplicate(
  bookmarks: BookmarkItem[],
  item: Pick<BookmarkItem, "type" | "filePath" | "headingText">,
): boolean {
  return bookmarks.some(
    (b) =>
      b.type === item.type &&
      b.filePath === item.filePath &&
      b.headingText === item.headingText,
  );
}

/** Get unique groups from bookmarks list */
export function getGroups(bookmarks: BookmarkItem[]): string[] {
  const groups = new Set<string>();
  for (const b of bookmarks) {
    groups.add(b.group);
  }
  return Array.from(groups);
}

/** Find heading pos by text+level */
export function findHeadingPos(
  headings: Array<{ level: number; text: string; pos: number }>,
  headingText: string,
  headingLevel?: number,
): number | null {
  const match = headings.find(
    (h) =>
      h.text === headingText &&
      (headingLevel === undefined || h.level === headingLevel),
  );
  return match?.pos ?? null;
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

  loadBookmarks: (rootPath) => {
    try {
      const raw = localStorage.getItem(storageKey(rootPath));
      if (raw) {
        const parsed = JSON.parse(raw) as BookmarkItem[];
        set({ bookmarks: parsed });
      } else {
        set({ bookmarks: [] });
      }
    } catch {
      set({ bookmarks: [] });
    }
  },

  saveBookmarks: (rootPath) => {
    const { bookmarks } = get();
    localStorage.setItem(storageKey(rootPath), JSON.stringify(bookmarks));
  },
}));
