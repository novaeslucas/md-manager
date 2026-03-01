import fs from "fs";
import path from "path";
import { NextRequest } from "next/server";

const DEFAULT_DIR = path.resolve(process.cwd(), "..", "arquivos");

/**
 * Resolves the markdown directory from the `dir` query parameter.
 * Falls back to the default `arquivos/` directory if none provided.
 * Validates that the path exists and is a directory.
 */
export function resolveDir(request: NextRequest): string {
  const { searchParams } = new URL(request.url);
  const dir = searchParams.get("dir");

  if (dir && dir.trim()) {
    const resolved = path.resolve(dir.trim());
    if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
      return resolved;
    }
  }

  return DEFAULT_DIR;
}

/**
 * Validates a directory path exists and is readable.
 */
export function validateDir(dirPath: string): { valid: boolean; error?: string } {
  if (!fs.existsSync(dirPath)) {
    return { valid: false, error: "Directory does not exist" };
  }
  if (!fs.statSync(dirPath).isDirectory()) {
    return { valid: false, error: "Path is not a directory" };
  }
  return { valid: true };
}
