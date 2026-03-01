import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { resolveDir } from "../utils";

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

export interface DuplicateGroup {
  files: { slug: string; name: string }[];
  similarity: number;
}

export async function GET(request: NextRequest) {
  try {
    const dir = resolveDir(request);

    if (!fs.existsSync(dir)) {
      return NextResponse.json([]);
    }

    const entries = fs.readdirSync(dir);
    const mdFiles = entries.filter((f) => f.endsWith(".md"));

    const fileData = mdFiles.map((filename) => {
      const filePath = path.join(dir, filename);
      const content = fs.readFileSync(filePath, "utf-8");
      const lines = content.split("\n").filter((l) => l.trim());
      const title = lines.find((l) => l.startsWith("#"))?.replace(/^#+\s*/, "") || filename;
      const slug = filename.replace(/\.md$/, "");
      const tokens = tokenize(content.substring(0, 1500));

      return { slug, name: title, tokens };
    });

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

    return NextResponse.json(groups);
  } catch (error) {
    console.error("Error detecting duplicates:", error);
    return NextResponse.json({ error: "Duplicate detection failed" }, { status: 500 });
  }
}
