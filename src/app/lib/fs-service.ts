/**
 * Client-side file system service using the File System Access API.
 * Hybrid approach:
 *  - Primary: showDirectoryPicker() for full read+write access
 *  - Fallback: <input webkitdirectory> for read-only (works with Downloads, Documents, etc.)
 */

/* Type augmentation for File System Access API */
declare global {
  interface FileSystemDirectoryHandle {
    entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
  }
  interface FileSystemFileHandle {
    createWritable(): Promise<FileSystemWritableFileStream>;
  }
  interface FileSystemWritableFileStream extends WritableStream {
    write(data: string | BufferSource | Blob): Promise<void>;
    close(): Promise<void>;
  }
  interface Window {
    showDirectoryPicker(options?: { mode?: string }): Promise<FileSystemDirectoryHandle>;
  }
}

/* ─── Types ─── */

export interface FileMetadata {
  name: string;
  slug: string;
  size: number;
  modifiedAt: string;
  excerpt: string;
}

export interface FileContent {
  slug: string;
  content: string;
  size: number;
  modifiedAt: string;
}

export interface DuplicateGroup {
  files: { slug: string; name: string }[];
  similarity: number;
}

/** Represents the source of files — either a directory handle or raw file data. */
export type DirectorySource =
  | { type: "handle"; handle: FileSystemDirectoryHandle; name: string }
  | { type: "files"; files: Map<string, File>; name: string };

/* ─── Directory Access ─── */

/**
 * Opens the native directory picker (showDirectoryPicker).
 * Returns a DirectorySource with full read+write capabilities.
 * Throws on blocked directories or user cancel.
 */
export async function pickDirectory(): Promise<DirectorySource> {
  try {
    const handle = await window.showDirectoryPicker();
    return { type: "handle", handle, name: handle.name };
  } catch (err) {
    const error = err as Error;
    if (error.name === "AbortError") throw error;
    if (error.name === "SecurityError" || error.message?.includes("system")) {
      throw new Error("BLOCKED_DIRECTORY");
    }
    throw error;
  }
}

/**
 * Reads files from a native file input with webkitdirectory.
 * Returns a DirectorySource with read-only capabilities.
 * Works with ALL directories including Downloads, Documents, etc.
 */
export function filesFromInput(fileList: FileList): DirectorySource {
  const filesMap = new Map<string, File>();
  let dirName = "";

  for (let i = 0; i < fileList.length; i++) {
    const file = fileList[i];
    if (file.name.endsWith(".md")) {
      filesMap.set(file.name, file);
    }
    // Extract directory name from webkitRelativePath (e.g. "my-folder/file.md")
    if (!dirName && file.webkitRelativePath) {
      dirName = file.webkitRelativePath.split("/")[0];
    }
  }

  return { type: "files", files: filesMap, name: dirName || "Diretório" };
}

/**
 * Whether the source supports direct file writing.
 */
export function canWrite(source: DirectorySource): boolean {
  return source.type === "handle";
}

/* ─── File Operations ─── */

/**
 * Lists all .md files with metadata.
 */
