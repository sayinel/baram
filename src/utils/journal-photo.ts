// §56d Journal Photo — asset utility functions

import { createDir } from "../ipc/invoke";

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

/** Save photo bytes to assets directory, returns relative path for markdown insertion */
export async function savePhotoToAssets(
  fileBytes: Uint8Array,
  originalName: string,
  rootPath: string,
  journalDir: string,
): Promise<string> {
  const { writeBinaryFile } = await import("../ipc/invoke");

  const now = new Date();
  const assetsRelDir = getAssetsDir(journalDir, now);
  const absoluteAssetsDir = `${rootPath}/${assetsRelDir}`;

  // Ensure directory exists
  try {
    await createDir(absoluteAssetsDir);
  } catch {
    // Directory may already exist
  }

  const filename = generatePhotoFilename(originalName, now);
  const absolutePath = `${absoluteAssetsDir}/${filename}`;
  const relativePath = `${assetsRelDir}/${filename}`;

  await writeBinaryFile(absolutePath, Array.from(fileBytes));

  return relativePath;
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
  caption: string;
  journalPath: string | null;
}

/** Scan journal assets directory for photos, optionally filtered by year/month */
export async function scanJournalPhotos(
  rootPath: string,
  journalDir: string,
  options?: { year?: number; month?: number },
): Promise<PhotoGalleryEntry[]> {
  const { listDir, readFile } = await import("../ipc/invoke");

  const assetsBase = `${rootPath}/${journalDir}/assets`;
  const entries: PhotoGalleryEntry[] = [];

  try {
    const monthDirs = await listDir(assetsBase);

    for (const monthDir of monthDirs) {
      if (!monthDir.isDir) continue;
      // Parse YYYY-MM from directory name
      const match = monthDir.name.match(/^(\d{4})-(\d{2})$/);
      if (!match) continue;

      const dirYear = parseInt(match[1], 10);
      const dirMonth = parseInt(match[2], 10);

      // Apply year/month filter
      if (options?.year && dirYear !== options.year) continue;
      if (options?.month && dirMonth !== options.month) continue;

      const dirPath = `${assetsBase}/${monthDir.name}`;
      const files = await listDir(dirPath);

      for (const file of files) {
        if (file.isDir) continue;
        if (!/\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i.test(file.name)) continue;

        // Parse date from filename: YYYYMMDD-HHmmss-name.ext
        const dateMatch = file.name.match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/);
        let date: Date;
        if (dateMatch) {
          date = new Date(
            parseInt(dateMatch[1]),
            parseInt(dateMatch[2]) - 1,
            parseInt(dateMatch[3]),
            parseInt(dateMatch[4]),
            parseInt(dateMatch[5]),
            parseInt(dateMatch[6]),
          );
        } else {
          // Fallback: use directory date
          date = new Date(dirYear, dirMonth - 1, 1);
        }

        const relativePath = `${journalDir}/assets/${monthDir.name}/${file.name}`;

        entries.push({
          filename: file.name,
          relativePath,
          absolutePath: `${rootPath}/${relativePath}`,
          date,
          caption: "", // Will be populated from journal markdown
          journalPath: null,
        });
      }
    }

    // Try to find captions from journal markdown files
    await populateCaptions(entries, rootPath, journalDir, readFile);

  } catch {
    // Assets directory may not exist yet
  }

  // Sort newest first
  entries.sort((a, b) => b.date.getTime() - a.date.getTime());
  return entries;
}

/** Populate captions by scanning journal markdown files for image references */
async function populateCaptions(
  entries: PhotoGalleryEntry[],
  rootPath: string,
  journalDir: string,
  readFile: (path: string) => Promise<string>,
): Promise<void> {
  // Group entries by date to minimize file reads
  const byDate = new Map<string, PhotoGalleryEntry[]>();
  for (const entry of entries) {
    const dateStr = `${entry.date.getFullYear()}-${String(entry.date.getMonth() + 1).padStart(2, "0")}-${String(entry.date.getDate()).padStart(2, "0")}`;
    const arr = byDate.get(dateStr) ?? [];
    arr.push(entry);
    byDate.set(dateStr, arr);
  }

  for (const [dateStr, dateEntries] of byDate) {
    const [yyyy, mm] = dateStr.split("-");
    const journalPath = `${rootPath}/${journalDir}/daily/${yyyy}/${mm}/${dateStr}.md`;

    try {
      const content = await readFile(journalPath);
      // Parse ![caption](path) references
      const imgRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
      let match;
      while ((match = imgRegex.exec(content)) !== null) {
        const caption = match[1];
        const imgPath = match[2];
        // Match entries by filename
        for (const entry of dateEntries) {
          if (imgPath.includes(entry.filename) || entry.relativePath.endsWith(imgPath.replace(/^\.\//, ""))) {
            entry.caption = caption;
            entry.journalPath = journalPath;
          }
        }
      }
    } catch {
      // Journal file doesn't exist for this date
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
