// §56d Journal Photo — asset utility functions

import {
  createDir,
  listDir,
  readFile,
  writeBinaryFile,
} from "../../ipc/invoke";
import { basename } from "../path-utils";
import { JOURNAL_DATE_PARTS_RE } from "./journal";

/**
 * 캡션을 찾으려고 한 달의 md를 읽을 때 동시에 띄우는 요청 수.
 *
 * 8인 이유: 병목은 CPU가 아니라 IPC 왕복이고, 한 달은 md가 최대 31개다 — 그 이상 올려도
 * 왕복 한 번보다 짧아지지 않으면서 백엔드 스레드풀을 사진 썸네일 생성과 다투게 된다.
 */
const CAPTION_READ_CONCURRENCY = 8;

export interface PhotoGalleryEntry {
  absolutePath: string;
  caption: string;
  date: Date;
  /** Whether the date was parsed from the filename (true) or is a fallback guess (false) */
  dateFromFilename: boolean;
  filename: string;
  journalPath: null | string;
  relativePath: string;
}

/** Generate photo filename: YYYYMMDD-HHmmss-{sanitized-original}.{ext} */
export function generatePhotoFilename(
  originalName: string,
  date?: Date,
): string {
  const d = date ?? new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");

  // Sanitize original name: lowercase, replace spaces with hyphens, remove special chars
  const ext = originalName.includes(".")
    ? originalName.split(".").pop()!.toLowerCase()
    : "jpg";
  const base = originalName
    .replace(/\.[^.]+$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50); // limit length

  return `${yyyy}${mm}${dd}-${hh}${min}${ss}-${base}.${ext}`;
}

