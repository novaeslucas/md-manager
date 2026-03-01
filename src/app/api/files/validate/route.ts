import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const dir = searchParams.get("dir")?.trim();

    if (!dir) {
      return NextResponse.json({ valid: false, error: "No directory provided" });
    }

    const resolved = path.resolve(dir);

    if (!fs.existsSync(resolved)) {
      return NextResponse.json({ valid: false, error: "Diretório não encontrado", path: resolved });
    }

    if (!fs.statSync(resolved).isDirectory()) {
      return NextResponse.json({ valid: false, error: "Caminho não é um diretório", path: resolved });
    }

    const entries = fs.readdirSync(resolved);
    const mdCount = entries.filter((f) => f.endsWith(".md")).length;

    return NextResponse.json({
      valid: true,
      path: resolved,
      mdCount,
    });
  } catch (error) {
    console.error("Error validating directory:", error);
    return NextResponse.json({ valid: false, error: "Failed to validate directory" }, { status: 500 });
  }
}
