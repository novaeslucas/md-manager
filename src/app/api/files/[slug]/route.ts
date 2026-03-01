import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { resolveDir } from "../utils";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const dir = resolveDir(request);
    const { slug } = await params;
    const filePath = path.join(dir, `${slug}.md`);

    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    const content = fs.readFileSync(filePath, "utf-8");
    const stat = fs.statSync(filePath);

    return NextResponse.json({
      slug,
      content,
      size: stat.size,
      modifiedAt: stat.mtime.toISOString(),
    });
  } catch (error) {
    console.error("Error reading file:", error);
    return NextResponse.json({ error: "Failed to read file" }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const dir = resolveDir(request);
    const { slug } = await params;
    const filePath = path.join(dir, `${slug}.md`);

    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    const body = await request.json();
    const { content } = body;

    if (typeof content !== "string") {
      return NextResponse.json({ error: "Content must be a string" }, { status: 400 });
    }

    fs.writeFileSync(filePath, content, "utf-8");
    const stat = fs.statSync(filePath);

    return NextResponse.json({
      slug,
      size: stat.size,
      modifiedAt: stat.mtime.toISOString(),
      message: "File saved successfully",
    });
  } catch (error) {
    console.error("Error saving file:", error);
    return NextResponse.json({ error: "Failed to save file" }, { status: 500 });
  }
}
