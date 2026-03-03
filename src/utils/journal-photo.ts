// §56d Journal Photo — asset utility functions

import { createDir } from "../ipc/invoke";

/** Check if a path is absolute (Unix or Windows) */
function isAbsolutePath(p: string): boolean {
  return p.startsWith("/") || /^[A-Z]:\\/i.test(p);
}

/** Generate photo filename: YYYYMMDD-HHmmss-{sanitized-original}.{ext} */
export function generatePhotoFilename(originalName: string, date?: Date): string {
  const d = date ?? new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");

  // Sanitize original name: lowercase, replace spaces with hyphens, remove special chars
  const ext = originalName.includes(".") ? originalName.split(".").pop()!.toLowerCase() : "jpg";
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
  const { writeBinaryFile } = await import("../ipc/invoke");

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

/** Check if a path looks like a journal photo asset */
export function isJournalPhoto(path: string): boolean {
  return /assets\/\d{4}-\d{2}\//.test(path);
}

// §56d Photo Gallery — scan and group utilities

export interface PhotoGalleryEntry {
  filename: string;
  relativePath: string;
  absolutePath: string;
  date: Date;
  /** Whether the date was parsed from the filename (true) or is a fallback guess (false) */
  dateFromFilename: boolean;
  caption: string;
  journalPath: string | null;
}

/**
 * Scan journal daily directories for photos in per-directory assets/ subfolders.
 * Structure: daily/YYYY/MM/assets/photo.jpg
 * Each md file at daily/YYYY/MM/YYYY-MM-DD.md references images as assets/photo.jpg.
 */
export async function scanJournalPhotos(
  rootPath: string,
  journalDir: string,
  options?: { year?: number; month?: number },
): Promise<PhotoGalleryEntry[]> {
  const { listDir, readFile } = await import("../ipc/invoke");

  const base = isAbsolutePath(journalDir) ? journalDir : `${rootPath}/${journalDir}`;
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

        for (const file of files) {
          if (file.isDir) continue;
          if (!/\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i.test(file.name)) continue;

          // Parse date from filename: YYYYMMDD-HHmmss-name.ext
          const dateMatch = file.name.match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/);
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

          entries.push({
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
        await populateCaptionsFromDir(entries, journalDirPath, readFile);
      }
    }
  } catch {
    // daily/ directory may not exist yet
  }

  // Sort newest first
  entries.sort((a, b) => b.date.getTime() - a.date.getTime());
  return entries;
}

/**
 * Populate captions by scanning all markdown files in a month directory.
 * Only updates entries that don't already have captions.
 */
async function populateCaptionsFromDir(
  entries: PhotoGalleryEntry[],
  monthDirPath: string,
  readFile: (path: string) => Promise<string>,
): Promise<void> {
  const { listDir } = await import("../ipc/invoke");

  // Find entries without captions in this batch
  const uncaptioned = entries.filter((e) => !e.caption && !e.journalPath);
  if (uncaptioned.length === 0) return;

  let mdFiles;
  try {
    mdFiles = await listDir(monthDirPath);
  } catch {
    return;
  }

  for (const mdFile of mdFiles) {
    if (mdFile.isDir || !mdFile.name.endsWith(".md")) continue;

    const journalPath = `${monthDirPath}/${mdFile.name}`;

    // Parse date from md filename (e.g., "2026-03-03.md")
    const mdDateMatch = mdFile.name.match(/^(\d{4})-(\d{2})-(\d{2})\.md$/);
    const mdDate = mdDateMatch
      ? new Date(parseInt(mdDateMatch[1]), parseInt(mdDateMatch[2]) - 1, parseInt(mdDateMatch[3]))
      : null;

    try {
      const content = await readFile(journalPath);
      const imgRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
      let match;
      while ((match = imgRegex.exec(content)) !== null) {
        const caption = match[1];
        const imgPath = match[2];
        for (const entry of uncaptioned) {
          if (imgPath.includes(entry.filename) || imgPath === entry.relativePath) {
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
    } catch {
      // File read failed
    }
  }
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