/** Get assets directory path: {journalDir}/assets/YYYY-MM/ */
export function getAssetsDir(journalDir: string, date?: Date): string {
  const d = date ?? new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${journalDir}/assets/${yyyy}-${mm}`;
}

/** Group photos by date at different granularities */
export function groupPhotosByDate(
  photos: PhotoGalleryEntry[],
  mode: "day" | "month" | "year",
): Map<string, PhotoGalleryEntry[]> {
  const groups = new Map<string, PhotoGalleryEntry[]>();

  for (const photo of photos) {
    let key: string;
    const d = photo.date;
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");

    switch (mode) {
      case "day":
        key = `${yyyy}-${mm}-${dd}`;
        break;
      case "month":
        key = `${yyyy}-${mm}`;
        break;
      case "year":
        key = `${yyyy}`;
        break;
    }

    const arr = groups.get(key) ?? [];
    arr.push(photo);
    groups.set(key, arr);
  }

  return groups;
}

/** Check if a path looks like a journal photo asset */
export function isJournalPhoto(path: string): boolean {
  return /assets\/\d{4}-\d{2}\//.test(path);
}

// §56d Photo Gallery — scan and group utilities

/**
 * Save photo bytes to assets/ subfolder relative to the active md file's directory.
 * E.g., if md is at /journal/daily/2026/03/2026-03-03.md,
 * the photo is saved at /journal/daily/2026/03/assets/photo.jpg
 * and the returned relative path is "assets/photo.jpg" (for markdown insertion).
 */
export async function savePhotoToAssets(
  fileBytes: Uint8Array,
  originalName: string,
  _rootPath: string,
  _journalDir: string,
  activeFilePath?: string,
): Promise<string> {
  if (!activeFilePath) {
    throw new Error("Cannot save photo: no active file path");
  }

  const fileDir = activeFilePath.substring(0, activeFilePath.lastIndexOf("/"));
  const absoluteAssetsDir = `${fileDir}/assets`;

  // Ensure directory exists
  try {
    await createDir(absoluteAssetsDir);
  } catch {
    // Directory may already exist
  }

  const filename = generatePhotoFilename(originalName);
  const absolutePath = `${absoluteAssetsDir}/${filename}`;

  await writeBinaryFile(absolutePath, Array.from(fileBytes));

  // Return path relative to the md file's directory
  return `assets/${filename}`;
}

/**
 * Scan journal daily directories for photos in per-directory assets/ subfolders.
 * Structure: daily/YYYY/MM/assets/photo.jpg
 * Each md file at daily/YYYY/MM/YYYY-MM-DD.md references images as assets/photo.jpg.
 */
export async function scanJournalPhotos(
  rootPath: string,
  journalDir: string,
  options?: { month?: number; year?: number },
): Promise<PhotoGalleryEntry[]> {
  const base = isAbsolutePath(journalDir)
    ? journalDir
    : `${rootPath}/${journalDir}`;
  const dailyBase = `${base}/daily`;
  const entries: PhotoGalleryEntry[] = [];

  try {
    // Scan daily/YYYY/ year directories
    const yearDirs = await listDir(dailyBase);

    for (const yearDir of yearDirs) {
      if (!yearDir.isDir) continue;
      const yearMatch = yearDir.name.match(/^(\d{4})$/);
      if (!yearMatch) continue;

      const dirYear = parseInt(yearMatch[1], 10);
      if (options?.year && dirYear !== options.year) continue;

      // Scan daily/YYYY/MM/ month directories
      const monthDirs = await listDir(`${dailyBase}/${yearDir.name}`);

      for (const monthDir of monthDirs) {
        if (!monthDir.isDir) continue;
        const monthMatch = monthDir.name.match(/^(\d{2})$/);
        if (!monthMatch) continue;

        const dirMonth = parseInt(monthMatch[1], 10);
        if (options?.month && dirMonth !== options.month) continue;

        // Scan daily/YYYY/MM/assets/ for image files
        const assetsPath = `${dailyBase}/${yearDir.name}/${monthDir.name}/assets`;
        let files;
        try {
          files = await listDir(assetsPath);
        } catch {
          continue; // No assets/ subfolder for this month
        }

        const journalDirPath = `${dailyBase}/${yearDir.name}/${monthDir.name}`;
        // ‼️ 이 달의 사진만 담는다. 예전에는 누적 배열 전체를 캡션 채우기에 넘겼는데,
        // 그러면 달마다 "아직 캡션 없는 사진" 목록이 계속 길어져 매치 루프가 달 수 ×
        // 누적 사진 수로 커졌다. 캡션의 출처는 같은 달 디렉터리의 md뿐이므로 다른 달의
        // 사진을 그 목록에 둘 이유가 없다.
        const monthEntries: PhotoGalleryEntry[] = [];

        for (const file of files) {
          if (file.isDir) continue;
          if (!/\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i.test(file.name)) continue;

          // Parse date from filename: YYYYMMDD-HHmmss-name.ext
          const dateMatch = file.name.match(
            /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/,
          );
          let date: Date;
          let dateFromFilename = false;
          if (dateMatch) {
            date = new Date(
              parseInt(dateMatch[1]),
              parseInt(dateMatch[2]) - 1,
              parseInt(dateMatch[3]),
              parseInt(dateMatch[4]),
              parseInt(dateMatch[5]),
              parseInt(dateMatch[6]),
            );
            dateFromFilename = true;
          } else {
            // Fallback: use directory year/month, day 1 (will be refined by journal file match)
            date = new Date(dirYear, dirMonth - 1, 1);
          }

          const absolutePath = `${assetsPath}/${file.name}`;
          // relativePath as referenced in markdown (assets/filename.ext)
          const relativePath = `assets/${file.name}`;

          monthEntries.push({
            filename: file.name,
            relativePath,
            absolutePath,
            date,
            dateFromFilename,
            caption: "",
            journalPath: null,
          });
        }

        // Populate captions from journal markdown files in this month directory
        await populateCaptionsFromDir(monthEntries, journalDirPath, readFile);
        entries.push(...monthEntries);
      }
    }
  } catch {
    // daily/ directory may not exist yet
  }

  // Sort newest first
  entries.sort((a, b) => b.date.getTime() - a.date.getTime());
  return entries;
}

/** Check if a path is absolute (Unix or Windows) */
function isAbsolutePath(p: string): boolean {
  return p.startsWith("/") || /^[A-Z]:\\/i.test(p);
}

/** 일별 저널 파일 경로 → 그 날짜. 저널 파일명이 아니면 null. */
function journalDateFromFilename(journalPath: string): Date | null {
  const parts = basename(journalPath).match(JOURNAL_DATE_PARTS_RE);
  if (!parts) return null;
  return new Date(
    parseInt(parts[1]),
    parseInt(parts[2]) - 1,
    parseInt(parts[3]),
  );
}

/**
 * `items`를 최대 `limit`개씩 동시에 `fn`에 흘리고, 결과를 **입력 순서대로** 돌려준다.
 *
 * `Promise.all(items.map(fn))`이 아닌 이유: 한 번에 449개의 IPC를 띄우면 웹뷰와 백엔드
 * 스레드풀이 그 큐를 소화하는 동안 사용자가 누른 다음 동작(저널 열기)이 그 뒤에 선다.
 */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (let i = next++; i < items.length; i = next++) {
      results[i] = await fn(items[i]);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return results;
}

/**
 * Populate captions by scanning all markdown files in a month directory.
 * Only updates entries that don't already have captions.
 *
 * ‼️ md 파일 읽기는 **한 번에 여러 건**을 띄운다. 예전에는 `for` 안에서 하나씩 await 했는데,
 * 그 하나하나가 Tauri IPC 왕복이라 저널 규모에 정직하게 비례했다 — 실측 저널(449개 md)의
 * Year 뷰 한 번이 449번의 순차 왕복이다. 읽기는 서로 독립이므로 순서를 지킬 이유가 없다.
 *
 * 대신 **적용은 디렉터리 순서대로** 한다. 두 md가 같은 사진을 참조하면 마지막 것이 이기는
 * 기존 동작이 유지돼야 하고, 완료 순서대로 적용하면 그 결과가 실행마다 달라진다.
 */
async function populateCaptionsFromDir(
  entries: PhotoGalleryEntry[],
  monthDirPath: string,
  readFile: (path: string) => Promise<string>,
): Promise<void> {
  // Find entries without captions in this batch
  const uncaptioned = entries.filter((e) => !e.caption && !e.journalPath);
  if (uncaptioned.length === 0) return;

  let mdFiles;
  try {
    mdFiles = await listDir(monthDirPath);
  } catch {
    return;
  }

  const journalPaths = mdFiles
    .filter((f) => !f.isDir && f.name.endsWith(".md"))
    .map((f) => `${monthDirPath}/${f.name}`);

  const contents = await mapWithConcurrency(
    journalPaths,
    CAPTION_READ_CONCURRENCY,
    (journalPath) => readFile(journalPath).catch(() => null),
  );

  for (const [i, content] of contents.entries()) {
    if (content === null) continue; // File read failed
    const journalPath = journalPaths[i];
    const mdDate = journalDateFromFilename(journalPath);

    const imgRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
    let match;
    while ((match = imgRegex.exec(content)) !== null) {
      const caption = match[1];
      const imgPath = match[2];
      for (const entry of uncaptioned) {
        if (
          imgPath.includes(entry.filename) ||
          imgPath === entry.relativePath
        ) {
          entry.caption = caption;
          entry.journalPath = journalPath;
          // If entry date was a fallback, use the journal file's date
          if (mdDate && !entry.dateFromFilename) {
            entry.date = mdDate;
            entry.dateFromFilename = true;
          }
        }
      }
    }
  }
}
