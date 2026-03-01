import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { resolveDir } from "./utils";

export interface FileMetadata {
  name: string;
  slug: string;
  size: number;
  modifiedAt: string;
  excerpt: string;
}

export async function GET(request: NextRequest) {
  try {
    const dir = resolveDir(request);

    if (!fs.existsSync(dir)) {
      return NextResponse.json([]);
    }

    const entries = fs.readdirSync(dir);
    const mdFiles = entries.filter((f) => f.endsWith(".md"));

    const files: FileMetadata[] = mdFiles.map((filename) => {
      const filePath = path.join(dir, filename);
      const stat = fs.statSync(filePath);
      const content = fs.readFileSync(filePath, "utf-8");
      const lines = content.split("\n").filter((l) => l.trim());
      const title = lines.find((l) => l.startsWith("#"))?.replace(/^#+\s*/, "") || filename;
      const excerptLines = lines.filter((l) => !l.startsWith("#") && !l.startsWith("```")).slice(0, 2);
      const excerpt = excerptLines.join(" ").substring(0, 150);

      return {
        name: title,
        slug: filename.replace(/\.md$/, ""),
        size: stat.size,
        modifiedAt: stat.mtime.toISOString(),
        excerpt,
      };
    });

    files.sort((a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime());

    return NextResponse.json(files);
  } catch (error) {
    console.error("Error listing files:", error);
    return NextResponse.json({ error: "Failed to list files" }, { status: 500 });
  }
}