export async function listFiles(source: DirectorySource): Promise<FileMetadata[]> {
  const files: FileMetadata[] = [];

  if (source.type === "handle") {
    for await (const [name, handle] of source.handle.entries()) {
      if (handle.kind !== "file" || !name.endsWith(".md")) continue;
      const file = await (handle as FileSystemFileHandle).getFile();
      const content = await file.text();
      files.push(buildMetadata(name, file.size, file.lastModified, content));
    }
  } else {
    for (const [name, file] of source.files.entries()) {
      const content = await file.text();
      files.push(buildMetadata(name, file.size, file.lastModified, content));
    }
  }

  files.sort((a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime());
  return files;
}

function buildMetadata(
  filename: string,
  size: number,
  lastModified: number,
  content: string,
): FileMetadata {
  const lines = content.split("\n").filter((l) => l.trim());
  const title = lines.find((l) => l.startsWith("#"))?.replace(/^#+\s*/, "") || filename;
  const excerptLines = lines
    .filter((l) => !l.startsWith("#") && !l.startsWith("```"))
    .slice(0, 2);
  const excerpt = excerptLines.join(" ").substring(0, 150);

  return {
    name: title,
    slug: filename.replace(/\.md$/, ""),
    size,
    modifiedAt: new Date(lastModified).toISOString(),
    excerpt,
  };
}

/**
 * Reads a single .md file by slug.
 */
export async function readFile(
  source: DirectorySource,
  slug: string,
): Promise<FileContent> {
  const filename = `${slug}.md`;

  if (source.type === "handle") {
    const fileHandle = await source.handle.getFileHandle(filename);
    const file = await fileHandle.getFile();
    const content = await file.text();
    return { slug, content, size: file.size, modifiedAt: new Date(file.lastModified).toISOString() };
  } else {
    const file = source.files.get(filename);
    if (!file) throw new Error("File not found");
    const content = await file.text();
    return { slug, content, size: file.size, modifiedAt: new Date(file.lastModified).toISOString() };
  }
}

/**
 * Saves content directly to a file (only works with handle source).
 */
export async function saveFile(
  source: DirectorySource,
  slug: string,
  content: string,
): Promise<void> {
  if (source.type !== "handle") {
    throw new Error("Direct save not supported in read-only mode");
  }
  const fileHandle = await source.handle.getFileHandle(`${slug}.md`);
  const writable = await fileHandle.createWritable();
  await writable.write(content);
  await writable.close();
}

/**
 * Downloads content as a .md file (fallback for read-only sources).
 */
export function downloadFile(slug: string, content: string): void {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${slug}.md`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ─── Similarity Detection ─── */

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-záàâãéèêíïóôõöúçñ0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

function cosineSimilarity(a: string[], b: string[]): number {
  const freqA: Record<string, number> = {};
  const freqB: Record<string, number> = {};

  a.forEach((w) => (freqA[w] = (freqA[w] || 0) + 1));
  b.forEach((w) => (freqB[w] = (freqB[w] || 0) + 1));

  const allWords = new Set([...Object.keys(freqA), ...Object.keys(freqB)]);
  let dotProduct = 0;
  let magA = 0;
  let magB = 0;

  for (const word of allWords) {
    const valA = freqA[word] || 0;
    const valB = freqB[word] || 0;
    dotProduct += valA * valB;
    magA += valA * valA;
    magB += valB * valB;
  }

  if (magA === 0 || magB === 0) return 0;
  return dotProduct / (Math.sqrt(magA) * Math.sqrt(magB));
}

/**
 * Detects duplicate/similar files based on content similarity.
 */
export async function detectDuplicates(
  source: DirectorySource,
): Promise<DuplicateGroup[]> {
  const fileData: { slug: string; name: string; tokens: string[] }[] = [];

  if (source.type === "handle") {
    for await (const [name, handle] of source.handle.entries()) {
      if (handle.kind !== "file" || !name.endsWith(".md")) continue;
      const file = await (handle as FileSystemFileHandle).getFile();
      const content = await file.text();
      const lines = content.split("\n").filter((l) => l.trim());
      const title = lines.find((l) => l.startsWith("#"))?.replace(/^#+\s*/, "") || name;
      fileData.push({
        slug: name.replace(/\.md$/, ""),
        name: title,
        tokens: tokenize(content.substring(0, 1500)),
      });
    }
  } else {
    for (const [name, file] of source.files.entries()) {
      const content = await file.text();
      const lines = content.split("\n").filter((l) => l.trim());
      const title = lines.find((l) => l.startsWith("#"))?.replace(/^#+\s*/, "") || name;
      fileData.push({
        slug: name.replace(/\.md$/, ""),
        name: title,
        tokens: tokenize(content.substring(0, 1500)),
      });
    }
  }

  const groups: DuplicateGroup[] = [];
  const processed = new Set<string>();

  for (let i = 0; i < fileData.length; i++) {
    if (processed.has(fileData[i].slug)) continue;

    const group: DuplicateGroup = {
      files: [{ slug: fileData[i].slug, name: fileData[i].name }],
      similarity: 0,
    };

    for (let j = i + 1; j < fileData.length; j++) {
      if (processed.has(fileData[j].slug)) continue;
      const sim = cosineSimilarity(fileData[i].tokens, fileData[j].tokens);
      if (sim >= 0.5) {
        group.files.push({ slug: fileData[j].slug, name: fileData[j].name });
        group.similarity = Math.max(group.similarity, Math.round(sim * 100));
        processed.add(fileData[j].slug);
      }
    }

    if (group.files.length > 1) {
      processed.add(fileData[i].slug);
      groups.push(group);
    }
  }

  groups.sort((a, b) => b.similarity - a.similarity);
  return groups;
}
