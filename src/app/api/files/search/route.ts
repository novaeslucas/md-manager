import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { resolveDir } from "../utils";

export async function GET(request: NextRequest) {
  try {
    const dir = resolveDir(request);
    const { searchParams } = new URL(request.url);
    const query = searchParams.get("q")?.toLowerCase().trim();

    if (!query) {
      return NextResponse.json([]);
    }

    if (!fs.existsSync(dir)) {
      return NextResponse.json([]);
    }

    const entries = fs.readdirSync(dir);
    const mdFiles = entries.filter((f) => f.endsWith(".md"));

    const results = mdFiles
      .map((filename) => {
        const filePath = path.join(dir, filename);
        const content = fs.readFileSync(filePath, "utf-8");
        const slug = filename.replace(/\.md$/, "");
        const lines = content.split("\n").filter((l) => l.trim());
        const title = lines.find((l) => l.startsWith("#"))?.replace(/^#+\s*/, "") || filename;

        const nameMatch = filename.toLowerCase().includes(query);
        const titleMatch = title.toLowerCase().includes(query);
        const contentMatch = content.toLowerCase().includes(query);

        if (!nameMatch && !titleMatch && !contentMatch) return null;

        let matchContext = "";
        if (contentMatch) {
          const contentLower = content.toLowerCase();
          const idx = contentLower.indexOf(query);
          const start = Math.max(0, idx - 60);
          const end = Math.min(content.length, idx + query.length + 60);
          matchContext = (start > 0 ? "..." : "") + content.substring(start, end) + (end < content.length ? "..." : "");
        }

        return {
          slug,
          name: title,
          matchType: nameMatch || titleMatch ? "title" : "content",
          matchContext,
        };
      })
      .filter(Boolean);

    return NextResponse.json(results);
  } catch (error) {
    console.error("Error searching files:", error);
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}
