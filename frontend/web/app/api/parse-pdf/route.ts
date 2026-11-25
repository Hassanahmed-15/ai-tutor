import type { NextRequest } from "next/server";
import { handleParsePdf } from "@/lib/parsePdf";

// The parse itself lives in lib/parsePdf.ts, so the phone capture (lib/capture/read.ts) can call it directly.
export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  return handleParsePdf(req);
}
